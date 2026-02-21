const edgeTTS = require('./edge-tts');

const formats = [
  'audio-24khz-96kbitrate-mono-mp3',
  'audio-24khz-48kbitrate-mono-mp3',
  'audio-48khz-192kbitrate-mono-mp3',
  'audio-48khz-96kbitrate-mono-mp3',
  'webm-24khz-16bit-mono-opus',
  'audio-24khz-160kbitrate-mono-mp3',
];

async function test() {
  for (const fmt of formats) {
    try {
      const audio = await edgeTTS.synthesize(
        'Hello test',
        'en-US-AndrewMultilingualNeural',
        fmt
      );
      console.log(`OK: ${fmt} -> ${audio.length} bytes`);
    } catch (err) {
      console.log(`FAIL: ${fmt} -> ${err.message}`);
    }
  }
  process.exit(0);
}

test();
