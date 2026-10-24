import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { AccountError, accountRemovalCheck, adminTransaction } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { db } from "@/server/db";
import {
  classIdentityInclude,
  classProfile,
  configuredClass,
  recordStudentAffiliation,
} from "@/server/organizations";
import {
  duplicateIdentityMessage,
  identityClassKey,
  identityNameKey,
  identityNumberKey,
  loadIdentityIndex,
  recordIdentityException,
} from "@/server/student-identity";
import {
  accountImportRoles,
  type AccountImportRole,
} from "@/lib/imports/templates";
import type { ManagementBlocker } from "@/lib/management-types";
import type { Prisma } from "@/generated/prisma/client";

export const studentImportFields = ["login", "name", "college", "major", "className"] as const;
export const staffImportFields = ["login", "name", "collegeCode", "college"] as const;
export type StudentImportRow = Record<(typeof studentImportFields)[number], string>;
export type StaffImportRow = Record<(typeof staffImportFields)[number], string>;
export type ImportRow = StudentImportRow | StaffImportRow;
export function importFieldsFor(role: AccountImportRole) {
  return role === "STUDENT"
    ? [...studentImportFields]
    : [...staffImportFields];
}
export type PreviewCandidate = {
  userId: string;
  login: string;
  name: string;
  studentNumber?: string;
  disabled: boolean;
  likely: boolean;
};
export type PreviewRow = {
  line: number;
  data: ImportRow;
  state: "NEW" | "SKIP" | "ERROR" | "DUPLICATE";
  message: string;
  duplicateCandidates?: PreviewCandidate[];
  fileDuplicateOf?: number;
  college?: { id: string; name: string; code: string } | null;
};
type ImportClass = Prisma.SchoolClassGetPayload<{ include: typeof classIdentityInclude }>;
type CollegeRef = { id: string; name: string; code: string; enabled: boolean };
type ExistingUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    login: true;
    name: true;
    role: true;
    disabled: true;
    revision: true;
    authVersion: true;
    collegeId: true;
    studentProfile: {
      select: {
        studentNumber: true;
        classId: true;
        college: true;
        major: true;
        className: true;
      };
    };
  };
}>;
const rawRowsSchema = z.array(z.record(z.string(), z.string().max(200))).min(1).max(100);
const previewInputSchema = z.union([
  rawRowsSchema,
  z.object({
    rows: rawRowsSchema,
    targetRole: z.enum(accountImportRoles).default("STUDENT"),
    note: z.string().trim().min(2).max(500).optional(),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    templateVersion: z.string().trim().max(30).optional(),
    requestId: z.string().trim().max(100).optional(),
  }).strict(),
]);
const studentIdentitySchema = z.object({
  login: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(80),
  college: z.string().min(1).max(80),
  major: z.string().min(1).max(80),
  className: z.string().min(1).max(80),
});
const staffIdentitySchema = z.object({
  login: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(80),
  collegeCode: z.string().min(1).max(40),
  college: z.string().min(1).max(80),
});
const resolutionSchema = z.object({
  line: z.number().int().min(2).max(101),
  action: z.enum(["KEEP_BOTH", "SKIP", "USE_EXISTING"]),
  reason: z.string().trim().max(500).optional(),
}).strict();
type Resolution = z.infer<typeof resolutionSchema>;
const commitInputSchema = z.object({
  resolutions: z.array(resolutionSchema).max(100).default([]),
}).strict();

function parsedPreviewInput(input: unknown) {
  const parsed = previewInputSchema.parse(input);
  if (Array.isArray(parsed)) {
    return {
      rows: parsed,
      targetRole: "STUDENT" as const,
      note: "账号导入",
      fileHash: undefined,
      templateVersion: undefined,
      requestId: undefined,
    };
  }
  return parsed;
}

function studentRow(raw: Record<string, string>): StudentImportRow {
  return Object.fromEntries(
    studentImportFields.map(key => [key, raw[key].trim()]),
  ) as StudentImportRow;
}

function staffRow(raw: Record<string, string>): StaffImportRow {
  return Object.fromEntries(
    staffImportFields.map(key => [key, raw[key].trim()]),
  ) as StaffImportRow;
}

function roleText(role: AccountImportRole) {
  return role === "COUNSELOR" ? "辅导员" : "学院管理人员";
}

function uniqueUsers(users: ExistingUser[]) {
  return [...new Map(users.map(user => [user.id, user])).values()];
}

