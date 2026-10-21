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
						title: "学生档案",
						url: "/students",
						icon: GraduationCap,
					},
					{
						id: "terms",
						title: "测评周期",
						url: "/terms",
						icon: CalendarDays,
					},
				],
			},
			{
				id: 2,
				label: "测评业务",
				items: [
					{
						id: "activities",
						title:
							role === "COLLEGE" ? "活动管理" : "活动参与",
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
						title: "成果申报审核",
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
							id: 3,
							label: "数据与账号",
							items: [
								{
									id: "imports",
									title: "参与名单导入",
									url: "/imports?kind=participation",
									icon: FileInput,
								},
								{
									id: "organizations",
									title: "组织架构",
									url: "/organizations",
									icon: Building2,
								},
							],
						},
					]
				: []),
			{
				id: 4,
				label: "个人",
				items: [
					{
						id: "account",
						title: "个人设置",
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
				{
					id: "terms",
					title: "测评周期",
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
								: "活动管理",
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
					title: role === "ADMIN" ? "活动参与审核" : "活动参与",
					url: "/recognitions",
					icon: ListChecks,
				},
				...(role !== "PUBLISHER"
					? [
							{
								id: "results",
								title: role === "STUDENT" ? "我的成绩" : "成绩查询",
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
								title: "组织架构",
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
								title: "数据导入",
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
								title: "我的档案",
								url: "/profile",
								icon: CircleUser,
							},
						]
					: []),
				{
					id: "account",
					title: "个人设置",
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
