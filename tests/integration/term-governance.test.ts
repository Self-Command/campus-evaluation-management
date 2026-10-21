import { beforeAll, afterAll, expect, test } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { hash } from "bcryptjs";
import { db } from "@/server/db";
import { createTerm, saveScheme, activateTerm, manageTerm, listTerms, readTermManagement } from "@/server/terms";
import { pageActivities, saveActivity } from "@/server/activities";
import { pageRecognitions } from "@/server/recognitions";
import { authenticateCredentials } from "@/server/auth";
import { correctScoring } from "@/server/corrections";
import { publicSettings, saveSettings } from "@/server/settings";
import { previewPublication, publishResults, previewSettlement, lockSettlement, reopenTerm, listSnapshots } from "@/server/publications";
import { getStudentResult } from "@/server/results";
import { nodeSchema } from "@/lib/scoring/types";
import type { Role } from "@/generated/prisma/client";
import { captchaAnswerHash, consumeLoginCaptcha, issueLoginCaptcha } from "@/server/login-captcha";

const database = new URL(process.env.DATABASE_URL!);
if (database.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(database.pathname)) throw new Error("必须由隔离运行器执行");
const prefix = `govern-${randomUUID().slice(0, 8)}`;
const identities: Partial<Record<Role, { id: string; login: string; session: string }>> = {};
const terms: string[] = [];
const password = `Fixture!${randomUUID()}7a`;
const admin = () => identities.ADMIN!.session;
let originalSettings: Awaited<ReturnType<typeof db.siteSettings.findUnique>>;
function settingContent(value: Awaited<ReturnType<typeof publicSettings>>) {
  return { siteName: value.siteName, siteDescription: value.siteDescription, pageTitle: value.pageTitle, themePreset: value.themePreset, logoAssetId: value.logoAssetId, faviconAssetId: value.faviconAssetId, loginFailureLimitEnabled: value.loginFailureLimitEnabled, loginFailureMaxAttempts: value.loginFailureMaxAttempts, loginFailureLockMinutes: value.loginFailureLockMinutes };
}
async function challenge(answer = "ABCDE", expiresAt = new Date(Date.now() + 300_000)) {
  const id = randomUUID();
  await db.loginCaptcha.create({ data: { id, answerHash: captchaAnswerHash(id, answer), expiresAt } });
  return { captchaId: id, captcha: answer.toLowerCase() };
}
const failureKey = (login: string) => createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(`login-failure:${login.toLowerCase()}`).digest("hex");
async function loginAttempt(login: string, input: { password?: string; role?: string } = {}) {
  return authenticateCredentials({ login, password, role: "COUNSELOR", ...input, ...await challenge() });
}
async function policy(enabled: boolean, attempts = 2, minutes = 3) {
  const current = await publicSettings();
  return saveSettings(admin(), { ...settingContent(current), revision: current.revision, loginFailureLimitEnabled: enabled, loginFailureMaxAttempts: attempts, loginFailureLockMinutes: minutes, reason: "隔离核对登录失败限制" });
}
async function period(name: string, sourceTermId?: string) {
  const term = await createTerm(admin(), { name: `${prefix}-${name}`, template: false, ...(sourceTermId ? { sourceTermId } : {}) });
  terms.push(term.id); return term;
}
beforeAll(async () => {
  originalSettings = await db.siteSettings.findUnique({ where: { id: "site" } });
  const passwordHash = await hash(password, 12);
  for (const role of ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT", "PUBLISHER"] as const) {
    const login = `${prefix}-${role}`;
    const user = await db.user.create({ data: { login, name: role, role, passwordHash, mustChangePassword: false,
      ...(role === "STUDENT" ? { studentProfile: { create: { studentNumber: login, college: "隔离学院", major: "隔离专业", className: "隔离班" } } } : {}) } });
    const session = await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } });
    identities[role] = { id: user.id, login, session: session.id };
  }
});
afterAll(async () => {
  if (terms.length) {
    await db.resultConfirmation.deleteMany({ where: { result: { publication: { termId: { in: terms } } } } });
    await db.publishedResult.deleteMany({ where: { publication: { termId: { in: terms } } } });
    await db.termReopen.deleteMany({ where: { termId: { in: terms } } });
    await db.settlementSnapshot.deleteMany({ where: { termId: { in: terms } } });
    await db.resultPublication.deleteMany({ where: { termId: { in: terms } } });
    await db.gradeInput.deleteMany({ where: { termId: { in: terms } } });
    await db.activity.deleteMany({ where: { termId: { in: terms } } });
    await db.term.deleteMany({ where: { id: { in: terms } } });
  }
  await db.auditEvent.deleteMany({ where: { actorId: { in: Object.values(identities).map(identity => identity.id) } } });
  await db.user.deleteMany({ where: { id: { in: Object.values(identities).map(identity => identity.id) } } });
  if (originalSettings) await db.siteSettings.upsert({ where: { id: "site" }, create: { id: "site", content: originalSettings.content!, revision: originalSettings.revision, updatedAt: originalSettings.updatedAt }, update: { content: originalSettings.content!, revision: originalSettings.revision, updatedAt: originalSettings.updatedAt } });
  else await db.siteSettings.deleteMany({ where: { id: "site" } });
  await db.$disconnect();
});

