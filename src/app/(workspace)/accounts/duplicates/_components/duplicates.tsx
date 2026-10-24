"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { NoData } from "@/components/dashboard/page-heading";

type BusinessCounts = {
	grades: number;
	deductions: number;
	participations: number;
	claims: number;
	confirmations: number;
	appeals: number;
	publishedResults: number;
	gradeChanges: number;
	deductionChanges: number;
	recognitionSources: number;
};

type DuplicateAccount = {
	id: string;
	login: string;
	name: string;
	studentNumber: string;
	college: string;
	major: string;
	className: string;
	disabled: boolean;
	mergedIntoId: string | null;
	createdAt: string;
	businessCounts: BusinessCounts;
	businessTotal: number;
	recommended: boolean;
	canDisable: boolean;
};

type DuplicateGroup = {
	key: string;
	classKey: string;
	nameKey: string;
	name: string;
	college: string;
	major: string;
	className: string;
	status: "OPEN" | "CONFIRMED";
	unresolvedPairs: number;
	accounts: DuplicateAccount[];
};

type Data = {
	groups: DuplicateGroup[];
	generatedAt: string;
};

const businessLabels: Record<keyof BusinessCounts, string> = {
	grades: "成绩",
	deductions: "扣分",
	participations: "参与",
	claims: "申报",
	confirmations: "结果确认",
	appeals: "异议",
	publishedResults: "发布结果",
	gradeChanges: "成绩修订",
	deductionChanges: "扣分修订",
	recognitionSources: "认定来源",
};

function businessText(account: DuplicateAccount) {
	const parts = (
		Object.entries(account.businessCounts) as [
			keyof BusinessCounts,
			number,
		][]
	)
		.filter(([, value]) => value > 0)
		.map(([key, value]) => `${businessLabels[key]}${value}`);
	return parts.length ? parts.join("、") : "无业务记录";
}

