/** AI audio generation client (task 8.x): prompt → audio clip → deck/track. Proxy first, offline synth fallback. */
import { encodeWav } from '../../dsp/codec/wav';
import { proxyUrl } from './ai-analysis';

export interface GenerateOptions {
  readonly prompt: string;
  /** Seconds of audio. */
  readonly seconds: number;
  readonly sampleRate?: number;
  /** 'pad': offline synth. Lyria models: via proxy /interactions (needs GEMINI_API_KEY). */
  readonly model?: 'pad' | LyriaModel;
}

export function generateFileName(prompt: string): string {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ai-clip';
  return `${slug}.wav`;
}

/** Recent Google music models (Interactions API). Realtime streaming stays on lyria-realtime-exp. */
export const LYRIA_MODELS = ['lyria-3.5', 'lyria-3-clip-preview'] as const;
export type LyriaModel = (typeof LYRIA_MODELS)[number];

export function isLyriaModel(m: string): m is LyriaModel {
  return (LYRIA_MODELS as readonly string[]).includes(m);
}

export interface InteractionsResult {
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly lyrics: string;
}

/** Extracts audio + lyrics from an /interactions response. Null when unusable. */
export function parseInteractions(data: unknown): InteractionsResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.audioBase64 !== 'string' || !d.audioBase64) return null;
  return {
    audioBase64: d.audioBase64,
    mimeType: typeof d.mimeType === 'string' ? d.mimeType : 'audio/mp3',
    lyrics: typeof d.lyrics === 'string' ? d.lyrics : '',
  };
}

/** Full-song (3.5) or 30s clip generation via proxy /interactions. Null without proxy/key. */
export async function generateLyriaClip(prompt: string, model: LyriaModel): Promise<{ file: File; lyrics: string } | null> {
  const url = proxyUrl();
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/interactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model }),
    });
    if (!res.ok) return null;
    const parsed = parseInteractions(await res.json());
    if (!parsed) return null;
    const bin = atob(parsed.audioBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = parsed.mimeType.includes('wav') ? 'wav' : 'mp3';
    const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lyria';
    return { file: new File([bytes], `${slug}-${model}.${ext}`, { type: parsed.mimeType }), lyrics: parsed.lyrics };
  } catch { return null; }
}

async function viaProxy(prompt: string, seconds: number): Promise<File | null> {
  const url = proxyUrl();
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, seconds }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { wavBase64?: string; name?: string };
    if (!data.wavBase64) return null;
    const bin = atob(data.wavBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], data.name || generateFileName(prompt), { type: 'audio/wav' });
  } catch { return null; }
}

/** Deterministic offline pad synth (fallback when no proxy): chord from prompt hash. */
export function synthPad(prompt: string, seconds: number, sampleRate = 22050): Float32Array[] {
  let h = 0x811c9dc5;
  for (const ch of prompt) { h ^= ch.codePointAt(0) ?? 0; h = Math.imul(h, 0x01000193); }
  const root = 110 * Math.pow(2, ((h >>> 0) % 12) / 12);
  const notes = [1, 1.25, 1.5, 2].map(r => root * r);
  const n = Math.max(1, Math.floor(seconds * sampleRate));
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.5) * Math.min(1, (n - i) / sampleRate / 0.8);
    let s = 0;
    notes.forEach((f, k) => { s += Math.sin(2 * Math.PI * f * t + k) / notes.length; });
    // gentle pulse at ~2Hz for movement
    s *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 2 * t);
    left[i] = s * env * 0.5;
    right[i] = s * env * 0.5;
  }
  return [left, right];
}

/** Generates an audio clip File from a prompt (task 8.1). */
export async function generateClip(opts: GenerateOptions): Promise<{ file: File; lyrics?: string }> {
  if (opts.model && isLyriaModel(opts.model)) {
    const lyria = await generateLyriaClip(opts.prompt, opts.model);
    if (lyria) return lyria;
    // fall through to pad when proxy/key is missing
  }
  const seconds = Math.min(60, Math.max(1, opts.seconds));
  const remote = await viaProxy(opts.prompt, seconds);
  if (remote) return { file: remote };
  const sr = opts.sampleRate ?? 22050;
  const channels = synthPad(opts.prompt, seconds, sr);
  const wav = encodeWav(channels, sr, 16);
  return { file: new File([wav], generateFileName(opts.prompt), { type: 'audio/wav' }) };
}
