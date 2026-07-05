# iLink-Router · WeChat Clawbot Router

> 微信扫码绑定路由 · 多上游渠道聚合转发 · `!switch` / `!info` / `!status` / `!ping` 命令

`iLink-Router` 是一个基于 **Next.js 14 + @wechatbot/wechatbot + Prisma** 的微信机器人路由系统。一个微信账号作为「路由入口」，用户向该账号发消息，路由根据当前会话绑定的「上游渠道」把消息转发出去，再把上游的回复发回给用户。

底层使用官方 [iLink 协议](https://www.wechatbot.dev/zh/protocol)（微信原生 ClawBot HTTP/JSON API），由 [`@wechatbot/wechatbot`](https://www.npmjs.com/package/@wechatbot/wechatbot) SDK 实现 QR 扫码登录、长轮询收消息、context_token 回复等全部能力。

## ✨ 特性

- 📱 **手机扫码绑定** — 启动路由后用手机微信扫码登录微信账号（iLink 原生 QR 流程）
- 🔌 **多上游绑定** — 任意数量的 HTTP webhook 上游，可任意切换
- 💬 **会话切换** — `!switch <别名>` 即可切换当前会话使用的上游
- 📊 **状态查询** — `!info` 查会话信息，`!status` 查路由和各渠道健康
- 🏓 **在线检查** — `!ping` 路由直接回复 `pong!`
- 🗄️ **多数据库** — SQLite / PostgreSQL / MySQL 任选，Prisma 驱动
- 🎨 **管理面板** — Next.js + React + Tailwind，绑定渠道、查会话、看消息
- 🔁 **同步 / 异步转发** — 上游可同步返回，也可稍后回调 `/api/inbound`
- 🔐 **凭据自动持久化** — iLink bot_token 存储到 `~/.wechatbot/credentials.json`，重启免扫码

## 🏗 架构

```
                ┌─────────────────────────┐
   WeChat       │  iLink-Router           │
   User  ───────►  (@wechatbot/wechatbot) │
 (手机扫码绑定) │        │                │
                │        ▼                │
                │  !cmd  → 命令处理       │
                │  text  → 当前会话渠道    │
                │        │                │
                └────────┼────────────────┘
                         │ POST webhook
                         ▼
              ┌─────────────────────┐
              │  Upstream Channel   │
              │ (其他微信机器人/LLM) │
              └─────────────────────┘
```

## 🚀 快速开始

> 需 Node.js 22+（`@wechatbot/wechatbot` 要求）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

默认使用 SQLite，零配置即可运行：

```env
DATABASE_URL="file:./dev.db"
ILINK_BASE_URL="https://ilinkai.weixin.qq.com"
ILINK_STORAGE_DIR="~/.wechatbot"
ILINK_LOG_LEVEL="info"
COMMAND_PREFIX="!"
```

### 3. 选择数据库

默认使用 SQLite，零配置即可运行：

```env
# .env
DATABASE_URL="file:./dev.db"
```

切换到 PostgreSQL / MySQL 需同时修改 `prisma/schema.prisma` 的 `provider` 行（Prisma 不支持 env 切换 provider）和 `.env`：

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"   // 改这里: sqlite / postgresql / mysql
  url      = env("DATABASE_URL")
}
```

```env
# .env
DATABASE_URL="postgresql://user:pass@localhost:5432/ilink?schema=public"
```

### 4. 初始化数据库

```bash
npm run db:push      # 创建表结构 (推荐，SQLite/首次)
# 或
npm run db:migrate   # 创建迁移 (PostgreSQL/MySQL 生产推荐)
```

### 5. 启动服务

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 📲 绑定路由

1. 打开 [http://localhost:3000/router](http://localhost:3000/router)
2. 点击「**启动路由**」
3. 用手机微信扫描页面上的二维码（iLink QR 登录流程）
4. 等待状态变为「已登录」（SDK 自动持久化凭据，下次启动免扫码）
5. 在「[渠道](http://localhost:3000/channels)」页面绑定上游

## 💬 用户命令

用户向路由账号发送以下命令即可触发对应功能（前缀默认 `!`，可在 `.env` 中通过 `COMMAND_PREFIX` 自定义）：

| 命令 | 说明 |
| --- | --- |
| `!ping` | 检查路由是否在线 — 路由直接回复 `pong!` |
| `!switch <别名>` | 将当前会话切换到指定上游渠道 |
| `!info` | 显示当前渠道、对话数等会话信息 |
| `!status` | 查询路由系统状态和各渠道健康度 |
| `!channels` | 列出所有可用渠道 |
| `!help` | 显示命令帮助 |

示例对话：

```
用户: !ping
路由: pong!

用户: !channels
路由: 📡 可用渠道
     ─────────
     1. gpt4 — GPT-4 Turbo (默认)
     2. claude — Claude 3 Opus
     3. deepseek — DeepSeek Chat

