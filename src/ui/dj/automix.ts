/** Automix engine: AI-ordered queue, crossfade, beat sync, gain normalization (tasks 6.x, 9.x). UI-agnostic: driven by update(dt). */
import type { PlannedTrack } from './set-planner';
import { evaluateTransition, orderByStrategy, type AutomixStrategy, type TransitionStyle } from './strategies';
import type { AiMeta } from '../../model/ai-meta';

export interface AutomixTrack {
  readonly name: string;
  readonly file: File;
  readonly aiMeta: AiMeta;
}

/** Minimal deck surface the automix needs (DjEngine decks satisfy it structurally). */
export interface AutomixDeck {
  readonly name: string;
  readonly loaded: boolean;
  readonly playing: boolean;
  readonly duration: number;
  readonly position: number;
  bpm: number;
  loadFile(file: File): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  normalize(): void;
  setBassDb(db: number): void;
  setCutoff(hz: number): void;
  setEchoSend(v: number): void;
  resetFx(): void;
}

export type TransitionChoice = TransitionStyle | 'auto';

/** Automix mode: 'mixxx' = simple sync + fade (Mixxx opensource style), 'ai' = strategies + styled transitions. */
export type AutomixMode = 'mixxx' | 'ai';

export interface AutomixMixer {
  readonly crossfader: number;
  setCrossfader(v: number): void;
  syncAToB(): void;
  syncBToA(): void;
}

const other = (d: 'A' | 'B'): 'A' | 'B' => (d === 'A' ? 'B' : 'A');