test("草稿回收站可恢复，旧URL禁读写，权限理由与同名恢复均复核", async () => {
  let term = await period("mistake");
  expect((await readTermManagement(admin(), term.id)).canDelete).toBe(true);
  await expect(manageTerm(identities.STUDENT!.session, term.id, { action: "delete", revision: 0, reason: "误建周期" })).rejects.toThrow("权限");
  await expect(manageTerm(admin(), term.id, { action: "delete", revision: 0, reason: "" })).rejects.toThrow();
  term = await manageTerm(admin(), term.id, { action: "delete", revision: 0, reason: "误建周期" });
  expect(term.disposition).toBe("DELETED");
  expect((await listTerms(admin())).some(item => item.id === term.id)).toBe(false);
  expect((await listTerms(admin(), { view: "deleted" })).some(item => item.id === term.id)).toBe(true);
  await expect(listTerms(identities.COUNSELOR!.session, { view: "all" })).rejects.toThrow("权限");
  await expect(pageActivities(admin(), term.id)).rejects.toThrow("不存在");
  await expect(pageRecognitions(admin(), term.id)).rejects.toThrow("不存在");
  await expect(saveScheme(admin(), term.id, { revision: 1, scheme: term.scheme })).rejects.toThrow("不存在");
  const duplicate = await period("mistake");
  await expect(manageTerm(admin(), term.id, { action: "restore", revision: 1, reason: "撤销误删" })).rejects.toThrow("同名");
  await expect(manageTerm(admin(), term.id, { action: "restore", revision: 1, reason: "不得伪装恢复名称", name: `${prefix}-pretend` })).rejects.toThrow("同名");
  await manageTerm(admin(), duplicate.id, { action: "rename", revision: 0, reason: "区分周期", name: `${prefix}-renamed` });
  const restored = await manageTerm(admin(), term.id, { action: "restore", revision: 1, reason: "撤销误删" });
  expect(restored.id).toBe(term.id); expect(restored.disposition).toBe("NORMAL"); expect(restored.revision).toBe(2);
  expect((await db.term.findUniqueOrThrow({ where: { id: term.id } })).scheme).toEqual(term.scheme);
});

