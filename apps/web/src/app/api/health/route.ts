/**
 * 健康检查代理：探测 AI 服务存活（M0 双服务联调验收点）。
 * AI 服务地址通过环境变量注入，默认本地 8000 端口。
 */
export async function GET() {
  const aiBaseUrl = process.env.AI_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${aiBaseUrl}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`AI service HTTP ${res.status}`);
    const data = await res.json();
    return Response.json({ web: "ok", ai: data });
  } catch (err) {
    return Response.json(
      {
        web: "ok",
        ai: "unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}
