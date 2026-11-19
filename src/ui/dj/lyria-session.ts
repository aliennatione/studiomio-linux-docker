/** Lyria Realtime client (pattern zip remix-promptdj): weighted prompts + chunk scheduling + capture. Talks to scripts/lyria-relay.mjs over WebSocket. */

export interface WeightedPrompt {
  readonly text: string;
  readonly weight: number;
}

export interface LyriaConfig {
  bpm?: number;
  density?: number;
  brightness?: number;
  temperature?: number;
  guidance?: number;
  seed?: number;
}

export const LYRIA_KEY = 'dj-lyria-url';
export const DEFAULT_LYRIA_URL = 'ws://localhost:8091';

export function lyriaUrl(): string {
  try { return localStorage.getItem(LYRIA_KEY) || DEFAULT_LYRIA_URL; } catch { return DEFAULT_LYRIA_URL; }
}

export function setLyriaUrl(url: string): void {
  try { if (url) localStorage.setItem(LYRIA_KEY, url); else localStorage.removeItem(LYRIA_KEY); } catch { /* ignore */ }
}

/** Keeps prompts valid for the model: non-empty text, weight clamped 0..1, weight 0 excluded. */
export function normalizePrompts(prompts: readonly WeightedPrompt[]): WeightedPrompt[] {
  return prompts
    .map(p => ({ text: p.text.trim(), weight: Math.min(1, Math.max(0, p.weight)) }))
    .filter(p => p.text.length > 0 && p.weight > 0);
}

/** Base64 → mono/stereo float channels (zip utils decode, 16-bit PCM interleaved). */
export function decodeChunk(base64: string, numChannels = 2): Float32Array[] {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const s16 = new Int16Array(bytes.buffer);
  const floats = new Float32Array(s16.length);
  for (let i = 0; i < s16.length; i++) floats[i] = s16[i] / 32768;
  const out: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    const ch = new Float32Array(Math.floor(floats.length / numChannels));
    for (let i = 0; i < ch.length; i++) ch[i] = floats[i * numChannels + c];
    out.push(ch);
  }
  return out;
}

export function channelsToBuffer(ctx: BaseAudioContext, channels: readonly Float32Array[], sampleRate: number): AudioBuffer {
  const buf = ctx.createBuffer(channels.length, channels[0]?.length ?? 0, sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}

export type LyriaPlayback = 'stopped' | 'playing' | 'paused' | 'loading';

export interface LyriaEvents {
  onChunk?(buffer: AudioBuffer): void;
  onState?(state: LyriaPlayback): void;
  onFiltered?(text: string, reason: string): void;
  onError?(message: string): void;
}

/** Live Lyria session with gapless scheduling (zip flow: nextStartTime + buffer). */
export class LyriaSession {
  private ws: WebSocket | null = null;
  private connected = false;
  private readonly pending: string[] = [];
  private readonly output: GainNode;
  private nextStartTime = 0;
  private readonly bufferTime = 2;
  state: LyriaPlayback = 'stopped';
  /** Recently decoded chunks (for capture into a deck). */
  readonly recent: AudioBuffer[] = [];

  constructor(private readonly ctx: BaseAudioContext, destination?: AudioNode, private readonly events: LyriaEvents = {}) {
    this.output = ctx.createGain();
    this.output.connect(destination ?? ctx.destination);
  }

  get sampleRate(): number { return 48000; }

  async connect(url: string = lyriaUrl(), model = 'models/lyria-realtime-exp'): Promise<void> {
    this.disconnect();
    const ws = new WebSocket(url);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'connect_music', model })); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === 'connected') { this.connected = true; for (const q of this.pending.splice(0)) ws.send(q); resolve(); }
          else if (msg.type === 'message') void this.handleServer(msg.data);
          else if (msg.type === 'error') { this.events.onError?.(msg.message || 'Lyria error'); if (!this.connected) reject(new Error(msg.message || 'Lyria error')); }
          else if (msg.type === 'close') { this.setState('stopped'); }
        } catch (e) { this.events.onError?.(e instanceof Error ? e.message : String(e)); }
      };
      ws.onerror = () => { if (!this.connected) reject(new Error('Lyria WebSocket error')); else this.events.onError?.('Lyria WebSocket error'); };
      ws.onclose = () => { this.connected = false; this.setState('stopped'); };
    });
  }

  private async handleServer(data: { setupComplete?: unknown; filteredPrompt?: { text?: string; filteredReason?: string }; serverContent?: { audioChunks?: Array<{ data?: string }> } }): Promise<void> {
    if (data.filteredPrompt) {
      this.events.onFiltered?.(data.filteredPrompt.text ?? '', data.filteredPrompt.filteredReason ?? '');
      return;
    }
    const chunk = data.serverContent?.audioChunks?.[0]?.data;
    if (!chunk || this.state === 'paused' || this.state === 'stopped') return;
    const buffer = channelsToBuffer(this.ctx, decodeChunk(chunk, 2), this.sampleRate);
    this.recent.push(buffer);
    if (this.recent.length > 64) this.recent.shift();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.output);
    if (this.nextStartTime === 0) {
      this.nextStartTime = this.ctx.currentTime + this.bufferTime;
      setTimeout(() => { if (this.state === 'playing' || this.state === 'loading') this.setState('playing'); }, this.bufferTime * 1000);
    }
    if (this.nextStartTime < this.ctx.currentTime) {
      this.setState('loading');
      this.nextStartTime = 0;
      return;
    }
    src.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.events.onChunk?.(buffer);
  }

  private send(payload: unknown): void {
    const text = JSON.stringify(payload);
    if (this.ws && this.connected) this.ws.send(text);
    else this.pending.push(text);
  }

  setPrompts(prompts: readonly WeightedPrompt[]): void {
    this.send({ type: 'setWeightedPrompts', params: { weightedPrompts: normalizePrompts(prompts) } });
  }

  setConfig(config: LyriaConfig): void {
    this.send({ type: 'setMusicGenerationConfig', params: config });
  }

  play(): void { this.setState('playing'); this.send({ type: 'play' }); }
  pause(): void { this.setState('paused'); this.send({ type: 'pause' }); }
  stop(): void { this.setState('stopped'); this.nextStartTime = 0; this.send({ type: 'stop' }); }

  private setState(s: LyriaPlayback): void {
    this.state = s;
    this.events.onState?.(s);
  }

  disconnect(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.connected = false;
    this.nextStartTime = 0;
  }

  /** Concatenates recent chunks into one buffer (up to `seconds`), for deck import. */
  capture(seconds: number): AudioBuffer | null {
    const target = Math.floor(seconds * this.sampleRate);
    const picked: AudioBuffer[] = [];
    let total = 0;
    for (let i = this.recent.length - 1; i >= 0 && total < target; i--) {
      picked.unshift(this.recent[i]);
      total += this.recent[i].length;
    }
    if (!picked.length) return null;
    const out = this.ctx.createBuffer(2, Math.min(total, target), this.sampleRate);
    let offset = 0;
    for (const b of picked) {
      const len = Math.min(b.length, out.length - offset);
      for (let c = 0; c < 2; c++) {
        const tmp = new Float32Array(len);
        b.copyFromChannel(tmp as Float32Array<ArrayBuffer>, c, 0);
        out.copyToChannel(tmp as Float32Array<ArrayBuffer>, c, offset);
      }
      offset += len;
      if (offset >= out.length) break;
    }
    return out;
  }
}
