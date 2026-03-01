import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';
import fs from 'fs';
import path from 'path';

// Plan file persistence disabled for troubleshooting
const savePlanFile = (_studentId: number, _unitId: number, _content: string) => null;

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

      const aiTimeoutMs = Number(process.env.AI_TIMEOUT_MS || 45000);
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), aiTimeoutMs);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600, // keep generations concise to avoid timeouts
        temperature: 0.7,
        timeout: aiTimeoutMs,
        signal: controller.signal,
      }).finally(() => clearTimeout(abortTimer));

      const planContent = response.choices?.[0]?.message?.content?.trim() || '无法生成计划';
      
      const existing = db.prepare('SELECT id FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId);
      if (existing) {
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?').run(planContent, user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content) VALUES (?, ?, ?)').run(user.id, unitId, planContent);
      }

      const ai_raw = response.choices?.[0]?.message?.content || '';
      const saved = savePlanFile(user.id, Number(unitId), planContent);
      return new Response(JSON.stringify({ plan_content: planContent, prompt_preview: prompt, files_used: files, ai_raw, plan_file: saved, plan_version: null }));
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      const status = isAbort ? 504 : 500;
      const message = isAbort ? 'AI generation timed out. Try again with shorter input.' : err.message;
      return new Response(JSON.stringify({ error: message }), { status });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/plans*",
  maxDuration: 60
};
