export function ensure(v, msg) { if (!v) throw new Error(msg); return v; }
export function chunk(str, size = 3500) { const a=[]; for (let i=0;i<str.length;i+=size) a.push(str.slice(i,i+size)); return a; }
export function maskVin(v){ if(!v||v.length<6)return v||''; return `${v.slice(0,3)}***${v.slice(-3)}`; }

export function escapeHtml(s){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

export function detectLangFromLocale(locale){
  const l = (locale || '').toLowerCase();
  if (l.startsWith('ru')) return 'ru';
  return 'en';
}

export function brandEmoji(brand){
  const b = String(brand || '').toUpperCase();
  const map = {
    'AUDI':'🚘', 'SKODA':'🚙', 'VOLKSWAGEN':'🚗', 'VW':'🚗', 'SEAT':'🚗',
    'BMW':'🏎️', 'MERCEDES':'🚘', 'MERCEDES-BENZ':'🚘', 'TOYOTA':'🚙',
    'HONDA':'🏁', 'NISSAN':'🚗', 'KIA':'🚗', 'HYUNDAI':'🚗', 'FORD':'🚙',
    'RENAULT':'🚗', 'PEUGEOT':'🚗', 'CITROEN':'🚗', 'MAZDA':'🚗', 'VOLVO':'🚙'
  };
  return map[b] || '🚗';
}

/** Простейшее форматирование суммы (рубли по умолчанию) */
export function fmtMoney(n, currency = '₽') {
  const amount = Number.isFinite(+n) ? (+n).toFixed(2) : '0.00';
  return `${amount} ${currency}`;
}
