// ========== Toast & Modal System ==========

const toastIcons = { success: '\u2714', error: '\u2716', warning: '\u26A0', info: '\u2139' };

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${toastIcons[type] || toastIcons.info}</span>
    <span class="toast-body">${escapeHtml(message)}</span>
    <button class="toast-dismiss" aria-label="Dismiss">&times;</button>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>
  `;

  const dismiss = () => {
    if (toast.classList.contains('removing')) return;
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 250);
  };

  toast.querySelector('.toast-dismiss').addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, duration);
  toast.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    toast.querySelector('.toast-progress').style.animationPlayState = 'paused';
  });
  toast.addEventListener('mouseleave', () => {
    toast.querySelector('.toast-progress').style.animationPlayState = 'running';
    setTimeout(dismiss, 1500);
  });

  container.appendChild(toast);
}

function showConfirm(message, options = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const msg = overlay.querySelector('.modal-message');
    const input = overlay.querySelector('.modal-input');
    const cancel = overlay.querySelector('.modal-cancel');
    const confirm = overlay.querySelector('.modal-confirm');

    msg.textContent = message;
    input.hidden = true;
    confirm.textContent = options.confirmText || 'Confirm';
    confirm.className = 'modal-confirm' + (options.danger ? ' danger' : '');
    overlay.classList.remove('modal-hidden');

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.onclick = null;
      overlay.classList.add('modal-hidden');
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    cancel.onclick = () => cleanup(false);
    confirm.onclick = () => cleanup(true);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    document.addEventListener('keydown', onKey);

    confirm.focus();
  });
}

function showPrompt(message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-overlay');
    const msg = overlay.querySelector('.modal-message');
    const input = overlay.querySelector('.modal-input');
    const cancel = overlay.querySelector('.modal-cancel');
    const confirm = overlay.querySelector('.modal-confirm');

    msg.textContent = message;
    input.hidden = false;
    input.value = defaultValue;
    confirm.textContent = 'Save';
    confirm.className = 'modal-confirm';
    overlay.classList.remove('modal-hidden');

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.onclick = null;
      overlay.classList.add('modal-hidden');
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(null);
      if (e.key === 'Enter') cleanup(input.value.trim() || null);
    };

    cancel.onclick = () => cleanup(null);
    confirm.onclick = () => cleanup(input.value.trim() || null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    document.addEventListener('keydown', onKey);

    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

// Escape key dismisses all toasts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.toast').forEach(t => {
      t.classList.add('removing');
      setTimeout(() => t.remove(), 250);
    });
  }
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== DOM References ==========

const micSelect = document.getElementById('mic-select');
const deviceSelect = document.getElementById('device-select');
const monitorSelect = document.getElementById('monitor-select');
const voiceSelect = document.getElementById('voice-select');
const volumeSlider = document.getElementById('volume-slider');
const micToggle = document.getElementById('mic-toggle');
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const soundGrid = document.getElementById('sound-grid');

let selectedDeviceId = 'default';
let monitorDeviceId = 'none';
let selectedMicId = 'none';
let currentVoice = 'clean';
let currentAudio = null;
let currentMonitor = null;

// Mic passthrough state
let micStream = null;
let micAudioContext = null;
let micPassthroughActive = false;
let micOutputAudio = null;
let micSourceNode = null;
let micEffectNodes = [];
let micGainNode = null;

// Mic gain control
const micGainSlider = document.getElementById('mic-gain-slider');
const micGainVal = document.getElementById('mic-gain-val');

const savedMicGain = localStorage.getItem('soundboard-mic-gain');
if (savedMicGain !== null) {
  micGainSlider.value = savedMicGain;
}
micGainVal.textContent = parseFloat(micGainSlider.value).toFixed(1) + 'x';

micGainSlider.addEventListener('input', () => {
  const val = parseFloat(micGainSlider.value);
  micGainVal.textContent = val.toFixed(1) + 'x';
  // Update gain in real-time if mic is active
  if (micGainNode) {
    micGainNode.gain.value = val;
  }
});

micGainSlider.addEventListener('change', () => {
  localStorage.setItem('soundboard-mic-gain', micGainSlider.value);
});

// --- Audio device enumeration ---

async function loadDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {}

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  const inputs = devices.filter(d => d.kind === 'audioinput');

  micSelect.innerHTML = '';
  inputs.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Mic (${device.deviceId.slice(0, 8)})`;
    micSelect.appendChild(option);
  });

  deviceSelect.innerHTML = '';
  outputs.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Speaker (${device.deviceId.slice(0, 8)})`;
    deviceSelect.appendChild(option);
  });

  monitorSelect.innerHTML = '<option value="none">Off</option>';
  outputs.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Speaker (${device.deviceId.slice(0, 8)})`;
    monitorSelect.appendChild(option);
  });

  // Restore saved selections
  const savedMic = localStorage.getItem('soundboard-mic');
  if (savedMic && inputs.some(d => d.deviceId === savedMic)) {
    micSelect.value = savedMic;
    selectedMicId = savedMic;
  } else if (inputs.length > 0) {
    selectedMicId = inputs[0].deviceId;
  }

  const savedDevice = localStorage.getItem('soundboard-device');
  if (savedDevice && outputs.some(d => d.deviceId === savedDevice)) {
    deviceSelect.value = savedDevice;
    selectedDeviceId = savedDevice;
  }

  const savedMonitor = localStorage.getItem('soundboard-monitor');
  if (savedMonitor === 'none') {
    monitorSelect.value = 'none';
    monitorDeviceId = 'none';
  } else if (savedMonitor && outputs.some(d => d.deviceId === savedMonitor)) {
    monitorSelect.value = savedMonitor;
    monitorDeviceId = savedMonitor;
  }

  const savedVoice = localStorage.getItem('soundboard-voice');
  if (savedVoice) {
    voiceSelect.value = savedVoice;
    currentVoice = savedVoice;
  }
}

