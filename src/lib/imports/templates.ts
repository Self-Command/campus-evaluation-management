import type { Role } from "@/generated/prisma/client";

export const importKinds = ["accounts", "grades", "participation"] as const;
export type ImportKind = (typeof importKinds)[number];

export const importRoles: Record<ImportKind, Role[]> = {
	accounts: ["ADMIN"],
	grades: ["ADMIN", "COUNSELOR"],
	participation: ["ADMIN", "PUBLISHER", "COLLEGE"],
};

export const participationBaseHeaders = ["学号", "姓名", "学院", "专业", "班级"] as const;
export const participationImportHeaders = ["学号", "姓名"] as const;
export const gradeImportHeaders = ["学号", "姓名", "成绩"] as const;
export const staffAccountHeaders = ["登录账号", "姓名", "学院编码", "学院名称"] as const;

export const accountImportRoles = ["STUDENT", "COUNSELOR", "COLLEGE"] as const;
export type AccountImportRole = (typeof accountImportRoles)[number];

export function parseAccountImportRole(value: string | null): AccountImportRole {
	return accountImportRoles.includes(value as AccountImportRole)
		? (value as AccountImportRole)
		: "STUDENT";
}

export type ImportTemplate = {
	kind: ImportKind;
	version: string;
	name: string;
	headers: string[];
};

export function parseImportKind(value: string | null): ImportKind | null {
	return importKinds.includes(value as ImportKind) ? (value as ImportKind) : null;
}

const staffTemplateNames: Record<Exclude<AccountImportRole, "STUDENT">, string> = {
	COUNSELOR: "辅导员账号模板-v1.csv",
	COLLEGE: "学院管理人员账号模板-v1.csv",
};

export function templateFor(
	kind: ImportKind,
	accountRole: AccountImportRole = "STUDENT",
): ImportTemplate {
	if (kind === "accounts") {
		if (accountRole !== "STUDENT") {
			return {
				kind,
				version: "accounts-staff-v1",
				name: staffTemplateNames[accountRole],
				headers: [...staffAccountHeaders],
			};
		}
		return {
			kind,
			version: "accounts-v2",
			name: "学生账号模板-v2.csv",
			headers: [...participationBaseHeaders],
		};
	}
	if (kind === "grades") {
		return {
			kind,
			version: "grades-v4",
			name: "成绩输入模板-v4.csv",
			headers: [...gradeImportHeaders],
		};
	}
	return {
		kind,
		version: "participation-v6",
		name: "活动参与名单模板-v6.csv",
		headers: [...participationImportHeaders],
	};
}

export function templateCsv(template: ImportTemplate) {
	return `\uFEFF${template.headers.join(",")}\r\n`;
}