export async function inspectAccountImport(
  tx: Prisma.TransactionClient,
  targetRole: AccountImportRole,
  input: Record<string, string>[],
) {
  const logins = input.map(row => row.login.trim());
  const existing = await tx.user.findMany({
    where: {
      OR: [
        { login: { in: logins, mode: "insensitive" } },
        ...(targetRole === "STUDENT"
          ? []
          : [{ studentProfile: { studentNumber: { in: logins, mode: "insensitive" as const } } }]),
      ],
    },
    select: {
      id: true,
      login: true,
      name: true,
      role: true,
      disabled: true,
      revision: true,
      authVersion: true,
      collegeId: true,
      studentProfile: {
        select: {
          studentNumber: true,
          classId: true,
          college: true,
          major: true,
          className: true,
        },
      },
    },
    orderBy: [{ login: "asc" }, { id: "asc" }],
  });
  const loginOwners = new Map<string, ExistingUser[]>();
  const numberOwners = new Map<string, ExistingUser[]>();
  for (const user of existing) {
    const loginKey = identityNumberKey(user.login);
    loginOwners.set(loginKey, [...(loginOwners.get(loginKey) ?? []), user]);
    if (user.studentProfile) {
      const numberKey = identityNumberKey(user.studentProfile.studentNumber);
      numberOwners.set(numberKey, [...(numberOwners.get(numberKey) ?? []), user]);
    }
  }
  function ownersFor(loginKey: string) {
    return uniqueUsers([
      ...(loginOwners.get(loginKey) ?? []),
      ...(numberOwners.get(loginKey) ?? []),
    ]);
  }
  function duplicateLoginError(owners: ExistingUser[], login: string) {
    if (
      owners.length > 1 ||
      (owners.length === 1 && owners.some(owner => owner.login !== login))
    ) {
      return "登录账号已被现有账号占用（不区分大小写），请核对后使用原账号";
    }
    return "";
  }

  if (targetRole === "STUDENT") {
    const classes = await tx.schoolClass.findMany({
      where: { name: { in: input.map(row => row.className.trim()) } },
      include: classIdentityInclude,
      orderBy: { id: "asc" },
    });
    const resolved = input.map((raw, index) => {
      const data = studentRow(raw);
      const parsed = studentIdentitySchema.safeParse(data);
      if (!parsed.success) {
        return {
          line: index + 2,
          data,
          error: parsed.error.issues.map(issue => `${issue.path.join(".")}：${issue.message}`).join("；"),
          schoolClass: undefined as ImportClass | undefined,
        };
      }
      const matching = classes.filter(cls =>
        cls.name === data.className &&
        cls.major.name === data.major &&
        cls.major.college.name === data.college &&
        cls.enabled &&
        cls.major.enabled &&
        cls.major.college.enabled
      );
      if (matching.length !== 1) {
        return {
          line: index + 2,
          data,
          error: "学院、专业、班级必须完整匹配唯一的已启用组织目录",
          schoolClass: undefined as ImportClass | undefined,
        };
      }
      const schoolClass = matching[0];
      if (
        !schoolClass.counselor ||
        schoolClass.counselor.role !== "COUNSELOR" ||
        schoolClass.counselor.disabled ||
        schoolClass.counselor.collegeId !== schoolClass.major.collegeId
      ) {
        return {
          line: index + 2,
          data,
          error: "班级责任辅导员尚未配置或已失效",
          schoolClass: undefined as ImportClass | undefined,
        };
      }
      return { line: index + 2, data, error: undefined, schoolClass };
    });

    const candidateIndex = await loadIdentityIndex(
      tx,
      resolved
        .filter(row => row.schoolClass)
        .map(row => ({
          classId: row.schoolClass!.id,
          college: row.data.college,
          major: row.data.major,
          className: row.data.className,
        })),
    );

    const seen = new Map<string, string>();
    const fileFirst = new Map<string, { line: number; login: string }>();
    const rows: PreviewRow[] = resolved.map(row => {
      const { line, data, error, schoolClass } = row;
      if (error || !schoolClass) {
        return { line, data, state: "ERROR", message: error ?? "组织信息无效" };
      }
      const loginKey = identityNumberKey(data.login);
      const signature = JSON.stringify(data);
      if (seen.has(loginKey)) {
        return {
          line,
          data,
          state: seen.get(loginKey) === signature ? "SKIP" : "ERROR",
          message: seen.get(loginKey) === signature
            ? "文件内相同记录，跳过"
            : "同一学号存在不同信息，请合并后重新上传",
        };
      }
      seen.set(loginKey, signature);

      const owners = ownersFor(loginKey);
      const loginError = duplicateLoginError(owners, data.login);
      if (loginError) {
        return { line, data, state: "ERROR", message: loginError };
      }
      const existingUser = owners[0];
      if (existingUser) {
        const same =
          existingUser.role === "STUDENT" &&
          existingUser.name === data.name &&
          existingUser.studentProfile?.studentNumber === data.login &&
          existingUser.studentProfile.classId === schoolClass.id &&
          existingUser.studentProfile.college === data.college &&
          existingUser.studentProfile.major === data.major &&
          existingUser.studentProfile.className === data.className;
        return {
          line,
          data,
          state: same ? "SKIP" : "ERROR",
          message: same
            ? existingUser.disabled
              ? "学生账号已存在但已停用，请先在账号管理中启用"
              : "学生账号已存在，跳过且不重置密码"
            : "账号已存在且信息不同，请通过账号管理核对",
        };
      }

      const classKey = identityClassKey({
        classId: schoolClass.id,
        college: data.college,
        major: data.major,
        className: data.className,
      });
      const nameKey = identityNameKey(data.name);
      const duplicateKey = `${classKey}\u0000${nameKey}`;
      const firstInFile = fileFirst.get(duplicateKey);
      if (!firstInFile) fileFirst.set(duplicateKey, { line, login: data.login });
      const fileDuplicateOf = firstInFile && identityNumberKey(firstInFile.login) !== loginKey
        ? firstInFile.line
        : undefined;
      const duplicateCandidates = candidateIndex.candidatesFor({
        studentNumber: data.login,
        name: data.name,
        classId: schoolClass.id,
        college: data.college,
        major: data.major,
        className: data.className,
      });
      if (duplicateCandidates.length || fileDuplicateOf) {
        const messages = [
          duplicateCandidates.length ? duplicateIdentityMessage(duplicateCandidates) : "",
          fileDuplicateOf ? `文件内第${fileDuplicateOf}行也是同班同名但学号不同；请确认是否确为不同学生。` : "",
        ].filter(Boolean);
        return {
          line,
          data,
          state: "DUPLICATE",
          message: messages.join(" "),
          duplicateCandidates: duplicateCandidates.length ? duplicateCandidates : undefined,
          fileDuplicateOf,
        };
      }
      return { line, data, state: "NEW", message: "新建学生账号" };
    });

    const snapshot = createHash("sha256").update(JSON.stringify({
      targetRole,
      existing: existing
        .map(user => ({
          id: user.id,
          login: user.login,
          name: user.name,
          role: user.role,
          disabled: user.disabled,
          collegeId: user.collegeId,
          profile: user.studentProfile,
        }))
        .sort((a, b) => `${a.login}:${a.id}`.localeCompare(`${b.login}:${b.id}`)),
      classes,
      identity: candidateIndex.snapshot,
    })).digest("hex");
    return { targetRole, rows, snapshot, classes, colleges: [] as CollegeRef[] };
  }

  const colleges = await tx.college.findMany({
    where: { code: { in: input.map(row => row.collegeCode.trim().toUpperCase()), mode: "insensitive" } },
    select: { id: true, name: true, code: true, enabled: true },
    orderBy: { id: "asc" },
  });
  const resolved = input.map((raw, index) => {
    const data = staffRow(raw);
    const parsed = staffIdentitySchema.safeParse(data);
    if (!parsed.success) {
      return {
        line: index + 2,
        data,
        error: parsed.error.issues.map(issue => `${issue.path.join(".")}：${issue.message}`).join("；"),
        college: undefined as CollegeRef | undefined,
      };
    }
    const matching = colleges.filter(college =>
      college.code.toUpperCase() === data.collegeCode.toUpperCase() &&
      college.name === data.college &&
      college.enabled
    );
    if (matching.length !== 1) {
      return {
        line: index + 2,
        data,
        error: "学院编码和名称必须匹配唯一的已启用学院",
        college: undefined as CollegeRef | undefined,
      };
    }
    return { line: index + 2, data, error: undefined, college: matching[0] };
  });
  const collegeIds = [...new Set(resolved.flatMap(row => row.college ? [row.college.id] : []))];
  const staffCandidates = collegeIds.length
    ? await tx.user.findMany({
        where: { role: targetRole, collegeId: { in: collegeIds } },
        select: { id: true, login: true, name: true, disabled: true, collegeId: true },
        orderBy: [{ login: "asc" }, { id: "asc" }],
      })
    : [];
  const staffByName = new Map<string, typeof staffCandidates>();
  for (const user of staffCandidates) {
    const key = `${user.collegeId}\u0000${identityNameKey(user.name)}`;
    staffByName.set(key, [...(staffByName.get(key) ?? []), user]);
  }

  const seen = new Map<string, string>();
  const fileFirst = new Map<string, { line: number; login: string }>();
  const rows: PreviewRow[] = resolved.map(row => {
    const { line, data, error, college } = row;
    const previewCollege = college
      ? { id: college.id, name: college.name, code: college.code }
      : null;
    if (error || !college) {
      return {
        line,
        data,
        state: "ERROR",
        message: error ?? "学院信息无效",
        college: previewCollege,
      };
    }
    const loginKey = identityNumberKey(data.login);
    const signature = JSON.stringify(data);
    if (seen.has(loginKey)) {
      return {
        line,
        data,
        state: seen.get(loginKey) === signature ? "SKIP" : "ERROR",
        message: seen.get(loginKey) === signature
          ? "文件内相同记录，跳过"
          : "同一登录账号存在不同信息，请合并后重新上传",
        college: previewCollege,
      };
    }
    seen.set(loginKey, signature);

    const owners = ownersFor(loginKey);
    const loginError = duplicateLoginError(owners, data.login);
    if (loginError) {
      return {
        line,
        data,
        state: "ERROR",
        message: loginError,
        college: previewCollege,
      };
    }
    const existingUser = owners[0];
    if (existingUser) {
      if (existingUser.role !== targetRole) {
        return {
          line,
          data,
          state: "ERROR",
          message: "登录账号已被其他身份使用，请通过账号管理核对",
          college: previewCollege,
        };
      }
      const same =
        existingUser.name === data.name &&
        existingUser.collegeId === college.id;
      return {
        line,
        data,
        state: same ? "SKIP" : "ERROR",
        message: same
          ? existingUser.disabled
            ? `${roleText(targetRole)}账号已存在但已停用，请先在账号管理中启用`
            : `${roleText(targetRole)}账号已存在，跳过且不重置密码`
          : "账号已存在且姓名或所属学院不同，请通过账号管理核对",
        college: previewCollege,
      };
    }

    const duplicateKey = `${college.id}\u0000${identityNameKey(data.name)}`;
    const firstInFile = fileFirst.get(duplicateKey);
    if (!firstInFile) fileFirst.set(duplicateKey, { line, login: data.login });
    const fileDuplicateOf = firstInFile && identityNumberKey(firstInFile.login) !== loginKey
      ? firstInFile.line
      : undefined;
    const duplicateCandidates = (staffByName.get(duplicateKey) ?? []).map(candidate => ({
      userId: candidate.id,
      login: candidate.login,
      name: candidate.name,
      disabled: candidate.disabled,
      likely: false,
    }));
    if (duplicateCandidates.length || fileDuplicateOf) {
      const messages = [
        duplicateCandidates.length
          ? `同一学院已有同名${roleText(targetRole)}账号：${duplicateCandidates.slice(0, 3).map(candidate => `${candidate.name}（${candidate.login}${candidate.disabled ? "，已停用" : ""}）`).join("、")}${duplicateCandidates.length > 3 ? " 等" : ""}。`
          : "",
        fileDuplicateOf
          ? `文件内第${fileDuplicateOf}行也是同学院同名但登录账号不同；请确认是否确为不同人员。`
          : "",
      ].filter(Boolean);
      return {
        line,
        data,
        state: "DUPLICATE",
        message: `${messages.join(" ")} 确为不同人员时请保留双方并填写核对理由。`,
        duplicateCandidates: duplicateCandidates.length ? duplicateCandidates : undefined,
        fileDuplicateOf,
        college: previewCollege,
      };
    }
    return {
      line,
      data,
      state: "NEW",
      message: `新建${roleText(targetRole)}账号`,
      college: previewCollege,
    };
  });

  const snapshot = createHash("sha256").update(JSON.stringify({
    targetRole,
    existing: existing
      .map(user => ({
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
        disabled: user.disabled,
        collegeId: user.collegeId,
        profile: user.studentProfile,
      }))
      .sort((a, b) => `${a.login}:${a.id}`.localeCompare(`${b.login}:${b.id}`)),
    colleges,
    staff: staffCandidates
      .map(user => ({
        id: user.id,
        login: user.login,
        name: user.name,
        disabled: user.disabled,
        collegeId: user.collegeId,
      }))
      .sort((a, b) => `${a.login}:${a.id}`.localeCompare(`${b.login}:${b.id}`)),
  })).digest("hex");
  return { targetRole, rows, snapshot, classes: [] as ImportClass[], colleges };
}

