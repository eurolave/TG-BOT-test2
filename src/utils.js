export function ensure(v, msg) { if (!v) throw new Error(msg); return v; }
export function chunk(str, size = 3500) { const a=[]; for (let i=0;i<str.length;i+=size) a.push(str.slice(i,i+size)); return a; }
export function maskVin(vin){ if(!vin||vin.length<6)return vin||''; return `${vin.slice(0,3)}***${vin.slice(-3)}`; }
export function escapeMd(s){ return s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g,'\\$1'); }
