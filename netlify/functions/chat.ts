import { Config } from "@netlify/functions";
import { authenticate, getAiClient } from './utils';
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
      const prompt = prompts.qaAssistant(context, question);

      const response = await client.models.generateContent({
        model: model,
        contents: prompt,
      });

      return new Response(JSON.stringify({ answer: response.text }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/ai/chat"
};
