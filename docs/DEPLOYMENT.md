# 生产部署与回滚指南（S6）

> 适用版本：v0.30.x。开发环境见根目录 [README](../README.md)，功能总纲见 [DEVELOPMENT-MASTER-PLAN](DEVELOPMENT-MASTER-PLAN.md)。

## 1. 部署形态与硬性约束

| 进程 | 技术栈 | 启动命令 | 端口 |
| --- | --- | --- | --- |
| Web（医生端 + 运营后台 + API） | Next.js 15 / Node 20+ | `npm run start --workspace apps/web` | 3000 |
| AI（大模型路由 / 科研技能 / 数字人 / 合规预审） | FastAPI / Python 3.11+ | `uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2` | 8000 |

- **必须部署为常驻 Node 进程**（`next start`、PM2 / systemd / 容器均可）。禁止部署到纯 Serverless（Vercel Functions、云函数）：任务执行是「响应返回后在进程内异步跑完」的模式（`runTask` fire-and-forget），函数被冻结会中断任务且不回滚积分。
- **单实例起步**。多实例/弹性伸缩前必须先接入队列（BullMQ + Redis）并把 `runTask` 改为消费者，否则任务可能在不同实例间丢失。
- **AI 服务只对 Web 内网开放**：浏览器不直连 8000，全部经 Web 的 `/api/ai/*` 代理与 `AI_SERVICE_URL` 内网调用。
- 健康检查：`GET /api/health`（Web，内部会探测 AI）、`GET /api/health`（AI 直连）。

## 2. 环境变量清单

### 2.1 Web（`apps/web/.env`，模板 `apps/web/.env.example`）

| 变量 | 必填 | 生产取值与说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 生产改为 `postgresql://user:pass@host:5432/medbuddy?schema=public` |
| `AUTH_SECRET` | 是 | ≥16 字符强随机（`openssl rand -base64 32`）；缺失时登录直接抛错，不会裸奔 |
| `SMS_PROVIDER` | 是 | 生产填 `aliyun`；`dev` 仅联调（验证码直接返回页面） |
| `ALIYUN_SMS_*` | 条件 | `SMS_PROVIDER=aliyun` 时必填：ACCESS_KEY_ID / ACCESS_KEY_SECRET / SIGN_NAME / TEMPLATE_CODE（模板需含 `${code}`），REGION 默认 `cn-hangzhou`；未配置或发送失败会明确报错，不会静默收不到码 |
| `AI_SERVICE_URL` | 是 | 内网地址，如 `http://127.0.0.1:8000` 或 `http://ai:8000` |
| `ADMIN_PHONES` | 是 | 运营后台管理员手机号白名单，逗号分隔；登录时自动提权 |
| `PAYMENT_PROVIDER` | 是 | `wechat` / `alipay`；生产下 `mock` 会被禁用 |
| `PUBLIC_BASE_URL` | 是 | 公网 HTTPS 域名，用于支付回调兜底（`https://你的域名`） |
| `WECHAT_PAY_*` | 条件 | 走微信支付时必填：APPID / MCHID / SERIAL_NO / PRIVATE_KEY / API_V3_KEY / PLATFORM_CERT / NOTIFY_URL |
| `ALIPAY_*` | 条件 | 走支付宝时必填：APP_ID / PRIVATE_KEY / PUBLIC_KEY / NOTIFY_URL |

### 2.2 AI（`apps/ai/.env`，模板 `apps/ai/.env.example`）

| 变量 | 必填 | 生产取值与说明 |
| --- | --- | --- |
| `ENV` | 是 | `prod` |
| `CORS_ORIGINS` | 是 | 正式域名列表，JSON 数组：`["https://你的域名"]` |
| `LLM_PROVIDER` | 是 | `auto`（按已配置 Key 路由）或固定 `deepseek` / `qwen` / `glm` |
| `LLM_MODEL` | 否 | 留空用服务商默认模型；填了只覆盖全局服务商 |
| `DEEPSEEK_API_KEY` / `QWEN_API_KEY` / `GLM_API_KEY` | 至少 1 个 | 三选一起步；全部缺失时服务降级为 mock 占位回复 |
| `PUBMED_API_KEY` / `PUBMED_EMAIL` | 建议 | NCBI 提升到 10 req/s，并在高峰期优先放行 |
| `AVATAR_PROVIDER` | 否 | `auto` / `zhiying` / `silicon` / `mock`；无 Key 时只产脚本与任务单 |
| `AVATAR_ZHIYING_*` / `AVATAR_SILICON_*` | 条件 | 数字人合成供应商地址与 Key |

> **注意**：操作系统/容器若已存在同名变量（如 `DEEPSEEK_API_KEY`），其优先级高于 `.env`。上线前确认运行环境里没有残留旧 Key，否则会出现「配置了却仍 401」。
> 密钥只放环境变量，不入库、不进代码库（`.env` 已被 gitignore）。

## 3. 构建与发布步骤

```bash
# 1) 关闭正在运行的 dev server，保证 .next 不被占用
# 2) 安装依赖并生成 Prisma Client
npm ci
npm exec --workspace apps/web prisma generate

# 3) 数据库结构同步（首次上线；见 §4）
npm run db:push

# 4) 生产构建（Next 构建会做类型检查与路由校验）
npm run build --workspace apps/web

# 5) 启动
npm run start --workspace apps/web          # 3000
cd apps/ai && uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
```

