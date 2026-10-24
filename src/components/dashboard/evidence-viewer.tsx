"use client";
// Complete selected template invoice-preview.tsx toolbar/content inside its original Dialog.
import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, ExternalLink, Eye, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Feedback } from "./feedback";

export type EvidenceFile = { id: string; name: string };
export function EvidenceViewer({
	evidence,
	compact = false,
}: {
	evidence: EvidenceFile;
	compact?: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button
				type="button"
				variant="outline"
				size={compact ? "sm" : "default"}
				className={
					compact
						? ""
						: "h-auto w-full justify-start whitespace-normal break-all text-left"
				}
				onClick={() => setOpen(true)}
				aria-label={`预览证明材料：${evidence.name}`}
			>
				<Eye data-icon="inline-start" />
				{compact ? "预览" : evidence.name}
			</Button>
			<DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle className="break-all pr-7">{evidence.name}</DialogTitle>
					<DialogDescription>
						查阅证明材料，可下载原文件或在新窗口打开。
					</DialogDescription>
				</DialogHeader>
				{open && <EvidencePreview key={evidence.id} evidence={evidence} />}
			</DialogContent>
		</Dialog>
	);
}

function EvidencePreview({ evidence }: { evidence: EvidenceFile }) {
	const [attempt, setAttempt] = useState(0);
	const [resource, setResource] = useState<{
		attempt: number;
		url?: string;
		type?: string;
		error?: string;
	} | null>(null);
	const [loadedUrl, setLoadedUrl] = useState("");
	const [renderError, setRenderError] = useState<{
		url: string;
		message: string;
	} | null>(null);
	const endpoint = `/api/evidence/${encodeURIComponent(evidence.id)}`;
	const inline = `${endpoint}?disposition=inline`;
	useEffect(() => {
		const controller = new AbortController();
		let objectUrl: string | undefined;
		async function read() {
			try {
				const response = await fetch(inline, {
					cache: "no-store",
					signal: controller.signal,
				});
				if (!response.ok) {
					const body = await response.json().catch(() => null);
					throw new Error(
						body?.error ||
							(response.status === 403
								? "无权查看这份证明材料。"
								: response.status === 404
									? "证明材料不存在或已不可用。"
									: "证明材料读取失败，请重试。"),
					);
				}
				const type = (response.headers.get("content-type") || "")
					.split(";")[0]
					.trim()
					.toLowerCase();
				if (!["image/png", "image/jpeg", "application/pdf"].includes(type))
					throw new Error("此文件格式无法内嵌预览，请下载原文件查看。");
				const blob = await response.blob();
				if (!blob.size)
					throw new Error("证明材料内容为空，请重试或下载原文件核对。");
				if (controller.signal.aborted) return;
				objectUrl = URL.createObjectURL(blob);
				setResource({ attempt, url: objectUrl, type });
			} catch (err) {
				if (!controller.signal.aborted)
					setResource({ attempt, error: (err as Error).message });
			}
		}
		void read();
		return () => {
			controller.abort();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [inline, attempt]);
	const current = resource?.attempt === attempt ? resource : null;
	const error =
		current?.error ||
		(current?.url === renderError?.url ? renderError?.message : "");
	const isPdf = current?.type === "application/pdf";
	const loading =
		!current || (!!current.url && !isPdf && loadedUrl !== current.url && !error);
	return (
		<div className="flex min-w-0 flex-col rounded-xl border bg-card">
			<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
				<h2 className="font-medium text-lg">证明材料预览</h2>
				<ButtonGroup className="max-w-full flex-wrap" aria-label="证明材料操作">
					<Button
						type="button"
						variant="outline"
						onClick={() => setAttempt((value) => value + 1)}
					>
						<RotateCw data-icon="inline-start" />
						重新读取
					</Button>
					<a
						className={buttonVariants({ variant: "outline" })}
						href={inline}
						target="_blank"
						rel="noopener noreferrer"
					>
						<ExternalLink data-icon="inline-start" />
						新窗口
					</a>
					<a
						className={buttonVariants({ variant: "outline" })}
						href={endpoint}
						download={evidence.name}
					>
						<Download data-icon="inline-start" />
						下载
					</a>
				</ButtonGroup>
			</div>
			<div
				className="relative flex min-h-64 min-w-0 flex-1 flex-col gap-3 rounded-b-xl bg-muted p-4"
				aria-busy={loading}
			>
				<Feedback error={error} />
				{loading && (
					<p role="status" className="text-sm text-muted-foreground">
						{!current ? "正在读取证明材料…" : "正在打开图片…"}
					</p>
				)}
				{current?.url &&
					!error &&
					(isPdf ? (
						<object
							data={current.url}
							type="application/pdf"
							aria-label={`PDF证明材料：${evidence.name}`}
							className="h-[65dvh] min-h-64 w-full"
							onLoad={() => setLoadedUrl(current.url!)}
							onError={() =>
								setRenderError({
									url: current.url!,
									message:
										"PDF未能在当前窗口显示，请重试、下载或在新窗口打开。",
								})
							}
						>
							<p className="text-sm">
								当前浏览器无法内嵌显示此PDF。
								<a
									className="underline"
									href={inline}
									target="_blank"
									rel="noopener noreferrer"
								>
									在新窗口打开
								</a>
								或
								<a
									className="underline"
									href={endpoint}
									download={evidence.name}
								>
									下载原文件
								</a>
								。
							</p>
						</object>
					) : (
						<div className="relative h-[65dvh] min-h-64 w-full">
							<Image
								src={current.url}
								alt={`证明材料：${evidence.name}`}
								fill
								sizes="(max-width: 768px) 90vw, 960px"
								unoptimized
								className="object-contain"
								onLoad={() => setLoadedUrl(current.url!)}
								onError={() =>
									setRenderError({
										url: current.url!,
										message: "图片未能显示，请重试或下载原文件核对。",
									})
								}
							/>
						</div>
					))}
				{isPdf && (
					<p className="text-sm text-muted-foreground">
						如当前浏览器无法显示PDF，请使用上方新窗口或下载原文件查看。
					</p>
				)}
				{error && (
					<Button
						type="button"
						variant="outline"
						className="self-start"
						onClick={() => setAttempt((value) => value + 1)}
					>
						重试预览
					</Button>
				)}
			</div>
		</div>
	);
}
