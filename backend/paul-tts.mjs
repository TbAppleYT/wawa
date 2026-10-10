import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const PAUL_ENDPOINT='https://wagspuzzle.space/tools/eas-tts/index.php';
const MAX_BYTES=25*1024*1024;
function entity(value){return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function attribute(tag,name){return entity(tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1]||'');}
export function xsrfFrom(html){const tag=(html.match(/<input\b[^>]*>/gi)||[]).find(t=>attribute(t,'name')==='xsrf');const value=tag&&attribute(tag,'value');if(!value)throw new Error('Paul service form changed or is unavailable (missing session token).');return value;}
export function audioFrom(html){const tag=(html.match(/<source\b[^>]*>/gi)||[]).find(t=>attribute(t,'src'));if(!tag)throw new Error('Paul service did not return audio; it may be unavailable or at its daily limit.');const url=new URL(attribute(tag,'src'),PAUL_ENDPOINT);if(url.origin!==new URL(PAUL_ENDPOINT).origin||!url.pathname.startsWith('/tools/eas-tts/cache/')||!url.pathname.endsWith('.wav'))throw new Error('Unexpected Paul audio URL.');return url.href;}
function cookieHeaders(headers){const values=headers.getSetCookie?.()||(headers.get('set-cookie')?[headers.get('set-cookie')]:[]);return values.map(v=>v.split(';')[0]).join('; ');}
async function bounded(response,max=MAX_BYTES){if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw new Error('Paul response is too large.');}const parts=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>max)throw new Error('Paul response is too large.');parts.push(Buffer.from(chunk));}return Buffer.concat(parts);}
export class PaulTts{
  constructor(store,fetcher=fetch){this.store=store;this.fetch=fetcher;this.chain=Promise.resolve();this.cooldown=0;this.cache=path.join(store.dir,'tts-cache');fs.mkdirSync(this.cache,{recursive:true});}
  async audio(text){const run=this.chain.then(()=>this.generate(text));this.chain=run.catch(()=>{});return run;}
  async generate(text){
    if(!text.trim()||text.length>5000)throw new Error('Paul text must be 1–5,000 characters.');
    const key=crypto.createHash('sha256').update('paul:'+text).digest('hex'),file=path.join(this.cache,key+'.wav');
    if(fs.existsSync(file)){const stat=fs.statSync(file);if(Date.now()-stat.mtimeMs<7*86400000)return fs.readFileSync(file);fs.rmSync(file,{force:true});}
    if(Date.now()<this.cooldown)throw new Error('Paul service is temporarily on cooldown after an error.');
    const day=new Date().toISOString().slice(0,10),usage=this.store.state.ttsUsage||{day,count:0};
    if(usage.day!==day){usage.day=day;usage.count=0;}if(usage.count>=50)throw new Error('Local Paul request budget reached (50 per UTC day).');
    usage.count++;this.store.state.ttsUsage=usage;this.store.save();
    try{
      const options={signal:AbortSignal.timeout(90000),redirect:'error',headers:{'User-Agent':'eas-webdec-test/2.0'}};
      const page=await this.fetch(PAUL_ENDPOINT,options);if(!page.ok)throw new Error('Paul form returned HTTP '+page.status);
      const cookies=cookieHeaders(page.headers),html=(await bounded(page,1024*1024)).toString('utf8');
      const response=await this.fetch(PAUL_ENDPOINT,{...options,signal:AbortSignal.timeout(90000),method:'POST',headers:{...options.headers,'Content-Type':'application/x-www-form-urlencoded',...(cookies?{Cookie:cookies}:{})},body:new URLSearchParams({voice:'paul',text,xsrf:xsrfFrom(html)}).toString()});
      if(!response.ok)throw new Error('Paul conversion returned HTTP '+response.status);
      const result=(await bounded(response,1024*1024)).toString('utf8'),url=audioFrom(result);
      const download=await this.fetch(url,{...options,signal:AbortSignal.timeout(90000),headers:{...options.headers,...(cookies?{Cookie:cookies}:{})}});if(!download.ok)throw new Error('Paul audio download returned HTTP '+download.status);
      const audio=await bounded(download);if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new Error('Paul service returned invalid WAV audio.');
      fs.writeFileSync(file+'.tmp',audio);fs.renameSync(file+'.tmp',file);
      for(const name of fs.readdirSync(this.cache)){if(name.endsWith('.wav')&&Date.now()-fs.statSync(path.join(this.cache,name)).mtimeMs>7*86400000)fs.rmSync(path.join(this.cache,name),{force:true});}
      return audio;
    }catch(error){this.cooldown=Date.now()+5*60000;throw error;}
  }
}
