/** mypromptdj AILogic equivalent: server-side track analysis (base64 audio) + prompt→weights. */
import { proxyUrl } from './ai-analysis';
import { getAlgorithmWeights, setAlgorithmWeights, type AlgorithmWeights, type EnergyFlow } from './strategies';
import { toCamelot } from '../../model/ai-meta';

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    r.onerror = () => reject(new Error('read error'));
    r.readAsDataURL(file);
  });
}

export interface ServerAnalysis {
  bpm: number; key: string; mood: string; genre: string; energy: number;
}

/** Full-audio analysis via proxy /analyze-track (mypromptdj AILogic.analyzeTrack). Null without proxy/key. */
export async function analyzeTrackAudio(file: File): Promise<ServerAnalysis | null> {
  const url = proxyUrl();
  if (!url || file.size > MAX_AUDIO_BYTES) return null;
  try {
    const audioBase64 = await fileToBase64(file);
    const res = await fetch(`${url.replace(/\/$/, '')}/analyze-track`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType: file.type || 'audio/mpeg' }),
    });
    if (!res.ok) return null;
    const m = (await res.json()) as Partial<ServerAnalysis & { musicalKey?: string; camelotKey?: string }>;
    const key = String(m.key ?? m.camelotKey ?? toCamelot(String(m.musicalKey ?? '')));
    return {
      bpm: Number(m.bpm) || 120, key,
      mood: String(m.mood ?? ''), genre: String(m.genre ?? ''),
      energy: Math.min(1, Math.max(0, Number(m.energy ?? 0.5))),
    };
  } catch { return null; }
}

export function normalizeWeights(w: Partial<AlgorithmWeights>): AlgorithmWeights {
  const flows: EnergyFlow[] = ['buildup', 'cooldown', 'wave', 'constant'];
  return {
    bpmWeight: Math.min(1, Math.max(0, Number(w.bpmWeight ?? 0.35))),
    harmonicWeight: Math.min(1, Math.max(0, Number(w.harmonicWeight ?? 0.5))),
    energyFlow: flows.includes(w.energyFlow as EnergyFlow) ? (w.energyFlow as EnergyFlow) : 'buildup',
  };
}

/** Natural-language prompt → algorithm weights via proxy /interpret-prompt (mypromptdj interpretPromptForWeights). */
export async function interpretPromptForWeights(prompt: string): Promise<AlgorithmWeights | null> {
  const url = proxyUrl();
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/interpret-prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, currentWeights: getAlgorithmWeights() }),
    });
    if (!res.ok) return null;
    return setAlgorithmWeights(normalizeWeights((await res.json()) as Partial<AlgorithmWeights>));
  } catch { return null; }
}
