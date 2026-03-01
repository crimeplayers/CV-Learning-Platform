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
  settings.forEach(s => config[s.key] = s.value);

  const apiKey = config.ai_api_key || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || 'sk-v15cf8994429b44e16fa51f281666da939eddcfce99H0yt3';
  if (!apiKey) {
    throw new Error('API Key is missing. Please configure it in Admin Settings or environment variables.');
  }
  
  const baseURL = config.ai_base_url || process.env.AI_BASE_URL || 'https://api.gptsapi.net/v1';
  const client = new OpenAI({ apiKey, baseURL, timeout: 30000, maxRetries: 2 });
  const model = config.ai_model || process.env.AI_MODEL || 'gpt-4o-mini';

  return { client, model };
};

export const buildPromptWithFiles = (basePrompt: string) => {
  const match = basePrompt.match(/FILES:\s*([^\n]+)/i);
  const files = match ? match[1].split(',').map(f => f.trim()).filter(Boolean) : [];

  const fileBlocks: string[] = [];
  const usedFiles: string[] = [];
  const dataRoot = path.resolve(DATA_DIR);

  for (const filePath of files) {
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(dataRoot, filePath);

    if (!resolved.startsWith(dataRoot)) continue;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;

    const content = fs.readFileSync(resolved, 'utf-8').slice(0, MAX_FILE_PREVIEW);
    fileBlocks.push(`[文件: ${resolved}]\n${content}`);
    usedFiles.push(resolved);
  }

  const appended = fileBlocks.length > 0 ? `\n\n[附加文件内容]\n${fileBlocks.join('\n\n')}` : '';
  const prompt = `${basePrompt}${appended}`;
  return { prompt, files: usedFiles };
};
