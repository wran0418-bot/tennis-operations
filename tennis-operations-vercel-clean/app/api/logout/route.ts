import { expiredSessionCookie } from "@/auth";

export const runtime = "edge";

export async function POST(request: Request) {
  const response = Response.redirect(new URL("/", request.url), 303);
  response.headers.set("Set-Cookie", expiredSessionCookie());
  return response;
}

export async function OPTIONS() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": expiredSessionCookie(),
      },
    }
  );
}