test("业务引用阻止删除及删除模块，作废保留原记录并禁止后续业务写入，复制只复制规则", async () => {
  const term = await period("referenced");
  const activity = await db.activity.create({ data: { termId: term.id, ownerId: identities.ADMIN!.id, name: "原有活动", organizer: "隔离组织", content: "真实引用夹具", requirements: "无", startsAt: new Date(), endsAt: new Date(), nodeId: "total", points: "2" } });
  const usage = await readTermManagement(admin(), term.id);
  expect(usage.usage.activities).toBe(1); expect(usage.nodeUsage.total).toBe(1); expect(usage.canDelete).toBe(false);
  await expect(manageTerm(admin(), term.id, { action: "delete", revision: 0, reason: "不应删除" })).rejects.toThrow("业务记录");
  const changed = { nodes: [nodeSchema.parse({ id: "total", name: "改成成绩", parentId: null, kind: "GRADE", order: 0 })], deductions: [] };
  await expect(saveScheme(admin(), term.id, { revision: 0, scheme: changed })).rejects.toThrow("类型改变");
  const copied = await period("copied", term.id);
  expect(copied.scheme).toEqual(term.scheme); expect(copied.inputRevision).toBe(0);
  expect(Object.values((await readTermManagement(admin(), copied.id)).usage).every(value => value === 0)).toBe(true);
  await manageTerm(admin(), term.id, { action: "void", revision: 0, reason: "误开测评，保留已有材料" });
  expect((await pageActivities(admin(), term.id)).total).toBe(1);
  expect(await db.activity.findUnique({ where: { id: activity.id } })).toEqual(activity);
  await expect(saveScheme(admin(), term.id, { revision: 1, scheme: term.scheme })).rejects.toThrow("作废");
  await expect(correctScoring(admin(), term.id, { kind: "scheme", action: "preview", scheme: term.scheme })).rejects.toThrow("作废");
  await expect(saveActivity(admin(), term.id, { name: "禁止新增", organizer: "隔离", content: "说明", requirements: "要求", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 10000).toISOString(), nodeId: "total", points: "1" })).rejects.toThrow();
});

test("删除与开启并发仅一方成功，旧revision不能重放管理操作，同名创建不产生重复", async () => {
  const term = await period("concurrent");
  const outcomes = await Promise.allSettled([
    manageTerm(admin(), term.id, { action: "delete", revision: 0, reason: "撤销误建" }),
    activateTerm(admin(), term.id, { revision: 0 }),
  ]);
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
  await expect(manageTerm(admin(), term.id, { action: "rename", revision: 0, reason: "过期操作", name: `${prefix}-old` })).rejects.toThrow("已变化");
  const name = `${prefix}-same`;
  const created = await Promise.allSettled([createTerm(admin(), { name }), createTerm(admin(), { name })]);
  for (const result of created) if (result.status === "fulfilled") terms.push(result.value.id);
  expect(created.filter(result => result.status === "fulfilled")).toHaveLength(1);
});

test("真实发布锁定后归档仍可查本人冻结结果，禁止作废及直接重开，快照原文不改", async () => {
  let term = await period("archive");
  term = await activateTerm(admin(), term.id, { revision: 0 });
  const preview = await previewPublication(admin(), term.id);
  const published = await publishResults(admin(), term.id, { revision: preview.termRevision, inputRevision: preview.inputRevision, token: preview.token, requestId: randomUUID(), checkingEndsAt: new Date(Date.now() + 1000).toISOString(), requireConfirmation: false });
  const before = await getStudentResult(identities.STUDENT!.session, term.id);
  await new Promise(resolve => setTimeout(resolve, 1100));
  const state = await previewSettlement(admin(), term.id);
  expect(state.blockers).toEqual([]);
  const snapshot = await lockSettlement(admin(), term.id, { revision: state.revision, token: state.token, requestId: randomUUID() });
  const original = await db.settlementSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
  term = await db.term.findUniqueOrThrow({ where: { id: term.id } });
  const archived = await manageTerm(admin(), term.id, { action: "archive", revision: term.revision, reason: "本周期正常结束" });
  expect(archived.disposition).toBe("ARCHIVED");
  expect((await getStudentResult(identities.STUDENT!.session, term.id)).result).toEqual(before.result);
  expect((await listSnapshots(admin(), term.id))[0].id).toBe(snapshot.id);
  await expect(manageTerm(admin(), term.id, { action: "void", revision: archived.revision, reason: "不应作废" })).rejects.toThrow("未发布");
  await expect(reopenTerm(admin(), term.id, { revision: archived.revision, reason: "必须先取消归档" })).rejects.toThrow("归档");
  expect((await db.resultPublication.findUniqueOrThrow({ where: { id: published.id } })).scheme).toEqual(term.scheme);
  expect((await db.settlementSnapshot.findUniqueOrThrow({ where: { id: original.id } })).payload).toEqual(original.payload);
  const restored = await manageTerm(admin(), term.id, { action: "unarchive", revision: archived.revision, reason: "恢复历史处理入口" });
  expect(restored.phase).toBe("LOCKED"); expect(restored.disposition).toBe("NORMAL");
});

