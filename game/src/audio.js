// audio.js — all sound is synthesized with WebAudio (audio-design skill).
// Buses: Master <- Music, SFX, Ambience. Sliders map to gain squared; music
// ducks under dialogue. No audio files, no network. Safe to call before any
// user gesture: the context resumes on the first gesture instead.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this._engineOsc = null; this._engineGain = null;
    this._sirenOsc = null; this._sirenGain = null; this._sirenTimer = 0;
    this._musicTimer = null;
    this._step = 0;
    this._noiseBuf = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.42;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.ambBus = this.ctx.createGain(); this.ambBus.gain.value = 0.16;
      this.ambBus.connect(this.master);
      // Shared white-noise buffer for shots, crashes and surf.
      const len = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startAmbience();
      this.startMusic();
    } catch (e) { this.ctx = null; return false; }
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  // Music ducks -12 dB under dialogue, then comes back (ducking, not muting).
  duckMusic(on) {
    if (!this.musicBus || !this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.10 : 0.42, this.ctx.currentTime, 0.25);
  }

  _tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.2, vol = 0.3, bus = null, when = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(bus || this.sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.2, vol = 0.3, freq = 1200, q = 1, when = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // ---- Game SFX (game-feel feedback bundles: sound + particles + shake) ----
  blip(freq = 880) { this._tone({ freq, dur: 0.09, vol: 0.25, type: 'triangle' }); }
  pickup() { this._tone({ freq: 660, freqEnd: 990, dur: 0.14, vol: 0.3, type: 'triangle' }); this._tone({ freq: 990, dur: 0.1, vol: 0.2, type: 'triangle', when: 0.07 }); }
  shoot() { this._noise({ dur: 0.12, vol: 0.5, freq: 1800, q: 0.7 }); this._tone({ freq: 220, freqEnd: 60, dur: 0.1, vol: 0.35, type: 'square' }); }
  punch() { this._noise({ dur: 0.08, vol: 0.35, freq: 500, q: 1.5 }); }
  crash() { this._noise({ dur: 0.35, vol: 0.5, freq: 300, q: 0.8 }); this._tone({ freq: 90, freqEnd: 40, dur: 0.3, vol: 0.4, type: 'sine' }); }
  explosion() {
    this._noise({ dur: 0.9, vol: 0.7, freq: 180, q: 0.6 });
    this._tone({ freq: 120, freqEnd: 28, dur: 0.8, vol: 0.6, type: 'sine' });
  }
  missionGood() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone({ freq: f, dur: 0.22, vol: 0.28, type: 'triangle', when: i * 0.09 }));
  }
  missionFail() { [392, 330, 262].forEach((f, i) => this._tone({ freq: f, dur: 0.25, vol: 0.25, type: 'sawtooth', when: i * 0.12 })); }
  wantedUp() { this._tone({ freq: 440, freqEnd: 880, dur: 0.3, vol: 0.3, type: 'sawtooth' }); }
  phone() { this._tone({ freq: 1200, dur: 0.08, vol: 0.25 }); this._tone({ freq: 1200, dur: 0.08, vol: 0.25, when: 0.14 }); }

  // ---- Continuous: engine hum follows speed; siren wails while wanted. ----
  setEngine(speed01, on) {
    if (!this.ctx) return;
    if (on && !this._engineOsc) {
      this._engineOsc = this.ctx.createOscillator();
      this._engineOsc.type = 'sawtooth';
      this._engineGain = this.ctx.createGain();
      this._engineGain.gain.value = 0;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 700;
      this._engineOsc.connect(f); f.connect(this._engineGain); this._engineGain.connect(this.sfxBus);
      this._engineOsc.start();
    }
    if (this._engineOsc) {
      const t = this.ctx.currentTime;
      this._engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, t, 0.08);
      this._engineGain.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.05 : 0, t, 0.1);
    }
  }

  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this._sirenOsc) {
      this._sirenOsc = this.ctx.createOscillator();
      this._sirenOsc.type = 'triangle';
      this._sirenGain = this.ctx.createGain();
      this._sirenGain.gain.value = 0.05;
      this._sirenOsc.connect(this._sirenGain); this._sirenGain.connect(this.sfxBus);
      this._sirenOsc.start();
      this._sirenTimer = 0;
    } else if (!on && this._sirenOsc) {
      try { this._sirenOsc.stop(); } catch (e) {}
      this._sirenOsc = null;
    }
  }

  update(dt) {
    if (this._sirenOsc && this.ctx) {
      this._sirenTimer += dt;
      // Two-tone wail: 660 <-> 880 Hz, one full cycle per 0.9 s.
      const phase = (this._sirenTimer % 0.9) / 0.9;
      this._sirenOsc.frequency.value = phase < 0.5 ? 660 : 880;
    }
  }

  // ---- Ambience: soft surf loop near the marina, city hum elsewhere. ----
  startAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(f); f.connect(g); g.connect(this.ambBus);
    src.start();
  }

  // ---- Music: a laid-back synthwave loop, 100 BPM, bass + hats + pad. ----
  startMusic() {
    // A-minor groove: bass line + offbeat hats, scheduled a bar ahead.
    const bassNotes = [55, 55, 65.41, 49, 55, 55, 82.41, 73.42];
    const stepDur = 60 / 100 / 2; // eighth notes at 100 BPM
    const scheduleBar = () => {
      if (!this.ctx || !this.musicOn) return;
      const now = this.ctx.currentTime + 0.05;
      for (let i = 0; i < 8; i++) {
        const t = now + i * stepDur;
        const o = this.ctx.createOscillator();
        o.type = 'triangle'; o.frequency.value = bassNotes[(this._step + i) % 8];
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.95);
        o.connect(g); g.connect(this.musicBus);
        o.start(t); o.stop(t + stepDur);
        // Hat on the offbeat.
        if (i % 2 === 1) {
          const n = this.ctx.createBufferSource();
          n.buffer = this._noiseBuf;
          const hf = this.ctx.createBiquadFilter();
          hf.type = 'highpass'; hf.frequency.value = 6000;
          const hg = this.ctx.createGain();
          hg.gain.setValueAtTime(0.12, t);
          hg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
          n.connect(hf); hf.connect(hg); hg.connect(this.musicBus);
          n.start(t); n.stop(t + 0.06);
        }
      }
      this._step += 8;
      this._musicTimer = setTimeout(scheduleBar, stepDur * 8 * 1000 - 60);
    };
    scheduleBar();
  }
}
