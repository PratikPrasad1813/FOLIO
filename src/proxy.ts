import { NextRequest, NextResponse } from "next/server";
import { requestOrigin, safeDestination, sameOrigin, SESSION_COOKIE, userFromToken } from "@/lib/auth";
const PRIVATE_PAGE = /^\/(overview|projects|tasks|ideas|calendar|ai|settings|onboarding|preferences)(\/|$)/;
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/") || pathname === "/api/health") return NextResponse.next();
  // The scheduler authenticates its own secret in its handler.
  if (pathname === "/api/notifications/process" && Boolean(request.headers.get("authorization") || request.headers.get("x-folio-cron-secret"))) return NextResponse.next();
  if (!isApi && !PRIVATE_PAGE.test(pathname)) return NextResponse.next();
  let user = null;
  try { user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value); } catch { /* Fail closed on database errors. */ }
  if (!user) {
    if (isApi) return NextResponse.json({ error: "Please sign in to continue.", code: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const login = new URL("/login", requestOrigin(request));
    login.searchParams.set("next", safeDestination(pathname + search));
    return NextResponse.redirect(login);
  }
  const headers = new Headers(request.headers); headers.set("x-folio-destination", pathname + search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/api/:path*", "/overview/:path*", "/projects/:path*", "/tasks/:path*", "/ideas/:path*", "/calendar/:path*", "/ai/:path*", "/settings/:path*", "/onboarding", "/preferences"] };
