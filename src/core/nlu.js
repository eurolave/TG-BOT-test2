export function detectIntent(text='') {
  const t = text.trim();
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(t)) return 'VIN';
  if (/^[A-Za-z0-9._-]{3,}$/.test(t)) return 'OEM';
  return 'OTHER';
}
