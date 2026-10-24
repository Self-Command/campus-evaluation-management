export type ManagementBlocker = {
	key: string;
	label: string;
	count: number;
	hint?: string;
};

export type OrganizationUsage = {
	kind: "college" | "major" | "class";
	id: string;
	code: string;
	name: string;
	enabled: boolean;
	revision: number;
	parentLabel: string;
	canDelete: boolean;
	blockers: ManagementBlocker[];
	notes: string[];
};

export type AccountUsage = {
	id: string;
	login: string;
	name: string;
	role: string;
	disabled: boolean;
	revision: number;
	collegeName: string | null;
	className: string | null;
	canDelete: boolean;
	blockers: ManagementBlocker[];
	notes: string[];
};

export type ImportRowResult = {
	line: number;
	login: string;
	name: string;
	role: string;
	college: string | null;
	collegeCode: string | null;
	major: string | null;
	className: string | null;
	state: "CREATED" | "SKIPPED" | "ERROR";
	action: string | null;
	userId: string | null;
	message: string;
	accountExists?: boolean;
};

export type ImportBatchSummary = {
	id: string;
	createdAt: string;
	committedAt: string | null;
	actor: { id: string; name: string; login: string } | null;
	targetRole: "STUDENT" | "COUNSELOR" | "COLLEGE";
	note: string | null;
	status: "COMMITTED" | "REVOKED";
	created: number;
	skipped: number;
	rowCount: number;
	revokedAt: string | null;
	revokeReason: string | null;
};

export type ImportRevokeAccount = {
	line: number;
	login: string;
	name: string;
	blockers: ManagementBlocker[];
};

export type ImportBatchDetail = ImportBatchSummary & {
	rows: ImportRowResult[];
	revoke: {
		canRevoke: boolean;
		reason: string | null;
		accounts: ImportRevokeAccount[];
		missing: { line: number; login: string; name: string }[];
	};
};
