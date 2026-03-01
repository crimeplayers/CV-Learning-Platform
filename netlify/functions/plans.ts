import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';
import fs from 'fs';
import path from 'path';

const PLAN_DIR = path.join(process.env.DATA_DIR || '/data', 'plan');
if (!fs.existsSync(PLAN_DIR)) {
  fs.mkdirSync(PLAN_DIR, { recursive: true });
}

const savePlanFile = (studentId: number, unitId: number, content: string) => {
  const files = fs.readdirSync(PLAN_DIR).filter(f => f.startsWith(`${studentId}-${unitId}-plan-`) && f.endsWith('.md'));
  const version = files.length + 1;
  const filename = `${studentId}-${unitId}-plan-${version}.md`;
  const filepath = path.join(PLAN_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  return { filepath, version };
};

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

      const basePrompt = prompts.generatePlan(unit, resourcesText);
      const { prompt, files } = buildPromptWithFiles(basePrompt);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      const planContent = response.choices?.[0]?.message?.content?.trim() || '无法生成计划';
      
      const existing = db.prepare('SELECT id FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId);
      if (existing) {
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?').run(planContent, user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content) VALUES (?, ?, ?)').run(user.id, unitId, planContent);
      }

      const ai_raw = response.choices?.[0]?.message?.content || '';
      const saved = savePlanFile(user.id, Number(unitId), planContent);
      return new Response(JSON.stringify({ plan_content: planContent, prompt_preview: prompt, files_used: files, ai_raw, plan_file: saved.filepath, plan_version: saved.version }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/plans*"
};
