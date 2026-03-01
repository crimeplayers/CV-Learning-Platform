import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import db from './server/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { prompts } from './server/prompts';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const DATA_ROOT = process.env.DATA_ROOT || '/data';

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors()); // <--- 新增这一行

  app.use(express.json());
  app.use('/uploads', express.static(uploadsDir));

  // AI Setup
  const getAiClient = () => {
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const config: Record<string, string> = {};
    settings.forEach(s => config[s.key] = s.value);

    const apiKey = config.ai_api_key || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API Key is missing. Please configure it in Admin Settings or environment variables.');
    }

    const baseURL = config.ai_base_url || process.env.AI_BASE_URL || 'https://api.gptsapi.net/v1';
    const client = new OpenAI({ apiKey, baseURL, timeout: 30000, maxRetries: 2 });
    const model = config.ai_model || process.env.AI_MODEL || 'gpt-4o-mini';

    return { client, model };
  };

  const enrichPromptWithFiles = (prompt: string) => {
    // Extract files:["/data/a.txt"] array from prompt
    const match = prompt.match(/files\s*:\s*(\[[^\]]+\])/i);
    if (!match) return { prompt, files: [] as string[] };

    let files: string[] = [];
    try {
      files = JSON.parse(match[1]);
      if (!Array.isArray(files)) files = [];
    } catch (e) {
      files = [];
    }

    const readable: { path: string; content: string }[] = [];
    for (const f of files) {
      if (typeof f !== 'string') continue;
      const absPath = path.resolve(f);
      if (!absPath.startsWith(path.resolve(DATA_ROOT))) continue; // safety: only /data
      if (!fs.existsSync(absPath)) continue;
      try {
        const content = fs.readFileSync(absPath, 'utf8');
        // truncate to avoid overly long prompts
        const truncated = content.length > 20000 ? content.slice(0, 20000) + '\n...[truncated]' : content;
        readable.push({ path: absPath, content: truncated });
      } catch (e) {
        continue;
      }
    }

    if (readable.length === 0) return { prompt, files };

    const append = readable
      .map(item => `---\n路径: ${item.path}\n内容:\n${item.content}`)
      .join('\n\n');

    const finalPrompt = `${prompt}\n\n[附加文件内容]\n${append}`;
    return { prompt: finalPrompt, files };
  };

  const logAi = (params: { userId?: number; unitId?: number | string | null; action: string; prompt: string; response: string }) => {
    const { userId = null, unitId = null, action, prompt, response } = params;
    try {
      db.prepare('INSERT INTO ai_logs (user_id, unit_id, action, prompt, response) VALUES (?, ?, ?, ?, ?)')
        .run(userId, unitId, action, prompt, response);
    } catch (err) {
      console.error('Failed to log AI interaction', err);
    }
  };

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  // Admin Middleware
  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
  };

  // Admin Users API
  app.get('/api/admin/users', authenticate, requireAdmin, (req: any, res: any) => {
    const users = db.prepare('SELECT id, username, role FROM users').all();
    res.json(users);
  });

  app.post('/api/admin/users', authenticate, requireAdmin, (req: any, res: any) => {
    const { username, password, role } = req.body;
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role || 'student');
      res.json({ id: result.lastInsertRowid, username, role: role || 'student' });
    } catch (err) {
      res.status(400).json({ error: 'User already exists' });
    }
  });

  app.put('/api/admin/users/:id', authenticate, requireAdmin, (req: any, res: any) => {
    const { username, password, role } = req.body;
    try {
      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?').run(username, hash, role, req.params.id);
      } else {
        db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?').run(username, role, req.params.id);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: 'Update failed' });
    }
  });

  app.delete('/api/admin/users/:id', authenticate, requireAdmin, (req: any, res: any) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Admin Settings API
  app.get('/api/admin/settings', authenticate, requireAdmin, (req: any, res: any) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    res.json(settings);
  });

  app.post('/api/admin/settings', authenticate, requireAdmin, (req: any, res: any) => {
    const { settings } = req.body;
    const updateStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const updateMany = db.transaction((settingsList) => {
      for (const s of settingsList) {
        updateStmt.run(s.key, s.value);
      }
    });
    updateMany(settings);
    res.json({ success: true });
  });

  // Admin AI connectivity test
  app.post('/api/admin/ai/test', authenticate, requireAdmin, async (req: any, res: any) => {
    const message = req.body?.message || '这是一次AI可用性测试，请简短回应。';
    try {
      const { client, model } = getAiClient();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
      });
      const reply = response.choices?.[0]?.message?.content?.trim() || '';
      logAi({ userId: req.user.id, action: 'admin_ai_test', prompt: message, response: JSON.stringify(response) });
      res.json({ ok: true, reply });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'AI test failed' });
    }
  });

  // Admin Records API
  app.get('/api/admin/notes', authenticate, requireAdmin, (req: any, res: any) => {
    const notes = db.prepare(`
      SELECT n.*, u.username AS student_username, un.title AS unit_title
      FROM notes n
      JOIN users u ON n.student_id = u.id
      JOIN units un ON n.unit_id = un.id
      ORDER BY n.created_at DESC
    `).all();
    res.json(notes);
  });

  app.get('/api/admin/plans', authenticate, requireAdmin, (req: any, res: any) => {
    const plans = db.prepare(`
      SELECT p.*, u.username AS student_username, un.title AS unit_title
      FROM study_plans p
      JOIN users u ON p.student_id = u.id
      JOIN units un ON p.unit_id = un.id
      ORDER BY p.updated_at DESC
    `).all();
    res.json(plans);
  });

  app.get('/api/admin/ai-logs', authenticate, requireAdmin, (req: any, res: any) => {
    const limit = Number(req.query.limit || 200);
    const rows = db.prepare(`
      SELECT l.*, u.username AS user_username, un.title AS unit_title
      FROM ai_logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN units un ON l.unit_id = un.id
      ORDER BY l.created_at DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  });

  // Auth Routes
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post('/api/auth/register', authenticate, (req: any, res: any) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { username, password } = req.body;
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
      res.json({ id: result.lastInsertRowid, username });
    } catch (err) {
      res.status(400).json({ error: 'User already exists' });
    }
  });

  // Units
  app.get('/api/units', (req, res) => {
    const units = db.prepare('SELECT * FROM units').all();
    res.json(units);
  });

  app.get('/api/units/:id', (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(req.params.id);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    res.json(unit);
  });

  // Study Plans
  app.get('/api/plans/:unitId', authenticate, (req: any, res: any) => {
    const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, req.params.unitId);
    res.json(plan || null);
  });

  app.post('/api/plans/generate', authenticate, async (req: any, res: any) => {
    const { unitId } = req.body;
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

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
      logAi({ userId: req.user.id, unitId: unitId, action: 'plan_generate', prompt: enriched.prompt, response: JSON.stringify(response) });
      
      const existing = db.prepare('SELECT id FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId);
      if (existing) {
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?').run(planContent, req.user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content) VALUES (?, ?, ?)').run(req.user.id, unitId, planContent);
      }

      res.json({ plan_content: planContent });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Notes
  app.get('/api/notes/:unitId', authenticate, (req: any, res: any) => {
    const notes = db.prepare('SELECT * FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC').all(req.user.id, req.params.unitId);
    res.json(notes);
  });

  app.post('/api/notes', authenticate, upload.single('file'), async (req: any, res: any) => {
    const { unitId, week, content } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    // Save note
    const result = db.prepare('INSERT INTO notes (student_id, unit_id, week, content, file_url) VALUES (?, ?, ?, ?, ?)').run(req.user.id, unitId, week, content || '', fileUrl);
    const noteId = result.lastInsertRowid;

    // Adjust plan
    try {
      const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId) as any;
      if (plan) {
        const { client, model } = getAiClient();
        const prompt = prompts.adjustPlan(unit, plan, content, fileUrl);

          const enriched = enrichPromptWithFiles(prompt);
          const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: enriched.prompt }],
          });

          const newPlanContent = response.choices?.[0]?.message?.content?.trim() || plan.plan_content;
          logAi({ userId: req.user.id, unitId, action: 'plan_adjust', prompt: enriched.prompt, response: JSON.stringify(response) });
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPlanContent, plan.id);
      }
    } catch (err) {
      console.error('Failed to adjust plan', err);
    }

    res.json({ id: noteId, message: 'Note saved and plan adjusted' });
  });

  // Grade Unit
  app.post('/api/grade/:unitId', authenticate, async (req: any, res: any) => {
    const { unitId } = req.params;
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const latestNote = db.prepare('SELECT * FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id, unitId) as any;
    if (!latestNote) return res.status(400).json({ error: 'No notes found for this unit' });

    const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId) as any;

    try {
      const { client, model } = getAiClient();
      const prompt = prompts.gradeUnit(unit, plan, latestNote);

      const enriched = enrichPromptWithFiles(prompt);
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: enriched.prompt }],
      });

      const raw = response.choices?.[0]?.message?.content || '';
      let result: any;
      try {
        result = JSON.parse(raw);
      } catch (e) {
        throw new Error('AI 返回的内容不是有效的 JSON');
      }
      logAi({ userId: req.user.id, unitId, action: 'grade_unit', prompt: enriched.prompt, response: JSON.stringify(response) });
      db.prepare('UPDATE notes SET grade = ?, feedback = ? WHERE id = ?').run(result.grade, result.feedback, latestNote.id);

      res.json({ grade: result.grade, feedback: result.feedback });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AI Assistant Chat
  app.post('/api/ai/chat', authenticate, async (req: any, res: any) => {
    const { question, context } = req.body;
    try {
      const { client, model } = getAiClient();
      const prompt = prompts.qaAssistant(context, question);

      const enriched = enrichPromptWithFiles(prompt);
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: enriched.prompt }],
      });

      const answer = response.choices?.[0]?.message?.content?.trim() || '';
      logAi({ userId: req.user.id, action: 'qa_chat', prompt: enriched.prompt, response: JSON.stringify(response) });
      res.json({ answer });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
