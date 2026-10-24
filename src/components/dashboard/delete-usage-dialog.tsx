"use client";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import type { ManagementBlocker } from "@/lib/management-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Feedback, requestJson } from "./feedback";
import { useRemote } from "./use-remote";

export type DeleteUsageTarget = {
	id: string;
	name: string;
	login?: string;
	revision: number;
	canDelete: boolean;
	blockers: ManagementBlocker[];
	notes: string[];
	parentLabel?: string;
	kind?: string;
	disabled?: boolean;
};

export function DeleteUsageDialog({
	open,
	onOpenChange,
	title,
	description,
	usageUrl,
	deleteUrl,
	deleteMethod = "DELETE",
	confirmLabel,
	buildBody,
	onDeleted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	usageUrl: string | null;
	deleteUrl: string | null;
	deleteMethod?: "DELETE" | "POST";
	confirmLabel: string;
	buildBody: (usage: DeleteUsageTarget, reason: string, confirm: string) => unknown;
	onDeleted: (result: unknown, usage: DeleteUsageTarget) => void;
}) {
	const remote = useRemote<DeleteUsageTarget>(open ? usageUrl : null);
	const [reason, setReason] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const usage = remote.data;
	const expected = usage ? (usage.login ?? usage.name) : "";
	function reset() {
		setReason("");
		setConfirm("");
		setBusy(false);
		setError("");
	}
	function close() {
		if (busy) return;
		reset();
		onOpenChange(false);
	}
	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!usage?.canDelete || !deleteUrl || busy) return;
		if (reason.trim().length < 2) {
			setError("请填写删除理由");
			return;
		}
		if (confirm !== expected) {
			setError(`请输入完整的${confirmLabel}`);
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await requestJson<unknown>(
				deleteUrl,
				buildBody(usage, reason.trim(), confirm),
				deleteMethod,
			);
			onDeleted(result, usage);
			reset();
			onOpenChange(false);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	const blocked = usage ? usage.blockers.length > 0 || !usage.canDelete : false;
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{remote.loading && (
					<div className="flex flex-col gap-3" role="status" aria-label="正在检查关联数据">
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				)}
				{remote.error && <Feedback error={remote.error} />}
				{usage && (
					<form className="flex flex-col gap-4" onSubmit={submit}>
						<div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{usage.name}</span>
								<Badge variant={usage.disabled ? "secondary" : "outline"}>
									{usage.disabled ? "已停用" : "启用中"}
								</Badge>
								{usage.parentLabel && (
									<span className="text-xs text-muted-foreground">
										{usage.parentLabel}
									</span>
								)}
							</div>
							<p className="text-xs text-muted-foreground">
								{usage.login ? `登录账号 ${usage.login} · ` : ""}
								{usage.kind === "college"
									? "学院"
									: usage.kind === "major"
										? "专业"
										: usage.kind === "class"
											? "班级"
											: "记录"}
								：{usage.name}
							</p>
						</div>
						{blocked && (
							<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
								<p className="flex items-center gap-2 font-medium text-destructive">
									<AlertTriangle className="size-4" />
									暂时不能删除
								</p>
								{usage.blockers.length ? (
									<ul className="flex flex-col gap-1.5">
										{usage.blockers.map((blocker) => (
											<li
												key={blocker.key}
												className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
											>
												<span>{blocker.label}</span>
												<span className="tabular-nums text-muted-foreground">
													{blocker.count}
													{blocker.hint ? ` · ${blocker.hint}` : ""}
												</span>
											</li>
										))}
									</ul>
								) : (
									<p className="text-sm text-muted-foreground">
										当前记录已不能通过此入口删除。
									</p>
								)}
								<p className="text-sm text-muted-foreground">
									如需停止使用，请改为停用；已有业务记录不会被级联删除。
								</p>
							</div>
						)}
						{!blocked && (
							<>
								{usage.notes.length > 0 && (
									<ul className="flex list-disc flex-col gap-1 rounded-lg border bg-muted/30 p-3 pl-7 text-sm text-muted-foreground">
										{usage.notes.map((note) => (
											<li key={note}>{note}</li>
										))}
									</ul>
								)}
								<FieldGroup className="gap-3">
									<Field>
										<FieldLabel htmlFor="delete-usage-reason">
											删除理由
										</FieldLabel>
										<Textarea
											id="delete-usage-reason"
											value={reason}
											onChange={(event) => setReason(event.target.value)}
											required
											minLength={2}
											maxLength={500}
											rows={3}
											placeholder="说明为什么要删除，将写入审计记录"
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="delete-usage-confirm">
											{confirmLabel}
										</FieldLabel>
										<Input
											id="delete-usage-confirm"
											value={confirm}
											onChange={(event) => setConfirm(event.target.value)}
											autoComplete="off"
											placeholder={expected}
										/>
										<FieldDescription>
											请输入“{expected}”以确认删除，删除后不可恢复。
										</FieldDescription>
									</Field>
								</FieldGroup>
								<Feedback error={error} />
							</>
						)}
						<DialogFooter>
							<Button type="button" variant="outline" onClick={close}>
								{blocked ? "关闭" : "取消"}
							</Button>
							{!blocked && (
								<Button
									type="submit"
									variant="destructive"
									disabled={busy || reason.trim().length < 2 || confirm !== expected}
								>
									{busy ? "正在删除…" : "确认删除"}
								</Button>
							)}
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
