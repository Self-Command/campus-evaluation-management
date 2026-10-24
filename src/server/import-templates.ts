import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { assertActivityManager } from "@/server/activity-policy";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { templateFor, parseAccountImportRole, type ImportKind, type ImportTemplate } from "@/lib/imports/templates";

const contextSchema = z.object({
	termId: z.string().min(1).max(100).optional(),
	nodeId: z.string().min(1).max(100).optional(),
	activityId: z.string().min(1).max(100).optional(),
});

export async function resolveImportTemplate(
	sessionId: string,
	kind: ImportKind,
	rawContext: { termId?: string | null; nodeId?: string | null; activityId?: string | null; accountRole?: string | null },
): Promise<ImportTemplate> {
	const context = contextSchema.parse(Object.fromEntries(
		Object.entries(rawContext)
			.filter(([key, value]) => key !== "accountRole" && value != null),
	));
	if (kind === "accounts") {
		const current = await getCurrentSession(sessionId);
		if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword)
			throw new AccountError("没有访问权限", 403);
		return templateFor("accounts", parseAccountImportRole(rawContext.accountRole ?? null));
	}
	if (kind === "grades") {
		if (!context.termId || !context.nodeId)
			throw new AccountError("下载成绩模板前请选择测评周期和成绩模块");
		return termTransaction(
			sessionId,
			context.termId,
			["ADMIN", "COUNSELOR"],
			["ACTIVE"],
			async (tx, term, actorId) => {
				const node = validateScheme(term.scheme).nodes.get(context.nodeId!);
				if (!node || node.kind !== "GRADE")
					throw new AccountError("目标必须为成绩输入模块");
				const actor = await tx.user.findUniqueOrThrow({
					where: { id: actorId },
					select: { role: true },
				});
				if (actor.role === "COUNSELOR") {
					const classes = await tx.schoolClass.count({
						where: { counselorId: actorId, enabled: true },
					});
					if (!classes)
						throw new AccountError("当前账号尚未负责任何启用班级", 403);
				}
				return templateFor("grades");
			},
			"read",
		);
	}
	if (!context.termId || !context.activityId)
		throw new AccountError("下载参与名单模板前请选择测评周期和活动");
	return termTransaction(
		sessionId,
		context.termId,
		["ADMIN", "PUBLISHER", "COLLEGE"],
		["ACTIVE"],
		async (tx, term, actorId) => {
			const activity = await tx.activity.findUnique({
				where: { id: context.activityId! },
			});
			if (!activity || activity.termId !== term.id)
				throw new AccountError("活动不存在", 404);
			const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
			assertActivityManager(activity, actor);
			if (!activity.publishedAt)
				throw new AccountError("活动尚未发布，不能下载参与名单模板", 409);
			return templateFor("participation");
		},
		"read",
	);
}
