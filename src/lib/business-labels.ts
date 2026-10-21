export type AppRole =
	| "ADMIN"
	| "COLLEGE"
	| "COUNSELOR"
	| "PUBLISHER"
	| "STUDENT";
export const roleLabels = {
	ADMIN: "学校管理员",
	COLLEGE: "学院管理人员",
	COUNSELOR: "辅导员",
	PUBLISHER: "活动发布者",
	STUDENT: "学生",
};
export const phaseLabels: Record<string, string> = {
	CONFIGURATION: "配置中",
	ACTIVE: "进行中",
	CHECKING: "结果核对",
	LOCKED: "已锁定",
};
export const statusLabels: Record<string, string> = {
	PENDING: "待审核",
	APPROVED: "已通过",
	REJECTED: "未通过",
	NEEDS_CHANGES: "待补充",
	WITHDRAWN: "已撤回",
	REVOKED: "已撤销",
	PENDING_COUNSELOR: "待辅导员处理",
	PENDING_COLLEGE: "待学院审核",
	RETURNED: "已退回",
	SUPERSEDED: "已替代",
	REMOVED: "已移除",
	RESCORING: "待重评",
	ABANDONED: "已放弃",
	OPEN: "待处理",
	PROCESSING: "处理中",
	RESOLVED: "已解决",
};
export function dateText(value: string | Date) {
	return new Date(value).toLocaleString("zh-CN", {
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}
