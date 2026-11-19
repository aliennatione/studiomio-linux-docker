/** Harmonic sequencing + energy flow + prompt control + live suggestions (tasks 3.4/3.5/3.6). */
import { orderBySetFlow, transitionScore, type AiMeta } from '../../model/ai-meta';

export interface PlannedTrack {
  readonly name: string;
  readonly aiMeta: AiMeta;
}

export function planSet(current: AiMeta, candidates: readonly PlannedTrack[]): PlannedTrack[] {
  return orderBySetFlow(current, candidates);
}

export function suggestNext(current: AiMeta, candidates: readonly PlannedTrack[], n = 3): PlannedTrack[] {
  return planSet(current, candidates).slice(0, Math.max(0, n));
}

export function describeTransition(current: AiMeta, next: AiMeta): string {
  const s = transitionScore(current, next);
  const verdict = s >= 0.8 ? 'ottimo mix' : s >= 0.6 ? 'mix buono' : s >= 0.4 ? 'mix rischioso' : 'sconsigliato';
  return `${verdict} (score ${s.toFixed(2)}): ${current.key || '?'}→${next.key || '?'} · ${current.bpm}→${next.bpm} BPM · energia ${current.energy.toFixed(1)}→${next.energy.toFixed(1)}`;
}

/** Prompt-based control (task 3.5): parses simple DJ commands. */
export type DjCommand =
  | { readonly kind: 'play'; readonly deck: 'A' | 'B' | 'both' }
  | { readonly kind: 'pause'; readonly deck: 'A' | 'B' | 'both' }
  | { readonly kind: 'cue'; readonly deck: 'A' | 'B' }
  | { readonly kind: 'sync'; readonly deck: 'A' | 'B' }
  | { readonly kind: 'cross'; readonly value: number }
  | { readonly kind: 'pitch'; readonly deck: 'A' | 'B'; readonly delta: number }
  | { readonly kind: 'suggest' }
  | { readonly kind: 'automix'; readonly action: 'start' | 'stop' | 'next' }
  | { readonly kind: 'unknown'; readonly text: string };

export function parseDjPrompt(text: string): DjCommand {
  const t = text.trim().toLowerCase();
  const deck: 'A' | 'B' | null = /\bb\b/.test(t) && !/\ba\b/.test(t) ? 'B' : /\ba\b/.test(t) && !/\bb\b/.test(t) ? 'A' : null;
  if (/^(play|go|start)/.test(t)) return { kind: 'play', deck: (deck ?? 'both') as 'A' | 'B' | 'both' };
  if (/^(pause|stop)/.test(t)) return { kind: 'pause', deck: (deck ?? 'both') as 'A' | 'B' | 'both' };
  if (/cue/.test(t)) return { kind: 'cue', deck: deck ?? 'A' };
  if (/sync/.test(t)) return { kind: 'sync', deck: deck ?? 'B' };
  const auto = t.match(/automix\s*(start|stop|next|on|off|skip)?/);
  if (/automix/.test(t)) {
    const a = auto?.[1];
    return { kind: 'automix', action: a === 'stop' || a === 'off' ? 'stop' : a === 'next' || a === 'skip' ? 'next' : 'start' };
  }
  if (/suggest|consigli|next/.test(t)) return { kind: 'suggest' };
  const cross = t.match(/cross\w*\s*(a|b|left|right|mid\w*|center|(\d{1,3}))?/);
  if (cross) {
    const arg = cross[1] ?? '';
    const value = /a|left/.test(arg) ? 0 : /b|right/.test(arg) ? 1 : /mid|center/.test(arg) ? 0.5 : arg.match(/\d+/) ? Math.min(100, Math.max(0, parseInt(arg, 10))) / 100 : 0.5;
    return { kind: 'cross', value };
  }
  const pitch = t.match(/pitch\s*(a|b)?\s*([+-]\s*\d+(\.\d+)?)?\s*%?/);
  if (/pitch|tempo/.test(t) && pitch) {
    const d = pitch[2] ? parseFloat(pitch[2].replace(/\s+/g, '')) / 100 : 0;
    return { kind: 'pitch', deck: (pitch[1]?.toUpperCase() === 'B' ? 'B' : 'A') as 'A' | 'B', delta: d };
  }
  return { kind: 'unknown', text };
}
