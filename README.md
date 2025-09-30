# TG Bot — GPT + Подбор по VIN (Laximo-Connect-2.0)

Готовый бот для Telegram с меню команд:
- **/vin** — подбор по VIN через ваш REST (`/vin?vin=...&locale=...`)
- **/gpt** — GPT-чат
- **/reset** — сброс контекста GPT
- **/help** — справка

## Быстрый старт

```bash
cp .env.example .env
# впишите TELEGRAM_TOKEN, OPENAI_API_KEY, LAXIMO_BASE_URL (на ваш хост)
npm i
npm run dev          # режим long polling
# или вебхук
npm run dev:webhook  # требует PUBLIC URL в WEBHOOK_PUBLIC_URL
```

### Переменные окружения
- `TELEGRAM_TOKEN` — токен бота
- `LAXIMO_BASE_URL` — базовый URL вашего сервиса Laximo-Connect-2.0 (без завершающего /)
- `DEFAULT_LOCALE` — по умолчанию `ru_RU`
- `OPENAI_API_KEY` — ключ OpenAI
- `OPENAI_MODEL` — модель (по умолчанию `gpt-4o-mini`)
- `USE_RESPONSES_API=1` — чтобы использовать Responses API вместо Chat Completions
- `WEBHOOK_PUBLIC_URL` и `PORT` — для режима вебхука

## Что делает
- При получении VIN (команда `/vin` или просто отправка VIN) — обращается к `GET /vin` вашего REST и:
  - отправляет краткое резюме полей;
  - прикрепляет полный JSON файлом.
- Любой другой текст — уходит в GPT-чат, с контекстом на последние 12 сообщений. Команда `/reset` очищает контекст.

## Структура
- `src/index.js` — входная точка, запуск long polling или webhook, установка меню
- `src/telegram.js` — маршрутизация команд и сообщений
- `src/laximoClient.js` — запрос к вашему REST
- `src/gpt.js` — простой стейт для GPT-диалога и вызов OpenAI
- `src/formatters.js` — генерация краткого резюме ответа VIN
- `src/utils.js` — утилиты

## Лицензия
MIT
