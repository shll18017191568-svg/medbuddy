import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSmsCode } from "@/lib/sms";

const bodySchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
});

/** 发送登录短信验证码（dev 模式明文返回便于联调） */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  try {
    const { devCode } = await issueSmsCode(parsed.data.phone);
    return NextResponse.json({ ok: true, devCode });
  } catch (err) {
    if (err instanceof Error && err.message === "SEND_TOO_FREQUENT") {
      return NextResponse.json({ error: "发送过于频繁，请 60 秒后重试" }, { status: 429 });
    }
    console.error("[sms/send]", err);
    return NextResponse.json({ error: "发送失败，请稍后重试" }, { status: 500 });
  }
}
