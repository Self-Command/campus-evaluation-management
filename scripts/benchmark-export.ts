import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import yauzl from "yauzl";

// End-to-end capacity benchmark for the 10,000-student export. It creates a
// disposable local database, seeds synthetic organization and grade data, exports
// the same workbook paths used in production, and drops the database afterwards.
// No development or production database, account, or attachment is touched.

const STUDENTS = 10_000;
const COLLEGES = 10;
const CLASSES_PER_COLLEGE = 10;
const STUDENTS_PER_CLASS = 100;
const CREATE_BATCH = 2_000;

const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;
const memory = () => {
	const usage = process.memoryUsage();
	return { rssMb: mb(usage.rss), heapMb: mb(usage.heapUsed), externalMb: mb(usage.external) };
};

function databaseBase() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("缺少 DATABASE_URL");
	const base = new URL(url);
	if (base.hostname !== "127.0.0.1") throw new Error("容量基准只允许本地测试数据库");
	return base;
}

function runMigrations(env: NodeJS.ProcessEnv) {
	return new Promise<void>((done, fail) => {
		const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, stdio: "inherit" });
		child.on("error", fail);
		child.on("exit", (code) => code === 0 ? done() : fail(new Error(`迁移命令退出码 ${code}`)));
	});
}

function inspectWorkbook(path: string, expectedRows: number) {
	return new Promise<{ rows: number; formulas: number; sheetMb: number }>((done, fail) => {
		yauzl.open(path, { lazyEntries: true }, (error, zip) => {
			if (error || !zip) return fail(error ?? new Error("无法打开工作簿"));
			let found = false;
			zip.on("entry", (entry: yauzl.Entry) => {
				if (entry.fileName !== "xl/worksheets/sheet1.xml") return zip.readEntry();
				found = true;
				let rows = 0, formulas = 0, carry = "";
				zip.openReadStream(entry, (streamError, stream) => {
					if (streamError || !stream) return fail(streamError ?? new Error("无法读取成绩明细"));
					stream.on("data", (chunk: Buffer) => {
						const text = carry + chunk.toString("utf8");
						rows += text.match(/<row\b/g)?.length ?? 0;
						formulas += text.match(/<f[\s>]/g)?.length ?? 0;
						carry = ["<", "<r", "<ro", "<f"].find((part) => text.endsWith(part)) ?? "";
					});
					stream.on("end", () => {
						if (rows < expectedRows) return fail(new Error(`成绩明细行数不足：${rows} < ${expectedRows}`));
						done({ rows, formulas, sheetMb: mb(entry.uncompressedSize) });
						zip.readEntry();
					});
				});
			});
			zip.on("end", () => { if (!found) fail(new Error("工作簿缺少成绩明细工作表")); });
			zip.on("error", fail);
			zip.readEntry();
		});
	});
}