function prepareCommit(
  preview: Awaited<ReturnType<typeof inspectAccountImport>>,
  resolutions: Resolution[],
) {
  if (preview.rows.some(row => row.state === "ERROR")) throw new AccountError("名单中存在错误行，本批次未写入");
  const byLine = new Map(resolutions.map(item => [item.line, item]));
  const duplicateRows = preview.rows.filter(row => row.state === "DUPLICATE");
  const missing = duplicateRows.filter(row => !byLine.has(row.line));
  if (missing.length) {
    throw new AccountError(`还有 ${missing.length} 条疑似重复记录未处理，请逐行选择处理方式`);
  }
  const createRows: { row: PreviewRow; resolution?: Resolution }[] = [];
  let skipped = 0;
  for (const row of preview.rows) {
    if (row.state === "SKIP") {
      skipped++;
      continue;
    }
    if (row.state === "NEW") {
      createRows.push({ row });
      continue;
    }
    if (row.state !== "DUPLICATE") throw new AccountError("名单中存在错误行，本批次未写入");
    const resolution = byLine.get(row.line)!;
    if (resolution.action === "KEEP_BOTH") {
      if (!resolution.reason || resolution.reason.trim().length < 10) {
        throw new AccountError(`第${row.line}行选择保留双方时必须填写至少10个字的核对理由`);
      }
      createRows.push({ row, resolution });
    } else {
      skipped++;
    }
  }
  return { createRows, skipped, resolutions };
}

