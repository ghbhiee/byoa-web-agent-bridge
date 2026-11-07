# BYOA (Bring Your Own Agent)：从“网站内置云端 AI”到“用户本地主权 Agent 赋能万千 Web 应用”的架构范式转移

---

## 一、 疑难错别字与专业术语校对对照表

| 口述原词 / 原句 | 校对后规范表述 | 对应技术与业务语境说明 |
| :--- | :--- | :--- |
| **在不通的平台上使用不通的agent** | **在不同的平台上使用不同的 Agent** | 指当前各个互联网平台/SaaS 各自为政、重复造轮子开发封闭的内置 AI 助手，导致用户在多平台间体验割裂。 |
| **还需要用户一个一个调教这些agent** | **还需要用户逐一调教（Prompt 调优、偏好对齐、记忆喂养）这些 Agent** | 指用户的个人背景、风险偏好、交互习惯与长期记忆（Memory）无法跨平台复用，被迫承担高昂的“重复对齐税”。 |
| **以来本地agent彻底打通这些平台的服务和数据** | **依托本地主权 Agent（Local Sovereign Agent）彻底打通跨平台的服务与数据孤岛** | 以用户本机运行的 Agent 为中枢，向下聚合各平台的 MCP / Skills，向上通过本地桥接（Local Bridge）反向注入增强现有网页。 |
| **mcp/bidge** | **MCP (Model Context Protocol) / Local Bridge（本地桥接守护进程）** | MCP 负责向本地 Agent 暴露结构化工具（Tools）；Local Bridge（`127.0.0.1`）负责打通线上网页与本机 Agent 的双向通信、DOM 注入与跨域代理。 |

---

## 二、 项目出发点：传统 Web 应用“各自内置云端 AI”的三大死胡同

当前几乎所有存量网站与 Web SaaS 应用在思考“如何做 AI 转型”时，第一反应都是在自己的后端服务器上接入大模型 API，做一个**平台内置的云端 AI 助手 / 云端 Agent**。这种模式看似顺理成章，但在实际落地与深水区场景中面临三个无法逾越的结构性瓶颈：

### 1. 算力成本与模型智商的经济学悖论（The Cost-Intelligence Dilemma）
- 绝大多数网站应用的核心商业模式并非售卖 Token。出于服务端推理成本（API 账单与并发配额）的严格限制，网站内置的免费或基础版 AI 往往只能接入廉价的轻量级小模型（如 Mini / Flash 级别），且必须严格限制上下文窗口长度与 Agent 自主循环（ReAct / Tool-Use）的步数。
- 结果是：用户自己手里明明有订阅了顶级旗舰模型（如 Claude Opus / Sonnet、OpenAI Codex / o3 等）的本地强力 Agent，却不得不在各个网站里忍受网站提供的“低配缩水版 AI”。

### 2. 云端沙箱的视野盲区与跨平台断联（Cloud Sandbox Silos）
- 网站内置的云端 Agent 运行在该网站所属企业的后端机房中。受制于**商业竞争壁垒、API 跨站鉴权限制以及数据安全法规**，A 网站的云端 Agent 永远不可能访问用户在 B 网站、C 银行的账户数据，更不可能直接调用用户本机的文件系统、开发工具链、私人知识库或本地认证态（Cookies / U盾 / 硬件证书）。
- 因此，平台内置的云端 Agent 能力半径被死死锁在**“单一网站的公开或单租户数据内”**，发挥空间极其有限。

### 3. 个人认知割裂与高昂的“重复调教税”（Fragmented Alignment Tax）
- 在 Agent 时代，**每个人真正需要的不是 100 个分散在 100 个网站里的陌生 AI，而是 1 个长期陪伴自己、彻底理解个人背景与偏好的“个人主权 Agent（Personal Sovereign Agent）”**。
- 如果每个网站都强迫用户使用它自己的 Agent，用户就不得不在券商网站、银行网站、笔记软件、ERP 系统里把自己的投资风格、财务状况、代码规范、写作偏好重复交代和调教几十遍——不仅效率极低，而且没有任何一个单平台 Agent 拥有用户的完整上下文拼图。

