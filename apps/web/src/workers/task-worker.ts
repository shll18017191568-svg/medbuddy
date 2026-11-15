import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import type { TaskJobData } from "@/lib/task-queue";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  // 必须在加载 Prisma / AI 配置前读取 apps/web/.env；系统环境变量优先。
  config({ path: path.join(webRoot, ".env"), override: false });

  const [{ TASK_QUEUE_NAME }, { executeTask, failTask }, { prisma }] = await Promise.all([
    import("@/lib/task-queue"),
    import("@/lib/task-runner"),
    import("@/lib/prisma"),
  ]);
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<TaskJobData>(TASK_QUEUE_NAME, { connection });
  const queueEvents = new QueueEvents(TASK_QUEUE_NAME, { connection });
  const concurrency = Math.max(1, Number(process.env.TASK_WORKER_CONCURRENCY ?? "2") || 2);
  const worker = new Worker<TaskJobData>(
    TASK_QUEUE_NAME,
    async (job) => {
      await executeTask(job.data.taskId, job.data.phase, job.data.token);
    },
    { connection, concurrency, maxStalledCount: 0 },
  );

  const compensate = async (job: Job<TaskJobData> | undefined, reason: string) => {
    if (!job) return;
    await failTask(job.data.taskId, job.data.token, `worker 执行失败：${reason}`);
  };

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    void queue.getJob(jobId)
      .then((job) => compensate(job, failedReason))
      .catch((err) => console.error("[task-worker/compensate]", err));
  });

  try {
    await Promise.all([worker.waitUntilReady(), queueEvents.waitUntilReady()]);

    // 补扫保留的失败任务，补偿进程停机期间遗漏的失败事件；failTask 自身幂等。
    const failedJobs = await queue.getJobs(["failed"], 0, 999);
    for (const job of failedJobs) {
      await compensate(job, job.failedReason || "启动补扫");
    }
    console.log(`[task-worker] 已启动，并发 ${concurrency}，队列 ${TASK_QUEUE_NAME}`);
  } catch (err) {
    connection.disconnect();
    await prisma.$disconnect();
    throw err;
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log("[task-worker] 正在停止领取新任务并等待活动任务结束");
    try {
      await worker.close();
      await queueEvents.close();
      await queue.close();
      connection.disconnect();
      await prisma.$disconnect();
    } catch (err) {
      console.error("[task-worker/shutdown]", err);
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void main().catch((err) => {
  console.error("[task-worker]", err);
  process.exitCode = 1;
});
