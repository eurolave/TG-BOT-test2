// src/utils.js

/**
 * Бросает ошибку, если значение "пустое".
 * Пустым считаем: undefined | null | '' | false.
 * Можно передать ленивое сообщение (функцию).
 * @template T
 * @param {T} v
 * @param {string | (() => string)} msg
 * @returns {T}
 */
export function ensure(v, msg) {
  const empty = v === undefined || v === null || v === '' || v === false;
  if (empty) {
    const m = typeof msg === 'function' ? msg() : msg;
    throw new Error(m || 'Value is required');
  }
  return /** @type {T} */ (v);
}

/**
 * Бьёт строку на куски заданного размера, корректно по кодпоинтам (эмодзи не рвутся).
 * По умолчанию ~3500 символов (безопасно для Telegram, лимит 4096).
 * size < 1 → возвращает исходную строку одним куском.
 * @param {string} str
 * @param {number} [size=3500]
 * @returns {string[]}
 */
export function chunk(str, size = 3500) {
  const s = String(str);
  if (!Number.isFinite(size) || size < 1) return [s];
  const out = [];
  const arr = Array.from(s); // кодпоинты
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size).join(''));
  }
  return out;
}

/**
 * Маскирует VIN вида ABC***XYZ (оставляет первые 3 и последние 3).
 * Нормализует: удаляет пробелы/дефисы, переводит к upper-case.
 * Если после нормализации короче 6 — вернёт как есть.
 * @param {string} vin
 * @returns {string}
 */
export function maskVin(vin) {
  const raw = String(vin || '')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  if (raw.length < 6) return raw;
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

/**
 * Экранирует HTML (& < > " ').
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/<//g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Грубое определение языка по locale ('ru_RU' → 'ru', иначе 'en').
 * @param {string} locale
 * @returns {'ru'|'en'}
 */
export function detectLangFromLocale(locale) {
  const l = String(locale || '').trim().toLowerCase();
  const main = l.split(/[_-]/)[0]; // 'ru-ru' | 'ru_RU' → 'ru'
  return main === 'ru' ? 'ru' : 'en';
}

/**
 * Эмодзи по бренду (best-effort). По умолчанию '🚗'.
 * Нормализует пробелы и дефисы.
 * @param {string} brand
 * @returns {string}
 */
export function brandEmoji(brand) {
  const b = String(brand || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  const key = b.replace(/-/g, ' ');
  /** @type {Record<string,string>} */
  const map = {
    'AUDI': '🚘',
    'SKODA': '🚙',
    'VOLKSWAGEN': '🚗',
    'VW': '🚗',
    'SEAT': '🚗',
    'BMW': '🏎️',
    'MERCEDES': '🚘',
    'MERCEDES BENZ': '🚘',
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
    'TESLA': '🔋'
  };
  return map[b] || map[key] || '🚗';
}

/**
 * Форматирование суммы.
 * Если currency — ISO-код (RUB/EUR/USD) → Intl.NumberFormat.
 * Если currency — символ ('₽', '€', '$') → "1234.56 ₽".
 * @param {number|string} n
 * @param {string} [currency='₽'] Символ или ISO-код
 * @param {string} [locale='ru-RU']
 * @returns {string}
 */
export function fmtMoney(n, currency = '₽', locale = 'ru-RU') {
  const value = Number(n);
  if (!Number.isFinite(value)) return `0.00\u00A0${currency}`;

  const isIso = /^[A-Z]{3}$/.test(currency);
  if (isIso) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    } catch {
      // если код не поддерживается движком — свалимся в символ ниже
    }
  }

  // символ/строка — простой формат
  return `${value.toFixed(2)}\u00A0${currency}`; // NBSP между суммой и символом
}

/**
 * Утилита для картинок Laximo: подставляет оригинальный размер (source).
 * Пример: https://img.laximo.ru/AU1587/%size%/022/022013000.gif → .../source/022/022013000.gif
 * @param {string} url
 * @returns {string}
 */
export function imageSource(url) {
  return String(url || '').replace('%size%', 'source');
}
