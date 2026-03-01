import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import db from './db';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const DATA_DIR = process.env.DATA_DIR || '/data';
const MAX_FILE_PREVIEW = 8000;

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

export const buildPromptWithFiles = (basePrompt: string) => {
  const match = basePrompt.match(/FILES:\s*([^\n]+)/i);
  const files = match ? match[1].split(',').map(f => f.trim()).filter(Boolean) : [];

  const fileBlocks: string[] = [];
  const usedFiles: string[] = [];
  const dataRoot = path.resolve(DATA_DIR);
  const allowedTextExt = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);
  const maxTextBytes = 512 * 1024;
  const maxBinaryBytes = 5 * 1024 * 1024; // attachments up to 5MB (not inlined)

  for (const filePath of files) {
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(dataRoot, filePath);

    if (!resolved.startsWith(dataRoot)) continue;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;

    const ext = path.extname(resolved).toLowerCase();
    const stat = fs.statSync(resolved);

    if (allowedTextExt.has(ext) && stat.size <= maxTextBytes) {
      const content = fs.readFileSync(resolved, 'utf-8').slice(0, MAX_FILE_PREVIEW);
      fileBlocks.push(`[文件: ${resolved}]\n${content}`);
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
