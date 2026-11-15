# 生产部署与回滚指南（S6）

> 适用版本：v0.31.x。开发环境见根目录 [README](../README.md)，功能总纲见 [DEVELOPMENT-MASTER-PLAN](DEVELOPMENT-MASTER-PLAN.md)。

## 1. 部署形态与硬性约束

| 组件 | 技术栈 | 启动命令 | 默认端口 |
| --- | --- | --- | --- |
| Web（医生端 + 运营后台 + API） | Next.js 15 / Node 20+ | `npm run start --workspace apps/web` | 3000 |
| 任务 worker | Node 20+ / BullMQ 6 / tsx | `npm run worker` | 无 |
| AI（大模型路由 / 科研技能 / 数字人 / 合规预审） | FastAPI / Python 3.11+ | `uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2` | 8000 |
| Redis（任务队列） | Redis 7（推荐） | 由 systemd / 容器 / 托管服务运行 | 6379 |

- **生产使用 `TASK_QUEUE_DRIVER=bullmq`**。Web 只负责扣费与入队，独立 worker 负责技能执行、审核前落库和失败补偿。`inline` 仅用于单实例本地开发。
- Web 与 worker **都必须部署为常驻 Node 进程**（`next start`、PM2 / systemd / 容器均可），禁止部署到纯 Serverless / 云函数。函数冻结会中断任务，并破坏 worker 的持续消费与失败补偿。
- 多 Web / 多 worker 前必须使用 PostgreSQL，并在目标环境完成并发确认、重复投递、故障恢复和积分流水专项验收；本机 SQLite 验收不能替代该步骤。
- **AI 与 Redis 只对内网开放**：浏览器不直连 8000/6379。AI 请求经 Web 的 `/api/ai/*` 代理或服务端 `AI_SERVICE_URL` 调用。
- 健康检查：`GET /api/health`（Web，内部探测 AI）、`GET /api/health`（AI 直连）。Web 返回的 `taskQueue` 只表示配置的驱动名称，不代表 Redis 或 worker 健康；必须另行监控 Redis、worker 进程和队列积压。

## 2. 环境变量清单

### 2.1 Web 与 worker（`apps/web/.env`，模板 `apps/web/.env.example`）

| 变量 | 必填 | 生产取值与说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 生产改为 `postgresql://user:pass@host:5432/medbuddy?schema=public` |
| `AUTH_SECRET` | 是 | ≥16 字符强随机（`openssl rand -base64 32`）；缺失时登录直接抛错，不会裸奔 |
| `SMS_PROVIDER` | 是 | 生产填 `aliyun`；`dev` 仅联调（验证码直接返回页面） |
| `ALIYUN_SMS_*` | 条件 | `SMS_PROVIDER=aliyun` 时必填：ACCESS_KEY_ID / ACCESS_KEY_SECRET / SIGN_NAME / TEMPLATE_CODE（模板需含 `${code}`），REGION 默认 `cn-hangzhou`；未配置或发送失败会明确报错，不会静默收不到码 |
| `AI_SERVICE_URL` | 是 | 内网地址，如 `http://127.0.0.1:8000` 或 `http://ai:8000` |
| `TASK_QUEUE_DRIVER` | 是 | 生产填 `bullmq`；Redis 故障会明确失败并退款，绝不静默回退 `inline` |
| `REDIS_URL` | 是 | BullMQ 模式的 Redis 连接串，如 `rediss://:password@redis.internal:6379/0`；Web 与 worker 必须一致 |
| `TASK_WORKER_CONCURRENCY` | 否 | 单 worker 并发数，默认 `2`；根据 AI 服务容量与第三方限流调整 |
| `ADMIN_PHONES` | 是 | 运营后台管理员手机号白名单，逗号分隔；登录时自动提权 |
| `PAYMENT_PROVIDER` | 是 | `wechat` / `alipay`；生产下 `mock` 会被禁用 |
| `PUBLIC_BASE_URL` | 是 | 公网 HTTPS 域名，用于支付回调兜底（`https://你的域名`） |
| `WECHAT_PAY_*` | 条件 | 走微信支付时必填：APPID / MCHID / SERIAL_NO / PRIVATE_KEY / API_V3_KEY / PLATFORM_CERT / NOTIFY_URL |
| `ALIPAY_*` | 条件 | 走支付宝时必填：APP_ID / PRIVATE_KEY / PUBLIC_KEY / NOTIFY_URL |

> worker 启动时读取同一份 `apps/web/.env`，系统环境变量优先。除队列配置外，worker 至少还需要正确的 `DATABASE_URL`、`AI_SERVICE_URL` 及任务执行所需配置。Web 与 worker 的环境必须同步发布。

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

> **注意**：操作系统/容器若已存在同名变量（如 `DEEPSEEK_API_KEY`），其优先级高于 `.env`。上线前确认运行环境里没有残留旧 Key，否则会出现「配置了却仍 401」。密钥只放环境变量，不入库、不进代码库（`.env` 已被 gitignore）。

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

