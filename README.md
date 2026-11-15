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

> 开发环境变量：复制 `apps/web/.env.example` 为 `apps/web/.env`（AUTH_SECRET / SMS_PROVIDER 等）。

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
```

必须部署为常驻 Node 进程（不可用 Serverless），AI 服务仅内网开放。环境变量清单、SQLite→PostgreSQL 切换、上线前阻塞项与回滚流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 开发约定

- 每张任务卡一个分支，squash merge 到 main
- 提交信息：`feat|fix|docs: 描述`
- 三关验收才可合入：lint+测试绿、AI 代码抽检、人工冒烟
- 密钥只放 `.env`（已 gitignore），不入库
