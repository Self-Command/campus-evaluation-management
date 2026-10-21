// Authenticated HTTP check for the score/deduction review pages and APIs on the
// running 3000 service. Uses the local dev account fixture; credentials are never
// printed or changed. Usage: node .scratch/check-grade-pages.mjs
import { readFile, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:3000";
const accounts = JSON.parse(await readFile(".local/dev-accounts-1792456787517.json", "utf8"));
const summary = { at: new Date().toISOString(), origin, browser: false, checks: [] };

async function session(account) {
  const jar = new Map();
  const request = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
    if (options.method) headers.set("origin", origin);
    const response = await fetch(origin + path, { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
    return response;
  };
  const csrf = await (await request("/api/auth/csrf")).json();
  await request("/api/auth/callback/credentials", { method: "POST", body: new URLSearchParams({ csrfToken: csrf.csrfToken, login: account.login, password: account.password, callbackUrl: origin, json: "true" }) });
  const current = await (await request("/api/auth/session")).json();
  if (current.user?.role !== account.role) throw new Error(`${account.role} 登录未通过`);
  return request;
}

const admin = await session(accounts.find(account => account.role === "ADMIN"));
const student = await session(accounts.find(account => account.role === "STUDENT"));

for (const path of ["/grades", "/deductions", "/imports?kind=grades"]) {
  const response = await admin(path), html = await response.text();
  const ok = response.status === 200 && !html.includes("Application error") && !html.includes('"digest":"');
  summary.checks.push({ role: "ADMIN", path, status: response.status, ok });
  if (!ok) throw new Error(`ADMIN ${path} 页面未通过`);
}
const studentPage = await student("/grades");
summary.checks.push({ role: "STUDENT", path: "/grades", status: studentPage.status, ok: studentPage.status === 404 });
if (studentPage.status !== 404) throw new Error("学生不应访问成绩录入与审核页");

const terms = await (await admin("/api/terms")).json();
const term = terms.find(item => item.phase === "ACTIVE") ?? terms[0];
if (term) {
  for (const [path, probe] of [
    [`/api/grades/roster?termId=${term.id}`, body => Array.isArray(body.items) && typeof body.total === "number"],
    [`/api/grade-changes?termId=${term.id}`, body => Array.isArray(body.items) && typeof body.stats?.pending === "number"],
    [`/api/deductions/roster?termId=${term.id}`, body => Array.isArray(body.items) && Array.isArray(body.projects)],
    [`/api/deduction-changes?termId=${term.id}`, body => Array.isArray(body.items) && typeof body.stats?.pending === "number"],
  ]) {
    const response = await admin(path);
    const body = await response.json();
    const ok = response.ok && probe(body);
    summary.checks.push({ role: "ADMIN", path, status: response.status, ok });
    if (!ok) throw new Error(`${path} 未按契约返回`);
  }
}
await writeFile(".local/grade-pages-http-summary.json", JSON.stringify(summary, null, 2));
console.log(`成绩/扣分页与接口HTTP检查通过（${summary.checks.length}项）；未输出或更改任何凭据。`);
