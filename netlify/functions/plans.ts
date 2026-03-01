import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, logAiInteraction, enrichPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';

export default async (req: Request) => {
  const url = new URL(req.url);
  let user;
  try {
    user = authenticate(req);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401 });
  }

  if (req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/plans\/(\d+)$/);
    if (match) {
      const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, match[1]);
      return new Response(JSON.stringify(plan || null));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/plans/generate') {
    const { unitId } = await req.json();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });

    try {
      const { client, model } = getAiClient();
      let resourcesText = '无';
      try {
        const resources = JSON.parse(unit.resources || '[]');
        if (resources.length > 0) {
          resourcesText = resources.map((r: any) => `- ${r.title}: ${r.url || ''} ${r.description || ''}`).join('\n');
        }
      } catch (e) {}

      const prompt = prompts.generatePlan(unit, resourcesText);

      const enriched = enrichPromptWithFiles(prompt);
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: enriched.prompt }],
      });

      const planContent = response.choices?.[0]?.message?.content?.trim() || '无法生成计划';
      logAiInteraction({ userId: user.id, unitId, action: 'plan_generate', prompt: enriched.prompt, response: JSON.stringify(response) });
      
      const existing = db.prepare('SELECT id FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId);
      if (existing) {
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?').run(planContent, user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content) VALUES (?, ?, ?)').run(user.id, unitId, planContent);
      }

      return new Response(JSON.stringify({ plan_content: planContent }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/plans*"
};
