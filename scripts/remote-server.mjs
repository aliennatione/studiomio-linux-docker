import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.REMOTE_TOKEN || '';
const ALLOW = (process.env.ALLOW_ORIGINS || '*').split(',').map(s=>s.trim()).filter(Boolean);
const STATIC_DIR = process.env.STATIC_DIR || path.join(process.cwd(), 'dist');
let pending = null;
let state = {};
let schema = { methods: [], paths: [] };
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
const PROJECTS_DIR = process.env.PROJECTS_DIR || '/app/projects';
try { mkdirSync(PROJECTS_DIR, { recursive: true }); } catch {}

function validateCommand(body) {
  let cmd;
  try { cmd = JSON.parse(body); } catch { return null; }
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  if (!['reload','invoke','set','command'].includes(cmd.action)) return null;
  if (cmd.action === 'invoke' && typeof cmd.method !== 'string') return null;
  if (cmd.action === 'set' && typeof cmd.path !== 'string') return null;
  if (cmd.action === 'command' && typeof cmd.name !== 'string') return null;
  return cmd;
}

const openapi = {
  openapi: '3.0.3',
  info: { title: 'studiomio remote control', version: '1' },
  paths: {
    '/status': { get: { summary: 'status', responses: { '200': { description: 'ok' } } } },
    '/command': { post: { summary: 'queue command', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'queued' }, '400': { description: 'invalid' }, '401': { description: 'unauthorized' } } } },
    '/pending': { get: { summary: 'consume pending command', security: [{ bearerAuth: [] }], responses: { '200': { description: 'command' }, '401': { description: 'unauthorized' } } } },
    '/controls': { get: { summary: 'control inventory hint', responses: { '200': { description: 'hint' } } } }
  },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }
};

const server = http.createServer((req,res)=>{
  const origin = req.headers.origin || '';
  if (ALLOW.includes('*') || ALLOW.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if (req.method === 'OPTIONS') { res.statusCode=204; res.end(); return; }

  if (req.url === '/status') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true}));
    return;
  }
  if (req.url === '/openapi.json') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(openapi));
    return;
  }
  if (req.url === '/docs') {
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><html><body><pre>OpenAPI: /openapi.json</pre></body></html>');
    return;
  }
  if (req.url === '/command' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      const cmd = validateCommand(body);
      if (!cmd) { res.statusCode=400; res.end('invalid command'); return; }
      pending = body;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({received:body, queued:true}));
    });
    return;
  }

  if (req.url === '/pending' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    res.setHeader('Content-Type','application/json');
    const out = pending; pending = null;
    res.end(JSON.stringify({command: out}));
    return;
  }

  if (req.url === '/controls') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({note:'use invoke/set with names from app.controls()'}));
    return;
  }

  // state snapshot
  if (req.url === '/state' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({state})); return;
  }
  if (req.url === '/state' && req.method === 'PUT') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      try { state = JSON.parse(body); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true})); }
      catch { res.statusCode=400; res.end('invalid json'); }
    }); return;
  }
  // dispatch command
  if (req.url === '/dispatch' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      const cmd = validateCommand(body);
      if (!cmd) { res.statusCode=400; res.end('invalid command'); return; }
      pending = body; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({dispatched:true, queued:true}));
    }); return;
  }
  // projects CRUD
  if (req.url === '/projects' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    const files = existsSync(PROJECTS_DIR) ? readdirSync(PROJECTS_DIR).filter(f=>f.endsWith('.json')) : [];
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({projects:files})); return;
  }
  if (req.url.startsWith('/projects/') && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    const name = decodeURIComponent(req.url.slice('/projects/'.length));
    const fp = path.join(PROJECTS_DIR, name.endsWith('.json')?name:name+'.json');
    if (!existsSync(fp)) { res.statusCode=404; res.end('not found'); return; }
    res.setHeader('Content-Type','application/json'); res.end(readFileSync(fp,'utf8')); return;
  }
  if (req.url.startsWith('/projects/') && req.method === 'PUT') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    const name = decodeURIComponent(req.url.slice('/projects/'.length));
    const fp = path.join(PROJECTS_DIR, name.endsWith('.json')?name:name+'.json');
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      try { JSON.parse(body); writeFileSync(fp,body); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({saved:true})); }
      catch { res.statusCode=400; res.end('invalid json'); }
    }); return;
  }
  if (req.url.startsWith('/projects/') && req.method === 'DELETE') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    const name = decodeURIComponent(req.url.slice('/projects/'.length));
    const fp = path.join(PROJECTS_DIR, name.endsWith('.json')?name:name+'.json');
    if (existsSync(fp)) unlinkSync(fp);
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({deleted:true})); return;
  }

  // register app schema (for total-control parity)
  if (req.url === "/register" && req.method === "POST") {
    const auth = req.headers.authorization || "";
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end("unauthorized"); return; }
    let body=""; req.on("data",d=>body+=d); req.on("end",()=>{ try { schema=JSON.parse(body); res.setHeader("Content-Type","application/json"); res.end(JSON.stringify({ok:true})); } catch { res.statusCode=400; res.end("invalid json"); } }); return;
  }
  if (req.url === "/schema" && req.method === "GET") {
    const auth = req.headers.authorization || "";
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end("unauthorized"); return; }
    res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(schema)); return;
  }

  // static files
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  const types = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  fs.readFile(filePath, (err,data)=>{
    if (err) { res.statusCode=404; res.end('not found'); return; }
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(PORT, ()=>console.log(`studiomio listening on ${PORT}`));
