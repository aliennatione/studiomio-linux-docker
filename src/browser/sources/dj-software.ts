/** Import from DJ software libraries (task 4.5): rekordbox / Traktor / VirtualDJ / Mixxx. Pure parsers. */

export interface DjLibraryTrack {
  readonly title: string;
  readonly artist?: string;
  readonly location?: string;
  readonly bpm?: number;
  readonly key?: string;
  readonly rating?: number;
}

const attr = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return m?.[1];
};

const tags = (xml: string, tag: string): string[] =>
  xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?(?:/>|</${tag}>)`, 'gi')) ?? [];

/** rekordbox.xml: DJ_PLAYLISTS → COLLECTION TRACK. */
export function parseRekordbox(xml: string): DjLibraryTrack[] {
  return tags(xml, 'TRACK').map(t => ({
    title: attr(t, 'Name') ?? attr(t, 'Title') ?? 'Unknown',
    artist: attr(t, 'Artist'),
    location: attr(t, 'Location'),
    bpm: attr(t, 'AverageBpm') ? parseFloat(attr(t, 'AverageBpm')!) : undefined,
    key: attr(t, 'Tonality'),
    rating: attr(t, 'Rating') ? parseInt(attr(t, 'Rating')!, 10) : undefined,
  }));
}

/** Traktor .nml: ENTRY with TITLE/ARTIST + LOCATION. */
export function parseTraktor(xml: string): DjLibraryTrack[] {
  return tags(xml, 'ENTRY').map(e => {
    const loc = tags(e, 'LOCATION').at(0) ?? '';
    return {
      title: attr(e, 'TITLE') ?? attr(e, 'title') ?? 'Unknown',
      artist: attr(e, 'ARTIST'),
      location: [attr(loc, 'VOLUME'), attr(loc, 'DIR'), attr(loc, 'FILE')].filter(Boolean).join('/'),
      bpm: (() => { const b = tags(e, 'TEMPO').at(0); const v = b ? attr(b, 'BPM') : undefined; return v ? parseFloat(v) : undefined; })(),
      key: (() => { const k = tags(e, 'MUSICAL_KEY').at(0); return k ? attr(k, 'VALUE') : undefined; })(),
    };
  });
}

/** VirtualDJ database xml: Song con FilePath/Author/Title/SongLength/ZeroPos... */
export function parseVirtualDJ(xml: string): DjLibraryTrack[] {
  return tags(xml, 'Song').map(s => ({
    title: attr(s, 'Title') ?? attr(s, 'FilePath')?.split('/').pop() ?? 'Unknown',
    artist: attr(s, 'Author'),
    location: attr(s, 'FilePath'),
    bpm: attr(s, 'Bpm') ? parseFloat(attr(s, 'Bpm')!) : undefined,
    key: attr(s, 'Key'),
    rating: attr(s, 'Stars') ? parseInt(attr(s, 'Stars')!, 10) : undefined,
  }));
}

/** Mixxx: rows exported from library (location/artist/title/bpm/key). Accepts JSON or CSV with header. */
export function parseMixxx(text: string): DjLibraryTrack[] {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    const data = JSON.parse(t) as Array<Record<string, unknown>>;
    const rows = Array.isArray(data) ? data : [data];
    return rows.map(r => ({
      title: String(r.title ?? r.location ?? 'Unknown'),
      artist: r.artist ? String(r.artist) : undefined,
      location: r.location ? String(r.location) : undefined,
      bpm: r.bpm ? Number(r.bpm) : undefined,
      key: r.key ? String(r.key) : undefined,
    }));
  }
  const [header, ...lines] = t.split('\n');
  const cols = header.split(',').map(c => c.trim().toLowerCase());
  return lines.filter(l => l.trim()).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ''; });
    return {
      title: row.title || row.location || 'Unknown',
      artist: row.artist || undefined,
      location: row.location || undefined,
      bpm: row.bpm ? parseFloat(row.bpm) : undefined,
      key: row.key || undefined,
    };
  });
}
