import { DjEngine } from './dj-engine';
import { analyzeTrack } from './ai-analysis';
import { generateClip, type LyriaModel } from './ai-generate';
import { Automix, type AutomixMode, type AutomixTrack, type TransitionChoice } from './automix';
import type { AutomixStrategy } from './strategies';
import { LyriaSession, lyriaUrl, setLyriaUrl, type WeightedPrompt } from './lyria-session';
import { interpretPromptForWeights } from './ai-weights';
import { getAlgorithmWeights } from './strategies';
import { getRankedSuggestions } from './strategies';
import { itunesSearch, previewFile, resolveUrl, type PlatformTrack } from '../../browser/sources/platform';
import { encodeWav } from '../../dsp/codec/wav';
import { DEFAULT_AI_META } from '../../model/ai-meta';
import { describeTransition, parseDjPrompt, suggestNext, type PlannedTrack } from './set-planner';

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'dj-field');
  wrap.append(el('span', 'dj-label', label), control);
  return wrap;
}

class DeckPanel {
  readonly element = el('div', 'dj-deck');
  private readonly title = el('div', 'dj-deck-title', 'Deck');
  private readonly file = Object.assign(el('input'), { type: 'file', accept: 'audio/*' });
  private readonly info = el('div', 'dj-info', 'No track');
  private readonly ai = el('div', 'dj-ai', 'AI: —');
  private readonly time = el('div', 'dj-time', '0:00 / 0:00');
  private readonly seek = Object.assign(el('input'), { type: 'range', min: '0', max: '1000', value: '0' });
  private readonly playBtn = el('button', '', 'Play');
  private readonly cueBtn = el('button', '', 'Cue');
  private readonly loopBtn = el('button', '', 'Loop');
  private readonly pitch = Object.assign(el('input'), { type: 'range', min: '0.5', max: '1.5', step: '0.001', value: '1' });
  private readonly pitchVal = el('span', 'dj-pitch-val', '0%');
  private readonly bpm = Object.assign(el('input'), { type: 'number', min: '40', max: '300', step: '0.1', value: '120' });
  private readonly keyInput = Object.assign(el('input'), { type: 'text', placeholder: 'Key (8A)', value: '' });
  private readonly hotRow = el('div', 'dj-controls');
  private seeking = false;

