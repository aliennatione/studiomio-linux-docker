# DJ mode (MVP)

Modalità DJ in studiomio: `Arrangement / Session / DJ` (pulsante `🎧 DJ` nel transport).

## Deck
- Carica un file audio per deck (file picker): analisi AI (BPM/key/genre/energy) con cache per hash; fallback euristico offline.
- Play/Pause, Cue (reset), seek, pitch ±50%, loop 4 beat, 4 hot cue per deck (set/jump).
- Campi BPM e Key editabili; l'AI meta alimenta sync e suggerimenti.

## Mixer
- Crossfader equal-power A/B. Sync A→B / B→A allinea il playback rate al BPM dell'altro deck.

## Prompt & suggerimenti live
- Barra prompt: `play A`, `pause both`, `cue A`, `sync B`, `cross middle|left|right|0-100`, `pitch A +2%`, `suggest`.
- Suggerimenti live: score armonico (Camelot) + energy flow + tolleranza BPM.

## AI proxy (opzionale)
- `npm run ai-proxy` avvia `scripts/ai-proxy.mjs` (`AI_PROXY_PORT`, default 8099).
- Con `GEMINI_API_KEY` usa Gemini (`GEMINI_MODEL`, default `gemini-2.0-flash`), altrimenti euristica.
- `GET /status`, `POST /analyze { name, hash, durationSec }`.
- Nell'app, la URL del proxy è salvata in `localStorage` (`dj-ai-proxy-url`) e usata da `analyzeTrack` con cache `dj-ai-meta:<hash>`.

## Sorgenti online (browse)
- `src/browser/sources/`: adapter `OnlineSourceAdapter`.
- Self-hosted: Plex / Navidrome / Jellyfin / Subsonic (serve URL server, token dove richiesto).
- Streaming (solo browsing, no playback): Spotify / TIDAL / SoundCloud.
- Playlist: import M3U8/PLS/XSPF. Librerie DJ: rekordbox XML, Traktor NML, VirtualDJ XML, Mixxx CSV/JSON.

## Controller
- `src/control/dj/dj-controller.ts`: mappa MIDI di default (note transport/hot cue/loop, CC pitch/crossfader).
- `src/control/dj/mixxx-mapping.ts`: parser mapping Mixxx XML → binding DJ.
- Nota licenze: codice DJ scritto ex novo; opendj è GPL-2.0, solo idee, nessun codice copiato.

## Automix (6.x, stile Mixxx 9.x)
- Pannello Automix: aggiungi file in coda, riordino AI (`AI order` = harmonic + energy flow), fade configurabile (2–30 s, default 8), Start/Stop/Next.
- Transizioni: preload del prossimo brano sul deck libero, sync BPM, normalizzazione gain sul picco, crossfade lineare; a fine mix il deck vecchio si ferma.
- Fallback manuale: coda vuota o caricamento fallito → automix OFF con avviso, i deck restano controllabili a mano.
- Prompt: `automix start|stop|next`. Remote control: metodi app `djCommand(text)` e `djAutomix(action)` invocabili via `/command` → `invoke` (es. `{"action":"invoke","method":"djAutomix","args":["start"]}`); in produzione `window.studiomio` espone solo `surfaces`, da console dev c'è tutta l'app.

## AI audio generation (8.x)
- Pannello `AI audio`: prompt + secondi + deck → genera clip e la carica nel deck (con analisi AI).
- `POST /generate { prompt, seconds }` su `ai-proxy` → `{ wavBase64, sampleRate, name }`; con `GENERATE_BACKEND_URL` fa proxy a un backend, altrimenti pad sintetico deterministico. Senza proxy, sintesi offline nel browser (stesso algoritmo, `synthPad`).

## Lyria live (pattern zip remix-promptdj, 8.x)
- Come negli zip: generazione musicale realtime via **Lyria** (`lyria-realtime-exp`) con weighted prompts, non clip statiche.
- Relay: `npm run lyria-relay` (`scripts/lyria-relay.mjs`, `LYRIA_PORT` default 8091, `GEMINI_API_KEY` richiesta) — replica `server.ts` degli zip: WebSocket che inoltra `connect_music` / `setWeightedPrompts` / `setMusicGenerationConfig` / `play|pause|stop` a `@google/genai` (`ai.live.music.connect`).
- Client: `src/ui/dj/lyria-session.ts` — replica il flow di `index.tsx` degli zip: chunk audio base64 → decode PCM → scheduling gapless (`nextStartTime` + buffer 2 s) → `onChunk`/stati/filtri.
- Pannello `Lyria live (zip)` in DJ view: URL relay, lista prompt + pesi, Play/Pause/Stop, config (BPM/density/brightness), invio prompt, **Cattura 8s → Deck B** (chunk recenti → WAV → deck + analisi AI).
- Nota licenze: `genaiProxy.ts`/`server.ts` degli zip sono Apache-2.0 (analysis, mai copiati nel repo); il nostro relay/client è scritto ex novo sullo stesso protocollo.

## Modelli recenti (Lyria 3.5 / 3 Clip)
- Verificati su https://ai.google.dev/gemini-api/docs/music-generation : realtime resta `lyria-realtime-exp`; i nuovi modelli sono **Lyria 3.5** (`lyria-3.5`, brani interi di un paio di minuti, 44.1 kHz stereo MP3) e **Lyria 3 Clip** (`lyria-3-clip-preview`, clip 30 s) via **Interactions API** (`client.interactions.create({model, input})` → `output_audio.data` + `output_text` con testo/struttura).
- `POST /interactions` in `ai-proxy` (allowlist modelli, `GEMINI_API_KEY` richiesta) + client `generateLyriaClip`/`parseInteractions`/`isLyriaModel` in `ai-generate.ts`.
- Pannello AI audio: selettore modello (Pad offline / Lyria 3 Clip / Lyria 3.5); il testo generato è mostrato nello stato; senza proxy/chiave si usa il pad offline.