micSelect.addEventListener('change', () => {
  selectedMicId = micSelect.value;
  localStorage.setItem('soundboard-mic', selectedMicId);
  if (micPassthroughActive) {
    stopMicPassthrough();
    startMicPassthrough();
  }
});

deviceSelect.addEventListener('change', () => {
  selectedDeviceId = deviceSelect.value;
  localStorage.setItem('soundboard-device', selectedDeviceId);
  // Restart mic passthrough to pick up the new output device
  if (micPassthroughActive) {
    stopMicPassthrough();
    startMicPassthrough();
  }
});

monitorSelect.addEventListener('change', () => {
  monitorDeviceId = monitorSelect.value;
  localStorage.setItem('soundboard-monitor', monitorDeviceId);
});

voiceSelect.addEventListener('change', () => {
  currentVoice = voiceSelect.value;
  localStorage.setItem('soundboard-voice', currentVoice);
  // Rebuild the effects chain live if mic is active
  if (micPassthroughActive) {
    stopMicPassthrough();
    startMicPassthrough();
  }
});

const savedVolume = localStorage.getItem('soundboard-volume');
if (savedVolume !== null) {
  volumeSlider.value = savedVolume;
}

volumeSlider.addEventListener('input', () => {
  localStorage.setItem('soundboard-volume', volumeSlider.value);
});

// --- Voice effect chains ---
// Each function takes an AudioContext and source node, returns the final node in the chain.
//
// Pitch shifting uses a dual-delay modulation technique:
// Two delay lines with sawtooth LFOs 180° out of phase create overlapping
// grains that shift the perceived pitch up or down depending on modulation rate.

function createPitchShifter(ctx, source, semitones) {
  // Convert semitones to delay modulation parameters
  const pitchRatio = Math.pow(2, semitones / 12);
  const grainSize = 0.1; // 100ms grains
  const speed = 1 - (1 / pitchRatio);

  const mix = ctx.createGain();
  mix.gain.value = 1;

  // Create two delay lines for crossfade (avoids clicks)
  for (let i = 0; i < 2; i++) {
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = grainSize;

    // Sawtooth LFO to modulate delay time
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = Math.abs(speed) / grainSize;
    micEffectNodes.push(lfo);

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = (speed > 0 ? -1 : 1) * grainSize / 2;

    // Offset the second voice by half a cycle for smooth crossfade
    const lfoOffset = ctx.createConstantSource();
    lfoOffset.offset.value = grainSize / 2 + (i * grainSize / 2);
    micEffectNodes.push(lfoOffset);

    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfoOffset.connect(delay.delayTime);

    // Crossfade envelope — triangle wave matched to LFO
    const envLfo = ctx.createOscillator();
    envLfo.type = 'triangle';
    envLfo.frequency.value = lfo.frequency.value;
    micEffectNodes.push(envLfo);

    const envGain = ctx.createGain();
    envGain.gain.value = 0.5;

    const envOffset = ctx.createConstantSource();
    envOffset.offset.value = 0.5;
    micEffectNodes.push(envOffset);

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0;

    envLfo.connect(envGain);
    envGain.connect(voiceGain.gain);
    envOffset.connect(voiceGain.gain);

    source.connect(delay);
    delay.connect(voiceGain);
    voiceGain.connect(mix);

    // Start with phase offset for voice 2
    const startTime = ctx.currentTime;
    lfo.start(startTime);
    envLfo.start(startTime + (i * 0.5 / lfo.frequency.value));
    lfoOffset.start(startTime);
    envOffset.start(startTime);
  }

  return mix;
}

