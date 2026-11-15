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
    if (err instanceof Error && err.message === "SMS_NOT_CONFIGURED") {
      return NextResponse.json(
        { error: "短信服务未配置：请设置 ALIYUN_SMS_* 环境变量后重启" },
        { status: 503 },
      );
    }
    if (err instanceof Error && err.message === "SMS_PROVIDER_UNSUPPORTED") {
      return NextResponse.json(
        { error: "短信服务商配置不支持（当前仅支持 dev / aliyun）" },
        { status: 503 },
      );
    }
    if (err instanceof Error && err.message === "SMS_SEND_FAILED") {
      return NextResponse.json({ error: "短信发送失败，请稍后重试" }, { status: 502 });
    }
    console.error("[sms/send]", err);
    return NextResponse.json({ error: "发送失败，请稍后重试" }, { status: 500 });
  }
}
