import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {createStation,Store,validateSettings} from '../server.mjs';
const TOKEN='test-administrator-token-with-at-least-24-chars';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'webdec-server-'));}
async function request(url,route,method='GET',data,auth=true){const r=await fetch(url+route,{method,headers:{...(auth?{Authorization:'Bearer '+TOKEN}:{}),'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};}
function fakeEngine(){return {clients:new Set(),failed:new Set(),running:false,now:'Offline',status(){return {running:this.running,now:this.now,listeners:0,forecastBusy:false};},start(){this.running=true;},stop(){this.running=false;}};}
test('authentication, origin policy, durable remote station switch, and validation',async()=>{
  const dir=temporary(),app=createStation({token:TOKEN,dataDir:dir,engine:fakeEngine(),adminOrigins:'https://admin.example'});
  try{const address=await app.start(0,'127.0.0.1'),url='http://127.0.0.1:'+address.port;
    assert.equal((await request(url,'/api/state','GET',undefined,false)).status,401);
    const evil=await fetch(url+'/api/state',{headers:{Authorization:'Bearer '+TOKEN,Origin:'https://evil.example'}});assert.equal(evil.status,403);
    assert.equal((await request(url,'/api/station','POST',{enabled:true})).status,200);
    assert.equal((await request(url,'/api/state')).data.status.running,true);
    assert.equal(new Store(dir).state.enabled,true,'desired on state survives admin disconnect and restart');
    const saved=(await request(url,'/api/state')).data.settings;
    assert.throws(()=>validateSettings({...saved,latitude:120}));
    assert.equal((await request(url,'/api/station','POST',{enabled:false})).status,200);
    assert.equal(new Store(dir).state.enabled,false);
  }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
const ffmpegAvailable=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
test('continuous real MP3 stream, uploaded loop, queued interruption and remote off switch',{skip:!ffmpegAvailable,timeout:20000},async()=>{
  const dir=temporary();let app;
  try{
    const loop=path.join(dir,'test-loop.wav'),spoken=path.join(dir,'test-announcement.wav');
    for(const [file,seconds,hz]of [[loop,8,220],[spoken,.5,880]])assert.equal(spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`sine=frequency=${hz}:duration=${seconds}`,'-y',file]).status,0);
    app=createStation({token:TOKEN,dataDir:dir,engineOptions:{renderSpeech:async(_text,file)=>fs.copyFileSync(spoken,file)}});
    app.store.state.settings.automatic=false;app.store.save();const address=await app.start(0,'127.0.0.1'),url='http://127.0.0.1:'+address.port;
    const upload=await fetch(url+'/api/upload?name=loop.wav',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/octet-stream'},body:fs.readFileSync(loop)});assert.equal(upload.status,201);
    await request(url,'/api/station','POST',{enabled:true});
    const stream=await fetch(url+'/stream.mp3');assert.equal(stream.status,200);assert.match(stream.headers.get('Content-Type'),/audio\/mpeg/);
    const chunks=[],reader=stream.body.getReader();const collect=(async()=>{while(true){const {done,value}=await reader.read();if(done)break;chunks.push(Buffer.from(value));}})();
    await delay(1600);
    const announce=await request(url,'/api/messages','POST',{title:'Test announcement',text:'Test message.'});assert.equal(announce.status,201);
    for(let i=0;i<35&&!app.store.state.history.length;i++)await delay(100);
    assert.equal(app.store.state.history[0]?.status,'played');assert.equal(app.store.state.queue.length,0);
    assert.equal(app.store.state.tracks.length,1,'loop remains available');assert.equal(app.engine.running,true);
    await delay(700);
    await request(url,'/api/station','POST',{enabled:false});await collect;
    assert.equal(app.engine.clients.size,0);assert.equal(app.engine.running,false);
    const recording=path.join(dir,'stream.mp3');fs.writeFileSync(recording,Buffer.concat(chunks));
    assert.ok(fs.statSync(recording).size>10000,'real MP3 audio was streamed');
    const decode=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',recording,'-f','null','-']);assert.equal(decode.status,0,'stream decodes as audio');
    assert.equal((await fetch(url+'/stream.mp3')).status,503,'off means no stream');
  }finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('portable HTML is standalone and all referenced controls exist',()=>{
  const html=fs.readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);const markup=html.slice(0,html.indexOf('<script>')),ids=[...markup.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(m[1]),'missing control '+m[1]);
  assert.ok(!/apple weather|tbapple|AppleWeather/i.test(html));assert.match(html,/continues running when this administration page is closed/);
});
