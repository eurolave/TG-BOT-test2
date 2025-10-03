// src/utils.js

/**
 * Бросает ошибку, если значение "пустое".
 * @template T
 * @param {T} v
 * @param {string} msg
 * @returns {T}
 */
export function ensure(v, msg) {
  if (v === undefined || v === null || v === '' || v === false) {
    throw new Error(msg || 'Value is required');
  }
  return v;
}

/**
 * Бьёт строку на куски заданного размера, устойчиво к суррогатным парам (эмодзи и т.п.).
 * По умолчанию ~3500 символов (безопасно для Telegram, лимит 4096).
 * @param {string} str
 * @param {number} [size=3500]
 * @returns {string[]}
 */
export function chunk(str, size = 3500) {
  const out = [];
  const arr = Array.from(String(str)); // безопасно по кодпоинтам
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size).join(''));
  }
  return out;
}

/**
 * Маскирует VIN вида ABC***XYZ (оставляет первые 3 и последние 3 символа).
 * Если короче 6 — возвращает исходное.
 * Пробелы обрезаются, регистр нормализуется к верхнему.
 * @param {string} v
 * @returns {string}
 */
export function maskVin(v) {
  const raw = String(v || '').trim().toUpperCase();
  if (raw.length < 6) return raw;
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

/**
 * Экранирует HTML-спецсимволы (& < > " ').
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Грубое определение языка по locale (ru_RU → 'ru', иначе 'en').
 * @param {string} locale
 * @returns {'ru'|'en'}
 */
export function detectLangFromLocale(locale) {
  const l = String(locale || '').toLowerCase();
  return l.startsWith('ru') ? 'ru' : 'en';
}

/**
 * Эмодзи по бренду (best-effort). Возвращает 🚗 по умолчанию.
 * @param {string} brand
 * @returns {string}
 */
export function brandEmoji(brand) {
  const b = String(brand || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const map = {
    'AUDI': '🚘',
    'SKODA': '🚙',
    'VOLKSWAGEN': '🚗',
    'VW': '🚗',
    'SEAT': '🚗',
    'BMW': '🏎️',
    'MERCEDES': '🚘',
    'MERCEDES-BENZ': '🚘',
    'MB': '🚘',
    'TOYOTA': '🚙',
    'LEXUS': '🚙',
    'HONDA': '🏁',
    'NISSAN': '🚗',
    'INFINITI': '🚗',
    'KIA': '🚗',
    'HYUNDAI': '🚗',
    'GENESIS': '🚗',
    'FORD': '🚙',
    'RENAULT': '🚗',
    'PEUGEOT': '🚗',
    'CITROEN': '🚗',
    'MAZDA': '🚗',
    'VOLVO': '🚙',
    'OPEL': '🚗',
    'CHEVROLET': '🚗',
    'PORSCHE': '🏎️',
    'JAGUAR': '🚘',
    'LAND ROVER': '🚙',
    'RANGE ROVER': '🚙',
    'MITSUBISHI': '🚙',
    'SUBARU': '🚙',
    'SUZUKI': '🚗',
    'FIAT': '🚗',
    'ALFA ROMEO': '🏎️',
    'TESLA': '🔋',
  };
  return map[b] || map[b.replace(/-/g, ' ')] || '🚗';
}

/**
 * Форматирование суммы.
 * Если currency — символ (например, '₽', '€', '$'), добавляет его после числа с неразрывным пробелом.
 * Если currency — ISO-код (например, 'RUB', 'EUR', 'USD'), используется Intl.NumberFormat.
 * @param {number|string} n
 * @param {string} [currency='₽']  Символ ('₽') или код ('RUB')
 * @param {string} [locale='ru-RU']
 * @returns {string}
 */
export function fmtMoney(n, currency = '₽', locale = 'ru-RU') {
  const value = Number(n);
  if (!Number.isFinite(value)) return `0.00 ${currency}`;

  const isIsoCode = /^[A-Z]{3}$/.test(currency);
  if (isIsoCode) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'symbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // fallback к символу, если код не поддерживается
    }
  }
  const amount = value.toFixed(2);
  return `${amount}\u00A0${currency}`; // NBSP между суммой и символом
}
