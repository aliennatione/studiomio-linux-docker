/** AI metadata for DJ tracks (task 3.1). Attached to deck state / clips without touching core model. */

export interface AiMeta {
  readonly bpm: number;
  /** Musical key, e.g. "8A" (Camelot) or "A minor". */
  readonly key: string;
  readonly mood: string;
  readonly genre: string;
  /** 0..1 energy level. */
  readonly energy: number;
  /** Optional: 0..1 danceability / confidence. */
  readonly confidence?: number;
}

export const DEFAULT_AI_META: AiMeta = { bpm: 120, key: '', mood: '', genre: '', energy: 0.5 };

export function withAiMeta<T extends { aiMeta?: AiMeta }>(obj: T, patch: Partial<AiMeta>): T {
  return { ...obj, aiMeta: { ...(obj.aiMeta ?? DEFAULT_AI_META), ...patch } };
}

/** Camelot wheel position for a key like "8A"/"8B". Null if unknown. */
export function camelotPos(key: string): number | null {
  const m = /^\s*(\d{1,2})\s*([AB])\s*$/i.exec(key);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 12) return null;
  return n;
}

/** Camelot → traditional key (mypromptdj harmonic map). */
export const CAMELOT_TO_KEY: Record<string, string> = {
  '1A': 'G#m', '2A': 'D#m', '3A': 'A#m', '4A': 'Fm', '5A': 'Cm', '6A': 'Gm',
  '7A': 'Dm', '8A': 'Am', '9A': 'Em', '10A': 'Bm', '11A': 'F#m', '12A': 'C#m',
  '1B': 'B', '2B': 'F#', '3B': 'C#', '4B': 'G#', '5B': 'D#', '6B': 'A#',
  '7B': 'F', '8B': 'C', '9B': 'G', '10B': 'D', '11B': 'A', '12B': 'E',
};

const KEY_TO_CAMELOT: Record<string, string> = {
  'ABM': '1A', 'G#M': '1A', 'EBM': '2A', 'D#M': '2A', 'BBM': '3A', 'A#M': '3A',
  'FM': '4A', 'CM': '5A', 'GM': '6A', 'DM': '7A', 'AM': '8A', 'EM': '9A',
  'BM': '10A', 'F#M': '11A', 'GBM': '11A', 'C#M': '12A', 'DBM': '12A',
  'B': '1B', 'CB': '1B', 'F#': '2B', 'GB': '2B', 'C#': '3B', 'DB': '3B',
  'G#': '4B', 'AB': '4B', 'D#': '5B', 'EB': '5B', 'A#': '6B', 'BB': '6B',
  'F': '7B', 'C': '8B', 'B#': '8B', 'G': '9B', 'D': '10B', 'A': '11B', 'E': '12B',
};

/** Traditional key ("Am", "F#", "Eb") → Camelot ("8A"). Passthrough for Camelot input. */
export function toCamelot(key: string): string {
  const t = key.trim();
  if (/^\d{1,2}[AB]$/i.test(t)) return t.toUpperCase();
  const norm = t.toUpperCase().replace(/\s+/g, '').replace(/MINOR$/, 'M').replace(/MIN$/, 'M');
  return KEY_TO_CAMELOT[norm] ?? KEY_TO_CAMELOT[norm.replace(/M$/, '')] ?? t;
}

/** Harmonic compatibility detail with label (mypromptdj style). */
export function harmonicDetail(a: string, b: string): { score: number; label: string; camelotA: string; camelotB: string } {
  const ca = toCamelot(a), cb = toCamelot(b);
  const score = harmonicScore(ca, cb);
  const label = score >= 0.99 ? 'Perfect match' : score >= 0.8 ? 'Armonico' : score >= 0.6 ? 'Compatibile' : score > 0.4 ? 'Rischioso' : 'Dissonante';
  return { score, label, camelotA: ca, camelotB: cb };
}

/** Harmonic compatibility 0..1 between two Camelot keys. */
export function harmonicScore(a: string, b: string): number {
  if (!a || !b) return 0.5;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return 1;
  const pa = camelotPos(a), pb = camelotPos(b);
  if (pa === null || pb === null) return 0.5;
  const la = a.trim().slice(-1).toUpperCase(), lb = b.trim().slice(-1).toUpperCase();
  if (pa === pb) return la === lb ? 1 : 0.85;
  const diff = Math.min((pa - pb + 12) % 12, (pb - pa + 12) % 12);
  if (diff === 1 && la === lb) return 0.8;
  if (diff === 1) return 0.6;
  // relative major/minor: same number, different letter handled above; fifth ~ +1/-1 already
  return 0.3;
}

/** Energy-flow score 0..1: prefers gentle rises, penalizes big jumps. */
export function energyScore(from: number, to: number): number {
  const d = to - from;
  if (d >= 0 && d <= 0.2) return 1 - d * 2; // smooth build
  if (d < 0 && d >= -0.15) return 0.9 + d * 2; // gentle dip ok
  return Math.max(0, 1 - Math.abs(d) * 3);
}

/** Combined track-pick score. */
export function transitionScore(current: AiMeta, next: AiMeta, bpmTolerance = 6): number {
  const bpmScore = Math.max(0, 1 - Math.abs(current.bpm - next.bpm) / Math.max(1, bpmTolerance * 2));
  return harmonicScore(current.key, next.key) * 0.5 + energyScore(current.energy, next.energy) * 0.3 + bpmScore * 0.2;
}

/** Order candidates for a smooth set after `current` (task 3.4). */
export function orderBySetFlow<T extends { aiMeta: AiMeta }>(current: AiMeta, candidates: readonly T[]): T[] {
  return [...candidates].sort((x, y) => transitionScore(current, y.aiMeta) - transitionScore(current, x.aiMeta));
}
