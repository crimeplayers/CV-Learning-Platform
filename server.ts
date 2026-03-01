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
const DATA_DIR = process.env.DATA_DIR || '/data';
const PLAN_DIR = path.join(DATA_DIR, 'plan');
const MAX_FILE_PREVIEW = 8000;

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
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

  if (!fs.existsSync(PLAN_DIR)) {
    fs.mkdirSync(PLAN_DIR, { recursive: true });
  }

  // AI Setup
  const getAiClient = () => {
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const config: Record<string, string> = {};
    settings.forEach(s => config[s.key] = typeof s.value === 'string' ? s.value.trim() : s.value);

    const apiKey = config.ai_api_key || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || 'sk-mnVcHeOzlSwmJ2zO4n8hFdR1E9jyOUjZMmy5HrzByC8uaKRb';
    if (!apiKey) {
      throw new Error('API Key is missing. Please configure it in Admin Settings or environment variables.');
    }

    const baseURL = config.ai_base_url || process.env.AI_BASE_URL || 'https://api.moonshot.cn/v1';
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 60000);
    const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 2 });
    const model = config.ai_model || process.env.AI_MODEL || 'kimi-k2.5';

    return { client, model };
  };

  // Disabled plan file persistence per user request (was saving markdown to /data/plan)
  const savePlanFile = (_studentId: number, _unitId: number, _content: string) => null;

  const buildPromptWithFiles = (basePrompt: string) => {
    const match = basePrompt.match(/FILES:\s*([^\n]+)/i);
    const files = match ? match[1].split(',').map(f => f.trim()).filter(Boolean) : [];

    const fileBlocks: string[] = [];
    const usedFiles: string[] = [];
    const dataRoot = path.resolve(DATA_DIR);
    const allowedTextExt = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);
    const maxTextBytes = 512 * 1024; // inline text cap
    const maxBinaryBytes = 5 * 1024 * 1024; // attachments up to 5MB (not inlined)

    for (const filePath of files) {
      const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(dataRoot, filePath);

      if (!resolved.startsWith(dataRoot)) continue; // prevent path escape
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;

      const ext = path.extname(resolved).toLowerCase();
      const stat = fs.statSync(resolved);

      if (allowedTextExt.has(ext) && stat.size <= maxTextBytes) {
        const content = fs.readFileSync(resolved, 'utf-8').slice(0, MAX_FILE_PREVIEW);
        fileBlocks.push(`[文件: ${resolved}]
${content}`);
        usedFiles.push(resolved);
      } else if (stat.size <= maxBinaryBytes) {
        fileBlocks.push(`[二进制文件(未内联): ${resolved}] 大小: ${stat.size} bytes。请将该文件视为外部附件，无法直接内联。`);
        usedFiles.push(resolved);
      } else {
        fileBlocks.push(`[文件: ${resolved}] (跳过附件，原因: 非文本且超过限制)`);
      }
    }

    const appended = fileBlocks.length > 0 ? `\n\n[附加文件内容]\n${fileBlocks.join('\n\n')}` : '';
    const prompt = `${basePrompt}${appended}`;
    return { prompt, files: usedFiles };
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
    const startedAt = Date.now();
    const { unitId, prompt: clientPrompt } = req.body;
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    try {
      const { client, model } = getAiClient();
      let basePrompt: string | undefined = clientPrompt;
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
      const { prompt, files } = buildPromptWithFiles(basePrompt);

      const aiTimeoutMs = Number(process.env.AI_TIMEOUT_MS || 60000);
      const maxCompletionTokens = Number(process.env.AI_PLAN_MAX_TOKENS || 4800);

      const callAiWithTimeout = async (userPrompt: string) => {
        let timeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('AI_REQUEST_TIMEOUT')), aiTimeoutMs);
        });

        try {
          return await Promise.race([
            client.chat.completions.create({
              model,
              messages: [{ role: 'user', content: userPrompt }],
              max_tokens: maxCompletionTokens,
              temperature: 1,
            }),
            timeoutPromise
          ]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };

      let response = await callAiWithTimeout(prompt);
      let ai_raw = response.choices?.[0]?.message?.content?.trim() || '';

      if (!ai_raw) {
        const retryPrompt = `${prompt}\n\n请仅输出最终学习计划正文（中文），不要输出思考过程，不要留空。`;
        response = await callAiWithTimeout(retryPrompt);
        ai_raw = response.choices?.[0]?.message?.content?.trim() || '';
      }

      if (!ai_raw) {
        console.error('[plans.generate] empty ai response', JSON.stringify(response));
        throw new Error('AI 返回空响应');
      }

      const planContent = ai_raw;
      
      const existing = db.prepare('SELECT id FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId);
      if (existing) {
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?').run(planContent, req.user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content) VALUES (?, ?, ?)').run(req.user.id, unitId, planContent);
      }

      const saved = savePlanFile(req.user.id, Number(unitId), planContent);
      const elapsed_ms = Date.now() - startedAt;
      console.log('[plans.generate] elapsed_ms=%d unitId=%s user=%s', elapsed_ms, unitId, req.user?.id);
      res.json({ plan_content: planContent, prompt_preview: prompt, files_used: files, ai_raw, plan_file: saved?.filepath, plan_version: saved?.version, elapsed_ms });
    } catch (err: any) {
      const isTimeout = err?.message === 'AI_REQUEST_TIMEOUT';
      const status = isTimeout ? 504 : 500;
      const message = isTimeout ? 'AI generation timed out. Try again with shorter input.' : err?.message || 'Unknown error';
      console.error('[plans.generate] error', message, err);
      res.status(status).json({ error: message });
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

        const response = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
        });

        const newPlanContent = response.choices?.[0]?.message?.content?.trim() || plan.plan_content;
        db.prepare('UPDATE study_plans SET plan_content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPlanContent, plan.id);

        savePlanFile(req.user.id, Number(unitId), newPlanContent);
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
      const basePrompt = prompts.gradeUnit(unit, plan, latestNote);
      const { prompt, files } = buildPromptWithFiles(basePrompt);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = response.choices?.[0]?.message?.content || '';
      let result: any;
      try {
        result = JSON.parse(raw);
      } catch (e) {
        throw new Error('AI 返回的内容不是有效的 JSON');
      }
      db.prepare('UPDATE notes SET grade = ?, feedback = ? WHERE id = ?').run(result.grade, result.feedback, latestNote.id);

      res.json({ grade: result.grade, feedback: result.feedback, prompt_preview: prompt, files_used: files, ai_raw: raw });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AI Assistant Chat
  app.post('/api/ai/chat', authenticate, async (req: any, res: any) => {
    const { question, context } = req.body;
    try {
      const { client, model } = getAiClient();
      const basePrompt = prompts.qaAssistant(context, question);
      const { prompt, files } = buildPromptWithFiles(basePrompt);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      const answer = response.choices?.[0]?.message?.content?.trim() || '';
      const ai_raw = response.choices?.[0]?.message?.content || '';
      res.json({ answer, prompt_preview: prompt, files_used: files, ai_raw });
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
