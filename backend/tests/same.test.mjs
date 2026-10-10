import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateSame,burst,RATE,BAUD,renderSame} from '../same.mjs';
import {createStation} from '../server.mjs';
const input={origin:'EAS',event:'RWT',sender:'TEST0001',locations:'039009,039053',minutes:15,attention:'none',text:''};
test('SAME header UTC day, county limits, sender and purge validation',()=>{
 assert.equal(validateSame(input,new Date('2026-01-02T03:04:00Z')).header,'ZCZC-EAS-RWT-039009-039053+0015-0020304-TEST0001-');
 assert.throws(()=>validateSame({...input,locations:'123'}));assert.throws(()=>validateSame({...input,locations:'039009,039009'}));assert.throws(()=>validateSame({...input,sender:'TOOLONG123'}));assert.throws(()=>validateSame({...input,minutes:7}));
});
function decode(pcm){const bytes=[];const count=Math.round(pcm.length/2*BAUD/RATE/8);for(let b=0;b<count;b++){let value=0;for(let bit=0;bit<8;bit++){
 const index=b*8+bit,start=Math.round(index*RATE/BAUD),end=Math.round((index+1)*RATE/BAUD);
 const energy=frequency=>{let re=0,im=0;for(let n=start;n<end;n++){const s=pcm.readInt16LE(n*2),phase=2*Math.PI*frequency*n/RATE;re+=s*Math.cos(phase);im+=s*Math.sin(phase);}return re*re+im*im;};
 if(energy(2083.333333333)>energy(1562.5))value|=1<<bit;
 }bytes.push(value);}return Buffer.from(bytes);}
test('AFSK independently demodulates preamble and ASCII header, and WAV repeats header/EOM three times',async()=>{
 const header=validateSame(input).header;const raw=burst(header),decoded=decode(raw);assert.deepEqual(decoded.subarray(0,16),Buffer.alloc(16,0xab));assert.equal(decoded.subarray(16).toString('ascii'),header);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'same-test-'));try{
  const {config,audio}=await renderSame({store:{dir}},input);assert.equal(audio.toString('ascii',0,4),'RIFF');assert.equal(audio.readUInt32LE(24),48000);
  const pcm=audio.subarray(44),headerBytes=burst(config.header).length,gap=RATE*2;
  for(let i=0;i<3;i++)assert.equal(decode(pcm.subarray(i*(headerBytes+gap),i*(headerBytes+gap)+headerBytes)).subarray(16).toString('ascii'),config.header);
  const eomBytes=burst('NNNN').length,start=3*headerBytes+3*gap;
  for(let i=0;i<3;i++)assert.equal(decode(pcm.subarray(start+i*(eomBytes+gap),start+i*(eomBytes+gap)+eomBytes)).subarray(16).toString('ascii'),'NNNN');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('HTML routes, SAME auth, offline rejection, preview WAV and durable live queue',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'same-api-')),token='private-administrator-test-token-123456';
 const engine={clients:new Set(),failed:new Set(),running:false,store:{dir},status(){return{running:this.running};},start(){this.running=true;},stop(){this.running=false;}};
 const app=createStation({dataDir:dir,token,engine});try{
 const {port}=await app.start(0,'127.0.0.1'),base='http://127.0.0.1:'+port;
 for(const route of ['/','/admin']){const r=await fetch(base+route);assert.equal(r.status,200);assert.match(await r.text(),route==='/'?/Live Audio Reception/:/SAME Encoder/);}
 const post=(route,body,auth=true)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 assert.equal((await post('/api/same',input,false)).status,401);assert.equal((await post('/api/same',input)).status,400);
 const preview=await post('/api/same-preview',input);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'audio/wav');assert.equal(Buffer.from(await preview.arrayBuffer()).toString('ascii',0,4),'RIFF');assert.equal(app.store.state.queue.length,0);
 await post('/api/station',{enabled:true});const queued=await post('/api/same',input);assert.equal(queued.status,201);assert.equal(app.store.state.queue.length,1);assert.ok(fs.existsSync(path.join(dir,app.store.state.queue[0].file)));assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'station.json'))).queue.length,1);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
