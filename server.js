// ============================================================
//  心理对话工具 · 后端服务
//  作用：保管 API Key、把用户消息 + 系统提示词转发给 DeepSeek，
//        并把回复流式（打字机效果）返回给网页。
//  你不需要改这个文件的逻辑，只需要在部署时填一个环境变量 DEEPSEEK_API_KEY。
// ============================================================

import http from 'http';
import { SYSTEM_PROMPT } from './systemPrompt.js';

// —— 从环境变量读取你的 DeepSeek 密钥（部署时填，绝不写死在代码里）——
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'; // 默认用 deepseek-chat
const PORT = process.env.PORT || 9000;

// DeepSeek 的接口地址（与 OpenAI 格式兼容）
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

// —— 简单的前端页面（把 index.html 内联进来，部署时不用管静态文件）——
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
let INDEX_HTML = '';
try {
  INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf-8');
} catch (e) {
  INDEX_HTML = '<h1>index.html 未找到</h1>';
}

const server = http.createServer(async (req, res) => {
  // CORS（允许网页调用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // —— 首页：返回聊天网页 ——
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
    return;
  }

  // —— 聊天接口 ——
  if (req.method === 'POST' && req.url === '/api/chat') {
    if (!API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '服务器还没有配置 DEEPSEEK_API_KEY，请在部署平台的环境变量里填入你的密钥。' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let history = [];
      try {
        const parsed = JSON.parse(body || '{}');
        history = Array.isArray(parsed.messages) ? parsed.messages : [];
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ error: '请求格式错误' })); return;
      }

      // 只保留最近 20 轮，避免上下文过长、控制成本
      const trimmed = history.slice(-40);

      // 组装发给 DeepSeek 的消息：系统提示词 在最前
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...trimmed
      ];

      try {
        // 用流式返回，前端可以做打字机效果
        const upstream = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 2048
          })
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '调用模型失败：' + errText.slice(0, 300) }));
          return;
        }

        // 把上游的流原样转发给前端（SSE 格式）
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
        res.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '服务器出错：' + String(err).slice(0, 200) }));
      }
    });
    return;
  }

  // 其它路径
  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`心理对话工具后端已启动，端口 ${PORT}`);
});