# 5) 分别启动常驻进程
npm run start --workspace apps/web          # Web，3000
npm run worker                              # BullMQ worker，独立终端/进程
cd apps/ai && uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
```

构建产物校验：`apps/web/.next/BUILD_ID` 存在且非空；构建日志无 error。worker 使用源码与 `tsx` 运行，发布时必须包含 `apps/web/src/workers`、`apps/web/src/lib`、`packages/shared` 和生产依赖，不能只复制 `.next`。

### Redis 最低配置

```conf
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```

- Redis 开启 AOF 持久化并设置 `noeviction`，避免内存压力把等待任务静默淘汰。生产还应配置密码/TLS、内网访问控制、容量告警与持久化备份。
- 禁止对队列库执行 `FLUSHDB` / `FLUSHALL`。保留最近 1000 条完成及失败任务用于审计和失败补偿，清理策略调整前须评估运维影响。
- worker 接收 `SIGTERM` / `SIGINT` 后会停止领取新任务并等待活动任务结束。进程管理器的停止宽限期应大于最长任务执行时间；强制 kill 会走 stalled 失败补偿，不会自动重放任务。

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

- 只需暴露 3000；8000 与 6379 不做公网映射。
- 强制 HTTPS：生产会话 cookie 带 `Secure`，纯 HTTP 登录会失败。

## 4. 数据库：SQLite → PostgreSQL

### 4.1 切换步骤

1. 改 `apps/web/prisma/schema.prisma`：`provider = "postgresql"`。
2. 设 `DATABASE_URL="postgresql://..."`。
3. `npm run db:push`（首次建表）。
4. 同步重启 Web 与 worker，跑一遍冒烟（登录 → 提交任务 → 审核通过 → 回款/退款）。

### 4.2 兼容性结论（已静态核对）

- 模型只使用 `String / Int / Boolean / DateTime`，**无** `Json`、`Decimal`、`BigInt`、`Bytes` 或 `@db.*` 方言属性；状态字段统一存字符串，无原生 enum，可直接迁移。
- 代码中**无** `$queryRaw` / `$executeRaw` / PRAGMA 等方言 SQL；全部走 Prisma Client。
- 唯一行为差异：管理后台按手机号/姓名/医院模糊搜索使用 `contains`，PostgreSQL 下区分大小写；手机号为数字、姓名/医院为中文，实际无影响（如需英文忽略大小写，上线后再加 `mode: "insensitive"`）。
- 演示数据不迁移：上线使用空库；若必须带本地数据，另行编写导入脚本，不在本次范围。
- 本次队列改造不新增数据库 migration：复用 `Task.startedAt` 保存执行代次 token。多实例并发行为仍须在 PostgreSQL 目标环境实测。

### 4.3 备份

- 发布前对生产库做一次全量备份（`pg_dump -Fc`），保留最近 7 天。
- 财务相关表（`CreditLedger`、`RechargeOrder`、`MembershipOrder`）**只允许冲正，不允许物理回滚**。

## 5. 队列语义与故障处置

### 5.1 防重与退款

- 队列名为 `medbuddy-tasks`，jobId 为 `task_<taskId>_<phase>`；同一执行阶段重复入队由 BullMQ 去重。
- 数据库条件更新是最终防线：调度、领取、完成和失败都校验任务状态与 `startedAt` 中的执行代次 token，迟到 worker 不能覆盖新状态。
- PLAN 确认在扣费事务内先抢占 `PLAN_READY → QUEUED`，并发请求只有一个赢家；数字人 `AvatarJob` 与任务进入审核状态在同一事务写入。
- 每个 job `attempts=1`、`maxStalledCount=0`。已领取任务失败后**不自动重放**，避免第三方技能产生重复副作用。
- worker 监听全局 failed 事件，并在启动时补扫最近 1000 条 failed jobs。只有失败状态条件更新的赢家可以退款并写一条 `REFUND` 流水，重复补偿幂等。

### 5.2 故障表现

| 场景 | 预期行为 | 运维动作 |
| --- | --- | --- |
| Web 入队时 Redis 不可达 | 创建/确认返回 503，任务置 FAILED；已扣积分自动退还 | 修复 Redis 后让医生重新提交；不得切换 inline 掩盖故障 |
| worker 停止、Redis 正常 | 等待任务保留在队列，扣费不重复 | 重启 worker 后继续消费 |
| Redis 按持久化配置重启 | 等待任务从 AOF 恢复 | 确认 worker 与 Web 重连，检查积压 |
| worker 崩溃 / 被强制 kill | 活动 job 变为 stalled 后失败，不自动重放；替换 worker 触发一次失败补偿 | 核对第三方是否已产生副作用，再决定是否人工重新提交 |
| 入队超时但 Redis 迟到接收 | 数据库任务已失败，迟到 job 因 token/状态不匹配直接跳过 | 无需重复退款；检查 Redis 延迟与容量 |

### 5.3 在途任务人工核对

1. 先冻结发布动作并保留现场，不要在 `RUNNING` 时直接手工退款或重新入队。
2. 同时核对数据库任务状态、`startedAt`、BullMQ job 状态、worker 日志及第三方供应商任务单。
3. 等待任务仍在队列时，恢复 Redis/worker 即可；failed job 的积分由补偿逻辑幂等处理。
4. 若队列数据不可恢复或第三方执行结果不确定，停止相关 worker 后逐任务人工核对；确需失败退款时，在**同一数据库事务**内做当前代次条件更新、余额冲正和唯一 `REFUND` 流水，并通知提交医生。
5. 未经核对不得重放数字人合成、支付或其他有外部副作用的任务。

## 6. 上线前阻塞项（未完成不要对外放量）

1. **短信通道需配置真实账号**：阿里云 SMS 适配器已就绪（`apps/web/src/lib/sms/aliyun.ts`，`SMS_PROVIDER=aliyun`）。上线前需在阿里云开通短信服务、过审签名与模板（模板含 `${code}`），并配置 `ALIYUN_SMS_*`；未配置会返回 503 明确报错，发送失败返回 502，不再静默吞码。
2. **支付需配置真实商户**：微信 v3 Native 与支付宝 RSA2 适配器已就绪，生产环境 `mock` 支付通道被禁用，未配置真实渠道时下单返回 503。已用本地一次性 RSA/AES 密钥完成 9 项验证（支付宝签名下单、验签入账、重复回调幂等与篡改拒绝；微信验签、AES-GCM 解密与篡改拒绝），未产生真实扣款。上线前仍须配置真实商户号/证书和公网 HTTPS 回调，并完成小额真实支付、退款与回调实测。
3. **生产队列与多实例需目标环境验收**：本机已用真实 Redis 7 验证 BullMQ 入队失败退款、等待任务跨 Redis/worker 重启恢复、迟到投递隔离及 stalled 单次补偿；尚未替代生产 Redis 高可用、真实 SIGTERM 停机和多 Web + PostgreSQL 验收。放量前必须部署常驻 worker，验证 Redis 持久化/故障切换与进程停止，并在 PostgreSQL 上重跑并发和财务一致性专项。

## 7. 发布检查清单

- [ ] `AUTH_SECRET` 已换为强随机值（非 `dev-only-secret-key-change-in-prod`）
- [ ] `DATABASE_URL` 指向生产 PostgreSQL，且已完成备份
- [ ] `TASK_QUEUE_DRIVER=bullmq`，Web 与 worker 的 `REDIS_URL` / 数据库 / AI 地址一致
- [ ] Redis 已启用 AOF、`noeviction`、认证/TLS、内网访问控制与容量告警
- [ ] 至少一个常驻 worker 正常运行，已实测等待任务恢复、失败补偿与进程停止
- [ ] 多实例部署已在目标 PostgreSQL 环境完成并发、故障恢复和积分流水验收
- [ ] 短信通道可真实收码（阻塞项 1）
- [ ] 至少一个 LLM Key 有效，`GET /api/llm/status` 返回 `configured: true`
- [ ] 支付渠道商户号/证书已配置，回调域名公网可达且验签通过
- [ ] `ADMIN_PHONES` 已配置，运营后台可登录
- [ ] `ENV=prod`、`CORS_ORIGINS` 为正式域名
- [ ] HTTPS 生效，登录后 cookie 带 `Secure`
- [ ] `GET /api/health` 与 AI `GET /api/health` 均为 ok；另行确认 Redis 与 worker 健康
- [ ] 关闭 dev 调试输出：确认生产未开 `next dev`、未启用 mock 数字人

## 8. 回滚流程

1. **先停止领取新任务**：暂停 Web 创建/确认入口，向 worker 发送停止信号并等待活动任务结束。等待任务应处理完毕，或按 §5.3 逐条核对后再回滚；旧版本不会消费 BullMQ 等待任务。
2. **代码回滚**：切回上一个稳定 tag（如 `git checkout v0.30.1`）→ `npm ci` → `npm exec --workspace apps/web prisma generate` → `npm run build --workspace apps/web` → 重启 Web 与 AI。回滚到 v0.30.x 后不再运行 worker，且只能恢复单 Web 常驻进程模式。
3. **数据库**：本次队列改造无 schema 变更，旧代码可继续使用同一数据库；财务流水只允许冲正，不允许物理回滚。其他发布若含破坏性变更，必须用 §4.3 备份恢复，且恢复前先导出增量业务数据（订单/流水/任务）。
4. **Redis**：保留队列数据与 failed jobs 直至核对完成，不因代码回滚直接清空。再次升级前，先确认旧等待任务不会与新版本状态/执行代次冲突。
5. **支付回调**：回滚期间支付渠道仍可能回调，回调接口必须保持向后兼容；若新版本改了回调路径，先在渠道后台改回旧地址，再回滚服务。
6. **验证**：回滚后重跑 `scripts/acceptance.py` 的核心段（至少 [4]–[10]、[13]–[15]），并抽查一条真实任务全链路。
7. **记录**：在总纲「S6 上线」条目下记录回滚原因、时间窗与影响面。
