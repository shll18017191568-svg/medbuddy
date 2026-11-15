# MedBuddy 医生智能工作台

面向医生的「AI 数字人 + Agent 任务执行」一站式工作台。开发总纲见 [docs/DEVELOPMENT-MASTER-PLAN.md](docs/DEVELOPMENT-MASTER-PLAN.md)。

## 项目结构（monorepo）

```
medbuddy/
├── apps/
│   ├── web/        # Next.js 15 全栈（医生端 + 运营后台，TypeScript）
│   └── ai/         # FastAPI AI 服务（RAG/文献工具/绘图/Agent 编排）
├── packages/
│   └── shared/     # 共享类型与常量
└── docs/           # 开发总纲与文档
```

## 快速开始

### Web 服务（apps/web）

```bash
npm install
npm run db:push      # 初始化本地 SQLite 数据库（首次）
npm run dev          # http://localhost:3000
```

> 开发环境变量：复制 `apps/web/.env.example` 为 `apps/web/.env`（AUTH_SECRET / SMS_PROVIDER 等）。默认 `TASK_QUEUE_DRIVER=inline`，单实例开发只需 Web + AI。

### 可选：BullMQ 持久化任务队列

需要跨重启恢复等待任务或运行多个 Web 实例时，在 `apps/web/.env` 设置 `TASK_QUEUE_DRIVER=bullmq` 与 `REDIS_URL`，启动 Redis 后另开终端运行：

```bash
npm run worker
```

Web 与 worker 必须共用 `DATABASE_URL`、`AI_SERVICE_URL` 和 Redis 配置。多实例生产环境必须使用 PostgreSQL；SQLite 与 inline 模式仅限单实例。

### AI 服务（apps/ai）

```bash
cd apps/ai
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000   # http://localhost:8000/docs
```

## 生产部署

```bash
npm ci
npm exec --workspace apps/web prisma generate
npm run db:push
npm run build --workspace apps/web
npm run start --workspace apps/web
npm run worker  # BullMQ 模式必须在独立常驻进程中运行
```

生产使用 `TASK_QUEUE_DRIVER=bullmq`，Redis 开启 AOF 与 `noeviction`；Web 与 worker 均为常驻 Node 进程（不可用 Serverless），AI 与 Redis 仅内网开放。多实例必须使用 PostgreSQL。环境变量清单、队列故障语义、SQLite→PostgreSQL 切换、上线前阻塞项与回滚流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 开发约定

- 每张任务卡一个分支，squash merge 到 main
- 提交信息：`feat|fix|docs: 描述`
- 三关验收才可合入：lint+测试绿、AI 代码抽检、人工冒烟
- 密钥只放 `.env`（已 gitignore），不入库
