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
  PLAN_READY = "plan_ready", // 方案已就绪，等待医生确认后再执行（PLAN 模式专用）
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

/** 科研技能目录（总纲 §5.2：40 项技能注册即免费解锁，作为获客钩子） */
export type SkillCategoryKey =
  | "literature"
  | "data"
  | "design"
  | "writing"
  | "communication"
  | "avatar"
  | "grant"
  | "utility";

export const SKILL_CATEGORIES: { key: SkillCategoryKey; name: string }[] = [
  { key: "literature", name: "文献与情报" },
  { key: "data", name: "数据分析与可视化" },
  { key: "design", name: "科研设计" },
  { key: "writing", name: "论文写作" },
  { key: "communication", name: "学术传播" },
  { key: "avatar", name: "数字人" },
  { key: "grant", name: "基金与申报" },
  { key: "utility", name: "科研效率" },
];

export interface SkillItem {
  id: string;
  name: string;
  category: SkillCategoryKey;
  description: string;
  /** live：已上线可用；coming：陆续上线 */
  status: "live" | "coming";
  /** 已上线技能的入口（任务类型则指向新建任务页并预选） */
  href?: string;
  /** 关联任务类型，用于展示单次消耗积分 */
  taskType?: TaskType;
}

export const SKILL_CATALOG: SkillItem[] = [
  // 文献与情报
  {
    id: "lit-search",
    name: "文献检索",
    category: "literature",
    description: "一句话转专业检索式，PubMed 三库路由，只回真实 PMID",
    status: "live",
    href: "/tasks/new?type=literature_search",
    taskType: TaskType.LITERATURE_SEARCH,
  },
  {
    id: "lit-digest",
    name: "文献解读",
    category: "literature",
    description: "PMID 或全文 → 五段式结构化拆解，缺失信息标 Not specified",
    status: "live",
    href: "/tasks/new?type=literature_digest",
    taskType: TaskType.LITERATURE_DIGEST,
  },
  {
    id: "ref-manage",
    name: "参考文献管理",
    category: "literature",
    description: "PMID 清单自动补题录，6 种引用格式，导出 BibTeX/RIS",
    status: "live",
    href: "/tasks/new?type=reference_format",
    taskType: TaskType.REFERENCE_FORMAT,
  },
  {
    id: "guideline",
    name: "指南共识速查",
    category: "literature",
    description: "按疾病与关键词定位最新指南/共识条目并标注版本",
    status: "coming",
  },
  {
    id: "hot-topic",
    name: "研究热点追踪",
    category: "literature",
    description: "近 12 个月高被引与高频关键词聚类，输出选题窗口",
    status: "coming",
  },
  {
    id: "topic-screen",
    name: "选题可行性预判",
    category: "literature",
    description: "结合文献存量与竞争强度评估选题创新空间",
    status: "coming",
  },

  // 数据分析与可视化
  {
    id: "chart",
    name: "学术绘图",
    category: "data",
    description: "火山/热图/箱线/小提琴/散点/折线/柱状/直方 8 类图，顶刊配色",
    status: "live",
    href: "/analysis",
    taskType: TaskType.CHART,
  },
  {
    id: "stats-desc",
    name: "统计描述与检验",
    category: "data",
    description: "自动识别变量类型，给出描述统计与检验方法建议",
    status: "coming",
  },
  {
    id: "survival",
    name: "生存分析",
    category: "data",
    description: "KM 曲线、Log-rank 与 Cox 回归结果整理及配图",
    status: "coming",
  },
  {
    id: "roc",
    name: "ROC 与诊断效能",
    category: "data",
    description: "ROC/AUC、敏感度特异度与最佳截断值计算",
    status: "coming",
  },
  {
    id: "enrichment",
    name: "富集与通路可视化",
    category: "data",
    description: "GO/KEGG 富集条形图与气泡图，附通路层级解读",
    status: "coming",
  },
  {
    id: "figure-polish",
    name: "图表美化与期刊排版",
    category: "data",
    description: "按目标期刊统一字号、线宽、配色与多图拼版",
    status: "coming",
  },

  // 科研设计
  {
    id: "experiment",
    name: "实验设计",
    category: "design",
    description: "核心文献或课题 → 主/子实验、分组表、检测指标与预期结果",
    status: "live",
    href: "/tasks/new?type=experiment_design",
    taskType: TaskType.EXPERIMENT_DESIGN,
  },
  {
    id: "clinical",
    name: "临床方案设计",
    category: "design",
    description: "PICO + 国自然/伦理申报结构，含纳排、结局、样本量与统计",
    status: "live",
    href: "/tasks/new?type=clinical_design",
    taskType: TaskType.CLINICAL_DESIGN,
  },
  {
    id: "sample-size",
    name: "样本量估算",
    category: "design",
    description: "按效应量与把握度给出每组样本量及计算过程",
    status: "coming",
  },
  {
    id: "sap",
    name: "统计分析计划",
    category: "design",
    description: "预定义分析集、主次结局、缺失值与敏感性分析",
    status: "coming",
  },
  {
    id: "crf",
    name: "CRF 与数据字典",
    category: "design",
    description: "按方案生成病例报告表字段与变量定义",
    status: "coming",
  },
  {
    id: "data-mgmt",
    name: "随访与数据管理",
    category: "design",
    description: "随访节点、数据核查规则与质量监查清单",
    status: "coming",
  },

  // 论文写作
  {
    id: "review",
    name: "综述写作",
    category: "writing",
    description: "自动建库检索并生成带真实 PMID 引用的综述初稿",
    status: "live",
    href: "/tasks/new?type=review_draft",
    taskType: TaskType.REVIEW_DRAFT,
  },
  {
    id: "original",
    name: "论著写作（IMRaD）",
    category: "writing",
    description: "按 IMRaD 结构搭骨架，逐段提示所需数据与文献",
    status: "coming",
  },
  {
    id: "rewrite",
    name: "文风改写",
    category: "writing",
    description: "6 种文风改写，事实与数值零丢失校验",
    status: "live",
    href: "/tasks/new?type=style_rewrite",
    taskType: TaskType.STYLE_REWRITE,
  },
  {
    id: "abstract",
    name: "摘要与亮点提炼",
    category: "writing",
    description: "结构化摘要 + 期刊要求的 highlights 要点",
    status: "coming",
  },
  {
    id: "response",
    name: "审稿意见回复",
    category: "writing",
    description: "逐条拆解审稿意见，生成回复信与修改说明",
    status: "coming",
  },
  {
    id: "journal",
    name: "投稿期刊匹配",
    category: "writing",
    description: "按主题、影响因子与审稿周期推荐目标期刊",
    status: "coming",
  },

  // 学术传播
  {
    id: "wechat-article",
    name: "科普图文",
    category: "communication",
    description: "小红书/科普长图文，自动去重复编号并附免责声明",
    status: "live",
    href: "/tasks/new?type=content_gen",
    taskType: TaskType.CONTENT_GEN,
  },
  {
    id: "short-video",
    name: "短视频脚本",
    category: "communication",
    description: "抖音/视频号镜头表，时长由代码累加，不承诺疗效",
    status: "live",
    href: "/tasks/new?type=content_gen",
    taskType: TaskType.CONTENT_GEN,
  },
  {
    id: "patient-card",
    name: "患教卡片",
    category: "communication",
    description: "门诊/病房可发的要点卡片，语言通俗不含剂量建议",
    status: "live",
    href: "/tasks/new?type=content_gen",
    taskType: TaskType.CONTENT_GEN,
  },
  {
    id: "official-account",
    name: "公众号图文",
    category: "communication",
    description: "公众号排版结构 + 标题候选 + 配图建议",
    status: "live",
    href: "/tasks/new?type=content_gen",
    taskType: TaskType.CONTENT_GEN,
  },
  {
    id: "conference",
    name: "学术会议摘要",
    category: "communication",
    description: "按会议模板压缩成摘要与壁报要点",
    status: "coming",
  },
  {
    id: "poster",
    name: "学术海报文案",
    category: "communication",
    description: "A0/A1 海报分区文案与图表排布建议",
    status: "coming",
  },

  // 数字人
  {
    id: "avatar-chat",
    name: "数字人对话",
    category: "avatar",
    description: "医疗文献大模型驱动，支持多轮追问与参考文献溯源",
    status: "live",
    href: "/chat",
    taskType: TaskType.AVATAR_CHAT,
  },
  {
    id: "avatar-video",
    name: "数字人播报",
    category: "avatar",
    description: "主题/稿件 → 口播稿 + 分镜字幕表 + 供应商合成任务单",
    status: "live",
    href: "/avatar",
    taskType: TaskType.AVATAR_VIDEO,
  },
  {
    id: "avatar-face",
    name: "形象克隆",
    category: "avatar",
    description: "上传真人出镜视频定制专属形象，需授权材料核验",
    status: "live",
    href: "/avatar",
    taskType: TaskType.AVATAR_CLONE,
  },
  {
    id: "avatar-voice",
    name: "声音克隆",
    category: "avatar",
    description: "1-2 分钟清晰人声素材复刻音色，需授权材料核验",
    status: "live",
    href: "/avatar",
    taskType: TaskType.AVATAR_CLONE,
  },

  // 基金与申报
  {
    id: "grant-frame",
    name: "国自然标书框架",
    category: "grant",
    description: "按项目类型生成章节框架与各节写作要点",
    status: "coming",
  },
  {
    id: "rationale",
    name: "立项依据撰写",
    category: "grant",
    description: "结合文献库生成立项依据并附真实引用",
    status: "coming",
  },
  {
    id: "tech-route",
    name: "技术路线图",
    category: "grant",
    description: "把研究内容转成可绘制的技术路线结构",
    status: "coming",
  },
  {
    id: "grant-check",
    name: "申报材料自查",
    category: "grant",
    description: "形式审查清单：预算、简历、附件与限项",
    status: "coming",
  },

  // 科研效率
  {
    id: "translate",
    name: "中英互译润色",
    category: "utility",
    description: "医学术语准确的中英互译，按期刊语言风格润色",
    status: "coming",
  },
  {
    id: "batch-pmid",
    name: "PMID/DOI 批量整理",
    category: "utility",
    description: "批量核验并统一为指定引用格式，导出表格",
    status: "coming",
  },
];

