import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const USE_RESPONSES = (process.env.USE_RESPONSES_API || '1') === '1';
const SYSTEM_PROMPT = process.env.GPT_SYSTEM_PROMPT
  || 'Ты — GPT-5. Отвечай дружелюбно, по делу и кратко. Если спрашивают про модель — укажи, что ты GPT-5.';

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
    const history = store.get(chatId).map(m => ({ role: m.role, content: m.content }));
    const response = await client.responses.create({
      model: MODEL,
      input: [{ role: 'system', content: SYSTEM_PROMPT }, ...history]
    });
    const text = response.output_text || response?.output?.[0]?.content?.[0]?.text || '…';
    pushHistory(chatId, 'assistant', text);
    return text;
  } else {
    const history = store.get(chatId);
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history]
    });
    const text = completion.choices?.[0]?.message?.content || '…';
    pushHistory(chatId, 'assistant', text);
    return text;
  }
}

export function reset(chatId) {
  store.delete(chatId);
}
