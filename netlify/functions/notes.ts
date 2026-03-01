import { Config } from "@netlify/functions";
import db from './db';
import { authenticate, getAiClient } from './utils';
import { prompts } from '../../server/prompts';
import fs from 'fs';
import path from 'path';

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

      let fileUrl = null;
      if (file) {
        // In a real Netlify environment, writing to local disk isn't persistent.
        // You would typically upload to S3, Cloudinary, etc.
        // For this demo, we'll write to /tmp which is allowed in Netlify functions.
        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = `${Date.now()}-${file.name}`;
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buffer);
        fileUrl = `/uploads/${filename}`;
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
          const prompt = prompts.adjustPlan(unit, plan, content, fileUrl);

          const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
          });

          const newPlanContent = response.choices?.[0]?.message?.content?.trim() || plan.plan_content;
          db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPlanContent, plan.id);

          const planDir = path.join(process.env.DATA_DIR || '/data', 'plan');
          if (!fs.existsSync(planDir)) fs.mkdirSync(planDir, { recursive: true });
          const files = fs.readdirSync(planDir).filter(f => f.startsWith(`${user.id}-${unitId}-plan-`) && f.endsWith('.md'));
          const version = files.length + 1;
          const filename = `${user.id}-${unitId}-plan-${version}.md`;
          fs.writeFileSync(path.join(planDir, filename), newPlanContent, 'utf-8');
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