/** 技能包统计（首页与技能中心展示） */
export const SKILL_PACK_STATS = {
  total: SKILL_CATALOG.length,
  live: SKILL_CATALOG.filter((s) => s.status === "live").length,
  coming: SKILL_CATALOG.filter((s) => s.status === "coming").length,
};

/** ASK 模式（仅问答）固定低价：不产生正式交付物、不走人工审核，鼓励轻量咨询 */
export const ASK_PRICE = 10;

/** 任务状态中文展示名 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: "待确认",
  [TaskStatus.QUEUED]: "排队中",
  [TaskStatus.RUNNING]: "执行中",
  [TaskStatus.PLAN_READY]: "方案待确认",
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

/** AI 合规预审风险等级（人工审核前的自动体检） */
export const PRECHECK_STATUS_LABEL: Record<string, string> = {
  PASS: "预审通过",
  WARN: "需关注",
  HIGH_RISK: "高危",
};

export const PRECHECK_LEVEL_LABEL: Record<string, string> = {
  HIGH: "高危",
  WARN: "关注",
  INFO: "提示",
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

/** 邀请奖励：邀请人每成功邀请一位新医生 / 新医生受邀注册各得积分（终身一次） */
export const INVITE_REWARD_INVITER = 1000;
export const INVITE_REWARD_INVITEE = 500;

/** 会员开通/续费周期（天） */
export const MEMBERSHIP_PERIOD_DAYS = 30;

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

/** 支付渠道（mock 用于本地联调，未配置商户号时强制 mock） */
export enum PaymentProvider {
  MOCK = "mock",
  WECHAT = "wechat",
  ALIPAY = "alipay",
}

export const PAYMENT_PROVIDER_LABEL: Record<string, string> = {
  [PaymentProvider.MOCK]: "模拟支付",
  [PaymentProvider.WECHAT]: "微信支付",
  [PaymentProvider.ALIPAY]: "支付宝",
};

/** 充值订单状态机：创建 → 待支付 → 已支付 / 失败 / 已退款 */
export enum PaymentOrderStatus {
  CREATED = "CREATED",
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export const PAYMENT_ORDER_STATUS_LABEL: Record<string, string> = {
  [PaymentOrderStatus.CREATED]: "待支付",
  [PaymentOrderStatus.PENDING]: "待支付",
  [PaymentOrderStatus.PAID]: "已支付",
  [PaymentOrderStatus.FAILED]: "支付失败",
  [PaymentOrderStatus.REFUNDED]: "已退款",
  MOCK_PAID: "已支付", // 历史测试单
};

/** 金额换算：元 → 分（支付平台一律用分，避免浮点误差） */
export function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100);
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
  [TaskStatus.QUEUED]: [TaskStatus.RUNNING, TaskStatus.PLAN_READY, TaskStatus.FAILED],
  [TaskStatus.RUNNING]: [TaskStatus.REVIEWING, TaskStatus.DELIVERED, TaskStatus.PLAN_READY, TaskStatus.FAILED],
  [TaskStatus.PLAN_READY]: [TaskStatus.QUEUED, TaskStatus.FAILED],
  [TaskStatus.REVIEWING]: [TaskStatus.DELIVERED, TaskStatus.FAILED],
  [TaskStatus.DELIVERED]: [],
  [TaskStatus.FAILED]: [TaskStatus.QUEUED], // 重试
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
