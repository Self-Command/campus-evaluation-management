import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash } from "bcryptjs";
import { db } from "../src/server/db";
import { schoolScheme } from "../src/lib/scoring/template";
import { validateScheme } from "../src/lib/scoring/validate";

const password = process.env.ACCEPTANCE_PASSWORD;
const url = new URL(process.env.DATABASE_URL!);
if (
	process.env.NODE_ENV === "production" ||
	process.env.DEV_SEED_ENABLED !== "true" ||
	url.hostname !== "127.0.0.1" ||
	url.pathname !== "/campus_dev"
)
	throw new Error("验收数据种子仅允许已开启开关的本地 campus_dev 数据库");
if (!password || password.length < 12 || password.length > 72)
	throw new Error("请通过 ACCEPTANCE_PASSWORD 提供12至72位测试密码");
if ((await db.user.count()) || (await db.term.count()) || (await db.college.count()))
	throw new Error("数据库不是空库；为避免覆盖，请先清空数据库再执行");

const now = new Date();
const evidenceRoot = resolve(process.env.EVIDENCE_DIR ?? ".local/evidence");
const historyEntry = (actorId: string, action: string, details: Record<string, unknown> = {}) => ({
	actorId,
	action,
	at: now.toISOString(),
	...details,
});

function proofPdf(title: string) {
	const text = `BT /F1 16 Tf 50 780 Td (Campus Evaluation Activity Proof) Tj 0 -30 Td /F1 11 Tf (${title}) Tj 0 -24 Td /F1 11 Tf (The organizer confirms the activity roster and summary on file.) Tj ET`;
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
	for (const offset of offsets.slice(1))
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
	return Buffer.from(pdf);
}

type CollegeSeed = {
	key: string;
	code: string;
	name: string;
	staff: { login: string; name: string };
	majors: {
		code: string;
		name: string;
		classes: {
			code: string;
			name: string;
			counselor: { login: string; name: string };
			students: { login: string; name: string }[];
		}[];
	}[];
};

const collegesSeed: CollegeSeed[] = [
	{
		key: "info",
		code: "CIE",
		name: "信息工程学院",
		staff: { login: "college1", name: "信息工程学院管理员" },
		majors: [
			{
				code: "SE",
				name: "软件工程",
				classes: [
					{
						code: "SE2601",
						name: "软件工程2601班",
						counselor: { login: "counselor1", name: "刘老师（软件2601）" },
						students: [
							{ login: "20261001", name: "张明" },
							{ login: "20261002", name: "李华" },
						],
					},
				],
			},
			{
				code: "CS",
				name: "计算机科学与技术",
				classes: [
					{
						code: "CS2601",
						name: "计算机科学2601班",
						counselor: { login: "counselor2", name: "陈老师（计算机2601）" },
						students: [
							{ login: "20261003", name: "王芳" },
							{ login: "20261004", name: "赵磊" },
						],
					},
				],
			},
		],
	},
	{
		key: "econ",
		code: "CEM",
		name: "经济管理学院",
		staff: { login: "college2", name: "经济管理学院管理员" },
		majors: [
			{
				code: "ACC",
				name: "会计学",
				classes: [
					{
						code: "ACC2601",
						name: "会计学2601班",
						counselor: { login: "counselor3", name: "周老师（会计2601）" },
						students: [
							{ login: "20262001", name: "陈晨" },
							{ login: "20262002", name: "刘洋" },
						],
					},
				],
			},
			{
				code: "BA",
				name: "工商管理",
				classes: [
					{
						code: "BA2601",
						name: "工商管理2601班",
						counselor: { login: "counselor4", name: "吴老师（工商2601）" },
						students: [
							{ login: "20262003", name: "周敏" },
							{ login: "20262004", name: "吴昊" },
						],
					},
				],
			},
		],
	},
	{
		key: "foreign",
		code: "CFL",
		name: "外国语学院",
		staff: { login: "college3", name: "外国语学院管理员" },
		majors: [
			{
				code: "EN",
				name: "英语",
				classes: [
					{
						code: "EN2601",
						name: "英语2601班",
						counselor: { login: "counselor5", name: "郑老师（英语2601）" },
						students: [
							{ login: "20263001", name: "郑欣" },
							{ login: "20263002", name: "孙悦" },
						],
					},
				],
			},
			{
				code: "JP",
				name: "日语",
				classes: [
					{
						code: "JP2601",
						name: "日语2601班",
						counselor: { login: "counselor6", name: "林老师（日语2601）" },
						students: [
							{ login: "20263003", name: "何静" },
							{ login: "20263004", name: "林涛" },
						],
					},
				],
			},
		],
	},
];