  constructor(
    name: string,
    private readonly deck: DjEngine['deckA'],
    onSync: () => void,
    private readonly onAnalyzed: () => void,
  ) {
    this.title.textContent = name;
    const controls = el('div', 'dj-controls');
    controls.append(this.playBtn, this.cueBtn, this.loopBtn, Object.assign(el('button', '', 'Sync'), { onclick: onSync }));
    for (let i = 0; i < 4; i++) {
      const set = Object.assign(el('button', '', `H${i + 1}●`));
      const go = Object.assign(el('button', '', `H${i + 1}▶`));
      set.title = `Set hot cue ${i + 1}`;
      go.title = `Jump hot cue ${i + 1}`;
      set.onclick = () => { this.deck.setHotCue(i); this.render(); };
      go.onclick = () => { this.deck.jumpHotCue(i); this.render(); };
      this.hotRow.append(set, go);
    }
    const pitchRow = el('div', 'dj-row');
    pitchRow.append(labeled('Pitch', this.pitch), this.pitchVal);
    const bpmRow = el('div', 'dj-row');
    bpmRow.append(labeled('BPM', this.bpm), labeled('Key', this.keyInput));
    this.element.append(this.title, this.file, this.info, this.ai, this.time, this.seek, controls, this.hotRow, pitchRow, bpmRow);

    this.file.onchange = async () => {
      const f = this.file.files?.[0];
      if (!f) return;
      try {
        this.info.textContent = 'Loading…';
        await this.deck.loadFile(f);
        this.info.textContent = this.deck.name;
        const { meta, cached } = await analyzeTrack(f, this.deck.duration);
        this.deck.aiMeta = meta;
        this.deck.bpm = meta.bpm;
        this.bpm.value = String(meta.bpm);
        this.keyInput.value = meta.key;
        this.ai.textContent = `AI: ${meta.bpm} BPM · ${meta.key || '?'} · ${meta.genre || '—'} · E${meta.energy.toFixed(1)}${cached ? ' (cache)' : ''}`;
        this.onAnalyzed();
      } catch (e) {
        this.info.textContent = `Load error: ${e instanceof Error ? e.message : String(e)}`;
      }
      this.render();
    };
    this.playBtn.onclick = () => { this.deck.playing ? this.deck.pause() : this.deck.play(); this.render(); };
    this.cueBtn.onclick = () => { this.deck.cue(); this.render(); };
    this.loopBtn.onclick = () => { this.deck.toggleLoop(); this.render(); };
    this.pitch.oninput = () => {
      const rate = parseFloat(this.pitch.value);
      this.deck.setPitch(rate);
      this.pitchVal.textContent = `${((rate - 1) * 100).toFixed(1)}%`;
      this.render();
    };
    this.bpm.onchange = () => {
      const v = parseFloat(this.bpm.value);
      if (isFinite(v) && v > 0) { this.deck.bpm = v; this.deck.aiMeta = { ...this.deck.aiMeta, bpm: v }; }
    };
    this.keyInput.onchange = () => { this.deck.aiMeta = { ...this.deck.aiMeta, key: this.keyInput.value.trim() }; };
    this.seek.oninput = () => { this.seeking = true; };
    this.seek.onchange = () => {
      const ratio = parseInt(this.seek.value, 10) / 1000;
      this.deck.seek(ratio * this.deck.duration);
      this.seeking = false;
      this.render();
    };
  }

  render(): void {
    const s = this.deck.state();
    this.playBtn.textContent = s.playing ? 'Pause' : 'Play';
    this.loopBtn.textContent = s.loop.enabled ? 'Loop●' : 'Loop';
    this.time.textContent = `${fmtTime(s.position)} / ${fmtTime(s.duration)}`;
    if (!this.seeking && s.duration > 0) this.seek.value = String(Math.round((s.position / s.duration) * 1000));
    this.pitchVal.textContent = `${((s.pitch - 1) * 100).toFixed(1)}%`;
  }
}

