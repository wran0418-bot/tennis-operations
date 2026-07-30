import { NextRequest, NextResponse } from "next/server";
import { isValidSession, sessionCookieName } from "./auth";

const PROTECTED_PATHS = ["/tennis-app.html", "/api/tennis-state"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const shouldProtect = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (!shouldProtect) {
    return NextResponse.next();
  }

  const session = request.cookies.get(sessionCookieName())?.value;
  if (await isValidSession(session)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/tennis-app.html", "/api/tennis-state/:path*"],
};