type SeedUser = Awaited<ReturnType<typeof db.user.create>>;
type SeedStudent = {
	user: SeedUser;
	classId: string;
	className: string;
	collegeKey: string;
	collegeId: string;
	collegeName: string;
	majorId: string;
	majorName: string;
	counselor: SeedUser;
};

async function main() {
	const passwordHash = await hash(password!, 12);
	await mkdir(evidenceRoot, { recursive: true });

	const admin = await db.user.create({
		data: {
			login: "admin",
			name: "系统管理员",
			role: "ADMIN",
			passwordHash,
			mustChangePassword: false,
		},
	});

	const colleges = new Map<string, { id: string; name: string }>();
	const collegeAccounts = new Map<string, SeedUser>();
	const counselors = new Map<string, SeedUser>();
	const classes = new Map<string, { id: string; name: string; majorId: string; majorName: string; collegeId: string; collegeName: string; collegeKey: string; counselor: SeedUser }>();
	const students = new Map<string, SeedStudent>();

	for (const collegeSeed of collegesSeed) {
		const college = await db.college.create({
			data: { code: collegeSeed.code, name: collegeSeed.name },
		});
		colleges.set(collegeSeed.key, college);
		const account = await db.user.create({
			data: {
				login: collegeSeed.staff.login,
				name: collegeSeed.staff.name,
				role: "COLLEGE",
				collegeId: college.id,
				passwordHash,
				mustChangePassword: false,
			},
		});
		collegeAccounts.set(collegeSeed.key, account);
		for (const majorSeed of collegeSeed.majors)
			for (const classSeed of majorSeed.classes) {
				const counselor = await db.user.create({
					data: {
						login: classSeed.counselor.login,
						name: classSeed.counselor.name,
						role: "COUNSELOR",
						collegeId: college.id,
						passwordHash,
						mustChangePassword: false,
					},
				});
				counselors.set(classSeed.counselor.login, counselor);
			}
	}

	for (const collegeSeed of collegesSeed) {
		const college = colleges.get(collegeSeed.key)!;
		for (const majorSeed of collegeSeed.majors) {
			const major = await db.major.create({
				data: {
					collegeId: college.id,
					code: majorSeed.code,
					name: majorSeed.name,
				},
			});
			for (const classSeed of majorSeed.classes) {
				const counselor = counselors.get(classSeed.counselor.login)!;
				const schoolClass = await db.schoolClass.create({
					data: {
						majorId: major.id,
						code: classSeed.code,
						name: classSeed.name,
						counselorId: counselor.id,
					},
				});
				classes.set(classSeed.code, {
					id: schoolClass.id,
					name: schoolClass.name,
					majorId: major.id,
					majorName: major.name,
					collegeId: college.id,
					collegeName: college.name,
					collegeKey: collegeSeed.key,
					counselor,
				});
				await db.classCounselorAssignment.create({
					data: {
						classId: schoolClass.id,
						counselorId: counselor.id,
						startedAt: now,
						actorId: admin.id,
						reason: "班级责任辅导员配置",
					},
				});
				for (const studentSeed of classSeed.students) {
					const student = await db.user.create({
						data: {
							login: studentSeed.login,
							name: studentSeed.name,
							role: "STUDENT",
							passwordHash,
							mustChangePassword: false,
							studentProfile: {
								create: {
									studentNumber: studentSeed.login,
									classId: schoolClass.id,
									college: college.name,
									major: major.name,
									className: schoolClass.name,
								},
							},
						},
					});
					await db.studentAffiliation.create({
						data: {
							studentId: student.id,
							classId: schoolClass.id,
							startedAt: now,
							actorId: admin.id,
							reason: "学院组织关系初始化",
							identity: {
								collegeId: college.id,
								college: college.name,
								majorId: major.id,
								major: major.name,
								classId: schoolClass.id,
								className: schoolClass.name,
								counselorId: counselor.id,
							},
						},
					});
					students.set(studentSeed.login, {
						user: student,
						classId: schoolClass.id,
						className: schoolClass.name,
						collegeKey: collegeSeed.key,
						collegeId: college.id,
						collegeName: college.name,
						majorId: major.id,
						majorName: major.name,
						counselor,
					});
				}
			}
		}
	}

	const scheme = schoolScheme();
	validateScheme(scheme);
	const draftTerm = await db.term.create({
		data: {
			name: "2026—2027学年第二学期",
			phase: "CONFIGURATION",
			scheme,
		},
	});
	const term = await db.term.create({
		data: {
			name: "2026—2027学年第一学期",
			phase: "ACTIVE",
			scheme,
			revision: 1,
			inputRevision: 2,
		},
	});

	async function addParticipant(options: {
		activityId: string;
		activityEvidenceId: string;
		student: SeedStudent;
		host: SeedUser;
		score?: string;
		status: "PENDING_COUNSELOR" | "PENDING_COLLEGE" | "RETURNED" | "APPROVED";
	}) {
		const { activityId, activityEvidenceId, student, host, score, status } = options;
		const counselor = student.counselor;
		const collegeReviewer = collegeAccounts.get(student.collegeKey)!;
		const reviewed = status !== "PENDING_COUNSELOR";
		const approved = status === "APPROVED";
		const revision = approved ? 2 : reviewed ? 1 : 0;
		const participation = await db.participation.create({
			data: {
				activityId,
				studentId: student.user.id,
				score: score ?? null,
				revision,
				registeredAt: now,
				registeredBy: host.id,
				registrationSnapshot: {
					studentId: student.user.id,
					login: student.user.login,
					name: student.user.name,
					college: student.collegeName,
					major: student.majorName,
					className: student.className,
				},
				history: [
					historyEntry(host.id, "ROSTER_SUBMITTED", {
						status: "PENDING_COUNSELOR",
						source: "ACTIVITY_ROSTER",
					}),
				],
			},
		});
		const sourceHistory = [
			historyEntry(host.id, "ROSTER_SUBMITTED", {
				status: "PENDING_COUNSELOR",
				source: "ACTIVITY_ROSTER",
			}),
		];
		if (reviewed)
			sourceHistory.push(
				historyEntry(
					counselor.id,
					status === "RETURNED" ? "COUNSELOR_RETURN" : "COUNSELOR_APPROVE",
					{
						before: "PENDING_COUNSELOR",
						after: status === "RETURNED" ? "RETURNED" : "PENDING_COLLEGE",
						reason:
							status === "RETURNED" ? "服务时长证明材料不清晰，请补充" : null,
					},
				),
			);
		if (approved)
			sourceHistory.push(
				historyEntry(collegeReviewer.id, "COLLEGE_APPROVE", {
					before: "PENDING_COLLEGE",
					after: "APPROVED",
					reason: "材料完整，同意认定",
				}),
			);
		await db.recognitionSource.create({
			data: {
				participationId: participation.id,
				submitterId: host.id,
				origin: "IMPORT",
				status,
				note: "活动签到表与参与名单一致。",
				activityEvidenceId,
				revision,
				reviewReason:
					status === "RETURNED"
						? "服务时长证明材料不清晰，请补充"
						: approved
							? "材料完整，同意认定"
							: null,
				returnedByRole: status === "RETURNED" ? "COUNSELOR" : null,
				reviewerId: approved
					? collegeReviewer.id
					: reviewed
						? counselor.id
						: null,
				reviewedAt: reviewed ? now : null,
				counselorId:
					status === "PENDING_COLLEGE" || approved ? counselor.id : null,
				counseledAt: status === "PENDING_COLLEGE" || approved ? now : null,
				collegeReviewerId: approved ? collegeReviewer.id : null,
				collegeReviewedAt: approved ? now : null,
				history: sourceHistory,
			},
		});
		return participation;
	}

	async function createProof(activityId: string, host: SeedUser, fileName: string, title: string) {
		const bytes = proofPdf(title);
		const storageKey = randomBytes(24).toString("hex");
		await writeFile(join(evidenceRoot, storageKey), bytes, { flag: "wx" });
		const evidence = await db.evidence.create({
			data: {
				ownerId: host.id,
				name: fileName,
				mime: "application/pdf",
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				storageKey,
			},
		});
		return db.activityEvidence.create({
			data: {
				activityId,
				evidenceId: evidence.id,
				version: 1,
				active: true,
				uploadedBy: host.id,
				note: "活动通知、签到表和结果公示。",
			},
		});
	}

	const info = colleges.get("info")!;
	const econ = colleges.get("econ")!;
	const foreign = colleges.get("foreign")!;
	const infoStaff = collegeAccounts.get("info")!;
	const econStaff = collegeAccounts.get("econ")!;
	const foreignStaff = collegeAccounts.get("foreign")!;

	const competition = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: infoStaff.id,
			collegeId: info.id,
			name: "程序设计竞赛（信息工程学院）",
			organizer: "信息工程学院",
			content: "围绕工程问题完成程序设计、功能验证与成果答辩。",
			requirements: "完成竞赛任务，活动签到与名单一致。",
			startsAt: new Date("2026-10-12T01:00:00.000Z"),
			endsAt: new Date("2026-10-12T04:00:00.000Z"),
			nodeId: "professional",
			points: "10",
			confirmed: true,
			publishedAt: now,
			publishRevision: 1,
			scoreMode: "INDIVIDUAL",
			audienceColleges: [info.name, econ.name],
			rosterCommittedAt: now,
			rosterRevision: 1,
			sharedEvidenceVersion: 1,
			revision: 2,
		},
	});
	const competitionProof = await createProof(
		competition.id,
		infoStaff,
		"活动证明-程序设计竞赛.pdf",
		"Programming Competition",
	);
	await addParticipant({
		activityId: competition.id,
		activityEvidenceId: competitionProof.id,
		student: students.get("20261001")!,
		host: infoStaff,
		score: "9",
		status: "PENDING_COUNSELOR",
	});
	await addParticipant({
		activityId: competition.id,
		activityEvidenceId: competitionProof.id,
		student: students.get("20261003")!,
		host: infoStaff,
		score: "8",
		status: "PENDING_COLLEGE",
	});
	await addParticipant({
		activityId: competition.id,
		activityEvidenceId: competitionProof.id,
		student: students.get("20262001")!,
		host: infoStaff,
		score: "7",
		status: "PENDING_COLLEGE",
	});
	await addParticipant({
		activityId: competition.id,
		activityEvidenceId: competitionProof.id,
		student: students.get("20262003")!,
		host: infoStaff,
		score: "10",
		status: "APPROVED",
	});

	const volunteering = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: econStaff.id,
			collegeId: econ.id,
			name: "社区敬老志愿服务（经济管理学院）",
			organizer: "经济管理学院青年志愿者协会",
			content: "为社区长者提供便民服务，协助开展文娱与数字设备使用指导。",
			requirements: "完成四小时服务，服务记录与名单一致。",
			startsAt: new Date("2026-10-15T01:00:00.000Z"),
			endsAt: new Date("2026-10-15T05:00:00.000Z"),
			nodeId: "public_service",
			points: "6",
			confirmed: true,
			publishedAt: now,
			publishRevision: 1,
			scoreMode: "FIXED",
			audienceColleges: [econ.name, foreign.name],
			rosterCommittedAt: now,
			rosterRevision: 1,
			sharedEvidenceVersion: 1,
			revision: 2,
		},
	});
	const volunteeringProof = await createProof(
		volunteering.id,
		econStaff,
		"活动证明-社区志愿服务.pdf",
		"Community Volunteer Service",
	);
	await addParticipant({
		activityId: volunteering.id,
		activityEvidenceId: volunteeringProof.id,
		student: students.get("20262002")!,
		host: econStaff,
		status: "APPROVED",
	});
	await addParticipant({
		activityId: volunteering.id,
		activityEvidenceId: volunteeringProof.id,
		student: students.get("20262004")!,
		host: econStaff,
		status: "PENDING_COUNSELOR",
	});
	await addParticipant({
		activityId: volunteering.id,
		activityEvidenceId: volunteeringProof.id,
		student: students.get("20263001")!,
		host: econStaff,
		status: "RETURNED",
	});

	const speech = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: foreignStaff.id,
			collegeId: foreign.id,
			name: "英语演讲比赛（外国语学院）",
			organizer: "外国语学院",
			content: "围绕校园生活开展英语主题演讲与交流。",
			requirements: "完成主题演讲并提交活动签到记录。",
			startsAt: new Date("2026-10-18T01:00:00.000Z"),
			endsAt: new Date("2026-10-18T03:00:00.000Z"),
			nodeId: "cultural_sports",
			points: "8",
			confirmed: true,
			scoreMode: "FIXED",
			audienceColleges: [foreign.name],
			sharedEvidenceVersion: 1,
			revision: 1,
		},
	});
	await createProof(
		speech.id,
		foreignStaff,
		"活动证明-英语演讲比赛.pdf",
		"English Speech Contest",
	);

	const legacy = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: admin.id,
			name: "校团委主题学习活动",
			organizer: "校团委",
			content: "校团委组织的主题学习活动，主办学院尚待确认。",
			requirements: "确定主办学院后，由主办学院维护参与名单、原始分和活动证明。",
			startsAt: new Date("2026-10-08T01:00:00.000Z"),
			endsAt: new Date("2026-10-08T03:00:00.000Z"),
			nodeId: "ideology",
			points: "5",
			confirmed: true,
			scoreMode: "FIXED",
			audienceColleges: [info.name],
			revision: 1,
		},
	});

	await db.activity.create({
		data: {
			termId: term.id,
			ownerId: infoStaff.id,
			collegeId: info.id,
			name: "校园公益活动",
			organizer: "信息工程学院学生会",
			content: "开展校园环境维护与公益宣传。",
			requirements: "完成公益服务并提交活动记录。",
			startsAt: new Date("2026-10-25T01:00:00.000Z"),
			endsAt: new Date("2026-10-25T03:00:00.000Z"),
			nodeId: "labor_practice",
			points: "4",
			confirmed: false,
			scoreMode: "FIXED",
			audienceColleges: [info.name],
		},
	});

	for (const [index, student] of [...students.values()].entries()) {
		await db.gradeInput.createMany({
			data: [
				{
					termId: term.id,
					studentId: student.user.id,
					nodeId: "academic",
					value: String(80 + (index % 10)),
				},
				{
					termId: term.id,
					studentId: student.user.id,
					nodeId: "physical",
					value: String(85 + (index % 8)),
				},
			],
		});
	}
	await db.deductionInput.create({
		data: {
			termId: term.id,
			studentId: students.get("20261001")!.user.id,
			projectId: "disciplinary_deduction",
			amount: "1",
			reason: "宿舍卫生检查扣分",
		},
	});

	const counts = {
		users: await db.user.count(),
		admins: await db.user.count({ where: { role: "ADMIN" } }),
		collegeStaff: await db.user.count({ where: { role: "COLLEGE" } }),
		counselors: await db.user.count({ where: { role: "COUNSELOR" } }),
		students: await db.user.count({ where: { role: "STUDENT" } }),
		colleges: await db.college.count(),
		majors: await db.major.count(),
		classes: await db.schoolClass.count(),
		terms: await db.term.count(),
		activities: await db.activity.count(),
		participations: await db.participation.count(),
		recognitionSources: await db.recognitionSource.count(),
		activityEvidence: await db.activityEvidence.count(),
	};
	await db.auditEvent.create({
		data: {
			actorId: admin.id,
			action: "BASELINE_DATA_CREATED",
			targetId: term.id,
			details: {
				...counts,
				draftTermId: draftTerm.id,
				activeTermId: term.id,
				competitionActivityId: competition.id,
				volunteeringActivityId: volunteering.id,
				speechActivityId: speech.id,
				legacyActivityId: legacy.id,
			},
		},
	});

	const accountLines = [
		"# 验收测试账号",
		"",
		"登录地址：http://localhost:3000/login",
		`统一密码：\`${password}\``,
		"登录时请选择与账号一致的身份。",
		"",
		"| 身份 | 登录账号 | 姓名/职责 |",
		"| --- | --- | --- |",
		`| ADMIN | \`admin\` | 系统管理员 |`,
		...[...collegeAccounts.entries()].map(
			([key, user]) =>
				`| COLLEGE | \`${user.login}\` | ${user.name}（${colleges.get(key)!.name}） |`,
		),
		...[...counselors.values()].map(
			(user) => `| COUNSELOR | \`${user.login}\` | ${user.name} |`,
		),
		...[...students.values()].map(
			(student) =>
				`| STUDENT | \`${student.user.login}\` | ${student.user.name}（${student.collegeName} / ${student.className}） |`,
		),
		"",
		`有效期：本地开发数据库 \`campus_dev\`。活动学期：${term.name}（ACTIVE）。`,
		"",
	].join("\n");
	await mkdir(resolve(".local"), { recursive: true });
	await writeFile(resolve(".local/acceptance-accounts.md"), accountLines, {
		mode: 0o600,
	});

	console.log(
		JSON.stringify(
			{ ...counts, activeTerm: term.name, accountsFile: ".local/acceptance-accounts.md" },
			null,
			2,
		),
	);
}

main()
	.catch(async (error) => {
		console.error(error instanceof Error ? error.message : "验收数据创建失败");
		await db.$disconnect();
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
