import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {PaulTts} from './paul-tts.mjs';
import {audioFilter,RadioNoise} from './audio-profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {once} from 'node:events';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const PCM_RATE=44100*4;

export class Engine {
  constructor(store,options={}){
    this.store=store;this.ffmpeg=options.ffmpeg||'ffmpeg';this.speech=options.speech||'espeak-ng';this.fetch=options.fetch||fetch;
    this.paul=new PaulTts(store,options.ttsFetch||fetch);
    this.renderSpeech=options.renderSpeech||this.synthesize.bind(this);this.clients=new Set();this.running=false;this.stopping=false;
    this.session=0;this.decoder=null;this.encoder=null;this.busy=false;this.nextForecast=0;this.now='Offline';this.error='';this.index=0;
    this.failed=new Set();this.recent=[];this.recentBytes=0;this.activePlayback=null;this.playingAlert=false;
  }
  status(){return {running:this.running,now:this.now,error:this.error,listeners:this.clients.size,nextForecast:this.nextForecast||null,forecastBusy:this.busy};}
  addListener(response){for(const chunk of this.recent)response.write(chunk);this.clients.add(response);response.on('close',()=>this.clients.delete(response));}
  publish(chunk){this.recent.push(chunk);this.recentBytes+=chunk.length;while(this.recentBytes>32768&&this.recent.length>1)this.recentBytes-=this.recent.shift().length;for(const res of this.clients){if(res.destroyed){this.clients.delete(res);continue;}if(res.writableLength>256*1024){res.destroy();this.clients.delete(res);}else res.write(chunk);}}
  async start(){
    if(this.running)return;
    this.running=true;this.stopping=false;this.error='';this.session++;this.failed.clear();this.recent=[];this.recentBytes=0;
    const session=this.session;
    this.noise=new RadioNoise(this.store.state.settings);
    const filters=audioFilter(this.store.state.settings),encoderArgs=['-hide_banner','-loglevel','error','-f','s16le','-ar','44100','-ac','2','-i','pipe:0'];if(filters)encoderArgs.push('-filter_complex',filters,'-map','[out]');encoderArgs.push('-ar','44100','-ac','2','-c:a','libmp3lame','-b:a','128k','-write_xing','0','-id3v2_version','0','-flush_packets','1','-f','mp3','pipe:1');
    this.encoder=spawn(this.ffmpeg,encoderArgs,{stdio:['pipe','pipe','pipe']});
    const encoder=this.encoder;
    encoder.stdout.on('data',data=>this.publish(data));let stderr='';encoder.stderr.on('data',d=>stderr=(stderr+d).slice(-1500));
    encoder.stdin.on('error',()=>{});
    encoder.on('error',e=>this.fail(e.message,session));encoder.on('close',code=>{if(this.running&&session===this.session)this.fail('Audio encoder exited: '+code+' '+stderr,session);});
    this.nextForecast=Date.now();this.now='Starting';
    this.forecastTimer=setInterval(()=>this.forecastTick(),1000);
    this.task=this.program(session).catch(e=>this.fail(e.message,session));
  }
  fail(message,session){if(session!==this.session)return;this.error=message;this.store.log('Engine error: '+message);this.stop();}
  stop(){this.running=false;this.stopping=true;this.session++;clearInterval(this.forecastTimer);this.nextForecast=0;this.now='Offline';this.decoder?.kill('SIGKILL');this.encoder?.stdin.destroy();this.encoder?.kill('SIGKILL');for(const res of this.clients)res.end();this.clients.clear();this.recent=[];this.recentBytes=0;}
  forecastTick(){const state=this.store.state;if(this.running&&state.settings.automatic&&Date.now()>=this.nextForecast&&!this.busy){this.nextForecast=Date.now()+state.settings.interval*60000;if(!state.queue.some(m=>m.title==='Automatic weather forecast'))this.forecast().catch(e=>{this.error=e.message;this.store.log('Forecast failed: '+e.message);});}}
  interruptForAlert(){const playback=this.activePlayback;if(playback&&!playback.isAlert){playback.interrupted=true;playback.child.stdout.destroy();playback.child.kill('SIGKILL');}this.recent=[];this.recentBytes=0;}
  async write(chunk){if(!this.running||this.encoder.stdin.destroyed)return;chunk=this.noise.process(chunk,this.playingAlert);if(!chunk.length)return;const stream=this.encoder.stdin;if(!stream.write(chunk))await new Promise(resolve=>{const done=()=>{stream.off('drain',done);stream.off('error',done);stream.off('close',done);resolve();};stream.once('drain',done);stream.once('error',done);stream.once('close',done);});}
  async play(file,offset,interruptible,volume,session,isAlert=false){
    const args=['-hide_banner','-loglevel','error','-nostdin'];if(offset>0)args.push('-ss',String(offset));
    args.push('-i',file,'-vn','-af','volume='+volume,'-ar','44100','-ac','2','-f','s16le','pipe:1');
    const child=spawn(this.ffmpeg,args,{stdio:['ignore','pipe','pipe']});this.decoder=child;const playback={child,isAlert,interrupted:false};this.activePlayback=playback;this.playingAlert=isAlert;let bytes=0,error='',spawnError;
    child.stderr.on('data',d=>error=(error+d).slice(-1000));child.on('error',e=>spawnError=e);const closed=new Promise(resolve=>child.on('close',resolve));
    const timer=setInterval(()=>{if(!isAlert&&((interruptible&&this.store.state.queue.length)||this.store.state.queue.some(m=>m.priority==='alert'))){playback.interrupted=true;child.stdout.destroy();child.kill('SIGKILL');}},50);
    try{for await(const chunk of child.stdout){if(session!==this.session||playback.interrupted)break;const begin=Date.now();await this.write(chunk);bytes+=chunk.length;await delay(Math.max(0,chunk.length/PCM_RATE*1000-(Date.now()-begin)));}}
    catch(e){if(!playback.interrupted&&session===this.session)spawnError=e;}
    finally{clearInterval(timer);if(session!==this.session||playback.interrupted)child.kill('SIGKILL');}
    const code=await closed;if(this.activePlayback===playback){this.activePlayback=null;this.playingAlert=false;}if(spawnError)throw spawnError;if(code!==0&&!playback.interrupted&&session===this.session)throw new Error(error||'Audio decode failed');
    return {offset:offset+bytes/PCM_RATE,interrupted:playback.interrupted};
  }
  async program(session){let current=null,offset=0;while(this.running&&session===this.session){
    const state=this.store.state;
    const message=state.queue[0];
    if(message){this.now=message.title;try{const result=await this.play(path.join(this.store.dir,message.file),0,false,1,session,message.priority==='alert');if(session!==this.session)break;state.queue=state.queue.filter(m=>m.id!==message.id);const status=result.interrupted?'interrupted':'played';state.history.unshift({...message,status,playedAt:new Date().toISOString()});state.history=state.history.slice(0,50);this.store.save();this.store.log('Announcement '+status+': '+message.title);fs.rmSync(path.join(this.store.dir,message.file),{force:true});}catch(e){this.store.log('Announcement failed: '+e.message);state.queue=state.queue.filter(m=>m.id!==message.id);state.history.unshift({...message,status:'failed'});this.store.save();}continue;}
    if(current&&!state.tracks.some(t=>t.id===current.id)){current=null;offset=0;}
    const available=state.tracks.filter(t=>!this.failed.has(t.id));
    if(!current&&available.length){current=available[this.index++%available.length];offset=0;}
    if(current){this.now=current.name;try{const result=await this.play(path.join(this.store.dir,current.file),offset,true,state.settings.loopVolume/100,session);offset=result.offset;if(!result.interrupted){current=null;offset=0;}}catch(e){this.failed.add(current.id);this.store.log('Loop file failed: '+current.name);current=null;await delay(500);}}
    else{this.now='Silence / no loop audio';await this.write(Buffer.alloc(PCM_RATE/4));await delay(250);}
  }}
  async synthesize(text,file){
    if(this.store.state.settings.ttsVoice==='paul'){
      try{const audio=await this.paul.audio(text),temporary=file+'.paul.wav';fs.writeFileSync(temporary,audio);try{await this.convertPaul(temporary,file);}finally{fs.rmSync(temporary,{force:true});}return;}
      catch(error){if(!this.store.state.settings.ttsFallback)throw error;this.store.log('Paul voice unavailable; using local speech: '+error.message);}
    }
    return this.synthesizeLocal(text,file);
  }
  async convertPaul(input,output){
    const speed=this.store.state.settings.speechSpeed/160,child=spawn(this.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',input,'-af','atempo='+speed,'-ar','44100','-ac','1','-c:a','pcm_s16le','-y',output],{stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',d=>errors+=d);const [code]=await once(child,'close');if(code!==0)throw new Error(errors||'Paul audio conversion failed.');
  }
  async synthesizeLocal(text,file){
    const child=spawn(this.speech,['-v','en-us','-s',String(this.store.state.settings.speechSpeed),'-w',file,'--stdin'],{stdio:['pipe','ignore','pipe']});
    const completed=once(child,'close');let stderr='';child.stderr.on('data',d=>stderr+=d);child.stdin.on('error',()=>{});child.stdin.end(text);const [code]=await completed;if(code!==0)throw new Error(stderr||'Speech synthesis failed.');
  }
  async announce(text,title='Station announcement'){
    const id=crypto.randomUUID(),temporary=path.join(this.store.dir,'queue',id+'.part.wav'),relative='queue/'+id+'.wav';
    try{await this.renderSpeech(text,temporary);fs.renameSync(temporary,path.join(this.store.dir,relative));}catch(e){fs.rmSync(temporary,{force:true});throw e;}
    const message={id,title,text,file:relative,createdAt:new Date().toISOString()};this.store.state.queue.push(message);this.store.save();this.store.log('Announcement queued: '+title);return message;
  }
  async nws(url){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='api.weather.gov')throw new Error('Invalid forecast URL.');const r=await this.fetch(url,{headers:{'User-Agent':'eas-webdec-test/1.0','Accept':'application/geo+json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('NWS returned '+r.status);return r.json();}
  async forecast(){
    if(this.busy)throw new Error('Forecast generation is already in progress.');this.busy=true;
    try{const s=this.store.state.settings,point=await this.nws('https://api.weather.gov/points/'+s.latitude.toFixed(4)+','+s.longitude.toFixed(4));if(!point.properties?.forecast)throw new Error('No NWS forecast at these coordinates.');const data=await this.nws(point.properties.forecast);const periods=data.properties?.periods?.slice(0,s.periods);if(!periods?.length)throw new Error('NWS returned no forecast periods.');const text=s.name+'. National Weather Service forecast for '+s.location+'. '+periods.map(p=>p.name+'. '+p.detailedForecast).join(' ')+' End of forecast.';const result={text,periods,issuedAt:data.properties.updateTime||data.properties.updated,generatedAt:new Date().toISOString()};await this.announce(text,'Automatic weather forecast');this.store.state.forecast=result;this.store.save();return result;}finally{this.busy=false;}
  }
}
