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
