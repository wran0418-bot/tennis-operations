import { createSessionValue, isValidLogin, sessionCookie } from "@/auth";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");

    if (!(await isValidLogin(username, password))) {
      return Response.json({ error: "账号或密码不正确" }, { status: 401 });
    }

    const sessionValue = await createSessionValue();
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": sessionCookie(sessionValue),
        },
      }
    );
  } catch {
    return Response.json({ error: "登录失败，请重试" }, { status: 400 });
  }
}
