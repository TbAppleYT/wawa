import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {PaulTts,PAUL_ENDPOINT,audioFrom} from '../paul-tts.mjs';
import {audioFilter} from '../audio-profile.mjs';
import {Engine} from '../engine.mjs';
import {wav} from '../same.mjs';
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paul-tts-'));return {dir,state:{settings:{ttsVoice:'paul',ttsFallback:true,speechSpeed:160}},save(){},log(value){this.logs.push(value);},logs:[]};}
test('Paul uses a fresh cookie/token, voice paul, WAV download, serialization and persistent cache',async()=>{
 const store=fixture(),calls=[],sample=wav(Buffer.alloc(48000));
 const mock=async(url,options)=>{calls.push({url,options});if(options.method==='POST'){const form=new URLSearchParams(options.body);assert.equal(form.get('voice'),'paul');assert.equal(form.get('xsrf'),'a+b=');assert.equal(options.headers.Cookie,'PHPSESSID=test-session');assert.equal(form.get('text'),'Test message.');return new Response('<audio><source src="cache/test_paul.wav"></audio>');}if(url===PAUL_ENDPOINT)return new Response('<input value="a+b=" name="xsrf" type="hidden">',{headers:{'Set-Cookie':'PHPSESSID=test-session; Path=/; HttpOnly'}});return new Response(sample,{headers:{'Content-Type':'audio/wav'}});};
 try{const tts=new PaulTts(store,mock),[a,b]=await Promise.all([tts.audio('Test message.'),tts.audio('Test message.')]);assert.deepEqual(a,sample);assert.deepEqual(b,sample);assert.equal(calls.length,3);assert.equal(store.state.ttsUsage.count,1);assert.deepEqual(await new PaulTts(store,()=>{throw Error('Network should not run');}).audio('Test message.'),sample);assert.throws(()=>audioFrom('<source src="https://evil.example/cache/a.wav">'));}finally{fs.rmSync(store.dir,{recursive:true,force:true});}
});
test('Paul daily limit and outage cooldown are explicit; fallback is optional and logged',async()=>{
 const store=fixture();try{store.state.ttsUsage={day:new Date().toISOString().slice(0,10),count:50};const tts=new PaulTts(store,()=>{throw Error('Should not call network');});await assert.rejects(tts.audio('New message'),/budget/);
 const engine=new Engine(store);engine.paul.audio=async()=>{throw Error('Service unavailable');};let fallback=false;engine.synthesizeLocal=async()=>{fallback=true;};await engine.synthesize('Test','unused');assert.ok(fallback);assert.match(store.logs[0],/using local speech/);store.state.settings.ttsFallback=false;await assert.rejects(engine.synthesize('Test','unused'),/Service unavailable/);
 }finally{fs.rmSync(store.dir,{recursive:true,force:true});}
});
const hasFfmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
test('quiet pink/white noise renders at a low RMS level and profile can be bypassed',{skip:!hasFfmpeg},()=>{
 assert.equal(audioFilter({radioEffect:false}),null);const filter=audioFilter({radioEffect:true,pinkNoiseDb:-55,whiteNoiseDb:-60});assert.match(filter,/color=pink/);assert.match(filter,/color=white/);
 const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','s16le','-ar','44100','-ac','2','-i','pipe:0','-filter_complex',filter,'-map','[out]','-ar','44100','-ac','1','-f','s16le','pipe:1'],{input:Buffer.alloc(44100*4),maxBuffer:5*1024*1024,timeout:15000});assert.equal(result.status,0,result.stderr.toString());let energy=0;for(let n=0;n<result.stdout.length;n+=2)energy+=(result.stdout.readInt16LE(n)/32768)**2;const rms=Math.sqrt(energy/(result.stdout.length/2)),db=20*Math.log10(rms);assert.ok(db<-50&&db>-85,'Quiet nonzero noise expected, measured '+db.toFixed(1)+' dBFS');
});
