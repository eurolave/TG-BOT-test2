import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const USE_RESPONSES = process.env.USE_RESPONSES_API === '1';

// Память чата: по 12 последних сообщений на чат
const store = new Map(); // chatId -> [{role, content}]
const LIMIT = 12;

function pushHistory(chatId, role, content) {
  const arr = store.get(chatId) || [];
  arr.push({ role, content });
  while (arr.length > LIMIT) arr.shift();
  store.set(chatId, arr);
}

export async function chat(chatId, userText) {
  pushHistory(chatId, 'user', userText);

  if (USE_RESPONSES) {
    const response = await client.responses.create({
      model: MODEL,
      input: store.get(chatId).map(m =>
        m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content }
      )
    });
    const text = response.output_text || response?.output?.[0]?.content?.[0]?.text || '…';
    pushHistory(chatId, 'assistant', text);
    return text;
  } else {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: store.get(chatId),
      temperature: 0.4
    });
    const text = completion.choices?.[0]?.message?.content || '…';
    pushHistory(chatId, 'assistant', text);
    return text;
  }
}

export function reset(chatId) {
  store.delete(chatId);
}
