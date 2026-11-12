import http from 'node:http';
const PORT = process.env.PORT || 8787;
const TOKEN = process.env.REMOTE_TOKEN || '';
const ALLOW = (process.env.ALLOW_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
const server = http.createServer((req,res)=>{
  const origin = req.headers.origin || '';
  if (ALLOW.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary','Origin');
  }
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if (req.method === 'OPTIONS') { res.statusCode=204; res.end(); return; }
  if (req.url === '/status') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true, version:process.env.npm_package_version}));
    return;
  }
  if (req.url === '/command' && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) { res.statusCode=401; res.end('unauthorized'); return; }
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({received:body}));
    });
    return;
  }
  res.statusCode=404; res.end('not found');
});
server.listen(PORT, ()=>console.log(`remote control listening on ${PORT}`));
