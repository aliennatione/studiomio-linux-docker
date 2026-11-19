/** Self-hosted adapters (task 4.2): Plex / Navidrome / Jellyfin / Subsonic. Browse-only; playback via local files. */
import type { BrowserItem, BrowserSource } from '../item';
import { emptySource, type OnlineSourceAdapter, type SourceConfig } from './types';

async function getJSON(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const trackItem = (prefix: string, name: string, hint?: string): BrowserItem => ({
  id: `${prefix}/${name}`, name, icon: 'sample', hint,
});

function serverSource(id: string, label: string, kind: 'plex' | 'navidrome' | 'jellyfin' | 'subsonic', config?: SourceConfig): BrowserSource {
  if (!config?.url) return emptySource(id, label, `Configura ${label}: serve l'URL del server.`);
  const base = config.url.replace(/\/$/, '');
  return {
    id, label, section: 'places',
    items: async () => {
      try {
        if (kind === 'plex') {
          const data = (await getJSON(`${base}/library/sections`, { Accept: 'application/json' })) as { MediaContainer?: { Directory?: Array<{ title?: string }> } };
          const dirs = data?.MediaContainer?.Directory ?? [];
          return dirs.map((d, i) => trackItem(id, d.title ?? `Section ${i + 1}`));
        }
        if (kind === 'jellyfin') {
          const data = (await getJSON(`${base}/Items?IncludeItemTypes=Audio&Recursive=true&Limit=200`, config.token ? { 'X-Emby-Token': config.token } : {})) as { Items?: Array<{ Name?: string; AlbumArtist?: string }> };
          return (data?.Items ?? []).slice(0, 200).map((t, i) => trackItem(id, t.Name ?? `Track ${i + 1}`, t.AlbumArtist));
        }
        // Navidrome + Subsonic share the Subsonic API
        const params = `u=token&p=${encodeURIComponent(config.token ?? '')}&v=1.16.1&c=studiomio&f=json`;
        const data = (await getJSON(`${base}/rest/search3.view?${params}&query=&songCount=200`)) as { 'subsonic-response'?: { searchResult3?: { song?: Array<{ title?: string; artist?: string }> } } };
        const songs = data?.['subsonic-response']?.searchResult3?.song ?? [];
        return songs.map((s, i) => trackItem(id, s.title ?? `Track ${i + 1}`, s.artist));
      } catch {
        return [];
      }
    },
  };
}

export const plexAdapter: OnlineSourceAdapter = {
  id: 'plex', label: 'Plex',
  source: (c) => serverSource('plex', 'Plex', 'plex', c),
  probe: async (c) => { if (!c?.url) return false; try { await getJSON(`${c.url.replace(/\/$/, '')}/identity.json`); return true; } catch { return false; } },
};

export const navidromeAdapter: OnlineSourceAdapter = {
  id: 'navidrome', label: 'Navidrome',
  source: (c) => serverSource('navidrome', 'Navidrome', 'navidrome', c),
};

export const jellyfinAdapter: OnlineSourceAdapter = {
  id: 'jellyfin', label: 'Jellyfin',
  source: (c) => serverSource('jellyfin', 'Jellyfin', 'jellyfin', c),
};

export const subsonicAdapter: OnlineSourceAdapter = {
  id: 'subsonic', label: 'Subsonic',
  source: (c) => serverSource('subsonic', 'Subsonic', 'subsonic', c),
};

export const selfHostedAdapters = [plexAdapter, navidromeAdapter, jellyfinAdapter, subsonicAdapter];
