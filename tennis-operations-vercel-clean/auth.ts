const SESSION_COOKIE = "tennis_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export async function isValidLogin(username: string, password: string) {
  const configuredUsername = process.env.LOGIN_USERNAME || "";
  const configuredPassword = process.env.LOGIN_PASSWORD || "";
  if (!configuredUsername || !configuredPassword) return false;
  if (username !== configuredUsername) return false;
  return timingSafeEqual(password, configuredPassword);
}

export async function createSessionValue(now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  const signature = await signSession(expiresAt);
  return `${expiresAt}.${signature}`;
}

export async function isValidSession(value: string | undefined | null, now = Date.now()) {
  if (!value) return false;
  const [expiresAtText, signature] = value.split(".");
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || !signature) return false;

  const expectedSignature = await signSession(expiresAt);
  return timingSafeEqual(signature, expectedSignature);
}

export function sessionCookie(value: string) {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join("; ");
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function signSession(expiresAt: number) {
  const sessionSecret =
    process.env.SESSION_SECRET ||
    process.env.LOGIN_PASSWORD ||
    "tennis-session-development-secret";
  return sha256(`${expiresAt}:${sessionSecret}`);
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