function createVoiceChain(ctx, source) {
  let node = source;

  switch (currentVoice) {
    case 'clean':
      break;

    case 'deep': {
      // Pitch shift down 6 semitones + bass boost
      node = createPitchShifter(ctx, node, -6);

      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 300;
      bass.gain.value = 8;

      const cut = ctx.createBiquadFilter();
      cut.type = 'highshelf';
      cut.frequency.value = 3000;
      cut.gain.value = -4;

      node.connect(bass);
      bass.connect(cut);
      node = cut;
      break;
    }

    case 'high': {
      // Pitch shift up 8 semitones + treble boost
      node = createPitchShifter(ctx, node, 8);

      const highBoost = ctx.createBiquadFilter();
      highBoost.type = 'highshelf';
      highBoost.frequency.value = 2000;
      highBoost.gain.value = 6;

      const lowCut = ctx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = 300;

      node.connect(lowCut);
      lowCut.connect(highBoost);
      node = highBoost;
      break;
    }

    case 'robot': {
      // Ring modulation at a higher freq + vocoder-like bandpass comb
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 150;
      osc.start();
      micEffectNodes.push(osc);

      const ringGain = ctx.createGain();
      ringGain.gain.value = 0;
      osc.connect(ringGain.gain);
      node.connect(ringGain);

      // Comb filter effect using short delay
      const comb = ctx.createDelay(0.05);
      comb.delayTime.value = 0.005;
      const combFeedback = ctx.createGain();
      combFeedback.gain.value = 0.7;
      ringGain.connect(comb);
      comb.connect(combFeedback);
      combFeedback.connect(comb);

      const combMix = ctx.createGain();
      combMix.gain.value = 1;
      ringGain.connect(combMix);
      comb.connect(combMix);

      // Bandpass to make it sound tinny/electronic
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1;

      combMix.connect(bp);

      const postGain = ctx.createGain();
      postGain.gain.value = 1.5;
      bp.connect(postGain);
      node = postGain;
      break;
    }

    case 'megaphone': {
      // Tight bandpass + hard distortion + resonant peak
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 2000;
      bandpass.Q.value = 3;

      const preGain = ctx.createGain();
      preGain.gain.value = 4;

      const distortion = ctx.createWaveShaper();
      distortion.curve = makeDistortionCurve(400);
      distortion.oversample = '4x';

      const postBp = ctx.createBiquadFilter();
      postBp.type = 'peaking';
      postBp.frequency.value = 2500;
      postBp.Q.value = 2;
      postBp.gain.value = 8;

      const postGain = ctx.createGain();
      postGain.gain.value = 0.4;

      node.connect(bandpass);
      bandpass.connect(preGain);
      preGain.connect(distortion);
      distortion.connect(postBp);
      postBp.connect(postGain);
      node = postGain;
      break;
    }

    case 'echo': {
      // Multi-tap delay with filtering for spacious echo
      const predelay = ctx.createDelay(0.5);
      predelay.delayTime.value = 0.15;

      const delay2 = ctx.createDelay(1.0);
      delay2.delayTime.value = 0.35;

      const feedback = ctx.createGain();
      feedback.gain.value = 0.45;

      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 3000;

      const mix = ctx.createGain();
      mix.gain.value = 1;

      node.connect(mix); // dry
      node.connect(predelay);
      predelay.connect(mix); // first tap
      predelay.connect(delay2);
      delay2.connect(lpf);
      lpf.connect(feedback);
      feedback.connect(delay2);
      delay2.connect(mix); // second tap
      node = mix;
      break;
    }

    case 'demon': {
      // Pitch shift down 5 semitones + subtle ring mod + mild distortion
      // Mix dry signal in to keep speech intelligible
      const pitched = createPitchShifter(ctx, node, -5);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 35;
      osc2.start();
      micEffectNodes.push(osc2);

      const ringGain2 = ctx.createGain();
      ringGain2.gain.value = 0;
      osc2.connect(ringGain2.gain);
      pitched.connect(ringGain2);

      const demonBass = ctx.createBiquadFilter();
      demonBass.type = 'lowshelf';
      demonBass.frequency.value = 250;
      demonBass.gain.value = 8;

      const demonDist = ctx.createWaveShaper();
      demonDist.curve = makeDistortionCurve(60);
      demonDist.oversample = '4x';

      // Mix: 70% processed + 30% pitch-shifted dry (no ring mod) for clarity
      const demonMix = ctx.createGain();
      demonMix.gain.value = 1;

      const wetGain = ctx.createGain();
      wetGain.gain.value = 0.7;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 0.3;

      ringGain2.connect(demonBass);
      demonBass.connect(demonDist);
      demonDist.connect(wetGain);
      wetGain.connect(demonMix);

      pitched.connect(dryGain);
      dryGain.connect(demonMix);

      node = demonMix;
      break;
    }
  }

  return node;
}

function makeDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// --- Mic passthrough ---

let micOutputContext = null; // separate context for output device routing

async function startMicPassthrough() {
  try {
    // Disable browser audio processing for clean signal
    const constraints = {
      audio: {
        deviceId: selectedMicId !== 'none' ? { exact: selectedMicId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Request low-latency capture
        latency: 0,
        channelCount: 1,
      }
    };
    micStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Use interactive latency hint for minimal buffer sizes
    micAudioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: micStream.getAudioTracks()[0].getSettings().sampleRate || undefined,
    });

    // Resume context if suspended (autoplay policy)
    if (micAudioContext.state === 'suspended') {
      await micAudioContext.resume();
    }

    micSourceNode = micAudioContext.createMediaStreamSource(micStream);

    // Mic gain — boosts the raw mic signal before effects
    micGainNode = micAudioContext.createGain();
    micGainNode.gain.value = parseFloat(micGainSlider.value);
    micSourceNode.connect(micGainNode);

    // Build voice effects chain (fed from gain node, not raw source)
    micEffectNodes = [];
    const lastNode = createVoiceChain(micAudioContext, micGainNode);
    micLastNode = lastNode;

    // Route to output device:
    // If we need a specific output device, use a second AudioContext with sinkId
    // (AudioContext.sinkId is the modern low-latency way, no Audio element needed)
    // Otherwise connect straight to the processing context's destination
    if (selectedDeviceId !== 'default' && typeof AudioContext.prototype.setSinkId === 'function') {
      // Modern path: set sinkId directly on a dedicated output context
      micOutputContext = new AudioContext({ latencyHint: 'interactive' });
      await micOutputContext.setSinkId(selectedDeviceId);
      if (micOutputContext.state === 'suspended') await micOutputContext.resume();

      // Bridge: processing context -> MediaStream -> output context
      const bridge = micAudioContext.createMediaStreamDestination();
      lastNode.connect(bridge);

      const bridgeSource = micOutputContext.createMediaStreamSource(bridge.stream);
      bridgeSource.connect(micOutputContext.destination);
    } else if (selectedDeviceId !== 'default') {
      // Fallback: Audio element (older browsers without setSinkId on AudioContext)
      const destination = micAudioContext.createMediaStreamDestination();
      lastNode.connect(destination);

      micOutputAudio = new Audio();
      micOutputAudio.srcObject = destination.stream;
      if (micOutputAudio.setSinkId) {
        await micOutputAudio.setSinkId(selectedDeviceId);
      }
      await micOutputAudio.play();
    } else {
      // Default device: connect directly to context destination (lowest latency)
      lastNode.connect(micAudioContext.destination);
    }

    micPassthroughActive = true;
    micToggle.textContent = 'MIC ON';
    micToggle.classList.remove('off');
    micToggle.classList.add('on');
  } catch (err) {
    console.error('Mic passthrough failed:', err);
    showToast('Could not start mic passthrough: ' + err.message, 'error');
    stopMicPassthrough();
  }
}