test("登录入口由真实角色校验，错误入口和密码不产生会话，历史身份仅兼容学院入口", async () => {
  for (const role of ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT", "PUBLISHER"] as const) {
    const identity = identities[role]!;
    const result = await loginAttempt(identity.login, { role: role === "PUBLISHER" ? "COLLEGE" : role });
    expect(result?.id).toBe(identity.id);
  }
  const identity = identities.COUNSELOR!;
  const before = await db.authSession.count({ where: { userId: identity.id } });
  expect(await loginAttempt(identity.login, { role: "ADMIN" })).toBeNull();
  expect(await loginAttempt(identity.login, { password: "wrong" })).toBeNull();
  expect(await db.authSession.count({ where: { userId: identity.id } })).toBe(before);
  expect((await db.user.findUniqueOrThrow({ where: { id: identity.id } })).role).toBe("COUNSELOR");
}, 15_000);

test("主题和站点信息连续保存后可回读，冲突只一方成功且失败不污染已有设置", async () => {
  const previous = await db.siteSettings.findUnique({ where: { id: "site" } });
  try {
    for (const themePreset of ["blue", "violet", "default"] as const) {
      const current = await publicSettings();
      const saved = await saveSettings(admin(), { ...settingContent(current), revision: current.revision, siteName: `验收${themePreset}`, pageTitle: `标题${themePreset}`, siteDescription: `信息${themePreset}`, themePreset, reason: "核对信息及主题保存" });
      const read = await publicSettings();
      expect(read.themePreset).toBe(themePreset); expect(read.siteName).toBe(saved.siteName); expect(read.revision).toBe(current.revision + 1);
    }
    const current = await publicSettings();
    const payload = { ...settingContent(current), revision: current.revision, reason: "同时保存设置" };
    const outcomes = await Promise.allSettled([saveSettings(admin(), { ...payload, pageTitle: "并发一" }), saveSettings(admin(), { ...payload, pageTitle: "并发二" })]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const stored = await publicSettings();
    await expect(saveSettings(identities.COUNSELOR!.session, { ...settingContent(stored), revision: stored.revision, reason: "禁止越权修改" })).rejects.toThrow("权限");
    expect((await publicSettings()).revision).toBe(stored.revision);
  } finally {
    if (previous) await db.siteSettings.update({ where: { id: "site" }, data: { content: previous.content!, revision: previous.revision, updatedAt: previous.updatedAt } });
    else await db.siteSettings.deleteMany({ where: { id: "site" } });
  }
});

test("本地验证码不返回答案，大小写兼容、错误/过期/并发重放均不能重复消费", async () => {
  const issued = await issueLoginCaptcha();
  expect(issued?.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
  expect(Object.keys(issued!).sort()).toEqual(["expiresAt", "id", "image"]);
  const image = Buffer.from(issued!.image.split(",")[1], "base64").toString();
  expect(image).not.toContain("<text"); expect(image).toContain("<path");
  const good = await challenge();
  expect(await consumeLoginCaptcha(good.captchaId, good.captcha)).toBe(true);
  expect(await consumeLoginCaptcha(good.captchaId, good.captcha)).toBe(false);
  const wrong = await challenge();
  expect(await consumeLoginCaptcha(wrong.captchaId, "WRONG")).toBe(false);
  expect(await consumeLoginCaptcha(wrong.captchaId, wrong.captcha)).toBe(false);
  const expired = await challenge("ABCDE", new Date(Date.now() - 1));
  expect(await consumeLoginCaptcha(expired.captchaId, expired.captcha)).toBe(false);
  const race = await challenge();
  expect((await Promise.all([consumeLoginCaptcha(race.captchaId, race.captcha), consumeLoginCaptcha(race.captchaId, race.captcha)])).filter(Boolean)).toHaveLength(1);
  await db.loginCaptcha.deleteMany({ where: { id: issued!.id } });
});

test("关闭失败限制不锁账号，缺失或错误验证码不能登录也不计入账号失败次数", async () => {
  await policy(false);
  const user = identities.COUNSELOR!;
  for (let i = 0; i < 3; i++) expect(await loginAttempt(user.login, { password: "wrong" })).toBeNull();
  expect(await db.loginFailureState.findUnique({ where: { key: failureKey(user.login) } })).toBeNull();
  expect(await loginAttempt(user.login)).toMatchObject({ id: user.id });
  expect(await authenticateCredentials({ login: user.login, password, role: "COUNSELOR" })).toBeNull();
  await policy(true);
  const bad = await challenge();
  await expect(authenticateCredentials({ login: user.login, password, role: "COUNSELOR", ...bad, captcha: "WRONG" })).rejects.toThrow("CaptchaInvalid");
  expect(await db.loginFailureState.findUnique({ where: { key: failureKey(user.login) } })).toBeNull();
  await policy(false);
});

test("失败达到自定义次数锁定，跨角色共享次数、未知账号相同处理，到期可重新登录", async () => {
  await policy(true, 2, 3);
  const user = identities.COUNSELOR!, key = failureKey(user.login), now = Date.now();
  expect(await loginAttempt(user.login, { role: "ADMIN" })).toBeNull();
  await expect(loginAttempt(user.login, { password: "wrong" })).rejects.toThrow("LoginLocked");
  const state = await db.loginFailureState.findUniqueOrThrow({ where: { key } });
  expect(state.failures).toBe(2); expect(state.lockedUntil!.getTime()).toBeGreaterThanOrEqual(now + 3 * 60_000);
  const sessions = await db.authSession.count({ where: { userId: user.id } });
  await expect(loginAttempt(user.login)).rejects.toThrow("LoginLocked");
  expect(await db.authSession.count({ where: { userId: user.id } })).toBe(sessions);
  const unknown = `${prefix}-unknown`;
  expect(await loginAttempt(unknown)).toBeNull();
  await expect(loginAttempt(unknown)).rejects.toThrow("LoginLocked");
  await db.loginFailureState.update({ where: { key }, data: { lockedUntil: new Date(Date.now() - 1) } });
  expect(await loginAttempt(user.login)).toMatchObject({ id: user.id });
  expect(await db.loginFailureState.findUnique({ where: { key } })).toBeNull();
  await policy(false);
}, 15_000);

test("成功清零并发失败不能绕过阈值，调整或关闭策略即时清除旧锁定且保留已有会话", async () => {
  await policy(true, 3, 1);
  const user = identities.COUNSELOR!, key = failureKey(user.login);
  expect(await loginAttempt(user.login, { password: "wrong" })).toBeNull();
  expect(await loginAttempt(user.login)).toMatchObject({ id: user.id });
  expect(await db.loginFailureState.findUnique({ where: { key } })).toBeNull();
  const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => loginAttempt(user.login, { password: "wrong" })));
  expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(2);
  expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(2);
  expect((await db.loginFailureState.findUniqueOrThrow({ where: { key } })).failures).toBe(3);
  const session = await db.authSession.findUniqueOrThrow({ where: { id: user.session } });
  await policy(true, 5, 10);
  expect(await loginAttempt(user.login)).toMatchObject({ id: user.id });
  expect((await db.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
  const saved = await publicSettings();
  for (const invalid of [{ loginFailureMaxAttempts: 0 }, { loginFailureMaxAttempts: 101 }, { loginFailureLockMinutes: 0 }, { loginFailureLockMinutes: 1441 }, { loginFailureMaxAttempts: 2.5 }]) {
    await expect(saveSettings(admin(), { ...settingContent(saved), ...invalid, revision: saved.revision, reason: "拒绝非法限制参数" })).rejects.toThrow();
  }
  await policy(false);
}, 15_000);