async function main() {
	const base = databaseBase();
	const name = `campus_bench_${randomBytes(6).toString("hex")}`;
	const databaseUrl = new URL(`/${name}`, base).toString();
	const adminDb = new Client({ connectionString: new URL("/postgres", base).toString() });
	let prisma: typeof import("../src/server/db").db | undefined;
	let created = false;
	try {
		await adminDb.connect();
		await adminDb.query(`CREATE DATABASE "${name}"`);
		created = true;
		process.env.DATABASE_URL = databaseUrl;
		await runMigrations({ ...process.env, DATABASE_URL: databaseUrl });

		const { db } = await import("../src/server/db");
		prisma = db;
		const { createTerm, activateTerm } = await import("../src/server/terms");
		const { exportClassGradeWorkbook } = await import("../src/server/class-grade-export");
		const { exportRankingGradeWorkbook } = await import("../src/server/rankings");
		const { validateScheme } = await import("../src/lib/scoring/validate");
		const { jsonValue } = await import("../src/server/claims");

		const setupStarted = performance.now();
		const admin = await db.user.create({
			data: { login: "benchmark-admin", name: "容量基准管理员", role: "ADMIN", passwordHash: "fixture-only", mustChangePassword: false },
		});
		const session = await db.authSession.create({
			data: { userId: admin.id, version: 0, expiresAt: new Date(Date.now() + 3_600_000) },
		});

		type ClassInfo = { id: string; collegeId: string; college: string; major: string; className: string };
		const classes: ClassInfo[] = [];
		for (let collegeIndex = 0; collegeIndex < COLLEGES; collegeIndex += 1) {
			const college = await db.college.create({
				data: { code: `B${String(collegeIndex + 1).padStart(2, "0")}`, name: `基准学院${String(collegeIndex + 1).padStart(2, "0")}` },
			});
			const major = await db.major.create({
				data: { collegeId: college.id, code: "01", name: `基准专业${String(collegeIndex + 1).padStart(2, "0")}` },
			});
			for (let classIndex = 0; classIndex < CLASSES_PER_COLLEGE; classIndex += 1) {
				const schoolClass = await db.schoolClass.create({
					data: { majorId: major.id, code: String(classIndex + 1).padStart(2, "0"), name: `基准${String(collegeIndex + 1).padStart(2, "0")}${String(classIndex + 1).padStart(2, "0")}班` },
				});
				classes.push({ id: schoolClass.id, collegeId: college.id, college: college.name, major: major.name, className: schoolClass.name });
			}
		}

		const students = classes.flatMap((schoolClass, classIndex) =>
			Array.from({ length: STUDENTS_PER_CLASS }, (_, studentIndex) => {
				const index = classIndex * STUDENTS_PER_CLASS + studentIndex;
				const login = `bench-${String(index).padStart(5, "0")}`;
				return { login, name: `基准学生${index}`, schoolClass };
			}),
		);
		const studentIds = new Map<string, string>();
		for (let start = 0; start < students.length; start += CREATE_BATCH) {
			const batch = students.slice(start, start + CREATE_BATCH);
			const createdStudents = await db.user.createManyAndReturn({
				data: batch.map((student) => ({
					login: student.login,
					name: student.name,
					role: "STUDENT" as const,
					passwordHash: "fixture-only",
					mustChangePassword: false,
				})),
				select: { id: true, login: true },
			});
			for (const student of createdStudents) studentIds.set(student.login, student.id);
			await db.studentProfile.createMany({
				data: batch.map((student) => ({
					userId: studentIds.get(student.login)!,
					studentNumber: student.login,
					college: student.schoolClass.college,
					major: student.schoolClass.major,
					className: student.schoolClass.className,
					classId: student.schoolClass.id,
				})),
			});
		}

		const term = await createTerm(session.id, { name: "导出容量基准周期", template: true });
		await activateTerm(session.id, term.id, { revision: term.revision });
		const { nodes } = validateScheme(term.scheme);
		const gradeNodes = [...nodes.values()].filter((node) => node.kind === "GRADE");
		if (!gradeNodes.length) throw new Error("默认评分方案没有可录入的学业成绩节点");
		const values = (studentIndex: number, nodeIndex: number) => `${30 + ((studentIndex + nodeIndex * 7) % 60)}.50`;
		const gradeRows = students.flatMap((student, studentIndex) =>
			gradeNodes.map((node, nodeIndex) => ({
				termId: term.id,
				studentId: studentIds.get(student.login)!,
				nodeId: node.id,
				value: values(studentIndex, nodeIndex),
			})),
		);
		for (let start = 0; start < gradeRows.length; start += 5_000) {
			await db.gradeInput.createMany({ data: gradeRows.slice(start, start + 5_000) });
		}
		const setupMs = Math.round(performance.now() - setupStarted);
		console.log(JSON.stringify({
			event: "seeded",
			students: students.length,
			classes: classes.length,
			colleges: classes.length / CLASSES_PER_COLLEGE,
			gradeNodes: gradeNodes.length,
			gradeInputs: gradeRows.length,
			setupMs,
		}));

		const outputDir = resolve(".local/export-benchmark");
		await mkdir(outputDir, { recursive: true });
		async function measure(label: string, run: () => Promise<{ buffer: Buffer; count: number; fileName: string }>) {
			const started = performance.now();
			const result = await run();
			const elapsedMs = Math.round(performance.now() - started);
			const after = memory();
			const path = join(outputDir, result.fileName);
			await writeFile(path, result.buffer);
			const row = {
				event: "exported",
				label,
				count: result.count,
				elapsedMs,
				fileMb: mb(result.buffer.length),
				rssMb: after.rssMb,
				heapMb: after.heapMb,
				externalMb: after.externalMb,
				file: path,
			};
			console.log(JSON.stringify(row));
			return { path, count: result.count };
		}

		const allSchool = await measure("全校10000人", () => exportClassGradeWorkbook(session.id, term.id, { scope: "school" }));
		if (allSchool.count !== STUDENTS) throw new Error(`全校导出人数异常：${allSchool.count}`);
		console.log(JSON.stringify({ event: "inspected", ...(await inspectWorkbook(allSchool.path, allSchool.count).then((result) => ({ label: "全校10000人", ...result }))) }));

		const college = await measure("单学院1000人", () => exportClassGradeWorkbook(session.id, term.id, { collegeIds: [classes[0].collegeId] }));
		if (college.count !== STUDENTS_PER_CLASS * CLASSES_PER_COLLEGE) throw new Error(`学院导出人数异常：${college.count}`);

		const publication = await db.resultPublication.create({
			data: {
				termId: term.id,
				sequence: 1,
				actorId: admin.id,
				requestId: randomBytes(12).toString("hex"),
				requestHash: "benchmark",
				scheme: jsonValue(term.scheme),
				termRevision: term.revision,
				inputRevision: term.inputRevision,
				studentCount: STUDENTS,
				checkingEndsAt: new Date(Date.now() + 3_600_000),
				requireConfirmation: false,
			},
		});
		for (let start = 0; start < students.length; start += 1_000) {
			const batch = students.slice(start, start + 1_000);
			await db.publishedResult.createMany({
				data: batch.map((student, offset) => {
					const studentIndex = start + offset;
					return {
						publicationId: publication.id,
						studentId: studentIds.get(student.login)!,
						login: student.login,
						name: student.name,
						college: student.schoolClass.college,
						major: student.schoolClass.major,
						className: student.schoolClass.className,
						total: "0.00",
						resultHash: "benchmark",
						payload: {
							student: {
								id: studentIds.get(student.login)!,
								login: student.login,
								name: student.name,
								profile: {
									studentNumber: student.login,
									college: student.schoolClass.college,
									major: student.schoolClass.major,
									className: student.schoolClass.className,
								},
							},
							grades: gradeNodes.map((node, nodeIndex) => ({ nodeId: node.id, value: values(studentIndex, nodeIndex) })),
							participations: [],
							claims: [],
							deductions: [],
						},
					};
				}),
			});
		}

		const ranking = await measure("排名导出10000人", () => exportRankingGradeWorkbook(session.id, term.id, { publicationId: publication.id }));
		if (ranking.count !== STUDENTS) throw new Error(`排名导出人数异常：${ranking.count}`);
		console.log(JSON.stringify({ event: "inspected", ...(await inspectWorkbook(ranking.path, ranking.count).then((result) => ({ label: "排名导出10000人", ...result }))) }));
	} finally {
		await prisma?.$disconnect().catch(() => undefined);
		if (created) await adminDb.query(`DROP DATABASE "${name}" WITH (FORCE)`).catch((error) => console.error("临时数据库清理失败", error instanceof Error ? error.message : "unknown"));
		await adminDb.end().catch(() => undefined);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