function stopMicPassthrough() {
  // Stop monitor if active (depends on mic chain)
  if (micMonitorActive) stopMicMonitor();

  if (micOutputAudio) {
    micOutputAudio.pause();
    micOutputAudio.srcObject = null;
    micOutputAudio = null;
  }
  if (micOutputContext) {
    micOutputContext.close().catch(() => {});
    micOutputContext = null;
  }
  micEffectNodes.forEach(n => { try { n.stop(); } catch(e) {} });
  micEffectNodes = [];
  micSourceNode = null;
  micGainNode = null;
  micLastNode = null;
  if (micAudioContext) {
    micAudioContext.close();
    micAudioContext = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  micPassthroughActive = false;
  micToggle.textContent = 'MIC OFF';
  micToggle.classList.remove('on');
  micToggle.classList.add('off');
}

micToggle.addEventListener('click', () => {
  if (micPassthroughActive) {
    stopMicPassthrough();
  } else {
    startMicPassthrough();
  }
});

// --- Mic Monitor (hear yourself) ---

const micMonitorBtn = document.getElementById('mic-monitor');
let micMonitorAudio = null;
let micMonitorContext = null;
let micMonitorActive = false;

// We store a reference to the last effect chain output so monitor can tap it
let micLastNode = null;

micMonitorBtn.addEventListener('click', () => {
  if (micMonitorActive) {
    stopMicMonitor();
  } else {
    startMicMonitor();
  }
});

function startMicMonitor() {
  if (!micPassthroughActive || !micAudioContext || !micLastNode) {
    showToast('Turn on the mic first', 'warning');
    return;
  }
  if (monitorDeviceId === 'none') {
    showToast('Select a Monitor (You) device first', 'warning');
    return;
  }

  try {
    // Create a bridge from the processing context to a monitor-device context
    const bridge = micAudioContext.createMediaStreamDestination();
    micLastNode.connect(bridge);

    if (typeof AudioContext.prototype.setSinkId === 'function') {
      micMonitorContext = new AudioContext({ latencyHint: 'interactive' });
      micMonitorContext.setSinkId(monitorDeviceId).then(() => {
        if (micMonitorContext.state === 'suspended') micMonitorContext.resume();
        const src = micMonitorContext.createMediaStreamSource(bridge.stream);
        src.connect(micMonitorContext.destination);
      });
    } else {
      micMonitorAudio = new Audio();
      micMonitorAudio.srcObject = bridge.stream;
      if (micMonitorAudio.setSinkId) {
        micMonitorAudio.setSinkId(monitorDeviceId);
      }
      micMonitorAudio.play();
    }

    micMonitorActive = true;
    micMonitorBtn.classList.add('active');
    micMonitorBtn.textContent = 'Monitoring';
  } catch (e) {
    console.error('Mic monitor failed:', e);
  }
}

function stopMicMonitor() {
  if (micMonitorAudio) {
    micMonitorAudio.pause();
    micMonitorAudio.srcObject = null;
    micMonitorAudio = null;
  }
  if (micMonitorContext) {
    micMonitorContext.close().catch(() => {});
    micMonitorContext = null;
  }
  micMonitorActive = false;
  micMonitorBtn.classList.remove('active');
  micMonitorBtn.textContent = 'Monitor';
}

// --- TTS (ElevenLabs) ---

const ttsApiKey = document.getElementById('tts-apikey');
const ttsVoice = document.getElementById('tts-voice');
const ttsText = document.getElementById('tts-text');
const ttsSpeak = document.getElementById('tts-speak');
const ttsStability = document.getElementById('tts-stability');
const ttsSimilarity = document.getElementById('tts-similarity');
const ttsStyle = document.getElementById('tts-style');
const ttsSpeed = document.getElementById('tts-speed');
const ttsBoost = document.getElementById('tts-boost');
const ttsPreview = document.getElementById('tts-preview');
const ttsModel = document.getElementById('tts-model');
const ttsUsage = document.getElementById('tts-usage');

// Value display elements
const ttsStabilityVal = document.getElementById('tts-stability-val');
const ttsSimilarityVal = document.getElementById('tts-similarity-val');
const ttsStyleVal = document.getElementById('tts-style-val');
const ttsSpeedVal = document.getElementById('tts-speed-val');

// Voice preview URLs keyed by voice ID
const voicePreviewUrls = new Map();
let previewAudio = null;

// Slider value display updaters
ttsStability.addEventListener('input', () => {
  ttsStabilityVal.textContent = (parseInt(ttsStability.value) / 100).toFixed(2);
});
ttsSimilarity.addEventListener('input', () => {
  ttsSimilarityVal.textContent = (parseInt(ttsSimilarity.value) / 100).toFixed(2);
});
ttsStyle.addEventListener('input', () => {
  ttsStyleVal.textContent = (parseInt(ttsStyle.value) / 100).toFixed(2);
});
ttsSpeed.addEventListener('input', () => {
  ttsSpeedVal.textContent = (parseInt(ttsSpeed.value) / 100).toFixed(1) + 'x';
});

// Restore saved API key
const savedApiKey = localStorage.getItem('soundboard-elevenlabs-key');
if (savedApiKey) {
  ttsApiKey.value = savedApiKey;
  loadTTSVoices(savedApiKey);
  fetchUsage(savedApiKey);
}

// Restore saved TTS settings
const savedModel = localStorage.getItem('soundboard-tts-model');
if (savedModel) ttsModel.value = savedModel;

const savedStability = localStorage.getItem('soundboard-tts-stability');
if (savedStability !== null) { ttsStability.value = savedStability; ttsStability.dispatchEvent(new Event('input')); }

const savedSimilarity = localStorage.getItem('soundboard-tts-similarity');
if (savedSimilarity !== null) { ttsSimilarity.value = savedSimilarity; ttsSimilarity.dispatchEvent(new Event('input')); }

const savedStyle = localStorage.getItem('soundboard-tts-style');
if (savedStyle !== null) { ttsStyle.value = savedStyle; ttsStyle.dispatchEvent(new Event('input')); }

const savedSpeed = localStorage.getItem('soundboard-tts-speed');
if (savedSpeed !== null) { ttsSpeed.value = savedSpeed; ttsSpeed.dispatchEvent(new Event('input')); }

const savedBoost = localStorage.getItem('soundboard-tts-boost');
if (savedBoost !== null) ttsBoost.checked = savedBoost === 'true';

ttsModel.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-model', ttsModel.value);
});
ttsStability.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-stability', ttsStability.value);
});
ttsSimilarity.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-similarity', ttsSimilarity.value);
});
ttsStyle.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-style', ttsStyle.value);
});
ttsSpeed.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-speed', ttsSpeed.value);
});
ttsBoost.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-boost', ttsBoost.checked);
});

