import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const PLAN_DIR = path.join(DATA_DIR, 'plan');
const MAX_PLAN_GENERATIONS = Math.max(0, Number(process.env.MAX_PLAN_GENERATIONS || 3));
const MAX_PLAN_ADJUSTMENTS = Math.max(0, Number(process.env.MAX_PLAN_ADJUSTMENTS || 3));

const getPretestFilePath = (unitId: number) => {
  const folder = path.join(DATA_DIR, `unit_plan/unit${unitId}`);
  const filename = `unit${unitId}plantest.md`;
  return path.join(folder, filename);
};

const resolvePretestFilePath = (unitId: number) => {
  const primary = getPretestFilePath(unitId);
  if (fs.existsSync(primary)) return primary;

  const localDataRoot = path.join(process.cwd(), 'data');
  const fallback = path.join(localDataRoot, `unit_plan/unit${unitId}`, `unit${unitId}plantest.md`);
  if (fs.existsSync(fallback)) return fallback;

  return primary;
};

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
    const pretestMatch = url.pathname.match(/^\/api\/plans\/pretest\/(\d+)$/);
    if (pretestMatch) {
      const unitId = Number(pretestMatch[1]);
      const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
      if (!unit) {
        return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });
      }

      const filePath = resolvePretestFilePath(unitId);
      if (!fs.existsSync(filePath)) {
        return new Response(JSON.stringify({ error: 'Pretest file not found' }), { status: 404 });
      }

      const question = fs.readFileSync(filePath, 'utf-8');
      return new Response(JSON.stringify({ unit_id: unitId, question, file_path: filePath }));
    }

    const match = url.pathname.match(/^\/api\/plans\/(\d+)$/);
    if (match) {
      const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, match[1]) as any;
      if (!plan) {
        return new Response(JSON.stringify(null));
      }

      const generateCount = Number(plan.generate_count || 0);
      const adjustCount = Number(plan.adjust_count || 0);
      return new Response(JSON.stringify({
        ...plan,
        generate_count: generateCount,
        adjust_count: adjustCount,
        max_generate_count: MAX_PLAN_GENERATIONS,
        max_adjust_count: MAX_PLAN_ADJUSTMENTS,
        remaining_generate_count: Math.max(0, MAX_PLAN_GENERATIONS - generateCount),
        remaining_adjust_count: Math.max(0, MAX_PLAN_ADJUSTMENTS - adjustCount)
      }));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/plans/generate') {
    const { unitId, prompt: clientPrompt, pretestAnswer } = await req.json();
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });

    try {
      const startedAt = Date.now();
      const { client, model } = getAiClient();
      const existing = db.prepare('SELECT id, generate_count, adjust_count, pretest_answer FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId) as any;
      const trimmedPretestAnswer = typeof pretestAnswer === 'string' ? pretestAnswer.trim() : '';

      if (!existing && !trimmedPretestAnswer) {
        return new Response(JSON.stringify({ error: '首次生成学习计划前，请先完成预设测评题并提交答案。' }), { status: 400 });
      }

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

      const knowledgeAnswer = trimmedPretestAnswer || String(existing?.pretest_answer || '').trim();
      if (knowledgeAnswer) {
        basePrompt = `${basePrompt}\n\n[学生基础水平测评答案]\n${knowledgeAnswer}\n\n请根据学生的基础知识水平制定学习计划：基础薄弱则补充基础概念与练习；基础较好则增加挑战任务与进阶资源。`;
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
      
      const currentGenerateCount = Number(existing?.generate_count || 0);
      if (currentGenerateCount >= MAX_PLAN_GENERATIONS) {
        return new Response(JSON.stringify({
          error: `学习计划最多可生成 ${MAX_PLAN_GENERATIONS} 次，当前次数已用完。`,
          max_generate_count: MAX_PLAN_GENERATIONS,
          generate_count: currentGenerateCount,
          remaining_generate_count: 0
        }), { status: 429 });
      }

      if (existing) {
        db.prepare(`UPDATE study_plans SET plan_content = ?, generate_count = COALESCE(generate_count, 0) + 1, pretest_answer = COALESCE(NULLIF(?, ''), pretest_answer), pretest_submitted_at = CASE WHEN TRIM(COALESCE(?, '')) <> '' THEN CURRENT_TIMESTAMP ELSE pretest_submitted_at END, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?`).run(planContent, trimmedPretestAnswer, trimmedPretestAnswer, user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content, generate_count, adjust_count, pretest_answer, pretest_submitted_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(user.id, unitId, planContent, 1, 0, trimmedPretestAnswer);
      }

      const refreshed = db.prepare('SELECT generate_count, adjust_count FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId) as any;
      const generateCount = Number(refreshed?.generate_count || 0);
      const adjustCount = Number(refreshed?.adjust_count || 0);

      const saved = savePlanFile(user.id, Number(unitId), planContent);
      const elapsed_ms = Date.now() - startedAt;
      console.log('[plans.generate] elapsed_ms=%d unitId=%s user=%s', elapsed_ms, unitId, user.id);
      return new Response(JSON.stringify({
        plan_content: planContent,
        prompt_preview: prompt,
        files_used: files,
        ai_raw,
        plan_file: saved,
        plan_version: null,
        elapsed_ms,
        generate_count: generateCount,
        adjust_count: adjustCount,
        max_generate_count: MAX_PLAN_GENERATIONS,
        max_adjust_count: MAX_PLAN_ADJUSTMENTS,
        remaining_generate_count: Math.max(0, MAX_PLAN_GENERATIONS - generateCount),
        remaining_adjust_count: Math.max(0, MAX_PLAN_ADJUSTMENTS - adjustCount)
      }));
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
