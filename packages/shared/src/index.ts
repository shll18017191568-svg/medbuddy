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
  AVATAR_CLONE = "avatar_clone", // 数字人定制（形象/声音克隆）
  AVATAR_VIDEO = "avatar_video", // 数字人播报视频
  CONTENT_GEN = "content_gen", // 内容工厂
  STYLE_REWRITE = "style_rewrite", // 技能7：文风改写
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
    description: "形象/声音克隆定制，交付专属数字人（需本人授权）",
  },
  [TaskType.AVATAR_VIDEO]: {
    label: "数字人播报",
    price: 800,
    description: "输入主题或稿件，生成带字幕的数字人口播视频脚本与成片任务单",
  },
  [TaskType.CONTENT_GEN]: {
    label: "内容生成",
    price: 200,
    description: "科普图文/短视频脚本/汇报 PPT 生成",
  },
  [TaskType.STYLE_REWRITE]: {
    label: "文风改写",
    price: 200,
    description: "同一份医学事实，改写成论文/科普/患者沟通/新媒体等不同文风，数值不得丢",
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

/** 合规审核结论（总纲 §5.1：AI 生成物必须经人工审核后才回传医生） */
export enum ReviewStatus {
  PENDING = "PENDING", // 待审核
  APPROVED = "APPROVED", // 通过，回传医生
  REJECTED = "REJECTED", // 驳回，失败退款
}

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  [ReviewStatus.PENDING]: "待审核",
  [ReviewStatus.APPROVED]: "审核通过",
  [ReviewStatus.REJECTED]: "审核驳回",
};

/** 审核台必检项（人工审核清单，前端展示 + 驳回意见提示） */
export const REVIEW_CHECKLIST = [
  "事实可溯源：文献类结论均带真实 PMID，且与原文一致",
  "AI 标注：交付物已标注「AI 辅助生成，仅供参考」",
  "医学免责：含医学免责声明，不构成诊疗建议",
  "无夸大疗效 / 违规医疗建议 / 患者隐私信息",
] as const;

/** 注册赠送积分（新用户冷启动额度，创始人定的增长策略） */
export const REGISTER_CREDIT_BONUS = 10000;

/** 每日签到奖励积分 */
export const CHECKIN_REWARD = 100;

/** 会员等级（免费 / 专业 / 旗舰） */
export enum MemberLevel {
  FREE = "free",
  PRO = "pro",
  FLAGSHIP = "flagship",
}

export interface MemberPlan {
  level: MemberLevel;
  name: string;
  priceMonthly: number; // 元/月（0 表示免费）
  discount: number; // 任务积分折扣系数，1 表示不打折
  dailyCheckinBonus: number; // 每日签到积分
  monthlyCredits: number; // 开通/续费即赠积分
  benefits: string[];
}

export const MEMBER_PLANS: Record<MemberLevel, MemberPlan> = {
  [MemberLevel.FREE]: {
    level: MemberLevel.FREE,
    name: "免费版",
    priceMonthly: 0,
    discount: 1,
    dailyCheckinBonus: CHECKIN_REWARD,
    monthlyCredits: 0,
    benefits: ["全部科研技能按标准积分使用", "每日签到 +100 积分", "注册赠送 10000 积分"],
  },
  [MemberLevel.PRO]: {
    level: MemberLevel.PRO,
    name: "专业版",
    priceMonthly: 99,
    discount: 0.8,
    dailyCheckinBonus: 150,
    monthlyCredits: 3000,
    benefits: ["所有任务积分消耗 8 折", "每日签到 +150 积分", "每月赠送 3000 积分", "优先任务队列"],
  },
  [MemberLevel.FLAGSHIP]: {
    level: MemberLevel.FLAGSHIP,
    name: "旗舰版",
    priceMonthly: 299,
    discount: 0.7,
    dailyCheckinBonus: 200,
    monthlyCredits: 10000,
    benefits: ["所有任务积分消耗 7 折", "每日签到 +200 积分", "每月赠送 10000 积分", "专属专家 Agent（即将上线）"],
  },
};

/** 非法或过期等级一律按免费版处理 */
export function getMemberPlan(level?: string | null): MemberPlan {
  const key = (level ?? "").toLowerCase() as MemberLevel;
  return MEMBER_PLANS[key] ?? MEMBER_PLANS[MemberLevel.FREE];
}

/** 会员折扣后的实际扣费（向上取整到 10 的整数，避免零头） */
export function applyMemberDiscount(price: number, level?: string | null): number {
  const plan = getMemberPlan(level);
  if (plan.discount >= 1) return price;
  return Math.ceil((price * plan.discount) / 10) * 10;
}

/** 积分充值包（价格单位为元；credits 含赠送） */
export interface RechargePackage {
  id: string;
  name: string;
  priceYuan: number;
  credits: number;
  bonusRate: number; // 赠送比例，0 表示无赠送
}

export const RECHARGE_PACKAGES: RechargePackage[] = [
  { id: "starter", name: "体验包", priceYuan: 10, credits: 1000, bonusRate: 0 },
  { id: "standard", name: "标准包", priceYuan: 50, credits: 5500, bonusRate: 0.1 },
  { id: "pro", name: "专业包", priceYuan: 100, credits: 12000, bonusRate: 0.2 },
  { id: "bulk", name: "批量包", priceYuan: 300, credits: 40000, bonusRate: 1 / 3 },
];

export function findRechargePackage(id: string): RechargePackage | undefined {
  return RECHARGE_PACKAGES.find((p) => p.id === id);
}

/** 数字人音色（id 与 AI 服务 avatar.py 的音色表保持一致） */
export const AVATAR_VOICES = [
  { id: "warm_female", label: "温暖女声 · 科普讲解" },
  { id: "steady_male", label: "稳重男声 · 专家播报" },
  { id: "youth_female", label: "清亮女声 · 新媒体" },
  { id: "senior_male", label: "资深男声 · 学术汇报" },
] as const;

/** 数字人视频画幅 */
export const AVATAR_ASPECTS = [
  { id: "portrait", label: "竖屏 9:16 · 抖音/视频号", size: "1080x1920" },
  { id: "landscape", label: "横屏 16:9 · 公众号/会议", size: "1920x1080" },
] as const;

/** 数字人克隆类型 */
export const AVATAR_CLONE_TYPES = [
  { id: "appearance", label: "形象克隆", description: "上传 3-5 分钟真人出镜视频，复刻外貌与动作" },
  { id: "voice", label: "声音克隆", description: "上传 1-2 分钟清晰人声素材，复刻音色与语气" },
] as const;

/** 数字人供应商展示名（一期第三方 API，双供应商备份） */
export const AVATAR_PROVIDER_LABELS: Record<string, string> = {
  zhiying: "腾讯智影",
  silicon: "硅基智能",
  mock: "演示模式",
};

/** 数字人成片任务状态 */
export const AVATAR_JOB_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "已提交",
  PROCESSING: "合成中",
  COMPLETED: "已生成",
  FAILED: "失败",
};


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
