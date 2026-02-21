const WebSocket = require('ws');
const https = require('https');
const crypto = require('crypto');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const VOICES_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const BINARY_DELIM = 'Path:audio\r\n';

const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`;

/**
 * Generate the Sec-MS-GEC token required by Microsoft's API.
 * Uses BigInt to avoid JavaScript floating-point precision issues.
 * Based on: https://github.com/rany2/edge-tts/blob/master/src/edge_tts/drm.py
 */
function generateSecMsGec() {
  const WIN_EPOCH = 11644473600n;
  const S_TO_HNS = 10000000n; // seconds to 100-nanosecond intervals

  // Get current time as BigInt seconds
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  // Convert to Windows file time epoch
  let ticks = nowSeconds + WIN_EPOCH;

  // Round down to nearest 5 minutes (300 seconds)
  ticks = ticks - (ticks % 300n);

  // Convert to 100-nanosecond intervals
  ticks = ticks * S_TO_HNS;

  // Hash: "{ticks}{token}"
  const strToHash = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function generateMuid() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function getVoices() {
  const url = `${VOICES_URL}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse voices response'));
        }
      });
    }).on('error', reject);
  });
}

function synthesize(text, voiceName, outputFormat, options = {}) {
  return new Promise((resolve, reject) => {
    const connectionId = crypto.randomBytes(16).toString('hex');
    const requestId = crypto.randomBytes(16).toString('hex');
    const muid = generateMuid();

    const wsUrl = `${WSS_URL}&ConnectionId=${connectionId}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const ws = new WebSocket(wsUrl, {
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `muid=${muid};`,
      },
      perMessageDeflate: {
        zlibDeflateOptions: { level: 9 },
      },
    });

    const audioChunks = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('TTS timed out after 15 seconds'));
      }
    }, 15000);

    ws.on('open', () => {
      // Send speech config
      ws.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${outputFormat}"}}}}`);

      // Send SSML request
      const rate = options.rate || 1.0;
      const pitch = options.pitch || '+0Hz';
      const volume = options.volume || 100;

      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voiceName}"><prosody pitch="${pitch}" rate="${rate}" volume="${volume}">${escapeXml(text)}</prosody></voice></speak>`;

      ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const str = buf.toString('utf8', 0, Math.min(buf.length, 500));

      // Check for turn.end in any message (text or binary)
      if (str.includes('Path:turn.end')) {
        clearTimeout(timeout);
        resolved = true;
        ws.close();
        if (audioChunks.length === 0) {
          reject(new Error('No audio data received'));
        } else {
          resolve(Buffer.concat(audioChunks));
        }
        return;
      }

      // Extract audio data from binary messages
      const delimIdx = str.indexOf(BINARY_DELIM);
      if (delimIdx !== -1) {
        const headerBytes = Buffer.byteLength(str.substring(0, delimIdx + BINARY_DELIM.length), 'utf8');
        const audioData = buf.slice(headerBytes);
        if (audioData.length > 0) {
          audioChunks.push(audioData);
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(new Error('WebSocket error: ' + (err.message || err)));
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('WebSocket closed before audio was received'));
        }
      }
    });
  });
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { getVoices, synthesize };
