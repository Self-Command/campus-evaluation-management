import "dotenv/config";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { mkdtemp, mkdir, cp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";
import { hash } from "bcryptjs";

// HTTP only: never launches a browser. The service and test client share the same
// random test database, temporary attachment directory and independent port.
async function main() {
  const source = new URL(process.env.DATABASE_URL!);
  if (source.hostname !== "127.0.0.1") throw new Error("仅允许本机隔离HTTP检查");
  const port = 3012, origin = `http://127.0.0.1:${port}`;
  await new Promise<void>((done, fail) => { const probe = createServer(); probe.once("error", () => fail(new Error("隔离端口已占用，请先更换端口"))); probe.listen(port, "127.0.0.1", () => probe.close(() => done())); });
  const runId = randomBytes(6).toString("hex"), name = `campus_http_${runId}`;
  const url = new URL(`/${name}`, source).toString();
  const attachments = await mkdtemp(join(tmpdir(), "campus-http-"));
  const adminDb = new Client({ connectionString: new URL("/postgres", source).toString() });
  const fixture = new Client({ connectionString: url });
  let server: ChildProcess | undefined, databaseCreated = false, serverError = "";
  const results: { label: string; status: number }[] = [];
  function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
  const buttonTexts = (html: string) => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => match[1].replace(/<[^>]*>/g, "").trim());
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", DATABASE_URL: url, NEXTAUTH_URL: origin, NEXTAUTH_SECRET: randomBytes(32).toString("hex"), EVIDENCE_DIR: attachments, PORT: String(port), HOSTNAME: "127.0.0.1" };
  await adminDb.connect();
  try {
    await adminDb.query(`CREATE DATABASE "${name}"`); databaseCreated = true;
    await new Promise<void>((done, fail) => { const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, windowsHide: true, stdio: "ignore" }); child.once("error", fail); child.once("exit", code => code === 0 ? done() : fail(new Error("隔离迁移失败"))); });
    await fixture.connect();
    const password = `Http!${randomBytes(16).toString("hex")}7a`, passwordHash = await hash(password, 12);
    for (const role of ["ADMIN", "PUBLISHER", "STUDENT", "COLLEGE", "COUNSELOR"] as const) {
      const id = `http-${runId}-${role}`;
      await fixture.query('INSERT INTO "User" (id,login,name,role,"passwordHash","mustChangePassword","updatedAt") VALUES ($1,$2,$3,$4,$5,false,now())', [id, `http-${role.toLowerCase()}`, role, role, passwordHash]);
      if (role === "STUDENT") await fixture.query('INSERT INTO "StudentProfile" ("userId","studentNumber",college,major,"className") VALUES ($1,$2,$3,$4,$5)', [id, "http-student", "学院", "专业", "班级"]);
    }
    const standalone = resolve(".next-production/standalone");
    await cp(resolve(".next-production/static"), resolve(standalone, ".next-production/static"), { recursive: true });
    server = spawn(process.execPath, [resolve(standalone, "server.js")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    server.once("error", () => { serverError = "隔离服务启动失败"; });
    server.stderr?.on("data", () => { serverError = "隔离服务出现运行错误"; });
    const startedAt = Date.now();
    while (true) {
      if (server.exitCode !== null || Date.now() - startedAt > 45_000) throw new Error(serverError || "隔离服务启动超时");
      try { const ready = await fetch(`${origin}/api/health/ready`, { signal: AbortSignal.timeout(1500) }); if (ready.ok) break; } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    class Session {
      jar = new Map<string, string>();
      async fetch(path: string, options: RequestInit = {}) {
        const headers = new Headers(options.headers); headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
        if (options.method && options.method !== "GET") headers.set("origin", origin);
        const response = await fetch(origin + path, { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
        for (const c of response.headers.getSetCookie()) { const pair = c.split(";")[0], i = pair.indexOf("="); this.jar.set(pair.slice(0, i), pair.slice(i + 1)); }
        return response;
      }
      async json(path: string, body?: unknown, method = "POST") {
        const response = await this.fetch(path, body === undefined ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json(); check(response.ok, `${method} ${path.split("?")[0]} 状态${response.status}${data?.error ? `：${data.error}` : ""}`); return data;
      }
      async form(path: string, body: FormData) {
        const response = await this.fetch(path, { method: "POST", body });
        const data = await response.json(); check(response.ok, `POST ${path.split("?")[0]} 状态${response.status}${data?.error ? `：${data.error}` : ""}`); return data;
      }
      async challenge() {
        const response = await this.fetch("/api/auth/captcha");
        check(response.ok && response.headers.get("cache-control") === "no-store", "验证码接口及缓存控制错误");
        const data = await response.json();
        check(Object.keys(data).sort().join(",") === "expiresAt,id,image" && data.image.startsWith("data:image/svg+xml;base64,"), "验证码响应泄露答案或图片缺失");
        // Only this isolated fixture DB receives a known answer. No runtime bypass.
        const answerHash = createHmac("sha256", env.NEXTAUTH_SECRET!).update(`login-captcha:${data.id}:ABCDE`).digest("hex");
        await fixture.query('UPDATE "LoginCaptcha" SET "answerHash"=$1 WHERE id=$2', [answerHash, data.id]);
        return { captchaId: data.id, captcha: "abcde" };
      }
      async credentials(login: string, selectedRole: string, inputPassword = password, captcha?: { captchaId: string; captcha: string }) {
        const csrf = await this.json("/api/auth/csrf");
        const body = new URLSearchParams({ csrfToken: csrf.csrfToken, login, password: inputPassword, role: selectedRole, ...captcha ?? await this.challenge(), callbackUrl: origin, json: "true" });
        const response = await this.fetch("/api/auth/callback/credentials", { method: "POST", body });
        return response.json();
      }
      async login(role: string) {
        await this.credentials(`http-${role.toLowerCase()}`, role === "PUBLISHER" ? "COLLEGE" : role);
        const session = await this.json("/api/auth/session"); check(session.user?.role === role, `${role}登录失败`);
      }
      async page(path: string) {
        const response = await this.fetch(path);
        const requested = new URL(path, origin);
        const html = await response.text();
        check(response.status === 200 && !html.includes('"digest":"') && !html.includes("Application error"), `${requested.pathname}页面失败`);
        return html;
      }
    }
    const anonymous = new Session();
    check((await anonymous.fetch("/")).status === 307, "匿名工作台须重定向");
    const login = await anonymous.fetch("/login"); check(login.status === 200, "登录页失败");
    const loginHtml = await login.text();
    check(loginHtml.includes('id="login-role"') && loginHtml.includes('id="login-captcha"'), "实际登录页缺少角色下拉或验证码字段");
    const assets = [...new Set([...loginHtml.matchAll(/(?:src|href)="([^" ]+\.(?:js|css)(?:\?[^" ]*)?)"/g)].map(m => m[1]))].filter(p => p.startsWith("/_next/"));
    check(assets.length > 0, "缺少页面静态资源");
    for (const path of assets) check((await anonymous.fetch(path)).status === 200, "静态资源不可访问");
    const admin = new Session(), student = new Session(), publisher = new Session();
    await admin.login("ADMIN"); await student.login("STUDENT"); await publisher.login("PUBLISHER");
    async function workbench(session: Session, role: string, title: string, termId?: string) {
      const html = await session.page(termId ? `/?termId=${termId}` : "/");
      check(new RegExp(`<h1[^>]*>${title}</h1>`).test(html), `${role}未渲染独立角色工作台`);
      for (const other of ["学校测评工作台", "学院工作台", "辅导员工作台", "活动工作台", "我的测评概览"].filter(value => value !== title)) {
        check(!new RegExp(`<h1[^>]*>${other}</h1>`).test(html), `${role}误用其他角色主体`);
      }
      results.push({ label: `${role} independent workbench${termId ? " with real data" : " without term"}`, status: 200 });
      return html;
    }
    await workbench(admin, "ADMIN", "学校测评工作台");
    await workbench(publisher, "PUBLISHER", "活动工作台");
    await workbench(student, "STUDENT", "我的测评概览");
    for (const [role, session, paths] of [["ADMIN", admin, ["/", "/account", "/accounts", "/students", "/terms", "/activities", "/recognitions", "/claims", "/grades", "/deductions", "/imports", "/results", "/publication", "/appeals", "/rankings", "/settings"]], ["STUDENT", student, ["/", "/account", "/profile", "/terms", "/my-activities", "/my-activities?view=feed", "/claims", "/results", "/appeals"]], ["PUBLISHER", publisher, ["/", "/account", "/terms", "/activities", "/recognitions"]]] as const) {
      for (const path of paths) { await session.page(path); results.push({ label: `${role} ${path}`, status: 200 }); }
    }
    check((await student.fetch("/api/admin/settings")).status === 403, "学生设置权限错误");
    check((await publisher.fetch("/api/claims?termId=invalid")).status === 403, "发布者申报权限错误");
    check((await student.fetch("/api/students")).status === 403, "学生名录不能向本人学生开放");
    const directory = await admin.json("/api/students?q=http-student&college=" + encodeURIComponent("学院"));
    check(directory.total === 1 && directory.items[0].studentProfile.className === "班级", "学生档案目录筛选失败");
    const selfId = `http-${runId}-STUDENT`;
    check((await student.fetch(`/api/students/${selfId}`)).status === 200, "原本人学生档案GET必须保留");
    let organization = await admin.json("/api/organizations", { kind: "college", code: "HTTP", name: "学院", enabled: true });
    const collegeId = organization.colleges.find((c: { code: string }) => c.code === "HTTP").id;
    await fixture.query('UPDATE "User" SET "collegeId"=$1 WHERE role IN (\'COLLEGE\',\'COUNSELOR\')', [collegeId]);
    const counselorId = `http-${runId}-COUNSELOR`;
    organization = await admin.json("/api/organizations", { kind: "major", code: "MAJOR", name: "专业", enabled: true, parentId: collegeId });
    const majorId = organization.colleges.find((c: { id: string }) => c.id === collegeId).majors[0].id;
    organization = await admin.json("/api/organizations", { kind: "class", code: "CLASS", name: "班级", enabled: true, parentId: majorId, counselorId });
    const classId = organization.colleges.find((c: { id: string }) => c.id === collegeId).majors[0].classes[0].id;
    const profile = await admin.json(`/api/students/${selfId}`, { revision: 0, reason: "隔离资料更正验证", name: "HTTP学生", classId }, "PATCH");
    check(profile.name === "HTTP学生" && profile.revision === 1, "档案更正没有返回最新记录");
    check(profile.studentProfile.classId === classId && profile.studentProfile.schoolClass.counselor.id === counselorId, "配置组织或责任辅导员未返回");
    const college = new Session(), counselor = new Session();
    await college.login("COLLEGE"); await counselor.login("COUNSELOR");
    const invalidEntry = new Session();
    await invalidEntry.credentials("http-counselor", "ADMIN");
    check(!(await invalidEntry.json("/api/auth/session")).user, "选择管理员入口不得获得权限");
    const invalidCaptcha = await invalidEntry.challenge();
    await invalidEntry.credentials("http-counselor", "COUNSELOR", password, { ...invalidCaptcha, captcha: "WRONG" });
    await invalidEntry.credentials("http-counselor", "COUNSELOR", password, invalidCaptcha);
    check(!(await invalidEntry.json("/api/auth/session")).user, "错误或重放验证码不应登录");
    results.push({ label: "four role dropdown login, wrong role and CAPTCHA replay denied", status: 200 });
    for (const [role, session, title] of [["COLLEGE", college, "学院工作台"], ["COUNSELOR", counselor, "辅导员工作台"]] as const) {
      await workbench(session, role, title);
      check((await session.json("/api/account")).college.id === collegeId, `${role}本人账号归属接口错误`);
      const deniedPassword = await session.fetch("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: "WrongOldPassword123!", newPassword: "UnusedNewPassword123!" }) });
      check(deniedPassword.status === 400, `${role}改密接口应正常鉴权并拒绝错误旧密码`);
      results.push({ label: `${role} correct workbench, own account and password validation`, status: 200 });
    }
    for (const [role, session, paths] of [["ADMIN", admin, ["/organizations"]], ["COLLEGE", college, ["/organizations", "/students", "/account", "/activities", "/recognitions", "/imports"]], ["COUNSELOR", counselor, ["/students", "/account", "/activities", "/recognitions"]]] as const) {
      for (const path of paths) { await session.page(path); results.push({ label: `${role} ${path} configured organization`, status: 200 }); }
    }
    check((await college.json("/api/students")).items[0].id === selfId && (await counselor.json("/api/students")).items[0].id === selfId, "学院和辅导员授权名录错误");
    check((await student.fetch("/api/organizations")).status === 403, "学生不能浏览组织管理目录");
    check((await counselor.fetch(`/api/students/${selfId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: 1, name: "越权修改", classId, reason: "辅导员不能改档案" }) })).status === 403, "辅导员不可借档案入口改学生身份");
    check((await admin.json(`/api/students/${selfId}`)).affiliationHistory[0].classId === classId, "归属历史未保存");
    const accounts = await admin.json("/api/admin/accounts?role=STUDENT&disabled=false");
    check(accounts.total === 1 && accounts.items[0].id === selfId, "账号角色/状态过滤失败");
    const originalSettings = await admin.json("/api/admin/settings");
    const publicSettings = await anonymous.json("/api/settings/public");
    check(Object.keys(publicSettings).sort().join(",") === "defaultThemeMode,faviconAssetId,loginBackgroundAssetId,loginCardBlur,loginNotice,logoAssetId,logoSize,pageTitle,siteDescription,siteName,themePreset", "公开设置未按白名单返回");
    check(!("revision" in publicSettings) && !("loginFailureLimitEnabled" in publicSettings), "公开设置泄露修订或登录策略");
    const invalidBackground = await admin.fetch("/api/admin/brand-assets", { method: "POST", headers: { "x-file-name": encodeURIComponent("fake.png"), "x-asset-kind": "login-background" }, body: Buffer.from("not an image") });
    check(invalidBackground.status === 400, "伪装成PNG的文本不能作为登录背景");
    const backgroundFile = await admin.fetch("/api/admin/brand-assets", { method: "POST", headers: { "x-file-name": encodeURIComponent("登录背景.png"), "x-asset-kind": "login-background" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
    const backgroundBody = await backgroundFile.text();
    check(backgroundFile.status === 200, `登录背景图片上传失败：${backgroundFile.status} ${backgroundBody.slice(0, 160)}`);
    const backgroundAsset = JSON.parse(backgroundBody);
    function settingsPayload(settings: typeof originalSettings) {
      return { siteName: settings.siteName, siteDescription: settings.siteDescription, pageTitle: settings.pageTitle, themePreset: settings.themePreset, defaultThemeMode: settings.defaultThemeMode, loginBackgroundAssetId: settings.loginBackgroundAssetId, loginNotice: settings.loginNotice, loginCardBlur: settings.loginCardBlur, logoAssetId: settings.logoAssetId, logoSize: settings.logoSize, faviconAssetId: settings.faviconAssetId, loginFailureLimitEnabled: settings.loginFailureLimitEnabled, loginFailureMaxAttempts: settings.loginFailureMaxAttempts, loginFailureLockMinutes: settings.loginFailureLockMinutes, revision: settings.revision };
    }
    check(originalSettings.loginFailureLimitEnabled === false, "失败限制必须默认关闭");
    const notice = "HTTP登录公告：请使用学校分配的账号登录。";
    const updatedSettings = await admin.json("/api/admin/settings", { ...settingsPayload(originalSettings), siteName: "HTTP持久化站点", pageTitle: "HTTP设置保存标题", siteDescription: "保存设置后回读", themePreset: "claude", defaultThemeMode: "dark", loginBackgroundAssetId: backgroundAsset.id, loginNotice: notice, loginCardBlur: 28, loginFailureLimitEnabled: true, loginFailureMaxAttempts: 2, loginFailureLockMinutes: 1, reason: "验证真实保存及登录限制" }, "PUT");
    const reread = await admin.json("/api/admin/settings");
    check(reread.revision === originalSettings.revision + 1 && reread.siteName === updatedSettings.siteName && reread.themePreset === "claude" && reread.defaultThemeMode === "dark" && reread.loginBackgroundAssetId === backgroundAsset.id && reread.loginNotice === notice && reread.loginCardBlur === 28 && reread.loginFailureMaxAttempts === 2 && reread.loginFailureLockMinutes === 1, "设置PUT后GET未持久化全部字段");
    const brandedLogin = await anonymous.page("/login");
    check(brandedLogin.includes("HTTP持久化站点") && brandedLogin.includes("HTTP设置保存标题") && brandedLogin.includes('data-theme-preset="claude"') && brandedLogin.includes('data-theme-mode="dark"') && brandedLogin.includes(notice) && brandedLogin.includes(`/api/brand-assets/${backgroundAsset.id}`), "登录页面未应用最新主题、公告或背景");
    check((await anonymous.fetch(`/api/brand-assets/${backgroundAsset.id}`)).status === 200, "已被引用的登录背景不能匿名读取");
    check((await admin.fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settingsPayload(originalSettings), reason: "过期保存应冲突" }) })).status === 409, "设置revision冲突保护失败");
    check((await student.fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settingsPayload(reread), reason: "学生不可更新安全策略" }) })).status === 403, "安全设置越权未拒绝");
    const failedLogin = new Session();
    await failedLogin.credentials("http-counselor", "COUNSELOR", "wrong-password");
    const lockedLogin = await failedLogin.credentials("http-counselor", "COUNSELOR", "wrong-password");
    check(new URL(lockedLogin.url, origin).searchParams.get("error") === "LoginLocked", "达到失败次数未锁定");
    await failedLogin.credentials("http-counselor", "COUNSELOR");
    check(!(await failedLogin.json("/api/auth/session")).user, "锁定期间正确密码不应登录");
    check((await counselor.json("/api/account")).role === "COUNSELOR", "失败限制不应撤销已有有效会话");
    await admin.json("/api/admin/settings", { ...settingsPayload(originalSettings), revision: reread.revision, reason: "验证后恢复原始设置" }, "PUT");
    await failedLogin.login("COUNSELOR");
    results.push({ label: "settings theme/information persistence and configurable login lock/disable", status: 200 });
    const draft = await admin.json("/api/terms", { name: "误建HTTP草稿", template: false });
    check((await admin.json(`/api/terms/${draft.id}`)).canDelete, "空白草稿应可删除");
    await admin.json(`/api/terms/${draft.id}`, { action: "delete", revision: 0, reason: "误建回收站验证" }, "PATCH");
    check((await admin.json("/api/terms?view=deleted")).some((row: { id: string }) => row.id === draft.id), "回收站未列出删除周期");
    check((await student.fetch(`/api/activities?termId=${draft.id}`)).status === 404, "回收站旧业务URL仍可读取");
    await admin.json(`/api/terms/${draft.id}`, { action: "restore", revision: 1, reason: "恢复误删验证" }, "PATCH");
    await admin.json(`/api/terms/${draft.id}/scheme`, { action: "activate", revision: 2 });
    await admin.json(`/api/terms/${draft.id}`, { action: "void", revision: 3, reason: "误开且未发布作废验证" }, "PATCH");
    const voidClaims = await student.page(`/claims?termId=${draft.id}`);
    check(voidClaims.includes("已作废") && !buttonTexts(voidClaims).includes("新建成果申报"), "作废周期应保留历史并隐藏新建入口");
    check((await admin.fetch(`/api/terms/${draft.id}/scheme`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", revision: 4, scheme: draft.scheme }) })).status === 409, "作废周期仍可写规则");
    results.push({ label: "term recycle/restore/void and historical UI write protection", status: 200 });
    const term = await admin.json("/api/terms", { name: "隔离HTTP测评", template: false });
    await admin.json(`/api/terms/${term.id}/scheme`, { action: "activate", revision: term.revision });
    const emptyClaims = await student.page(`/claims?termId=${term.id}`);
    check(emptyClaims.includes("暂无成果申报") && buttonTexts(emptyClaims).includes("新建成果申报"), "学生默认申报页应直接提供新建申报，而不是等待项目配置");
    check(!buttonTexts(emptyClaims).includes("新建认定项目"), "学生不能创建已取消的认定项目");
    results.push({ label: "STUDENT /claims direct submission action without project catalog", status: 200 });
    const audience = { scope: "CLASS", colleges: [], classes: [{ college: "学院", major: "专业", className: "班级" }] };
    const activityStartsAt = new Date(Date.now() - 86_400_000).toISOString(), activityEndsAt = new Date(Date.now() + 86_400_000).toISOString();
    const activity = await college.json("/api/activities", { termId: term.id, action: "save", activity: { name: "完整工作区活动", organizer: "学院", content: "活动内容与参与要求", startsAt: activityStartsAt, endsAt: activityEndsAt, nodeId: "total", points: "1", audience } });
    check(activity.college?.id === collegeId, "主办学院创建活动未归属本院");
    check((await publisher.fetch("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termId: term.id, action: "save", activity: { name: "发布者新建应被阻断", organizer: "学院", content: "内容", startsAt: activityStartsAt, endsAt: activityEndsAt, nodeId: "total", points: "2", audience } }) })).status === 403, "历史发布者不应创建新活动");
    // 历史发布者的既有活动以隔离夹具数据保留，由管理员受控移交主办学院。
    const publisherActivityId = `http-${runId}-pubact`;
    await fixture.query('INSERT INTO "Activity" (id,"termId","ownerId",name,organizer,content,"startsAt","endsAt","nodeId",points,confirmed,"publishRevision","audienceScope","audienceColleges","audienceClasses",revision,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,0,\'CLASS\',$11,$12,0,now(),now())', [publisherActivityId, term.id, `http-${runId}-PUBLISHER`, "发布者专属运营活动", "学院", "本人负责活动的完整内容", activityStartsAt, activityEndsAt, "total", "2", audience.colleges, audience.classes.map(item => JSON.stringify([item.college, item.major, item.className]))]);
    await admin.json("/api/activities", { termId: term.id, action: "reassign", id: publisherActivityId, revision: 0, collegeId, reason: "隔离检查历史活动归属移交" });
    const audiencePreview = await college.json("/api/activities/audience", { action: "preview", termId: term.id, audience });
    check(audiencePreview.count === 1 && audiencePreview.errors.length === 0, "学院与班级范围预检失败");
    const publishedActivity = await college.json("/api/activities", { termId: term.id, action: "publish", id: activity.id, revision: 0 });
    check(publishedActivity.publishedAt, "主办学院发布活动失败");
    check((await student.json(`/api/activities?termId=${term.id}&view=feed`)).total === 1, "学生信息流未按已发布范围显示");
    check((await student.json(`/api/activities?termId=${term.id}`)).total === 0, "发布活动不应冒充后台参与登记");
    const ownerFile = await college.fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent("活动签到与合影.png") }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
    check(ownerFile.status === 201, "活动共享证明上传失败");
    const ownerEvidence = await ownerFile.json();
    const sharedEvidence = await college.json("/api/activities", { termId: term.id, action: "evidence", activityId: activity.id, revision: publishedActivity.revision, evidenceId: ownerEvidence.id, note: "活动签到表与现场合影" });
    check(sharedEvidence.version === 1 && sharedEvidence.active && sharedEvidence.evidence.id === ownerEvidence.id, "活动证明版本未建立");
    const rosterForm = () => {
      const form = new FormData();
      form.append("termId", term.id); form.append("action", "preview"); form.append("activityId", activity.id); form.append("kind", "INITIAL"); form.append("note", "正式参与名单");
      form.append("file", new Blob(["\uFEFF学号,姓名,学院,专业,班级\r\nhttp-student,HTTP学生,学院,专业,班级\r\n"], { type: "text/csv" }), "参与名单.csv");
      return form;
    };
    const importPreview = await college.form("/api/participation-import", rosterForm());
    check(importPreview.errors === 0 && importPreview.rows[0]?.state === "NEW" && importPreview.rows[0]?.login === "http-student", "完整身份名单预检失败");
    await college.form("/api/participation-import", (() => { const form = new FormData(); form.append("termId", term.id); form.append("action", "commit"); form.append("id", importPreview.id); return form; })());
    check((await college.fetch("/api/participation-import", { method: "POST", body: rosterForm() })).status === 409, "首份正式名单提交后未封存普通导入");
    check((await student.json(`/api/activities?termId=${term.id}`)).total === 1, "名单提交后本人活动目录未出现");
    const participants = await college.json(`/api/activities/participants?termId=${term.id}&activityId=${activity.id}`);
    check(participants.total === 1 && participants.items[0].login === "http-student" && activity.points === "1", "参与名录缺少身份快照或固定分");
    const source = participants.items[0].sources[0];
    check(source.status === "PENDING_COUNSELOR" && source.activityEvidenceId === sharedEvidence.id, "参与来源未绑定当前活动证明或初审状态");
    check((await publisher.fetch(`/api/activities/participants?termId=${term.id}&activityId=${activity.id}`)).status === 404, "非主办发布者不得查看活动参与名单");
    check((await student.fetch("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termId: term.id, action: "counselorApprove", id: source.id, revision: source.revision }) })).status === 403, "学生不得自行通过活动参与审核");
    const counselorApproved = await counselor.json("/api/activities", { termId: term.id, action: "counselorApprove", id: source.id, revision: source.revision });
    check(counselorApproved.status === "PENDING_COLLEGE", "辅导员初核未提交归属学院");
    const activityApproved = await college.json("/api/activities", { termId: term.id, action: "collegeApprove", id: source.id, revision: counselorApproved.revision, reason: "材料与固定分核对无误" });
    check(activityApproved.status === "APPROVED", "学院终审未通过活动参与");
    const ownActivities = await student.json(`/api/activities?termId=${term.id}`);
    check(ownActivities.items[0].points === "1" && ownActivities.items[0].ownParticipation.sources[0].status === "APPROVED", "本人活动详情缺少固定分或审核状态");
    check((await student.json(`/api/results?termId=${term.id}`)).result.total === "1.00", "活动认定未进入真实结果计分");
    await student.page(`/my-activities?termId=${term.id}&view=feed`);
    await student.page(`/my-activities?termId=${term.id}`);
    await admin.page(`/activities/${activity.id}`);
    await college.page(`/recognitions?termId=${term.id}`);
    await counselor.page(`/recognitions?termId=${term.id}`);
    const importPage = await college.page(`/imports?termId=${term.id}&kind=participation`);
    check(importPage.includes("完整工作区活动"), "参与名单导入页未直接列出本人主办活动");
    results.push({ label: "COLLEGE host activity, shared evidence, full roster import and two-stage review", status: 200 });
    for (const [route, title] of [["grades", "成绩录入与审核"], ["deductions", "扣分管理与审核"]] as const) {
      const selected = await admin.page(`/${route}?termId=${term.id}`);
      check(selected.includes(title) && selected.includes("隔离HTTP测评"), `/${route} 未加载所选周期`);
      results.push({ label: `ADMIN /${route} selected term workspace`, status: 200 });
    }
    check((await admin.json(`/api/grades?termId=${term.id}&studentLogin=http-student`)).student.name === "HTTP学生", "成绩录入接口未返回指定学生");
    check(Array.isArray((await admin.json(`/api/deductions?termId=${term.id}&studentLogin=http-student`)).records), "扣分接口未返回指定学生记录");
    results.push({ label: "ADMIN grades/deductions exact student APIs", status: 200 });
    const publisherHome = await workbench(publisher, "PUBLISHER", "活动工作台", term.id);
    check(publisherHome.includes("发布者专属运营活动") && !publisherHome.includes("完整工作区活动"), "发布者工作台活动归属不正确");
    for (const [role, session, route] of [["ADMIN", admin, "/activities"], ["STUDENT", student, "/my-activities"]] as const) {
      const html = await session.page(route);
      check(html.includes("隔离HTTP测评") && html.includes("完整工作区活动"), `${role} ${route} 默认周期没有直接加载真实活动内容（term=${html.includes("隔离HTTP测评")}，activity=${html.includes("完整工作区活动")}）`);
      results.push({ label: `${role} ${route} default context with real row`, status: 200 });
    }
    for (const tab of ["overview", "scheme"]) {
      const html = await admin.page(`/terms/${term.id}?tab=${tab}`);
      check(html.includes("隔离HTTP测评") && html.includes("评分方案") && html.includes("周期总览"), "周期工作区缺少业务导航或当前上下文");
      results.push({ label: `ADMIN /terms/[id] tab=${tab}`, status: 200 });
    }
    for (const [role, session] of [["COLLEGE", college], ["COUNSELOR", counselor]] as const) {
      const html = await session.page(`/terms/${term.id}?tab=scheme`);
      check(html.includes(term.scheme.nodes[0].name) && html.includes("评分模块与规则") && buttonTexts(html).includes("规则明细") && !buttonTexts(html).includes("添加大模块") && !buttonTexts(html).includes("设置") && !buttonTexts(html).includes("保存制度"), `${role}评分制度只读失效`);
      results.push({ label: `${role} full readonly scheme list`, status: 200 });
    }
    const studentResults = await admin.json(`/api/results/students?termId=${term.id}&q=http-student`);
    check(studentResults.total === 1 && studentResults.items[0].complete === true && studentResults.items[0].total === "1.00", "默认结果名录没有返回真实学生与计分");
    check((await student.fetch(`/api/results/students?termId=${term.id}`)).status === 403, "结果名录泄露他人成绩");
    const enabledClaims = await student.page(`/claims?termId=${term.id}`);
    const adminClaims = await admin.page(`/claims?termId=${term.id}`);
    check(buttonTexts(enabledClaims).includes("新建成果申报"), "学生默认申报记录页首屏缺少新建申报主操作");
    check(!buttonTexts(enabledClaims).includes("新建认定项目"), "学生误获管理员项目操作");
    check(!buttonTexts(adminClaims).includes("新建认定项目") && !buttonTexts(adminClaims).includes("新建成果申报"), "管理员不应恢复项目配置或代学生申报");
    results.push({ label: "STUDENT /claims visible primary submission action", status: 200 });
    results.push({ label: "ADMIN /claims supervision without discontinued project action", status: 200 });
    const projectWrite = await admin.fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termId: term.id, name: "应被拒绝的项目", description: "目录已取消", nodeId: "total", points: "3", enabled: true }) });
    check(projectWrite.status === 403, "已取消的认定项目写接口仍可创建配置");
    const file = await student.fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent("证明.png") }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
    check(file.status === 201, "证明上传失败"); const evidence = await file.json();
    const forgedClaim = await student.fetch("/api/claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termId: term.id, title: "伪造评分申报", occurredOn: "2026-10-01", note: "携带学生自报分数", evidenceIds: [evidence.id], score: "99", projectId: "forged", factKey: "HTTP-1", activityId: "forged" }) });
    check(forgedClaim.status === 400, "学生伪造评分或旧关联字段未被拒绝");
    check((await student.json(`/api/claims?termId=${term.id}`)).total === 0, "伪造申报不应产生任何记录");
    const claim = await student.json("/api/claims", { termId: term.id, title: "个人成果", occurredOn: "2026-10-01", note: "成果完整说明", evidenceIds: [evidence.id] });
    check(claim.status === "PENDING_COUNSELOR" && claim.score === null, "学生直接申报未进入辅导员初审");
    check((await counselor.json(`/api/claims?termId=${term.id}`)).items.some((row: { id: string }) => row.id === claim.id), "责任辅导员初审队列缺少本人班级申报");
    check((await college.json(`/api/claims?termId=${term.id}`)).items.some((row: { id: string }) => row.id === claim.id), "学院终审队列缺少本院学生申报");
    check((await college.fetch(`/api/claims/${claim.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termId: term.id, revision: claim.revision, action: "approve" }) })).status === 409, "未经辅导员评分不应允许学院终审");
    check((await admin.fetch(`/api/claims/${claim.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ termId: term.id, revision: claim.revision, action: "submitScore", nodeId: "total", score: "3" }) })).status === 403, "管理员不应代替辅导员评分");
    const scoredClaim = await counselor.json(`/api/claims/${claim.id}`, { termId: term.id, revision: claim.revision, action: "submitScore", nodeId: "total", score: "3" }, "PATCH");
    check(scoredClaim.status === "PENDING_COLLEGE" && scoredClaim.score === "3", "辅导员评分未提交学院");
    results.push({ label: "direct claim, forged score rejection and counselor scoring", status: 200 });
    for (const [role, session] of [["ADMIN", admin], ["STUDENT", student], ["COLLEGE", college], ["COUNSELOR", counselor]] as const) {
      const previewFile = await session.fetch(`/api/evidence/${evidence.id}?disposition=inline`);
      check(previewFile.ok && previewFile.headers.get("content-type") === "image/png" && previewFile.headers.get("content-disposition")?.startsWith("inline;") && previewFile.headers.get("cache-control") === "private, no-store" && previewFile.headers.get("x-content-type-options") === "nosniff" && previewFile.headers.get("x-frame-options") === "SAMEORIGIN", `${role}授权图片预览或私有响应头错误`);
      check((await previewFile.arrayBuffer()).byteLength === evidence.size, `${role}预览未返回完整原文件`);
      const download = await session.fetch(`/api/evidence/${evidence.id}`);
      check(download.ok && download.headers.get("content-disposition")?.startsWith("attachment;"), `${role}下载兼容错误`);
      results.push({ label: `${role} scoped evidence inline preview and original download`, status: 200 });
    }
    check((await publisher.fetch(`/api/evidence/${evidence.id}?disposition=inline`)).status === 403, "非归属活动负责人不得查看申报证明");
    check((await anonymous.fetch(`/api/evidence/${evidence.id}?disposition=inline`)).status === 401, "匿名预览泄露私有文件");
    check((await student.fetch(`/api/evidence/${evidence.id}?disposition=unsafe`)).status === 400, "证明disposition未限制白名单");
    // Build a valid one-page PDF fixture; native browser rendering remains user UAT.
    const content = "BT /F1 14 Tf 30 100 Td (Evidence preview) Tj ET";
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 160] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    let pdf = "%PDF-1.4\n"; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const pdfUpload = await student.fetch("/api/evidence", { method: "POST", headers: { "x-file-name": encodeURIComponent("浏览器预览证明.pdf") }, body: Buffer.from(pdf) });
    check(pdfUpload.status === 201, "PDF证明上传失败");
    const pdfEvidence = await pdfUpload.json();
    const pdfPreview = await student.fetch(`/api/evidence/${pdfEvidence.id}?disposition=inline`);
    check(pdfPreview.ok && pdfPreview.headers.get("content-type") === "application/pdf" && pdfPreview.headers.get("content-disposition")?.startsWith("inline;") && Buffer.from(await pdfPreview.arrayBuffer()).equals(Buffer.from(pdf)), "PDF内联预览内容或响应头错误");
    results.push({ label: "PDF inline bytes and unauthorized preview rejection", status: 200 });
    const adminHome = await workbench(admin, "ADMIN", "学校测评工作台", term.id);
    check(adminHome.includes("个人成果") && adminHome.includes("HTTP学生") && adminHome.includes("全校待办进度") && adminHome.includes("各周期发布进度"), "管理员工作台缺少真实审核和发布数据");
    const studentHome = await workbench(student, "STUDENT", "我的测评概览", term.id);
    check(studentHome.includes("个人成果") && studentHome.includes("评分模块") && !studentHome.includes("全校待办进度") && !studentHome.includes("各周期发布进度"), "学生工作台未展示本人记录或误含管理主体");
    for (const [role, session] of [["COLLEGE", college], ["COUNSELOR", counselor]] as const) {
      const html = await session.page(`/claims?termId=${term.id}`);
      check(html.includes("个人成果") && html.includes("待学院审核"), `${role}申报页面缺少待学院审核记录`);
      results.push({ label: `${role} /claims pending college review visible`, status: 200 });
    }
    const approvedClaim = await college.json(`/api/claims/${claim.id}`, { termId: term.id, revision: scoredClaim.revision, action: "approve", reason: "材料完整属实" }, "PATCH");
    check(approvedClaim.status === "APPROVED", "学院终审未通过");
    results.push({ label: "college final approval after counselor scoring", status: 200 });
    const preview = await admin.json(`/api/terms/${term.id}/publication`, { action: "preview" }); check(preview.canPublish, "完整结果应可发布");
    const publication = await admin.json(`/api/terms/${term.id}/publication`, { action: "publish", revision: preview.termRevision, inputRevision: preview.inputRevision, token: preview.token, checkingEndsAt: new Date(Date.now() + 4500).toISOString(), requireConfirmation: true, requestId: randomUUID() });
    const result = await student.json(`/api/results?termId=${term.id}`); check(result.result.total === "4.00", "结果计分不一致");
    check(result.participations[0]?.name === "完整工作区活动" && result.participations[0]?.points === "1", "冻结结果丢失活动参与或固定分");
    check(result.claims[0].name === "个人成果" && result.claims[0].evidenceIds.includes(evidence.id), "冻结结果丢失申报标题或原证明关联");
    await student.json(`/api/results/${publication.id}/confirm`, { termId: term.id, resultHash: result.resultHash });
    const publishedHome = await workbench(student, "STUDENT", "我的测评概览", term.id);
    check(publishedHome.includes("已发布综合成绩") && publishedHome.includes("4.00") && publishedHome.includes("已发布第"), "学生工作台没有使用固定发布成绩");
    const appeal = await student.json("/api/appeals", { termId: term.id, publicationId: publication.id, resultHash: result.resultHash, target: "总分", reason: "核对计分依据", evidenceIds: [] });
    await admin.json(`/api/appeals/${appeal.id}`, { termId: term.id, revision: 0, action: "reject", resolution: "依据计分规则核对无误" }, "PATCH");
    await new Promise(r => setTimeout(r, 4600));
    const lock = await admin.json(`/api/terms/${term.id}/settlement`, { action: "preview" }); check(!lock.blockers.length, "锁定预检未通过");
    const snapshot = await admin.json(`/api/terms/${term.id}/settlement`, { action: "lock", revision: lock.revision, token: lock.token, requestId: randomUUID() });
    check((await admin.json(`/api/snapshots/${snapshot.id}`)).sha256 === snapshot.sha256, "快照校验失败");
    const lockedClaims = await student.page(`/claims?termId=${term.id}`);
    check(!buttonTexts(lockedClaims).includes("新建成果申报") && lockedClaims.includes("已锁定"), "锁定周期应说明不能新增申报，并保留历史查询");
    check(lockedClaims.includes("个人成果") && lockedClaims.includes("已通过"), "锁定后应首屏保留本人真实申报记录");
    results.push({ label: "STUDENT /claims locked explanation and real history", status: 200 });
    check((await admin.fetch(`/api/rankings/export?termId=${term.id}`)).status === 200, "排名下载失败");
    check((await admin.json(`/api/grades?termId=${term.id}&studentLogin=http-student`)).student.name === "HTTP学生", "锁定周期成绩只读失败");
    check(Array.isArray((await admin.json(`/api/deductions?termId=${term.id}&studentLogin=http-student`)).records), "锁定周期扣分只读失败");
    const management = await admin.json(`/api/terms/${term.id}`);
    check(management.canArchive && !management.canDelete && !management.canVoid, "有发布/快照周期错误允许删除作废");
    const archived = await admin.json(`/api/terms/${term.id}`, { action: "archive", revision: management.revision, reason: "结算后归档验证" }, "PATCH");
    check((await student.json(`/api/results?termId=${term.id}`)).result.total === "4.00", "归档后本人冻结成绩不可读");
    check((await admin.json(`/api/snapshots/${snapshot.id}`)).sha256 === snapshot.sha256, "归档错误改变快照");
    const archivedPublication = await admin.page(`/publication?termId=${term.id}`);
    check(archivedPublication.includes("归档") && !buttonTexts(archivedPublication).includes("重开周期"), "归档入口未正确只读");
    check((await admin.fetch(`/api/terms/${term.id}/settlement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", revision: archived.revision, reason: "禁止直接重开归档" }) })).status === 409, "归档仍允许直接重开");
    results.push({ label: "archived publication/snapshot frozen and reopen blocked", status: 200 });
    for (const path of ["activities", "claims", "results", "publication", "rankings", "appeals"]) { await admin.page(`/${path}?termId=${term.id}`); results.push({ label: `ADMIN /${path} with term`, status: 200 }); }
    await mkdir(".local", { recursive: true });
    await writeFile(".local/http-check-summary.json", JSON.stringify({ at: new Date().toISOString(), mode: "standalone production / isolated database / temporary attachments / port 3012 / HTTP only", passed: true, pages: results, assets: assets.length, workflows: ["四类角色选择及历史身份登录", "一次性验证码及错误重放", "可配置失败锁定及关闭", "系统信息/主题/登录背景/公告/默认深色PUT持久化与登录应用", "公开设置白名单与伪装图片拒绝", "周期回收站/恢复/作废/归档及只读保护", "完整制度只读角色", "四类角色限域图片预览及PDF内联/下载", "管理员、发布者、学生工作台及学院/辅导员真实入口", "学生工作台固定发布成绩", "独立职责页面与静态资源", "默认周期直接加载真实活动", "主办学院活动、共享证明与历史活动受控移交", "完整身份参与名单导入、首份封存与两级审核", "学生档案名录及理由更正", "账号角色状态过滤", "真实学生结果名录", "权限拒绝", "个人申报直接提交、辅导员评分、学院终审与伪造字段拒绝", "审核与计分", "发布确认及异议", "结算快照校验", "锁定后成绩扣分只读", "排名CSV"], browser: "本HTTP检查不操作浏览器；登录页与主题的浏览器验收由独立Playwright脚本完成并归档截图" }, null, 2));
    console.log(`隔离生产HTTP检查通过：${results.length}个角色页面检查、${assets.length}个静态资源及活动参与、申报到结算闭环；未运行浏览器。`);
  } finally {
    if (server && server.exitCode === null) { const stopped = new Promise<void>(done => server!.once("exit", () => done())); server.kill(); await stopped; }
    await fixture.end().catch(() => {});
    if (databaseCreated && /^campus_http_[a-f0-9]{12}$/.test(name)) await adminDb.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await adminDb.end();
    if (attachments.startsWith(join(tmpdir(), "campus-http-"))) await rm(attachments, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "隔离HTTP检查失败"); process.exit(1); });
