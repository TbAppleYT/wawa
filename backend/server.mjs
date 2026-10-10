import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Engine} from './engine.mjs';
import {renderSame} from './same.mjs';

const defaults={name:'eas-webdec-test',stationId:'WEBDEC-TEST',location:'Virginia Beach, VA',latitude:36.8529,longitude:-75.978,interval:30,periods:5,automatic:true,loopVolume:70,speechSpeed:160,ttsVoice:'paul',ttsFallback:true,radioEffect:true,pinkNoiseDb:-55,whiteNoiseDb:-60};
export class Store{
  constructor(dir){this.dir=dir;for(const folder of ['audio','queue'])fs.mkdirSync(path.join(dir,folder),{recursive:true});const file=path.join(dir,'station.json');this.state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{enabled:false,settings:{...defaults},tracks:[],queue:[],history:[],events:[],forecast:null};this.state.settings={...defaults,...this.state.settings};}
  save(){const file=path.join(this.dir,'station.json');fs.writeFileSync(file+'.tmp',JSON.stringify(this.state,null,2));fs.renameSync(file+'.tmp',file);}
  log(message){this.state.events.unshift({at:new Date().toISOString(),message});this.state.events=this.state.events.slice(0,100);this.save();}
}
function tokenMatches(provided,expected){const a=Buffer.from(provided||''),b=Buffer.from(expected||'');return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function validateSettings(input){const out={...defaults};for(const key of ['name','stationId','location']){if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>120)throw new Error('Invalid '+key);out[key]=input[key].trim();}for(const [key,min,max]of [['latitude',-90,90],['longitude',-180,180],['interval',1,180],['periods',1,7],['loopVolume',0,100],['speechSpeed',80,300]]){const n=Number(input[key]);if(!Number.isFinite(n)||n<min||n>max)throw new Error('Invalid '+key);out[key]=n;}out.interval=Math.round(out.interval);out.periods=Math.round(out.periods);if(typeof input.automatic!=='boolean')throw new Error('Invalid automatic forecast switch.');out.automatic=input.automatic;out.ttsVoice=input.ttsVoice??defaults.ttsVoice;if(!['paul','local'].includes(out.ttsVoice))throw new Error('Invalid voice.');for(const key of ['ttsFallback','radioEffect']){out[key]=input[key]??defaults[key];if(typeof out[key]!=='boolean')throw new Error('Invalid '+key);}for(const key of ['pinkNoiseDb','whiteNoiseDb']){out[key]=Number(input[key]??defaults[key]);if(!Number.isFinite(out[key])||out[key]<-90||out[key]>-35)throw new Error('Noise level must be between -90 and -35 dB.');}return out;}
async function body(request,limit){const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>limit)throw new Error('Request exceeds size limit.');chunks.push(chunk);}return Buffer.concat(chunks);}
function probe(file,command='ffprobe'){return new Promise((resolve,reject)=>{const child=spawn(command,['-v','error','-select_streams','a:0','-show_entries','stream=codec_type:format=duration','-of','json',file],{stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',d=>stdout+=d);child.stderr.resume();child.on('error',reject);const timeout=setTimeout(()=>{child.kill();reject(new Error('Audio inspection timed out.'));},15000);child.on('close',code=>{clearTimeout(timeout);try{const result=JSON.parse(stdout);if(code||!result.streams?.some(s=>s.codec_type==='audio'))throw new Error('The file does not contain playable audio.');resolve(Number(result.format?.duration)||0);}catch(e){reject(e);}});});}
export function createStation(options={}){
  const token=options.token||process.env.ADMIN_TOKEN;if(!token||token.length<24)throw new Error('Set ADMIN_TOKEN to a private random value of at least 24 characters.');
  const store=options.store||new Store(options.dataDir||process.env.DATA_DIR||path.resolve('data'));
  const engine=options.engine||new Engine(store,options.engineOptions);
  const origins=new Set((options.adminOrigins||process.env.ADMIN_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
  const html=options.htmlPath||path.join(path.dirname(fileURLToPath(import.meta.url)),'public','index.html');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    const origin=req.headers.origin;
    if(origin&&origins.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');}
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try{
      if(req.method==='OPTIONS'){if(!origin||!origins.has(origin)){send(403,{error:'Origin is not permitted.'});return;}res.writeHead(204);res.end();return;}
      const u=new URL(req.url,'http://localhost'),route=u.pathname;
      if(route==='/health'){send(200,{ok:true});return;}
      if(route==='/stream.mp3'&&req.method==='GET'){
        if(!engine.running){send(503,{error:'Station is offline.'});return;}
        if(engine.clients.size>=100){send(503,{error:'Listener limit reached.'});return;}
        res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Accel-Buffering':'no','icy-name':store.state.settings.name});res.flushHeaders();engine.addListener(res);return;
      }
      if(['/', '/admin', '/admin.html', '/control-panel.html', '/station.html'].includes(route)&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https:; media-src 'self' https: blob:; frame-ancestors 'none'; base-uri 'none'"});fs.createReadStream(route==='/'||route==='/station.html'?path.join(path.dirname(html),'station.html'):html).pipe(res);return;}
      if(!route.startsWith('/api/')){send(404,{error:'Not found.'});return;}
      if(!tokenMatches(req.headers.authorization?.replace(/^Bearer /,''),token)){send(401,{error:'Administrator access denied.'});return;}
      if(origin&&!origins.has(origin)){
        const host=req.headers.host;const urlOrigin=new URL(origin);if(urlOrigin.host!==host){send(403,{error:'Add this admin website origin to ADMIN_ORIGINS on the server.'});return;}
      }
      if(route==='/api/state'&&req.method==='GET'){send(200,{...store.state,status:engine.status()});return;}
      const parse=async()=>JSON.parse((await body(req,20000)).toString('utf8'));
      if(route==='/api/station'&&req.method==='POST'){const d=await parse();if(typeof d.enabled!=='boolean')throw new Error('Invalid station command.');store.state.enabled=d.enabled;store.save();if(d.enabled)await engine.start();else engine.stop();store.log(d.enabled?'Station enabled.':'Station disabled.');send(200,{status:engine.status()});return;}
      if(['/api/same','/api/same-preview'].includes(route)&&req.method==='POST'){
        if(route==='/api/same'&&!engine.running)throw new Error('Start the station before sending SAME audio.');
        if(store.state.queue.length>=50)throw new Error('Announcement queue is full.');
        const {config,audio}=await renderSame(engine,await parse());
        if(route==='/api/same-preview'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Disposition':'attachment; filename="same-preview.wav"','X-SAME-Header':config.header});res.end(audio);return;}
        const id=crypto.randomUUID(),file='queue/'+id+'.wav',message={id,file,title:'SAME '+config.event,text:config.text,header:config.header,createdAt:new Date().toISOString()};
        fs.writeFileSync(path.join(store.dir,file),audio);store.state.queue.push(message);store.log('SAME audio queued: '+config.header);send(201,{message});return;
      }
      if(route==='/api/settings'&&req.method==='POST'){store.state.settings=validateSettings(await parse());store.log('Configuration saved.');engine.nextForecast=Date.now()+store.state.settings.interval*60000;send(200,{settings:store.state.settings});return;}
      if(route==='/api/forecast'&&req.method==='POST'){if(store.state.queue.some(m=>m.title==='Automatic weather forecast'))throw new Error('A forecast is already queued.');const forecast=await engine.forecast();send(200,{forecast});return;}
      if(route==='/api/messages'&&req.method==='POST'){const d=await parse();if(typeof d.text!=='string'||!d.text.trim()||d.text.length>5000)throw new Error('Enter a message of 1 to 5,000 characters.');if(store.state.queue.length>=50)throw new Error('Announcement queue is full.');const m=await engine.announce(d.text.trim(),String(d.title||'Station announcement').slice(0,120));send(201,{message:m});return;}
      const message=route.match(/^\/api\/messages\/([a-f0-9-]{36})$/);if(message&&req.method==='DELETE'){const m=store.state.queue.find(m=>m.id===message[1]);if(!m){send(404,{error:'Pending announcement not found.'});return;}if(engine.now===m.title&&engine.running)throw new Error('Turn the station off before cancelling an on-air announcement.');store.state.queue=store.state.queue.filter(q=>q.id!==message[1]);store.log('Announcement cancelled: '+m.title);fs.rmSync(path.join(store.dir,m.file),{force:true});send(200,{ok:true});return;}
      if(route==='/api/upload'&&req.method==='POST'){
        if(store.state.tracks.length>=100)throw new Error('Maximum 100 loop files.');
        const name=(u.searchParams.get('name')||'audio').slice(0,180),extension=path.extname(name).toLowerCase();if(!['.mp3','.wav','.ogg','.m4a','.aac','.flac'].includes(extension))throw new Error('Unsupported audio file type.');
        const id=crypto.randomUUID(),relative='audio/'+id+extension,file=path.join(store.dir,relative);const data=await body(req,25*1048576);if(!data.length)throw new Error('Audio file is empty.');fs.writeFileSync(file+'.part',data);let duration;
        try{duration=await probe(file+'.part',options.ffprobe||'ffprobe');fs.renameSync(file+'.part',file);}catch(e){fs.rmSync(file+'.part',{force:true});throw e;}
        const track={id,file:relative,name,size:data.length,duration};store.state.tracks.push(track);store.log('Audio uploaded: '+name);engine.failed.clear();send(201,{track});return;
      }
      if(route==='/api/order'&&req.method==='POST'){const {ids}=await parse();if(!Array.isArray(ids)||ids.length!==store.state.tracks.length||new Set(ids).size!==ids.length||ids.some(id=>!store.state.tracks.some(t=>t.id===id)))throw new Error('Playlist changed. Refresh and retry.');store.state.tracks=ids.map(id=>store.state.tracks.find(t=>t.id===id));store.log('Playlist order saved.');send(200,{ok:true});return;}
      const track=route.match(/^\/api\/tracks\/([a-f0-9-]{36})$/);if(track&&req.method==='DELETE'){const t=store.state.tracks.find(t=>t.id===track[1]);if(!t){send(404,{error:'Audio not found.'});return;}if(engine.running&&engine.now===t.name)throw new Error('Turn the station off before removing the on-air file.');store.state.tracks=store.state.tracks.filter(t=>t.id!==track[1]);store.log('Audio removed: '+t.name);fs.rmSync(path.join(store.dir,t.file),{force:true});send(200,{ok:true});return;}
      send(404,{error:'Not found.'});
    }catch(error){if(!res.headersSent)send(400,{error:error.message});else res.end();}
  });
  server.requestTimeout=300000;server.keepAliveTimeout=65000;
  server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  return {server,store,engine,async start(port=Number(process.env.PORT)||8080,host='0.0.0.0'){await new Promise(resolve=>server.listen(port,host,resolve));if(store.state.enabled)await engine.start();return server.address();},async close(){engine.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const app=createStation();await app.start();console.log('eas-webdec-test server started.');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});}catch(error){console.error(error.message);process.exitCode=1;}
}
export {validateSettings,tokenMatches};
