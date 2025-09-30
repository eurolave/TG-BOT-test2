import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const USE_RESPONSES = process.env.USE_RESPONSES_API === '1';

const store = new Map(); const LIMIT = 12;
function pushHistory(chatId, role, content){ const a=store.get(chatId)||[]; a.push({role,content}); while(a.length>LIMIT)a.shift(); store.set(chatId,a); }

export async function chat(chatId, userText){
  pushHistory(chatId,'user',userText);
  if (USE_RESPONSES){
    const r = await client.responses.create({ model: MODEL, input: store.get(chatId) });
    const text = r.output_text || '…'; pushHistory(chatId,'assistant',text); return text;
  } else {
    const r = await client.chat.completions.create({ model: MODEL, messages: store.get(chatId), temperature: 0.4 });
    const text = r.choices?.[0]?.message?.content || '…'; pushHistory(chatId,'assistant',text); return text;
  }
}
export function reset(chatId){ store.delete(chatId); }
