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
	Building2,
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
	if (role === "COLLEGE" || role === "COUNSELOR")
		return [
			{
				id: 1,
				label: "总览",
				items: [
					{
						id: "home",
						title: "工作台",
						url: "/",
						icon: LayoutDashboard,
					},
				],
			},
			{
				id: 2,
				label: "学生",
				items: [
					{
						id: "students",
						title:
							role === "COLLEGE" ? "本院学生" : "我的学生",
						url: "/students",
						icon: GraduationCap,
					},
				],
			},
			{
				id: 3,
				label: "测评业务",
				items: [
					{
						id: "activities",
						title: "本院活动",
						url: "/activities",
						icon: ClipboardList,
					},
					{
						id: "recognitions",
						title: "活动参与审核",
						url: "/recognitions",
						icon: ListChecks,
					},
					{
						id: "claims",
						title:
							role === "COLLEGE" ? "成果申报审核" : "成果评分",
						url: "/claims",
						icon: ClipboardList,
					},
					{
						id: "grades",
						title: role === "COLLEGE" ? "成绩审核" : "成绩录入",
						url: "/grades",
						icon: ListChecks,
					},
					{
						id: "deductions",
						title: role === "COLLEGE" ? "扣分审核" : "扣分管理",
						url: "/deductions",
						icon: MinusCircle,
					},
				],
			},
			...(role === "COLLEGE"
				? [
						{
							id: 4,
							label: "数据与账号",
							items: [
								{
									id: "imports",
									title: "导入活动名单",
									url: "/imports?kind=participation",
									icon: FileInput,
								},
								{
									id: "organizations",
									title: "本院班级",
									url: "/organizations",
									icon: Building2,
								},
							],
						},
					]
				: []),
			{
				id: 5,
				label: "个人",
				items: [
					{
						id: "account",
						title: "个人账号",
						url: "/account",
						icon: ShieldCheck,
					},
				],
			},
		];
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
				...(role !== "STUDENT"
					? [
							{
								id: "terms",
								title: "测评周期",
								url: "/terms",
								icon: CalendarDays,
							},
						]
					: []),
				{
					id: "activities",
					title:
						role === "ADMIN"
							? "活动管理"
							: role === "STUDENT"
								? "活动"
								: "我的活动",
					url: role === "STUDENT" ? "/my-activities" : "/activities",
					icon: ClipboardList,
				},
				...(role === "STUDENT"
					? []
					: [
							{
								id: "recognitions",
								title:
									role === "ADMIN" ? "活动参与记录" : "活动参与",
								url: "/recognitions",
								icon: ListChecks,
							},
						]),
				...(role !== "PUBLISHER"
					? [
							{
								id: "results",
								title: role === "STUDENT" ? "我的成绩" : "学生成绩查询",
								url: "/results",
								icon: GraduationCap,
							},
							{
								id: "claims",
								title: role === "ADMIN" ? "成果申报监督" : "成果申报",
								url: "/claims",
								icon: ClipboardList,
							},
							{
								id: "appeals",
								title: role === "ADMIN" ? "成绩异议处理" : "我的成绩异议",
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
								id: "organizations",
								title: "学院与班级",
								url: "/organizations",
								icon: Building2,
							},
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
								title: "批量导入",
								url: "/imports",
								icon: FileInput,
							},
							{
								id: "publication",
								title: "结果发布",
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
								title: "我的学籍信息",
								url: "/profile",
								icon: CircleUser,
							},
						]
					: []),
				{
					id: "account",
					title: "个人账号",
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
