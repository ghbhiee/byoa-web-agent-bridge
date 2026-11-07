#!/usr/bin/env node
/**
 * Codex Web Studio MCP Server — Local-First Plugin Injection Mode
 *
 * All Agent-created or modified pages/patches are saved locally in:
 *   ./local-plugins/*.json
 * and pushed to the browser via the Local Bridge Daemon (127.0.0.1:19820) for runtime injection!
 */

import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PLUGINS_DIR = path.join(__dirname, 'local-plugins');
const TOKEN_FILE = path.join(__dirname, '.bridge-token');
const LOCAL_BRIDGE_API = process.env.CODEX_STUDIO_LOCAL_BRIDGE || 'http://127.0.0.1:19820';
const REMOTE_API_BASE = process.env.CODEX_STUDIO_REMOTE_API || 'http://localhost:3045/api';
const PROTOCOL_VERSION = '2024-11-05';

function getLocalBridgeToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN.trim();
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch (_) {}
  return '';
}

async function httpJson(url, method = 'GET', body = undefined, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getLocalBridgeToken();
    if (token && url.startsWith(LOCAL_BRIDGE_API)) {
      headers['X-Bridge-Token'] = token;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message } };
  } finally {
    clearTimeout(timer);
  }
}

const TOOLS = [
  {
    name: 'list_remote_pages',
    description:
      '列出本地 local-plugins/ 目录中保存的所有用户自定义页面与页面补丁插件，以及宿主网站的基础页面。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_remote_page',
    description:
      '读取本地 local-plugins/ 中指定插件/页面 (slug) 的完整源码（html, css, js）。若本地尚不存在则读取宿主页面基础模板。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '插件或页面标识，如 "pomodoro-pro"、"snake"、"calculator"、"home"' }
      },
      required: ['slug']
    }
  },
  {
    name: 'create_remote_page',
    description:
      '在本地 local-plugins/ 目录中创建一个新的页面或页面补丁插件，并通过本地桥接服务 (127.0.0.1:19820) 实时注入到浏览器页面显示（不修改服务端公共文件，代码驻留本地）。若插件中需要访问外部接口，请在 js 中调用 `await bridge.fetchProxy(url, options)` 绕过跨域；若需读取宿主页面数据或调用后台接口，可调用 `bridge.getPageData()` 或 `await bridge.callBackendApi(path)`。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '插件/页面的英文标识，如 "snake"、"weather-patch"' },
        kind: {
          type: 'string',
          enum: ['custom-page', 'page-patch'],
          description: '"custom-page" 表示新增一个独立页面菜单；"page-patch" 表示作为挂件注入到现有宿主页面（如 home）的指定插槽中'
        },
        targetPage: {
          type: 'string',
          description: '当 kind="page-patch" 时，指定要注入的目标页面 slug，如 "home"'
        },
        targetSelector: {
          type: 'string',
          description: '当 kind="page-patch" 时，指定注入到目标页面的哪个 DOM 选择器，如 "[data-agent-slot=\'home-slot\']"'
        },
        title: { type: 'string', description: '插件或页面标题' },
        icon: { type: 'string', description: 'Emoji 图标' },
        description: { type: 'string', description: '功能简述' },
        html: { type: 'string', description: 'HTML 结构代码' },
        css: { type: 'string', description: 'CSS 样式代码' },
        js: {
          type: 'string',
          description: 'JavaScript 逻辑代码（上下文提供 root 和 bridge，含 bridge.fetchProxy、bridge.getPageData、bridge.callBackendApi）'
        },
        switchActive: { type: 'boolean', description: '是否在浏览器中立即切换到该页面，默认 true' }
      },
      required: ['slug', 'title', 'html']
    }
  },
  {
    name: 'update_remote_page',
    description:
      '修改保存在本地 local-plugins/ 目录中的插件或页面代码（支持全量更新或 patches 局部替换），并通过本地 Bridge 毫秒级热注入到浏览器页面。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '要修改的插件或页面标识' },
        kind: { type: 'string', enum: ['custom-page', 'page-patch'] },
        targetPage: { type: 'string' },
        targetSelector: { type: 'string' },
        title: { type: 'string' },
        icon: { type: 'string' },
        description: { type: 'string' },
        html: { type: 'string' },
        css: { type: 'string' },
        js: { type: 'string' },
        patches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              target: { type: 'string', enum: ['html', 'css', 'js'] },
              find: { type: 'string' },
              replace: { type: 'string' }
            },
            required: ['target', 'find', 'replace']
          }
        },
        switchActive: { type: 'boolean' }
      },
      required: ['slug']
    }
  },
  {
    name: 'delete_remote_page',
    description: '从本地 local-plugins/ 目录中删除指定的插件或自定义页面。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' }
      },
      required: ['slug']
    }
  },
  {
    name: 'inspect_live_browser',
    description: '通过本地 WebSocket 桥接服务，实时读取当前打开的浏览器标签页中的真实 DOM 结构与宿主页面数据。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' }
      }
    }
  },
  {
    name: 'eval_in_live_browser',
    description: '在当前打开的浏览器标签页中直接注入并执行一段实时 JS 脚本并返回结果。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' }
      },
      required: ['code']
    }
  }
];

