/** Playlist import: M3U8/PLS/XSPF (task 4.4). Pure parsers → track paths/URLs. */

export interface PlaylistEntry {
  readonly path: string;
  readonly title?: string;
  readonly durationSec?: number;
}

function clean(line: string): string {
  return line.replace(/\r$/, '').trim();
}

/** M3U/M3U8: #EXTINF lines + media lines; skips comments. */
export function parseM3U(text: string): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  let pending: { title?: string; durationSec?: number } = {};
  for (const raw of text.split('\n')) {
    const line = clean(raw);
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const m = /^#EXTINF:(-?\d+(?:\.\d+)?),(.*)$/.exec(line);
      pending = { durationSec: m ? Math.max(0, parseFloat(m[1])) : undefined, title: m?.[2]?.trim() || undefined };
      continue;
    }
    if (line.startsWith('#')) continue;
    out.push({ path: line, ...pending });
    pending = {};
  }
  return out;
}

/** PLS (INI con FileN/TitleN/LengthN). */
export function parsePLS(text: string): PlaylistEntry[] {
  const files = new Map<number, PlaylistEntry>();
  for (const raw of text.split('\n')) {
    const line = clean(raw);
    const m = /^(File|Title|Length)(\d+)=(.*)$/i.exec(line);
    if (!m) continue;
    const [, kind, num, value] = m;
    const i = parseInt(num, 10);
    const cur = files.get(i) ?? { path: '' };
    if (kind.toLowerCase() === 'file') files.set(i, { ...cur, path: value.trim() });
    else if (kind.toLowerCase() === 'title') files.set(i, { ...cur, title: value.trim() || undefined });
    else files.set(i, { ...cur, durationSec: Math.max(0, parseInt(value.trim(), 10) || 0) || undefined });
  }
  return [...files.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e).filter(e => e.path);
}

/** XSPF (XML trackList). Minimal tag parser, no DOM dependency. */
export function parseXSPF(text: string): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  const tracks = text.match(/<track[\s>][\s\S]*?<\/track>/gi) ?? [];
  const tag = (xml: string, name: string): string | undefined => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
    return m?.[1]?.trim() || undefined;
  };
  for (const t of tracks) {
    const location = tag(t, 'location');
    if (!location) continue;
    let path = location;
    try { path = decodeURIComponent(location.replace(/^file:\/\//, '')); } catch { /* keep raw */ }
    const dur = tag(t, 'duration');
    out.push({ path, title: tag(t, 'title'), durationSec: dur ? Math.max(0, Math.round(parseInt(dur, 10) / 1000)) : undefined });
  }
  return out;
}

export function parsePlaylist(name: string, text: string): PlaylistEntry[] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pls')) return parsePLS(text);
  if (lower.endsWith('.xspf')) return parseXSPF(text);
  return parseM3U(text); // .m3u / .m3u8 default
}
