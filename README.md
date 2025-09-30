# Telegram Bot — VIN подбор (Laximo-Connect-2.0) + GPT-чат

Меню команд:
- `/vin` — подбор по VIN через ваш REST (`/vin?vin=...&locale=...`)
- `/gpt` — GPT-чат
- `/reset` — сброс контекста GPT
- `/help` — справка

## Быстрый старт
```bash
cp .env.example .env
# заполните TELEGRAM_TOKEN, OPENAI_API_KEY, LAXIMO_BASE_URL
npm i
npm start        # long polling
# либо вебхук
npm run dev:webhook  # нужен WEBHOOK_PUBLIC_URL (публичный адрес)
```

## Деплой в Docker
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
```
Запуск:
```bash
docker build -t tg-bot .
docker run --rm -e TELEGRAM_TOKEN=... -e OPENAI_API_KEY=... -e LAXIMO_BASE_URL=... tg-bot
```

## Переменные окружения
- `TELEGRAM_TOKEN` — токен бота (BotFather)
- `LAXIMO_BASE_URL` — базовый URL вашего Laximo-Connect-2.0 (без завершающего /)
- `DEFAULT_LOCALE` — по умолчанию `ru_RU`
- `OPENAI_API_KEY` — ключ OpenAI
- `OPENAI_MODEL` — модель (`gpt-4o-mini` по умолчанию)
- `USE_RESPONSES_API=1` — использовать Responses API
- `WEBHOOK_PUBLIC_URL`, `PORT` — для вебхука

## Что делает
- По VIN — обращается к вашему `/vin` и присылает краткую сводку + полный JSON файлом.
- Любой другой текст — уходит в GPT, контекст сохраняется в памяти процесса (12 сообщений). `/reset` очищает.

## Структура
- `src/index.js` — запуск, меню и режим (polling/webhook)
- `src/telegram.js` — команды и обработка сообщений
- `src/laximoClient.js` — запрос к REST
- `src/gpt.js` — диалог с OpenAI
- `src/formatters.js` — форматирование резюме по VIN
- `src/utils.js` — утилиты