export class DjView {
  readonly element = el('div', 'dj-view');
  readonly engine: DjEngine;
  private readonly deckA: DeckPanel;
  private readonly deckB: DeckPanel;
  private readonly crossfader = Object.assign(el('input'), { type: 'range', min: '0', max: '1', step: '0.001', value: '0.5' });
  private readonly prompt = Object.assign(el('input'), { type: 'text', placeholder: 'Prompt: play A · sync B · cross middle · automix start · suggest' });
  private readonly promptOut = el('div', 'dj-info', '');
  private readonly suggest = el('div', 'dj-info', 'Suggerimenti: carica due tracce per i mix consigliati.');
  readonly automix: Automix;
  private readonly queueInput = Object.assign(el('input'), { type: 'file', accept: 'audio/*', multiple: true });
  private readonly queueList = el('div', 'dj-queue');
  private readonly queueStatus = el('div', 'dj-info', 'Automix: OFF');
  private readonly fadeInput = Object.assign(el('input'), { type: 'number', min: '2', max: '30', step: '1', value: '8' });
  private readonly modeSelect = Object.assign(el('select'), {});
  private readonly strategySelect = Object.assign(el('select'), {});
  private readonly styleSelect = Object.assign(el('select'), {});
  private readonly genPrompt = Object.assign(el('input'), { type: 'text', placeholder: 'Descrivi il clip (es. deep house pad 122 BPM)' });
  private readonly genSecs = Object.assign(el('input'), { type: 'number', min: '2', max: '60', step: '1', value: '8' });
  private readonly genDeck = Object.assign(el('select'), {});
  private readonly genModel = Object.assign(el('select'), {});
  private readonly genStatus = el('div', 'dj-info', '');
  private lyria: LyriaSession | null = null;
  private readonly lyriaUrlInput = Object.assign(el('input'), { type: 'text', value: '' });
  private readonly lyriaList = el('div', 'dj-queue');
  private lyriaPrompts: WeightedPrompt[] = [{ text: 'deep house groove', weight: 1 }];
  private readonly lyriaStatus = el('div', 'dj-info', 'Lyria: non connesso. Avvia `npm run lyria-relay` con GEMINI_API_KEY.');
  private readonly lyriaBpm = Object.assign(el('input'), { type: 'number', min: '60', max: '200', step: '1', value: '120' });
  private readonly lyriaDensity = Object.assign(el('input'), { type: 'range', min: '0', max: '1', step: '0.01', value: '0.5' });
  private readonly lyriaBright = Object.assign(el('input'), { type: 'range', min: '0', max: '1', step: '0.01', value: '0.5' });
  private readonly searchInput = Object.assign(el('input'), { type: 'text', placeholder: 'Cerca brani (iTunes preview 30s)' });
  private readonly urlInput = Object.assign(el('input'), { type: 'text', placeholder: 'o incolla URL Spotify/SoundCloud/YouTube/MP3' });
  private readonly searchList = el('div', 'dj-queue');
  private readonly searchStatus = el('div', 'dj-info', '');
  private raf = 0;
  private visible = false;
  private lastTick = 0;

