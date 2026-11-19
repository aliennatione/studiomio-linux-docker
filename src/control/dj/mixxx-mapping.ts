/** Mixxx controller mapping parser (task 5.2, optional). Reads <MixxxControllerPreset> XML → DjMidiBinding[]. */
import type { DjMidiBinding } from './dj-controller';

const attr = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m?.[1]?.trim();
};

const hexOrDec = (s: string): number | undefined => {
  const t = s.trim();
  if (/^0x/i.test(t)) { const n = parseInt(t, 16); return isNaN(n) ? undefined : n; }
  const n = parseInt(t, 10); return isNaN(n) ? undefined : n;
};

/** Maps a Mixxx control name to a DJ action when recognizable. */
function controlToAction(control: string): DjMidiBinding['action'] | null {
  const c = control.toLowerCase();
  if (c.includes('play') && c.includes('[channel1]')) return 'playA';
  if (c.includes('play') && c.includes('[channel2]')) return 'playB';
  if (c.includes('cue') && c.includes('[channel1]')) return 'cueA';
  if (c.includes('cue') && c.includes('[channel2]')) return 'cueB';
  if (c.includes('sync') && c.includes('[channel1]')) return 'syncA';
  if (c.includes('sync') && c.includes('[channel2]')) return 'syncB';
  if (c.includes('crossfader')) return 'cross';
  if (c.includes('rate') && c.includes('[channel1]')) return 'pitchA';
  if (c.includes('rate') && c.includes('[channel2]')) return 'pitchB';
  if (c.includes('hotcue') && c.includes('[channel1]')) return 'hotCueA';
  if (c.includes('hotcue') && c.includes('[channel2]')) return 'hotCueB';
  return null;
}

export function parseMixxxMapping(xml: string): DjMidiBinding[] {
  const out: DjMidiBinding[] = [];
  const controls = xml.match(/<control[\s>][\s\S]*?<\/control>/gi) ?? [];
  for (const c of controls) {
    const status = attr(c, 'status');
    const midino = attr(c, 'midino');
    const control = attr(c, 'control') ?? '';
    const action = controlToAction(control);
    if (!action || !status || !midino) continue;
    const st = hexOrDec(status) ?? 0;
    const no = hexOrDec(midino);
    if (no === undefined) continue;
    if ((st & 0xf0) === 0x90) out.push({ note: no & 0x7f, action });
    else if ((st & 0xf0) === 0xb0) out.push({ cc: no & 0x7f, action });
  }
  return out;
}
