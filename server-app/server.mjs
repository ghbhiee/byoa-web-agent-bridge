import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3045);
const DATA_DIR = process.env.DATA_DIR || '/var/lib/codex-studio/pages';
const USERS_DIR = process.env.USERS_DIR || '/var/lib/codex-studio/users';
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USERS_DIR, { recursive: true });

// Connected SSE clients for instant hot-reload on the web page
const sseClients = new Set();
let currentActiveSlug = 'home';

function broadcastSSE(eventType, payload) {
  const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

function sanitizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled-page';
}

function pageFilePath(slug) {
  return path.join(DATA_DIR, `${sanitizeSlug(slug)}.json`);
}

function seedDefaultPagesIfEmpty() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (files.length > 0) return;

  const now = new Date().toISOString();
  const homePage = {
    slug: 'home',
    title: 'AI 动态控制台主页',
    icon: '🏠',
    description: '支持通过本地 Codex 终端或右侧在线对话实时修改页面结构、样式与交互逻辑，所有更改自动持久化在 15 服务器。',
    updatedAt: now,
    updatedBy: 'system-seed',
    revisions: [],
    html: `
<div class="hero-card">
  <div class="hero-badge">⚡ Codex Web Studio · Live Canvas</div>
  <h1 class="hero-title">欢迎来到本地 Codex 驱动的动态演进工作台</h1>
  <p class="hero-desc">
    当前页面托管在 <strong>your-web-app.example.com</strong> 服务器上，并与你本机的 <code>Codex Headless Harness</code> 建立了双向桥接。
    你可以在<strong>右侧对话栏</strong>直接下达修改/新建页面的指令，也可以在本地终端进入 <code>~/.byoa-web-bridge</code> 目录运行 <code>codex</code> 直接操控本页面！
  </p>
  <div class="stat-grid" id="home-stats">
    <div class="stat-box">
      <span class="stat-label">双向通信引擎</span>
      <span class="stat-value">Codex CLI + MCP</span>
      <span class="stat-sub">支持无头 JSONL 流式输出与多轮会话</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">页面持久化位置</span>
      <span class="stat-value">your-web-app.example.com</span>
      <span class="stat-sub">/var/lib/codex-studio/pages/*.json</span>
    </div>
    <div class="stat-box">
      <span class="stat-label">当前服务器时间</span>
      <span class="stat-value" id="live-clock">--:--:--</span>
      <span class="stat-sub">由页面内置 JS 实时驱动</span>
    </div>
  </div>

  <div class="action-bar">
    <button class="btn-primary" id="btn-ask-joke">🤖 让本地 Codex 在此卡片下生成一段实时系统简报</button>
    <button class="btn-secondary" id="btn-new-page-demo">➕ 让本地 Codex 自动创建一个「番茄钟专注工作台」新页面</button>
  </div>

  <div id="dynamic-agent-output" data-agent-slot="home-slot" class="slot-box">
    <div class="slot-placeholder">✨ 动态插槽区 <code>[data-agent-slot="home-slot"]</code> —— 本地 Codex 可以随时向此处注入新组件或直接改写整页源码</div>
  </div>
</div>
`.trim(),
    css: `
.hero-card {
  background: linear-gradient(145deg, #111827 0%, #0f172a 100%);
  border: 1px solid #1e293b;
  border-radius: 16px;
  padding: 32px;
  color: #f8fafc;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
}
.hero-badge {
  display: inline-block;
  padding: 5px 14px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.3);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 16px;
}
.hero-title {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 12px;
  background: linear-gradient(135deg, #ffffff 30%, #94a3b8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero-desc {
  color: #94a3b8;
  line-height: 1.7;
  font-size: 15px;
  margin-bottom: 26px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.stat-box {
  background: rgba(30, 41, 59, 0.65);
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.stat-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
.stat-value { font-size: 20px; font-weight: 800; color: #38bdf8; font-family: monospace; }
.stat-sub { font-size: 12px; color: #64748b; }
.action-bar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.btn-primary {
  background: #0284c7;
  color: #fff;
  border: none;
  padding: 11px 18px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-primary:hover { background: #0369a1; transform: translateY(-1px); }
.btn-secondary {
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid #334155;
  padding: 11px 18px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-secondary:hover { border-color: #38bdf8; color: #38bdf8; }
.slot-box {
  background: rgba(15, 23, 42, 0.8);
  border: 1px dashed #334155;
  border-radius: 12px;
  padding: 20px;
}
.slot-placeholder {
  color: #64748b;
  font-size: 13px;
  text-align: center;
}
`.trim(),
    js: `
const clockEl = root.querySelector('#live-clock');
const updateClock = () => {
  if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
};
updateClock();
const timer = setInterval(updateClock, 1000);

const btnJoke = root.querySelector('#btn-ask-joke');
if (btnJoke) {
  btnJoke.onclick = () => {
    bridge.sendChatPrompt('请读取我本机当前工作目录的信息与系统状态，然后调用 update_remote_page 把结果渲染到 home 页面的 #dynamic-agent-output 区域中。');
  };
}

const btnNew = root.querySelector('#btn-new-page-demo');
if (btnNew) {
  btnNew.onclick = () => {
    bridge.sendChatPrompt('请使用 create_remote_page 工具新建一个 slug 为 pomodoro、标题为「番茄钟专注工作台」的页面，包含倒计时器、任务列表和统计卡片，样式现代美观，并自动切换到该页面。');
  };
}

return () => clearInterval(timer);
`.trim()
  };

  const metricsPage = {
    slug: 'playground',
    title: '实时交互沙盒页',
    icon: '🧪',
    description: '用于测试本地 Codex 动态注入组件、修改样式和挂载交互逻辑的实验画布。',
    updatedAt: now,
    updatedBy: 'system-seed',
    revisions: [],
    html: `
<div class="lab-wrap">
  <h2>🧪 实时交互组件实验画布</h2>
  <p class="lab-tip">试着在右侧聊天框或本地 Codex 终端里说：<em>“把 playground 页面改成一个带实时汇率换算和折线图的金融计算器”</em></p>
  <div class="counter-card">
    <div>当前交互计数：<strong id="cnt-val">0</strong></div>
    <button id="cnt-btn">+1 点击增加</button>
  </div>
  <div data-agent-slot="playground-slot" class="lab-slot">
    等待本地 Codex Agent 注入新内容...
  </div>
</div>
`.trim(),
    css: `
.lab-wrap {
  background: #111827;
  border: 1px solid #1e293b;
  border-radius: 14px;
  padding: 28px;
  color: #f8fafc;
}
.lab-tip { color: #94a3b8; margin: 10px 0 22px; }
.counter-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #1e293b;
  padding: 16px 20px;
  border-radius: 10px;
  margin-bottom: 20px;
}
#cnt-val { font-size: 22px; color: #34d399; margin-left: 6px; }
#cnt-btn {
  background: #10b981;
  color: #06281e;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}
.lab-slot {
  padding: 24px;
  border: 1px dashed #475569;
  border-radius: 10px;
  color: #94a3b8;
  text-align: center;
}
`.trim(),
    js: `
let count = 0;
const valEl = root.querySelector('#cnt-val');
const btnEl = root.querySelector('#cnt-btn');
if (btnEl && valEl) {
  btnEl.onclick = () => {
    count++;
    valEl.textContent = String(count);
  };
}
`.trim()
  };

  fs.writeFileSync(pageFilePath('home'), JSON.stringify(homePage, null, 2));
  fs.writeFileSync(pageFilePath('playground'), JSON.stringify(metricsPage, null, 2));
}