  constructor(ctx: AudioContext) {
    this.engine = new DjEngine(ctx);
    this.deckA = new DeckPanel('Deck A', this.engine.deckA, () => { this.engine.syncAToB(); this.deckA.render(); }, () => this.updateSuggestions());
    this.deckB = new DeckPanel('Deck B', this.engine.deckB, () => { this.engine.syncBToA(); this.deckB.render(); }, () => this.updateSuggestions());
    const decks = el('div', 'dj-decks');
    decks.append(this.deckA.element, this.deckB.element);
    const mixer = el('div', 'dj-mixer');
    mixer.append(el('span', '', 'A'), labeled('Crossfader', this.crossfader), el('span', '', 'B'));
    const promptRow = el('div', 'dj-mixer');
    const run = Object.assign(el('button', '', 'Run'));
    run.onclick = () => this.runPrompt();
    this.prompt.onkeydown = (e) => { if (e.key === 'Enter') this.runPrompt(); };
    promptRow.append(labeled('Prompt', this.prompt), run);

    // Automix panel (tasks 6.x, 9.x)
    this.automix = new Automix({ A: this.engine.deckA, B: this.engine.deckB }, this.engine);
    const autoTitle = el('div', 'dj-deck-title', 'Automix');
    const autoBtns = el('div', 'dj-controls');
    const startBtn = Object.assign(el('button', '', 'Start'), { onclick: () => this.automixCmd('start') });
    const stopBtn = Object.assign(el('button', '', 'Stop'), { onclick: () => this.automixCmd('stop') });
    const nextBtn = Object.assign(el('button', '', 'Next'), { onclick: () => this.automixCmd('next') });
    const orderBtn = Object.assign(el('button', '', 'AI order'), { onclick: () => { this.automix.reorder(); this.renderQueue(); } });
    this.modeSelect.append(
      Object.assign(el('option'), { value: 'mixxx', textContent: 'Mixxx (sync+fade)' }),
      Object.assign(el('option'), { value: 'ai', textContent: 'AI (strategie+stili)' }),
    );
    this.modeSelect.onchange = () => {
      this.automix.mode = (this.modeSelect as HTMLSelectElement).value as AutomixMode;
      this.renderQueue();
    };
    const strategies: AutomixStrategy[] = ['smart-ai', 'harmonic', 'energy-buildup', 'energy-wave', 'bpm-ladder'];
    for (const s of strategies) this.strategySelect.append(Object.assign(el('option'), { value: s, textContent: s }));
    this.strategySelect.onchange = () => { this.automix.strategy = (this.strategySelect as HTMLSelectElement).value as AutomixStrategy; };
    const styles: TransitionChoice[] = ['auto', 'smooth', 'bass-swap', 'filter-sweep', 'quick-cut', 'echo-out'];
    for (const s of styles) this.styleSelect.append(Object.assign(el('option'), { value: s, textContent: s }));
    this.styleSelect.onchange = () => { this.automix.transitionStyle = (this.styleSelect as HTMLSelectElement).value as TransitionChoice; };
    const modeRow = el('div', 'dj-row');
    modeRow.append(labeled('Modo', this.modeSelect), labeled('Strategia', this.strategySelect), labeled('Stile', this.styleSelect));
    autoBtns.append(startBtn, stopBtn, nextBtn, orderBtn, labeled('Fade s', this.fadeInput));
    this.fadeInput.onchange = () => {
      const v = parseFloat(this.fadeInput.value);
      if (isFinite(v)) this.automix.crossfadeSec = Math.min(30, Math.max(2, v));
    };
    this.queueInput.onchange = () => void this.addToQueue();
    const autoPanel = el('div', 'dj-panel');
    autoPanel.append(autoTitle, modeRow, labeled('Coda', this.queueInput), this.queueList, autoBtns, this.queueStatus);

    // AI generation panel (task 8.x)
    this.genDeck.append(Object.assign(el('option'), { value: 'A', textContent: 'Deck A' }), Object.assign(el('option'), { value: 'B', textContent: 'Deck B' }));
    (this.genDeck as HTMLSelectElement).value = 'B';
    this.genModel.append(
      Object.assign(el('option'), { value: 'pad', textContent: 'Pad offline' }),
      Object.assign(el('option'), { value: 'lyria-3-clip-preview', textContent: 'Lyria 3 Clip (30s)' }),
      Object.assign(el('option'), { value: 'lyria-3.5', textContent: 'Lyria 3.5 (brano)' }),
    );
    const genBtn = Object.assign(el('button', '', 'Genera'), { onclick: () => void this.generate() });
    const genPanel = el('div', 'dj-panel');
    const genRow = el('div', 'dj-row');
    genRow.append(labeled('Prompt', this.genPrompt), labeled('Modello', this.genModel), labeled('Sec', this.genSecs), labeled('Deck', this.genDeck), genBtn);
    genPanel.append(el('div', 'dj-deck-title', 'AI audio'), genRow, this.genStatus);

    // Lyria live panel (task 8.x, pattern zip remix-promptdj)
    this.lyriaUrlInput.value = lyriaUrl();
    const connBtn = Object.assign(el('button', '', 'Connetti'));
    connBtn.onclick = () => void this.lyriaConnect();
    const lyPlayBtn = Object.assign(el('button', '', 'Play'));
    lyPlayBtn.onclick = () => this.lyria?.play();
    const lyPauseBtn = Object.assign(el('button', '', 'Pause'));
    lyPauseBtn.onclick = () => this.lyria?.pause();
    const lyStopBtn = Object.assign(el('button', '', 'Stop'));
    lyStopBtn.onclick = () => this.lyria?.stop();
    const addBtn = Object.assign(el('button', '', '+ Prompt'));
    addBtn.onclick = () => { this.lyriaPrompts.push({ text: '', weight: 0.5 }); this.renderLyriaPrompts(); };
    const sendBtn = Object.assign(el('button', '', 'Invia prompt'));
    sendBtn.onclick = () => this.lyria?.setPrompts(this.lyriaPrompts);
    const capBtn = Object.assign(el('button', '', 'Cattura 8s → Deck B'));
    capBtn.onclick = () => void this.lyriaCapture();
    const lyriaBtns = el('div', 'dj-controls');
    lyriaBtns.append(connBtn, lyPlayBtn, lyPauseBtn, lyStopBtn, addBtn, sendBtn, capBtn);
    const cfgRow = el('div', 'dj-row');
    cfgRow.append(labeled('BPM', this.lyriaBpm), labeled('Density', this.lyriaDensity), labeled('Bright', this.lyriaBright));
    const cfgBtn = Object.assign(el('button', '', 'Config'));
    cfgBtn.onclick = () => this.lyria?.setConfig({
      bpm: Math.min(200, Math.max(60, parseInt(this.lyriaBpm.value, 10) || 120)),
      density: parseFloat(this.lyriaDensity.value), brightness: parseFloat(this.lyriaBright.value),
    });
    cfgRow.append(cfgBtn);
    const lyriaPanel = el('div', 'dj-panel');
    lyriaPanel.append(el('div', 'dj-deck-title', 'Lyria live (zip)'), labeled('Relay', this.lyriaUrlInput), this.lyriaList, lyriaBtns, cfgRow, this.lyriaStatus);
    this.renderLyriaPrompts();

    // Online search panel (mypromptdj PlatformService: iTunes previews + URL resolve)
    const searchBtn = Object.assign(el('button', '', 'Cerca'));
    searchBtn.onclick = () => void this.searchTracks();
    this.searchInput.onkeydown = (e) => { if (e.key === 'Enter') void this.searchTracks(); };
    const resolveBtn = Object.assign(el('button', '', 'Risolvi URL'));
    resolveBtn.onclick = () => void this.resolveUrlTrack();
    const searchRow = el('div', 'dj-row');
    searchRow.append(labeled('Cerca', this.searchInput), searchBtn);
    const urlRow = el('div', 'dj-row');
    urlRow.append(labeled('URL', this.urlInput), resolveBtn);
    const searchPanel = el('div', 'dj-panel');
    searchPanel.append(el('div', 'dj-deck-title', 'Online (preview 30s)'), searchRow, urlRow, this.searchList, this.searchStatus);

    this.element.append(decks, mixer, promptRow, this.promptOut, this.suggest, autoPanel, genPanel, lyriaPanel, searchPanel);

    this.crossfader.oninput = () => this.engine.setCrossfader(parseFloat(this.crossfader.value));
  }

