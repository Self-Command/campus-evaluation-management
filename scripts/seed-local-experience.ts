import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db } from "../src/server/db";
import { schoolScheme } from "../src/lib/scoring/template";
import { validateScheme } from "../src/lib/scoring/validate";
import { calculate } from "../src/lib/scoring/calculate";
import { Rational } from "../src/lib/scoring/rational";
const evidenceRoot = () => resolve(process.env.EVIDENCE_DIR ?? ".local/evidence");

const termId = "local-experience-2026-autumn-v1";
const draftId = "local-experience-2027-spring-v1";
const markerId = "local-experience-2026-v1-created";
const activities = [
  { key: "ideology", name: "青年理论学习与主题研讨", organizer: "校团委", nodeId: "ideology", points: "20", day: 8, status: "APPROVED", content: "围绕青年责任开展主题学习与小组研讨，完成学习记录。", requirements: "参加集中学习并提交个人学习记录。" },
  { key: "training", name: "学生骨干能力提升培训", organizer: "学生工作部", nodeId: "training", points: "15", day: 10, status: "APPROVED", content: "开展沟通协作、组织管理与校园服务专题培训。", requirements: "完成全部培训课程并通过结业考核。" },
  { key: "public-service", name: "社区敬老志愿服务", organizer: "青年志愿者协会", nodeId: "public_service", points: "12", day: 12, status: "APPROVED", content: "为社区长者提供便民服务，协助开展文娱与数字设备使用指导。", requirements: "完成四小时服务，提交服务记录。" },
  { key: "social-practice", name: "城市文化调研与社会实践", organizer: "信息工程学院", nodeId: "social_practice", points: "8", day: 14, status: "APPROVED", content: "分组走访城市文化场馆，完成访谈与调研报告。", requirements: "参与实地调研并提交小组报告。" },
  { key: "professional", name: "程序设计与工程实践竞赛", organizer: "计算机协会", nodeId: "professional", points: "18", day: 16, status: "APPROVED", content: "围绕工程问题完成程序设计、功能验证及成果答辩。", requirements: "完成竞赛任务并提供成绩或获奖依据。" },
  { key: "cultural-sports", name: "校园秋季运动会", organizer: "体育教学部", nodeId: "cultural_sports", points: "6", day: 18, status: "PENDING", content: "组织田径与集体项目竞赛，鼓励学生参与体育锻炼。", requirements: "完成参赛项目，提供参赛或成绩记录。" },
  { key: "innovation", name: "大学生创新项目交流", organizer: "创新创业中心", nodeId: "innovation", points: "10", day: 19, status: "REJECTED", content: "展示创新项目阶段成果，开展项目路演与交流。", requirements: "提交项目成果及本人参与说明。" },
  { key: "labor", name: "校园绿地劳动实践", organizer: "后勤服务中心", nodeId: "labor_practice", points: "4", day: 24, status: null, content: "开展校园绿地养护、环境清洁与劳动技能指导。", requirements: "按时参加，完成两小时劳动任务。" },
  { key: "management", name: "学生组织项目策划工作坊", organizer: "校学生会", nodeId: "management", points: "5", day: 26, status: null, content: "学习校园项目策划与组织方法，形成活动策划方案。", requirements: "完成小组策划方案并参加交流。", unconfirmed: true },
] as const;

