// Lyria Realtime relay (pattern zip remix-promptdj/server.ts, minimal).
// WS endpoint for the DJ app: connect_music / weighted prompts / playback control.
// Requires GEMINI_API_KEY. Model allowlist: lyria-realtime-exp only.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';

const PORT = Number(process.env.LYRIA_PORT || 8091);
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL_RE = /^(models\/)?lyria-realtime-exp$/;

const safeSend = (ws, payload) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
};

const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, hasKey: Boolean(KEY), model: 'lyria-realtime-exp' }));
    return;
  }
  res.statusCode = 404; res.end('lyria-relay: use WebSocket');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  if (!KEY) {
    safeSend(ws, { type: 'error', message: 'GEMINI_API_KEY is not configured on the server.' });
    ws.close(1011, 'Missing GEMINI_API_KEY');
    return;
  }
  let session = null;
  let ready = false;
  const queue = [];

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { safeSend(ws, { type: 'error', message: 'Invalid JSON' }); return; }
    try {
      if (msg.type === 'connect_music') {
        const model = typeof msg.model === 'string' && MODEL_RE.test(msg.model) ? msg.model : 'models/lyria-realtime-exp';
        const ai = new GoogleGenAI({ apiKey: KEY });
        session = await ai.live.music.connect({
          model,
          callbacks: {
            onmessage: (m) => safeSend(ws, { type: 'message', data: JSON.parse(JSON.stringify(m)) }),
            onerror: (e) => safeSend(ws, { type: 'error', message: e?.message || String(e) }),
            onclose: () => safeSend(ws, { type: 'close' }),
          },
        });
        ready = true;
        safeSend(ws, { type: 'connected' });
        for (const q of queue.splice(0)) await dispatch(q);
        return;
      }
      if (!ready || !session) { queue.push(msg); return; }
      await dispatch(msg);
    } catch (e) {
      safeSend(ws, { type: 'error', message: e?.message || String(e) });
    }
  });

  async function dispatch(msg) {
    if (!session) return;
    switch (msg.type) {
      case 'setWeightedPrompts':
        await session.setWeightedPrompts({ weightedPrompts: msg.params?.weightedPrompts ?? [] });
        break;
      case 'setMusicGenerationConfig':
        await session.setMusicGenerationConfig({ musicGenerationConfig: msg.params ?? {} });
        break;
      case 'play': session.play(); break;
      case 'pause': session.pause(); break;
      case 'stop': session.stop(); break;
      case 'resetContext': session.resetContext(); break;
      case 'close': try { session.close(); } catch {} ws.close(); break;
      default: safeSend(ws, { type: 'error', message: `Unknown command: ${msg.type}` });
    }
  }

  ws.on('close', () => { try { session?.close(); } catch {} });
});

server.listen(PORT, () => console.log(`lyria-relay on :${PORT} (key: ${KEY ? 'on' : 'MISSING'})`));
