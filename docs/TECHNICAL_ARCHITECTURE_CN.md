# Web 与本地 Agent 双向桥接：本地插件注入、多租户云同步、本地跨域代理与纵深安全架构方案

> **核心架构定位**：
> 将 **“公共宿主网站（服务端只读底座）”** 与 **“用户个性化扩展代码（本地客户端插件）”** 彻底解耦。
> 无论是通过本地 Agent 终端修改现有网页、新增独立功能页，还是在网页对话框中唤醒本机无头终端（如 `codex exec` / `claude -p`）生成新组件，**所有生成的代码均保存在用户本机磁盘（`~/.web-agent-bridge/local-plugins/*.json`），并通过本地桥接服务（`127.0.0.1:19820`）动态注入浏览器运行**。
> 当插件代码需要访问第三方外部服务（如查询实时股票行情、天气、外部大模型 API）时，通过**本地桥接服务进行反向代理中转（Local Bridge Proxy）**，彻底解决浏览器 CORS 跨域限制与受保护请求头（`Referer` / `User-Agent`）限制；服务端仅提供受控业务 API 及按用户隔离的静态插件包（JSON Manifest）同步存储，**绝不在服务端执行任何用户代码**。

---

## 一、 全景架构定调：为什么摒弃直接改服务端，转向“本地注入 + 云端静态同步”？

### 1. 两种架构路线的本质对比

| 维度 | 传统直接修改服务端公共页面（已摒弃） | 本地优先插件驻留 + 客户端注入 + 云端静态同步（本方案） |
| :--- | :--- | :--- |
| **多租户隔离性** | ❌ 用户 A 修改页面会覆盖服务端公共文件，污染用户 B 的视图 | ✅ 宿主网站对所有用户只读一致；个性化代码仅注入当前用户的浏览器 |
| **服务端安全性** | ❌ 用户代码若在服务端运行或编译，存在致命的远程代码执行（RCE）风险 | ✅ **服务端零代码执行（Zero Server Execution）**，服务端仅把插件当作纯静态 JSON 文本存储 |
| **跨域访问外部 API** | ❌ 若由中心服务器代发请求，易触发公网 IP 封禁（429）及服务端 SSRF 内网探测漏洞 | ✅ **由用户本机 `127.0.0.1:19820` 桥接服务中转**，无浏览器 CORS 限制，且天然复用本机网络与内网权限 |
| **持久化与跨设备** | 仅保存在单一服务器目录 | **三级存储体系**：本机磁盘 `local-plugins/` ⇄ 浏览器按用户缓存 ⇄ 云端按 `userId` 隔离的静态同步仓 |