function participationPdf() {
  const text = "BT /F1 16 Tf 50 780 Td (Campus participation record) Tj 0 -30 Td /F1 11 Tf (Fictional local sample - not a real certificate.) Tj 0 -24 Td (Student: 20260001. Activities: learning, volunteering and competition.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED_ENABLED !== "true" || url.hostname !== "127.0.0.1" || url.pathname !== "/campus_dev") throw new Error("此数据命令仅允许已开启种子开关的本地 campus_dev 数据库");
  const scheme = schoolScheme();
  validateScheme(scheme);
  const users = await db.user.findMany({ where: { login: { in: ["admin.dev", "publisher.dev", "20260001"] } } });
  const admin = users.find(user => user.login === "admin.dev"), publisher = users.find(user => user.login === "publisher.dev"), student = users.find(user => user.login === "20260001");
  if (!admin || !publisher || !student || admin.role !== "ADMIN" || publisher.role !== "PUBLISHER" || student.role !== "STUDENT" || users.some(user => user.disabled || user.mustChangePassword)) throw new Error("需要三个有效且已完成首次改密的既有本地账号；本命令不会创建账号或重置密码");
  let evidenceId: string | undefined;
  if (!await db.auditEvent.findUnique({ where: { id: markerId } })) {
    const bytes = participationPdf(), storageKey = randomBytes(24).toString("hex");
    await mkdir(evidenceRoot(), { recursive: true });
    const path = join(evidenceRoot(), storageKey);
    await writeFile(path, bytes, { flag: "wx" });
    try {
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109314)`;
        if (await tx.auditEvent.findUnique({ where: { id: markerId } })) return;
        if (await tx.term.count({ where: { id: { in: [termId, draftId] } } })) throw new Error("保留标识已被占用，未覆盖任何学期");
        const profile = await tx.studentProfile.findUnique({ where: { userId: student.id } });
        if (!profile) await tx.studentProfile.create({ data: { userId: student.id, studentNumber: student.login, college: "信息工程学院", major: "计算机科学与技术", className: "计算机2601班" } });
        await tx.term.create({ data: { id: draftId, name: "2026—2027学年第二学期", scheme } });
        await tx.term.create({ data: { id: termId, name: "2026—2027学年第一学期", phase: "ACTIVE", scheme, revision: 1, inputRevision: 1 } });
        const evidence = await tx.evidence.create({ data: { ownerId: publisher.id, name: "活动参与记录.pdf", mime: "application/pdf", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storageKey } });
        evidenceId = evidence.id;
        for (const item of activities) {
          const activity = await tx.activity.create({ data: { id: `${termId}-${item.key}`, termId, ownerId: publisher.id, name: item.name, organizer: item.organizer, content: item.content, requirements: item.requirements, startsAt: new Date(`2026-10-${String(item.day).padStart(2, "0")}T01:00:00Z`), endsAt: new Date(`2026-10-${String(item.day).padStart(2, "0")}T04:00:00Z`), nodeId: item.nodeId, points: item.points, confirmed: !("unconfirmed" in item), revision: "unconfirmed" in item ? 0 : 1 } });
          if (!item.status) continue;
          const reviewed = item.status !== "PENDING";
          const participation = await tx.participation.create({ data: { activityId: activity.id, studentId: student.id, revision: reviewed ? 1 : 0 } });
          await tx.recognitionSource.create({ data: { participationId: participation.id, submitterId: publisher.id, status: item.status, note: `已完成${item.name}，由组织方提交参与记录。`, ...(reviewed ? { reviewerId: admin.id, reviewedAt: new Date(), reviewReason: item.status === "APPROVED" ? "参与记录与证明一致，予以认定。" : "证明未能体现本人项目分工，请补充本人参与依据。", revision: 1 } : {}), evidence: { create: { evidenceId: evidence.id } } } });
          if (item.key === "ideology") await tx.recognitionSource.create({ data: { participationId: participation.id, submitterId: student.id, status: "APPROVED", note: "补充个人学习记录，与组织方记录属于同一次参与。", reviewerId: admin.id, reviewedAt: new Date(), reviewReason: "与组织方提交为同一参与事实，保留补充依据，不重复计分。", revision: 1 } });
        }
        await tx.gradeInput.createMany({ data: [{ termId, studentId: student.id, nodeId: "academic", value: "88" }, { termId, studentId: student.id, nodeId: "physical", value: "92" }] });
        await tx.deductionInput.create({ data: { termId, studentId: student.id, projectId: "disciplinary_deduction", amount: "1", reason: "依据本期宿舍卫生检查记录扣减1分。" } });
        const values = Object.fromEntries(activities.filter(item => item.status === "APPROVED").map(item => [item.nodeId, item.points]));
        const result = calculate(scheme, { values: { ...values, academic: "88", physical: "92" }, deductions: { disciplinary_deduction: "1" } });
        await tx.auditEvent.create({ data: { id: markerId, actorId: admin.id, action: "LOCAL_EXPERIENCE_DATA_CREATED", targetId: termId, details: { fictional: true, draftId, activities: activities.length, expectedTotal: result.total, preservedExistingAccounts: true } } });
      }, { timeout: 15_000 });
    } catch (error) {
      if (!await db.evidence.findUnique({ where: { storageKey } })) await unlink(path);
      throw error;
    }
    if (!await db.evidence.findUnique({ where: { storageKey } })) await unlink(path);
  }
  const term = await db.term.findUniqueOrThrow({ where: { id: termId } });
  const facts = await db.participation.findMany({ where: { studentId: student.id, activity: { termId, confirmed: true }, sources: { some: { status: "APPROVED" } } }, include: { activity: true } });
  const values: Record<string, string> = {};
  for (const fact of facts) values[fact.activity.nodeId] = Rational.from(values[fact.activity.nodeId] ?? "0").add(Rational.from(fact.activity.points.toString())).fixed(12);
  const grades = await db.gradeInput.findMany({ where: { termId, studentId: student.id } });
  for (const grade of grades) values[grade.nodeId] = grade.value.toString();
  const deductions = await db.deductionInput.findMany({ where: { termId, studentId: student.id, revoked: false } });
  const result = calculate(term.scheme, { values, deductions: Object.fromEntries(deductions.map(item => [item.projectId, item.amount.toString()])) });
  const publisherActivities = await db.activity.count({ where: { termId, ownerId: publisher.id } });
  const records = await db.recognitionSource.count({ where: { participation: { studentId: student.id, activity: { termId } } } });
  const pending = await db.recognitionSource.count({ where: { status: "PENDING", participation: { activity: { termId } } } });
  evidenceId ??= (await db.evidenceReference.findFirst({ where: { source: { participation: { activity: { termId } } } }, select: { evidenceId: true } }))?.evidenceId;
  if (evidenceId) {
    const file = await db.evidence.findUniqueOrThrow({ where: { id: evidenceId } });
    if (!/^[a-f0-9]{48}$/.test(file.storageKey)) throw new Error("证明标识无效");
    const bytes = await readFile(join(evidenceRoot(), file.storageKey));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("证明完整性校验失败");
  }
  console.log(JSON.stringify({ termId, draftId, publisherActivities, studentRecognitionRecords: records, pendingReviews: pending, approvedUniqueParticipations: facts.length, complete: result.complete, total: result.total, passwordsUnchanged: true, rerunPreservesEdits: true }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "创建本地体验数据失败"); process.exitCode = 1; }).finally(() => db.$disconnect());
