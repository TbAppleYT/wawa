// Approximation of the user's EQ screenshot, interpolated in log-frequency.
export const EQ_POINTS=[[20,-90],[60,-90],[70,0],[100,0],[900,-6.5],[2700,0],[4000,-0.5],[5000,-90],[20000,-90]];
export function audioFilter(settings={}){
  if(settings.radioEffect===false)return null;
  const pinkDb=Number(settings.pinkNoiseDb??-55),whiteDb=Number(settings.whiteNoiseDb??-60);
  if(!Number.isFinite(pinkDb)||!Number.isFinite(whiteDb)||pinkDb< -90||pinkDb> -35||whiteDb< -90||whiteDb> -35)throw new Error('Invalid noise level.');
  const entries=EQ_POINTS.map(([hz,db])=>`entry(${Math.log2(hz/20).toFixed(9)},${db})`).join(';');
  return `[0:a]pan=mono|c0=0.5*c0+0.5*c1,firequalizer=gain_entry='${entries}':scale=loglog:delay=0.02[out]`;
}
export class RadioNoise{
  constructor(settings={},random=Math.random){this.enabled=settings.radioEffect!==false;this.pink=Math.pow(10,Number(settings.pinkNoiseDb??-55)/20);this.white=Math.pow(10,Number(settings.whiteNoiseDb??-60)/20);this.random=random;this.p0=0;this.p1=0;this.p2=0;this.carry=Buffer.alloc(0);}
  process(input,alert=false){
    if(!this.enabled)return input;
    const joined=this.carry.length?Buffer.concat([this.carry,input]):input,length=joined.length-joined.length%4;this.carry=Buffer.from(joined.subarray(length));const output=Buffer.from(joined.subarray(0,length));
    if(alert)return output;
    for(let i=0;i<length;i+=4){const source=2*this.random()-1;this.p0=.99765*this.p0+.099046*source;this.p1=.963*this.p1+.2965164*source;this.p2=.57*this.p2+1.0526913*source;const pink=.05*(this.p0+this.p1+this.p2+.1848*source),white=2*this.random()-1,noise=Math.round(32768*(this.pink*pink+this.white*white));for(const offset of [i,i+2])output.writeInt16LE(Math.max(-32768,Math.min(32767,output.readInt16LE(offset)+noise)),offset);}
    return output;
  }
}
