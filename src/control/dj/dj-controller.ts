/** Generic DJ controller mapping (task 5.1): MIDI notes/CC → deck actions. Transport-agnostic. */
import type { DjEngine } from '../../ui/dj/dj-engine';

export interface DjControlActions {
  playA(): void;
  playB(): void;
  cueA(): void;
  cueB(): void;
  syncA(): void;
  syncB(): void;
  crossfader(value: number): void;
  pitchA(delta: number): void;
  pitchB(delta: number): void;
  hotCue(deck: 'A' | 'B', slot: number): void;
  loopToggle(deck: 'A' | 'B'): void;
}

export function engineActions(engine: DjEngine): DjControlActions {
  return {
    playA: () => (engine.deckA.playing ? engine.deckA.pause() : engine.deckA.play()),
    playB: () => (engine.deckB.playing ? engine.deckB.pause() : engine.deckB.play()),
    cueA: () => engine.deckA.cue(),
    cueB: () => engine.deckB.cue(),
    syncA: () => engine.syncAToB(),
    syncB: () => engine.syncBToA(),
    crossfader: v => engine.setCrossfader(v),
    pitchA: d => engine.deckA.setPitch(engine.deckA.pitch + d),
    pitchB: d => engine.deckB.setPitch(engine.deckB.pitch + d),
    hotCue: (deck, slot) => (deck === 'A' ? engine.deckA : engine.deckB).jumpHotCue(slot),
    loopToggle: deck => (deck === 'A' ? engine.deckA : engine.deckB).toggleLoop(),
  };
}

/** Default MIDI map: notes for transport, CCs for pitch/crossfader. */
export interface DjMidiBinding {
  readonly note?: number;
  readonly cc?: number;
  readonly action: keyof DjControlActions | 'hotCueA' | 'hotCueB' | 'cross';
}

export const DEFAULT_DJ_MAP: DjMidiBinding[] = [
  { note: 0x10, action: 'playA' }, { note: 0x11, action: 'playB' },
  { note: 0x12, action: 'cueA' }, { note: 0x13, action: 'cueB' },
  { note: 0x14, action: 'syncA' }, { note: 0x15, action: 'syncB' },
  { note: 0x20, action: 'hotCueA' }, { note: 0x21, action: 'hotCueB' },
  { note: 0x22, action: 'loopToggle' },
  { cc: 0x0a, action: 'pitchA' }, { cc: 0x0b, action: 'pitchB' },
  { cc: 0x0f, action: 'cross' },
];

const NOTE_ON = 0x90;
const CC = 0xb0;

/** Routes a raw MIDI message to DJ actions. Returns true if handled. */
export function handleDjMidi(data: Uint8Array | number[], actions: DjControlActions, map: readonly DjMidiBinding[] = DEFAULT_DJ_MAP): boolean {
  const [status = 0, d1 = 0, d2 = 0] = data;
  const kind = status & 0xf0;
  if (kind === NOTE_ON && d2 > 0) {
    const b = map.find(m => m.note === d1);
    if (!b) return false;
    if (b.action === 'hotCueA') actions.hotCue('A', 0);
    else if (b.action === 'hotCueB') actions.hotCue('B', 0);
    else if (b.action === 'cross' || b.action === 'hotCue') return false;
    else (actions[b.action as keyof DjControlActions] as () => void)();
    return true;
  }
  if (kind === CC) {
    const b = map.find(m => m.cc === d1);
    if (!b) return false;
    const v = d2 / 127;
    if (b.action === 'cross') actions.crossfader(v);
    else if (b.action === 'pitchA') actions.pitchA((v - 0.5) * 0.02);
    else if (b.action === 'pitchB') actions.pitchB((v - 0.5) * 0.02);
    else return false;
    return true;
  }
  return false;
}
