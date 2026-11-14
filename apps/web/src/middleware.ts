import { NextRequest, NextResponse } from "next/server";

/**
 * 路由保护（体验层）：仅检查会话 cookie 是否存在并重定向。
 * 真实鉴权在 API 层 getCurrentUser() 完成（JWT 签名校验）。
 */
export function middleware(req: NextRequest) {
  const token = req.cookies.get("medbuddy_session")?.value;
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/onboarding",
    "/admin",
    "/admin/:path*",
    "/tasks",
    "/tasks/:path*",
    "/chat",
    "/analysis",
    "/avatar",
  ],
};
