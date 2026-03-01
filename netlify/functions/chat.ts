import { Config } from "@netlify/functions";
import { authenticate, getAiClient, logAiInteraction, enrichPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';

export default async (req: Request) => {
  const url = new URL(req.url);
  let user: any;
  try {
    user = authenticate(req);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401 });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    const { question, context } = await req.json();
    try {
      const { client, model } = getAiClient();
      const prompt = prompts.qaAssistant(context, question);

      const enriched = enrichPromptWithFiles(prompt);
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: enriched.prompt }],
      });

      const answer = response.choices?.[0]?.message?.content?.trim() || '';
      logAiInteraction({ userId: user?.id, action: 'qa_chat', prompt: enriched.prompt, response: JSON.stringify(response) });
      return new Response(JSON.stringify({ answer }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/ai/chat"
};