构建产物校验：`apps/web/.next/BUILD_ID` 存在且非空；构建日志无 error。

### Nginx 反代要点

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;        # 数字人 SSE 逐字输出
  proxy_read_timeout 300s;    # 任务追问/长回答
}
```

- 只需暴露 3000；8000 不做公网映射。
- 强制 HTTPS：生产会话 cookie 带 `Secure`，纯 HTTP 登录会失败。

## 4. 数据库：SQLite → PostgreSQL

### 4.1 切换步骤

1. 改 `apps/web/prisma/schema.prisma`：`provider = "postgresql"`。
2. 设 `DATABASE_URL="postgresql://..."`。
3. `npm run db:push`（首次建表）。
4. 重启 Web 服务，跑一遍冒烟（登录 → 提交任务 → 审核通过 → 回款/退款）。

### 4.2 兼容性结论（已静态核对）

- 模型只使用 `String / Int / Boolean / DateTime`，**无** `Json`、`Decimal`、`BigInt`、`Bytes` 或 `@db.*` 方言属性；状态字段统一存字符串，无原生 enum，可直接迁移。
- 代码中**无** `$queryRaw` / `$executeRaw` / PRAGMA 等方言 SQL；全部走 Prisma Client。
- 唯一行为差异：管理后台按手机号/姓名/医院模糊搜索使用 `contains`，PostgreSQL 下区分大小写；手机号为数字、姓名/医院为中文，实际无影响（如需英文忽略大小写，上线后再加 `mode: "insensitive"`）。
- 演示数据不迁移：上线使用空库；若必须带本地数据，另行编写导入脚本，不在本次范围。

### 4.3 备份

- 发布前对生产库做一次全量备份（`pg_dump -Fc`），保留最近 7 天。
- 财务相关表（`CreditLedger`、`RechargeOrder`、`MembershipOrder`）**只允许冲正，不允许物理回滚**。

## 5. 上线前阻塞项（未完成不要对外放量）

1. **短信通道需配置真实账号**：阿里云 SMS 适配器已就绪（`apps/web/src/lib/sms/aliyun.ts`，`SMS_PROVIDER=aliyun`）。上线前需在阿里云开通短信服务、过审签名与模板（模板含 `${code}`），并配置 `ALIYUN_SMS_*`；未配置会返回 503 明确报错，发送失败返回 502，不再静默吞码。
2. **支付必须配置真实渠道**：生产环境 `mock` 支付通道被禁用（下单会报错），未配置微信/支付宝商户号时充值/会员购买不可用。
3. **多实例前先接队列**：当前任务执行绑定单个 Node 进程，重启/扩缩容会丢失在途任务。

### 在途任务丢失的运维处置

发布重启后，`RUNNING` 状态任务会停住。确认后按下面顺序处理（示例为 Prisma Studio 或 SQL）：

1. `SELECT id, "userId", "creditCost" FROM "Task" WHERE status = 'running';`
2. 逐个核对：`UPDATE "Task" SET status = 'failed', "failReason" = '发布重启导致执行中断' WHERE id = ?;`
3. 在同事务内把 `creditCost` 退回 `CreditAccount.balance`，并写一条 `CreditLedger`（`type = 'REFUND'`，`balanceAfter` 为退款后余额）。
4. 通知提交医生，让其重新提交。

## 6. 发布检查清单

- [ ] `AUTH_SECRET` 已换为强随机值（非 `dev-only-secret-key-change-in-prod`）
- [ ] `DATABASE_URL` 指向生产库，且已完成备份
- [ ] 短信通道可真实收码（阻塞项 1）
- [ ] 至少一个 LLM Key 有效，`GET /api/llm/status` 返回 `configured: true`
- [ ] 支付渠道商户号/证书已配置，回调域名公网可达且验签通过
- [ ] `ADMIN_PHONES` 已配置，运营后台可登录
- [ ] `ENV=prod`、`CORS_ORIGINS` 为正式域名
- [ ] HTTPS 生效，登录后 cookie 带 `Secure`
- [ ] `GET /api/health` 与 AI `GET /api/health` 均为 ok
- [ ] 关闭 dev 调试输出：确认生产未开 `next dev`、未启用 mock 数字人

## 7. 回滚流程

1. **代码回滚**：切回上一个稳定 tag（如 `git checkout v0.29.0`）→ `npm ci` → `npm run build --workspace apps/web` → 重启 Web 与 AI。
2. **数据库**：本次发布若只做 `db:push` 新增字段（如 `Task.model` 有默认值），回滚旧代码可继续运行；若含破坏性变更（删列/改类型），必须用 §4.3 备份恢复，且恢复前先导出增量业务数据（订单/流水/任务）。
3. **支付回调**：回滚期间支付渠道仍可能回调，回调接口必须保持向后兼容；若新版本改了回调路径，先在渠道后台改回旧地址，再回滚服务。
4. **验证**：回滚后重跑 `scripts/acceptance.py` 的核心段（至少 [4]–[10]、[13]–[15]），并抽查一条真实任务全链路。
5. **记录**：在总纲「S6 上线」条目下记录回滚原因、时间窗与影响面。
