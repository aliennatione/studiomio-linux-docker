/** Platform imports (mypromptdj PlatformService, rewritten): iTunes search with playable 30s previews,
 *  URL resolve via oEmbed (Spotify/SoundCloud/YouTube/Apple), direct MP3, curated crates. No API keys. */
import type { BrowserItem, BrowserSource } from '../item';
import { toCamelot } from '../../model/ai-meta';

export interface PlatformTrack {
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly coverUrl?: string;
  /** Playable preview/stream URL (iTunes 30s previews are playable). */
  readonly previewUrl: string;
  readonly durationSec?: number;
  readonly platform: 'apple' | 'spotify' | 'soundcloud' | 'youtube' | 'direct';
  readonly bpm: number;
  readonly key: string;
  readonly energy: number;
  readonly genre: string;
}

const GENRE_BPM: Array<[RegExp, number, number]> = [
  [/house|dance|edm/i, 124, 0.8], [/techno/i, 132, 0.85], [/trance/i, 138, 0.85],
  [/drum.*bass|dnb|jungle/i, 174, 0.9], [/dubstep/i, 140, 0.85], [/hip.?hop|rap/i, 95, 0.6],
  [/pop/i, 115, 0.6], [/rock/i, 120, 0.7], [/ambient|chill|lofi/i, 90, 0.35],
  [/disco|funk/i, 115, 0.7], [/reggae|dub(?!step)/i, 95, 0.55],
];

function guessGenre(genre: string): { bpm: number; energy: number } {
  for (const [re, bpm, energy] of GENRE_BPM) if (re.test(genre)) return { bpm, energy };
  return { bpm: 120, energy: 0.6 };
}

/** iTunes Search API: CORS-enabled, full metadata + 30s previews. */
export async function itunesSearch(query: string, limit = 20): Promise<PlatformTrack[]> {
  if (!query.trim()) return [];
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${Math.min(50, limit)}`);
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).filter(r => typeof r.previewUrl === 'string').map(r => {
    const genre = String(r.primaryGenreName ?? 'Dance');
    const g = guessGenre(genre);
    return {
      title: String(r.trackName ?? 'Untitled'),
      artist: String(r.artistName ?? 'Unknown'),
      album: typeof r.collectionName === 'string' ? r.collectionName : undefined,
      coverUrl: typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace('100x100bb', '600x600bb') : undefined,
      previewUrl: String(r.previewUrl),
      durationSec: 30,
      platform: 'apple' as const,
      bpm: g.bpm, key: toCamelot('Am'), energy: g.energy, genre,
    };
  });
}

async function oembed(url: string): Promise<{ title?: string; thumbnail?: string } | null> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { title?: string; thumbnail_url?: string };
    return { title: d.title, thumbnail: d.thumbnail_url };
  } catch { return null; }
}

/** Resolve a platform/direct URL to a playable track (oEmbed + iTunes match, like mypromptdj). */
export async function resolveUrl(inputUrl: string): Promise<PlatformTrack> {
  const url = inputUrl.trim();
  if (/\.(mp3|m4a|wav|ogg|opus|flac)(\?|$)/i.test(url)) {
    const name = decodeURIComponent(url.split('/').pop()!.split('?')[0].replace(/\.[^.]+$/, ''));
    return {
      title: name, artist: 'Direct link', previewUrl: url, platform: 'direct',
      bpm: 120, key: toCamelot('Am'), energy: 0.6, genre: 'Direct',
    };
  }
  const meta = await oembed(url);
  const title = meta?.title ?? 'Platform track';
  const host = new URL(url).hostname;
  const platform = host.includes('spotify') ? 'spotify' as const
    : host.includes('soundcloud') ? 'soundcloud' as const
    : host.includes('youtube') || host.includes('youtu.be') ? 'youtube' as const : 'apple' as const;
  const matches = await itunesSearch(title, 3).catch(() => []);
  if (matches.length) return { ...matches[0], title, coverUrl: meta?.thumbnail ?? matches[0].coverUrl, platform };
  return {
    title, artist: platform, previewUrl: '', platform,
    bpm: 125, key: '8A', energy: 0.8, genre: 'Pop / Dance',
  };
}

/** Fetch a preview URL into a File (for deck loading). */
export async function previewFile(track: PlatformTrack): Promise<File> {
  if (!track.previewUrl) throw new Error('Nessuna anteprima riproducibile per questo brano.');
  const res = await fetch(track.previewUrl);
  if (!res.ok) throw new Error(`Preview HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = blob.type.includes('mpeg') ? 'mp3' : blob.type.includes('wav') ? 'wav' : 'mp3';
  return new File([blob], `${track.artist} - ${track.title}.${ext}`.slice(0, 120), { type: blob.type || 'audio/mpeg' });
}

export interface CuratedCrate {
  readonly name: string;
  readonly query: string;
}

export const CURATED_CRATES: readonly CuratedCrate[] = [
  { name: 'House Essentials', query: 'house essentials' },
  { name: 'Techno Peak', query: 'techno banger' },
  { name: 'Disco Funk', query: 'disco funk' },
  { name: 'LoFi Chill', query: 'lofi chill' },
  { name: 'Hip-Hop Classics', query: 'hip hop classics' },
  { name: 'Trance Anthems', query: 'trance anthem' },
];

const toItem = (t: PlatformTrack, prefix: string): BrowserItem => ({
  id: `${prefix}/${t.artist} - ${t.title}`,
  name: `${t.artist} — ${t.title}`,
  icon: 'sample',
  hint: `${t.bpm} BPM · 0:30`,
  payload: { kind: 'file', name: `${t.artist} - ${t.title}`, file: () => previewFile(t) },
});

/** Browser source: curated crates (children resolve via iTunes live). */
export function platformSource(): BrowserSource {
  return {
    id: 'dj-online', label: 'DJ Online', section: 'places',
    items: async () => CURATED_CRATES.map((c): BrowserItem => ({
      id: `dj-online/${c.name}`, name: c.name, icon: 'folder',
      children: async () => (await itunesSearch(c.query, 20).catch(() => [] as PlatformTrack[]))
        .map(t => toItem(t, `dj-online/${c.name}`)),
    })),
  };
}