export class Automix {
  queue: AutomixTrack[] = [];
  crossfadeSec = 8;
  running = false;
  notice = '';
  active: 'A' | 'B' = 'A';
  strategy: AutomixStrategy = 'smart-ai';
  transitionStyle: TransitionChoice = 'auto';
  mode: AutomixMode = 'mixxx';
  private fading = false;
  private fadeT = 0;
  private from = 0;
  private to = 1;
  private style: TransitionStyle = 'smooth';
  private styleSecs = 8;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly decks: { A: AutomixDeck; B: AutomixDeck },
    private readonly mixer: AutomixMixer,
  ) {}

  enqueue(tracks: readonly AutomixTrack[]): void {
    this.queue.push(...tracks);
  }

  removeAt(index: number): void {
    if (index >= 0 && index < this.queue.length) this.queue.splice(index, 1);
  }

  clear(): void {
    this.queue.length = 0;
  }

  /** AI reorders the queue from the active deck's metadata (task 6.1). No-op in Mixxx mode: manual order. */
  reorder(): void {
    if (this.mode === 'mixxx') { this.notice = 'Mixxx: ordine manuale (coda invariata)'; return; }
    if (!this.queue.length) return;
    const cur = this.decks[this.active];
    const meta: AiMeta = (cur as { aiMeta?: AiMeta }).aiMeta ?? { bpm: cur.bpm, key: '', mood: '', genre: '', energy: 0.5 };
    const seed = { name: `__current__`, aiMeta: meta };
    const ordered = orderByStrategy(seed, this.queue.map(q => ({ name: q.name, aiMeta: q.aiMeta })), this.strategy);
    const byName = new Map(this.queue.map(q => [q.name, q] as const));
    this.queue = ordered.map(t => byName.get(t.name)).filter((q): q is AutomixTrack => !!q);
  }

  start(): void {
    this.running = true;
    this.notice = this.queue.length ? 'Automix: on' : 'Automix: on (coda vuota → manuale al termine)';
  }

  stop(): void {
    this.running = false;
    this.fading = false;
    this.notice = 'Automix: off (manuale)';
  }

  /** Manual skip to next queued track now (fallback control, task 9.3). */
  next(): void {
    const d = this.decks[this.active], o = this.decks[other(this.active)];
    const next = this.queue.shift();
    if (!next) { this.notice = 'Automix: nessun brano in coda'; return; }
    this.fading = false;
    this.loadInto(o, next).then(() => {
      o.play();
      this.mixer.setCrossfader(this.active === 'A' ? 1 : 0);
      d.stop();
      this.active = other(this.active);
      this.notice = `Automix: → ${next.name}`;
    });
  }

  private loadInto(deck: AutomixDeck, track: AutomixTrack): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = deck.loadFile(track.file).then(() => {
      deck.normalize();
      if (deck === this.decks.A) this.mixer.syncAToB(); else this.mixer.syncBToA();
    }).catch((e) => {
      this.notice = `Automix: salto ${track.name} (${e instanceof Error ? e.message : String(e)})`;
    }).finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Advance the automix by dt seconds. Call every frame while visible. */
  update(dt: number): void {
    if (!this.running || dt <= 0) return;
    const d = this.decks[this.active], o = this.decks[other(this.active)];

    if (!d.loaded || !d.playing) {
      const next = this.queue.shift();
      if (!next) { this.notice = 'Automix: coda vuota, passo a manuale'; this.running = false; return; }
      this.loadInto(d, next).then(() => { d.play(); this.notice = `Automix: ▶ ${next.name}`; });
      return;
    }

    // preload next into the idle deck
    const head = this.queue[0];
    if (head && (!o.loaded || o.name !== head.name) && !this.loading) void this.loadInto(o, head);

    const remaining = d.duration - d.position;
    if (!this.fading) {
      if (head && o.loaded && o.name === head.name && !o.playing && remaining <= this.crossfadeSec && remaining > 0) {
        this.queue.shift();
        o.play();
        this.from = this.active === 'A' ? 0 : 1;
        this.to = 1 - this.from;
        this.fadeT = 0;
        this.fading = true;
        // resolve the transition style: Mixxx = plain fade; AI = chosen or recommended
        this.style = 'smooth';
        this.styleSecs = this.crossfadeSec;
        if (this.mode === 'ai') {
          const curMeta = this.metaOf(d);
          const detail = evaluateTransition(curMeta, head.aiMeta);
          this.style = this.transitionStyle === 'auto' ? detail.recommendedStyle : this.transitionStyle;
          if (this.transitionStyle === 'auto') this.styleSecs = Math.min(this.crossfadeSec, Math.max(2, detail.recommendedDuration));
          if (this.style === 'bass-swap') o.setBassDb(-24);
          if (this.style === 'filter-sweep') o.setCutoff(400);
        }
        this.notice = `Automix (${this.mode}): mix → ${head.name}${this.mode === 'ai' && this.style !== 'smooth' ? ` [${this.style}]` : ''}`;
      } else if (remaining <= 0.05 && !o.playing) {
        // track ended without a queued next: manual fallback
        this.notice = 'Automix: brano finito, coda vuota → manuale';
        this.running = false;
      }
      return;
    }

    // fading: crossfade over the fade window (Mixxx = linear gains; AI = styled)
    if (!o.playing && this.style !== 'echo-out') { this.fading = false; d.resetFx(); o.resetFx(); return; } // aborted: manual fallback
    this.fadeT += dt;
    const secs = Math.max(0.5, this.mode === 'mixxx' ? this.crossfadeSec : this.styleSecs);
    const k = Math.min(1, this.fadeT / secs);
    if (this.style === 'quick-cut' && k >= 0.5) {
      this.mixer.setCrossfader(this.to);
    } else if (this.style === 'echo-out') {
      const ke = Math.min(1, k * 1.4);
      this.mixer.setCrossfader(this.from + (this.to - this.from) * ke * ke);
      d.setEchoSend(0.8 * Math.min(1, k * 3));
      if (k >= 0.65 && d.playing) d.stop(); // tail rings through the delay
    } else {
      this.mixer.setCrossfader(this.from + (this.to - this.from) * k);
      if (this.style === 'bass-swap') {
        d.setBassDb(-24 * k);
        o.setBassDb(-24 * (1 - k));
      } else if (this.style === 'filter-sweep') {
        d.setCutoff(20000 * Math.pow(400 / 20000, k));
        o.setCutoff(400 * Math.pow(20000 / 400, k));
      }
    }
    if (k >= 1) {
      this.fading = false;
      if (d.playing) d.stop();
      d.resetFx();
      o.resetFx();
      this.mixer.setCrossfader(this.to);
      this.active = other(this.active);
      this.notice = `Automix: ▶ ${o.name || 'deck ' + this.active}`;
    }
  }

  private metaOf(deck: AutomixDeck): AiMeta {
    return (deck as { aiMeta?: AiMeta }).aiMeta ?? { bpm: deck.bpm, key: '', mood: '', genre: '', energy: 0.5 };
  }

  status(): string {
    const q = this.queue.length;
    const cfg = this.mode === 'mixxx' ? 'mixxx' : `${this.strategy}/${this.transitionStyle}`;
    return `${this.running ? 'ON' : 'OFF'} · ${cfg} · attivo ${this.active}${this.fading ? ' (mix…)' : ''} · coda ${q}${this.notice ? ` · ${this.notice}` : ''}`;
  }
}

/** PlannedTrack view of the queue (for suggestions UI). */
export function queueAsPlanned(queue: readonly AutomixTrack[]): PlannedTrack[] {
  return queue.map(q => ({ name: q.name, aiMeta: q.aiMeta }));
}
