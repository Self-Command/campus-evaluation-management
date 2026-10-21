import type { AppRole } from "./business-labels";

export type OrganizationNode = {
	id: string;
	code: string;
	name: string;
	enabled: boolean;
	revision: number;
};
export type Counselor = {
	id: string;
	name: string;
	login: string;
	collegeId: string | null;
	disabled: boolean;
};
export type SchoolClass = OrganizationNode & {
	counselor: Pick<Counselor, "id" | "name" | "login"> | null;
	studentCount: number;
};
export type Major = OrganizationNode & { classes: SchoolClass[] };
export type College = OrganizationNode & { majors: Major[] };
export type OrganizationData = {
	role: AppRole;
	canManage: boolean;
	colleges: College[];
	counselors: Counselor[];
	totals: Record<string, number>;
};
export type StudentOrganization = {
	studentNumber: string;
	college: string;
	major: string;
	className: string;
	classId: string | null;
	schoolClass?: {
		id: string;
		name: string;
		code: string;
		enabled: boolean;
		major: { id: string; name: string; college: { id: string; name: string } };
		counselor: Pick<Counselor, "id" | "name" | "login"> | null;
	} | null;
};
