export function audioFilter(settings={}){
  if(settings.radioEffect===false)return null;
  const pinkDb=Number(settings.pinkNoiseDb??-55),whiteDb=Number(settings.whiteNoiseDb??-60);
  if(!Number.isFinite(pinkDb)||!Number.isFinite(whiteDb)||pinkDb< -90||pinkDb> -35||whiteDb< -90||whiteDb> -35)throw new Error('Invalid noise level.');
  const pink=Math.pow(10,pinkDb/20).toFixed(9),white=Math.pow(10,whiteDb/20).toFixed(9);
  return `[0:a]pan=mono|c0=0.5*c0+0.5*c1,highpass=f=120,lowpass=f=6000[program];anoisesrc=color=pink:amplitude=${pink}:r=44100[pink];anoisesrc=color=white:amplitude=${white}:r=44100[white];[program][pink][white]amix=inputs=3:duration=first:dropout_transition=0:normalize=0[out]`;
}
