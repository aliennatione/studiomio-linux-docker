// AI proxy for DJ track analysis (task 3.2). Pattern reused from scripts/remote-server.mjs.
// POST /analyze { name, hash, durationSec } -> AiMeta JSON. Requires GEMINI_API_KEY env.
// Without key, returns heuristic meta so the pipeline still works offline.
import http from 'node:http';

const PORT = process.env.AI_PROXY_PORT || 8099;
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const heuristic = (name = '', durationSec = 0) => {
  const m = String(name).match(/(\d{2,3})(?:\s*bpm)?/i);
  return { bpm: m ? Math.min(200, Math.max(60, parseInt(m[1], 10))) : 120, key: '', mood: '', genre: '', energy: 0.5, durationSec };
};

async function gemini(name, durationSec) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const prompt = `Sei un analista musicale DJ. Dato il titolo file "${name}" (durata ~${Math.round(durationSec)}s), rispondi SOLO con JSON {"bpm":number,"key":string,"mood":string,"genre":string,"energy":number(0..1)}. Stima plausibile; key in formato Camelot tipo "8A" oppure "".`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ?? '';
  const m = JSON.parse(text);
  return { bpm: Number(m.bpm) || 120, key: String(m.key ?? ''), mood: String(m.mood ?? ''), genre: String(m.genre ?? ''), energy: Math.min(1, Math.max(0, Number(m.energy ?? 0.5))) };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.url === '/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, gemini: Boolean(KEY), model: MODEL })); return; }
  if (req.url === '/analyze' && req.method === 'POST') {
    let body = ''; req.on('data', d => body += d); req.on('end', async () => {
      try {
        const { name = '', durationSec = 0 } = JSON.parse(body);
        const meta = KEY ? await gemini(name, Number(durationSec) || 0).catch(() => heuristic(name, Number(durationSec) || 0)) : heuristic(name, Number(durationSec) || 0);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(meta));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e?.message ?? e) })); }
    });
    return;
  }
  res.statusCode = 404; res.end('not found');
});
server.listen(PORT, () => console.log(`ai-proxy on :${PORT} (gemini: ${KEY ? 'on' : 'heuristic-only'})`));