---

## 三、 核心破局思想：BYOA (Bring Your Own Agent) —— 让万千网站成为用户本地 Agent 的“技能插件与交互画布”

基于上述痛点，本项目提出并实现了一套全新的 **BYOA (Bring Your Own Agent，自带本地 Agent) 双向赋能架构**：

```
                   ┌──────────────────────────────────────────────────────────┐
                   │        👤 用户个人主权本地 Agent (Local Sovereign Agent)    │
                   │   (Codex CLI / Claude Code / Cursor / OpenClaw + 顶尖模型) │
                   │     沉淀完整个人记忆 (Memory) · 统一偏好 · 本地安全沙箱      │
                   └───────────┬──────────────────────────────────┬───────────┘
                               │                                  │
        ┌──────────────────────┴────────┐                ┌────────┴──────────────────────┐
        ▼ (通过各平台 MCP / Skills 聚合)  ▼                ▼ (通过 Local Bridge 127.0.0.1)  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────────────┐
│  银行 B 平台   │  │  券商 C 平台   │  │ 本地税务/文件  │  │      用户高频使用的「券商 A 网站」       │
│ (Bank B Skill)│  │(Broker C MCP) │  │ (Local Files) │  │ (直接复用熟悉界面 + 动态注入定制分析看板) │
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────────────────────────────┘
```

### 1. 所有平台以 `Skills / MCP` 的形式聚合在用户的本地 Agent 之下
- 各个网站不再执着于训练或封装封闭的云端 Agent，而是将自身的业务查询、交易申报、页面操作能力封装为标准的 **MCP Server（Model Context Protocol）或 Agent Skill**。
- 用户只需将这些网站的 MCP / Skill 挂载到自己长期调教的本地 Agent 下，即可在本地 Agent 中直接统筹调用所有平台的服务。

### 2. 在现有高频网站界面上，直接调用自己的本地 Agent 并动态注入页面
- 用户并不想为了用 AI 而放弃自己已经用了多年的成熟网站界面（例如交易员习惯了某券商的专业行情界面、开发者习惯了现有的研发后台）。
- 通过在本机运行一个极轻量的 **Local Bridge 守护进程（`ws://127.0.0.1:19820`）**，现有网站只需嵌入几行前端桥接 SDK，就能产生三大质变：
  1. **网页内直连本机无头 Agent**：用户在网页右侧对话栏提问时，调度的不是网站廉价的云端 AI，而是用户本机最强悍的 `codex exec` / `claude -p`；
  2. **跨平台数据在本地安全打通**：本地 Agent 可以同时调用其他平台的 Skills / MCP 或通过本地桥接代理（`bridge.fetchProxy`）拉取跨站数据；
  3. **Local-First 客户端代码注入**：本地 Agent 生成的定制化页面、分析图表、自动化挂件，直接保存在用户本机 `./local-plugins/*.json` 并毫秒级注入到当前网页 DOM 中运行，支持跨设备加密/静态云同步，而**绝不在网站服务端执行任何用户代码**。

---

## 四、 深度场景推演：以“在券商 A 网站跨银行/跨券商做综合财务规划与报税”为例

为了直观体现 **BYOA 本地 Agent 架构** 相比传统网站内置 AI 的降维打击优势，我们以金融财富管理与税务筹划场景为例进行完整的数据流与合规边界剖析：

### 1. 用户真实痛点与诉求
假设我是**券商 A（Broker A）**的深度用户，我每天都打开券商 A 的网页看盘。但我同时在**银行 B（Bank B）**存有定期存款与理财产品，在**券商 C（Broker C）**持有美股/港股账户，且电脑本地存有今年的工资薪金与专项附加扣除记录。
现在，我希望在浏览**券商 A 的网站**时，直接对页面里的 AI 说：
> *“请帮我查询我在银行 B 和券商 C 的实时账户余额与今年已实现盈亏，结合我在当前券商 A 页面上的持仓情况，帮我生成一份跨账户资产再平衡方案与年度综合所得/资本利得报税测算表，并直接做成一个交互式测算面板挂载到券商 A 的首页上。”*

