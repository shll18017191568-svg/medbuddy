import crypto from "node:crypto";

/**
 * 阿里云短信服务（dysmsapi SendSms，RPC 签名 v1.0）。
 * 文档：https://help.aliyun.com/document_detail/419273.html
 * 仅依赖 Node 内置 crypto + fetch，无需额外 SDK。
 */

const ENDPOINT = "https://dysmsapi.aliyuncs.com/";
const API_VERSION = "2017-05-25";

const REQUIRED_ENVS = [
  "ALIYUN_SMS_ACCESS_KEY_ID",
  "ALIYUN_SMS_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_SIGN_NAME",
  "ALIYUN_SMS_TEMPLATE_CODE",
] as const;

/** 阿里云签名规范的百分号编码：空格 %20、~ 不编码，! ' ( ) * 必须编码 */
function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/** 发送登录验证码；失败抛出带错误码的 Error，由路由映射为可读提示 */
export async function sendAliyunSms(phone: string, code: string): Promise<void> {
  const missing = REQUIRED_ENVS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`[sms/aliyun] 缺少环境变量: ${missing.join(", ")}`);
    throw new Error("SMS_NOT_CONFIGURED");
  }

  const params: Record<string, string> = {
    AccessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID as string,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: process.env.ALIYUN_SMS_REGION || "cn-hangzhou",
    SignName: process.env.ALIYUN_SMS_SIGN_NAME as string,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    // 阿里云要求 yyyy-MM-ddTHH:mm:ssZ（UTC，不带毫秒）
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    TemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE as string,
    TemplateParam: JSON.stringify({ code }),
    Version: API_VERSION,
  };

  // 1) 参数按 key 字典序排序并编码；2) 构造 StringToSign；3) HMAC-SHA1(secret + "&")
  const canonicalized = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
  const stringToSign = `POST&%2F&${percentEncode(canonicalized)}`;
  const signature = crypto
    .createHmac("sha1", `${process.env.ALIYUN_SMS_ACCESS_KEY_SECRET}&`)
    .update(stringToSign)
    .digest("base64");

  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `${canonicalized}&Signature=${percentEncode(signature)}`,
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error("[sms/aliyun] 网络请求失败", err instanceof Error ? err.message : err);
    throw new Error("SMS_SEND_FAILED");
  }

  const result = (await resp.json().catch(() => null)) as
    | { Code?: string; Message?: string }
    | null;
  if (!resp.ok || result?.Code !== "OK") {
    // 只记录业务错误码与文案，不打印 AccessKey/签名等敏感信息
    console.error(`[sms/aliyun] 发送失败 HTTP ${resp.status}: ${result?.Code ?? "-"} ${result?.Message ?? ""}`);
    throw new Error("SMS_SEND_FAILED");
  }
}
