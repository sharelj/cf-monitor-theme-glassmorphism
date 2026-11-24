# 用 Worker 联调主题

三种方式按「接近线上程度」排序。日常改 UI 用方式 B 最快；上线前用方式 A 做一次真实验收；要改 Worker 本身时用方式 C。

| 方式 | 主题从哪里打开 | 后端 | 是否需要 CORS | 私有站/登录 | 适合 |
| --- | --- | --- | --- | --- | --- |
| A. Worker 反代主题 | Worker 域名 `/` | 同一个 Worker | 不需要（同源） | 完整可用 | 上线前验收 |
| B. 本地主题 + 线上 Worker | `http://127.0.0.1:5173` | 已部署 Worker | 需要 | 需手动放 JWT | 快速改界面 |
| C. 本地 wrangler + 本地主题 | `127.0.0.1:5173` | 本地 Worker | 需要 | 本地登录后手动放 JWT | 连后端一起改 |

---

## 方式 A：让 Worker 反代主题（推荐）

CF-Server-Monitor 只反代第三方主题的 `index.html` 与 `assets/`，主题与 API 天然同源，所以不需要 `CORS_ALLOWED_ORIGINS`，登录 Cookie、WebSocket、`/flags`、`/os-icons` 全部正常。

1. 把本项目推到 GitHub，在 **Settings → Secrets and variables → Actions** 添加：
   - `API_BASE`：**留空或填 Worker 自己的域名**。被 Worker 反代时主题与 API 同源，`index.html` 里的 `apiBase` 为空即可；填了同源地址也不会出错。
   - 可选 `TITLE`、`BACKGROUND_IMAGE`、`CSP_API`、`CSP_STATIC`。
2. 运行 `.github/workflows/build-dist.yml`（推主分支或手动触发），确认 `dist` 分支已生成，且根目录只有 `index.html` 与 `assets/`。
3. 在 Worker 后台进入 **主题**，填写第三方主题的 GitHub tree 地址，例如：
   ```
   https://github.com/<你的用户名>/<仓库名>/tree/dist
   ```
   面板拉取并预览后切换到该主题（后台管理页始终是内置主题）。
4. 打开 Worker 根域名验收：
   - 首页 `https://<worker>/`
   - 详情页 `https://<worker>/#/server/<服务器ID>`
   - 后台入口 `https://<worker>/admin#/admin`

> 如果面板要求的是 Pages 地址而不是 GitHub tree，就在 **Settings → Pages** 选择 `dist` 分支作为托管源，再把 Pages 地址填进去。此时主题变为跨域，按方式 B 的 CORS 说明处理。

### 验收时重点看

- 主题反代后 `/flags/hk.svg`、`/os-icons/os-ubuntu.svg` 应返回 200（来自默认皮肤），不要自己去打包旗帜。
- 管理入口点击后进入 `/admin#/admin`，主题里不应出现登录页。
- 私有站：先在 `/admin#/admin` 登录，再回主题，`/api/servers`、`/api/ws` 都应正常。

---

## 方式 B：本地主题 + 线上 Worker（改界面最快）

```bash
cd cf-monitor-theme-glassmorphism
cp .env.example .env.local
```

`.env.local`：

```bash
API_BASE=https://your-worker.workers.dev
```

启动：

```bash
npm run dev
# 打开 http://127.0.0.1:5173
```

Vite 会把 `API_BASE` 写进开发页的 `<meta name="apiBase">`，主题按跨域模式请求 Worker。

### 1. Worker 允许本地来源

在 Worker 环境变量里设置（Cloudflare 控制台 → Worker → Settings → Variables，或 `wrangler secret`）：

```
CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

- 纯 origin，逗号分隔，不带路径和结尾 `/`。
- 改完要重新部署/保存，Worker 才会生效。
- 浏览器 Network 里出现 `blocked by CORS policy` 就是这里没配对；带 `Authorization`、`X-Turnstile-Token` 头的请求会先发 `OPTIONS`，Worker 需要放行这些头。

### 2. 私有站要手动放 JWT

跨域时主题读的是**自己域**（`127.0.0.1:5173`）的 `localStorage`，拿不到 Worker 域下登录后的 token。做法：

1. 在 Worker 域打开 `/admin#/admin` 登录。
2. DevTools → Application → Local Storage → `https://<worker>` → 复制 `jwt_token`。
3. 回到 `http://127.0.0.1:5173`，控制台执行：

   ```js
   localStorage.setItem('jwt_token', '粘贴这里')
   location.reload()
   ```

跨域 WebSocket 会自动把该 token 追加为 `?token=`（同域才走 Cookie）。token 过期后会收到 401/403：清掉本地 token、重新登录再粘贴即可。

### 3. Turnstile

开启 Turnstile 的站点，如果 widget 限制了 hostname，需要把 `127.0.0.1`、`localhost`（以及线上主题域名）加入 Turnstile widget 的 allowed hostnames；否则验证组件不通过。Cloudflare 的测试 key（`1x00000000000000000000AA` 等）不受 hostname 限制。

### 4. 不想处理 CORS 时：用 Vite 代理（仅公开站）

```bash
API_BASE= MONITOR_HUB=https://your-worker.workers.dev npm run dev
```

浏览器只和 `127.0.0.1:5173` 通信，Vite 把 `/api` 和 `ws` 代理到 Worker，不需要 `CORS_ALLOWED_ORIGINS`。代价是浏览器视角是「同域」，私有站的 JWT/Cookie 不会自动带上，适合公开站调试；私有站仍用上面的 `API_BASE` 方式。

> 本地 `wrangler dev` 默认是 https 自签证书；本项目代理已设置 `secure: false`，可直接代理 `https://localhost:8787`。