### 2. 为什么传统方案完全无解？
- **如果指望券商 A 内置的云端 AI**：
  1. **跨机构壁垒**：银行 B 和券商 C 属于不同金融机构乃至竞争对手，绝不会向券商 A 的后端服务器开放用户私有账户接口。
  2. **数据安全与合规红线（PIPL / 金融监管）**：根据《个人信息保护法》及证券业网络与信息安全规范，用户绝不可能把自己在银行 B、券商 C 的高敏凭证（Token / Cookie / 私密流水）以及本地完税证明上传给券商 A 的服务器；券商 A 也完全不敢在服务端存储或代客请求其他金融机构的非授权接口。
- **如果重做一个独立的第三方聚合网站/App**：
  - 用户需要离开自己最熟悉的券商 A 交易环境，且同样面临向第三方云端托付全量金融隐私数据的巨大信任门槛。

### 3. 在 BYOA + Local Bridge 架构下如何安全、优雅地完成闭环？

1. **指令发起（在熟悉的券商 A 网页内）**：
   用户在券商 A 的网页聊天栏输入上述指令，网页通过 `ws://127.0.0.1:19820` 将指令及当前券商 A 页面的脱敏上下文（`bridge.getPageData()`）发送给用户本机的 Agent。
2. **跨平台数据拉取与本地汇聚（100% 发生在 Localhost）**：
   - 用户本机的 Agent 唤醒已挂载的 **银行 B Skill**、**券商 C MCP**，或通过本地桥接服务的跨域代理（`POST http://127.0.0.1:19820/proxy`）携带仅存于本机的合法凭证查询外部行情与账户数据；
   - 同时读取本机目录下的个人税务规则与历史表格；
   - **所有跨机构的账户余额、交易流水、盈亏明细均在用户本机内存中完成聚合与对齐，没有任何一字节的外部账户隐私数据上传到券商 A 的后端服务器**。
3. **本地生成交互式插件并动态注入券商 A 页面**：
   - 本机 Agent 计算出最优资产配置比例与抵税方案后，调用 `page_studio` MCP 的 `create_remote_page` / `update_remote_page` 工具，将生成的《跨机构财富规划与报税交互看板》写入本机 `./local-plugins/wealth-tax-planner.json`；
   - 本地 Bridge 守护进程通过 WebSocket 实时将该组件注入到用户当前打开的**券商 A 网页画布**中；
   - 用户继续留在自己最习惯的券商 A 网站界面上，直接拖拽滑块模拟不同减持/调仓方案下的税负变化，甚至一键触发下一步本地指令！

### 4. 核心价值总结
| 维度 | 传统“各网站自建云端 Agent”模式 | 本项目“BYOA 用户本地 Agent + 网页桥接注入”模式 |
| :--- | :--- | :--- |
| **模型能力上限** | 受限于网站成本，多为降级小模型 | 用户自带顶尖旗舰模型（Claude / Codex / 自定义模型），能力无上限 |
| **个人记忆与调教** | 几十个平台各自割裂，需重复调教 | **1 个个人主权 Agent 走天下**，完整继承用户长期记忆与偏好 |
| **跨平台数据打通** | 困于单网站云端沙箱，无法跨机构联动 | 依托本地 MCP/Skills 与本地代理，天然打通银行、券商、本地文件与第三方 API |
| **数据隐私与合规** | 敏感数据需上传平台云端，信任与合规风险高 | **跨平台敏感数据 100% 留存本机（Localhost）**，计算在本地，仅结果渲染上屏 |
| **用户界面体验** | 往往需要跳转到独立 AI 客户端或重做新站 | **零迁移成本**，直接在用户高频使用的成熟网站界面上原生扩展与注入新功能 |

---

## 五、 标准范例：网站如何向用户的本地 Agent 提供“自动安装 MCP / Bridge”的接入说明

在 BYOA 生态下，任何一个网站如果希望支持用户的本地 Agent 接入，只需在网站上托管一个轻量级的 Bridge/MCP 安装包（如 `bridge-bundle.tar.gz`）和一份面向 AI 阅读的说明文档（`agent-setup-guide.md`），并在网页顶部提供一个 **「📦 接入本地 Agent」** 按钮。

