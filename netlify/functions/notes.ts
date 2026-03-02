import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/data';
const NOTES_DIR = path.join(DATA_DIR, 'notes');
if (!fs.existsSync(NOTES_DIR)) {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  let user;
  try {
    user = authenticate(req);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401 });
  }

  if (req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/notes\/(\d+)$/);
    if (match) {
      const notes = db.prepare('SELECT * FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC').all(user.id, match[1]);
      return new Response(JSON.stringify(notes));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/notes') {
    try {
      const formData = await req.formData();
      const unitId = formData.get('unitId') as string;
      const week = formData.get('week') as string;
      const content = formData.get('content') as string;
      const file = formData.get('file') as File | null;

      const existingNotesCount = db.prepare('SELECT COUNT(*) as count FROM notes WHERE student_id = ? AND unit_id = ?').get(user.id, unitId) as { count: number };
      const noteVersion = Number(existingNotesCount?.count || 0) + 1;

      const noteContentFilename = `note-s${user.id}-u${unitId}-n${noteVersion}.md`;
      const noteContentPath = path.join(NOTES_DIR, noteContentFilename);
      const noteContentForFile = (content || '').trim() || '（本次仅提交了附件，未填写文字内容）';
      fs.writeFileSync(noteContentPath, noteContentForFile, 'utf-8');

      let fileUrl = null;
      if (file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const originalExt = path.extname(file.name || '').toLowerCase();
        const ext = originalExt || '.bin';
        const filename = `note-s${user.id}-u${unitId}-n${noteVersion}-file${ext}`;
        fs.writeFileSync(path.join(NOTES_DIR, filename), buffer);
        fileUrl = `/notes/${filename}`;
      }

      const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
      if (!unit) return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });

      const result = db.prepare('INSERT INTO notes (student_id, unit_id, week, content, file_url) VALUES (?, ?, ?, ?, ?)').run(user.id, unitId, week, content || '', fileUrl);
      const noteId = result.lastInsertRowid;

      // Adjust plan
      try {
        const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(user.id, unitId) as any;
        if (plan) {
          const { client, model } = getAiClient();
          const now = new Date();
          const planCreatedAt = plan.created_at ? new Date(plan.created_at) : null;
          const planUpdatedAt = plan.updated_at ? new Date(plan.updated_at) : null;
          const hoursSinceCreated = planCreatedAt ? Math.max(0, Math.floor((now.getTime() - planCreatedAt.getTime()) / 3600000)) : null;
          const hoursSinceUpdated = planUpdatedAt ? Math.max(0, Math.floor((now.getTime() - planUpdatedAt.getTime()) / 3600000)) : null;
          const progressContext = [
            `当前时间: ${now.toISOString()}`,
            `本次笔记提交序号: 第${noteVersion}次`,
            `本次笔记提交周次字段: ${week || '未知'}`,
            `原计划创建时间: ${plan.created_at || '未知'}`,
            `原计划上次更新时间: ${plan.updated_at || '未知'}`,
            `距原计划创建已过小时: ${hoursSinceCreated ?? '未知'}`,
            `距原计划上次更新已过小时: ${hoursSinceUpdated ?? '未知'}`,
            `单元周次范围: 第${unit.week_range}周`
          ].join('\n');

          const baseAdjustPrompt = prompts.adjustPlan(unit, plan, content, fileUrl, progressContext);
          const noteAttachmentPath = fileUrl && String(fileUrl).startsWith('/notes/')
            ? path.join(NOTES_DIR, path.basename(String(fileUrl)))
            : null;
          const adjustPromptWithFile = noteAttachmentPath ? `${baseAdjustPrompt}\nFILES: ${noteAttachmentPath}` : baseAdjustPrompt;
          const { prompt: adjustPrompt } = await buildPromptWithFiles(adjustPromptWithFile, client);

          const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: adjustPrompt }],
          });

          const newPlanContent = response.choices?.[0]?.message?.content?.trim() || plan.plan_content;
          db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPlanContent, plan.id);
        }
      } catch (err) {
        console.error('Failed to adjust plan', err);
      }

      return new Response(JSON.stringify({ id: noteId, message: 'Note saved and plan adjusted' }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/notes*"
};
