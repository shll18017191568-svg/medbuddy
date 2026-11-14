/**
 * MedBuddy 共享类型与常量（Web 与 AI 服务契约）
 * 总纲 §5.1：任务系统状态机 —— 结果必须定向回传提交医生。
 */

/** 任务三模式（对齐 WorkBuddy Craft/Plan/Ask） */
export enum TaskMode {
  /** 直接执行并交付 */
  CRAFT = "craft",
  /** 先出方案，医生确认后执行 */
  PLAN = "plan",
  /** 仅问答分析，不产生交付物 */
  ASK = "ask",
}

/** 任务状态机：提交 → 排队 → 执行 → 审核 → 回传/失败 */
export enum TaskStatus {
  DRAFT = "draft", // 草稿/待支付额度
  QUEUED = "queued", // 排队中
  RUNNING = "running", // 执行中（云端异步，关浏览器不中断）
  REVIEWING = "reviewing", // 合规审核中
  DELIVERED = "delivered", // 已回传提交医生
  FAILED = "failed", // 失败（可重试）
}

/** 任务类型（S2 起逐步开放） */
export enum TaskType {
  LITERATURE_SEARCH = "literature_search", // 技能1：文献检索
  LITERATURE_DIGEST = "literature_digest", // 技能2：文献解读
  CHART = "chart", // 技能8：数据可视化
  REFERENCE_FORMAT = "reference_format", // 技能9：参考文献管理
  AVATAR_CHAT = "avatar_chat", // 数字人对话
  AVATAR_CLONE = "avatar_clone", // 数字人定制
  CONTENT_GEN = "content_gen", // 内容工厂
}

/** 注册赠送积分（对齐 WorkBuddy 新用户积分策略，总纲 §7 商业化） */
export const REGISTER_CREDIT_BONUS = 2300;

/** 状态流转合法性校验（AI 服务回写状态时同样遵守） */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.DRAFT]: [TaskStatus.QUEUED, TaskStatus.FAILED],
  [TaskStatus.QUEUED]: [TaskStatus.RUNNING, TaskStatus.FAILED],
  [TaskStatus.RUNNING]: [TaskStatus.REVIEWING, TaskStatus.DELIVERED, TaskStatus.FAILED],
  [TaskStatus.REVIEWING]: [TaskStatus.DELIVERED, TaskStatus.FAILED],
  [TaskStatus.DELIVERED]: [],
  [TaskStatus.FAILED]: [TaskStatus.QUEUED], // 重试
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
