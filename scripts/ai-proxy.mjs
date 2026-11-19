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

// ---- AI audio generation (task 8.1): POST /generate { prompt, seconds } -> { wavBase64, name, sampleRate }
// Uses GENERATE_BACKEND_URL when set (proxied POST, expects { wavBase64 } or raw WAV bytes);
// otherwise synthesizes a deterministic placeholder pad in-process.
const GEN_URL = process.env.GENERATE_BACKEND_URL || '';

function synthWavBase64(prompt = '', seconds = 8) {
  const sr = 22050, n = Math.max(1, Math.floor(Math.min(60, Math.max(1, seconds)) * sr));
  let h = 0x811c9dc5;
  for (const ch of String(prompt)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); }
  const root = 110 * Math.pow(2, ((h >>> 0) % 12) / 12);
  const freqs = [1, 1.25, 1.5, 2].map(r => root * r);
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.5) * Math.min(1, (n - i) / sr / 0.8);
    let s = 0;
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t) / freqs.length;
    s *= (0.7 + 0.3 * Math.sin(2 * Math.PI * 2 * t)) * env * 0.5;
    data[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(data[i], 44 + i * 2);
  return { wavBase64: buf.toString('base64'), sampleRate: sr };
}

async function handleGenerate(req, res) {
  let body = ''; req.on('data', d => body += d); req.on('end', async () => {
    try {
      const { prompt = '', seconds = 8 } = JSON.parse(body);
      if (GEN_URL) {
        const r = await fetch(GEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, seconds }) });
        if (r.ok) {
          const ct = r.headers.get('content-type') || '';
          if (ct.includes('audio/')) {
            const ab = Buffer.from(await r.arrayBuffer());
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ wavBase64: ab.toString('base64'), sampleRate: 44100, name: `${String(prompt).slice(0, 40) || 'ai-clip'}.wav` }));
            return;
          }
          const j = await r.json();
          if (j.wavBase64) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); return; }
        }
      }
      const { wavBase64, sampleRate } = synthWavBase64(prompt, Number(seconds) || 8);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ wavBase64, sampleRate, name: `${String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'ai-clip'}.wav`, placeholder: !GEN_URL }));
    } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e?.message ?? e) })); }
  });
}

// mount /generate on the existing server via listener wrap
const _listeners = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url === '/generate' && req.method === 'POST') { handleGenerate(req, res); return; }
  for (const fn of _listeners) fn(req, res);
});

// ---- Lyria 3.5 / 3 Clip via Interactions API (models: lyria-3.5, lyria-3-clip-preview)
// POST /interactions { prompt, model } -> { audioBase64 (mp3), mimeType, lyrics, name }
// Requires GEMINI_API_KEY; without key (or unknown model) returns 503/400.
const LYRIA_MODELS = ['lyria-3.5', 'lyria-3-clip-preview'];

async function handleInteractions(req, res) {
  let body = ''; req.on('data', d => body += d); req.on('end', async () => {
    try {
      const { prompt = '', model = 'lyria-3-clip-preview' } = JSON.parse(body);
      if (!LYRIA_MODELS.includes(model)) { res.statusCode = 400; res.end(JSON.stringify({ error: `Unknown model: ${model}. Use: ${LYRIA_MODELS.join(', ')}` })); return; }
      if (!KEY) { res.statusCode = 503; res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' })); return; }
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: KEY });
      const interaction = await ai.interactions.create({ model, input: String(prompt) });
      const audio = interaction.output_audio;
      const data = audio?.data;
      if (!data) { res.statusCode = 502; res.end(JSON.stringify({ error: 'No audio in interaction response.' })); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        audioBase64: data,
        mimeType: audio?.mimeType || 'audio/mp3',
        lyrics: interaction.output_text || '',
        name: `${String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'lyria'}-${model}.mp3`,
      }));
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e?.message ?? e) })); }
  });
}

{
  const _listeners = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url === '/interactions' && req.method === 'POST') { handleInteractions(req, res); return; }
    for (const fn of _listeners) fn(req, res);
  });
}

// ---- mypromptdj endpoints: /analyze-track (base64 audio -> Gemini) + /interpret-prompt (weights)
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 64 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function handleAnalyzeTrack(req, res) {
  try {
    const { audioBase64 = '', mimeType = 'audio/mpeg' } = await jsonBody(req);
    const approxBytes = Math.floor(String(audioBase64).length * 0.75);
    if (!audioBase64 || approxBytes > MAX_AUDIO_BYTES) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: !audioBase64 ? 'audioBase64 required' : `audio too large (${approxBytes} bytes, max ${MAX_AUDIO_BYTES})` }));
      return;
    }
    if (!KEY) { res.statusCode = 503; res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' })); return; }
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: audioBase64 } },
          { text: 'Analizza questa traccia musicale. Rispondi SOLO con JSON {"bpm":number,"key":string Camelot tipo "8A" o "","mood":string,"genre":string,"energy":number 0..1}.' },
        ] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!geminiRes.ok) throw new Error(`gemini ${geminiRes.status}`);
    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ?? '{}';
    let m;
    try { m = JSON.parse(text); } catch { m = {}; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      bpm: Number(m.bpm) || 120, key: String(m.key ?? ''), mood: String(m.mood ?? ''),
      genre: String(m.genre ?? ''), energy: Math.min(1, Math.max(0, Number(m.energy ?? 0.5))),
    }));
  } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e?.message ?? e) })); }
}

async function handleInterpretPrompt(req, res) {
  try {
    const { prompt = '', currentWeights = {} } = await jsonBody(req);
    if (!KEY) { res.statusCode = 503; res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' })); return; }
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text:
          `Sei un assistente DJ. Dato il prompt utente "${String(prompt).slice(0, 500)}" e i pesi attuali ${JSON.stringify(currentWeights)}, rispondi SOLO con JSON {"bpmWeight":number 0..1,"harmonicWeight":number 0..1,"energyFlow":"buildup"|"cooldown"|"wave"|"constant"}.` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!geminiRes.ok) throw new Error(`gemini ${geminiRes.status}`);
    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ?? '{}';
    let m;
    try { m = JSON.parse(text); } catch { m = {}; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      bpmWeight: Math.min(1, Math.max(0, Number(m.bpmWeight ?? currentWeights.bpmWeight ?? 0.35))),
      harmonicWeight: Math.min(1, Math.max(0, Number(m.harmonicWeight ?? currentWeights.harmonicWeight ?? 0.5))),
      energyFlow: ['buildup', 'cooldown', 'wave', 'constant'].includes(m.energyFlow) ? m.energyFlow : (currentWeights.energyFlow ?? 'buildup'),
    }));
  } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e?.message ?? e) })); }
}

{
  const _listeners = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url === '/analyze-track' && req.method === 'POST') { handleAnalyzeTrack(req, res); return; }
    if (req.url === '/interpret-prompt' && req.method === 'POST') { handleInterpretPrompt(req, res); return; }
    for (const fn of _listeners) fn(req, res);
  });
}
