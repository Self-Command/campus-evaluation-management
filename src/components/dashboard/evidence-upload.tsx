"use client";
import { EvidenceViewer } from "./evidence-viewer";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
type Upload = {
	key: string;
	file: File;
	id?: string;
	state: "uploading" | "success" | "failed";
	error?: string;
};
export function EvidenceUpload({
	onChange,
	onBusy,
}: {
	onChange: (ids: string[]) => void;
	onBusy?: (busy: boolean) => void;
}) {
	const inputId = useId();
	const [items, setItems] = useState<Upload[]>([]);
	const current = useRef<Upload[]>([]);
	function publish(next: Upload[]) {
		current.current = next;
		setItems(next);
		onChange(next.flatMap((x) => (x.id ? [x.id] : [])));
		onBusy?.(next.some((x) => x.state === "uploading"));
	}
	async function upload(item: Upload) {
		publish(
			current.current.map((x) =>
				x.key === item.key ? { ...x, state: "uploading" } : x,
			),
		);
		try {
			if (item.file.size > 5 * 1024 * 1024) throw new Error("文件需在5MB以内");
			const res = await fetch("/api/evidence", {
				method: "POST",
				headers: {
					"Content-Type": "application/octet-stream",
					"x-file-name": encodeURIComponent(item.file.name),
				},
				body: item.file,
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "上传失败");
			publish(
				current.current.map((x) =>
					x.key === item.key
						? { ...x, id: data.id, state: "success", error: undefined }
						: x,
				),
			);
		} catch (err) {
			publish(
				current.current.map((x) =>
					x.key === item.key
						? { ...x, state: "failed", error: (err as Error).message }
						: x,
				),
			);
		}
	}
	return (
		<Field>
			<FieldLabel htmlFor={inputId}>证明材料</FieldLabel>
			<Input
				id={inputId}
				type="file"
				accept="image/png,image/jpeg,application/pdf"
				multiple
				disabled={items.length >= 5}
				onChange={(e) => {
					const files = Array.from(e.target.files || []).slice(
						0,
						5 - current.current.length,
					);
					const next = files.map((file) => ({
						key: crypto.randomUUID(),
						file,
						state: "uploading" as const,
					}));
					publish([...current.current, ...next]);
					for (const item of next) void upload(item);
					e.target.value = "";
				}}
			/>
			<FieldDescription>
				PNG、JPEG或PDF，每份不超过5MB，最多5份。请等待上传完成后提交。
			</FieldDescription>
			<div className="flex flex-col gap-2" aria-live="polite">
				{items.map((item) => (
					<div
						key={item.key}
						className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
					>
						<div className="min-w-0">
							<p className="max-w-64 truncate text-sm">{item.file.name}</p>
							<p className="text-xs text-muted-foreground">
								{item.state === "uploading"
									? "正在上传…"
									: item.state === "success"
										? "已上传"
										: item.error}
							</p>
						</div>
						<div className="flex flex-wrap gap-1">
							{item.state === "success" && item.id && (
								<EvidenceViewer
									compact
									evidence={{ id: item.id, name: item.file.name }}
								/>
							)}
							{item.state === "failed" && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => void upload(item)}
								>
									重试
								</Button>
							)}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={item.state === "uploading"}
								onClick={() =>
									publish(current.current.filter((x) => x.key !== item.key))
								}
							>
								移除
							</Button>
						</div>
					</div>
				))}
			</div>
		</Field>
	);
}
