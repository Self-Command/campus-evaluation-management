import {
	LayoutDashboard,
	CalendarDays,
	Users,
	ClipboardList,
	CircleUser,
	ShieldCheck,
	GraduationCap,
	ListChecks,
	Settings,
	FileInput,
	MinusCircle,
	MessageSquareWarning,
	Trophy,
	Send,
	type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/business-labels";
export type NavBadge = "new" | "soon";
export interface NavSubItem {
	id: string;
	title: string;
	url: string;
	icon?: LucideIcon;
	disabled?: boolean;
	newTab?: boolean;
}
interface NavBase {
	id: string;
	title: string;
	icon?: LucideIcon;
	badge?: NavBadge;
	disabled?: boolean;
	newTab?: boolean;
}
export interface NavMainLinkItem extends NavBase {
	url: string;
	subItems?: never;
}
export interface NavMainParentItem extends NavBase {
	subItems: NavSubItem[];
}
export type NavMainItem = NavMainLinkItem | NavMainParentItem;
export interface NavGroup {
	id: number;
	label?: string;
	items: NavMainItem[];
}
export function navigation(role: AppRole): NavGroup[] {
	return [
		{
			id: 1,
			label: "总览",
			items: [{ id: "home", title: "工作台", url: "/", icon: LayoutDashboard }],
		},
		{
			id: 2,
			label: "测评业务",
			items: [
				{
					id: "terms",
					title: role === "ADMIN" ? "测评周期管理" : "测评周期",
					url: "/terms",
					icon: CalendarDays,
				},
				{
					id: "activities",
					title:
						role === "STUDENT"
							? "我参加的活动"
							: role === "PUBLISHER"
								? "我的活动"
								: "活动目录",
					url: "/activities",
					icon: ClipboardList,
				},
				...(role === "STUDENT"
					? [
							{
								id: "activity-feed",
								title: "已发布活动",
								url: "/activity-feed",
								icon: CalendarDays,
							},
						]
					: []),
				{
					id: "recognitions",
					title: role === "ADMIN" ? "活动认定审核" : "活动认定",
					url: "/recognitions",
					icon: ListChecks,
				},
				...(role !== "PUBLISHER"
					? [
							{
								id: "results",
								title: role === "STUDENT" ? "我的测评" : "测评结果",
								url: "/results",
								icon: GraduationCap,
							},
							{
								id: "claims",
								title: role === "ADMIN" ? "个人申报审核" : "个人申报",
								url: "/claims",
								icon: ClipboardList,
							},
							{
								id: "appeals",
								title: role === "ADMIN" ? "结果异议处理" : "我的异议",
								url: "/appeals",
								icon: MessageSquareWarning,
							},
						]
					: []),
			],
		},
		...(role === "ADMIN"
			? [
					{
						id: 3,
						label: "数据与账号",
						items: [
							{
								id: "grades",
								title: "成绩录入",
								url: "/grades",
								icon: ListChecks,
							},
							{
								id: "deductions",
								title: "扣分管理",
								url: "/deductions",
								icon: MinusCircle,
							},
							{
								id: "students",
								title: "学生档案",
								url: "/students",
								icon: GraduationCap,
							},
							{
								id: "accounts",
								title: "账号管理",
								url: "/accounts",
								icon: Users,
							},
							{
								id: "imports",
								title: "数据导入",
								url: "/imports",
								icon: FileInput,
							},
							{
								id: "publication",
								title: "发布与结算",
								url: "/publication",
								icon: Send,
							},
							{
								id: "rankings",
								title: "排名与导出",
								url: "/rankings",
								icon: Trophy,
							},
						],
					},
				]
			: []),
		{
			id: 4,
			label: "个人与系统",
			items: [
				...(role === "STUDENT"
					? [
							{
								id: "profile",
								title: "我的档案",
								url: "/profile",
								icon: CircleUser,
							},
						]
					: []),
				{
					id: "account",
					title: "个人资料与安全",
					url: "/account",
					icon: ShieldCheck,
				},
				...(role === "ADMIN"
					? [
							{
								id: "settings",
								title: "系统设置",
								url: "/settings",
								icon: Settings,
							},
						]
					: []),
			],
		},
	];
}