用户: !switch claude
路由: ✅ 已切换到渠道「Claude 3 Opus」(claude)

用户: 你好
路由: (来自 claude 渠道的回复)

用户: !info
路由: 📊 会话信息
     ─────────
     用户: 张三
     当前渠道: Claude 3 Opus (claude)
     消息总数: 12 (收 6 / 发 6)
```

## 🔌 上游渠道协议

每个渠道通过 HTTP webhook 接收路由转发来的消息：

```http
POST <channel.webhookUrl>
Content-Type: application/json
X-ILink-Channel: <channel.alias>
X-ILink-Key: <channel.apiKey>
X-ILink-Router-Secret: <UPSTREAM_WEBHOOK_SECRET>

{
  "sessionId": "cuid...",
  "userId": "wxid_xxx",
  "userName": "张三",
  "message": "你好",
  "receivedAt": "2026-07-05T12:34:56.789Z",
  "channelAlias": "gpt4",
  "history": [
    { "role": "user", "text": "...", "ts": "..." },
    { "role": "assistant", "text": "...", "ts": "..." }
  ]
}
```

### 同步响应

最简单的方式 — 上游在 HTTP 响应里直接返回回复：

```json
{ "reply": "你好，我是 GPT-4 Turbo，有什么可以帮你？" }
```

### 异步回调

上游也可以稍后通过 `/api/inbound` 把回复推回来：

```http
POST /api/inbound
Content-Type: application/json
X-ILink-Router-Secret: <UPSTREAM_WEBHOOK_SECRET>

{
  "sessionId": "cuid...",
  "reply": "稍后处理的结果..."
}
```

这适合本身是另一个微信机器人的上游 — 它收到转发后，通过自己的渠道完成对话，再异步回传。

## 🛠 API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/router/status` | 路由状态 |
| POST | `/api/router/status` | 控制 (`{action: start\|stop\|reset}`) |
| GET | `/api/qr?format=dataurl\|text\|png` | 当前扫码二维码 |
| GET | `/api/channels` | 渠道列表 |
| POST | `/api/channels` | 创建渠道 |
| GET/PATCH/DELETE | `/api/channels/[id]` | 单个渠道 CRUD |
| POST | `/api/channels/[id]/test` | 测试渠道可达性 |
| GET | `/api/sessions?search=` | 会话列表 |
| GET/DELETE | `/api/sessions/[id]` | 会话详情 + 消息 |
| GET | `/api/messages?kind=&direction=` | 消息日志 |
| POST | `/api/inbound` | 上游异步回传 |
| GET | `/api/stats` | 仪表盘统计 |

设置 `ADMIN_TOKEN` 后，所有 `/api/*` (除 `/api/qr`) 需携带 `Authorization: Bearer <token>`。

## 🐳 生产部署

```bash
npm run build
npm start
```

建议：
- 配置 `ADMIN_TOKEN` 保护管理 API
- 配置 `UPSTREAM_WEBHOOK_SECRET` 让上游验证请求来源
- 数据库使用 PostgreSQL
- 用 PM2 / systemd 守护进程，路由进程需长驻（iLink 长轮询）

## 📁 项目结构

```
iLink-Router/
├── prisma/
│   └── schema.prisma           # 多数据库 schema
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API 路由
│   │   ├── router/             # 路由控制页 (扫码绑定)
│   │   ├── channels/           # 渠道管理页
│   │   ├── sessions/           # 会话列表 + 详情
│   │   ├── messages/           # 消息日志
│   │   ├── settings/           # 设置
│   │   └── page.tsx             # 仪表盘
│   ├── components/
│   │   ├── ui/                  # 基础组件 (Button/Card/...)
│   │   └── sidebar.tsx
│   └── lib/
│       ├── config.ts            # 环境配置
│       ├── db.ts                # Prisma 单例
│       ├── router.ts            # iLink 路由核心 (@wechatbot/wechatbot)
│       ├── commands.ts          # 命令处理
│       ├── forwarder.ts         # 上游转发
│       ├── sessions.ts          # 会话辅助
│       ├── auth.ts              # Admin token
│       └── utils.ts
├── .env.example
└── package.json
```

## 🔗 相关链接

- **GitHub**: [https://github.com/ZHYxulei/iLink-Router](https://github.com/ZHYxulei/iLink-Router)
- **iLink 协议文档**: [https://www.wechatbot.dev/zh/protocol](https://www.wechatbot.dev/zh/protocol)
- **DeepWiki**: [https://deepwiki.com/corespeed-io/wechatbot](https://deepwiki.com/corespeed-io/wechatbot)
- **SDK**: [`@wechatbot/wechatbot`](https://www.npmjs.com/package/@wechatbot/wechatbot) (Node 22+, 零运行时依赖)

## 📜 License

MIT