ttsApiKey.addEventListener('change', () => {
  const key = ttsApiKey.value.trim();
  localStorage.setItem('soundboard-elevenlabs-key', key);
  if (key) {
    loadTTSVoices(key);
    fetchUsage(key);
  }
});

async function loadTTSVoices(apiKey) {
  if (!apiKey) return;
  try {
    const res = await fetch('/api/tts/voices', {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('Failed to load voices:', err.error);
      ttsVoice.innerHTML = '<option value="">Invalid API key</option>';
      return;
    }
    const voices = await res.json();

    // Sort: premade first, then custom, then by name
    const categoryOrder = { premade: 0, professional: 1, cloned: 2, generated: 3 };
    voices.sort((a, b) => {
      const ao = categoryOrder[a.category] ?? 5;
      const bo = categoryOrder[b.category] ?? 5;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });

    voicePreviewUrls.clear();
    ttsVoice.innerHTML = '';
    voices.forEach(v => {
      const option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.name;
      ttsVoice.appendChild(option);
      if (v.previewUrl) {
        voicePreviewUrls.set(v.id, v.previewUrl);
      }
    });

    const savedVoiceTTS = localStorage.getItem('soundboard-tts-voice');
    if (savedVoiceTTS && voices.some(v => v.id === savedVoiceTTS)) {
      ttsVoice.value = savedVoiceTTS;
    }
  } catch (e) {
    console.error('Failed to load TTS voices:', e);
  }
}

// --- Voice Preview ---

ttsPreview.addEventListener('click', () => {
  const voiceId = ttsVoice.value;
  if (!voiceId) return;
  const url = voicePreviewUrls.get(voiceId);
  if (!url) {
    showToast('No preview available for this voice', 'warning');
    return;
  }

  // Stop any existing preview
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }

  const audio = new Audio(url);
  audio.volume = parseFloat(volumeSlider.value);

  // Play through monitor device (your speakers) so you hear it locally
  if (monitorDeviceId !== 'none' && audio.setSinkId) {
    audio.setSinkId(monitorDeviceId).catch(() => {});
  }

  audio.addEventListener('ended', () => {
    previewAudio = null;
    ttsPreview.textContent = '\u25B6';
  });

  ttsPreview.textContent = '\u25A0';
  audio.play().catch(() => {
    ttsPreview.textContent = '\u25B6';
  });
  previewAudio = audio;
});

// --- Usage Tracking ---

