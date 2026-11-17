import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

function request(port, path, opts={}) {
  return new Promise((resolve,reject)=>{
    const req = http.request({hostname:'127.0.0.1',port,path,method:opts.method||'GET',headers:opts.headers||{}},res=>{
      let body=''; res.on('data',d=>body+=d); res.on('end',()=>resolve({status:res.statusCode,body}));
    });
    req.on('error',reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('remote server api', async (t) => {
  const port = 8123;
  const proc = spawn(process.execPath, ['scripts/remote-server.mjs'], {env:{...process.env,PORT:port,REMOTE_TOKEN:'secret',STATIC_DIR:'/tmp/nonexistent'},stdio:'ignore'});
  await new Promise(r=>setTimeout(r,500));
  t.after(()=>proc.kill());

  let r = await request(port,'/status');
  assert.equal(r.status,200);

  r = await request(port,'/command',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer wrong'},body:JSON.stringify({action:'reload'})});
  assert.equal(r.status,401);

  r = await request(port,'/command',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer secret'},body:'{bad'});
  assert.equal(r.status,400);

  r = await request(port,'/command',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer secret'},body:JSON.stringify({action:'reload'})});
  assert.equal(r.status,200);

  r = await request(port,'/pending',{headers:{'Authorization':'Bearer secret'}});
  assert.equal(r.status,200);
  assert.match(r.body,/reload/);

  r = await request(port,'/pending',{headers:{'Authorization':'Bearer secret'}});
  assert.equal(r.status,200);
  assert.match(r.body,/null/);
});
