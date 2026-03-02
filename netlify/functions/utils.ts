import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import db from './db';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const DATA_DIR = process.env.DATA_DIR || '/data';
const NOTES_DIR = path.join(DATA_DIR, 'notes');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
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

export const buildPromptWithFiles = async (basePrompt: string, client?: any) => {
  const files = Array.from(basePrompt.matchAll(/FILES:\s*([^\n]+)/ig))
    .flatMap(match => match[1].split(',').map(f => f.trim()))
    .filter(Boolean);
  const uniqueFiles = Array.from(new Set(files));

  const fileBlocks: string[] = [];
  const usedFiles: string[] = [];
  const dataRoot = path.resolve(DATA_DIR);
  const notesRoot = path.resolve(NOTES_DIR);
  const uploadsRoot = path.resolve(UPLOADS_DIR);
  const allowedTextExt = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml']);
  const maxTextBytes = 512 * 1024;
  const maxBinaryBytes = 20 * 1024 * 1024;

  const resolveFilePathFromToken = (filePath: string) => {
    if (filePath.startsWith('/notes/')) return path.join(NOTES_DIR, path.basename(filePath));
    if (filePath.startsWith('/uploads/')) return path.join(UPLOADS_DIR, path.basename(filePath));
    return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(dataRoot, filePath);
  };

  for (const filePath of uniqueFiles) {
    const resolved = resolveFilePathFromToken(filePath);
    const isAllowedPath = resolved.startsWith(dataRoot) || resolved.startsWith(notesRoot) || resolved.startsWith(uploadsRoot);
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
    } else if (ext === '.pdf') {
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
