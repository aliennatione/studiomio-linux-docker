import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_META, energyScore, harmonicScore, orderBySetFlow, transitionScore } from '../src/model/ai-meta';
import { parsePlaylist } from '../src/browser/sources/playlists';
import { parseMixxx, parseRekordbox, parseTraktor, parseVirtualDJ } from '../src/browser/sources/dj-software';
import { parseMixxxMapping } from '../src/control/dj/mixxx-mapping';
import { handleDjMidi, type DjControlActions } from '../src/control/dj/dj-controller';
import { parseDjPrompt, suggestNext } from '../src/ui/dj/set-planner';

const actions = (): DjControlActions & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    playA: () => { log.push('playA'); }, playB: () => { log.push('playB'); },
    cueA: () => { log.push('cueA'); }, cueB: () => { log.push('cueB'); },
    syncA: () => { log.push('syncA'); }, syncB: () => { log.push('syncB'); },
    crossfader: v => { log.push(`cross:${v.toFixed(2)}`); },
    pitchA: d => { log.push(`pitchA:${d}`); }, pitchB: d => { log.push(`pitchB:${d}`); },
    hotCue: (d, s) => { log.push(`hot:${d}${s}`); }, loopToggle: d => { log.push(`loop:${d}`); },
  };
};

describe('ai-meta', () => {
  it('harmonic score prefers same/adjacent Camelot keys', () => {
    expect(harmonicScore('8A', '8A')).toBe(1);
    expect(harmonicScore('8A', '9A')).toBeGreaterThan(harmonicScore('8A', '3B'));
    expect(harmonicScore('', '8A')).toBe(0.5);
  });
  it('energy score prefers smooth builds', () => {
    expect(energyScore(0.5, 0.6)).toBeGreaterThan(energyScore(0.5, 0.9));
  });
  it('orders candidates by set flow', () => {
    const cur = { ...DEFAULT_AI_META, bpm: 124, key: '8A', energy: 0.5 };
    const out = orderBySetFlow(cur, [
      { aiMeta: { ...DEFAULT_AI_META, bpm: 180, key: '3B', energy: 1 } },
      { aiMeta: { ...DEFAULT_AI_META, bpm: 124, key: '8A', energy: 0.55 } },
    ]);
    expect(out[0]?.aiMeta.bpm).toBe(124);
    expect(transitionScore(cur, out[0]!.aiMeta)).toBeGreaterThanOrEqual(transitionScore(cur, out[1]!.aiMeta));
  });
  it('suggests next tracks', () => {
    const cur = { ...DEFAULT_AI_META, bpm: 120, key: '8A', energy: 0.4 };
    const s = suggestNext(cur, [{ name: 't', aiMeta: { ...DEFAULT_AI_META, bpm: 121, key: '9A', energy: 0.45 } }]);
    expect(s).toHaveLength(1);
  });
});

describe('playlists', () => {
  it('parses m3u8', () => {
    const out = parsePlaylist('set.m3u8', '#EXTM3U\n#EXTINF:210,Artist - Title\n/music/a.mp3\n/music/b.mp3\n');
    expect(out).toHaveLength(2);
    expect(out[0]?.title).toBe('Artist - Title');
  });
  it('parses pls', () => {
    const out = parsePlaylist('s.pls', '[playlist]\nFile1=a.mp3\nTitle1=T\nLength1=200\nNumberOfEntries=1\n');
    expect(out[0]?.path).toBe('a.mp3');
  });
  it('parses xspf', () => {
    const out = parsePlaylist('s.xspf', '<playlist><trackList><track><location>file:///m/a.mp3</location><title>T</title><duration>200000</duration></track></trackList></playlist>');
    expect(out[0]?.durationSec).toBe(200);
  });
});

describe('dj software imports', () => {
  it('parses rekordbox/traktor/virtualdj/mixxx', () => {
    expect(parseRekordbox('<DJ_PLAYLISTS><COLLECTION><TRACK Name="T" Artist="A" AverageBpm="124" Tonality="8A"/></COLLECTION></DJ_PLAYLISTS>')[0]?.bpm).toBe(124);
    expect(parseTraktor('<NML><ENTRY TITLE="T"><LOCATION VOLUME="V" DIR="D" FILE="f.mp3"/><TEMPO BPM="120"/><MUSICAL_KEY VALUE="8A"/></ENTRY></NML>')[0]?.title).toBe('T');
    expect(parseVirtualDJ('<VirtualDJ><Song FilePath="/m/a.mp3" Author="A" Title="T" Bpm="122"/></VirtualDJ>')[0]?.bpm).toBe(122);
    expect(parseMixxx('location,title,bpm\n/m/a.mp3,T,120')[0]?.key).toBeUndefined();
  });
});

describe('controller', () => {
  it('parses mixxx xml mapping', () => {
    const xml = '<MixxxControllerPreset><controls><control><status>0x90</status><midino>0x10</midino><control>[Channel1],play</control></control></controls></MixxxControllerPreset>';
    expect(parseMixxxMapping(xml)).toEqual([{ note: 0x10, action: 'playA' }]);
  });
  it('routes midi notes and cc', () => {
    const a = actions();
    expect(handleDjMidi([0x90, 0x10, 0x7f], a)).toBe(true);
    expect(a.log).toContain('playA');
    expect(handleDjMidi([0xb0, 0x0f, 127], a)).toBe(true);
    expect(a.log.some(l => l.startsWith('cross:1'))).toBe(true);
  });
});