seedDefaultPagesIfEmpty();

function listPagesSummary() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const list = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      list.push({
        slug: raw.slug,
        title: raw.title || raw.slug,
        icon: raw.icon || '📄',
        description: raw.description || '',
        updatedAt: raw.updatedAt,
        updatedBy: raw.updatedBy || 'unknown',
        revisionCount: Array.isArray(raw.revisions) ? raw.revisions.length : 0
      });
    } catch (_) {}
  }
  list.sort((a, b) => (a.slug === 'home' ? -1 : b.slug === 'home' ? 1 : (b.updatedAt || '').localeCompare(a.updatedAt || '')));
  return list;
}

function readPage(slug) {
  const fp = pageFilePath(slug);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) {
    return null;
  }
}

function savePage(slug, input, isNew = false) {
  const cleanSlug = sanitizeSlug(slug);
  const existing = readPage(cleanSlug);
  const now = new Date().toISOString();

  let html = input.html !== undefined ? String(input.html) : (existing?.html || '');
  let css = input.css !== undefined ? String(input.css) : (existing?.css || '');
  let js = input.js !== undefined ? String(input.js) : (existing?.js || '');

  // Support surgical patches if provided by Agent
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
  if (existing) {
    revisions.unshift({
      versionId: 'v_' + Date.now(),
      timestamp: existing.updatedAt || now,
      updatedBy: existing.updatedBy || 'unknown',
      title: existing.title,
      html: existing.html,
      css: existing.css,
      js: existing.js
    });
    if (revisions.length > 15) revisions.length = 15;
  }

  const record = {
    slug: cleanSlug,
    title: input.title !== undefined ? String(input.title) : (existing?.title || cleanSlug),
    icon: input.icon !== undefined ? String(input.icon) : (existing?.icon || '📄'),
    description: input.description !== undefined ? String(input.description) : (existing?.description || ''),
    html,
    css,
    js,
    updatedAt: now,
    updatedBy: input.updatedBy || 'agent',
    revisions
  };

  fs.writeFileSync(pageFilePath(cleanSlug), JSON.stringify(record, null, 2));
  return { record, wasCreated: !existing || isNew };
}