### 5. 图标 / 外部资源被 CSP 拦

Worker 会给主题响应加自己的 CSP。主题自带的 meta CSP 只能收紧、不能放宽，所以如果图标空白、Bing 背景或汇率不加载，在 **后台 → 外观设置 → CSP 白名单** 里补：

| 用途 | 域名 | 指令 |
| --- | --- | --- |
| Iconify 图标 | `https://api.iconify.design` | connect-src |
| Bing 每日壁纸 | `https://bing.biturl.top` | connect-src + img-src |
| 汇率 | `https://api.frankfurter.dev`、`https://open.er-api.com` | connect-src |
| 自定义背景图 | 图片所在 origin | img-src |

---

## 方式 C：本地 Worker + 本地主题（连后端一起调）

```bash
git clone https://github.com/huilang-me/CF-Server-Monitor.git
cd CF-Server-Monitor
npm install
npm run dev
# 首次访问 https://localhost:8787 让它初始化 D1 表结构
```

需要模拟数据时（可选）：

```bash
node test/generate-sql.js
npx wrangler d1 execute server-monitor-db --file=test/mock-data.sql
```

主题侧：

```bash
cd cf-monitor-theme-glassmorphism
API_BASE=https://localhost:8787 npm run dev
```

- 自签证书：先在浏览器打开一次 `https://localhost:8787` 并选择继续，或在 `wrangler.toml` 的 `[dev]` 里把 `local_protocol` 临时改成 `"http"`，主题改用 `API_BASE=http://localhost:8787`。
- 同样需要在 Worker 侧把 `http://127.0.0.1:5173` 加入 `CORS_ALLOWED_ORIGINS`（本地 `wrangler.toml` 的 `[vars]` 或 `.dev.vars` 都可以）。
- 本地后台：`http://localhost:8787/admin#/admin`。

### 让本地 Worker 反代你的主题（可选的“同源版”）

`wrangler.toml` 的 `[assets] directory = "./dist"` 指向 Worker 自己的前端产物。想在本机模拟方式 A 的同源效果，可以：

1. `npm run build` 生成主题 `dist/`；
2. 把主题的 `index.html` + `assets/` 覆盖到 CF-Server-Monitor 的 `dist/`（保留其 `admin` 相关文件，具体以该仓库构建脚本为准）；
3. `npm run dev` 后直接访问 `https://localhost:8787/`。

这样调试的是「同源反代」路径，和线上一致；缺点是每次改主题都要重新复制产物，日常仍建议方式 B。

---

## 联调验收清单（真实 Worker）

打开 DevTools → Network 与 WS 面板，逐条核对：

- [ ] 首页：`/api/config`、`/api/servers` 各只有 **1 条** 请求；之后数值变化来自 `/api/ws` 的 `batchUpdate`，不再出现周期性 REST。
- [ ] 切到详情页：只发 `GET /api/server?id=` 与 `GET /api/history/all?id=&hours=0.167`；WS 变成 `?subscribe=<id>`（不再是 all）。
- [ ] 在详情页切换「1 天」：只新增 1 条 `history/all`；负载图与延迟图共用这一份数据。
- [ ] 未登录时时间范围最多到 24 小时；超过 24 小时的档位不出现（后端对匿名 `hours>24` 返回 401）。
- [ ] 直接刷新 `/#/server/<id>`：Network 里 **没有** `/api/servers`。
- [ ] 切到别的标签页再回来：WS 断开重连，`/api/servers` 补 1 次。
- [ ] 卡片延迟小图有数据，Network 里 **没有** 针对每台机器的 `history/all`。
- [ ] 延迟线路：未配置的线路不显示，超时显示「超时」，0% 丢包正常显示。
- [ ] 页脚 `Powered by CF Server Monitor` 链接正确，悬停能看到 `/api/config` 的 `version`。
- [ ] 国旗与 OS 图标 200；控制台没有 CSP / CORS 报错。
- [ ] 四种组合：公开/私有 × Turnstile 开/关，均无刷新循环、无反复验证。

---

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 控制台 `blocked by CORS policy` | `CORS_ALLOWED_ORIGINS` 未包含主题 origin，或改了没重新部署；注意纯 origin、无结尾 `/` |
| 私有站一直跳 `/admin` | 跨域时主题域没有 `jwt_token`；按方式 B 第 2 步手动写入，或改用方式 A 同源反代 |
| WS 连上但立刻断开 | 私有站跨域缺 `token`（应从 localStorage 有值）；或 Worker 域名与页面协议不一致（https 页面连 wss） |
| Turnstile 反复出现 / 不通过 | widget hostname 未包含当前域名；清掉 `localStorage.turnstile_verified` 后重试 |
| 图标全是空白 | 后端 CSP 拦了 `https://api.iconify.design`；在后台 CSP 白名单补 connect-src |
| 背景图不显示 | 后端 CSP img-src 未放行图片 origin；或纯静态构建没注入 `BACKGROUND_IMAGE` |
| 主题更新后样式没变 | Worker 反代有缓存；在主题面板重新应用/预览，或硬刷新；确认 `dist` 分支最新提交已推送 |
| 401 / 403 后页面卡住 | 主题会清凭证并跳登录或重新验证；若未跳转，看是否被浏览器拦截了 `location.assign` |

---

## 清理本地调试状态

```js
localStorage.removeItem('jwt_token')
localStorage.removeItem('turnstile_verified')
localStorage.removeItem('turnstile_token')
```

主题的站点级设置存在后端 `theme_options`（`POST /api/theme_options`），不依赖本地存储；本地调试改了设置会直接影响线上，验收前建议导出一次配置或记录默认值。
