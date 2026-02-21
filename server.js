const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;
const SOUNDS_DIR = path.join(__dirname, 'sounds');

// Ensure sounds directory exists
if (!fs.existsSync(SOUNDS_DIR)) {
  fs.mkdirSync(SOUNDS_DIR);
}

// Multer config — save uploads to sounds/ with original extension
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SOUNDS_DIR),
  filename: (req, file, cb) => {
    // Sanitize filename: keep alphanumeric, dashes, underscores, dots
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Avoid collisions by prepending timestamp if file already exists
    if (fs.existsSync(path.join(SOUNDS_DIR, safe))) {
      const ext = path.extname(safe);
      const base = path.basename(safe, ext);
      cb(null, `${base}_${Date.now()}${ext}`);
    } else {
      cb(null, safe);
    }
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg', '.webm', '.m4a'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Use: ${allowed.join(', ')}`));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Serve sound files
app.use('/sounds', express.static(SOUNDS_DIR));

// List all sound files
app.get('/api/sounds', (req, res) => {
  const files = fs.readdirSync(SOUNDS_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp3', '.wav', '.ogg', '.webm', '.m4a'].includes(ext);
  });

  // Load categories if they exist
  const catPath = path.join(SOUNDS_DIR, 'categories.json');
  let categories = null;
  if (fs.existsSync(catPath)) {
    try {
      categories = JSON.parse(fs.readFileSync(catPath, 'utf-8'));
    } catch (e) { /* ignore parse errors */ }
  }

  // Load tags if they exist
  const tagsPath = path.join(SOUNDS_DIR, 'tags.json');
  let tags = null;
  if (fs.existsSync(tagsPath)) {
    try {
      tags = JSON.parse(fs.readFileSync(tagsPath, 'utf-8'));
    } catch (e) { /* ignore parse errors */ }
  }

  res.json({ files, categories, tags });
});

// Save categories
app.put('/api/sounds/categories', (req, res) => {
  const catPath = path.join(SOUNDS_DIR, 'categories.json');
  try {
    fs.writeFileSync(catPath, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upload a sound file
app.post('/api/upload', upload.single('sound'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filename: req.file.filename });
});

// Delete a sound file
app.delete('/api/sounds/:name', (req, res) => {
  const name = req.params.name;
  // Prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(SOUNDS_DIR, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  fs.unlinkSync(filePath);
  res.json({ deleted: name });
});

// ElevenLabs TTS — list available voices
app.use(express.json());

app.get('/api/tts/voices', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'No API key provided' });
  }

  const options = {
    hostname: 'api.elevenlabs.io',
    path: '/v1/voices',
    headers: { 'xi-api-key': apiKey },
  };

  https.get(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      if (apiRes.statusCode !== 200) {
        return res.status(apiRes.statusCode).json({ error: 'ElevenLabs API error: ' + data });
      }
      try {
        const parsed = JSON.parse(data);
        const voices = parsed.voices.map(v => ({
          id: v.voice_id,
          name: v.name,
          category: v.category || 'custom',
          previewUrl: v.preview_url,
        }));
        res.json(voices);
      } catch (e) {
        res.status(500).json({ error: 'Failed to parse voices' });
      }
    });
  }).on('error', err => {
    res.status(500).json({ error: err.message });
  });
});

// ElevenLabs TTS — speak text and return audio
app.post('/api/tts/speak', (req, res) => {
  const { text, voice, model, stability, similarity, style, speed, use_speaker_boost } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(400).json({ error: 'No API key provided' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }
  if (text.length > 2500) {
    return res.status(400).json({ error: 'Text too long (max 2500 characters)' });
  }

  const voiceId = voice || 'pNInz6obpgDQGcFmaJgB'; // Default: Adam
  const postData = JSON.stringify({
    text: text.trim(),
    model_id: model || 'eleven_multilingual_v2',
    voice_settings: {
      stability: stability ?? 0.5,
      similarity_boost: similarity ?? 0.75,
      style: style ?? 0,
      use_speaker_boost: use_speaker_boost ?? true,
    },
    ...(speed != null && speed !== 1 ? { speed } : {}),
  });

  const options = {
    hostname: 'api.elevenlabs.io',
    path: `/v1/text-to-speech/${voiceId}`,
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      let errData = '';
      apiRes.on('data', chunk => errData += chunk);
      apiRes.on('end', () => {
        console.error('ElevenLabs error:', apiRes.statusCode, errData);
        if (!res.headersSent) {
          res.status(apiRes.statusCode).json({ error: 'ElevenLabs: ' + errData });
        }
      });
      return;
    }

    res.set('Content-Type', 'audio/mpeg');
    apiRes.pipe(res);
  });

  apiReq.on('error', err => {
    console.error('ElevenLabs request error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });

  apiReq.write(postData);
  apiReq.end();
});

// ElevenLabs — usage / subscription info
app.get('/api/tts/usage', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'No API key provided' });
  }

  const options = {
    hostname: 'api.elevenlabs.io',
    path: '/v1/user/subscription',
    headers: { 'xi-api-key': apiKey },
  };

  https.get(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      if (apiRes.statusCode !== 200) {
        return res.status(apiRes.statusCode).json({ error: 'ElevenLabs API error: ' + data });
      }
      try {
        const parsed = JSON.parse(data);
        res.json({
          character_count: parsed.character_count,
          character_limit: parsed.character_limit,
          tier: parsed.tier,
          next_character_count_reset_unix: parsed.next_character_count_reset_unix,
        });
      } catch (e) {
        res.status(500).json({ error: 'Failed to parse subscription info' });
      }
    });
  }).on('error', err => {
    res.status(500).json({ error: err.message });
  });
});

// ElevenLabs — sound effect generation
app.post('/api/tts/sound-effect', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'No API key provided' });
  }

  const { text, duration_seconds, prompt_influence } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'No text description provided' });
  }

  const postData = JSON.stringify({
    text: text.trim(),
    duration_seconds: duration_seconds ?? undefined,
    prompt_influence: prompt_influence ?? 0.3,
  });

  const options = {
    hostname: 'api.elevenlabs.io',
    path: '/v1/sound-generation',
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      let errData = '';
      apiRes.on('data', chunk => errData += chunk);
      apiRes.on('end', () => {
        console.error('ElevenLabs SFX error:', apiRes.statusCode, errData);
        if (!res.headersSent) {
          res.status(apiRes.statusCode).json({ error: 'ElevenLabs: ' + errData });
        }
      });
      return;
    }

    res.set('Content-Type', 'audio/mpeg');
    apiRes.pipe(res);
  });

  apiReq.on('error', err => {
    console.error('ElevenLabs SFX request error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });

  apiReq.write(postData);
  apiReq.end();
});

// Error handling for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Soundboard server running at http://localhost:${PORT}`);
});
