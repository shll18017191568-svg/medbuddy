import { MemberLevel, MEMBER_PLANS, getMemberPlan } from "@medbuddy/shared";

/** 会员是否在有效期内（未开通或已过期一律按免费版处理） */
export function effectiveLevel(
  level?: string | null,
  expireAt?: Date | null,
): MemberLevel {
  if (!level || level === MemberLevel.FREE) return MemberLevel.FREE;
  if (!expireAt || expireAt.getTime() <= Date.now()) return MemberLevel.FREE;
  return (level as MemberLevel) in MEMBER_PLANS ? (level as MemberLevel) : MemberLevel.FREE;
}

export interface MemberStatus {
  level: MemberLevel;
  name: string;
  discount: number;
  dailyCheckinBonus: number;
  monthlyCredits: number;
  expireAt: string | null;
  expired: boolean;
}

/** 对外展示用的会员状态；expired 用于提示"会员已过期" */
export function memberStatus(user: {
  memberLevel?: string | null;
  memberExpireAt?: Date | null;
}): MemberStatus {
  const level = effectiveLevel(user.memberLevel, user.memberExpireAt);
  const plan = getMemberPlan(level);
  return {
    level,
    name: plan.name,
    discount: plan.discount,
    dailyCheckinBonus: plan.dailyCheckinBonus,
    monthlyCredits: plan.monthlyCredits,
    expireAt: user.memberExpireAt ? user.memberExpireAt.toISOString() : null,
    expired: !!user.memberExpireAt && user.memberExpireAt.getTime() <= Date.now(),
  };
}