function renderStandalonePageHTML(slug, fallbackPage = null) {
  const initialPageJson = JSON.stringify(fallbackPage || null);
  const slugJson = JSON.stringify(slug);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fallbackPage?.title || slug} · Codex Web Studio 独立视图</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0b0f19;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      padding: 24px;
    }
    .standalone-bar {
      max-width: 1180px;
      margin: 0 auto 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding: 10px 18px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid #1e293b;
      border-radius: 12px;
      font-size: 13px;
      color: #94a3b8;
      backdrop-filter: blur(12px);
    }
    .standalone-bar-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .source-pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(52, 211, 153, 0.14);
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.35);
      font-weight: 600;
    }
    .standalone-bar a {
      color: #38bdf8;
      text-decoration: none;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 7px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .standalone-bar a:hover {
      background: rgba(56, 189, 248, 0.2);
    }
    #page-root {
      max-width: 1180px;
      margin: 0 auto;
    }
  </style>
  <style id="dynamic-page-style"></style>
</head>
<body>
  <div class="standalone-bar">
    <div class="standalone-bar-left">
      <span id="st-icon" style="font-size:18px;">🔌</span>
      <strong id="st-title" style="color:#fff;">正在加载 ${slug}...</strong>
      <code style="color:#64748b">/${slug}</code>
      <span class="source-pill" id="st-source">正在检测本地 Bridge...</span>
    </div>
    <a href="/codex-studio/#${slug}">🛠️ 返回 Codex Studio 工作台编辑 →</a>
  </div>
  <div id="page-root"></div>
  <script>
    (function() {
      const targetSlug = ${slugJson};
      const fallbackServerPage = ${initialPageJson};
      const API_BASE = location.pathname.startsWith('/codex-studio') ? '/codex-studio/api' : '/api';
      const LOCAL_BRIDGE_HTTP = 'http://127.0.0.1:19820';
      const LOCAL_BRIDGE_WS = 'ws://127.0.0.1:19820';
      const currentUserId = localStorage.getItem('codex_studio_user_id') || 'default';
      let currentCleanup = null;
      let activePageObj = null;

      // Extract #bridge_token=<TOKEN> from URL Fragment (#) if present and scrub address bar
      (function extractHashToken() {
        const rawHash = location.hash.replace(/^#/, '');
        if (!rawHash) return;
        for (const part of rawHash.split('&')) {
          if (part.startsWith('bridge_token=')) {
            const tk = decodeURIComponent(part.slice('bridge_token='.length).trim());
            if (tk) localStorage.setItem('codex_bridge_token', tk);
            history.replaceState(null, '', location.pathname + location.search);
          }
        }
      })();

      function getBridgeToken() {
        return (localStorage.getItem('codex_bridge_token') || '').trim();
      }
      function bridgeHeaders(extra = {}) {
        const tk = getBridgeToken();
        return tk ? { ...extra, 'X-Bridge-Token': tk } : { ...extra };
      }

      window.agentBridge = {
        sendChatPrompt: (prompt) => {
          window.location.href = '/codex-studio/#' + encodeURIComponent(targetSlug) + '?ask=' + encodeURIComponent(prompt);
        },
        selectPage: (s) => {
          window.location.href = '/codex-studio/p/' + encodeURIComponent(s);
        },
        getActivePage: () => activePageObj,
        getPageData: () => ({
          userId: currentUserId,
          activeSlug: targetSlug,
          pageTitle: activePageObj?.title || targetSlug,
          standalone: true
        }),
        callBackendApi: async (apiPath = '/host/data', options = {}) => {
          const cleanPath = apiPath.startsWith('/api') ? apiPath.slice(4) : apiPath;
          const res = await window.fetch(API_BASE + cleanPath, {
            ...options,
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': currentUserId,
              ...(options.headers || {})
            }
          });
          return res.json();
        },
        fetchProxy: async (url, options = {}) => {
          const res = await window.fetch(LOCAL_BRIDGE_HTTP + '/proxy', {
            method: 'POST',
            headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              url,
              method: options.method || 'GET',
              headers: options.headers || {},
              body: options.body,
              charset: options.charset || 'utf-8'
            })
          });
          return res.json();
        },
        scopedFetch: async (input, init = {}) => {
          const targetUrl = typeof input === 'string' ? input : (input?.url || String(input));
          try {
            const parsed = new URL(targetUrl, location.origin);
            if (parsed.origin !== location.origin && parsed.origin !== LOCAL_BRIDGE_HTTP) {
              const proxyRes = await window.agentBridge.fetchProxy(parsed.toString(), {
                method: init.method || 'GET',
                headers: init.headers || {},
                body: init.body,
                charset: init.charset || 'utf-8'
              });
              const bodyStr = typeof proxyRes.data === 'string' ? proxyRes.data : JSON.stringify(proxyRes.data ?? {});
              return new Response(bodyStr, {
                status: proxyRes.status || (proxyRes.ok ? 200 : 502),
                headers: { 'Content-Type': proxyRes.contentType || 'application/json' }
              });
            }
          } catch (_) {}
          return window.fetch(input, init);
        }
      };

      function mountStandalone(page, sourceLabel, allPlugins = []) {
        if (!page) {
          document.getElementById('page-root').innerHTML = '<div style="padding:36px;background:#111827;border:1px solid #334155;border-radius:14px;text-align:center;"><h2 style="margin-bottom:10px;">⚠️ 未找到插件或页面: /' + targetSlug + '</h2><p style="color:#94a3b8;">请确认本机 Bridge (127.0.0.1:19820) 正在运行，或先在工作台中同步该插件。</p></div>';
          return;
        }
        activePageObj = page;
        if (typeof currentCleanup === 'function') {
          try { currentCleanup(); } catch (_) {}
          currentCleanup = null;
        }
        document.title = (page.title || targetSlug) + ' · Codex Web Studio';
        document.getElementById('st-icon').textContent = page.icon || '🔌';
        document.getElementById('st-title').textContent = page.title || targetSlug;
        document.getElementById('st-source').textContent = sourceLabel;
        document.getElementById('dynamic-page-style').textContent = page.css || '';

        const root = document.getElementById('page-root');
        root.innerHTML = page.html || '';

        if (page.js) {
          try {
            const fn = new Function('root', 'bridge', 'fetch', page.js);
            currentCleanup = fn(root, window.agentBridge, window.agentBridge.scopedFetch);
          } catch (e) {
            console.error('Standalone script error:', e);
          }
        }

        // Also inject any page-patch plugins targeting this page
        for (const p of allPlugins) {
          if (p.kind === 'page-patch' && (p.targetPage === targetSlug || p.targetPage === '*')) {
            const slot = root.querySelector(p.targetSelector || '[data-agent-slot]') || root;
            const patchBox = document.createElement('div');
            patchBox.innerHTML = '<style>' + (p.css || '') + '</style>' + (p.html || '');
            slot.appendChild(patchBox);
            if (p.js) {
              try {
                const pFn = new Function('root', 'bridge', 'fetch', p.js);
                pFn(patchBox, window.agentBridge, window.agentBridge.scopedFetch);
              } catch (e) {}
            }
          }
        }
      }

      async function resolveAndMount() {
        // 1. Try Local Bridge (http://127.0.0.1:19820/local-plugins) first!
        try {
          const r = await window.fetch(LOCAL_BRIDGE_HTTP + '/local-plugins', { headers: bridgeHeaders() });
          if (r.ok) {
            const d = await r.json();
            const list = d.plugins || [];
            const found = list.find(p => p.slug === targetSlug);
            if (found) {
              mountStandalone(found, '🟢 本地 Bridge 实时注入 (127.0.0.1:19820)', list);
              return;
            }
            if (fallbackServerPage) {
              mountStandalone(fallbackServerPage, '🌐 宿主页面 + 本地补丁', list);
              return;
            }
          }
        } catch (_) {}

        // 2. Try Browser LocalStorage Cache for current user
        try {
          const cached = JSON.parse(localStorage.getItem('codex_user_plugins_' + currentUserId) || '[]');
          const foundCached = cached.find(p => p.slug === targetSlug);
          if (foundCached) {
            mountStandalone(foundCached, '💾 浏览器本地插件缓存 (' + currentUserId + ')', cached);
            return;
          }
        } catch (_) {}

        // 3. Try User's Cloud Synced Plugin Store (/api/user/plugins)
        try {
          const r = await window.fetch(API_BASE + '/user/plugins?userId=' + encodeURIComponent(currentUserId));
          if (r.ok) {
            const d = await r.json();
            const cloudList = d.plugins || [];
            const foundCloud = cloudList.find(p => p.slug === targetSlug);
            if (foundCloud) {
              mountStandalone(foundCloud, '☁️ 云端用户插件同步副本 (' + currentUserId + ')', cloudList);
              return;
            }
          }
        } catch (_) {}

        // 4. Fallback to server public seed page
        mountStandalone(fallbackServerPage, '🌐 公共宿主页面', []);
      }

      resolveAndMount();

      // Connect to Local Bridge WebSocket so standalone page also hot-reloads in real time!
      try {
        const tk = getBridgeToken();
        const wsUrl = tk ? LOCAL_BRIDGE_WS + '?token=' + encodeURIComponent(tk) : LOCAL_BRIDGE_WS;
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.method === 'local_plugins.sync') {
              const list = msg.params?.plugins || [];
              const found = list.find(p => p.slug === targetSlug);
              if (found) {
                mountStandalone(found, '🟢 本地 Bridge 实时热更新', list);
              }
            }
          } catch (_) {}
        };
      } catch (_) {}
    })();
  </script>
