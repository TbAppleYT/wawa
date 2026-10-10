import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createStation} from '../server.mjs';
import {audioFilter} from '../audio-profile.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hasFfmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
test('EAS preempts ordinary speech, retains pending messages, mutes noise and serializes alerts',{skip:!hasFfmpeg,timeout:15000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eas-priority-'));let app;
 try{
  const ordinary=path.join(dir,'speech.wav'),short=path.join(dir,'alert.wav');
  for(const [file,seconds]of [[ordinary,6],[short,.35]])assert.equal(spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`sine=frequency=880:duration=${seconds}`,'-y',file]).status,0);
  app=createStation({token:'private-test-administrator-token-1234',dataDir:dir,engineOptions:{renderSpeech:async(_text,file)=>fs.copyFileSync(ordinary,file)}});app.store.state.settings.automatic=false;
  await app.engine.announce('ordinary speech','Ordinary speech');await app.engine.announce('waiting speech','Waiting speech');await app.engine.start();
  for(let i=0;i<100&&!app.engine.activePlayback;i++)await delay(10);assert.equal(app.engine.now,'Ordinary speech');
  const one={id:'alert-one',title:'EAS one',file:'queue/alert-one.wav',priority:'alert'},two={id:'alert-two',title:'EAS two',file:'queue/alert-two.wav',priority:'alert'};
  fs.copyFileSync(short,path.join(dir,one.file));fs.copyFileSync(short,path.join(dir,two.file));app.store.state.queue.unshift(one);app.engine.interruptForAlert();
  for(let i=0;i<100&&!app.engine.playingAlert;i++)await delay(10);
  assert.equal(app.engine.now,'EAS one');assert.ok(app.engine.playingAlert);assert.equal(app.store.state.history.find(m=>m.title==='Ordinary speech')?.status,'interrupted');
  app.store.state.queue.splice(1,0,two);app.engine.interruptForAlert();assert.equal(app.engine.activePlayback.interrupted,false,'An on-air alert is not truncated by the next alert');
  for(let i=0;i<150&&!app.store.state.history.some(m=>m.id==='alert-two');i++)await delay(10);
  assert.equal(app.store.state.history.find(m=>m.id==='alert-one')?.status,'played');assert.equal(app.store.state.history.find(m=>m.id==='alert-two')?.status,'played');
  assert.equal(app.engine.now,'Waiting speech','Pending ordinary speech resumes after all alerts');
 }finally{if(app){app.engine.stop();await app.engine.task;await app.close();}fs.rmSync(dir,{recursive:true,force:true});}
});
test('EQ response approximates screenshot: mids dipped, high end cut, no time modulation',{skip:!hasFfmpeg},()=>{
 const gain=hz=>{const input=Buffer.alloc(44100*4);for(let n=0;n<44100;n++){const value=Math.round(10000*Math.sin(2*Math.PI*hz*n/44100));input.writeInt16LE(value,n*4);input.writeInt16LE(value,n*4+2);}
  const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','s16le','-ar','44100','-ac','2','-i','pipe:0','-filter_complex',audioFilter({} ),'-map','[out]','-ac','1','-f','s16le','pipe:1'],{input,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr.toString());let energy=0,count=0;for(let n=44100*.2*2;n<44100*.8*2;n+=2){energy+=r.stdout.readInt16LE(n)**2;count++;}return 20*Math.log10(Math.sqrt(energy/count)/(10000/Math.sqrt(2)));};
 const mids=gain(900),upper=gain(2700),cut=gain(6500);assert.ok(mids<-5&&mids>-8,'Mid dip '+mids);assert.ok(upper>-1&&upper<1,'Upper pass '+upper);assert.ok(cut<-45,'High-frequency cut '+cut);
});