export async function previewAccountImport(sessionId: string, input: unknown) {
  const data = parsedPreviewInput(input);
  const note = data.note ?? "账号导入";
  return adminTransaction(sessionId, async (tx, actorId) => {
    const preview = await inspectAccountImport(tx, data.targetRole, data.rows);
    const requestId = data.requestId ?? randomUUID();
    const templateVersion =
      data.templateVersion ??
      (data.targetRole === "STUDENT" ? "accounts-v2" : "accounts-staff-v1");
    const batch = await tx.accountImport.create({
      data: {
        actorId,
        rows: data.rows,
        snapshot: preview.snapshot,
        note,
        fileHash: data.fileHash ?? null,
        templateVersion,
        targetRole: data.targetRole,
        scopeKey: "accounts:school",
        requestId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    return {
      id: batch.id,
      requestId,
      note,
      targetRole: data.targetRole,
      templateVersion: batch.templateVersion,
      expiresAt: batch.expiresAt,
      rows: preview.rows,
      errors: preview.rows.filter(row => row.state === "ERROR").length,
      unresolved: preview.rows.filter(row => row.state === "DUPLICATE").length,
    };
  });
}

export async function commitAccountImport(sessionId: string, id: string, input?: unknown) {
  const data = commitInputSchema.parse(input ?? { resolutions: [] });
  // Authorize and validate before expensive hashing; revalidate after preparation.
  const candidate = await adminTransaction(sessionId, async (tx, actorId) => {
    const batch = await tx.accountImport.findUnique({ where: { id } });
    if (!batch) throw new AccountError("导入批次不存在", 404);
    if (batch.actorId !== actorId) throw new AccountError("不能提交其他管理员的导入批次", 403);
    const targetRole = z.enum(accountImportRoles).parse(batch.targetRole);
    const rows = rawRowsSchema.parse(batch.rows);
    if (batch.status === "COMMITTED") {
      return {
        targetRole,
        rows,
        preview: null,
        createRows: [] as { row: PreviewRow; resolution?: Resolution }[],
        skipped: 0,
        resolutions: [] as Resolution[],
        committed: true,
        result: batch.result as { created: number; skipped: number } | null,
      };
    }
    if (batch.expiresAt <= new Date()) throw new AccountError("预览已过期，请重新上传预览", 409);
    const preview = await inspectAccountImport(tx, targetRole, rows);
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后的账号数据已变化，请重新预览", 409);
    const prepared = prepareCommit(preview, data.resolutions);
    return { targetRole, rows, preview, ...prepared, committed: false };
  });

  if (candidate.committed) {
    return {
      ...(candidate.result ?? { created: 0, skipped: 0 }),
      targetRole: candidate.targetRole,
      credentials: [],
      replay: true,
    };
  }
  const targetRole = candidate.targetRole;
  const rawRows = candidate.rows;
  const rows = candidate.preview!.rows;
  const createRows = candidate.createRows;
  const credentials = new Map<string, { login: string; initialPassword: string; passwordHash: string }>();
  for (const { row } of createRows) {
    const key = identityNumberKey(row.data.login);
    if (credentials.has(key)) continue;
    const initialPassword = `Init!${randomBytes(18).toString("base64url")}7a`;
    credentials.set(key, { login: row.data.login, initialPassword, passwordHash: await hash(initialPassword, 12) });
  }
  return adminTransaction(sessionId, async (tx, actorId) => {
    const batch = await tx.accountImport.findUniqueOrThrow({ where: { id } });
    if (batch.actorId !== actorId) throw new AccountError("不能提交其他管理员的导入批次", 403);
    if (batch.status === "COMMITTED") {
      return {
        ...(batch.result as { created: number; skipped: number }),
        targetRole,
        credentials: [],
        replay: true,
      };
    }
    if (batch.expiresAt < new Date()) throw new AccountError("预览已过期，请重新上传预览", 409);
    const preview = await inspectAccountImport(tx, targetRole, rawRows);
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后的账号数据已变化，请重新预览", 409);
    const prepared = prepareCommit(preview, candidate.resolutions);
    const delivered: { login: string; initialPassword: string }[] = [];
    const createdByLine = new Map<number, { id: string; classKey?: string }>();
    for (const { row, resolution } of prepared.createRows) {
      const secret = credentials.get(identityNumberKey(row.data.login))!;
      if (targetRole === "STUDENT") {
        const data = row.data as StudentImportRow;
        const candidateClass = preview.classes.find(cls =>
          cls.name === data.className &&
          cls.major.name === data.major &&
          cls.major.college.name === data.college &&
          cls.enabled &&
          cls.major.enabled &&
          cls.major.college.enabled
        );
        if (!candidateClass) throw new AccountError("班级信息已变化，请重新预览", 409);
        const schoolClass = await configuredClass(tx, candidateClass.id);
        const user = await tx.user.create({
          data: {
            login: data.login,
            name: data.name,
            role: "STUDENT",
            passwordHash: secret.passwordHash,
            studentProfile: {
              create: { studentNumber: data.login, ...classProfile(schoolClass) },
            },
          },
        });
        await recordStudentAffiliation(tx, user.id, schoolClass, actorId, `账号导入批次${id}`);
        await tx.auditEvent.create({
          data: {
            actorId,
            action: "ACCOUNT_IMPORTED",
            targetId: user.id,
            details: {
              batchId: id,
              line: row.line,
              targetRole,
              fileHash: batch.fileHash,
              templateVersion: batch.templateVersion,
              requestId: batch.requestId,
              reason: resolution?.reason ?? null,
            },
          },
        });
        createdByLine.set(row.line, {
          id: user.id,
          classKey: identityClassKey({
            classId: schoolClass.id,
            college: schoolClass.major.college.name,
            major: schoolClass.major.name,
            className: schoolClass.name,
          }),
        });
      } else {
        const data = row.data as StaffImportRow;
        const college = preview.colleges.find(item =>
          item.id === row.college?.id && item.enabled
        );
        if (!college) throw new AccountError("学院已停用或不存在，请重新预览", 409);
        const user = await tx.user.create({
          data: {
            login: data.login,
            name: data.name,
            role: targetRole,
            collegeId: college.id,
            passwordHash: secret.passwordHash,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId,
            action: "ACCOUNT_IMPORTED",
            targetId: user.id,
            details: {
              batchId: id,
              line: row.line,
              targetRole,
              collegeId: college.id,
              collegeCode: college.code,
              fileHash: batch.fileHash,
              templateVersion: batch.templateVersion,
              requestId: batch.requestId,
              reason: resolution?.reason ?? null,
            },
          },
        });
        createdByLine.set(row.line, { id: user.id });
      }
      delivered.push({ login: secret.login, initialPassword: secret.initialPassword });
    }

    if (targetRole === "STUDENT") {
      // Persist explicit same-name confirmations. This is what lets later grade
      // and participation imports accept a legitimate pair without weakening the
      // default block for every other account.
      for (const { row, resolution } of prepared.createRows) {
        if (resolution?.action !== "KEEP_BOTH") continue;
        const classKey = createdByLine.get(row.line)?.classKey;
        const userId = createdByLine.get(row.line)?.id;
        if (!classKey || !userId) continue;
        for (const duplicate of row.duplicateCandidates ?? []) {
          if (!duplicate.studentNumber) continue;
          await recordIdentityException(tx, {
            classKey,
            name: row.data.name,
            studentNumberA: row.data.login,
            studentNumberB: duplicate.studentNumber,
            studentIdA: userId,
            studentIdB: duplicate.userId,
            batchId: id,
            actorId,
            reason: resolution.reason!,
          });
        }
      }

      const createdGroups = new Map<string, { row: PreviewRow; userId: string; reason: string }[]>();
      for (const { row, resolution } of prepared.createRows) {
        const created = createdByLine.get(row.line);
        if (!created?.classKey) continue;
        const key = `${created.classKey}\u0000${identityNameKey(row.data.name)}`;
        const group = createdGroups.get(key) ?? [];
        group.push({ row, userId: created.id, reason: resolution?.reason ?? "同班同名经管理员核对确认" });
        createdGroups.set(key, group);
      }
      for (const group of createdGroups.values()) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const left = group[i];
            const right = group[j];
            const withReason = right.reason.length >= 10 ? right.reason : left.reason;
            await recordIdentityException(tx, {
              classKey: createdByLine.get(left.row.line)!.classKey!,
              name: left.row.data.name,
              studentNumberA: left.row.data.login,
              studentNumberB: right.row.data.login,
              studentIdA: left.userId,
              studentIdB: right.userId,
              batchId: id,
              actorId,
              reason: withReason,
            });
          }
        }
      }
    }

    const resolutionByLine = new Map(prepared.resolutions.map(item => [item.line, item]));
    const rowResults = rows.map(row => {
      const resolution = resolutionByLine.get(row.line);
      const created = createdByLine.get(row.line);
      const outcome = created
        ? "CREATED"
        : row.state === "SKIP" || (row.state === "DUPLICATE" && resolution)
          ? "SKIPPED"
          : "ERROR";
      const student = targetRole === "STUDENT" ? row.data as StudentImportRow : null;
      const staff = targetRole === "STUDENT" ? null : row.data as StaffImportRow;
      return {
        line: row.line,
        login: row.data.login,
        name: row.data.name,
        role: targetRole,
        college: student?.college ?? staff?.college ?? null,
        collegeCode: staff?.collegeCode ?? null,
        major: student?.major ?? null,
        className: student?.className ?? null,
        state: outcome,
        action: resolution?.action ?? null,
        userId: created?.id ?? null,
        message: created
          ? "账号已创建"
          : outcome === "SKIPPED"
            ? resolution?.action === "KEEP_BOTH" ? "已保留现有账号" : "已跳过"
            : row.message,
      };
    });
    const result = { created: delivered.length, skipped: rows.length - delivered.length, targetRole };
    await tx.accountImport.update({
      where: { id },
      data: {
        status: "COMMITTED",
        result,
        rowResults,
        confirmations: prepared.resolutions,
        committedAt: new Date(),
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "ACCOUNT_IMPORT_COMMITTED",
        targetId: id,
        details: {
          ...result,
          confirmations: prepared.resolutions,
          fileHash: batch.fileHash,
          templateVersion: batch.templateVersion,
          requestId: batch.requestId,
        },
      },
    });
    return { ...result, credentials: delivered, replay: false };
  });
}

