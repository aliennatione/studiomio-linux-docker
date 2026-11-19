/** Simple 2-deck DJ audio engine for MVP (Web Audio). */
import { DEFAULT_AI_META, type AiMeta } from '../../model/ai-meta';

export interface DeckState {
  name: string;
  duration: number;
  position: number;
  playing: boolean;
  bpm: number;
  pitch: number; // playbackRate multiplier (1 = normal)
  loaded: boolean;
  aiMeta: AiMeta;
  hotCues: readonly (number | null)[];
  loop: { readonly start: number; readonly end: number; readonly enabled: boolean };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

class Deck {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startAt = 0; // context time when started
  private offset = 0; // seconds into buffer at start
  private _playing = false;
  name = '';
  bpm = 120;
  pitch = 1;
  aiMeta: AiMeta = DEFAULT_AI_META;
  private hotCues: (number | null)[] = [null, null, null, null];
  private loopStart = 0;
  private loopEnd = 0;
  private loopOn = false;
  private readonly trim: GainNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly bass: BiquadFilterNode;
  private readonly echoSend: GainNode;
  readonly gain: GainNode;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.trim = ctx.createGain();
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;
    // tone chain: source → lowpass (sweep) → lowshelf bass → trim → crossfade gain
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 320;
    this.lowpass.connect(this.bass);
    this.bass.connect(this.trim);
    this.trim.connect(this.gain);
    this.gain.connect(destination);
    // echo tail (echo-out style): trim → send → delay ⇄ feedback → out → crossfade gain
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.375;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.45;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.7;
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.trim.connect(this.echoSend);
    this.echoSend.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(echoOut);
    echoOut.connect(this.gain);
  }

  /** Bass shelf in dB (bass-swap style). */
  setBassDb(db: number): void {
    this.bass.gain.setTargetAtTime(Math.max(-30, Math.min(12, db)), this.ctx.currentTime, 0.05);
  }

  /** Lowpass cutoff in Hz (filter-sweep style). */
  setCutoff(hz: number): void {
    this.lowpass.frequency.setTargetAtTime(Math.max(60, Math.min(20000, hz)), this.ctx.currentTime, 0.05);
  }

