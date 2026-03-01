import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';

const parseGradeResult = (raw: string) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [withoutFence];
  const objectMatch = withoutFence.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as any;
    } catch (err) {}
  }
  return null;
};

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
        const basePrompt = prompts.gradeUnit(unit, plan, latestNote);
        const { prompt, files } = buildPromptWithFiles(basePrompt);

        const response = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
        });

        let raw = response.choices?.[0]?.message?.content || '';
        let result: any = parseGradeResult(raw);

        if (!result) {
          const repairPrompt = `你上一条评分结果不是有效JSON。请严格仅返回一个JSON对象，不要输出任何额外文字：{"grade":85,"feedback":"..."}`;
          const retryResponse = await client.chat.completions.create({
            model,
            messages: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: raw || '（空响应）' },
              { role: 'user', content: repairPrompt }
            ],
          });
          raw = retryResponse.choices?.[0]?.message?.content || raw;
          result = parseGradeResult(raw);
        }

        if (!result) {
          throw new Error('AI 返回的内容不是有效的 JSON');
        }

        const gradeValue = result.grade;
        const feedbackValue = typeof result.feedback === 'string' ? result.feedback.trim() : '';
        const gradeText = typeof gradeValue === 'number' ? String(gradeValue) : String(gradeValue || '').trim();

        if (!gradeText || !feedbackValue) {
          throw new Error('AI 评分结果缺少 grade 或 feedback 字段');
        }

        db.prepare('UPDATE notes SET grade = ?, feedback = ? WHERE id = ?').run(gradeText, feedbackValue, latestNote.id);

        return new Response(JSON.stringify({ grade: gradeText, feedback: feedbackValue, prompt_preview: prompt, files_used: files, ai_raw: raw }));
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
