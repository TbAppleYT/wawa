import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
export const RATE=48000,BAUD=3125/6;
export function validateSame(input,now=new Date()){
  const origin=String(input.origin||'EAS').toUpperCase(),event=String(input.event||'RWT').toUpperCase(),sender=String(input.sender||'TEST0001').toUpperCase();
  if(!['EAS','CIV','WXR','PEP'].includes(origin))throw new Error('Invalid originator.');
  if(!/^[A-Z]{3}$/.test(event))throw new Error('Event must be three letters.');
  if(!/^[A-Z0-9/]{8}$/.test(sender))throw new Error('Sender must contain exactly eight letters, digits or slashes.');
  const locations=String(input.locations||'').split(/[\s,]+/).filter(Boolean);
  if(!locations.length||locations.length>31||locations.some(x=>!/^\d{6}$/.test(x))||new Set(locations).size!==locations.length)throw new Error('Enter 1–31 unique six-digit SAME location codes.');
  const minutes=Number(input.minutes??15);
  if(![15,30,45,60,90,120,150,180,210,240,270,300,330,360].includes(minutes))throw new Error('Choose a supported expiration interval.');
  const attention=input.attention||'none';if(!['none','1050','dual'].includes(attention))throw new Error('Invalid attention signal.');
  const text=String(input.text||'').trim();if(text.length>5000)throw new Error('Message is limited to 5,000 characters.');
  const day=Math.floor((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-Date.UTC(now.getUTCFullYear(),0,1))/86400000)+1;
  const stamp=String(day).padStart(3,'0')+String(now.getUTCHours()).padStart(2,'0')+String(now.getUTCMinutes()).padStart(2,'0');
  const expiry=String(Math.floor(minutes/60)).padStart(2,'0')+String(minutes%60).padStart(2,'0');
  return{origin,event,sender,locations,minutes,attention,text,header:`ZCZC-${origin}-${event}-${locations.join('-')}+${expiry}-${stamp}-${sender}-`};
}
export function burst(text){
  const data=Buffer.concat([Buffer.alloc(16,0xab),Buffer.from(text,'ascii')]),samples=Math.round(data.length*8*RATE/BAUD),pcm=Buffer.alloc(samples*2);
  let bitIndex=0;
  for(const byte of data)for(let bit=0;bit<8;bit++,bitIndex++){
    const start=Math.round(bitIndex*RATE/BAUD),end=Math.round((bitIndex+1)*RATE/BAUD),cycles=((byte>>bit)&1)?4:3;
    for(let n=start;n<end;n++){const fraction=(n/RATE-bitIndex/BAUD)*BAUD;pcm.writeInt16LE(Math.round(13000*Math.sin(2*Math.PI*cycles*fraction)),n*2);}
  }return pcm;
}
const silence=seconds=>Buffer.alloc(Math.round(RATE*seconds)*2);
function triplet(text){const one=burst(text);return Buffer.concat([one,silence(1),one,silence(1),one]);}
function tone(kind){if(kind==='none')return Buffer.alloc(0);const seconds=kind==='1050'?10:8,pcm=Buffer.alloc(RATE*seconds*2);for(let n=0;n<RATE*seconds;n++){const t=n/RATE,v=kind==='1050'?Math.sin(2*Math.PI*1050*t):(Math.sin(2*Math.PI*853*t)+Math.sin(2*Math.PI*960*t))/2;pcm.writeInt16LE(Math.round(12000*v),n*2);}return pcm;}
export function wav(pcm){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(RATE,24);h.writeUInt32LE(RATE*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
function voicePcm(file,command){return new Promise((resolve,reject)=>{const child=spawn(command,['-hide_banner','-loglevel','error','-i',file,'-ar',String(RATE),'-ac','1','-f','s16le','pipe:1'],{stdio:['ignore','pipe','pipe']});const chunks=[];let errors='';child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>errors+=c);child.on('error',reject);child.on('close',code=>code?reject(new Error(errors||'Speech conversion failed.')):resolve(Buffer.concat(chunks)));});}
export async function renderSame(engine,input){
  const config=validateSame(input),tmp=path.join(engine.store.dir,'queue',crypto.randomUUID()+'.voice.wav');let voice=Buffer.alloc(0);
  try{if(config.text){await engine.renderSpeech(config.text,tmp);voice=await voicePcm(tmp,engine.ffmpeg);}}finally{fs.rmSync(tmp,{force:true});}
  const signal=tone(config.attention);
  return{config,audio:wav(Buffer.concat([triplet(config.header),silence(1),signal,...(signal.length?[silence(1)]:[]),voice,...(voice.length?[silence(1)]:[]),triplet('NNNN'),silence(1)]))};
}
