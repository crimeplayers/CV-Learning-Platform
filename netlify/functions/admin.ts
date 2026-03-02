import { Config } from "@netlify/functions";
import db from './db';
import bcrypt from 'bcryptjs';
import { authenticate, getAiClient } from './utils';

export default async (req: Request) => {
  const url = new URL(req.url);
  let user;
  try {
    user = authenticate(req);
    if (user.role !== 'admin') throw new Error('Forbidden');
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: err.message === 'Forbidden' ? 403 : 401 });
  }

  // Users API
  if (url.pathname === '/api/admin/users/batch' && req.method === 'POST') {
    const { text } = await req.json();
    const rawText = String(text || '');
    if (!rawText.trim()) {
      return new Response(JSON.stringify({ error: '请输入批量账号文本' }), { status: 400 });
    }

    const lines = rawText.split(/\r?\n/);
    const checkUserStmt = db.prepare('SELECT id FROM users WHERE username = ?');
    const insertStmt = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');

    const results: any[] = [];
    let parsed = 0;
    let created = 0;
    let skipped = 0;

    const createMany = db.transaction(() => {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        if (!line) continue;

        parsed += 1;
        const parts = line.split(/\s+/).filter(Boolean);
        if (parts.length < 2) {
          skipped += 1;
          results.push({ line: i + 1, status: 'skipped', reason: '格式错误，应为“学号 姓名”' });
          continue;
        }

        const studentId = String(parts[0] || '').trim();
        const rawName = parts.slice(1).join(' ').trim();
        const username = rawName.replace(/\*/g, '').trim();

        if (!studentId || !username) {
          skipped += 1;
          results.push({ line: i + 1, status: 'skipped', reason: '学号或姓名为空' });
          continue;
        }

        if (checkUserStmt.get(username)) {
          skipped += 1;
          results.push({ line: i + 1, studentId, username, status: 'skipped', reason: '用户名已存在' });
          continue;
        }

        const hash = bcrypt.hashSync(studentId, 10);
        const insertResult = insertStmt.run(username, hash, 'student');
        created += 1;
        results.push({ line: i + 1, id: insertResult.lastInsertRowid, studentId, username, status: 'created' });
      }
    });

    try {
      createMany();
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message || '批量创建失败' }), { status: 500 });
    }

    return new Response(JSON.stringify({
      total_lines: lines.length,
      parsed,
      created,
      skipped,
      results
    }));
  }

  if (url.pathname === '/api/admin/users') {
    if (req.method === 'GET') {
      const users = db.prepare('SELECT id, username, role FROM users').all();
      return new Response(JSON.stringify(users));
    }
    if (req.method === 'POST') {
      const { username, password, role } = await req.json();
      try {
        const hash = bcrypt.hashSync(password, 10);
        const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role || 'student');
        return new Response(JSON.stringify({ id: result.lastInsertRowid, username, role: role || 'student' }));
      } catch (err) {
        return new Response(JSON.stringify({ error: 'User already exists' }), { status: 400 });
      }
    }
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (userMatch) {
    const id = userMatch[1];
    if (req.method === 'PUT') {
      const { username, password, role } = await req.json();
      try {
        if (password) {
          const hash = bcrypt.hashSync(password, 10);
          db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?').run(username, hash, role, id);
        } else {
          db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?').run(username, role, id);
        }
        return new Response(JSON.stringify({ success: true }));
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Update failed' }), { status: 400 });
      }
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  // Settings API
  if (url.pathname === '/api/admin/settings') {
    if (req.method === 'GET') {
      const settings = db.prepare('SELECT * FROM settings').all();
      return new Response(JSON.stringify(settings));
    }
    if (req.method === 'POST') {
      const { settings } = await req.json();
      const updateStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      const updateMany = db.transaction((settingsList) => {
        for (const s of settingsList) {
          updateStmt.run(s.key, s.value);
        }
      });
      updateMany(settings);
      return new Response(JSON.stringify({ success: true }));
    }
  }

  if (url.pathname === '/api/admin/ai/test' && req.method === 'POST') {
    try {
      const { message = '这是一次AI可用性测试，请简短回应。' } = await req.json();
      const { client, model } = getAiClient();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
      });
      const reply = response.choices?.[0]?.message?.content?.trim() || '';
      return new Response(JSON.stringify({ ok: true, reply }));
    } catch (err: any) {
      return new Response(JSON.stringify({ ok: false, error: err.message || 'AI test failed' }), { status: 500 });
    }
  }

  // Records API
  if (url.pathname === '/api/admin/notes' && req.method === 'GET') {
    const notes = db.prepare(`
      SELECT n.*, u.username AS student_username, un.title AS unit_title
      FROM notes n
      JOIN users u ON n.student_id = u.id
      JOIN units un ON n.unit_id = un.id
      ORDER BY n.created_at DESC
    `).all();
    return new Response(JSON.stringify(notes));
  }

  if (url.pathname === '/api/admin/plans' && req.method === 'GET') {
    const plans = db.prepare(`
      SELECT p.*, u.username AS student_username, un.title AS unit_title
      FROM study_plans p
      JOIN users u ON p.student_id = u.id
      JOIN units un ON p.unit_id = un.id
      ORDER BY p.updated_at DESC
    `).all();
    return new Response(JSON.stringify(plans));
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/admin/*"
};