function formatDate(value: string) {
	return new Date(value).toLocaleString("zh-CN", {
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function DuplicateAccounts({ data }: { data: Data }) {
	const router = useRouter();
	const [target, setTarget] = useState<{
		group: DuplicateGroup;
		account: DuplicateAccount;
	} | null>(null);
	const [keepId, setKeepId] = useState("");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	const keepOptions =
		target?.group.accounts.filter(
			(account) =>
				account.id !== target.account.id &&
				!account.disabled &&
				!account.mergedIntoId,
		) ?? [];

	function openDisable(group: DuplicateGroup, account: DuplicateAccount) {
		const fallback =
			group.accounts.find(
				(candidate) =>
					candidate.id !== account.id &&
					!candidate.disabled &&
					!candidate.mergedIntoId,
			)?.id ?? "";
		setTarget({ group, account });
		setKeepId(fallback);
		setReason("");
		setError("");
		setSuccess("");
	}

	async function submit() {
		if (!target || !keepId || reason.trim().length < 10) return;
		setBusy(true);
		setError("");
		setSuccess("");
		try {
			await requestJson("/api/admin/account-duplicates", {
				studentId: target.account.id,
				keepId,
				reason: reason.trim(),
			});
			setSuccess(
				`已停用 ${target.account.name}（${target.account.login}），保留账号和全部历史记录。`,
			);
			setTarget(null);
			router.refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "操作未完成");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<Feedback error={error} success={success} />
			{data.groups.length === 0 ? (
				<NoData
					title="没有发现重复账号"
					description="当前学生账号中不存在同班同名、学号不同的组合。"
				/>
			) : (
				<>
					<div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
						<ShieldAlert className="mt-0.5 size-4 shrink-0" />
						<p>
							处置只会停用重复账号并标记保留账号，不删除账号、不删除成绩、申报、参与和审核历史。已有业务记录的账号必须先由业务负责人核对迁移，系统不会自动合并业务数据。
						</p>
					</div>
					{data.groups.map((group) => (
						<Card key={group.key}>
							<CardHeader>
								<CardTitle className="flex flex-wrap items-center gap-2">
									{group.name}
									<Badge
										variant={
											group.status === "OPEN"
												? "destructive"
												: "outline"
										}
									>
										{group.status === "OPEN"
											? `待确认 ${group.unresolvedPairs} 组`
											: "已确认保留"}
									</Badge>
								</CardTitle>
								<CardDescription>
									{group.college} · {group.major} · {group.className}
									，共 {group.accounts.length} 个同班同名账号
								</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="overflow-x-auto rounded-lg border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>账号</TableHead>
												<TableHead>学号</TableHead>
												<TableHead>创建时间</TableHead>
												<TableHead>业务与历史记录</TableHead>
												<TableHead>状态</TableHead>
												<TableHead className="text-right">
													操作
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{group.accounts.map((account) => (
												<TableRow key={account.id}>
													<TableCell>
														<div className="flex flex-wrap items-center gap-2">
															<span className="font-medium">
																{account.login}
															</span>
															{account.recommended && (
																<Badge variant="secondary">
																	建议保留
																</Badge>
															)}
														</div>
													</TableCell>
													<TableCell className="font-mono text-xs">
														{account.studentNumber}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{formatDate(account.createdAt)}
													</TableCell>
													<TableCell className="max-w-72 whitespace-normal text-muted-foreground">
														{businessText(account)}
													</TableCell>
													<TableCell>
														<div className="flex flex-wrap gap-1">
															<Badge
																variant={
																	account.disabled
																		? "outline"
																		: "secondary"
																}
															>
																{account.disabled
																	? "已停用"
																	: "启用中"}
															</Badge>
															{account.mergedIntoId && (
																<Badge variant="outline">
																	已标记保留账号
																</Badge>
															)}
														</div>
													</TableCell>
													<TableCell className="text-right">
														<Button
															variant="outline"
															size="sm"
															disabled={!account.canDisable}
															title={
																account.disabled
																	? "账号已停用"
																	: account.businessTotal > 0
																		? "请先迁移业务记录"
																		: "该账号没有待确认的重复组合"
															}
															onClick={() =>
																openDisable(group, account)
															}
														>
															停用并标记重复
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</CardContent>
						</Card>
					))}
				</>
			)}

			<Dialog
				open={!!target}
				onOpenChange={(open) => {
					if (!open && !busy) setTarget(null);
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>停用重复账号</DialogTitle>
						<DialogDescription>
							停用后该账号立即无法登录，历史业务记录仍保留在原账号。请确认保留哪一个账号。
						</DialogDescription>
					</DialogHeader>
					{target && (
						<div className="flex flex-col gap-4">
							<div className="rounded-lg border bg-muted/30 p-3 text-sm">
								<p>
									待停用：{target.account.name} ·{" "}
									{target.account.login} ·{" "}
									{target.account.studentNumber}
								</p>
								<p className="mt-1 text-muted-foreground">
									当前无业务或历史记录，可以安全停用。
								</p>
							</div>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="duplicate-keep">
										保留账号
									</FieldLabel>
									<NativeSelect
										id="duplicate-keep"
										value={keepId}
										disabled={busy}
										onChange={(event) =>
											setKeepId(event.target.value)
										}
									>
										<NativeSelectOption value="">
											请选择保留账号
										</NativeSelectOption>
										{keepOptions.map((account) => (
											<NativeSelectOption
												key={account.id}
												value={account.id}
											>
												{account.login} · {account.name}
												{account.recommended
													? "（建议保留）"
													: ""}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
								<Field>
									<FieldLabel htmlFor="duplicate-reason">
										核对理由
									</FieldLabel>
									<Input
										id="duplicate-reason"
										value={reason}
										disabled={busy}
										maxLength={500}
										onChange={(event) =>
											setReason(event.target.value)
										}
										placeholder="如：辅导员核对学籍名单，确认保留较早建立且承担全部业务的账号"
									/>
									<FieldDescription>
										至少10个字。理由会写入永久审计记录，并作为后续导入的同班同名确认依据。
									</FieldDescription>
								</Field>
							</FieldGroup>
							<Feedback error={error} />
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => setTarget(null)}
								>
									取消
								</Button>
								<Button
									disabled={
										busy ||
										!keepId ||
										reason.trim().length < 10
									}
									onClick={() => void submit()}
								>
									{busy ? "正在处理…" : "确认停用"}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
