/** Streaming browsing adapters (task 4.3): Spotify / TIDAL / SoundCloud. Browse-only, no playback. */
import type { BrowserItem, BrowserSource } from '../item';
import type { OnlineSourceAdapter } from './types';

function stubSource(id: string, label: string, hint: string): BrowserSource {
  return {
    id, label, section: 'places', empty: hint,
    items: async () => [] as readonly BrowserItem[],
  };
}

const NO_PLAYBACK = 'Solo browsing: lo streaming non riproduce audio (serve file locale).';

export const spotifyAdapter: OnlineSourceAdapter = {
  id: 'spotify', label: 'Spotify',
  source: () => stubSource('spotify', 'Spotify', `Spotify: ${NO_PLAYBACK}`),
};

export const tidalAdapter: OnlineSourceAdapter = {
  id: 'tidal', label: 'TIDAL',
  source: () => stubSource('tidal', 'TIDAL', `TIDAL: ${NO_PLAYBACK}`),
};

export const soundcloudAdapter: OnlineSourceAdapter = {
  id: 'soundcloud', label: 'SoundCloud',
  source: () => stubSource('soundcloud', 'SoundCloud', `SoundCloud: ${NO_PLAYBACK}`),
};

export const streamingAdapters = [spotifyAdapter, tidalAdapter, soundcloudAdapter];

/** Placeholder per collegare una ricerca streaming a un file locale con lo stesso titolo. */
export function matchLocalFile(title: string, files: readonly string[]): string | null {
  const key = title.toLowerCase();
  return files.find(f => f.toLowerCase().includes(key)) ?? null;
}
