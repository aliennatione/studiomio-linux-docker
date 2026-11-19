/** Automix strategies + transition evaluation (mypromptdj AutomixEngine, rewritten). */
import { energyScore, harmonicDetail, type AiMeta } from '../../model/ai-meta';

export type AutomixStrategy = 'harmonic' | 'energy-buildup' | 'energy-wave' | 'bpm-ladder' | 'smart-ai';
export type TransitionStyle = 'smooth' | 'bass-swap' | 'filter-sweep' | 'quick-cut' | 'echo-out';
export type EnergyFlow = 'buildup' | 'cooldown' | 'wave' | 'constant';

export interface AlgorithmWeights {
  bpmWeight: number;
  harmonicWeight: number;
  energyFlow: EnergyFlow;
}

export const DEFAULT_WEIGHTS: AlgorithmWeights = { bpmWeight: 0.35, harmonicWeight: 0.5, energyFlow: 'buildup' };

let weights: AlgorithmWeights = { ...DEFAULT_WEIGHTS };

export function setAlgorithmWeights(w: Partial<AlgorithmWeights>): AlgorithmWeights {
  weights = {
    bpmWeight: w.bpmWeight ?? weights.bpmWeight,
    harmonicWeight: w.harmonicWeight ?? weights.harmonicWeight,
    energyFlow: w.energyFlow ?? weights.energyFlow,
  };
  return { ...weights };
}

export function getAlgorithmWeights(): AlgorithmWeights {
  return { ...weights };
}

export interface Plannable {
  readonly name: string;
  readonly aiMeta: AiMeta;
}

export interface TransitionDetail {
  /** 0..100 composite score. */
  readonly score: number;
  readonly harmonicScore: number;
  readonly harmonicLabel: string;
  readonly fromCamelot: string;
  readonly toCamelot: string;
  readonly bpmDiff: number;
  readonly pitchAdjustPercent: number;
  readonly recommendedStyle: TransitionStyle;
  readonly recommendedDuration: number;
  readonly description: string;
}

/** Deep transition evaluation: harmonic + bpm + energy → style & duration. */
export function evaluateTransition(from: AiMeta, to: AiMeta): TransitionDetail {
  const fromBpm = from.bpm || 124, toBpm = to.bpm || 124;
  const harmonic = harmonicDetail(from.key || '8A', to.key || '8A');
  const bpmDiff = Math.abs(fromBpm - toBpm);
  const bpmScore = Math.max(0, 1 - bpmDiff / 16);
  const energyScoreV = energyScore(from.energy, to.energy);
  const w = weights;
  const wSum = w.bpmWeight + w.harmonicWeight + 0.15;
  const composite = Math.round(
    ((harmonic.score * w.harmonicWeight + bpmScore * w.bpmWeight + energyScoreV * 0.15) / wSum) * 100,
  );

  let recommendedStyle: TransitionStyle = 'smooth';
  let recommendedDuration = 6;
  if (bpmDiff <= 3 && from.energy >= 0.8 && to.energy >= 0.8) {
    recommendedStyle = 'bass-swap';
    recommendedDuration = 8;
  } else if (harmonic.score < 0.7) {
    recommendedStyle = 'filter-sweep';
    recommendedDuration = 5;
  } else if (bpmDiff > 8) {
    recommendedStyle = 'echo-out';
    recommendedDuration = 4;
  }

  const pitchAdjust = ((fromBpm - toBpm) / Math.max(1, toBpm)) * 100;
  let description = `${harmonic.label} | BPM: Δ${bpmDiff.toFixed(0)}`;
  if (Math.abs(pitchAdjust) > 0.5) description += ` (Pitch sync ${pitchAdjust > 0 ? '+' : ''}${pitchAdjust.toFixed(1)}%)`;

  return {
    score: composite, harmonicScore: harmonic.score, harmonicLabel: harmonic.label,
    fromCamelot: harmonic.camelotA, toCamelot: harmonic.camelotB,
    bpmDiff, pitchAdjustPercent: pitchAdjust,
    recommendedStyle, recommendedDuration, description,
  };
}

