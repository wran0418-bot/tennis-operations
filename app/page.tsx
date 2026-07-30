import { cookies } from "next/headers";
import { isValidSession, sessionCookieName } from "@/auth";

export default async function Home() {
  const cookieStore = await cookies();
  const isAuthenticated = await isValidSession(
    cookieStore.get(sessionCookieName())?.value
  );

  if (!isAuthenticated) {
    return (
      <main className="login-shell">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-brand">
            <span className="login-mark">T</span>
            <div>
              <p className="login-kicker">网球俱乐部管理系统</p>
              <h1 id="login-title">登录后查看课表与工资统计</h1>
            </div>
          </div>

          <form className="login-form" id="login-form">
            <label>
              <span>账号</span>
              <input
                autoComplete="username"
                inputMode="numeric"
                name="username"
                placeholder="请输入账号"
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                autoComplete="current-password"
                name="password"
                placeholder="请输入密码"
                required
                type="password"
              />
            </label>
            <p className="login-error" id="login-error" role="alert" />
            <button type="submit">登录</button>
          </form>
        </section>
        <script
          dangerouslySetInnerHTML={{
            __html: `
const form = document.getElementById("login-form");
const error = document.getElementById("login-error");
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "登录中...";
  const formData = new FormData(form);
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: formData.get("username"),
      password: formData.get("password")
    })
  });
  if (response.ok) {
    window.location.reload();
    return;
  }
  const payload = await response.json().catch(() => ({}));
  error.textContent = payload.error || "登录失败，请检查账号和密码";
  button.disabled = false;
  button.textContent = "登录";
});
            `,
          }}
        />
      </main>
    );
  }

  return (
    <main className="published-shell">
      <form action="/api/logout" className="logout-form" method="post">
        <button type="submit">退出登录</button>
      </form>
      <iframe
        className="published-app"
        src="/tennis-app.html"
        title="网球课时与工资统计"
      />
    </main>
  );
}
