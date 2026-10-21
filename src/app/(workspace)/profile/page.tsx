import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck, LockKeyhole } from "lucide-react";
import { pageSession } from "@/server/page-session";
import { readStudentProfile } from "@/server/accounts";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
// Complete dashboard/profile/page.tsx, profile-header and profile-personal-details.
export default async function Page() {
	const user = await pageSession();
	if (user.role !== "STUDENT") notFound();
	const data = await readStudentProfile(user.sessionId, user.id);
	return (
		<div className="flex min-w-0 max-w-full flex-col gap-4 py-4">
			<Breadcrumb className="min-w-0">
				<BreadcrumbList>
					<BreadcrumbItem>
						<Link href="/">工作台</Link>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>我的档案</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
				<div className="flex min-w-0 items-center gap-4">
					<div className="grid size-18 shrink-0 place-items-center sm:size-23">
						<Avatar className="size-16 sm:size-20">
							<AvatarFallback>{data.name.slice(0, 1)}</AvatarFallback>
						</Avatar>
					</div>
					<div className="flex min-w-0 flex-col gap-2">
						<div className="flex flex-col gap-0.5">
							<h1 className="truncate font-semibold text-xl leading-6 tracking-tight sm:text-2xl sm:leading-7">
								{data.name}
							</h1>
							<p className="truncate text-muted-foreground text-sm leading-5">
								{data.login} · 学生
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Badge variant="outline">
								{data.studentProfile?.college || "学院未填写"}
							</Badge>
							<Badge variant="outline">
								{data.studentProfile?.className || "班级未填写"}
							</Badge>
							{!data.studentProfile?.classId && (
								<Badge variant="secondary">归属待完善</Badge>
							)}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Link
						href="/account"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<ShieldCheck data-icon="inline-start" />
						账号安全
					</Link>
				</div>
			</div>
			<Tabs
				className="min-h-0 min-w-0 max-w-full flex-1 gap-0"
				defaultValue="personal"
			>
				<div className="scrollbar-none touch-pan-x overflow-x-auto overscroll-x-contain border-y">
					<TabsList
						className="w-max min-w-full justify-start gap-4 *:data-[slot=tabs-trigger]:flex-none"
						variant="line"
					>
						<TabsTrigger value="personal">学生信息</TabsTrigger>
						<TabsTrigger value="account">账号信息</TabsTrigger>
					</TabsList>
				</div>
				<div className="min-w-0 max-w-full">
					<TabsContent className="py-4" value="personal">
						<div className="flex flex-col gap-2">
							<div className="flex items-center gap-2">
								<h2 className="font-medium text-base">个人与组织信息</h2>
								<Badge variant="outline">
									<LockKeyhole data-icon="inline-start" />
									本人可见
								</Badge>
							</div>
							<dl className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3 xl:gap-12">
								{[
									[
										["姓名", data.name],
										["学号", data.studentProfile?.studentNumber],
									],
									[
										["学院", data.studentProfile?.college],
										["专业", data.studentProfile?.major],
									],
									[
										["班级", data.studentProfile?.className],
										[
											"责任辅导员",
											data.studentProfile?.schoolClass?.counselor?.name ||
												"待完善",
										],
									],
								].map((group, i) => (
									<div key={i} className="flex flex-col gap-5">
										{group.map(([label, value]) => (
											<div key={label} className="flex flex-col gap-1">
												<dt className="text-muted-foreground text-xs">
													{label}
												</dt>
												<dd className="break-words text-sm">
													{value || "尚未填写"}
												</dd>
											</div>
										))}
									</div>
								))}
							</dl>
						</div>
						<Separator className="my-4" />
						<div className="flex flex-col gap-2">
							<h2 className="font-medium text-base">档案更正</h2>
							<p className="text-muted-foreground text-sm">
								如学号或组织归属有误，请联系学院管理人员或学校管理员核对并更正。责任辅导员由所在班级确定。
							</p>
						</div>
					</TabsContent>
					<TabsContent className="py-4" value="account">
						<div className="flex flex-col gap-2">
							<h2 className="font-medium text-base">登录账号</h2>
							<p className="text-sm">{data.login}</p>
							<p className="text-muted-foreground text-sm">
								测评申报与成绩始终关联本账号。请妥善保管密码。
							</p>
						</div>
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}
