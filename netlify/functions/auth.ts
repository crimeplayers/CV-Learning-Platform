import { Config } from "@netlify/functions";
import db from './db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticate } from './utils';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export default async (req: Request) => {
  const url = new URL(req.url);
  
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const { username, password } = await req.json();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    return new Response(JSON.stringify({ token, user: { id: user.id, username: user.username, role: user.role } }));
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    try {
      const user = authenticate(req);
      if (user.role !== 'admin') return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      
      const { username, password } = await req.json();
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
      return new Response(JSON.stringify({ id: result.lastInsertRowid, username }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message || 'User already exists' }), { status: 400 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/auth/*"
};
