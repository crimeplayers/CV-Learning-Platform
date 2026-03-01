import { Config } from "@netlify/functions";
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';

export default async (req: Request) => {
  const url = new URL(req.url);
  try {
    authenticate(req);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401 });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    const { question, context } = await req.json();
    try {
      const { client, model } = getAiClient();
      const basePrompt = prompts.qaAssistant(context, question);
      const { prompt, files } = buildPromptWithFiles(basePrompt);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      const answer = response.choices?.[0]?.message?.content?.trim() || '';
      const ai_raw = response.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({ answer, prompt_preview: prompt, files_used: files, ai_raw }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/ai/chat"
};
