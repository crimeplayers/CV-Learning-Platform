import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import db from './server/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { prompts } from './server/prompts';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

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

    const apiKey = config.ai_api_key || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('API Key is missing. Please configure it in Admin Settings or environment variables.');
    }
    
    const options: any = { apiKey };
    if (config.ai_base_url) {
      options.baseUrl = config.ai_base_url;
    }
    
    return {
      client: new GoogleGenAI(options),
      model: config.ai_model || 'gemini-3-flash-preview'
    };
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

      const response = await client.models.generateContent({
        model: model,
        contents: prompt,
      });

      const planContent = response.text || '无法生成计划';
      
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

        const response = await client.models.generateContent({
          model: model,
          contents: prompt,
        });

        const newPlanContent = response.text || plan.plan_content;
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

      const response = await client.models.generateContent({
        model: model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const result = JSON.parse(response.text || '{}');
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

      const response = await client.models.generateContent({
        model: model,
        contents: prompt,
      });

      res.json({ answer: response.text });
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