  /** Echo send 0..1 (echo-out style). */
  setEchoSend(v: number): void {
    this.echoSend.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.05);
  }

  /** Restores flat tone after a styled transition. */
  resetFx(): void {
    const t = this.ctx.currentTime;
    this.bass.gain.setTargetAtTime(0, t, 0.05);
    this.lowpass.frequency.setTargetAtTime(20000, t, 0.05);
    this.echoSend.gain.setTargetAtTime(0, t, 0.05);
  }

  get loaded(): boolean { return !!this.buffer; }
  get playing(): boolean { return this._playing; }
  get duration(): number { return this.buffer?.duration ?? 0; }

  get position(): number {
    if (!this.buffer) return 0;
    if (!this._playing) return clamp(this.offset, 0, this.buffer.duration);
    const elapsed = (this.ctx.currentTime - this.startAt) * this.pitch;
    return clamp(this.offset + elapsed, 0, this.buffer.duration);
  }

  async loadFile(file: File): Promise<void> {
    this.stop();
    const data = await file.arrayBuffer();
    // decodeAudioData may detach buffer in some impls; slice to be safe
    this.buffer = await this.ctx.decodeAudioData(data.slice(0));
    this.name = file.name;
    this.offset = 0;
  }

  play(): void {
    if (!this.buffer || this._playing) return;
    if (this.offset >= this.buffer.duration - 0.01) this.offset = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.pitch;
    src.connect(this.lowpass);
    src.onended = () => { if (this.source === src) this._playing = false; };
    src.start(0, this.offset);
    this.source = src;
    this.startAt = this.ctx.currentTime;
    this._playing = true;
  }

  pause(): void {
    if (!this._playing || !this.source) return;
    this.offset = this.position;
    try { this.source.onended = null; this.source.stop(); } catch {}
    this.source.disconnect();
    this.source = null;
    this._playing = false;
  }

  cue(): void {
    const wasPlaying = this._playing;
    this.pause();
    this.offset = 0;
    if (wasPlaying) this.play();
  }

  seek(seconds: number): void {
    const wasPlaying = this._playing;
    this.pause();
    this.offset = clamp(seconds, 0, this.duration);
    if (wasPlaying) this.play();
  }

  setPitch(rate: number): void {
    this.pitch = clamp(rate, 0.5, 2);
    if (this._playing) {
      // keep position continuous when changing rate
      this.offset = this.position;
      this.startAt = this.ctx.currentTime;
      if (this.source) this.source.playbackRate.value = this.pitch;
    }
  }

  stop(): void {
    this.pause();
    this.offset = 0;
  }

  /** Hot cues (task 5.3): 4 slots per deck. */
  setHotCue(slot: number): void {
    if (slot < 0 || slot > 3 || !this.loaded) return;
    this.hotCues[slot] = this.position;
  }

  jumpHotCue(slot: number): void {
    const t = this.hotCues[slot];
    if (t === undefined || t === null) return;
    this.seek(t);
  }

  get cues(): readonly (number | null)[] { return this.hotCues; }

  /** Peak of the loaded buffer (channel max), for gain normalization (task 9.2). */
  peak(): number {
    if (!this.buffer) return 0;
    let peak = 0;
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const data = this.buffer.getChannelData(c);
      // sample every 16th value: fast and good enough for normalization
      for (let i = 0; i < data.length; i += 16) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
    }
    return peak;
  }

  /** Gain normalization to target peak (task 9.2). No-op without loaded audio. */
  normalize(target = 0.89): void {
    const peak = this.peak();
    if (peak <= 0) return;
    this.trim.gain.value = Math.min(4, Math.max(0.25, target / peak));
  }

  /** Simple loop (task 5.3): loops current 4-beat region at deck BPM. */
  toggleLoop(): void {
    if (!this.loaded) return;
    if (this.loopOn) { this.loopOn = false; return; }
    const beat = 60 / Math.max(40, this.bpm);
    this.loopStart = this.position;
    this.loopEnd = Math.min(this.duration, this.loopStart + beat * 4);
    this.loopOn = this.loopEnd > this.loopStart;
  }

  state(): DeckState {
    return {
      name: this.name,
      duration: this.duration,
      position: this.position,
      playing: this.playing,
      bpm: this.bpm,
      pitch: this.pitch,
      loaded: this.loaded,
      aiMeta: this.aiMeta,
      hotCues: [...this.hotCues],
      loop: { start: this.loopStart, end: this.loopEnd, enabled: this.loopOn },
    };
  }
}

export class DjEngine {
  readonly deckA: Deck;
  readonly deckB: Deck;
  private readonly master: GainNode;
  private _crossfader = 0.5; // 0 = A, 1 = B

  constructor(ctx: AudioContext, destination?: AudioNode) {
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(destination ?? ctx.destination);
    this.deckA = new Deck(ctx, this.master);
    this.deckB = new Deck(ctx, this.master);
    this.applyCrossfader();
  }

  get crossfader(): number { return this._crossfader; }

  setCrossfader(v: number): void {
    this._crossfader = clamp(v, 0, 1);
    this.applyCrossfader();
  }

  private applyCrossfader(): void {
    // equal-power crossfade
    const x = this._crossfader;
    this.deckA.gain.gain.value = Math.cos(x * 0.5 * Math.PI);
    this.deckB.gain.gain.value = Math.cos((1 - x) * 0.5 * Math.PI);
  }

  syncAToB(): void {
    if (this.deckA.bpm > 0 && this.deckB.bpm > 0) {
      this.deckA.setPitch(this.deckB.bpm / this.deckA.bpm);
    }
  }

  syncBToA(): void {
    if (this.deckA.bpm > 0 && this.deckB.bpm > 0) {
      this.deckB.setPitch(this.deckA.bpm / this.deckB.bpm);
    }
  }
}
