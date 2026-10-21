"use client";
// Complete dashboard/profile/page.tsx, profile-header and personal-details, including tab and responsive details structure.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, LockKeyhole } from "lucide-react";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { AuthForm } from "@/components/dashboard/auth-form";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { roleLabels, dateText, type AppRole } from "@/lib/business-labels";
import type { StudentOrganization } from "@/lib/organization-types";
type AccountData = {
	id: string;
	login: string;
	name: string;
	role: AppRole;
	mustChangePassword: boolean;
	revision: number;
	createdAt: string;
	college: { id: string; name: string; code: string; enabled: boolean } | null;
	studentProfile: StudentOrganization | null;
};
export function Account() {
	const remote = useRemote<AccountData>("/api/account");
	return (
		<>
			<RemoteState {...remote} />
			{remote.data && (
				<AccountDetails
					key={remote.data.revision}
					data={remote.data}
					reload={remote.reload}
				/>
			)}
		</>
	);
}
function AccountDetails({
	data,
	reload,
}: {
	data: AccountData;
	reload: () => void;
}) {
	const studentProfile = data.role === "STUDENT" ? data.studentProfile : null;
	const router = useRouter();
	const [name, setName] = useState(data.name);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	useUnsavedChanges(name !== data.name);
	return (
		<div className="flex min-w-0 max-w-full flex-col gap-4 py-4">
			<Breadcrumb className="min-w-0">
				<BreadcrumbList>
					<BreadcrumbItem>
						<Link href="/">工作台</Link>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>个人资料与安全</BreadcrumbPage>
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
								{data.login} · {roleLabels[data.role]}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Badge variant="outline">账号正常</Badge>
							<Badge variant="outline">
								<ShieldCheck data-icon="inline-start" />
								学校统一账号
							</Badge>
						</div>
					</div>
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
						<TabsTrigger value="personal">个人信息</TabsTrigger>
						<TabsTrigger value="security">账号与密码安全</TabsTrigger>
					</TabsList>
				</div>
				<div className="min-w-0 max-w-full">
					<TabsContent value="personal">
						<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
							<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
								<Feedback error={error} success={success} />
								<form
									className="flex max-w-xl flex-col gap-5"
									onSubmit={async (e) => {
										e.preventDefault();
										if (busy) return;
										setBusy(true);
										setError("");
										try {
											await requestJson(
												"/api/account",
												{ name, revision: data.revision },
												"PATCH",
											);
											setSuccess("个人显示姓名已保存。");
											reload();
											router.refresh();
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor="self-name">显示姓名</FieldLabel>
											<Input
												id="self-name"
												value={name}
												onChange={(e) => setName(e.target.value)}
												required
												minLength={2}
												maxLength={80}
												autoComplete="name"
											/>
											<FieldDescription>
												姓名会显示在活动、申报和成绩记录中。
											</FieldDescription>
										</Field>
									</FieldGroup>
									<Button
										type="submit"
										className="self-start"
										disabled={busy || name === data.name}
									>
										{busy ? "正在保存…" : "保存个人信息"}
									</Button>
								</form>
								<Separator />
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-2">
										<h2 className="font-medium text-base">账号信息</h2>
										<Badge variant="outline">
											<LockKeyhole data-icon="inline-start" />
											只读
										</Badge>
									</div>
									<dl className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3 xl:gap-12">
										{[
											[
												["登录账号 / 学号", data.login],
												["角色", roleLabels[data.role]],
											],
											[
												[
													"学院",
													studentProfile?.college ||
														data.college?.name ||
														(["COLLEGE", "COUNSELOR"].includes(data.role)
															? "—"
															: undefined),
												],
												["专业", studentProfile?.major],
											],
											[
												["班级", studentProfile?.className],
												[
													"责任辅导员",
													studentProfile?.schoolClass?.counselor?.name ||
														(studentProfile ? "未设置" : undefined),
												],
												[
													"学生班级状态",
													studentProfile
														? studentProfile.classId
															? "已配置班级"
															: "未设置"
														: undefined,
												],
												["账号建立时间", dateText(data.createdAt)],
											],
										].map((group, index) => (
											<div key={index} className="flex flex-col gap-5">
												{group.map(([label, value]) => (
													<div key={label} className="flex flex-col gap-1">
														<dt className="text-muted-foreground text-xs">
															{label}
														</dt>
														<dd className="break-words text-sm">
															{value || "不适用"}
														</dd>
													</div>
												))}
											</div>
										))}
									</dl>
								</div>
							</div>
							<Separator orientation="vertical" className="hidden lg:block" />
							<div className="flex flex-col gap-3 py-4 lg:pl-6">
								<h2 className="font-medium text-base">资料维护</h2>
								<p className="text-sm text-muted-foreground">
									可自行更新显示姓名。学号、角色及学生学院、专业、班级由管理员统一维护；如有错误请联系管理员。
								</p>
							</div>
						</div>
					</TabsContent>
					<TabsContent value="security">
						<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
							<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
								<h2 className="font-medium text-base">修改登录密码</h2>
								<div className="max-w-xl">
									<AuthForm change embedded />
								</div>
							</div>
							<Separator orientation="vertical" className="hidden lg:block" />
							<div className="flex flex-col gap-3 py-4 lg:pl-6">
								<h2 className="font-medium text-base">安全状态</h2>
								<Badge variant="outline" className="self-start">
									{data.mustChangePassword ? "需要设置密码" : "密码已设置"}
								</Badge>
								<p className="text-sm text-muted-foreground">
									修改密码后，所有已登录会话将失效，请使用新密码重新登录。
								</p>
							</div>
						</div>
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}
