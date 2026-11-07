# Web Studio 本地优先插件注入与桥接工作区规范 (AGENTS.md)

当你在此工作区下运行时，你已自动挂载专属的 **`page_studio` MCP Server**。
本系统采用 **“Local-First 本地插件驻留 + 浏览器运行时动态注入 + 云端多用户静态同步 + 本地桥接跨域代理”** 架构：

1. **绝不直接修改服务端公共页面代码**：所有你新增的页面或对现有页面的修改，均作为独立 JSON 插件保存在本机 `./local-plugins/*.json` 目录中，通过本地桥接服务（`127.0.0.1:19820`）经 WebSocket 实时推送并注入到用户的浏览器页面中运行。
2. **多用户云端静态同步**：当用户在页面登录并点击云同步时，仅将该用户的插件 JSON 作为纯静态数据备份至服务端用户隔离目录，服务端绝不执行任何用户代码。

---

## 一、 你拥有的 `page_studio` MCP 工具清单

1. **`list_remote_pages`**
   - 列出本机 `local-plugins/` 目录中保存的所有自定义页面（`custom-page`）与页面补丁插件（`page-patch`）。
2. **`get_remote_page(slug)`**
   - 读取指定插件或页面的完整 `html`、`css`、`js` 源码（优先读取本地 `local-plugins/<slug>.json`，若本地尚不存在则读取宿主页面只读模板作为参考）。
   - **重要原则**：在修改已有插件或基于宿主页面开发补丁前，务必先调用 `get_remote_page` 查看现有结构。
3. **`create_remote_page({ slug, kind, targetPage, targetSelector, title, icon, description, html, css, js, switchActive })`**
   - 在本机 `local-plugins/<slug>.json` 创建新的插件或页面，并通过本地桥接服务（`127.0.0.1:19820`）毫秒级实时注入到当前打开的浏览器中：
     - `kind: "custom-page"`（默认）：创建一个独立的新功能页面（如 `snake`、`calculator`、`stock-quote`），自动挂载到左侧导航栏「🔌 本地插件页」。
     - `kind: "page-patch"`：创建一个局部增强补丁挂件，通过 `targetPage`（如 `"home"`、`"pomodoro-pro"`）和 `targetSelector`（如 `"[data-agent-slot='home-slot']"`）非侵入式注入到宿主页面指定容器中。
4. **`update_remote_page({ slug, title, icon, description, html, css, js, patches, switchActive })`**
   - 修改本机 `local-plugins/<slug>.json` 中的插件代码（支持全量覆盖或 `patches: [{ target: "html"|"css"|"js", find: "...", replace: "..." }]` 局部替换），保存后由本地 Bridge 自动热注入浏览器。
5. **`delete_remote_page({ slug })`**
   - 从本机 `local-plugins/` 目录删除指定插件，并通知浏览器立即卸载对应 DOM 与副作用。
6. **`inspect_live_browser({ selector })`**
   - 通过本地 `127.0.0.1:19820` WebSocket 通道，实时读取用户当前打开的浏览器标签页中的 DOM 结构、可用插槽与页面状态。
7. **`eval_in_live_browser({ code })`**
   - 在用户当前打开的浏览器标签页中直接执行一段调试 JS 并返回结果。

---

## 二、 插件代码编写规范与「如何通过本地桥接跨域访问外部 API」

你编写的 `js` 字段会在浏览器客户端被编译为 `new AsyncFunction('root', 'bridge', 'fetch', js)` 执行。上下文直接为你注入了三个核心对象：

### 1. `root`（当前插件隔离的 DOM 根容器）
- 查询或操作当前插件内部的 DOM 元素时，请始终使用 `root.querySelector(...)` 或 `root.querySelectorAll(...)`，避免污染宿主页面其他区域。

### 2. `bridge`（本地桥接与宿主交互 SDK —— 核心能力！）

#### ① 访问外部第三方域名 API（如查询股票行情、天气、外部接口）—— 必须走本地桥接代理避免 CORS 跨域！
由于浏览器存在同源策略（CORS）以及禁止前端伪造 `Referer` / `User-Agent` 的限制，**当插件代码需要请求任何第三方域名的 API 时，请优先调用 `await bridge.fetchProxy(url, options)`**：

```javascript
// 示例 1：请求 JSON 格式的外部接口（如天气、汇率、Yahoo Finance）
const res = await bridge.fetchProxy(
  'https://api.open-meteo.com/v1/forecast?latitude=30.2741&longitude=120.1551&current_weather=true',
  { method: 'GET' }
);
if (res.ok) {
  console.log('实时气温:', res.data.current_weather.temperature);
}

// 示例 2：请求需要防盗链 Referer 头且返回 GB18030 编码的股票行情接口（如新浪财经行情）
const stockRes = await bridge.fetchProxy(
  'https://hq.sinajs.cn/list=sh600519,sz000858,gb_aapl',
  {
    method: 'GET',
    charset: 'gb18030', // 由本地 Bridge 自动将 GB18030 字节流解码为 UTF-8 字符串
    headers: {
      'Referer': 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    }
  }
);
if (stockRes.ok) {
  console.log('股票行情原始文本:', stockRes.data);
}
```
> **自动兜底说明**：沙箱内的 `fetch` 也已被自动包装为跨域代理拦截器——若你在插件中直接调用 `await fetch('https://external-api.com/...')`，当检测到目标域名非当前站点域名时，前端沙箱也会自动将其转发至本地 `127.0.0.1:19820/proxy` 执行。但遇到需要自定义 `Referer`/`User-Agent` 或 `charset: 'gb18030'` 的场景，请显式使用 `await bridge.fetchProxy(url, options)`。

#### ② 读取当前宿主页面内的数据状态
```javascript
const pageData = bridge.getPageData();
// 返回: { userId, activeSlug, activePageTitle, localPluginCount, storageSnapshot, ... }
```

#### ③ 调用服务端允许的白名单业务接口
```javascript
const backendData = await bridge.callBackendApi('/api/host/data', { method: 'GET' });
// 自动携带当前登录用户的 X-User-Id 鉴权头访问服务端受控接口
```

#### ④ 在页面内直接反向唤醒本地无头 Agent
```javascript
bridge.sendChatPrompt('请帮我基于当前股票数据生成一份持仓收益计算组件');
```

### 3. 生命周期与副作用清理（必填！）
如果你在 `js` 中注册了 `setInterval` 定时器（如每 5 秒轮询股票行情）或 `window.addEventListener('keydown', ...)` 全局事件，**必须在 `js` 代码末尾返回一个清理函数**：
```javascript
const timer = setInterval(refreshQuotes, 5000);
return () => {
  clearInterval(timer);
};
```
这样当用户切换页面或热更新插件时，前端注入引擎会自动执行该函数，彻底杜绝定时器泄漏和事件冲突。