describe('prompt control', () => {
  it('parses play/sync/cross/suggest', () => {
    expect(parseDjPrompt('play A')).toEqual({ kind: 'play', deck: 'A' });
    expect(parseDjPrompt('sync b')).toEqual({ kind: 'sync', deck: 'B' });
    expect(parseDjPrompt('suggest next')).toEqual({ kind: 'suggest' });
    const cross = parseDjPrompt('cross middle');
    expect(cross.kind).toBe('cross');
  });
});

describe('automix', () => {
  const fakeDeck = (name: string) => {
    const d = {
      name, loaded: true, playing: false, duration: 100, position: 0, bpm: 120,
      aiMeta: { ...DEFAULT_AI_META, bpm: 120, key: '8A', energy: 0.5 },
      async loadFile(f: File) { d.name = f.name; d.loaded = true; d.position = 0; },
      play() { d.playing = true; }, pause() { d.playing = false; }, stop() { d.playing = false; },
      normalize() {},
    };
    return d;
  };
  const fakeMixer = () => {
    const m = {
      crossfader: 0,
      setCrossfader(v: number) { m.crossfader = v; },
      syncAToB() {}, syncBToA() {},
    };
    return m;
  };

  it('advances queue with crossfade and falls back to manual', async () => {
    const { Automix } = await import('../src/ui/dj/automix');
    const A = fakeDeck('a'), B = fakeDeck('empty');
    B.loaded = false;
    const mixer = fakeMixer();
    const am = new Automix({ A, B } as never, mixer as never);
    const f = new File(['x'], 'next.mp3', { type: 'audio/mp3' });
    am.enqueue([{ name: 'next.mp3', file: f, aiMeta: { ...DEFAULT_AI_META } }]);
    A.playing = true;
    am.crossfadeSec = 4;
    am.start();
    A.position = 97; // remaining 3 < 4 → preload + start fade
    am.update(0.1);
    await Promise.resolve();
    expect(am.status()).toMatch(/ON/);
  });

  it('stops on empty queue (manual fallback)', async () => {
    const { Automix } = await import('../src/ui/dj/automix');
    const A = fakeDeck('a'), B = fakeDeck('b');
    const mixer = fakeMixer();
    const am = new Automix({ A, B } as never, mixer as never);
    A.playing = true;
    A.position = 99.99;
    am.crossfadeSec = 4;
    am.start();
    am.update(0.1);
    expect(am.running).toBe(false);
    expect(am.status()).toMatch(/OFF/);
  });
});

describe('ai generation', () => {
  it('builds file names and offline pad', async () => {
    const g = await import('../src/ui/dj/ai-generate');
    expect(g.generateFileName('Deep House Pad!')).toBe('deep-house-pad.wav');
    const [l, r] = g.synthPad('test', 1, 8000);
    expect(l.length).toBe(8000);
    expect(r.length).toBe(8000);
    const clip = await g.generateClip({ prompt: 'test pad', seconds: 1 });
    expect(clip.file.name.endsWith('.wav')).toBe(true);
  });
  it('parses automix prompt commands', async () => {
    const { parseDjPrompt } = await import('../src/ui/dj/set-planner');
    expect(parseDjPrompt('automix start')).toEqual({ kind: 'automix', action: 'start' });
    expect(parseDjPrompt('automix stop')).toEqual({ kind: 'automix', action: 'stop' });
    expect(parseDjPrompt('automix next')).toEqual({ kind: 'automix', action: 'next' });
  });
});

describe('lyria session', () => {
  it('normalizes weighted prompts', async () => {
    const { normalizePrompts } = await import('../src/ui/dj/lyria-session');
    expect(normalizePrompts([
      { text: '  house  ', weight: 1.5 },
      { text: '', weight: 1 },
      { text: 'x', weight: 0 },
    ])).toEqual([{ text: 'house', weight: 1 }]);
  });
  it('decodes pcm chunks', async () => {
    const { decodeChunk } = await import('../src/ui/dj/lyria-session');
    // stereo frame: L=16384 (0.5), R=-16384 (-0.5)
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0]);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    const [l, r] = decodeChunk(btoa(bin), 2);
    expect(l[0]).toBeCloseTo(0.5, 5);
    expect(r[0]).toBeCloseTo(-0.5, 5);
  });
});

describe('lyria models', () => {
  it('validates model ids and parses interactions responses', async () => {
    const g = await import('../src/ui/dj/ai-generate');
    expect(g.isLyriaModel('lyria-3.5')).toBe(true);
    expect(g.isLyriaModel('lyria-3-clip-preview')).toBe(true);
    expect(g.isLyriaModel('lyria-realtime-exp')).toBe(false);
    expect(g.isLyriaModel('pad')).toBe(false);
    expect(g.parseInteractions({ audioBase64: 'AAA=', mimeType: 'audio/mp3', lyrics: 'la' })).toEqual({
      audioBase64: 'AAA=', mimeType: 'audio/mp3', lyrics: 'la',
    });
    expect(g.parseInteractions({})).toBe(null);
    expect(g.parseInteractions(null)).toBe(null);
  });
});