function greedyBy(pool: Plannable[], score: (cur: Plannable, cand: Plannable) => number): Plannable[] {
  const rest = [...pool];
  const out: Plannable[] = [];
  let current = rest.shift()!;
  out.push(current);
  while (rest.length) {
    let best = 0, bestScore = -Infinity;
    rest.forEach((c, i) => {
      const s = score(current, c);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    current = rest.splice(best, 1)[0];
    out.push(current);
  }
  return out;
}

/** Micro-optimization: swap adjacent items when clearly better harmonically. */
function smoothAdjacentKeys(list: Plannable[]): Plannable[] {
  for (let i = 1; i < list.length - 2; i++) {
    const normal = evaluateTransition(list[i - 1].aiMeta, list[i].aiMeta).score
      + evaluateTransition(list[i].aiMeta, list[i + 1].aiMeta).score;
    const swapped = evaluateTransition(list[i - 1].aiMeta, list[i + 1].aiMeta).score
      + evaluateTransition(list[i + 1].aiMeta, list[i].aiMeta).score;
    if (swapped > normal + 15) {
      const tmp = list[i];
      list[i] = list[i + 1];
      list[i + 1] = tmp;
    }
  }
  return list;
}

/** Order tracks with one of the 5 mypromptdj strategies. */
export function orderByStrategy(current: Plannable | null, tracks: readonly Plannable[], strategy: AutomixStrategy): Plannable[] {
  const pool = [...tracks];
  switch (strategy) {
    case 'bpm-ladder':
      return pool.sort((a, b) => a.aiMeta.bpm - b.aiMeta.bpm);
    case 'energy-buildup':
      return smoothAdjacentKeys(pool.sort((a, b) =>
        a.aiMeta.energy !== b.aiMeta.energy ? a.aiMeta.energy - b.aiMeta.energy : a.aiMeta.bpm - b.aiMeta.bpm));
    case 'energy-wave': {
      const high = pool.filter(t => t.aiMeta.energy >= 0.7);
      const low = pool.filter(t => t.aiMeta.energy < 0.7);
      const wave: Plannable[] = [];
      while (high.length || low.length) {
        if (high.length) wave.push(high.shift()!);
        if (high.length) wave.push(high.shift()!);
        if (low.length) wave.push(low.shift()!);
      }
      return wave;
    }
    case 'harmonic': {
      const start = current ?? pool.sort((a, b) => a.aiMeta.bpm - b.aiMeta.bpm)[0];
      const rest = pool.filter(t => t !== start);
      const out: Plannable[] = [start];
      let cur = start;
      while (rest.length) {
        let best = 0, bestScore = -Infinity;
        rest.forEach((c, i) => {
          const e = evaluateTransition(cur.aiMeta, c.aiMeta);
          const s = e.harmonicScore * 0.7 + (1 - Math.min(1, e.bpmDiff / 20)) * 0.3;
          if (s > bestScore) { bestScore = s; best = i; }
        });
        cur = rest.splice(best, 1)[0];
        out.push(cur);
      }
      return out;
    }
    case 'smart-ai':
    default: {
      const seed: Plannable[] = current ? [current, ...pool.filter(t => t !== current)] : pool;
      return greedyBy(seed, (cur, c) => evaluateTransition(cur.aiMeta, c.aiMeta).score);
    }
  }
}

export interface RankedSuggestion extends Plannable {
  readonly score: number;
  readonly reason: string;
  readonly harmonicMatch?: string;
}

/** Ranked live suggestions for the current track (score + reason + harmonic label). */
export function getRankedSuggestions(current: Plannable, pool: readonly Plannable[], count = 4): RankedSuggestion[] {
  return pool
    .filter(t => t.name !== current.name)
    .map(c => {
      const e = evaluateTransition(current.aiMeta, c.aiMeta);
      return { ...c, score: e.score / 100, reason: e.description, harmonicMatch: e.harmonicLabel };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, count));
}