  /** Automix control (app + remote, tasks 6.2/9.3). */
  automixCmd(action: 'start' | 'stop' | 'next'): void {
    if (action === 'start') this.automix.start();
    else if (action === 'stop') this.automix.stop();
    else this.automix.next();
    this.renderQueue();
  }

  private async addToQueue(): Promise<void> {
    const files = [...(this.queueInput.files ?? [])];
    this.queueInput.value = '';
    const tracks: AutomixTrack[] = [];
    for (const f of files) {
      try {
        const { meta } = await analyzeTrack(f, 0);
        tracks.push({ name: f.name, file: f, aiMeta: meta });
      } catch {
        tracks.push({ name: f.name, file: f, aiMeta: DEFAULT_AI_META });
      }
    }
    this.automix.enqueue(tracks);
    this.renderQueue();
  }

  private renderQueue(): void {
    this.queueList.textContent = '';
    this.automix.queue.forEach((t, i) => {
      const row = el('div', 'dj-queue-row');
      const rm = Object.assign(el('button', '', '✕'), {
        onclick: () => { this.automix.removeAt(i); this.renderQueue(); },
      });
      row.append(el('span', '', `${i + 1}. ${t.name} (${t.aiMeta.bpm} BPM · ${t.aiMeta.key || '?'})`), rm);
      this.queueList.append(row);
    });
    if (!this.automix.queue.length) this.queueList.append(el('span', 'dj-muted', 'Coda vuota: aggiungi file audio.'));
    this.queueStatus.textContent = `Automix: ${this.automix.status()}`;
  }

