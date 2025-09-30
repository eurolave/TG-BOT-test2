import { escapeMd } from './utils.js';
export function summarizeVinResponse(json){
  const data = json?.data ?? json; const flat=[];
  const pick = (o,p='')=>{ for(const [k,v] of Object.entries(o||{})){ if(v==null)continue; const key=p?`${p}.${k}`:k;
    if(['string','number','boolean'].includes(typeof v)) flat.push([key,v]);
    else if (typeof v==='object' && !Array.isArray(v)) pick(v,key); } };
  if (Array.isArray(data)) data[0]&&pick(data[0]); else if (data&&typeof data==='object') pick(data);
  const lines=[`*VIN найден*`,'',...flat.slice(0,12).map(([k,v])=>`• *${escapeMd(k)}*: ${escapeMd(String(v))}`), flat.length>12?`… и ещё ${flat.length-12} полей`:'' ].filter(Boolean);
  return lines.join('\n');
}
