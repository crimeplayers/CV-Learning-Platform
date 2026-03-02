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
const NOTES_DIR = path.join(DATA_DIR, 'notes');
const MAX_FILE_PREVIEW = 8000;
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

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
if (!fs.existsSync(NOTES_DIR)) {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
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
  const PORT = Number(process.env.PORT || 3000);

  app.use(cors()); // <--- 新增这一行

  app.use(express.json());
  app.use('/uploads', express.static(uploadsDir));
  app.use('/notes', express.static(NOTES_DIR));

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

  const tryExtractPdfLocally = async (resolvedPath: string) => {
    try {
      const pdfParseModule: any = await import('pdf-parse');
      const pdfParse = pdfParseModule?.default || pdfParseModule;
      const buffer = fs.readFileSync(resolvedPath);
      const parsed = await pdfParse(buffer);
      return (parsed?.text || '').slice(0, MAX_FILE_PREVIEW);
    } catch (err) {
      return '';
    }
  };

  const extractBinaryFileText = async (client: any, resolvedPath: string) => {
    try {
      const uploaded: any = await client.files.create({
        file: fs.createReadStream(resolvedPath),
        purpose: 'file-extract'
      });
      const contentResp: any = await client.files.content(uploaded.id);
      if (typeof contentResp?.text === 'function') {
        const text = await contentResp.text();
        return (text || '').slice(0, MAX_FILE_PREVIEW);
      }
      if (typeof contentResp?.text === 'string') {
        return contentResp.text.slice(0, MAX_FILE_PREVIEW);
      }
      if (typeof contentResp === 'string') {
        return contentResp.slice(0, MAX_FILE_PREVIEW);
      }
      return '';
    } catch (err) {
      if (path.extname(resolvedPath).toLowerCase() === '.pdf') {
        return await tryExtractPdfLocally(resolvedPath);
      }
      return '';
    }
  };

  const resolveFilePathFromToken = (filePath: string) => {
    if (filePath.startsWith('/notes/')) return path.join(NOTES_DIR, path.basename(filePath));
    if (filePath.startsWith('/uploads/')) return path.join(uploadsDir, path.basename(filePath));
    return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(path.resolve(DATA_DIR), filePath);
  };

  const buildPromptWithFiles = async (basePrompt: string, client?: any) => {
    const files = Array.from(basePrompt.matchAll(/FILES:\s*([^\n]+)/ig))
      .flatMap(match => match[1].split(',').map(f => f.trim()))
      .filter(Boolean);
    const uniqueFiles = Array.from(new Set(files));

    const fileBlocks: string[] = [];
    const usedFiles: string[] = [];
    const dataRoot = path.resolve(DATA_DIR);
    const uploadsRoot = path.resolve(uploadsDir);
    const notesRoot = path.resolve(NOTES_DIR);
    const allowedTextExt = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);
    const maxTextBytes = 512 * 1024; // inline text cap
    const maxBinaryBytes = 20 * 1024 * 1024;

    for (const filePath of uniqueFiles) {
      const resolved = resolveFilePathFromToken(filePath);
      const isAllowedPath = resolved.startsWith(dataRoot) || resolved.startsWith(uploadsRoot) || resolved.startsWith(notesRoot);
      if (!isAllowedPath) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;

      const ext = path.extname(resolved).toLowerCase();
      const stat = fs.statSync(resolved);

      if (stat.size <= maxBinaryBytes && client) {
        const extractedText = await extractBinaryFileText(client, resolved);
        if (extractedText) {
          fileBlocks.push(`[文件: ${resolved}][提取文本]\n${extractedText}`);
          usedFiles.push(resolved);
          continue;
        }
      }

      if (allowedTextExt.has(ext) && stat.size <= maxTextBytes) {
        const content = fs.readFileSync(resolved, 'utf-8').slice(0, MAX_FILE_PREVIEW);
        fileBlocks.push(`[文件: ${resolved}]\n${content}`);
        usedFiles.push(resolved);
      } else if (path.extname(resolved).toLowerCase() === '.pdf') {
        const fallbackPdfText = await tryExtractPdfLocally(resolved);
        if (fallbackPdfText) {
          fileBlocks.push(`[文件: ${resolved}][本地PDF提取]\n${fallbackPdfText}`);
          usedFiles.push(resolved);
        } else {
          fileBlocks.push(`[文件: ${resolved}] (尝试提取失败，可能是格式不支持或OCR失败)`);
        }
      } else {
        fileBlocks.push(`[文件: ${resolved}] (跳过附件，原因: 非文本且超过限制或未提供AI文件提取能力)`);
      }
    }

    const appended = fileBlocks.length > 0 ? `\n\n[附加文件内容]\n${fileBlocks.join('\n\n')}` : '';
    const prompt = `${basePrompt}${appended}`;
    return { prompt, files: usedFiles };
  };

  const parseGradeResult = (raw: string) => {
    if (!raw) return null;
    const trimmed = raw.trim();
    const withoutFence = trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const candidates = [withoutFence];
    const objectMatch = withoutFence.match(/\{[\s\S]*\}/);
    if (objectMatch) candidates.push(objectMatch[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed as any;
      } catch (err) {}
    }
    return null;
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

  app.post('/api/auth/change-password', authenticate, (req: any, res: any) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请输入旧密码和新密码' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码至少需要6位' });
    }

    const currentUser = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.user.id) as any;
    if (!currentUser) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const oldPasswordMatched = bcrypt.compareSync(oldPassword, currentUser.password);
    if (!oldPasswordMatched) {
      return res.status(400).json({ error: '旧密码不正确' });
    }

    const newPasswordHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPasswordHash, req.user.id);
    return res.json({ success: true, message: '密码修改成功' });
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
  app.get('/api/plans/:unitId(\\d+)', authenticate, (req: any, res: any) => {
    const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, req.params.unitId) as any;
    if (!plan) {
      return res.json(null);
    }

    const generateCount = Number(plan.generate_count || 0);
    const adjustCount = Number(plan.adjust_count || 0);
    res.json({
      ...plan,
      generate_count: generateCount,
      adjust_count: adjustCount,
      max_generate_count: MAX_PLAN_GENERATIONS,
      max_adjust_count: MAX_PLAN_ADJUSTMENTS,
      remaining_generate_count: Math.max(0, MAX_PLAN_GENERATIONS - generateCount),
      remaining_adjust_count: Math.max(0, MAX_PLAN_ADJUSTMENTS - adjustCount)
    });
  });

  app.get('/api/plans/pretest/:unitId', authenticate, (req: any, res: any) => {
    const unitId = Number(req.params.unitId);
    const unit = db.prepare('SELECT id FROM units WHERE id = ?').get(unitId);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const filePath = resolvePretestFilePath(unitId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Pretest file not found' });
    }

    const question = fs.readFileSync(filePath, 'utf-8');
    res.json({ unit_id: unitId, question, file_path: filePath });
  });

  app.post('/api/plans/generate', authenticate, async (req: any, res: any) => {
    const startedAt = Date.now();
    const { unitId, prompt: clientPrompt, pretestAnswer } = req.body;
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    try {
      const { client, model } = getAiClient();
      const existing = db.prepare('SELECT id, generate_count, adjust_count, pretest_answer FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId) as any;
      const trimmedPretestAnswer = typeof pretestAnswer === 'string' ? pretestAnswer.trim() : '';

      if (!existing && !trimmedPretestAnswer) {
        return res.status(400).json({ error: '首次生成学习计划前，请先完成预设测评题并提交答案。' });
      }

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

      const knowledgeAnswer = trimmedPretestAnswer || String(existing?.pretest_answer || '').trim();
      if (knowledgeAnswer) {
        basePrompt = `${basePrompt}\n\n[学生基础水平测评答案]\n${knowledgeAnswer}\n\n请根据学生的基础知识水平制定学习计划：基础薄弱则补充基础概念与练习；基础较好则增加挑战任务与进阶资源。`;
      }
      const { prompt, files } = await buildPromptWithFiles(basePrompt, client);

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
      
      const currentGenerateCount = Number(existing?.generate_count || 0);
      if (currentGenerateCount >= MAX_PLAN_GENERATIONS) {
        return res.status(429).json({
          error: `学习计划最多可生成 ${MAX_PLAN_GENERATIONS} 次，当前次数已用完。`,
          max_generate_count: MAX_PLAN_GENERATIONS,
          generate_count: currentGenerateCount,
          remaining_generate_count: 0
        });
      }

      if (existing) {
        db.prepare(`UPDATE study_plans SET plan_content = ?, generate_count = COALESCE(generate_count, 0) + 1, pretest_answer = COALESCE(NULLIF(?, ''), pretest_answer), pretest_submitted_at = CASE WHEN TRIM(COALESCE(?, '')) <> '' THEN CURRENT_TIMESTAMP ELSE pretest_submitted_at END, updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND unit_id = ?`).run(planContent, trimmedPretestAnswer, trimmedPretestAnswer, req.user.id, unitId);
      } else {
        db.prepare('INSERT INTO study_plans (student_id, unit_id, plan_content, generate_count, adjust_count, pretest_answer, pretest_submitted_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(req.user.id, unitId, planContent, 1, 0, trimmedPretestAnswer);
      }

      const refreshed = db.prepare('SELECT generate_count, adjust_count FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId) as any;
      const generateCount = Number(refreshed?.generate_count || 0);
      const adjustCount = Number(refreshed?.adjust_count || 0);

      const saved = savePlanFile(req.user.id, Number(unitId), planContent);
      const elapsed_ms = Date.now() - startedAt;
      console.log('[plans.generate] elapsed_ms=%d unitId=%s user=%s', elapsed_ms, unitId, req.user?.id);
      res.json({
        plan_content: planContent,
        prompt_preview: prompt,
        files_used: files,
        ai_raw,
        plan_file: saved?.filepath,
        plan_version: saved?.version,
        elapsed_ms,
        generate_count: generateCount,
        adjust_count: adjustCount,
        max_generate_count: MAX_PLAN_GENERATIONS,
        max_adjust_count: MAX_PLAN_ADJUSTMENTS,
        remaining_generate_count: Math.max(0, MAX_PLAN_GENERATIONS - generateCount),
        remaining_adjust_count: Math.max(0, MAX_PLAN_ADJUSTMENTS - adjustCount)
      });
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
    const existingNotesCount = db.prepare('SELECT COUNT(*) as count FROM notes WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId) as { count: number };
    const noteVersion = Number(existingNotesCount?.count || 0) + 1;

    const noteContentFilename = `note-s${req.user.id}-u${unitId}-n${noteVersion}.md`;
    const noteContentPath = path.join(NOTES_DIR, noteContentFilename);
    const noteContentForFile = (content || '').trim() || '（本次仅提交了附件，未填写文字内容）';
    fs.writeFileSync(noteContentPath, noteContentForFile, 'utf-8');

    let fileUrl = null;
    if (req.file) {
      const originalExt = path.extname(req.file.originalname || '').toLowerCase();
      const ext = originalExt || '.bin';
      const filename = `note-s${req.user.id}-u${unitId}-n${noteVersion}-file${ext}`;
      const fromPath = req.file.path;
      const toPath = path.join(NOTES_DIR, filename);
      fs.renameSync(fromPath, toPath);
      fileUrl = `/notes/${filename}`;
    }

    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as any;
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    // Save note
    const result = db.prepare('INSERT INTO notes (student_id, unit_id, week, content, file_url) VALUES (?, ?, ?, ?, ?)').run(req.user.id, unitId, week, content || '', fileUrl);
    const noteId = result.lastInsertRowid;

    let adjustApplied = false;
    let adjustSkippedReason = '';
    let adjustCount = 0;

    // Adjust plan
    try {
      const plan = db.prepare('SELECT * FROM study_plans WHERE student_id = ? AND unit_id = ?').get(req.user.id, unitId) as any;
      if (plan) {
        adjustCount = Number(plan.adjust_count || 0);
        if (adjustCount >= MAX_PLAN_ADJUSTMENTS) {
          adjustSkippedReason = `根据笔记调整计划已达到上限（${MAX_PLAN_ADJUSTMENTS}次）`;
        } else {
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
            : fileUrl && String(fileUrl).startsWith('/uploads/')
              ? path.join(uploadsDir, path.basename(String(fileUrl)))
              : null;
          const adjustPromptWithFile = noteAttachmentPath ? `${baseAdjustPrompt}\nFILES: ${noteAttachmentPath}` : baseAdjustPrompt;
          const { prompt: adjustPrompt } = await buildPromptWithFiles(adjustPromptWithFile, client);

          const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: adjustPrompt }],
          });

          const newPlanContent = response.choices?.[0]?.message?.content?.trim() || plan.plan_content;
          db.prepare('UPDATE study_plans SET plan_content = ?, adjust_count = COALESCE(adjust_count, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPlanContent, plan.id);

          savePlanFile(req.user.id, Number(unitId), newPlanContent);
          adjustApplied = true;
          adjustCount += 1;
        }
      } else {
        adjustSkippedReason = '当前单元尚未生成学习计划，已仅保存笔记';
      }
    } catch (err) {
      console.error('Failed to adjust plan', err);
      adjustSkippedReason = '计划调整失败，已仅保存笔记';
    }

    res.json({
      id: noteId,
      message: adjustApplied ? 'Note saved and plan adjusted' : 'Note saved',
      plan_adjusted: adjustApplied,
      adjust_skipped_reason: adjustSkippedReason,
      adjust_count: adjustCount,
      max_adjust_count: MAX_PLAN_ADJUSTMENTS,
      remaining_adjust_count: Math.max(0, MAX_PLAN_ADJUSTMENTS - adjustCount)
    });
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
      const noteAttachmentPath = latestNote.file_url && String(latestNote.file_url).startsWith('/notes/')
        ? path.join(NOTES_DIR, path.basename(String(latestNote.file_url)))
        : latestNote.file_url && String(latestNote.file_url).startsWith('/uploads/')
          ? path.join(uploadsDir, path.basename(String(latestNote.file_url)))
          : null;
      const promptWithNoteFile = noteAttachmentPath ? `${basePrompt}\nFILES: ${noteAttachmentPath}` : basePrompt;
      const { prompt, files } = await buildPromptWithFiles(promptWithNoteFile, client);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });

      let raw = response.choices?.[0]?.message?.content || '';
      let result: any = parseGradeResult(raw);

      if (!result) {
        const repairPrompt = `你上一条评分结果不是有效JSON。请严格仅返回一个JSON对象，不要输出任何额外文字：{"grade":85,"feedback":"..."}`;
        const retryResponse = await client.chat.completions.create({
          model,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: raw || '（空响应）' },
            { role: 'user', content: repairPrompt }
          ],
        });
        raw = retryResponse.choices?.[0]?.message?.content || raw;
        result = parseGradeResult(raw);
      }

      if (!result) {
        throw new Error('AI 返回的内容不是有效的 JSON');
      }

      const gradeValue = result.grade;
      const feedbackValue = typeof result.feedback === 'string' ? result.feedback.trim() : '';
      const gradeText = typeof gradeValue === 'number' ? String(gradeValue) : String(gradeValue || '').trim();

      if (!gradeText || !feedbackValue) {
        throw new Error('AI 评分结果缺少 grade 或 feedback 字段');
      }

      db.prepare('UPDATE notes SET grade = ?, feedback = ? WHERE id = ?').run(gradeText, feedbackValue, latestNote.id);

      res.json({ grade: gradeText, feedback: feedbackValue, prompt_preview: prompt, files_used: files, ai_raw: raw });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AI Assistant Chat
  app.post('/api/ai/chat', authenticate, async (req: any, res: any) => {
    const { question, context, unitId } = req.body;
    try {
      const { client, model } = getAiClient();
      let latestNoteContext = '';
      if (unitId) {
        const latestNote = db.prepare('SELECT content, file_url, created_at FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id, unitId) as any;
        if (latestNote) {
          latestNoteContext = `\n【该学生在本单元最新一次笔记（后端实时读取）】\n提交时间：${latestNote.created_at || '未知'}\n笔记内容：${latestNote.content || '无'}\n是否有附件：${latestNote.file_url ? `是（${latestNote.file_url}）` : '否'}\n`;
        } else {
          latestNoteContext = `\n【该学生在本单元最新一次笔记（后端实时读取）】\n当前无笔记记录。\n`;
        }
      }

      const mergedContext = `${context || ''}${latestNoteContext}`;
      const latestAttachment = unitId
        ? (db.prepare('SELECT file_url FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user.id, unitId) as any)?.file_url
        : null;
      const latestAttachmentFile = latestAttachment && String(latestAttachment).startsWith('/notes/')
        ? path.join(NOTES_DIR, path.basename(String(latestAttachment)))
        : latestAttachment && String(latestAttachment).startsWith('/uploads/')
          ? path.join(uploadsDir, path.basename(String(latestAttachment)))
          : null;
      const basePrompt = prompts.qaAssistant(mergedContext, question);
      const promptWithAttachment = latestAttachmentFile ? `${basePrompt}\nFILES: ${latestAttachmentFile}` : basePrompt;
      const { prompt, files } = await buildPromptWithFiles(promptWithAttachment, client);

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