</body>
</html>`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // Normalize optional /codex-studio prefix
  let pathname = parsedUrl.pathname;
  if (pathname.startsWith('/codex-studio')) {
    pathname = pathname.slice('/codex-studio'.length) || '/';
  }

  try {
    // 1. Health check
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'codex-studio-server',
        mode: 'local-first-multiuser-plugin-sync',
        activeSlug: currentActiveSlug,
        pages: listPagesSummary()
      });
    }

    // 1b. Whitelisted Backend Business Data API (callable via bridge.callBackendApi('/api/host/data'))
    if (req.method === 'GET' && pathname === '/api/host/data') {
      const userId = sanitizeSlug(parsedUrl.searchParams.get('userId') || req.headers['x-user-id'] || 'default');
      return sendJson(res, 200, {
        ok: true,
        userId,
        serverTime: new Date().toISOString(),
        hostMetrics: {
          serverHost: req.headers.host || 'localhost',
          cpuLoad: '12.4%',
          memoryUsed: '3.2 GB / 16 GB',
          activePort: PORT
        },
        watchlist: [
          { symbol: 'NVDA', price: 142.85, change: '+2.4%' },
          { symbol: 'AAPL', price: 228.10, change: '+0.8%' },
          { symbol: 'TSLA', price: 254.60, change: '-1.1%' },
          { symbol: 'BTC-USD', price: 91450.0, change: '+3.7%' }
        ]
      });
    }

    // 1d. Dynamic Agent Onboarding Guide (/agent-setup-guide.md) & One-Line Installer (/install.sh)
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const hasPrefix = parsedUrl.pathname.startsWith('/codex-studio') || (req.headers.referer && req.headers.referer.includes('/codex-studio'));
    const publicBaseUrl = `${proto}://${hostHeader}${hasPrefix ? '/codex-studio' : ''}`;

    if (req.method === 'GET' && pathname === '/install.sh') {
      const script = `#!/usr/bin/env bash
set -e
INSTALL_DIR="\${BYOA_BRIDGE_DIR:-\$HOME/.byoa-web-bridge}"
SITE_URL="\${BYOA_SITE_URL:-${publicBaseUrl}}"

echo "🚀 Installing BYOA Local Agent Bridge & MCP Server into: \$INSTALL_DIR"
mkdir -p "\$INSTALL_DIR"

echo "📦 Downloading bridge-bundle.tar.gz from \$SITE_URL/bridge-bundle.tar.gz ..."
curl -fsSL "\$SITE_URL/bridge-bundle.tar.gz" | tar -xz -C "\$INSTALL_DIR"

mkdir -p "\$INSTALL_DIR/.codex"
cat > "\$INSTALL_DIR/.codex/config.toml" <<EOF
[mcp_servers.page_studio]
command = "node"
args = ["\$INSTALL_DIR/mcp-server.mjs"]
env = { CODEX_STUDIO_LOCAL_BRIDGE = "http://127.0.0.1:19820", CODEX_STUDIO_REMOTE_API = "\$SITE_URL/api" }
EOF

chmod +x "\$INSTALL_DIR/bridge-daemon.mjs" "\$INSTALL_DIR/mcp-server.mjs" "\$INSTALL_DIR/codex-studio" 2>/dev/null || true

# Check if port 19820 is already active
if curl -fsS http://127.0.0.1:19820/health >/dev/null 2>&1; then
  echo "✅ Local Bridge Daemon is already running on http://127.0.0.1:19820"
else
  echo "⚡ Starting Local Bridge Daemon on ws://127.0.0.1:19820 ..."
  nohup node "\$INSTALL_DIR/bridge-daemon.mjs" > "\$INSTALL_DIR/bridge.log" 2>&1 &
  sleep 1
fi

echo "🎉 Installation complete!"
BRIDGE_TOKEN=\$(cat "\$INSTALL_DIR/.bridge-token" 2>/dev/null | tr -d '\\n' || true)
echo "📁 Workspace Directory : \$INSTALL_DIR"
echo "🔑 Bridge Auth Token   : \$BRIDGE_TOKEN"
echo "🔗 One-Click Pairing   : \$SITE_URL/#home&bridge_token=\$BRIDGE_TOKEN"
echo "💡 Open the One-Click Pairing URL above in your browser to pair via URL Fragment (#bridge_token)!"
`;
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(script);
    }

    if (req.method === 'GET' && pathname === '/agent-setup-guide.md') {
      const guide = `# 🤖 BYOA (Bring Your Own Agent) — 本地 Agent 桥接与 MCP 自动安装指南

> **给本地 AI Agent（Codex / Claude Code / Cursor / OpenClaw / Antigravity）的执行指令**：
> 当用户要求你将当前网站（\`${publicBaseUrl}\`）的本地 Bridge 与 MCP 工具安装到本机时，请直接按以下步骤自动执行，无需反复询问用户。

---

## 第一步：下载并解压网站提供的本地 Bridge & MCP 安装包

请在用户本机创建独立目录 \`~/.byoa-web-bridge\`（或用户指定的目录），下载并解压当前网站托管的零依赖安装包：

\`\`\`bash
mkdir -p ~/.byoa-web-bridge
curl -fsSL ${publicBaseUrl}/bridge-bundle.tar.gz | tar -xz -C ~/.byoa-web-bridge
\`\`\`

或者直接执行一键安装脚本：

\`\`\`bash
curl -fsSL ${publicBaseUrl}/install.sh | bash
\`\`\`

---

## 第二步：安装包内含的核心组件与 Token 安全机制说明

解压后的 \`~/.byoa-web-bridge\` 目录包含以下零外部依赖（基于 Node.js >= 18 原生模块）组件：

1. **\`bridge-daemon.mjs\`（本地桥接守护进程，监听 \`127.0.0.1:19820\`，强制 256-bit Token 鉴权）**：
   - 启动时自动生成 256-bit 随机密钥并保存在 \`~/.byoa-web-bridge/.bridge-token\`（权限 \`0600\`，仅当前系统用户可读）。
   - 所有 WebSocket 连接（\`ws://127.0.0.1:19820?token=<TOKEN>\`）与 HTTP 接口（\`X-Bridge-Token: <TOKEN>\`）均通过 \`crypto.timingSafeEqual\` 校验 Token，防止本机其他未授权进程或恶意网页跨站调用。
   - **URL Fragment (\`#bridge_token=<TOKEN>\`) 零泄露配对**：用户点击 \`${publicBaseUrl}/#home&bridge_token=<TOKEN>\` 打开网页时，浏览器前端从 \`location.hash\` 提取 Token 存入 \`localStorage\`，并立即通过 \`history.replaceState\` 从地址栏擦除。由于 \`#\` 片段绝不随 HTTP 请求发送到服务器，服务端永远无法获知用户的本地 Bridge Token。
2. **\`mcp-server.mjs\`（标准 stdio MCP Server，服务名 \`page_studio\`）**：
   - 自动读取同目录下的 \`.bridge-token\` 并随请求附带 \`X-Bridge-Token\` 头，向本地 Agent 暴露 7 个核心工具（\`list_remote_pages\`、\`get_remote_page\`、\`create_remote_page\`、\`update_remote_page\`、\`delete_remote_page\`、\`inspect_live_browser\`、\`eval_in_live_browser\`）。
3. **\`AGENTS.md\`（Agent 注入规范与跨域调用手册）**：
   - 详细定义了插件 \`js\` 中如何使用 \`bridge.fetchProxy(url, options)\`、\`bridge.getPageData()\`、\`bridge.callBackendApi(path)\`。

---

## 第三步：将 \`mcp-server.mjs\` 注册到你的 Agent MCP 配置中

### 若你使用的是 OpenAI Codex CLI：
在 \`~/.byoa-web-bridge/.codex/config.toml\`（或全局 \`~/.codex/config.toml\`）中添加：
\`\`\`toml
[mcp_servers.page_studio]
command = "node"
args = ["/ABSOLUTE/PATH/TO/.byoa-web-bridge/mcp-server.mjs"]
env = { CODEX_STUDIO_LOCAL_BRIDGE = "http://127.0.0.1:19820", CODEX_STUDIO_REMOTE_API = "${publicBaseUrl}/api" }
\`\`\`

### 若你使用的是 Claude Code：
\`\`\`bash
claude mcp add page_studio -- node ~/.byoa-web-bridge/mcp-server.mjs
\`\`\`

---

## 第四步：启动本地 Bridge 守护进程并向用户输出 \`#bridge_token\` 配对链接

在后台启动 \`bridge-daemon.mjs\` 并读取生成的 Token：
\`\`\`bash
nohup node ~/.byoa-web-bridge/bridge-daemon.mjs > ~/.byoa-web-bridge/bridge.log 2>&1 &
sleep 1
TOKEN=\$(cat ~/.byoa-web-bridge/.bridge-token | tr -d '\\n')
echo "Pairing URL: ${publicBaseUrl}/#home&bridge_token=\$TOKEN"
\`\`\`
请务必将上述生成的 **\`${publicBaseUrl}/#home&bridge_token=<TOKEN>\` 配对链接** 展示给用户，用户点击该链接即可自动完成浏览器与本地 Bridge 的安全鉴权配对！
`;
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(guide);
    }

    // 1c. Multi-User Isolated Plugin Sync Store (Zero Server-Side Code Execution!)
    if (pathname === '/api/user/plugins') {
      const userId = sanitizeSlug(parsedUrl.searchParams.get('userId') || req.headers['x-user-id'] || 'default');
      const userDir = path.join(USERS_DIR, userId);
      fs.mkdirSync(userDir, { recursive: true });
      const userPluginFile = path.join(userDir, 'plugins.json');

      if (req.method === 'GET') {
        let plugins = [];
        if (fs.existsSync(userPluginFile)) {
          try {
            plugins = JSON.parse(fs.readFileSync(userPluginFile, 'utf8')).plugins || [];
          } catch (_) {}
        }
        return sendJson(res, 200, { ok: true, userId, plugins });
      }

      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readJsonBody(req);
        const targetUser = sanitizeSlug(body.userId || userId);
        const targetDir = path.join(USERS_DIR, targetUser);
        fs.mkdirSync(targetDir, { recursive: true });
        const targetFile = path.join(targetDir, 'plugins.json');
        const plugins = Array.isArray(body.plugins) ? body.plugins : [];
        const record = {
          userId: targetUser,
          syncedAt: new Date().toISOString(),
          pluginCount: plugins.length,
          plugins
        };
        fs.writeFileSync(targetFile, JSON.stringify(record, null, 2));
        return sendJson(res, 200, { ok: true, userId: targetUser, syncedAt: record.syncedAt, pluginCount: plugins.length });
      }
    }

    // 2. SSE Live Events Stream
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no'
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ activeSlug: currentActiveSlug, pages: listPagesSummary() })}\n\n`);
      sseClients.add(res);
      const keepAlive = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (_) { clearInterval(keepAlive); sseClients.delete(res); }
      }, 20000);
      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return;
    }

    // 3. List all remote pages
    if (req.method === 'GET' && pathname === '/api/pages') {
      return sendJson(res, 200, {
        activeSlug: currentActiveSlug,
        pages: listPagesSummary()
      });
    }

    // 4. Create a new page
    if (req.method === 'POST' && pathname === '/api/pages') {
      const body = await readJsonBody(req);
      if (!body.slug && !body.title) {
        return sendJson(res, 400, { error: 'slug or title is required' });
      }
      const targetSlug = sanitizeSlug(body.slug || body.title);
      const { record } = savePage(targetSlug, body, true);
      if (body.switchActive !== false) {
        currentActiveSlug = record.slug;
      }
      broadcastSSE('page_created', {
        slug: record.slug,
        page: record,
        switchActive: body.switchActive !== false,
        pages: listPagesSummary()
      });
      return sendJson(res, 201, { ok: true, page: record, pages: listPagesSummary() });
    }

    // 5. Switch active page notification
    if (req.method === 'POST' && pathname === '/api/active-page') {
      const body = await readJsonBody(req);
      if (body.slug && readPage(body.slug)) {
        currentActiveSlug = sanitizeSlug(body.slug);
        broadcastSSE('switch_page', { slug: currentActiveSlug });
        return sendJson(res, 200, { ok: true, activeSlug: currentActiveSlug });
      }
      return sendJson(res, 404, { error: 'Page not found' });
    }

    // 6. Single page operations: GET / PUT / DELETE / ROLLBACK
    const pageMatch = pathname.match(/^\/api\/pages\/([a-zA-Z0-9-_]+)(\/rollback)?$/);
    if (pageMatch) {
      const slug = sanitizeSlug(pageMatch[1]);
      const isRollback = Boolean(pageMatch[2]);

      if (isRollback && req.method === 'POST') {
        const existing = readPage(slug);
        if (!existing || !Array.isArray(existing.revisions) || existing.revisions.length === 0) {
          return sendJson(res, 400, { error: '没有可回滚的历史版本' });
        }
        const body = await readJsonBody(req);
        const targetRev = body.versionId
          ? existing.revisions.find(r => r.versionId === body.versionId)
          : existing.revisions[0];
        if (!targetRev) {
          return sendJson(res, 404, { error: '未找到指定的历史版本' });
        }
        const { record } = savePage(slug, {
          title: targetRev.title || existing.title,
          html: targetRev.html,
          css: targetRev.css,
          js: targetRev.js,
          updatedBy: 'rollback'
        });
        broadcastSSE('page_updated', { slug: record.slug, page: record, pages: listPagesSummary() });
        return sendJson(res, 200, { ok: true, page: record });
      }

      if (req.method === 'GET') {
        const page = readPage(slug);
        if (!page) return sendJson(res, 404, { error: `Page '${slug}' not found` });
        return sendJson(res, 200, { page });
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const { record } = savePage(slug, body, false);
        if (body.switchActive) {
          currentActiveSlug = record.slug;
        }
        broadcastSSE('page_updated', {
          slug: record.slug,
          page: record,
          switchActive: Boolean(body.switchActive),
          pages: listPagesSummary()
        });
        return sendJson(res, 200, { ok: true, page: record, pages: listPagesSummary() });
      }

      if (req.method === 'DELETE') {
        if (slug === 'home') {
          return sendJson(res, 400, { error: '默认主页 (home) 不能删除，但可以随时修改其内容' });
        }
        const fp = pageFilePath(slug);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        if (currentActiveSlug === slug) currentActiveSlug = 'home';
        broadcastSSE('page_deleted', { slug, activeSlug: currentActiveSlug, pages: listPagesSummary() });
        return sendJson(res, 200, { ok: true, deleted: slug, pages: listPagesSummary() });
      }
    }

    // 7. Standalone full-screen page view: /p/:slug (supports both Local Plugins & Server Pages!)
    const standaloneMatch = pathname.match(/^\/p\/([a-zA-Z0-9-_]+)\/?$/);
    if (req.method === 'GET' && standaloneMatch) {
      const slug = sanitizeSlug(standaloneMatch[1]);
      const page = readPage(slug);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderStandalonePageHTML(slug, page));
    }

    // 8. Static Studio Frontend files
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.gz': 'application/gzip',
      '.sh': 'text/x-shellscript; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8'
    };
    const headers = {
      'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    };
    if (ext === '.gz') {
      headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Codex Web Studio Server listening on http://127.0.0.1:${PORT} (Data: ${DATA_DIR})`);
});
