"use client";
// invoice/client-selector.tsx adapted to an optional real activity association.
import { useState } from "react";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
type Item = { id: string; name: string; organizer: string };
export function ActivityAssociation({
	termId,
	disabled,
}: {
	termId: string;
	disabled: boolean;
}) {
	const [view, setView] = useState("feed");
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<Item | null>(null);
	const remote = useRemote<{ items: Item[]; total: number; page: number }>(
		`/api/activities?termId=${termId}&view=${view}&q=${encodeURIComponent(query)}&page=${page}`,
	);
	const items = Array.from(
		new Map(
			[...(selected ? [selected] : []), ...(remote.data?.items || [])].map(
				(item) => [item.id, item],
			),
		).values(),
	);
	return (
		<FieldGroup>
			<input type="hidden" name="activityId" value={selected?.id || ""} />
			<Field>
				<FieldLabel htmlFor="claim-activity-source">
					关联活动（可选）
				</FieldLabel>
				<FieldDescription>
					同一事实标识在本周期内唯一。与活动属于同一参与事实时请关联，已有效认定的同活动不能重复计分。
				</FieldDescription>
				<NativeSelect
					id="claim-activity-source"
					value={view}
					disabled={disabled}
					onChange={(event) => {
						setView(event.target.value);
						setPage(1);
					}}
				>
					<NativeSelectOption value="feed">已发布活动</NativeSelectOption>
					<NativeSelectOption value="">我参加的活动</NativeSelectOption>
				</NativeSelect>
				<div className="flex flex-wrap gap-2">
					<Input
						aria-label="搜索关联活动"
						value={search}
						disabled={disabled}
						onChange={(event) => setSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								setQuery(search);
								setPage(1);
							}
						}}
						placeholder="活动名称"
					/>
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						onClick={() => {
							setQuery(search);
							setPage(1);
						}}
					>
						搜索活动
					</Button>
				</div>
				<RemoteState {...remote} />
				<NativeSelect
					id="claim-activity"
					value={selected?.id || ""}
					disabled={disabled || remote.loading || !!remote.error}
					onChange={(event) =>
						setSelected(
							items.find((item) => item.id === event.target.value) || null,
						)
					}
				>
					<NativeSelectOption value="">不关联活动</NativeSelectOption>
					{items.map((item) => (
						<NativeSelectOption key={item.id} value={item.id}>
							{item.name} · {item.organizer}
						</NativeSelectOption>
					))}
				</NativeSelect>
				<FieldDescription>
					共 {remote.data?.total ?? "—"} 项 · 第 {page}{" "}
					页。切换搜索或分页保留当前关联。
				</FieldDescription>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled || remote.loading || page <= 1}
						onClick={() => setPage((number) => number - 1)}
					>
						上一页
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={
							disabled ||
							remote.loading ||
							!remote.data ||
							page * 20 >= remote.data.total
						}
						onClick={() => setPage((number) => number + 1)}
					>
						下一页
					</Button>
				</div>
			</Field>
		</FieldGroup>
	);
}
