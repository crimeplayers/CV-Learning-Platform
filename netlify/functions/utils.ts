import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import db from './db';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export const authenticate = (req: Request) => {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) throw new Error('Unauthorized');
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch (err) {
    throw new Error('Invalid token');
  }
};

export const getAiClient = () => {
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

const DATA_ROOT = process.env.DATA_ROOT || '/data';

export const enrichPromptWithFiles = (prompt: string) => {
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
    if (!absPath.startsWith(path.resolve(DATA_ROOT))) continue;
    if (!fs.existsSync(absPath)) continue;
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const truncated = content.length > 20000 ? content.slice(0, 20000) + '\n...[truncated]' : content;
      readable.push({ path: absPath, content: truncated });
    } catch (e) {
      continue;
    }
  }

  if (readable.length === 0) return { prompt, files };

  const append = readable.map(r => `---\n路径: ${r.path}\n内容:\n${r.content}`).join('\n\n');
  const finalPrompt = `${prompt}\n\n[附加文件内容]\n${append}`;
  return { prompt: finalPrompt, files };
};

export const logAiInteraction = (params: { userId?: number; unitId?: number | string | null; action: string; prompt: string; response: string }) => {
  const { userId = null, unitId = null, action, prompt, response } = params;
  try {
    db.prepare('INSERT INTO ai_logs (user_id, unit_id, action, prompt, response) VALUES (?, ?, ?, ?, ?)')
      .run(userId, unitId, action, prompt, response);
  } catch (err) {
    console.error('Failed to log AI interaction', err);
  }
};
