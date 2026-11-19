/** Track analysis pipeline: file → hash → cache → AI meta (task 3.3). Uses proxy when configured, else heuristics. */
import { DEFAULT_AI_META, type AiMeta } from '../../model/ai-meta';

const CACHE_PREFIX = 'dj-ai-meta:';
const PROXY_KEY = 'dj-ai-proxy-url';

export function proxyUrl(): string | null {
  try {
    return localStorage.getItem(PROXY_KEY);
  } catch { return null; }
}

export function setProxyUrl(url: string): void {
  try {
    if (url) localStorage.setItem(PROXY_KEY, url);
    else localStorage.removeItem(PROXY_KEY);
  } catch { /* private mode */ }
}

export async function fileHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }
  // FNV-1a fallback (non-crypto)
  const bytes = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193); }
  return `fnv1a-${(h >>> 0).toString(16)}-${file.size}`;
}

function readCache(hash: string): AiMeta | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + hash);
    if (!raw) return null;
    const m = JSON.parse(raw) as AiMeta;
    if (typeof m.bpm !== 'number') return null;
    return m;
  } catch { return null; }
}

function writeCache(hash: string, meta: AiMeta): void {
  try { localStorage.setItem(CACHE_PREFIX + hash, JSON.stringify(meta)); } catch { /* ignore */ }
}

/** Cheap offline heuristic: estimates BPM from filename/energy from size; real values come from proxy. */
export function heuristicMeta(name: string, durationSec: number, size: number): AiMeta {
  const m = name.match(/(\d{2,3})(?:\s*bpm)?/i);
  const bpm = m ? Math.min(200, Math.max(60, parseInt(m[1], 10))) : DEFAULT_AI_META.bpm;
  const energy = Math.min(1, Math.max(0.1, Math.min(1, (size / (1024 * 1024)) / 20 + durationSec / 600)));
  return { ...DEFAULT_AI_META, bpm, energy: Math.round(energy * 100) / 100 };
}

async function viaProxy(url: string, name: string, hash: string, durationSec: number): Promise<AiMeta | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hash, durationSec }),
    });
    if (!res.ok) return null;
    const m = (await res.json()) as Partial<AiMeta>;
    if (typeof m.bpm !== 'number') return null;
    return {
      bpm: m.bpm, key: m.key ?? '', mood: m.mood ?? '', genre: m.genre ?? '',
      energy: typeof m.energy === 'number' ? m.energy : 0.5,
    };
  } catch { return null; }
}

export async function analyzeTrack(file: File, durationSec: number): Promise<{ meta: AiMeta; cached: boolean }> {
  const hash = await fileHash(file);
  const hit = readCache(hash);
  if (hit) return { meta: hit, cached: true };
  const url = proxyUrl();
  const remote = url ? await viaProxy(url, file.name, hash, durationSec) : null;
  const meta = remote ?? heuristicMeta(file.name, durationSec, file.size);
  writeCache(hash, meta);
  return { meta, cached: false };
}
