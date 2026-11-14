/**
 * AI 合规预审客户端：任务交付物在进入人工审核前做一次自动风险体检。
 * 规则与阈值由 AI 服务 app/services/compliance.py 统一维护。
 */
const AI_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

export type PrecheckFinding = {
  level: "HIGH" | "WARN" | "INFO";
  code: string;
  message: string;
};

export type PrecheckResult = {
  status: "PASS" | "WARN" | "HIGH_RISK";
  findings: PrecheckFinding[];
  pmids: string[];
  verified_pmids: string[];
  checked_chars: number;
  checked_at: string;
};

export async function precheckDeliverable(
  type: string,
  title: string,
  result: unknown,
  inputText = "",
): Promise<PrecheckResult> {
  const res = await fetch(`${AI_URL}/api/compliance/precheck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_type: type, title, result, input_text: inputText }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`合规预审服务返回 ${res.status}`);
  const data = (await res.json()) as PrecheckResult & { error?: string };
  if (data.error) throw new Error(data.error);
  return data;
}
