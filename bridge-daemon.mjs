#!/usr/bin/env node
/**
 * Local Codex Bridge Daemon (127.0.0.1:19820) — Local-First Plugin Injection & CORS Proxy
 *
 * 1. Manages local plugins in ./local-plugins/*.json
 *    and watches for changes (`fs.watch`), pushing live updates to the browser for runtime injection.
 * 2. Provides CORS-free external API proxy (`POST /proxy` & WS `bridge.fetch_proxy`) so injected
 *    plugin code can call `await bridge.fetchProxy(url, options)` without CORS errors.
 * 3. Spawns headless Codex (`codex exec --json`) to create/modify local plugins and pages.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BRIDGE_PORT || 19820);
const LOCAL_PLUGINS_DIR = path.join(__dirname, 'local-plugins');
const CHAT_SESSIONS_FILE = path.join(__dirname, 'chat-sessions.json');

fs.mkdirSync(LOCAL_PLUGINS_DIR, { recursive: true });

const BUNDLED_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const CODEX_BIN = fs.existsSync(BUNDLED_CODEX) ? BUNDLED_CODEX : 'codex';

const activeClients = new Set();
const pendingBrowserCalls = new Map();
const activeProcesses = new Map(); // requestId -> ChildProcess

function sanitizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled-plugin';
}

function listLocalPlugins() {
  const files = fs.readdirSync(LOCAL_PLUGINS_DIR).filter(f => f.endsWith('.json'));
  const plugins = [];
  for (const file of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(LOCAL_PLUGINS_DIR, file), 'utf8'));
      plugins.push({
        slug: p.slug || file.replace(/\.json$/, ''),
        kind: p.kind || (p.targetPage ? 'page-patch' : 'custom-page'),
        targetPage: p.targetPage || null,
        targetSelector: p.targetSelector || null,
        title: p.title || p.slug,
        icon: p.icon || '🔌',
        description: p.description || '',
        html: p.html || '',
        css: p.css || '',
        js: p.js || '',
        revisions: Array.isArray(p.revisions) ? p.revisions : [],
        updatedAt: p.updatedAt || new Date().toISOString(),
        source: 'local-bridge'
      });
    } catch (_) {}
  }
  plugins.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return plugins;
}

function readLocalPlugin(slug) {
  const fp = path.join(LOCAL_PLUGINS_DIR, `${sanitizeSlug(slug)}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveLocalPlugin(slug, input) {
  const cleanSlug = sanitizeSlug(slug || input.slug || input.title);
  const fp = path.join(LOCAL_PLUGINS_DIR, `${cleanSlug}.json`);
  const existing = readLocalPlugin(cleanSlug);
  const now = new Date().toISOString();

  let html = input.html !== undefined ? String(input.html) : (existing?.html || '');
  let css = input.css !== undefined ? String(input.css) : (existing?.css || '');
  let js = input.js !== undefined ? String(input.js) : (existing?.js || '');

  if (Array.isArray(input.patches) && existing) {
    for (const patch of input.patches) {
      const target = patch.target || 'html';
      const findStr = String(patch.find || '');
      const replaceStr = String(patch.replace ?? '');
      if (!findStr) continue;
      if (target === 'html') html = html.replace(findStr, replaceStr);
      if (target === 'css') css = css.replace(findStr, replaceStr);
      if (target === 'js') js = js.replace(findStr, replaceStr);
    }
  }

  const revisions = Array.isArray(existing?.revisions) ? [...existing.revisions] : [];
  if (existing && !input.skipRevision && (existing.html !== html || existing.css !== css || existing.js !== js)) {
    revisions.unshift({
      versionId: 'v_' + Date.now(),
      timestamp: existing.updatedAt || now,
      title: existing.title,
      html: existing.html,
      css: existing.css,
      js: existing.js
    });
    if (revisions.length > 15) revisions.length = 15;
  }

  const record = {
    slug: cleanSlug,
    kind: input.kind || existing?.kind || (input.targetPage ? 'page-patch' : 'custom-page'),
    targetPage: input.targetPage !== undefined ? input.targetPage : (existing?.targetPage || null),
    targetSelector: input.targetSelector !== undefined ? input.targetSelector : (existing?.targetSelector || null),
    title: input.title !== undefined ? String(input.title) : (existing?.title || cleanSlug),
    icon: input.icon !== undefined ? String(input.icon) : (existing?.icon || '🔌'),
    description: input.description !== undefined ? String(input.description) : (existing?.description || ''),
    html,
    css,
    js,
    revisions,
    updatedAt: now,
    source: 'local-bridge'
  };

  fs.writeFileSync(fp, JSON.stringify(record, null, 2));
  broadcastLocalPlugins(cleanSlug, Boolean(input.switchActive));
  return record;
}

function readChatSessions() {
  if (!fs.existsSync(CHAT_SESSIONS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(CHAT_SESSIONS_FILE, 'utf8'));
    return Array.isArray(raw.sessions) ? raw.sessions : [];
  } catch (_) {
    return [];
  }
}

function saveChatSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions.slice(0, 50) : [];
  fs.writeFileSync(CHAT_SESSIONS_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), sessions: list }, null, 2));
  return list;
}

function broadcastLocalPlugins(changedSlug = null, switchActive = false) {
  const payload = {
    jsonrpc: '2.0',
    method: 'local_plugins.sync',
    params: {
      changedSlug,
      switchActive,
      plugins: listLocalPlugins()
    }
  };
  for (const cli of activeClients) {
    cli.send(payload);
  }
}

// Watch local-plugins/ directory so any direct file edits by Codex also hot-inject into browser!
let watchDebounce = null;
fs.watch(LOCAL_PLUGINS_DIR, (eventType, filename) => {
  if (!filename || !filename.endsWith('.json')) return;
  clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => {
    const slug = filename.replace(/\.json$/, '');
    broadcastLocalPlugins(slug, false);
  }, 120);
});

// --- RFC 6455 WebSocket Helpers ---
function encodeWsFrame(text, opcode = 0x01) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function attachWebSocket(socket, onMessage, onClose) {
  let buffer = Buffer.alloc(0);

  const client = {
    socket,
    send(obj) {
      if (socket.destroyed) return;
      const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
      socket.write(encodeWsFrame(str, 0x01));
    }
  };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = Boolean(secondByte & 0x80);
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) return;

      let maskKey = null;
      if (isMasked) {
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      const payload = Buffer.from(buffer.subarray(offset, offset + payloadLen));
      buffer = buffer.subarray(offset + payloadLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x08) {
        socket.end(encodeWsFrame('', 0x08));
        return;
      } else if (opcode === 0x09) {
        socket.write(encodeWsFrame(payload.toString('utf8'), 0x0a));
      } else if (opcode === 0x01) {
        try {
          onMessage(client, JSON.parse(payload.toString('utf8')));
        } catch (err) {
          console.error('WS JSON parse error:', err);
        }
      }
    }
  });

  socket.on('close', () => onClose(client));
  socket.on('error', () => onClose(client));
  return client;
}

// --- External API Proxy (CORS Bypass on Local Machine) ---
async function executeExternalProxy({ url, method = 'GET', headers = {}, body = undefined, charset = 'utf-8' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const parsedTarget = new URL(url);
    if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
      throw new Error('Unsupported protocol: Only HTTP and HTTPS are allowed');
    }
    if (parsedTarget.hostname === '169.254.169.254') {
      throw new Error('Blocked metadata address');
    }

    const res = await fetch(parsedTarget.toString(), {
      method,
      headers,
      body: body !== undefined && !['GET', 'HEAD'].includes(String(method).toUpperCase())
        ? (typeof body === 'string' ? body : JSON.stringify(body))
        : undefined,
      signal: controller.signal
    });

    const contentType = res.headers.get('content-type') || '';
    const arrayBuffer = await res.arrayBuffer();
    let effectiveCharset = charset || 'utf-8';
    if (!charset && /charset=([^;\s]+)/i.test(contentType)) {
      effectiveCharset = contentType.match(/charset=([^;\s]+)/i)[1];
    }
    let text;
    try {
      text = new TextDecoder(effectiveCharset).decode(arrayBuffer);
    } catch (_) {
      text = new TextDecoder('utf-8').decode(arrayBuffer);
    }

    let parsed = text;
    if (contentType.includes('application/json')) {
      try { parsed = JSON.parse(text); } catch (_) {}
    }
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      headers: Object.fromEntries(res.headers.entries()),
      data: parsed
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// --- Spawn & Stop Headless Codex CLI (Single-Flight + Kill Support) ---
function stopCodexHeadless(requestId = null) {
  let stoppedCount = 0;
  for (const [reqId, procInfo] of activeProcesses.entries()) {
    if (!requestId || reqId === requestId) {
      procInfo.stoppedByUser = true;
      try { procInfo.proc.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { if (!procInfo.proc.killed) procInfo.proc.kill('SIGKILL'); } catch (_) {}
      }, 800);
      activeProcesses.delete(reqId);
      stoppedCount++;
      const payload = {
        jsonrpc: '2.0',
        method: 'codex.stream',
        params: { requestId: reqId, event: { type: 'process.stopped', exitCode: 130 } }
      };
      for (const cli of activeClients) cli.send(payload);
    }
  }
  return { ok: true, stoppedCount };
}

function runCodexHeadless(client, requestId, params = {}) {
  // Enforce single-flight: only 1 active headless task at a time
  if (activeProcesses.size > 0) {
    client.send({
      jsonrpc: '2.0',
      method: 'codex.stream',
      params: {
        requestId,
        event: {
          type: 'process.busy',
          message: '当前已有一个 AI 任务正在执行中，请等待完成或点击「停止」后再发送新任务。'
        }
      }
    });
    return;
  }

  const { prompt, threadId, activeSlug, activePageTitle } = params;
  const contextualPrompt = [
    `[当前工作台上下文 - Local-First 插件注入模式]`,
    `- 用户当前正在查看的页面: slug="${activeSlug || 'home'}" (标题: "${activePageTitle || '主页'}")`,
    `- 本地插件存储目录: ${LOCAL_PLUGINS_DIR}`,
    `- 你已挂载 page_studio MCP 工具。所有修改或新增的页面/挂件代码都保存在本机 local-plugins/*.json 中，并通过本地 Bridge 实时注入到浏览器页面显示（也可按用户同步到云端账号）。`,
    `- 如果用户的插件 JS 代码需要访问外部第三方 API，请在 JS 中使用 \`await bridge.fetchProxy(url, options)\` 通过本地桥接中转以避免 CORS 跨域问题；如果需要读取宿主页面数据或调用后台接口，可使用 \`bridge.getPageData()\` 和 \`await bridge.callBackendApi(path)\`。`,
    ``,
    `[用户请求]:`,
    prompt
  ].join('\n');

  const mcpServerPath = path.join(__dirname, 'mcp-server.mjs');
  const baseArgs = [
    '-c', `mcp_servers.page_studio.command="node"`,
    '-c', `mcp_servers.page_studio.args=${JSON.stringify([mcpServerPath])}`,
    'exec',
    '--cd', __dirname,
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox'
  ];

  const args = threadId
    ? [...baseArgs, 'resume', '--json', threadId, contextualPrompt]
    : [...baseArgs, '--json', contextualPrompt];

  const broadcastStream = (event) => {
    const payload = { jsonrpc: '2.0', method: 'codex.stream', params: { requestId, event } };
    for (const cli of activeClients) cli.send(payload);
  };

  const proc = spawn(CODEX_BIN, args, {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const procInfo = { proc, stoppedByUser: false, startedAt: Date.now() };
  activeProcesses.set(requestId, procInfo);

  broadcastStream({
    type: 'item.started',
    item: {
      id: 'spawn_init',
      type: 'reasoning',
      summary: `已拉起本地 Codex 无头进程 (PID: ${proc.pid})，代码将保存在本地 local-plugins/ 并实时注入页面...`
    }
  });

  let stdoutBuf = '';
  proc.stdout.on('data', (chunk) => {
    if (procInfo.stoppedByUser) return;
    stdoutBuf += chunk.toString('utf8');
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (
          event.type === 'item.completed' &&
          event.item?.type === 'error' &&
          String(event.item?.message || '').includes('ignoring')
        ) {
          continue;
        }
        if (event.type === 'thread.started') {
          broadcastStream({
            type: 'item.completed',
            item: { id: 'spawn_init', type: 'reasoning', summary: `本地 Codex 会话已就绪 (${event.thread_id.slice(0, 8)}...)` }
          });
        }
        broadcastStream(event);
      } catch (_) {}
    }
  });

  proc.on('close', (code) => {
    activeProcesses.delete(requestId);
    if (procInfo.stoppedByUser) return;
    broadcastStream({ type: 'process.done', exitCode: code });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); }
    });
  });
}

// --- HTTP + WebSocket Server ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true,
      mode: 'local-first-plugin-injection',
      localPluginsDir: LOCAL_PLUGINS_DIR,
      pluginCount: listLocalPlugins().length,
      connectedBrowsers: activeClients.size
    }));
  }

  // 1. CORS-Free External API Proxy Endpoint (`POST /proxy`)
  if (req.method === 'POST' && parsedUrl.pathname === '/proxy') {
    const body = await readBody(req);
    if (!body.url) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'url is required' }));
    }
    const result = await executeExternalProxy(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  // 2. Local Plugins CRUD API (used by local MCP server & browser sync)
  if (parsedUrl.pathname === '/local-plugins') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, localPluginsDir: LOCAL_PLUGINS_DIR, plugins: listLocalPlugins() }));
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const body = await readBody(req);
      // Bulk sync import support
      if (Array.isArray(body.plugins)) {
        for (const p of body.plugins) {
          if (p.slug) saveLocalPlugin(p.slug, p);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, plugins: listLocalPlugins() }));
      }
      const saved = saveLocalPlugin(body.slug || body.title, body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, plugin: saved, plugins: listLocalPlugins() }));
    }
  }

  const pluginMatch = parsedUrl.pathname.match(/^\/local-plugins\/([a-zA-Z0-9-_]+)(\/rollback)?$/);
  if (pluginMatch) {
    const slug = sanitizeSlug(pluginMatch[1]);
    const isRollback = Boolean(pluginMatch[2]);

    if (isRollback && req.method === 'POST') {
      const existing = readLocalPlugin(slug);
      if (!existing || !Array.isArray(existing.revisions) || existing.revisions.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '当前本地插件没有可回滚的历史快照' }));
      }
      const targetRev = existing.revisions[0];
      existing.revisions.shift();
      const restored = {
        ...existing,
        title: targetRev.title || existing.title,
        html: targetRev.html,
        css: targetRev.css,
        js: targetRev.js,
        updatedAt: new Date().toISOString()
      };
      const fp = path.join(LOCAL_PLUGINS_DIR, `${slug}.json`);
      fs.writeFileSync(fp, JSON.stringify(restored, null, 2));
      broadcastLocalPlugins(slug, true);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, plugin: restored, plugins: listLocalPlugins() }));
    }

    if (req.method === 'GET') {
      const plugin = readLocalPlugin(slug);
      res.writeHead(plugin ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(plugin ? { ok: true, plugin } : { ok: false, error: 'Local plugin not found' }));
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const saved = saveLocalPlugin(slug, body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, plugin: saved, plugins: listLocalPlugins() }));
    }
    if (req.method === 'DELETE') {
      const fp = path.join(LOCAL_PLUGINS_DIR, `${slug}.json`);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      broadcastLocalPlugins(slug, false);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, deleted: slug, plugins: listLocalPlugins() }));
    }
  }

  // 2b. Stop running headless Codex task (`POST /codex/stop`)
  if (req.method === 'POST' && parsedUrl.pathname === '/codex/stop') {
    const body = await readBody(req);
    const out = stopCodexHeadless(body.requestId || null);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(out));
  }

  // 2c. Chat History Sessions CRUD (`GET/PUT /chat-sessions`)
  if (parsedUrl.pathname === '/chat-sessions') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, sessions: readChatSessions() }));
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const saved = saveChatSessions(body.sessions || []);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, sessions: saved }));
    }
  }

  // 3. Live browser inspection / JS eval RPC
  if (req.method === 'POST' && parsedUrl.pathname === '/internal/browser-command') {
    const body = await readBody(req);
    const targetClient = [...activeClients][activeClients.size - 1];
    if (!targetClient) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, note: '当前没有打开的浏览器连接' }));
    }
    try {
      const id = 'b_' + crypto.randomUUID();
      const waitPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingBrowserCalls.delete(id);
          reject(new Error('浏览器响应超时'));
        }, 12000);
        pendingBrowserCalls.set(id, { resolve, reject, timer });
      });
      targetClient.send({ jsonrpc: '2.0', id, method: body.method, params: body.params });
      const result = await waitPromise;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    'Access-Control-Allow-Private-Network: true',
    '\r\n'
  ].join('\r\n'));

  const client = attachWebSocket(
    socket,
    async (cli, msg) => {
      if (msg.id && pendingBrowserCalls.has(msg.id)) {
        const { resolve, timer } = pendingBrowserCalls.get(msg.id);
        clearTimeout(timer);
        pendingBrowserCalls.delete(msg.id);
        return resolve(msg.result || msg.error);
      }
      if (msg.method === 'codex.run') {
        runCodexHeadless(cli, msg.id, msg.params);
      } else if (msg.method === 'codex.stop') {
        const res = stopCodexHeadless(msg.params?.requestId || null);
        if (msg.id) cli.send({ jsonrpc: '2.0', id: msg.id, result: res });
      } else if (msg.method === 'bridge.fetch_proxy') {
        const res = await executeExternalProxy(msg.params || {});
        cli.send({ jsonrpc: '2.0', id: msg.id, result: res });
      } else if (msg.method === 'local_plugins.pull') {
        cli.send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { plugins: listLocalPlugins() }
        });
      }
    },
    (cli) => {
      activeClients.delete(cli);
    }
  );

  activeClients.add(client);
  // Immediately push all local plugins to the newly connected browser for runtime injection!
  client.send({
    jsonrpc: '2.0',
    method: 'local_plugins.sync',
    params: {
      changedSlug: null,
      switchActive: false,
      plugins: listLocalPlugins()
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Local Codex Bridge Daemon (Local-First Injection + CORS Proxy) on ws://127.0.0.1:${PORT}`);
  console.log(`📁 Local Plugins Store: ${LOCAL_PLUGINS_DIR}`);
});
