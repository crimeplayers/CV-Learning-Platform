import { Config } from "@netlify/functions";
import db from './db';

export default async (req: Request) => {
  const url = new URL(req.url);
  
  if (req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/units\/(\d+)$/);
    if (match) {
      const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(match[1]);
      if (!unit) return new Response(JSON.stringify({ error: 'Unit not found' }), { status: 404 });
      return new Response(JSON.stringify(unit));
    } else if (url.pathname === '/api/units') {
      const units = db.prepare('SELECT * FROM units').all();
      return new Response(JSON.stringify(units));
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/units*"
};
