import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const PLAN_DIR = path.join(DATA_DIR, 'plan');

const savePlanFile = (studentId: number, unitId: number, content: string) => {
  if (!content?.trim()) return null;
  if (!fs.existsSync(PLAN_DIR)) {
    fs.mkdirSync(PLAN_DIR, { recursive: true });
  }

  const prefix = `plan-s${studentId}-u${unitId}-p`;
  const files = fs.readdirSync(PLAN_DIR);
  let maxVersion = 0;
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith('.md')) continue;
    const matched = file.match(/-p(\d+)\.md$/);
    const version = matched ? Number(matched[1]) : 0;
    if (version > maxVersion) maxVersion = version;
  }

  const nextVersion = maxVersion + 1;
  const filename = `${prefix}${nextVersion}.md`;
  const absolutePath = path.join(PLAN_DIR, filename);
  fs.writeFileSync(absolutePath, content, 'utf-8');

  return {
    filename,
    filepath: absolutePath,
    version: nextVersion
  };
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
    const { unitId, prompt: clientPrompt } = await req.json();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });

    try {
      const startedAt = Date.now();
      const { client, model } = getAiClient();
      let basePrompt = clientPrompt as string | undefined;
      if (!basePrompt) {
        let resourcesText = '无';
        try {
          const resources = JSON.parse(unit.resources || '[]');
          if (resources.length > 0) {
            resourcesText = resources.map((r: any) => `- ${r.title}: ${r.url || ''} ${r.description || ''}`).join('\n');
          }
        } catch (e) {}

        basePrompt = prompts.generatePlan(unit, resourcesText);
      }
      const { prompt, files } = await buildPromptWithFiles(basePrompt, client);

      const aiTimeoutMs = Number(process.env.AI_TIMEOUT_MS || 60000);
      const aiCall = client.chat.completions.create(
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
          temperature: 1,
        }
      );

      let timeoutId: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('AI_REQUEST_TIMEOUT'));
        }, aiTimeoutMs);
      });

      const response = await Promise.race([aiCall, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      const ai_raw = response.choices?.[0]?.message?.content || '';
      if (!ai_raw || !ai_raw.trim()) {
        console.error('[plans.generate] empty ai response', JSON.stringify(response));
        throw new Error('AI 返回空响应');
      }
      const planContent = ai_raw.trim();
      
      const existing = db.prepare('SELECT id FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId);
      if (existing) {
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?').run(planContent, user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content) VALUES (?, ?, ?)').run(user.id, unitId, planContent);
      }

      const saved = savePlanFile(user.id, Number(unitId), planContent);
      const elapsed_ms = Date.now() - startedAt;
      console.log('[plans.generate] elapsed_ms=%d unitId=%s user=%s', elapsed_ms, unitId, user.id);
      return new Response(JSON.stringify({ plan_content: planContent, prompt_preview: prompt, files_used: files, ai_raw, plan_file: saved, plan_version: null, elapsed_ms }));
    } catch (err: any) {
      const isTimeout = err?.message === 'AI_REQUEST_TIMEOUT';
      const isAbort = err?.name === 'AbortError';
      const status = isTimeout || isAbort ? 504 : 500;
      const message = isTimeout || isAbort ? 'AI generation timed out. Try again with shorter input.' : err?.message || 'Unknown error';
      console.error('[plans.generate] error', message, err);
      return new Response(JSON.stringify({ error: message }), { status });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/plans*",
  maxDuration: 60
};
