/** Automix engine: AI-ordered queue, crossfade, beat sync, gain normalization (tasks 6.x, 9.x). UI-agnostic: driven by update(dt). */
import { suggestNext, type PlannedTrack } from './set-planner';
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
}

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
  private fading = false;
  private fadeT = 0;
  private from = 0;
  private to = 1;
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

  /** AI reorders the queue from the active deck's metadata (task 6.1). */
  reorder(): void {
    const cur = this.decks[this.active];
    if (!cur.loaded) return;
    const meta: AiMeta = (cur as { aiMeta?: AiMeta }).aiMeta ?? { bpm: cur.bpm, key: '', mood: '', genre: '', energy: 0.5 };
    const ranked = suggestNext(meta, this.queue.map(q => ({ name: q.name, aiMeta: q.aiMeta })), this.queue.length);
    const byName = new Map(this.queue.map(q => [q.name, q] as const));
    this.queue = ranked.map(r => byName.get(r.name)).filter((q): q is AutomixTrack => !!q);
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
        this.notice = `Automix: mix → ${head.name}`;
      } else if (remaining <= 0.05 && !o.playing) {
        // track ended without a queued next: manual fallback
        this.notice = 'Automix: brano finito, coda vuota → manuale';
        this.running = false;
      }
      return;
    }

    // fading: linear crossfade over crossfadeSec
    if (!o.playing) { this.fading = false; return; } // aborted: manual fallback
    this.fadeT += dt;
    const k = Math.min(1, this.fadeT / Math.max(0.5, this.crossfadeSec));
    this.mixer.setCrossfader(this.from + (this.to - this.from) * k);
    if (k >= 1) {
      this.fading = false;
      d.stop();
      this.active = other(this.active);
      this.notice = `Automix: ▶ ${o.name || 'deck ' + this.active}`;
    }
  }

  status(): string {
    const q = this.queue.length;
    return `${this.running ? 'ON' : 'OFF'} · attivo ${this.active}${this.fading ? ' (mix…)' : ''} · coda ${q}${this.notice ? ` · ${this.notice}` : ''}`;
  }
}

/** PlannedTrack view of the queue (for suggestions UI). */
export function queueAsPlanned(queue: readonly AutomixTrack[]): PlannedTrack[] {
  return queue.map(q => ({ name: q.name, aiMeta: q.aiMeta }));
}