const storedRowResultSchema = z.object({
  line: z.number().int().min(1),
  login: z.string(),
  name: z.string(),
  role: z.string().optional(),
  college: z.string().nullable().optional(),
  collegeCode: z.string().nullable().optional(),
  major: z.string().nullable().optional(),
  className: z.string().nullable().optional(),
  state: z.enum(["CREATED", "SKIPPED", "ERROR"]),
  action: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

type StoredBatch = Prisma.AccountImportGetPayload<Record<string, never>>;

function storedRows(batch: Pick<StoredBatch, "rowResults">) {
  const parsed = z.array(storedRowResultSchema).safeParse(batch.rowResults ?? []);
  return parsed.success ? parsed.data : [];
}

function storedTargetRole(value: string): AccountImportRole {
  return accountImportRoles.includes(value as AccountImportRole)
    ? (value as AccountImportRole)
    : "STUDENT";
}

function batchSummary(batch: StoredBatch, actor: { id: string; name: string; login: string } | null) {
  const rows = storedRows(batch);
  const result = (batch.result ?? {}) as { created?: unknown; skipped?: unknown };
  const status = batch.status === "REVOKED" ? "REVOKED" as const : "COMMITTED" as const;
  return {
    id: batch.id,
    createdAt: batch.createdAt.toISOString(),
    committedAt: batch.committedAt?.toISOString() ?? null,
    actor,
    targetRole: storedTargetRole(batch.targetRole),
    note: batch.note,
    status,
    created: typeof result.created === "number" ? result.created : rows.filter(row => row.state === "CREATED").length,
    skipped: typeof result.skipped === "number" ? result.skipped : rows.filter(row => row.state === "SKIPPED").length,
    rowCount: rows.length,
    revokedAt: batch.revokedAt?.toISOString() ?? null,
    revokeReason: batch.revokeReason,
  };
}

async function loadImportActors(ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; login: string }>();
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true, login: true },
  });
  return new Map(users.map(user => [user.id, user]));
}

