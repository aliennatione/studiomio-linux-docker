import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.REMOTE_TOKEN || '';
const ALLOW = (process.env.ALLOW_ORIGINS || '*').split(',').map(s=>s.trim()).filter(Boolean);
const STATIC_DIR = process.env.STATIC_DIR || path.join(process.cwd(), 'dist');
let pending = null;

function send(res, code, body, type='text/plain') {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.end(body);
}

const openapi = {
  openapi: '3.0.3',
  info: { title: 'studiomio remote control', version: '1' },
  paths: {
    '/status': { get: { summary: 'status', responses: { '200': { description: 'ok' } } } },
    '/command': { post: { summary: 'queue command', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': { description: 'queued' }, '401': { description: 'unauthorized' } } } },
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