  /** Generates an AI clip and loads it into the chosen deck (task 8.2). */
  private async generate(): Promise<void> {
    const prompt = this.genPrompt.value.trim();
    if (!prompt) { this.genStatus.textContent = 'Scrivi un prompt prima.'; return; }
    const secs = Math.min(60, Math.max(2, parseInt(this.genSecs.value, 10) || 8));
    const model = (this.genModel as HTMLSelectElement).value as 'pad' | LyriaModel;
    this.genStatus.textContent = 'Generazione…';
    try {
      const { file, lyrics } = await generateClip({ prompt, seconds: secs, model });
      const deck = (this.genDeck as HTMLSelectElement).value === 'B' ? this.engine.deckB : this.engine.deckA;
      await deck.loadFile(file);
      const { meta } = await analyzeTrack(file, deck.duration);
      deck.aiMeta = meta;
      deck.bpm = meta.bpm;
      this.genStatus.textContent = `Pronto: ${file.name} → deck ${(this.genDeck as HTMLSelectElement).value}${lyrics ? ` · testo: ${lyrics.slice(0, 120)}` : ''}`;
      this.updateSuggestions();
    } catch (e) {
      this.genStatus.textContent = `Errore: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** Loads a file into a deck with AI analysis (shared by search/preview/generate). */
  private async loadFileIntoDeck(file: File, deck: 'A' | 'B'): Promise<void> {
    const d = deck === 'B' ? this.engine.deckB : this.engine.deckA;
    await d.loadFile(file);
    const { meta } = await analyzeTrack(file, d.duration);
    d.aiMeta = meta;
    d.bpm = meta.bpm;
    this.updateSuggestions();
  }

  private async searchTracks(): Promise<void> {
    const q = this.searchInput.value.trim();
    if (!q) return;
    this.searchStatus.textContent = 'Ricerca…';
    try {
      this.renderSearchResults(await itunesSearch(q, 10));
      this.searchStatus.textContent = '';
    } catch (e) {
      this.searchStatus.textContent = `Errore: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async resolveUrlTrack(): Promise<void> {
    const u = this.urlInput.value.trim();
    if (!u) return;
    this.searchStatus.textContent = 'Risoluzione URL…';
    try {
      this.renderSearchResults([await resolveUrl(u)]);
      this.searchStatus.textContent = '';
    } catch (e) {
      this.searchStatus.textContent = `Errore: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private renderSearchResults(tracks: PlatformTrack[]): void {
    this.searchList.textContent = '';
    if (!tracks.length) this.searchList.append(el('span', 'dj-muted', 'Nessun risultato.'));
    for (const t of tracks) {
      const loadA = Object.assign(el('button', '', 'A'));
      const loadB = Object.assign(el('button', '', 'B'));
      const run = async (deck: 'A' | 'B') => {
        try {
          this.searchStatus.textContent = `Carico ${t.title}…`;
          await this.loadFileIntoDeck(await previewFile(t), deck);
          this.searchStatus.textContent = `${t.title} → deck ${deck}`;
        } catch (e) {
          this.searchStatus.textContent = `Errore: ${e instanceof Error ? e.message : String(e)}`;
        }
      };
      loadA.onclick = () => void run('A');
      loadB.onclick = () => void run('B');
      const row = el('div', 'dj-queue-row');
      row.append(el('span', '', `${t.artist} — ${t.title} (${t.bpm} BPM)`), loadA, loadB);
      this.searchList.append(row);
    }
  }

  /** Prompt entrypoint (UI + remote control, task 6.2). */
  runPromptText(text: string): void {
    const cmd = parseDjPrompt(text);
    const e = this.engine;
    switch (cmd.kind) {
      case 'play':
        if (cmd.deck === 'A' || cmd.deck === 'both') e.deckA.play();
        if (cmd.deck === 'B' || cmd.deck === 'both') e.deckB.play();
        this.promptOut.textContent = `▶ play ${cmd.deck}`;
        break;
      case 'pause':
        if (cmd.deck === 'A' || cmd.deck === 'both') e.deckA.pause();
        if (cmd.deck === 'B' || cmd.deck === 'both') e.deckB.pause();
        this.promptOut.textContent = `⏸ pause ${cmd.deck}`;
        break;
      case 'cue': (cmd.deck === 'B' ? e.deckB : e.deckA).cue(); this.promptOut.textContent = `⏮ cue ${cmd.deck}`; break;
      case 'sync':
        if (cmd.deck === 'A') e.syncAToB(); else e.syncBToA();
        this.promptOut.textContent = `🔗 sync ${cmd.deck}`;
        break;
      case 'cross': e.setCrossfader(cmd.value); this.crossfader.value = String(cmd.value); this.promptOut.textContent = `🎚 cross ${cmd.value.toFixed(2)}`; break;
      case 'pitch': {
        const d = cmd.deck === 'B' ? e.deckB : e.deckA;
        d.setPitch(d.pitch + cmd.delta);
        this.promptOut.textContent = `🎛 pitch ${cmd.deck} ${cmd.delta >= 0 ? '+' : ''}${(cmd.delta * 100).toFixed(1)}%`;
        break;
      }
      case 'suggest': this.updateSuggestions(); this.promptOut.textContent = '💡 suggerimenti aggiornati'; break;
      case 'automix': this.automixCmd(cmd.action); this.promptOut.textContent = `🔀 automix ${cmd.action}`; break;
      case 'weights':
        this.promptOut.textContent = '⚖️ interpreto…';
        void interpretPromptForWeights(cmd.text).then(w => {
          this.promptOut.textContent = w
            ? `⚖️ pesi: bpm ${w.bpmWeight.toFixed(2)} · armonia ${w.harmonicWeight.toFixed(2)} · ${w.energyFlow}`
            : '⚖️ proxy non disponibile (serve ai-proxy con GEMINI_API_KEY)';
        });
        break;
      default: this.promptOut.textContent = `? comando non capito: "${(cmd as { text: string }).text}"`; break;
    }
  }

  private runPrompt(): void {
    this.runPromptText(this.prompt.value);
  }

  private updateSuggestions(): void {
    const a = this.engine.deckA;
    const b = this.engine.deckB;
    if (!a.loaded || !b.loaded) {
      this.suggest.textContent = 'Suggerimenti: carica due tracce per i mix consigliati.';
      return;
    }
    const fromA: PlannedTrack[] = [{ name: b.name || 'Deck B', aiMeta: b.aiMeta }];
    const fromB: PlannedTrack[] = [{ name: a.name || 'Deck A', aiMeta: a.aiMeta }];
    const s1 = suggestNext(a.aiMeta, fromA, 1)[0];
    const s2 = suggestNext(b.aiMeta, fromB, 1)[0];
    const live = s1 && s2
      ? `Live: A→B ${describeTransition(a.aiMeta, s1.aiMeta)} · B→A ${describeTransition(b.aiMeta, s2.aiMeta)}`
      : 'Suggerimenti: —';
    // ranked pool from the automix queue (mypromptdj getRankedSuggestions)
    const active = this.automix.active === 'A' ? a : b;
    const ranked = getRankedSuggestions(
      { name: active.name || 'deck', aiMeta: active.aiMeta },
      this.automix.queue.map(q => ({ name: q.name, aiMeta: q.aiMeta })),
      3,
    );
    const pool = ranked.length
      ? ` | Coda: ${ranked.map(r => `${r.name} (${(r.score * 100).toFixed(0)} · ${r.harmonicMatch ?? ''})`).join(' · ')}`
      : '';
    const w = getAlgorithmWeights();
    this.suggest.textContent = `${live}${pool} | Pesi bpm ${w.bpmWeight.toFixed(2)}/arm ${w.harmonicWeight.toFixed(2)}/${w.energyFlow}`;
  }

  show(on: boolean): void {
    this.visible = on;
    this.element.hidden = !on;
    if (on) this.tick();
    else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  /** Lyria: connect/disconnect the realtime session. */
  private async lyriaConnect(): Promise<void> {
    const url = this.lyriaUrlInput.value.trim() || lyriaUrl();
    setLyriaUrl(url);
    try {
      this.lyriaStatus.textContent = 'Lyria: connessione…';
      const session = new LyriaSession(this.engine.deckA.gain.context, undefined, {
        onState: s => { this.lyriaStatus.textContent = `Lyria: ${s}`; },
        onFiltered: (t, r) => { this.lyriaStatus.textContent = `Lyria: prompt filtrato "${t}" (${r})`; },
        onError: m => { this.lyriaStatus.textContent = `Lyria: ${m}`; },
      });
      await session.connect(url);
      this.lyria = session;
      session.setPrompts(this.lyriaPrompts);
      this.lyriaStatus.textContent = 'Lyria: connesso, prompt inviati.';
    } catch (e) {
      this.lyriaStatus.textContent = `Lyria: errore (${e instanceof Error ? e.message : String(e)})`;
    }
  }

  private renderLyriaPrompts(): void {
    this.lyriaList.textContent = '';
    this.lyriaPrompts.forEach((p, i) => {
      const text = Object.assign(el('input'), { type: 'text', value: p.text, placeholder: 'prompt' });
      const weight = Object.assign(el('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: String(p.weight) });
      text.onchange = () => { this.lyriaPrompts[i] = { text: text.value, weight: this.lyriaPrompts[i].weight }; };
      weight.oninput = () => { this.lyriaPrompts[i] = { text: this.lyriaPrompts[i].text, weight: parseFloat(weight.value) }; };
      const rm = Object.assign(el('button', '', '✕'), {
        onclick: () => { this.lyriaPrompts.splice(i, 1); this.renderLyriaPrompts(); },
      });
      const row = el('div', 'dj-queue-row');
      row.append(text, weight, rm);
      this.lyriaList.append(row);
    });
  }

  /** Records recent Lyria audio into Deck B as a file (task 8.2). */
  private async lyriaCapture(seconds = 8): Promise<void> {
    const buf = this.lyria?.capture(seconds);
    if (!buf) { this.lyriaStatus.textContent = 'Lyria: niente da catturare (avvia il play prima).'; return; }
    try {
      const channels = [buf.getChannelData(0).slice(), buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : buf.getChannelData(0).slice()];
      const wav = encodeWav(channels, buf.sampleRate, 16);
      const file = new File([wav], `lyria-${Date.now()}.wav`, { type: 'audio/wav' });
      await this.engine.deckB.loadFile(file);
      const { meta } = await analyzeTrack(file, this.engine.deckB.duration);
      this.engine.deckB.aiMeta = meta;
      this.engine.deckB.bpm = meta.bpm;
      this.lyriaStatus.textContent = `Lyria: catturati ${seconds}s → Deck B.`;
      this.updateSuggestions();
    } catch (e) {
      this.lyriaStatus.textContent = `Lyria: errore cattura (${e instanceof Error ? e.message : String(e)})`;
    }
  }

  private tick = (now: number = 0): void => {
    if (!this.visible) return;
    const dt = this.lastTick ? Math.min(0.5, (now - this.lastTick) / 1000) : 0.016;
    this.lastTick = now;
    this.deckA.render();
    this.deckB.render();
    this.automix.update(dt);
    this.crossfader.value = String(this.engine.crossfader);
    this.queueStatus.textContent = `Automix: ${this.automix.status()}`;
    this.raf = requestAnimationFrame(this.tick);
  };
}
