// Confirms the live captcha rendering and its rejection path without signing in.
// Usage: node .scratch/check-captcha-render.mjs
const origin = "http://127.0.0.1:3000";
const jar = new Map();
const request = async (path, options = {}) => {
  const headers = new Headers(options.headers);
  headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
  if (options.method) headers.set("origin", origin);
  const response = await fetch(origin + path, { ...options, headers, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
  return response;
};
const data = await (await request("/api/auth/captcha")).json();
const svg = Buffer.from(data.image.split(",")[1], "base64").toString("utf8");
const glyphs = (svg.match(/scale\(1\.7\)/g) ?? []).length;
const noise = (svg.match(/stroke="#d4d4d8"/g) ?? []).length;
console.log(`image size: ${svg.match(/width="(\d+)" height="(\d+)"/)?.slice(1).join("x")}, glyphs: ${glyphs}, noise lines: ${noise}`);
if (glyphs !== 5) throw new Error("字母笔画数量异常");
if (svg.includes("<text")) throw new Error("验证码不应把答案写成文本");
const csrf = await (await request("/api/auth/csrf")).json();
const response = await request("/api/auth/callback/credentials", { method: "POST", body: new URLSearchParams({ csrfToken: csrf.csrfToken, login: "nobody-check", password: "wrong-password", role: "STUDENT", captchaId: data.id, captcha: "ZZZZZ", callbackUrl: origin, json: "true" }) });
const body = await response.json();
const error = new URL(String(body.url ?? ""), origin).searchParams.get("error") ?? "";
console.log(`wrong captcha -> status ${response.status}, error=${error}`);
if (error !== "CaptchaInvalid") throw new Error("错误验证码未被拒绝");
console.log("验证码渲染与拒绝路径检查通过。");