async function handleToolCall(name, args = {}) {
  switch (name) {
    case 'list_remote_pages': {
      const localRes = await httpJson(`${LOCAL_BRIDGE_API}/local-plugins`, 'GET');
      return {
        mode: 'local-first-plugin-injection',
        localPluginsDir: LOCAL_PLUGINS_DIR,
        localPlugins: localRes.data?.plugins || []
      };
    }

    case 'get_remote_page': {
      const slug = encodeURIComponent(args.slug || 'home');
      const localRes = await httpJson(`${LOCAL_BRIDGE_API}/local-plugins/${slug}`, 'GET');
      if (localRes.ok && localRes.data?.plugin) {
        return { source: 'local-plugin', page: localRes.data.plugin };
      }
      const hostRes = await httpJson(`${REMOTE_API_BASE}/pages/${slug}`, 'GET');
      return { source: 'host-template', page: hostRes.data?.page || null };
    }

    case 'create_remote_page': {
      const res = await httpJson(`${LOCAL_BRIDGE_API}/local-plugins`, 'POST', {
        ...args,
        switchActive: args.switchActive !== false
      });
      return {
        ...res.data,
        savedLocation: path.join(LOCAL_PLUGINS_DIR, `${args.slug}.json`),
        injectionMode: 'injected-via-local-bridge-ws'
      };
    }

    case 'update_remote_page': {
      const slug = encodeURIComponent(args.slug || 'home');
      const res = await httpJson(`${LOCAL_BRIDGE_API}/local-plugins/${slug}`, 'PUT', args);
      return {
        ...res.data,
        savedLocation: path.join(LOCAL_PLUGINS_DIR, `${args.slug}.json`),
        injectionMode: 'injected-via-local-bridge-ws'
      };
    }

    case 'delete_remote_page': {
      const slug = encodeURIComponent(args.slug || '');
      const res = await httpJson(`${LOCAL_BRIDGE_API}/local-plugins/${slug}`, 'DELETE');
      return res.data;
    }

    case 'inspect_live_browser': {
      const res = await httpJson(`${LOCAL_BRIDGE_API}/internal/browser-command`, 'POST', {
        method: 'browser.inspect',
        params: { selector: args.selector || '' }
      });
      return res.data;
    }

    case 'eval_in_live_browser': {
      const res = await httpJson(`${LOCAL_BRIDGE_API}/internal/browser-command`, 'POST', {
        method: 'browser.eval',
        params: { code: args.code || '' }
      });
      return res.data;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function sendResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch (_) { return; }
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;

  try {
    if (method === 'initialize') {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'codex-page-studio-local', version: '2.0.0' }
        }
      });
    } else if (method === 'ping') {
      sendResponse({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      sendResponse({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const output = await handleToolCall(params?.name, params?.arguments || {});
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          isError: Boolean(output?.error && !output?.ok)
        }
      });
    } else {
      sendResponse({ jsonrpc: '2.0', id, result: {} });
    }
  } catch (err) {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        isError: true
      }
    });
  }
});
