"use client";
import { useState } from "react";
import { CorrectionReview } from "./correction-review";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import { Input } from "@/components/ui/input";
import type { Scheme } from "@/lib/scoring/types";
export function ScoringCorrection({
	term,
	kind,
	item,
	open,
	onOpenChange,
	onCommitted,
}: {
	term: { id: string; revision: number; scheme: Scheme };
	kind: "activity" | "project";
	item: {
		id: string;
		nodeId: string;
		points: string;
	};
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCommitted: () => void;
}) {
	const [nodeId, setNodeId] = useState(item.nodeId);
	const [points, setPoints] = useState(item.points);
	const [busy, setBusy] = useState(false);
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!busy && (value || window.confirm("放弃本次尚未提交的分值更正？")))
					onOpenChange(value);
			}}
		>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle>
						{kind === "activity" ? "活动计分更正" : "认定项目计分更正"}
					</DialogTitle>
					<DialogDescription>
						先预览全部学生影响，再填写理由提交。已发布结果和历史存档保留。
					</DialogDescription>
				</DialogHeader>
				<CorrectionReview
					termId={term.id}
					revision={term.revision}
					payload={{
						kind,
						id: item.id,
						nodeId,
						points,
					}}
					onBusyChange={setBusy}
					onCommitted={onCommitted}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="correct-node">更正后计分模块</FieldLabel>
							<SearchableSelect
								id="correct-node"
								value={nodeId}
								onValueChange={setNodeId}
								placeholder="选择计分模块"
								searchPlaceholder="搜索计分模块"
								options={term.scheme.nodes
									.filter((node) => node.kind === "ACTIVITY")
									.map((node) => ({ value: node.id, label: node.name }))}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="correct-points">
								更正后分值
							</FieldLabel>
							<Input
								id="correct-points"
								value={points}
								onChange={(event) => setPoints(event.target.value)}
								inputMode="decimal"
								required
							/>
						</Field>
					</FieldGroup>
				</CorrectionReview>
			</DialogContent>
		</Dialog>
	);
}
