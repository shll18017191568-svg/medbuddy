import type { Queue } from "bullmq";
import {
  executeTask,
  failTask,
  prepareTaskDispatch,
  type TaskExecutionPhase,
} from "@/lib/task-runner";

export const TASK_QUEUE_NAME = "medbuddy-tasks";
export const TASK_DISPATCH_ERROR = "TASK_DISPATCH_FAILED";

export interface TaskJobData {
  taskId: string;
  phase: TaskExecutionPhase;
  token: string;
}

let queuePromise: Promise<Queue<TaskJobData>> | null = null;

/** 延迟建立连接，确保 inline 模式与 Next.js 构建不会访问 Redis。 */
function getTaskQueue(): Promise<Queue<TaskJobData>> {
  queuePromise ??= (async () => {
    const [{ Queue: BullQueue }, { default: Redis }] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);
    const connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0", {
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
    });
    return new BullQueue<TaskJobData>(TASK_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  })().catch((err) => {
    queuePromise = null;
    throw err;
  });
  return queuePromise;
}

/** Redis 故障必须及时失败；即使迟到入队成功，数据库 token 也会阻止继续执行。 */
async function enqueue(queue: Queue<TaskJobData>, data: TaskJobData): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis 入队超时")), 5000);
  });
  try {
    await Promise.race([
      queue.add(`task-${data.phase}`, data, {
        jobId: `task_${data.taskId}_${data.phase}`,
        attempts: 1,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 路由只等待调度结果，不等待技能执行完成。 */
export async function dispatchTask(
  taskId: string,
  phase: TaskExecutionPhase = "execute",
): Promise<void> {
  const token = await prepareTaskDispatch(taskId);
  if (!token) return;

  const driver = process.env.TASK_QUEUE_DRIVER ?? "inline";
  if (driver === "inline") {
    void executeTask(taskId, phase, token).catch((err) => {
      console.error("[tasks/inline]", err);
    });
    return;
  }

  try {
    if (driver !== "bullmq") {
      throw new Error(`未知 TASK_QUEUE_DRIVER: ${driver}`);
    }
    await enqueue(await getTaskQueue(), { taskId, phase, token });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failTask(taskId, token, `任务入队失败：${reason}`);
    throw new Error(TASK_DISPATCH_ERROR, { cause: err });
  }
}
