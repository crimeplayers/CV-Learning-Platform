import { Config } from "@netlify/functions";
import { authenticate, getAiClient, buildPromptWithFiles } from './utils';
import { prompts } from '../../server/prompts';
import db from './db';
import path from 'path';

export default async (req: Request) => {
  const url = new URL(req.url);
  let user;
  try {
    user = authenticate(req);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 401 });
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    const { question, context, unitId } = await req.json();
    try {
      const { client, model } = getAiClient();
      let latestNoteContext = '';
      if (unitId) {
        const latestNote = db.prepare('SELECT content, file_url, created_at FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id, unitId) as any;
        if (latestNote) {
          latestNoteContext = `\n【该学生在本单元最新一次笔记（后端实时读取）】\n提交时间：${latestNote.created_at || '未知'}\n笔记内容：${latestNote.content || '无'}\n是否有附件：${latestNote.file_url ? `是（${latestNote.file_url}）` : '否'}\n`;
        } else {
          latestNoteContext = `\n【该学生在本单元最新一次笔记（后端实时读取）】\n当前无笔记记录。\n`;
        }
      }

      const mergedContext = `${context || ''}${latestNoteContext}`;
      const latestAttachment = unitId
        ? (db.prepare('SELECT file_url FROM notes WHERE student_id = ? AND unit_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id, unitId) as any)?.file_url
        : null;
      const latestAttachmentFile = latestAttachment && String(latestAttachment).startsWith('/notes/')
        ? path.join(process.env.DATA_DIR || '/data', 'notes', path.basename(String(latestAttachment)))
        : latestAttachment && String(latestAttachment).startsWith('/uploads/')
          ? path.join(process.env.UPLOADS_DIR || path.join(process.env.DATA_DIR || '/data', 'uploads'), path.basename(String(latestAttachment)))
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
      return new Response(JSON.stringify({ answer, prompt_preview: prompt, files_used: files, ai_raw }));
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response('Not found', { status: 404 });
};

export const config: Config = {
  path: "/api/ai/chat"
};