async function fetchUsage(apiKey) {
  if (!apiKey) apiKey = ttsApiKey.value.trim();
  if (!apiKey) return;

  try {
    const res = await fetch('/api/tts/usage', {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) return;

    const data = await res.json();
    const used = data.character_count;
    const limit = data.character_limit;
    const pct = limit > 0 ? (used / limit) * 100 : 0;

    ttsUsage.style.display = 'flex';
    ttsUsage.querySelector('.tts-usage-text').textContent =
      `${used.toLocaleString()} / ${limit.toLocaleString()} chars (${data.tier})`;

    const fill = ttsUsage.querySelector('.tts-usage-fill');
    fill.style.width = Math.min(pct, 100) + '%';
    fill.className = 'tts-usage-fill';
    if (pct > 90) fill.classList.add('red');
    else if (pct > 75) fill.classList.add('yellow');
    else fill.classList.add('green');
  } catch (e) {
    console.error('Failed to fetch usage:', e);
  }
}

ttsVoice.addEventListener('change', () => {
  localStorage.setItem('soundboard-tts-voice', ttsVoice.value);
});

async function speakTTS() {
  const text = ttsText.value.trim();
  const apiKey = ttsApiKey.value.trim();
  if (!text) return;
  if (!apiKey) {
    showToast('Enter your ElevenLabs API key first', 'warning');
    ttsApiKey.focus();
    return;
  }

  ttsSpeak.disabled = true;
  ttsSpeak.innerHTML = '<span class="spinner"></span>Generating...';

  try {
    const res = await fetch('/api/tts/speak', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        voice: ttsVoice.value,
        model: ttsModel.value,
        stability: parseInt(ttsStability.value) / 100,
        similarity: parseInt(ttsSimilarity.value) / 100,
        style: parseInt(ttsStyle.value) / 100,
        speed: parseInt(ttsSpeed.value) / 100,
        use_speaker_boost: ttsBoost.checked,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      showToast('TTS failed: ' + (err.error || err.detail?.message || 'Unknown error'), 'error');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const volume = parseFloat(volumeSlider.value);

    // Play to Discord (virtual cable)
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    clearPlayingState();
    const audio = new Audio(url);
    audio.volume = volume;
    if (audio.setSinkId && selectedDeviceId !== 'default') {
      await audio.setSinkId(selectedDeviceId);
    }
    audio.addEventListener('ended', () => { currentAudio = null; });
    audio.play();
    currentAudio = audio;

    // Play to monitor (your speakers)
    if (monitorDeviceId !== 'none') {
      if (currentMonitor) {
        currentMonitor.pause();
        currentMonitor.currentTime = 0;
      }
      const monitor = new Audio(url);
      monitor.volume = volume;
      if (monitor.setSinkId) {
        await monitor.setSinkId(monitorDeviceId);
      }
      monitor.addEventListener('ended', () => { currentMonitor = null; });
      monitor.play();
      currentMonitor = monitor;
    }
    // Update usage after successful generation
    fetchUsage();
  } catch (e) {
    showToast('TTS failed: ' + e.message, 'error');
  } finally {
    ttsSpeak.disabled = false;
    ttsSpeak.textContent = 'Speak';
  }
}

ttsSpeak.addEventListener('click', speakTTS);

ttsText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    speakTTS();
  }
});

// --- Sound playback ---

function clearPlayingState() {
  document.querySelectorAll('.sound-btn.playing').forEach(el => el.classList.remove('playing'));
}

async function playSound(filename) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  if (currentMonitor) {
    currentMonitor.pause();
    currentMonitor.currentTime = 0;
  }
  clearPlayingState();

  const url = `/sounds/${encodeURIComponent(filename)}`;
  const volume = parseFloat(volumeSlider.value);
  const btn = document.querySelector(`[data-sound="${CSS.escape(filename)}"]`);

  // Pre-load the audio to avoid streaming issues with virtual cables
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = url;
  audio.volume = volume;

  // MUST await setSinkId before playing — virtual cables break if audio
  // starts on the wrong device and gets rerouted mid-stream
  if (audio.setSinkId && selectedDeviceId !== 'default') {
    try {
      await audio.setSinkId(selectedDeviceId);
    } catch (err) {
      console.warn('Could not set output device:', err);
    }
  }

  if (btn) btn.classList.add('playing');

  audio.addEventListener('ended', () => {
    if (btn) btn.classList.remove('playing');
    if (currentAudio === audio) currentAudio = null;
  });

  try {
    await audio.play();
  } catch (err) {
    console.error('Playback failed:', err);
    if (btn) btn.classList.remove('playing');
  }

  currentAudio = audio;

  if (monitorDeviceId !== 'none') {
    const monitor = new Audio();
    monitor.preload = 'auto';
    monitor.src = url;
    monitor.volume = volume;

    if (monitor.setSinkId) {
      try {
        await monitor.setSinkId(monitorDeviceId);
      } catch (err) {
        console.warn('Could not set monitor device:', err);
      }
    }

    monitor.addEventListener('ended', () => {
      if (currentMonitor === monitor) currentMonitor = null;
    });

    try {
      await monitor.play();
    } catch (err) {
      console.error('Monitor playback failed:', err);
    }

    currentMonitor = monitor;
  }
}

// --- Sound list ---

const categoryBar = document.getElementById('category-bar');
let soundCategories = null;
let soundTags = null;
let allSoundFiles = [];
let activeCategory = 'All';
let searchQuery = '';

const soundSearch = document.getElementById('sound-search');

soundSearch.addEventListener('input', () => {
  searchQuery = soundSearch.value.trim().toLowerCase();
  renderSounds();
});

function matchesSearch(filename) {
  if (!searchQuery) return true;
  const terms = searchQuery.split(/\s+/);
  const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').toLowerCase();
  const tags = soundTags && soundTags[filename] ? soundTags[filename].join(' ').toLowerCase() : '';
  // Also include the category name as searchable
  let catName = '';
  if (soundCategories) {
    for (const [cat, files] of Object.entries(soundCategories)) {
      if (files.includes(filename)) { catName = cat.toLowerCase(); break; }
    }
  }
  const searchable = name + ' ' + tags + ' ' + catName;
  return terms.every(term => searchable.includes(term));
}

