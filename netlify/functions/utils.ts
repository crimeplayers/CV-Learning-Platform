import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';
import db from './db';

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