用户点击按钮后，复制以下**标准自然语言安装 Prompt** 发送给自己电脑上的本地 Agent（如 Codex / Claude Code / Cursor / OpenClaw），本地 Agent 即可全自动完成环境搭建与桥接配对：

### 📋 给本地 Agent 的一键安装 Prompt 示例（通用脱敏模板）

```markdown
请帮我安装并启动当前网站 (https://your-web-app.example.com) 的本地 Agent 桥接服务 (Local Bridge) 与 MCP 插件：

1. 请先读取该网站的线上 Agent 接入规范文档：
   curl -fsSL https://your-web-app.example.com/agent-setup-guide.md

2. 在我本机创建独立工作目录 ~/.byoa-web-bridge，下载并解压该网站提供的零依赖桥接安装包：
   mkdir -p ~/.byoa-web-bridge && curl -fsSL https://your-web-app.example.com/bridge-bundle.tar.gz | tar -xz -C ~/.byoa-web-bridge

3. 将 ~/.byoa-web-bridge/mcp-server.mjs 注册到我的本地 Agent MCP 配置中：
   - MCP 服务名设为：page_studio
   - 启动命令：node ~/.byoa-web-bridge/mcp-server.mjs
   - 环境变量：
     CODEX_STUDIO_LOCAL_BRIDGE="http://127.0.0.1:19820"
     CODEX_STUDIO_REMOTE_API="https://your-web-app.example.com/api"

4. 在后台启动本地桥接守护进程：
   nohup node ~/.byoa-web-bridge/bridge-daemon.mjs > ~/.byoa-web-bridge/bridge.log 2>&1 &
   启动后读取 ~/.byoa-web-bridge/.bridge-token 中的 256-bit 密钥，并向我输出带有 #bridge_token=<TOKEN> 的专属安全配对链接（格式：https://your-web-app.example.com/#home&bridge_token=<TOKEN>），以便我点击即可完成浏览器与本机 Bridge 的零泄露鉴权配对！
```

### 🔧 本地 Agent 执行上述 Prompt 后的自动化流程与 `#bridge_token` 零泄露安全机制
1. **拉取规范与代码包**：本地 Agent 自动执行 `curl` 拉取 `agent-setup-guide.md` 与 `bridge-bundle.tar.gz`，解压出 `bridge-daemon.mjs`（本地 WebSocket 桥接与 CORS 代理服务）、`mcp-server.mjs`（标准 stdio MCP 工具集）以及 `AGENTS.md`（页面注入与 `bridge.fetchProxy` 编码规范）。
2. **自动挂载 MCP 工具**：本地 Agent 将 `page_studio` 注册进自身的 MCP 配置文件中，立即获得 `list_remote_pages`、`get_remote_page`、`create_remote_page`、`update_remote_page`、`inspect_live_browser`、`eval_in_live_browser` 等操作网页的能力。
3. **生成 `0600` 本地密钥并通过 URL Fragment (`#bridge_token`) 零泄露配对**：
   - `bridge-daemon.mjs` 启动时自动生成 256-bit 随机 Token 存入 `~/.byoa-web-bridge/.bridge-token`（权限 `0600`），所有 HTTP（`X-Bridge-Token`）与 WebSocket（`?token=`）请求均通过 `crypto.timingSafeEqual` 严格校验，防止本机其他未授权进程或恶意网页跨站调用；
   - 用户点击 Agent 输出的 `https://your-web-app.example.com/#home&bridge_token=<TOKEN>` 链接时，根据 **RFC 3986** 规范，`#` 号后的 Fragment 仅在浏览器本地内存解析，**绝不会随 HTTP 请求发送到远端服务器**；
   - 前端提取 `bridge_token` 存入 `localStorage` 后，立即调用 `history.replaceState` 将 Token 从地址栏抹除，顶部状态变为 **「Bridge 已连接」**，彻底实现安全、无感的双向桥接闭环。
