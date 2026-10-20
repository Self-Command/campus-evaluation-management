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
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
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
		scoreMode?: "FIXED" | "INDIVIDUAL";
	};
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCommitted: () => void;
}) {
	const [nodeId, setNodeId] = useState(item.nodeId);
	const [points, setPoints] = useState(item.points);
	const [scoreMode, setScoreMode] = useState(item.scoreMode || "FIXED");
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
						先预览全部学生影响，再填写理由提交。已发布结果和历史快照保留。
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
						...(kind === "activity" ? { scoreMode } : {}),
					}}
					onBusyChange={setBusy}
					onCommitted={onCommitted}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="correct-node">更正后计分模块</FieldLabel>
							<NativeSelect
								id="correct-node"
								value={nodeId}
								onChange={(event) => setNodeId(event.target.value)}
								required
							>
								{term.scheme.nodes
									.filter((node) => node.kind === "ACTIVITY")
									.map((node) => (
										<NativeSelectOption key={node.id} value={node.id}>
											{node.name}
										</NativeSelectOption>
									))}
							</NativeSelect>
						</Field>
						{kind === "activity" && (
							<Field>
								<FieldLabel htmlFor="correct-score-mode">
									更正后活动计分方式
								</FieldLabel>
								<NativeSelect
									id="correct-score-mode"
									value={scoreMode}
									onChange={(event) =>
										setScoreMode(event.target.value as "FIXED" | "INDIVIDUAL")
									}
								>
									<NativeSelectOption value="FIXED">固定分</NativeSelectOption>
									<NativeSelectOption value="INDIVIDUAL">
										逐人分
									</NativeSelectOption>
								</NativeSelect>
							</Field>
						)}
						<Field>
							<FieldLabel htmlFor="correct-points">
								更正后分值 / 逐人分上限
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