function createSoundBtn(filename, index) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sound-btn';
  btn.dataset.sound = filename;

  const displayName = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  btn.setAttribute('aria-label', `Play ${displayName}`);

  // Stagger fade-in animation
  if (typeof index === 'number') {
    btn.style.animationDelay = Math.min(index * 30, 600) + 'ms';
  }

  btn.innerHTML = `
    <span class="name">${escapeHtml(displayName)}</span>
    <button class="delete-btn" type="button" title="Delete" aria-label="Delete ${escapeHtml(displayName)}">&times;</button>
  `;

  btn.addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-btn')) return;
    playSound(filename);
  });

  btn.querySelector('.delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const confirmed = await showConfirm(`Delete "${displayName}"?`, { danger: true, confirmText: 'Delete' });
    if (!confirmed) return;
    await fetch(`/api/sounds/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    showToast(`"${displayName}" deleted`, 'success');
    loadSounds();
  });

  return btn;
}

function renderSounds() {
  soundGrid.innerHTML = '';

  let idx = 0;

  // If searching, show flat filtered results (ignore categories)
  if (searchQuery) {
    const matches = allSoundFiles.filter(matchesSearch);
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = `No sounds matching "${soundSearch.value.trim()}"`;
      soundGrid.appendChild(empty);
    } else {
      matches.forEach(f => soundGrid.appendChild(createSoundBtn(f, idx++)));
    }
    return;
  }

  if (!soundCategories || activeCategory === 'All') {
    // Grouped view when "All" is selected and categories exist
    if (soundCategories && activeCategory === 'All') {
      const categorized = new Set();
      for (const [cat, files] of Object.entries(soundCategories)) {
        const catFiles = files.filter(f => allSoundFiles.includes(f));
        if (catFiles.length === 0) continue;
        catFiles.forEach(f => categorized.add(f));

        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = cat;
        soundGrid.appendChild(header);

        catFiles.forEach(f => soundGrid.appendChild(createSoundBtn(f, idx++)));
      }
      // Uncategorized
      const uncategorized = allSoundFiles.filter(f => !categorized.has(f));
      if (uncategorized.length > 0) {
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = 'Uncategorized';
        soundGrid.appendChild(header);
        uncategorized.forEach(f => soundGrid.appendChild(createSoundBtn(f, idx++)));
      }
    } else {
      allSoundFiles.forEach(f => soundGrid.appendChild(createSoundBtn(f, idx++)));
    }
  } else {
    // Single category filter
    const catFiles = (soundCategories[activeCategory] || []).filter(f => allSoundFiles.includes(f));
    catFiles.forEach(f => soundGrid.appendChild(createSoundBtn(f, idx++)));
  }
}

function renderCategoryBar() {
  categoryBar.innerHTML = '';
  if (!soundCategories) return;

  const cats = ['All', ...Object.keys(soundCategories)];
  cats.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = 'category-tab' + (cat === activeCategory ? ' active' : '');
    tab.textContent = cat;
    tab.addEventListener('click', () => {
      activeCategory = cat;
      renderCategoryBar();
      renderSounds();
    });
    categoryBar.appendChild(tab);
  });
}

async function loadSounds() {
  // Show skeleton loading cards
  soundGrid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const skel = document.createElement('div');
    skel.className = 'skeleton-card';
    soundGrid.appendChild(skel);
  }

  const res = await fetch('/api/sounds');
  const data = await res.json();

  allSoundFiles = data.files || data;
  soundCategories = data.categories || null;
  soundTags = data.tags || null;

  renderCategoryBar();
  renderSounds();
}

// --- File upload ---

async function uploadFiles(files) {
  const total = files.length;
  const uploadText = uploadArea.querySelector('p');
  const originalText = uploadText.textContent;
  uploadArea.classList.add('uploading');
  let successCount = 0;

  for (let i = 0; i < total; i++) {
    uploadText.textContent = `Uploading ${i + 1} / ${total}...`;
    const formData = new FormData();
    formData.append('sound', files[i]);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        showToast(`Upload failed: ${err.error}`, 'error');
      } else {
        successCount++;
      }
    } catch (e) {
      showToast(`Upload failed: ${e.message}`, 'error');
    }
  }

  uploadArea.classList.remove('uploading');
  uploadText.textContent = originalText;
  if (successCount > 0) {
    showToast(`${successCount} sound${successCount > 1 ? 's' : ''} uploaded`, 'success');
  }
  loadSounds();
}

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    uploadFiles(fileInput.files);
    fileInput.value = '';
  }
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    uploadFiles(e.dataTransfer.files);
  }
});

// --- Sound Effects ---

const sfxText = document.getElementById('sfx-text');
const sfxGenerate = document.getElementById('sfx-generate');
const sfxDuration = document.getElementById('sfx-duration');
const sfxInfluence = document.getElementById('sfx-influence');
const sfxDurationVal = document.getElementById('sfx-duration-val');
const sfxInfluenceVal = document.getElementById('sfx-influence-val');
const sfxResult = document.getElementById('sfx-result');
const sfxAudio = document.getElementById('sfx-audio');
const sfxSave = document.getElementById('sfx-save');

let lastSfxBlob = null;

sfxDuration.addEventListener('input', () => {
  sfxDurationVal.textContent = sfxDuration.value + 's';
});

sfxInfluence.addEventListener('input', () => {
  sfxInfluenceVal.textContent = sfxInfluence.value;
});

sfxGenerate.addEventListener('click', async () => {
  const text = sfxText.value.trim();
  const apiKey = ttsApiKey.value.trim();
  if (!text) return;
  if (!apiKey) {
    showToast('Enter your ElevenLabs API key first', 'warning');
    ttsApiKey.focus();
    return;
  }

  sfxGenerate.disabled = true;
  sfxGenerate.innerHTML = '<span class="spinner"></span>Generating...';

  try {
    const res = await fetch('/api/tts/sound-effect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        duration_seconds: parseFloat(sfxDuration.value),
        prompt_influence: parseFloat(sfxInfluence.value),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      showToast('Sound effect failed: ' + (err.error || 'Unknown error'), 'error');
      return;
    }

    const blob = await res.blob();
    lastSfxBlob = blob;
    const url = URL.createObjectURL(blob);
    const volume = parseFloat(volumeSlider.value);

    // Show audio player
    sfxAudio.src = url;
    sfxResult.style.display = 'flex';

    // Play to Discord output
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    const audio = new Audio(url);
    audio.volume = volume;
    if (audio.setSinkId && selectedDeviceId !== 'default') {
      await audio.setSinkId(selectedDeviceId);
    }
    audio.addEventListener('ended', () => { currentAudio = null; });
    audio.play();
    currentAudio = audio;

    // Play to monitor
    if (monitorDeviceId !== 'none') {
      if (currentMonitor) {
        currentMonitor.pause();
        currentMonitor.currentTime = 0;
      }
      const monitor = new Audio(url);
      monitor.volume = volume;
      if (monitor.setSinkId) {
        await monitor.setSinkId(monitorDeviceId);
      }
      monitor.addEventListener('ended', () => { currentMonitor = null; });
      monitor.play();
      currentMonitor = monitor;
    }

    fetchUsage();
  } catch (e) {
    showToast('Sound effect failed: ' + e.message, 'error');
  } finally {
    sfxGenerate.disabled = false;
    sfxGenerate.textContent = 'Generate';
  }
});

sfxSave.addEventListener('click', async () => {
  if (!lastSfxBlob) return;

  const name = await showPrompt('Name for this sound:', sfxText.value.trim().substring(0, 40));
  if (!name) return;

  const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/ /g, '_') + '.mp3';
  const file = new File([lastSfxBlob], safeName, { type: 'audio/mpeg' });
  const formData = new FormData();
  formData.append('sound', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      showToast('Save failed: ' + err.error, 'error');
      return;
    }
    showToast(`"${name}" saved to soundboard`, 'success');
    loadSounds();
    sfxSave.textContent = 'Saved!';
    setTimeout(() => { sfxSave.textContent = 'Save to Soundboard'; }, 2000);
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
});

// --- Stop Sound ---

document.getElementById('stop-sound').addEventListener('click', () => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (currentMonitor) {
    currentMonitor.pause();
    currentMonitor.currentTime = 0;
    currentMonitor = null;
  }
  clearPlayingState();
});

// --- Collapsible Panels ---

document.querySelectorAll('.collapsible-header').forEach(header => {
  const panel = header.closest('.collapsible-panel');
  const panelId = panel.id;
  const savedState = localStorage.getItem(`soundboard-collapsed-${panelId}`);
  if (savedState === 'true') {
    panel.classList.add('collapsed');
    header.setAttribute('aria-expanded', 'false');
  }

  header.addEventListener('click', () => {
    const isCollapsed = panel.classList.toggle('collapsed');
    header.setAttribute('aria-expanded', !isCollapsed);
    localStorage.setItem(`soundboard-collapsed-${panelId}`, isCollapsed);
  });
});

// --- Setup Guide ---

const helpToggle = document.getElementById('help-toggle');
const setupGuide = document.getElementById('setup-guide');
const guideDismiss = document.getElementById('guide-dismiss');

// Show guide on first visit
const guideShown = localStorage.getItem('soundboard-guide-dismissed');
if (!guideShown) {
  setupGuide.hidden = false;
}

helpToggle.addEventListener('click', () => {
  setupGuide.hidden = !setupGuide.hidden;
});

guideDismiss.addEventListener('click', () => {
  setupGuide.hidden = true;
  localStorage.setItem('soundboard-guide-dismissed', 'true');
});

// --- TTS Defaults ---

document.getElementById('tts-defaults').addEventListener('click', () => {
  ttsStability.value = 50;
  ttsSimilarity.value = 75;
  ttsStyle.value = 0;
  ttsSpeed.value = 100;
  ttsBoost.checked = false;
  ttsModel.value = 'eleven_multilingual_v2';

  // Fire input events to update displays
  ttsStability.dispatchEvent(new Event('input'));
  ttsSimilarity.dispatchEvent(new Event('input'));
  ttsStyle.dispatchEvent(new Event('input'));
  ttsSpeed.dispatchEvent(new Event('input'));

  // Save to localStorage
  localStorage.setItem('soundboard-tts-stability', '50');
  localStorage.setItem('soundboard-tts-similarity', '75');
  localStorage.setItem('soundboard-tts-style', '0');
  localStorage.setItem('soundboard-tts-speed', '100');
  localStorage.setItem('soundboard-tts-boost', 'false');
  localStorage.setItem('soundboard-tts-model', 'eleven_multilingual_v2');

  showToast('TTS settings reset to defaults', 'info', 2000);
});

// --- SFX Defaults ---

document.getElementById('sfx-defaults').addEventListener('click', () => {
  sfxDuration.value = 5;
  sfxInfluence.value = 0.3;

  sfxDuration.dispatchEvent(new Event('input'));
  sfxInfluence.dispatchEvent(new Event('input'));

  showToast('SFX settings reset to defaults', 'info', 2000);
});

// --- Init ---

loadDevices().then(() => {
  // Auto-start mic passthrough
  startMicPassthrough();
});
loadSounds();
