# ⚡ BYOA Web Agent Bridge (Bring Your Own Agent)

> **Empowering Existing Web Applications with Users' Local Sovereign Agents via MCP, Skills, and Local-First Runtime Injection.**  
> **拒绝每个网站重复造低配云端 AI：让万千既有网站以 MCP / Skills 聚合在用户自己的本地主权 Agent 之下，并通过本地桥接实现跨平台数据协同与页面动态注入。**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-38bdf8.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-MCP%20%2B%20Local%20Bridge-a78bfa.svg)](#architecture--system-design--系统架构设计)

[**🇬🇧 English Documentation**](#english-documentation) | [**🇨🇳 中文完整文档**](#中文完整文档)

---

<a id="english-documentation"></a>

## 🌍 Vision & Motivation: Why "Bring Your Own Agent" (BYOA)?

### The Broken Status Quo: Every Website Building Its Own Siloed Cloud AI

Today, when existing web applications and SaaS platforms try to "add AI capabilities," their default instinct is to build an **in-house, platform-specific Cloud Agent** hosted on their own backend servers. While well-intentioned, this approach hits three fundamental walls:

1. **The Cost–Intelligence Dilemma**: Because SaaS providers must bear the token inference cost for millions of users, their built-in cloud agents almost always use downgraded, cheaper models (`mini`/`flash` tiers) with heavily truncated context windows and restricted tool-use loops.
2. **Cloud Sandbox Silos**: A cloud agent running on *Website A*'s backend is strictly trapped inside *Website A*'s boundary. Due to commercial competition, authentication barriers, and data privacy regulations, *Website A*'s cloud agent can never access the user's accounts on *Website B*, *Bank C*, or the user's local filesystem.
3. **The Fragmented Alignment Tax**: In the Agentic era, users do not want to train, prompt, and align **50 mediocre, disconnected AI assistants across 50 different websites**. Instead, every user increasingly owns **one deeply personalized Local Sovereign Agent** (e.g., Claude Code, OpenAI Codex CLI, Cursor, OpenClaw) powered by frontier models, holding their long-term memory, personal preferences, and local toolchains.

---

### The BYOA Paradigm Shift: Unifying Platforms Under the User's Local Agent

Instead of forcing users to use a website's weak built-in AI—or forcing users to abandon the mature web interfaces they already use every day—**BYOA Web Agent Bridge** flips the architecture:

```
                   ┌──────────────────────────────────────────────────────────┐
                   │        👤 User's Personal Local Sovereign Agent           │
                   │   (Codex CLI / Claude Code / Cursor / OpenClaw + LLM)    │
                   │   Unified Memory · Frontier Model · Local Security Box   │
                   └───────────┬──────────────────────────────────┬───────────┘
                               │                                  │
        ┌──────────────────────┴────────┐                ┌────────┴──────────────────────┐
        ▼ (Aggregated via MCP / Skills) ▼                ▼ (Via Local Bridge 127.0.0.1)  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────────────┐
│   Bank B API  │  │  Broker C API │  │ Local Tax/CSV │  │   High-Frequency Web App (Broker A)   │
│ (Bank B Skill)│  │(Broker C MCP) │  │ (Local Files) │  │ (Keep Familiar UI + Inject Dashboards)│
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────────────────────────────┘
```

1. **All Platforms Aggregate as `Skills / MCP` Under the User's Agent**:
   Every web platform exposes its capabilities as standard **MCP (Model Context Protocol) servers or Skills**. The user's personal agent can orchestrate services across multiple platforms simultaneously.
2. **Operate the Web App Directly from the Local Agent — or Invoke the Local Agent Inside the Web App**:
   Through a lightweight **Local Bridge Daemon (`ws://127.0.0.1:19820`)**, users can chat inside the web application's UI while actually driving their own local headless agent (`codex exec`, `claude -p`).
3. **Cross-Platform Data Mashups with 100% Local Privacy (The Financial & Tax Planning Example)**:
   - Imagine you are browsing **Broker A's website** (your favorite daily trading terminal).
   - You ask the chat panel inside Broker A's website:  
     *"Query my account balances and realized gains from **Bank B** and **Broker C**, combine them with my current portfolio on **Broker A**, build a cross-account asset rebalancing & annual tax-loss harvesting plan, and render an interactive tax simulator right here on Broker A's dashboard."*
   - **How it works safely**:
     - Your local agent queries Bank B, Broker C, and your local tax spreadsheets **entirely on `localhost`** (via local MCP skills and the local CORS proxy `bridge.fetchProxy`).
     - **Zero sensitive data from Bank B or Broker C is ever uploaded to Broker A's backend servers.**
     - The resulting interactive dashboard is saved as a local plugin (`./local-plugins/tax-planner.json`) and dynamically injected into Broker A's browser DOM!
     - You keep using the familiar website you love, powered by your strongest local agent, with complete cross-platform data sovereignty.

---

### Comparison: Siloed Cloud AI vs. BYOA Local Agent Bridge

| Dimension | Traditional Built-In Website Cloud AI | BYOA Local Agent + Web Bridge (This Project) |
| :--- | :--- | :--- |
| **Model Intelligence** | Capped by website's token budget (often small/cheap models) | **Frontier models** chosen by the user (Claude Opus/Sonnet, GPT-5/Codex, Local LLMs) |
| **Memory & Personalization** | Siloed per website; users must re-teach every site's AI | **Single Sovereign Agent** retains unified user memory & preferences across all sites |
| **Cross-Platform Synergy** | Trapped in a single website's backend sandbox | **Native cross-platform orchestration** across Bank B, Broker C, local files & 3rd-party APIs |
| **Data Privacy & Compliance** | Requires uploading sensitive data to third-party servers | **100% Localhost Execution**: sensitive cross-site data never leaves the user's machine |
| **Code Execution Security** | Risk of server-side RCE or multi-tenant pollution | **Zero Server-Side Code Execution**: plugins run in the client browser sandbox |
| **User Habits & UI** | Forces users into separate chat apps or new platforms | **Zero switching cost**: extends the high-frequency websites users already use daily |

---

## 🏗️ Architecture & Key Capabilities

1. **Local-First Plugin Injection (`./local-plugins/*.json`)**:
   - Agent-created pages (`custom-page`) and DOM widget patches (`page-patch`) are stored on the user's machine and hot-injected into the live browser over WebSocket (`ws://127.0.0.1:19820`) within milliseconds.
2. **Local Bridge CORS & Charset Proxy (`POST http://127.0.0.1:19820/proxy`)**:
   - Injected browser plugins can call `await bridge.fetchProxy(url, options)` (or standard `fetch`, which is automatically intercepted for cross-origin URLs) to query external APIs (e.g., stock market quotes, financial APIs) with custom `Referer`/`User-Agent` headers and automatic `GB18030` / `GBK` -> `UTF-8` decoding, completely bypassing browser CORS restrictions.
3. **Multi-Tenant Static Cloud Sync (`/api/user/plugins`)**:
   - When users log in across multiple devices, their local plugin JSON manifests can be backed up and restored from isolated per-user cloud storage (`/api/user/plugins?userId=<id>`). The cloud server treats plugins strictly as static JSON strings and **never executes user code on the server**.
4. **Full Web IDE & Agent Chat Workbench**:
   - **Collapsible Large-Icon Navigation Dock** & **Collapsible Right AI Chat Panel**.
   - **CJK IME Composition Guard**: Prevents pressing `Enter` during Chinese/Japanese candidate selection from accidentally submitting prompts.
   - **Single-Flight Concurrency Lock & Stop Generation (`⏹ Stop`)**: Terminates running headless agent subprocesses via `SIGTERM`/`SIGKILL`.
   - **Persistent Multi-Session History Switcher**: Switch between historical agent threads (`threadId`) at any time.
   - **Embedded Monaco Editor (`v0.47.0`) + Split Live Preview Sandbox**: Edit `HTML`, `CSS`, `JavaScript`, and `Plugin JSON` with instant live preview and revision rollback.
   - **Standalone Runner for Local Plugins (`/p/<slug>`)**: Open any local plugin in its own dedicated browser tab with full `window.agentBridge` support.

---

## 📋 Example: Standard Prompt to Give Your Local Agent to Install a Website's MCP & Bridge

Any web application adopting the BYOA pattern can host a zero-dependency `bridge-bundle.tar.gz` and `/agent-setup-guide.md`, allowing users to simply copy-paste a single prompt into their local Agent (**Codex / Claude Code / Cursor / OpenClaw**) to wire everything up automatically:

```markdown
Please install and start the Local Agent Bridge and MCP Server for the web application (https://your-web-app.example.com):

1. Read the online Agent onboarding specification:
   curl -fsSL https://your-web-app.example.com/agent-setup-guide.md

2. Create a dedicated local workspace at ~/.byoa-web-bridge, and download & extract the zero-dependency bridge bundle:
   mkdir -p ~/.byoa-web-bridge && curl -fsSL https://your-web-app.example.com/bridge-bundle.tar.gz | tar -xz -C ~/.byoa-web-bridge

3. Register ~/.byoa-web-bridge/mcp-server.mjs in my local Agent MCP configuration:
   - Server Name: page_studio
   - Command: node ~/.byoa-web-bridge/mcp-server.mjs
   - Environment:
     CODEX_STUDIO_LOCAL_BRIDGE="http://127.0.0.1:19820"
     CODEX_STUDIO_REMOTE_API="https://your-web-app.example.com/api"

4. Start the Local Bridge Daemon in the background:
   nohup node ~/.byoa-web-bridge/bridge-daemon.mjs > ~/.byoa-web-bridge/bridge.log 2>&1 &
   Then read the 256-bit secret token from ~/.byoa-web-bridge/.bridge-token and output the one-click URL Fragment pairing link (https://your-web-app.example.com/#home&bridge_token=<TOKEN>) so I can click it to pair my browser with the local bridge with zero network leakage!
```

### 🔒 Zero-Leakage Local Bridge Token Authentication (`#bridge_token`)

To prevent untrusted local processes or drive-by malicious websites from invoking `127.0.0.1:19820`:
- **256-bit CSPRNG Token (`0600` file permissions)**: On startup, `bridge-daemon.mjs` generates a random secret (`bt_...`) in `~/.byoa-web-bridge/.bridge-token` (`chmod 0600`).
- **RFC 3986 URL Fragment Pairing (`#bridge_token=<TOKEN>`)**: Users open `https://your-web-app.example.com/#home&bridge_token=<TOKEN>`. Because URL fragments (`#...`) are **never sent in HTTP requests or `Referer` headers**, the remote web server never sees the token. The browser JS extracts `bridge_token` into `localStorage` and immediately scrubs the address bar via `history.replaceState`.
- **Constant-Time Verification (`crypto.timingSafeEqual`)**: Every WebSocket connection (`?token=<TOKEN>`) and HTTP request (`X-Bridge-Token: <TOKEN>`) is strictly verified.

---

<a id="中文完整文档"></a>

## 🇨🇳 中文完整文档：项目背景、战略意义与技术架构

### 一、 项目出发点：为什么“每个网站各自造一个云端 Agent”是一条死胡同？

当前几乎所有存量网站与 Web 应用在探索“如何增加 AI 能力”时，默认做法都是在网站自己的后端接入大模型，做一个**网站内置的云端 AI / Agent**。但在真实深水区应用中，这种模式存在三个致命缺陷：

1. **网站成本与模型智商的天然矛盾**：
   受制于网站自身的 Token 推理成本，网站内置 AI 往往只能采用降级版小模型、阉割上下文长度与工具调用轮数，效果远不如用户自己订阅的旗舰模型。
2. **云端沙箱的视野局限与平台孤岛**：
   网站内置的 Agent 运行在单一网站的云端服务器上，出于商业竞争与安全隔离，它永远无法读取用户在其他平台、其他金融机构或本地电脑中的数据，能力边界被锁死在单一站点内部。
3. **碎片化的“重复调教税”**：
   实际上，未来每个人都会拥有自己长期使用、深度调教的**个人主权本地 Agent（如 Claude Code、Codex、Cursor、OpenClaw 等）**。与其让用户在 100 个不同的网站上使用 100 个互不相通的平庸 Agent、逼着用户挨个重新调教，**为什么不直接让网站接入用户自己的本地 Agent？**

---

### 二、 BYOA (Bring Your Own Agent) 核心理念：以用户本地 Agent 彻底打通跨平台服务与数据

本项目的核心愿景是建立 **“用户本地主权 Agent + 万千现有网站 MCP/Bridge 协同”** 的新一代 Web 扩展范式：

1. **所有平台以 `Skills / MCP` 形式聚合在用户的本地 Agent 之下**：
   - 用户既可以在本地 Agent 终端里直接调用各个网站平台的服务；
   - 也可以在浏览任意网站时，在网页内直接唤醒并使用自己调教好的本地 Agent；
   - 甚至可以在 A 网站的页面内，通过自己的本地 Agent 跨平台调用 B 平台、C 平台的服务与数据！
2. **典型场景推演：在「券商 A」网站上跨银行/跨券商做财务规划与报税**
   - 假设用户日常高频使用**券商 A** 的网站看盘，但资产同时分散在**银行 B**、**券商 C** 以及本地税务表格中。
   - 用户直接在**券商 A 网站的对话栏**里对自己的本地 Agent 说：
     > *“请查询我在其他银行 B / 券商 C 的账户持仓与流水情况，结合当前券商 A 的账户资产，帮我做一份综合财务规划与年度报税测算，并把交互式看板直接渲染在当前网页上。”*
   - **为什么只有本地 Agent 架构能完美实现？**
     - **数据安全与隐私有绝对保障**：跨银行/跨券商账户查询、敏感流水对齐与税务计算 **100% 在用户本地电脑（Localhost）完成**，银行 B 和券商 C 的私有数据**绝不会上传到券商 A 的服务器**；
     - **无需重做新网站，完整保留用户使用习惯**：计算完成后，本地 Agent 直接生成定制化前端组件并通过本地桥接（`127.0.0.1:19820`）实时注入到用户高频使用的券商 A 网页中显示——用户无需迁移到陌生的新软件，即可在最顺手的现有网站上获得跨平台超级 Agent 能力！

---

### 三、 给本地 Agent 自动安装网站 MCP / Bridge 的标准说明示例

网站无需让用户手动折腾繁琐的配置，只需在网页上提供如下一段 **Agent 专用安装 Prompt**（并托管对应的 `bridge-bundle.tar.gz` 安装包）。用户复制这段话发给自己的本地 Agent，Agent 即可全自动完成安装与配对：

```markdown
请帮我安装并启动当前网站 (https://your-web-app.example.com) 的本地 Agent 桥接服务 (Local Bridge) 与 MCP 插件：

1. 请先读取该网站的线上 Agent 安装规范：
   curl -fsSL https://your-web-app.example.com/agent-setup-guide.md

2. 在我本机创建独立工作目录 ~/.byoa-web-bridge，下载并解压该网站提供的零依赖桥接安装包：
   mkdir -p ~/.byoa-web-bridge && curl -fsSL https://your-web-app.example.com/bridge-bundle.tar.gz | tar -xz -C ~/.byoa-web-bridge

3. 将 ~/.byoa-web-bridge/mcp-server.mjs 注册到我的本地 Agent MCP 配置中（MCP 服务名设为 page_studio，环境变量 CODEX_STUDIO_LOCAL_BRIDGE="http://127.0.0.1:19820"，CODEX_STUDIO_REMOTE_API="https://your-web-app.example.com/api"）。

4. 在后台启动本地桥接守护进程：
   nohup node ~/.byoa-web-bridge/bridge-daemon.mjs > ~/.byoa-web-bridge/bridge.log 2>&1 &
   启动后读取 ~/.byoa-web-bridge/.bridge-token 中的 256-bit 密钥，并向我输出带有 #bridge_token=<TOKEN> 的专属安全配对链接（格式：https://your-web-app.example.com/#home&bridge_token=<TOKEN>），以便我点击即可完成浏览器与本机 Bridge 的零泄露鉴权配对！
```

---

## 🚀 Quick Start / 快速运行指南

### Prerequisites / 环境要求
- **Node.js** `>= 18.0.0` (Zero external npm dependencies required! 纯原生 Node.js 模块实现，零第三方依赖)
- Optional local CLI Agent: OpenAI `codex` CLI or `claude` CLI for headless execution from the web chat panel.

### 1. Start the Host Web Application Server / 启动宿主网站服务端
```bash
npm run server
# Host Web App listening on http://127.0.0.1:3045
```

### 2. Start the Local Bridge Daemon / 启动本地桥接守护进程 (127.0.0.1:19820)
```bash
npm run bridge
# 🚀 Local Codex Bridge Daemon (Local-First Injection + CORS Proxy) on ws://127.0.0.1:19820
```

### 3. Open the Web Studio in Browser / 在浏览器打开工作台
Visit `http://localhost:3045`:
- Click **`📦 接入本地 Agent (安装 MCP/Bridge)`** in the top bar to view the one-click Agent Onboarding Prompt and downloadable bundle (`bridge-bundle.tar.gz`).
- Use the right-hand AI Chat Panel, the built-in **Monaco Multi-Tab IDE + Live Split Preview**, or run your local Agent in the terminal with `mcp-server.mjs` mounted to inject new pages and widgets in real time!

---

## 📂 Repository Structure / 项目目录结构

```text
.
├── bridge-daemon.mjs            # Local Bridge Daemon (ws/http 127.0.0.1:19820, CORS proxy, plugin hot-reload, headless agent runner)
├── mcp-server.mjs               # Standard stdio MCP Server (`page_studio`) exposing 7 live browser & plugin tools
├── AGENTS.md                    # Specification for Local Agents (plugin schema, bridge.fetchProxy CORS guide, lifecycle cleanup)
├── package.json                 # Zero-dependency Node.js package manifest
├── local-plugins/               # Local-first plugins & pages injected into the browser at runtime
│   ├── ashare-market.json       # Real-time stock market terminal plugin (using bridge.fetchProxy)
│   ├── calculator.json          # Scientific calculator & unit converter plugin
│   ├── english-desk.json        # Bilingual reading & flashcards workbench plugin
│   ├── pomodoro-pro.json        # Pomodoro focus timer & task manager plugin
│   └── snake.json               # Neon arcade snake game plugin
├── server-app/
│   ├── server.mjs               # Host Web Server + Multi-Tenant Static Plugin Sync + Standalone Runner (/p/:slug) + Installer routes
│   └── public/
│       ├── index.html           # Studio Frontend (Collapsible large-icon dock, Monaco IDE, IME guard, session history, BYOA setup modal)
│       └── bridge-bundle.tar.gz # Pre-packaged zero-dependency Local Bridge & MCP installer bundle
└── docs/
    ├── BYOA_MANIFESTO_CN.md     # In-depth manifesto on BYOA (Bring Your Own Agent) & cross-platform local data sovereignty
    └── TECHNICAL_ARCHITECTURE_CN.md # Detailed technical architecture, security model & CORS proxy specification
```

---

## 📄 License

MIT License.
