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
  REVIEW_DRAFT = "review_draft", // 技能5：综述写作
  EXPERIMENT_DESIGN = "experiment_design", // 技能3：实验设计
  CLINICAL_DESIGN = "clinical_design", // 技能4：临床方案设计
  REFERENCE_FORMAT = "reference_format", // 技能9：参考文献管理
  AVATAR_CHAT = "avatar_chat", // 数字人对话
  AVATAR_CLONE = "avatar_clone", // 数字人定制
  CONTENT_GEN = "content_gen", // 内容工厂
}

/** 任务类型元数据：显示名 + 单次积分价格（前端展示与后端扣费共用此表） */
export const TASK_TYPE_META: Record<TaskType, { label: string; price: number; description: string }> = {
  [TaskType.LITERATURE_SEARCH]: {
    label: "文献检索",
    price: 100,
    description: "一句话检索 PubMed/万方，返回带 PMID 的筛选清单",
  },
  [TaskType.LITERATURE_DIGEST]: {
    label: "文献解读",
    price: 200,
    description: "上传文献 PDF 或 PMID，输出结构化拆解报告",
  },
  [TaskType.CHART]: {
    label: "学术绘图",
    price: 300,
    description: "上传数据，一句话生成顶刊配色学术图表",
  },
  [TaskType.REVIEW_DRAFT]: {
    label: "综述写作",
    price: 800,
    description: "输入主题，自动建库检索并生成带真实 PMID 引用的综述初稿",
  },
  [TaskType.EXPERIMENT_DESIGN]: {
    label: "实验设计",
    price: 600,
    description: "以核心文献或课题为起点，产出可开题的分组与实验方案",
  },
  [TaskType.CLINICAL_DESIGN]: {
    label: "临床方案",
    price: 600,
    description: "按 PICO 与国自然结构生成临床研究方案，含统计与伦理",
  },
  [TaskType.REFERENCE_FORMAT]: {
    label: "参考文献排版",
    price: 100,
    description: "PMID 清单一键生成 GB/T 7714、Vancouver、APA 等格式并导出 BibTeX/RIS",
  },
  [TaskType.AVATAR_CHAT]: {
    label: "数字人对话",
    price: 50,
    description: "医疗文献大模型驱动的 AI 数字人问答",
  },
  [TaskType.AVATAR_CLONE]: {
    label: "数字人定制",
    price: 2000,
    description: "形象/声音克隆定制，交付专属数字人",
  },
  [TaskType.CONTENT_GEN]: {
    label: "内容生成",
    price: 200,
    description: "科普图文/短视频脚本/汇报 PPT 生成",
  },
};

/** 任务状态中文展示名 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: "待确认",
  [TaskStatus.QUEUED]: "排队中",
  [TaskStatus.RUNNING]: "执行中",
  [TaskStatus.REVIEWING]: "审核中",
  [TaskStatus.DELIVERED]: "已完成",
  [TaskStatus.FAILED]: "失败",
};

/** 注册赠送积分（新用户冷启动额度，创始人定的增长策略） */
export const REGISTER_CREDIT_BONUS = 10000;

/** 每日签到奖励积分 */
export const CHECKIN_REWARD = 100;

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