### 2. 全景架构拓扑图

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 🌐 浏览器客户端运行时 (https://app.example.com)                                                 │
│                                                                                                 │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐  ┌───────────────────────┐  │
│  │ 1. 公共只读宿主底座          │  │ 2. 四步动态插件注入引擎      │  │ 3. 统一桥接 SDK       │  │
│  │ • 预留插槽 [data-agent-slot] │  │ • page-patch (原页面局部挂件)│  │   window.agentBridge  │  │
│  │ • 暴露脱敏页面状态           │  │ • custom-page (独立新路由页) │  │ • fetchProxy (免跨域) │  │
│  │   bridge.getPageData()       │  │ • AsyncFunction 沙箱编译执行 │  │ • getPageData()       │  │
│  └──────────────────────────────┘  └──────────────────────────────┘  │ • callBackendApi()    │  │
│                                                                      └───────────────────────┘  │
└───────────────▲───────────────────────────────────────┬──────────────────────────┬──────────────┘
                │ ① WebSocket 实时推送本地插件          │ ② 外部接口跨域中转       │ ③ 登录同步插件包
                │   & 网页对话框唤醒本地无头 Agent      │   bridge.fetchProxy()    │   & 调白名单业务接口
                ▼                                       ▼                          ▼
┌───────────────────────────────────────────────────────────────────┐  ┌──────────────────────────┐
│ 💻 用户本地电脑 (~/.web-agent-bridge/)                            │  │ ☁️ 云端应用服务器        │
│                                                                   │  │ (零用户代码执行)         │
│  ┌─────────────────────────────────────────────────────────────┐  │  │                          │
│  │ 🛡️ 本地安全桥接服务 (bridge-daemon.mjs 监听 127.0.0.1:19820)│  │  │ • 公共只读前端静态资源   │
│  │ • 安全校验: Origin 强白名单 + #bridgeToken 鉴权 + Chrome PNA│  │  │ • 受控白名单接口:        │
│  │ • 热重载引擎: fs.watch 监听 local-plugins/ 秒级推送浏览器   │  │  │   GET /api/host/data     │
│  │ • 跨域代理网关: POST /proxy 代发外部请求 (股票/天气/第三方) │──┼─►│ • 多租户静态插件同步仓:  │
│  │ • 无头进程调度: spawn codex exec / claude -p (关闭 stdin)   │  │  │   /var/lib/web-studio/   │
│  └──────────────────────────────┬──────────────────────────────┘  │  │   users/{userId}/        │
│                                 │ 读写本地插件目录                │  │   plugins.json           │
│                                 ▼                                 │  └──────────────────────────┘
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 📁 本地插件源码库 (~/.web-agent-bridge/local-plugins/*.json)│  │  ┌──────────────────────────┐
│  │ • weather-patch.json (宿主页局部天气挂件)                   │  │  │ 📈 外部第三方 API 服务   │
│  │ • stock-quote.json   (实时股票行情监控插件)                 │  │  │ • 股票行情 (Yahoo/新浪等)│
│  │ • snake.json         (独立贪食蛇游戏页)                     │  │  │ • 实时天气 (Open-Meteo)  │
│  │ • calculator.json    (独立科学计算器页)                     │  │  │ (由本机 Bridge 直接请求，│
│  └─────────────────────────────────────────────────────────────┘  │  │  彻底绕过浏览器 CORS)    │
└───────────────────────────────────────────────────────────────────┘  └──────────────────────────┘
```

---

## 二、 本地插件的两种标准形态与浏览器「四步动态注入引擎」

所有由本地 Agent 生成或修改的功能，均以标准 JSON 文件保存在本机 `~/.web-agent-bridge/local-plugins/<plugin-id>.json` 中，分为两种形态：

1. **形态一：`kind: "page-patch"`（宿主页面局部增强补丁）**
   * **适用场景**：在网站原有的页面上增加新模块（如在原专注工作台顶部注入「实时天气卡片」或「自选股行情条」）。
   * **机制**：不改动服务端原页面代码，通过 `targetPage` 与 `targetSelector` 定位宿主页面上的 DOM 容器，创建带 `data-plugin-root="<id>"` 的隔离节点挂载 HTML/CSS/JS。
2. **形态二：`kind: "custom-page"`（本地扩展独立新页面）**
   * **适用场景**：从零创建全新的独立功能页（如「🐍 贪食蛇」页面、「🧮 科学计算器」页面、「📈 股票实时盯盘」页面）。
   * **机制**：前端收到本地 Bridge 推送后，自动在左侧导航栏生成菜单项与独立 Hash 路由（如 `#snake`、`#calculator`），点击时挂载至主舞台容器 `#live-page-canvas`。

### 浏览器端「四步动态注入引擎」核心实现

根据 HTML5 安全规范，直接往 `element.innerHTML` 写入 `<script>` 标签不会执行。前端通过 `mountPluginToDOM(plugin, hostContainer)` 四步完成安全注入与热更新：

```javascript
const activeCleanups = new Map(); // pluginId -> cleanupFunction

async function mountPluginToDOM(plugin, hostContainer) {
  // 【第 1 步：执行旧实例生命周期清理 (Lifecycle Teardown)】
  // 热更新或切换页面前，先调用上一个实例返回的 cleanup 函数，
  // 自动清理 setInterval 行情轮询定时器、WebSocket 连接或全局 keydown 监听，防止内存泄漏。
  if (activeCleanups.has(plugin.id)) {
    try { activeCleanups.get(plugin.id)(); } catch (e) { console.warn(e); }
    activeCleanups.delete(plugin.id);
  }

  // 【第 2 步：独立命名空间样式表注入 (Scoped Style Injection)】
  let styleEl = document.querySelector(`style[data-plugin-style="${plugin.id}"]`);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-plugin-style', plugin.id);
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = plugin.css || '';

  // 【第 3 步：创建隔离 DOM 挂载根节点 (Isolated Mount Root)】
  let rootEl = hostContainer.querySelector(`[data-plugin-root="${plugin.id}"]`);
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.setAttribute('data-plugin-root', plugin.id);
    hostContainer.prepend(rootEl);
  }
  rootEl.innerHTML = plugin.html || '';

  // 【第 4 步：使用 AsyncFunction 即时编译并注入 (root, bridge) 上下文】
  if (plugin.js && plugin.js.trim()) {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const runtimeFn = new AsyncFunction('root', 'bridge', plugin.js);
    const cleanup = await runtimeFn(rootEl, window.agentBridge);
    if (typeof cleanup === 'function') {
      activeCleanups.set(plugin.id, cleanup);
    }
  }
}
```

---

## 三、 深度专题：插件代码如何跨域访问第三方服务（以查询实时股票行情 API 为例）

当我们在本地插件中编写代码访问外部域名的服务（例如查询股票实时行情 API、财经新闻、第三方天气或企业内部系统接口）时，如果直接在插件 JS 里写 `fetch('https://hq.sinajs.cn/list=sh600519')` 或 `fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL')`，会立刻遇到浏览器的两道铁闸：

### 1. 为什么浏览器直接请求股票行情 API 会失败？

1. **浏览器同源策略（SOP）与 CORS 拦截**：
   宿主网页运行在 `https://app.example.com`，而股票行情接口位于第三方域名。绝大多数第三方行情服务器**不会返回 `Access-Control-Allow-Origin: https://app.example.com` 响应头**，浏览器会直接在控制台报错 `Blocked by CORS policy` 并丢弃响应数据。
2. **受保护请求头限制（Forbidden Request Headers）**：
   许多财经行情接口（如新浪财经、东方财富、雪球等）为了防盗链，强制校验 HTTP 请求头中的 `Referer`、`Origin` 或特定的 `User-Agent` / `Cookie`。而在浏览器沙箱中，根据 W3C Fetch 规范，**前端 JavaScript 严禁修改或伪造 `Referer`、`Origin` 和 `Host` 等受保护请求头**。
3. **字符集编码差异（如 GBK / GB18030）**：
   部分国内传统行情接口返回的是 `GB18030` 编码的文本流而非 UTF-8 JSON，直接在前端处理较为繁琐。

### 2. 为什么不能让云端中心服务器做反向代理？

* **中心服务器 IP 极易被封禁（Rate Limit / 429）**：如果几百个用户的插件都在轮询股票行情，且全部由云端服务器代发，行情服务商会看到同一个机房公网 IP 高频请求，几分钟内就会将该服务器 IP 封禁。
* **服务端 SSRF（服务端请求伪造）高危漏洞**：一旦云端服务器开放通用 URL 转发接口，恶意用户可传入 `http://127.0.0.1:6379` 攻击服务端内网。
* **无法访问用户本机行情终端**：如用户在本地运行了 FutuOpenD（富途牛牛本地网关 `127.0.0.1:11111`）或本地量化服务，云端服务器根本无法访问。

### 3. 核心破局方案：通过本地桥接服务（`127.0.0.1:19820`）进行跨域中转

**核心原理**：CORS 同源策略**只是浏览器限制前端 JS 的规则，本机运行的 Node.js 守护进程（`bridge-daemon.mjs`）作为原生操作系统进程，发起任何 HTTP/HTTPS 请求均完全不受 CORS 限制，且可以自由设置任意 `Referer`、`User-Agent`、`Cookie` 请求头！**

#### 跨域中转的完整两跳链路（Two-Hop Proxy Flow）

```text
┌──────────────────────────────┐
│ 1. 浏览器内运行的股票插件 JS │
│    (Origin: app.example.com) │
└──────────────┬───────────────┘
               │ 【第一跳：浏览器 ➔ 本地桥接服务】
               │ 调用 await bridge.fetchProxy({ url: "https://hq.sinajs.cn/...", headers: {...} })
               │ 底层发往 http://127.0.0.1:19820/proxy (或复用已建联的 ws://127.0.0.1:19820/ws)
               │ ✅ 本地 Bridge 返回 Access-Control-Allow-Origin: https://app.example.com
               │ ✅ 本地 Bridge 返回 Access-Control-Allow-Private-Network: true
               ▼
┌──────────────────────────────┐
│ 2. 本地桥接服务              │
│    bridge-daemon.mjs (:19820)│
└──────────────┬───────────────┘
               │ 【第二跳：本地 Node.js 进程 ➔ 第三方股票行情 API】
               │ 由 Node.js 原生 fetch 直接发起 Server-to-Server 请求：
               │ ✅ 无任何浏览器 CORS 限制
               │ ✅ 自动注入第三方接口要求的 Referer / User-Agent / API-Key
               │ ✅ 自动识别并转换 GB18030 / UTF-8 字符编码，统一封装为 JSON 返回浏览器
               ▼
┌──────────────────────────────┐
│ 3. 第三方股票行情服务器      │
│    (Yahoo Finance / 新浪财经)│
└──────────────────────────────┘
```

### 4. 核心追问一：Agent 如何知道编写代码时要走本地桥接，而不是直接调或者改服务端？

为了让本地 Agent（无论是终端交互运行的 Agent，还是网页对话框拉起的无头 Agent）100% 遵循“本地插件注入 + 外部请求走本地桥接代理”，系统设计了**“三层提示契约 + 一层运行时透明劫持兜底”的双重保障机制**：

#### 第一层（静态契约引导）：让 Agent 主动编写 `await bridge.fetchProxy(...)`

1. **工作区规范文件（`AGENTS.md` / `CLAUDE.md`）明确定义架构边界**：
   工作区根目录下的 `AGENTS.md` 已全面更新为 **Local-First 本地插件注入规范**，明确告知 Agent：
   * 严禁直接修改服务端公共代码，所有新增页面（`custom-page`）或页面局部挂件（`page-patch`）均保存在本机 `./local-plugins/*.json`；
   * 插件 JS 运行在 `new AsyncFunction('root', 'bridge', 'fetch', js)` 沙箱中；
   * 当需要访问任何第三方域名 API（如查询股票行情、天气等）时，优先调用 `await bridge.fetchProxy(url, { headers, charset })`。
2. **MCP 工具 Schema 自描述（Tool InputSchema Description）**：
   在本地 `mcp-server.mjs` 暴露给 Agent 的 `create_remote_page` 与 `update_remote_page` 工具定义中，`js` 字段的 `description` 显式写明：
   > *"若插件需访问外部接口，请调用 `await bridge.fetchProxy(url, options)` 绕过跨域；若需读取宿主页面数据或调用后台接口，请调用 `bridge.getPageData()` 或 `await bridge.callBackendApi(path)`。"*
3. **无头进程启动时的动态上下文注入（Contextual Prompt Prefix）**：
   当用户在网页聊天框发起任务、由本地 `bridge-daemon.mjs` 拉起无头 `codex exec` 时，守护进程会在用户 Prompt 前自动注入系统级上下文声明，确保无头 Agent 每次生成代码时都清楚 `bridge.fetchProxy` 的签名与用法。

#### 第二层（运行时透明劫持兜底）：就算 Agent 忘了写 `bridge.fetchProxy`，直接写了原生 `fetch()` 也能自动走桥接！

如果大模型出于训练习惯，在生成的插件 JS 代码里直接写了标准的 `const res = await fetch('https://api.market.com/quote')`，怎么办？
我们在浏览器端「四步动态注入引擎」中实现了**作用域级 `fetch` 透明拦截器（Scoped Fetch Auto-Interception）**：

```javascript
// 1. 在 window.agentBridge 上定义透明拦截器 scopedFetch
scopedFetch: async (input, init = {}) => {
  const targetUrl = typeof input === 'string' ? input : (input?.url || String(input));
  const parsed = new URL(targetUrl, window.location.origin);

  // 判断是否为跨域的外部第三方 API（既不是当前网站同源，也不是 127.0.0.1 本地桥接本身）
  const isSameOrigin = parsed.origin === window.location.origin;
  const isLocalBridge = parsed.origin === 'http://127.0.0.1:19820';

  if (!isSameOrigin && !isLocalBridge) {
    // 自动拦截跨域请求！透明转发至本地桥接服务 127.0.0.1:19820/proxy
    const proxyRes = await window.agentBridge.fetchProxy(parsed.toString(), {
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body,
      charset: init.charset || 'utf-8'
    });
    const bodyStr = typeof proxyRes.data === 'string' ? proxyRes.data : JSON.stringify(proxyRes.data ?? {});
    // 包装为标准 W3C Response 对象返回，让插件里的 await res.json() / await res.text() 无感运行！
    return new Response(bodyStr, {
      status: proxyRes.status || (proxyRes.ok ? 200 : 502),
      headers: { 'Content-Type': proxyRes.contentType || 'application/json' }
    });
  }

  // 同源请求则正常走浏览器原生 window.fetch
  return window.fetch(input, init);
}

// 2. 在编译插件 JS 时，将第 3 个形参命名为 'fetch' 并传入 scopedFetch，自动遮蔽全局 window.fetch！
const runtimeFn = new AsyncFunction('root', 'bridge', 'fetch', plugin.js);
const cleanup = await runtimeFn(rootEl, window.agentBridge, window.agentBridge.scopedFetch);
```

* **显式调用 `bridge.fetchProxy(url, options)`**：当 Agent 需要高级代理能力（如伪造新浪财经防盗链所需的 `Referer` 请求头、或指定 `charset: 'gb18030'` 中文解码）时使用；
* **隐式兜底 `fetch(url, init)`**：当 Agent 直接写标准 `fetch` 访问外部 JSON 接口时，沙箱通过形参遮蔽（Parameter Shadowing）自动拦截并转交本地 Bridge 代理，**双管齐下，确保 100% 不会触发浏览器 CORS 报错**。

---

### 5. 核心追问二：本地桥接服务（`bridge-daemon.mjs`）内部是如何实现这种类似代理的功能的？

本地桥接服务并非简单的端口转发，而是在本机 Node.js 进程内实现了一个**“应用层 HTTP/WebSocket 解包 ➔ 原生网络栈代发 ➔ 字符集转码与重封装”的五步代理网关（Application-Level Forward Proxy）**：

1. **第 1 步：本地跨域握手放行与安全鉴权（CORS + Chrome PNA + Token Guard）**
   * 当浏览器向 `http://127.0.0.1:19820/proxy` 发起请求时，浏览器会先发送 `OPTIONS` 预检请求（包含 `Access-Control-Request-Private-Network: true`）。
   * 本地 Bridge 校验 `Origin` 在白名单内后，返回 `Access-Control-Allow-Origin: https://app.example.com` 与 `Access-Control-Allow-Private-Network: true`，通过浏览器的跨域与私有网络检查。
2. **第 2 步：请求描述符解包与协议/SSRF 过滤（Payload Unpacking & Protocol Guard）**
   * 浏览器发给 `/proxy` 的并不是原始 HTTP 代理流量，而是一个封装好的 JSON 指令包：
     `{ "url": "https://hq.sinajs.cn/list=sh600519", "method": "GET", "headers": { "Referer": "..." }, "charset": "gb18030" }`。
   * 本地 Bridge 解析 `new URL(url)`，强制校验协议必须为 `http:` 或 `https:`（拒绝 `file://` 等本地文件协议），并拦截 `169.254.169.254` 等敏感地址。
3. **第 3 步：受保护请求头注入（Forbidden Header Injection）**
   * 在浏览器中，`Referer`、`Origin`、`User-Agent`、`Host`、`Cookie` 属于 W3C 规范锁死的前端禁改头（Forbidden Headers）。
   * 但在本地 Bridge 的 Node.js 进程中，这些只是普通的字符串键值对。Node.js 将 JSON 包里的 `headers` 原封不动写入上游请求头中，轻松通过第三方股票/财经 API 的防盗链校验。
4. **第 4 步：脱离浏览器沙箱的 Server-to-Server 原生请求（Node.js Undici Fetch）**
   * 本地 Bridge 调用 Node.js 内置的 `fetch(targetUrl, ...)` 直接通过操作系统的 TCP/TLS 协议栈向目标股票服务器发起连接，并绑定 `AbortSignal.timeout(15000)` 防止慢速连接挂起。由于请求方是本地 Node.js 进程而非浏览器，**根本不存在浏览器同源策略（SOP）的限制**。
5. **第 5 步：二进制流读取、字符集转码（Charset Decoding）与 JSON 标准化回传**
   * 本地 Bridge 通过 `await upstreamRes.arrayBuffer()` 获取原始字节流；
   * 根据请求指定的 `charset`（如新浪股票接口的 `'gb18030'` 或默认的 `'utf-8'`）调用 `new TextDecoder(charset).decode(arrayBuffer)` 完成转码；
   * 若响应 `Content-Type` 为 `application/json` 则自动执行 `JSON.parse`，最后将 `{ ok, status, contentType, headers, data }` 统一序列化为 UTF-8 JSON 返回给浏览器前端。

---

### 6. 实战代码：完整的「实时股票行情监控插件（`stock-quote.json`）」

以下是一个可直接保存在 `~/.web-agent-bridge/local-plugins/stock-quote.json` 中运行的完整股票行情插件示例，演示如何通过 `bridge.fetchProxy` 跨域拉取 **美股/港股/A股** 实时行情、伪造必要的 `Referer` 请求头，并结合宿主页面状态进行展示：

```json
{
  "id": "stock-quote-monitor",
  "kind": "custom-page",
  "title": "实时股票行情看板",
  "icon": "📈",
  "description": "通过本地 Bridge 免跨域代理实时拉取 A股/美股/港股行情，支持自定义自选股与自动刷新",
  "updatedAt": "2026-11-07T06:30:00.000Z",
  "html": "<div class=\"stk-wrap\">\n  <div class=\"stk-header\">\n    <div>\n      <h2>📈 实时自选股行情监控 (Local Bridge CORS Proxy)</h2>\n      <p class=\"stk-sub\">经由本地 127.0.0.1:19820/proxy 代发请求，无视浏览器 CORS 与 Referer 防盗链限制</p>\n    </div>\n    <div class=\"stk-controls\">\n      <input id=\"stk-input\" value=\"sh600519,sz000858,gb_aapl,gb_nvda\" placeholder=\"输入股票代码，逗号分隔\" />\n      <button id=\"stk-refresh\">立即刷新</button>\n    </div>\n  </div>\n  <div id=\"stk-status\" class=\"stk-status\">准备就绪</div>\n  <div id=\"stk-grid\" class=\"stk-grid\"></div>\n</div>",
  "css": ".stk-wrap { padding: 20px; color: #f8fafc; font-family: system-ui, sans-serif; }\n.stk-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid #334155; }\n.stk-sub { font-size: 0.85rem; color: #94a3b8; margin-top: 4px; }\n.stk-controls { display: flex; gap: 8px; }\n.stk-controls input { width: 300px; padding: 8px 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; }\n.stk-controls button { padding: 8px 16px; border-radius: 8px; border: none; background: #38bdf8; color: #060a12; font-weight: 700; cursor: pointer; }\n.stk-status { font-size: 0.82rem; color: #34d399; margin-bottom: 14px; }\n.stk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }\n.stk-card { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 16px; }\n.stk-name { font-weight: 700; font-size: 1.05rem; display: flex; justify-content: space-between; }\n.stk-code { font-size: 0.78rem; color: #94a3b8; font-family: monospace; }\n.stk-price { font-size: 1.6rem; font-weight: 800; margin: 10px 0 4px; }\n.stk-up { color: #f43f5e; }\n.stk-down { color: #10b981; }",
  "js": "const inputEl = root.querySelector('#stk-input');\nconst statusEl = root.querySelector('#stk-status');\nconst gridEl = root.querySelector('#stk-grid');\n\nasync function fetchStockQuotes() {\n  const symbols = inputEl.value.trim();\n  if (!symbols) return;\n  statusEl.textContent = '正在通过本地桥接服务请求行情接口...';\n\n  // 核心：调用本地 Bridge 的 fetchProxy 中转访问第三方股票行情接口\n  // 1. 绕过浏览器 CORS 拦截\n  // 2. 由本地 Node.js 注入行情接口强制要求的 Referer 与 User-Agent 头\n  // 3. 指定 charset: 'gb18030' 由本地 Bridge 自动完成中文解码\n  const res = await bridge.fetchProxy(`https://hq.sinajs.cn/list=${encodeURIComponent(symbols)}`, {\n    method: 'GET',\n    charset: 'gb18030',\n    headers: {\n      'Referer': 'https://finance.sina.com.cn/',\n      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'\n    }\n  });\n\n  if (!res || !res.ok) {\n    statusEl.textContent = '行情获取失败: ' + (res?.error || '请确认本地 Bridge 已启动');\n    return;\n  }\n\n  // 解析返回的行情文本并渲染卡片\n  const lines = String(res.data).split('\\n').filter(Boolean);\n  gridEl.innerHTML = lines.map(line => {\n    const match = line.match(/hq_str_([^=]+)=\"([^\"]+)\"/);\n    if (!match) return '';\n    const code = match[1];\n    const parts = match[2].split(',');\n    const name = parts[0];\n    const isGlobal = code.startsWith('gb_');\n    const price = parseFloat(isGlobal ? parts[1] : parts[3]) || 0;\n    const prevClose = parseFloat(isGlobal ? parts[26] : parts[2]) || price;\n    const changePct = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : '0.00';\n    const cls = changePct >= 0 ? 'stk-up' : 'stk-down';\n    const sign = changePct >= 0 ? '+' : '';\n    return `<div class=\"stk-card\">\n      <div class=\"stk-name\"><span>${name}</span><span class=\"stk-code\">${code.toUpperCase()}</span></div>\n      <div class=\"stk-price ${cls}\">${price.toFixed(2)}</div>\n      <div class=\"${cls}\">${sign}${changePct}% (昨收: ${prevClose.toFixed(2)})</div>\n    </div>`;\n  }).join('');\n\n  statusEl.textContent = `最后更新: ${new Date().toLocaleTimeString()} (经由 127.0.0.1:19820/proxy 代理)`;\n}\n\nroot.querySelector('#stk-refresh').addEventListener('click', fetchStockQuotes);\nawait fetchStockQuotes();\n\n// 每 5 秒自动刷新一次行情，并在切换页面/卸载插件时自动清除定时器\nconst timer = setInterval(fetchStockQuotes, 5000);\nreturn () => clearInterval(timer);"
}
```

---

## 四、 其他三大典型实战场景全链路拆解

### 案例一：在本地 Agent 中给原有的远程页面增量添加「实时天气卡片」（`page-patch` + 读取宿主页数据）
1. **感知宿主页面结构**：Agent 调用本地 MCP 工具获取宿主页面 `pomodoro-pro` 的插槽选择器 `.pomodoro-header-slot`。
2. **写入本地补丁文件**：Agent 生成 `~/.web-agent-bridge/local-plugins/weather-patch.json`（`kind: "page-patch"`，`targetPage: "pomodoro-pro"`），绝不修改服务端公共页面源码。
3. **实时热注入与跨域查询**：`bridge-daemon.mjs` 通过 `fs.watch` 捕获文件写入，经 WebSocket 推送给浏览器；插件脚本先调用 `bridge.getPageData()` 读取当前登录用户信息，再调用 `await bridge.fetchProxy('https://api.open-meteo.com/...')` 拉取实时天气并挂载到番茄钟顶部。

### 案例二：在本地 Agent 终端直接创建独立新页面「🐍 贪食蛇（`snake`）」（`custom-page`）
1. **生成单页应用插件包**：本地 Agent 将 Canvas 画布 HTML、街机风格 CSS、键盘/触屏控制循环 JS 写入 `~/.web-agent-bridge/local-plugins/snake.json`（`kind: "custom-page"`）。
2. **动态注入导航与生命周期回收**：浏览器收到 WebSocket 推送后，在左侧导航栏动态生成 `🐍 贪食蛇` 入口；游戏脚本末尾返回 `() => { clearInterval(loop); window.removeEventListener('keydown', onKey); }`，确保切换页面时自动销毁定时器与全局按键监听。

### 案例三：在网页对话框中调用本机无头终端生成「🧮 科学计算器（`calculator`）」并联动后台白名单接口
1. **网页发起无头任务**：用户在网页右侧聊天框输入需求，前端通过 WebSocket 发送 `harness.run` 指令给本地 `127.0.0.1:19820`。
2. **拉起无头 CLI（防挂起关键配置）**：本地守护进程调用 `spawn('codex', ['exec', '--json', ...], { stdio: ['ignore', 'pipe', 'pipe'] })`（**必须将 `stdin` 设为 `'ignore'`，防止 CLI 阻塞等待标准输入 EOF**）。
3. **实时思考流回传 + 插件热注入 + 后台受控接口调用**：无头 CLI 的 `stdout` JSONL 思考过程实时推回网页聊天框；生成的 `calculator.json` 落盘后秒级注入网页主画布，并可通过 `await bridge.callBackendApi('/api/host/data')` 读取服务端白名单接口中的用户配额数据。

---

## 五、 多用户隔离与云端静态插件同步机制

为了保证**“下次打开或换电脑登录仍然有”**且**“支持多用户隔离、绝不在服务端运行用户代码”**，系统采用三级存储与双向同步协议：

1. **第一级：本机物理磁盘（`~/.web-agent-bridge/local-plugins/*.json`）** —— 主开发源，支持 Agent 直接读写与 `fs.watch` 秒级热重载。
2. **第二级：浏览器按用户隔离缓存（`localStorage["plugins_{userId}"]`）** —— 离线兜底，即使本地 Bridge 未启动，打开网页也能立即渲染该用户的个人插件。
3. **第三级：云端多租户静态同步仓（`/var/lib/web-studio/users/{userId}/plugins.json`）** —— 跨设备同步源：
   * 用户登录 `https://app.example.com` 时，前端携带认证凭证调用 `GET /api/user/plugins` 拉取该用户专属的插件 JSON 列表；
   * 比对本地与云端插件的 `updatedAt` 时间戳自动完成增量合并，并可通过 `POST http://127.0.0.1:19820/local-plugins/import` 同步写回新电脑的本地磁盘；
   * 服务端只做 JSON Schema 结构校验与纯静态文件读写，**0% 服务端代码执行**。

---

## 六、 纵深安全架构：本地桥接服务 5 道防线 + 服务端 3 道防线

| 端侧 | 安全防线 | 抵御的风险场景 | 具体工程实现 |
| :--- | :--- | :--- | :--- |
| **本地桥接端** | **1. 严格绑定回环地址** | 防止同一局域网其他机器扫描连接本地 Bridge | `server.listen(19820, '127.0.0.1')`，严禁绑定 `0.0.0.0` |
| **本地桥接端** | **2. `Origin` 强白名单校验** | 防止恶意钓鱼网站发起跨站请求伪造或跨站 WebSocket 劫持 (CSWSH) | HTTP 与 WebSocket 握手强制校验 `req.headers.origin`，仅放行 `https://app.example.com`，其余一律 `403` |
| **本地桥接端** | **3. URL Hash Fragment 高熵令牌配对 (RFC 3986)** | 防止未授权网页或同机其他进程偷调 `/proxy` 或无头 Agent | 启动时生成 24 字节随机 Token，通过 `#bridgeToken=<token>` 传入浏览器（Fragment 绝不发送给远端服务器，零日志泄露）；所有请求强制校验 `X-Bridge-Token` |
| **本地桥接端** | **4. W3C Secure Context 与 Chrome PNA 合规** | 解决 HTTPS 网站访问 `127.0.0.1` 的混合内容与私有网络预检拦截 | 响应头显式返回 `Access-Control-Allow-Private-Network: true` 与精确的 `Access-Control-Allow-Origin` |
| **本地桥接端** | **5. 本地 `/proxy` 协议与内网元数据保护** | 防止通过代理探测敏感协议或路径穿越 | `/proxy` 仅允许 `http:` / `https:`，拦截 `169.254.169.254` 等敏感地址，限制超时与响应体积；MCP 路径强制 `path.basename` 清洗 |
| **云端服务端** | **6. 服务端零代码执行** | 防止恶意插件导致服务器 RCE 沦陷 | 服务端仅将插件作为静态 JSON 文本落盘，绝不调用 `eval` / `Function` / `vm` |
| **云端服务端** | **7. 多租户物理隔离** | 防止用户 A 越权读写或污染用户 B 的插件 | 强制校验用户身份凭证，按 `/var/lib/web-studio/users/{userId}/plugins.json` 隔离存储 |
| **云端服务端** | **8. 服务端 SSRF 免疫** | 防止利用中心服务器扫描机房内网 | 中心服务器不提供任何外部 URL 代理接口，外部 API 均由客户端本地 Bridge 代发 |

---

## 七、 核心工程代码参考（本地跨域代理与前端 SDK 实现）

### 1. 本地桥接服务 `/proxy` 跨域代理完整实现（支持自定义 `Referer` 与 `GB18030` 股票行情解码）

```javascript
// 位于本地 ~/.web-agent-bridge/bridge-daemon.mjs
if (req.method === 'POST' && urlObj.pathname === '/proxy') {
  let rawBody = '';
  req.on('data', chunk => {
    rawBody += chunk;
    if (rawBody.length > 2 * 1024 * 1024) req.destroy(); // 限制请求体最大 2MB
  });

  req.on('end', async () => {
    try {
      const { url, method = 'GET', headers = {}, body, charset = 'utf-8' } = JSON.parse(rawBody);
      const targetUrl = new URL(url);

      // 安全校验：仅允许 HTTP / HTTPS 协议
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        throw new Error('Unsupported protocol: Only HTTP/HTTPS allowed');
      }
      if (targetUrl.hostname === '169.254.169.254') {
        throw new Error('Blocked metadata address');
      }

      // 由本地 Node.js 进程发起请求（无浏览器 CORS 限制，支持注入 Referer / User-Agent）
      const upstreamRes = await fetch(targetUrl.toString(), {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : body,
        signal: AbortSignal.timeout(15000)
      });

      const arrayBuffer = await upstreamRes.arrayBuffer();
      const decoder = new TextDecoder(charset); // 支持 'utf-8' 或股票接口常用的 'gb18030' / 'gbk'
      const decodedText = decoder.decode(arrayBuffer);

      const contentType = upstreamRes.headers.get('content-type') || '';
      let data = decodedText;
      if (contentType.includes('application/json')) {
        try { data = JSON.parse(decodedText); } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: upstreamRes.ok,
        status: upstreamRes.status,
        headers: Object.fromEntries(upstreamRes.headers.entries()),
        data
      }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
  return;
}
```

### 2. 前端 `window.agentBridge` SDK 核心实现

```javascript
window.agentBridge = {
  bridgeUrl: 'http://127.0.0.1:19820',
  getBridgeToken() {
    // 首次从 URL Hash (#bridgeToken=xxx) 提取并存入 localStorage，随后清除地址栏 Hash
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    if (hashParams.get('bridgeToken')) {
      localStorage.setItem('web_agent_bridge_token', hashParams.get('bridgeToken'));
    }
    return localStorage.getItem('web_agent_bridge_token') || '';
  },

  // 1. 免跨域访问任意外部第三方接口（如股票行情、天气、外部 API）
  async fetchProxy(url, options = {}) {
    const resp = await fetch(`${this.bridgeUrl}/proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': this.getBridgeToken()
      },
      body: JSON.stringify({
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        charset: options.charset || 'utf-8'
      })
    });
    return await resp.json();
  },

  // 2. 读取当前宿主页面内的状态数据
  getPageData() {
    return {
      userId: window.currentUserId || 'user_1001',
      currentRoute: window.location.hash.slice(1) || 'home',
      hostState: window.__HOST_PAGE_STATE__ || {}
    };
  },

  // 3. 调用网站后台开放的白名单受控接口
  async callBackendApi(apiPath, options = {}) {
    const allowedPrefixes = ['/api/host/', '/api/user/plugins'];
    if (!allowedPrefixes.some(prefix => apiPath.startsWith(prefix))) {
      throw new Error(`禁止访问非白名单后台接口: ${apiPath}`);
    }
    const resp = await fetch(apiPath, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': window.currentUserId || 'user_1001',
        ...(options.headers || {})
      }
    });
    return await resp.json();
  }
};
```
