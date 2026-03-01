import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient } from './utils';
import { prompts } from '../../server/prompts';

export default async (req: Request) => {
  const url = new URL(req.url);
  let user;
  try {
    user = authenticate(req);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401 });
  }

  if (req.method === 'POST') {
    const match = url.pathname.match(/^\/api\/grade\/(\d+)$/);
    if (match) {
      const unitId = match[1];
      const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
      if (!unit) return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });

      const latestNote = db.prepare('SELECT * FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id, unitId) as any;
      if (!latestNote) return new Response(JSON.stringify({ error: 'No notes found for this unit' }), { status: 400 });

      const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId) as any;

      try {
        const { client, model } = getAiClient();
        const prompt = prompts.gradeUnit(unit, plan, latestNote);

        const response = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
        });

        const raw = response.choices?.[0]?.message?.content || '';
        let result: any;
        try {
          result = JSON.parse(raw);
        } catch (e) {
          throw new Error('AI 返回的内容不是有效的 JSON');
        }
        db.prepare('UPDATE notes SET grade = ?, feedback = ? WHERE id = ?').run(result.grade, result.feedback, latestNote.id);

        return new Response(JSON.stringify({ grade: result.grade, feedback: result.feedback }));
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/grade/*"
};
