"use client";
// profile details/history sections, read-only private input audit.
import { useState } from "react";
import { useRemote } from "./use-remote";
import { RemoteState } from "./remote-state";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { dateText } from "@/lib/business-labels";
type Event = {
	id: string;
	at: string;
	actor: string | { name?: string; login?: string } | null;
	action: string;
	before: unknown;
	after: unknown;
	reason?: string;
};
function valueText(value: unknown): string {
	if (value === null || value === undefined) return "无记录";
	if (typeof value === "object") {
		const item = value as Record<string, unknown>;
		return Object.entries(item)
			.map(
				([key, entry]) =>
					`${({ amount: "扣分额", revoked: "已撤销", value: "成绩", reason: "理由" } as Record<string, string>)[key] || key}：${valueText(entry)}`,
			)
			.join("；");
	}
	return typeof value === "boolean" ? (value ? "是" : "否") : String(value);
}
export function InputHistory({
	termId,
	kind,
	id,
}: {
	termId: string;
	kind: "grade" | "deduction";
	id: string;
}) {
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState(1);
	const remote = useRemote<{ items: Event[]; total: number; page: number }>(
		open
			? `/api/input-history?termId=${termId}&kind=${kind}&id=${encodeURIComponent(id)}&page=${page}`
			: null,
	);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				type="button"
				onClick={() => {
					setPage(1);
					setOpen(true);
				}}
			>
				查看{kind === "grade" ? "成绩" : "扣分"}变更历史
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{kind === "grade" ? "成绩" : "扣分"}变更历史
						</DialogTitle>
						<DialogDescription>
							录入、更正及撤销保留操作人、前后值和业务理由；所选发布版本的分数仍以冻结结果为准。
						</DialogDescription>
					</DialogHeader>
					<RemoteState {...remote} />
					{remote.data && (
						<div className="flex flex-col gap-5">
							{remote.data.items.length ? (
								remote.data.items.map((event) => (
									<section
										key={event.id}
										className="flex flex-col gap-3 border-l pl-4"
									>
										<div>
											<p className="text-sm font-medium">
												{(
													{
														GRADE_SAVED: "保存成绩",
														GRADE_IMPORTED: "导入成绩",
														DEDUCTION_SAVED: "保存扣分",
														DEDUCTION_REVOKED: "撤销扣分",
													} as Record<string, string>
												)[event.action] || "变更记录"}
											</p>
											<p className="text-xs text-muted-foreground">
												{dateText(event.at)} ·{" "}
												{typeof event.actor === "string"
													? event.actor
													: event.actor?.name || event.actor?.login || "—"}
											</p>
										</div>
										<dl className="grid gap-3 sm:grid-cols-2">
											<div>
												<dt className="text-xs text-muted-foreground">
													变更前
												</dt>
												<dd className="break-words text-sm">
													{valueText(event.before)}
												</dd>
											</div>
											<div>
												<dt className="text-xs text-muted-foreground">
													变更后
												</dt>
												<dd className="break-words text-sm">
													{valueText(event.after)}
												</dd>
											</div>
										</dl>
										<p className="whitespace-pre-wrap text-sm">
											理由：{event.reason || "未提供"}
										</p>
									</section>
								))
							) : (
								<p className="text-sm text-muted-foreground">
									暂无可查看的变更记录。
								</p>
							)}
							<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
								<p className="text-xs text-muted-foreground">
									共 {remote.data.total} 条 · 第 {remote.data.page} 页
								</p>
								<div className="flex gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={page <= 1}
										onClick={() => setPage((number) => number - 1)}
									>
										上一页
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={page * 20 >= remote.data.total}
										onClick={() => setPage((number) => number + 1)}
									>
										下一页
									</Button>
								</div>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