async function requireImportAdmin(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword)
    throw new AccountError("没有管理权限", 403);
  return current.user;
}

const importHistoryFilters = z.object({
  q: z.string().trim().max(80).default(""),
  targetRole: z.enum(accountImportRoles).optional(),
  status: z.enum(["COMMITTED", "REVOKED"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();

export async function listAccountImports(sessionId: string, input: unknown) {
  await requireImportAdmin(sessionId);
  const filters = importHistoryFilters.parse(input ?? {});
  const actorIds = filters.q
    ? (await db.user.findMany({
        where: { OR: [
          { name: { contains: filters.q, mode: "insensitive" } },
          { login: { contains: filters.q, mode: "insensitive" } },
        ] },
        select: { id: true },
        take: 200,
      })).map(user => user.id)
    : [];
  const where: Prisma.AccountImportWhereInput = {
    status: filters.status ?? { in: ["COMMITTED", "REVOKED"] },
    ...(filters.targetRole ? { targetRole: filters.targetRole } : {}),
    ...(filters.q
      ? { OR: [
          { id: { contains: filters.q, mode: "insensitive" } },
          { note: { contains: filters.q, mode: "insensitive" } },
          ...(actorIds.length ? [{ actorId: { in: actorIds } }] : []),
        ] }
      : {}),
  };
  const [batches, total] = await db.$transaction([
    db.accountImport.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      skip: (filters.page - 1) * 20,
    }),
    db.accountImport.count({ where }),
  ]);
  const actors = await loadImportActors(batches.map(batch => batch.actorId));
  return {
    items: batches.map(batch => batchSummary(batch, actors.get(batch.actorId) ?? null)),
    total,
    page: filters.page,
    pageSize: 20,
  };
}

type RevokeCheckAccount = {
  line: number;
  userId: string;
  login: string;
  name: string;
  blockers: ManagementBlocker[];
  profileCount: number;
  affiliationCount: number;
  sessionCount: number;
};

async function checkImportRevoke(tx: Prisma.TransactionClient, batch: StoredBatch, actorId: string) {
  const rows = storedRows(batch);
  const targetRole = storedTargetRole(batch.targetRole);
  const seen = new Set<string>();
  const accounts: RevokeCheckAccount[] = [];
  const missing: { line: number; login: string; name: string }[] = [];
  for (const row of rows) {
    if (row.state !== "CREATED" || !row.userId || seen.has(row.userId)) continue;
    seen.add(row.userId);
    const check = await accountRemovalCheck(tx, row.userId, actorId);
    if (!check) {
      missing.push({ line: row.line, login: row.login, name: row.name });
      continue;
    }
    const blockers = [...check.blockers];
    if (check.user.role !== targetRole)
      blockers.push({ key: "roleChanged", label: "身份已变更", count: 1, hint: "只能撤销仍保持导入身份的账号" });
    accounts.push({
      line: row.line,
      userId: row.userId,
      login: check.user.login,
      name: check.user.name,
      blockers,
      profileCount: check.profileCount,
      affiliationCount: check.affiliationCount,
      sessionCount: check.sessionCount,
    });
  }
  return { rows, targetRole, accounts, missing };
}

export async function readAccountImport(sessionId: string, idInput: string) {
  const admin = await requireImportAdmin(sessionId);
  const id = z.string().trim().min(1).max(100).parse(idInput);
  const batch = await db.accountImport.findUnique({ where: { id } });
  if (!batch) throw new AccountError("导入批次不存在", 404);
  const actors = await loadImportActors([batch.actorId]);
  const rows = storedRows(batch).map(row => ({
    line: row.line,
    login: row.login,
    name: row.name,
    role: row.role ?? storedTargetRole(batch.targetRole),
    college: row.college ?? null,
    collegeCode: row.collegeCode ?? null,
    major: row.major ?? null,
    className: row.className ?? null,
    state: row.state,
    action: row.action ?? null,
    userId: row.userId ?? null,
    message: row.message,
  }));
  let revoke: {
    canRevoke: boolean;
    reason: string | null;
    accounts: { line: number; login: string; name: string; blockers: ManagementBlocker[] }[];
    missing: { line: number; login: string; name: string }[];
  };
  if (batch.status === "COMMITTED") {
    const check = await db.$transaction(tx => checkImportRevoke(tx, batch, admin.id));
    const blocked = check.accounts.filter(account => account.blockers.length);
    revoke = {
      canRevoke: blocked.length === 0,
      reason: blocked.length
        ? "部分账号已产生业务数据或身份已变更，请在账号管理中单独处理"
        : null,
      accounts: check.accounts.map(account => ({
        line: account.line,
        login: account.login,
        name: account.name,
        blockers: account.blockers,
      })),
      missing: check.missing,
    };
  } else if (batch.status === "REVOKED") {
    revoke = { canRevoke: false, reason: "该批次已整批撤销，账号不可重复删除", accounts: [], missing: [] };
  } else {
    revoke = { canRevoke: false, reason: "该批次尚未提交，无需撤销", accounts: [], missing: [] };
  }
  return {
    ...batchSummary(batch, actors.get(batch.actorId) ?? null),
    rows,
    revoke,
  };
}

const revokeImportSchema = z.object({
  reason: z.string().trim().min(2, "请填写撤销理由").max(500),
}).strict();

export async function revokeAccountImport(sessionId: string, id: string, input: unknown) {
  const data = revokeImportSchema.parse(input);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const batch = await tx.accountImport.findUnique({ where: { id } });
    if (!batch) throw new AccountError("导入批次不存在", 404);
    if (batch.status === "REVOKED") {
      return {
        id,
        replay: true,
        revoked: 0,
        missing: [],
        targetRole: storedTargetRole(batch.targetRole),
        revokedAt: batch.revokedAt?.toISOString() ?? null,
        reason: batch.revokeReason,
      };
    }
    if (batch.status !== "COMMITTED") throw new AccountError("该批次尚未提交，无法撤销", 409);
    const check = await checkImportRevoke(tx, batch, actorId);
    const blocked = check.accounts.filter(account => account.blockers.length);
    if (blocked.length) {
      const detail = blocked
        .slice(0, 5)
        .map(account => `第${account.line}行 ${account.name}（${account.login}）：${account.blockers.map(item => `${item.label} ${item.count}`).join("、")}`)
        .join("；");
      throw new AccountError(`不能整批撤销。${detail}${blocked.length > 5 ? " 等" : ""}。请先在账号管理中单独处理这些账号。`, 409);
    }
    const deleted: { line: number; userId: string; login: string; name: string; profileRemoved: boolean; affiliationsRemoved: number; sessionsRemoved: number }[] = [];
    for (const account of check.accounts) {
      await tx.studentAffiliation.deleteMany({ where: { studentId: account.userId } });
      const profile = await tx.studentProfile.deleteMany({ where: { userId: account.userId } });
      const sessions = await tx.authSession.deleteMany({ where: { userId: account.userId } });
      await tx.user.delete({ where: { id: account.userId } });
      deleted.push({
        line: account.line,
        userId: account.userId,
        login: account.login,
        name: account.name,
        profileRemoved: profile.count > 0,
        affiliationsRemoved: account.affiliationCount,
        sessionsRemoved: sessions.count,
      });
    }
    const revokedUserIds = deleted.map(account => account.userId);
    const exceptions = await tx.duplicateIdentityException.deleteMany({
      where: {
        OR: [
          { batchId: id },
          ...(revokedUserIds.length
            ? [{ studentIdA: { in: revokedUserIds } }, { studentIdB: { in: revokedUserIds } }]
            : []),
        ],
      },
    });
    const revokedAt = new Date();
    const revokeResult = {
      deleted,
      missing: check.missing,
      duplicateExceptionsRemoved: exceptions.count,
    };
    await tx.accountImport.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt,
        revokedBy: actorId,
        revokeReason: data.reason,
        revokeResult,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "ACCOUNT_IMPORT_REVOKED",
        targetId: id,
        details: JSON.parse(JSON.stringify({
          reason: data.reason,
          targetRole: check.targetRole,
          ...revokeResult,
        })),
      },
    });
    return {
      id,
      replay: false,
      revoked: deleted.length,
      missing: check.missing,
      targetRole: check.targetRole,
      revokedAt: revokedAt.toISOString(),
      reason: data.reason,
    };
  });
}
