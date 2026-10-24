"use client";

import { useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import {
	Bold,
	Code2,
	Heading2,
	ImagePlus,
	Italic,
	Link2,
	List,
	ListChecks,
	ListOrdered,
	Minus,
	Paperclip,
	Quote,
	Redo2,
	Strikethrough,
	Table2,
	Undo2,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";

export type AttachmentItem = { id: string; name: string; mime: string; size: number; kind: string; url: string };

export type UploadLimits = { maxFiles: number; maxSizeMb: number; allowed: string[] };

function ToolbarButton({
	label,
	onClick,
	active,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Button
			type="button"
			variant={active ? "secondary" : "ghost"}
			size="icon-sm"
			title={label}
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</Button>
	);
}

export function RichTextEditor({
	name,
	defaultValue,
	activityId,
	limits,
	initialAttachments = [],
	disabled = false,
}: {
	name: string;
	defaultValue: string;
	activityId?: string;
	limits: UploadLimits;
	initialAttachments?: AttachmentItem[];
	disabled?: boolean;
}) {
	const [markdown, setMarkdown] = useState(defaultValue);
	const [attachments, setAttachments] = useState<AttachmentItem[]>(initialAttachments);
	const attachmentsRef = useRef(attachments);
	function commitAttachments(
		next:
			| AttachmentItem[]
			| ((current: AttachmentItem[]) => AttachmentItem[]),
	) {
		const value =
			typeof next === "function" ? next(attachmentsRef.current) : next;
		attachmentsRef.current = value;
		setAttachments(value);
	}
	const [uploading, setUploading] = useState<"image" | "file" | null>(null);
	const [error, setError] = useState("");
	const imageInput = useRef<HTMLInputElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const imageExtensions = ["png", "jpg", "jpeg", "webp", "gif"];
	const imageAccept = limits.allowed
		.filter((extension) => imageExtensions.includes(extension))
		.map((extension) => `.${extension}`)
		.join(",");
	const fileAccept = limits.allowed
		.filter((extension) => !imageExtensions.includes(extension))
		.map((extension) => `.${extension}`)
		.join(",");

	const editor = useEditor({
		extensions: [
			StarterKit,
			Image,
			TableKit,
			TaskList,
			TaskItem.configure({ nested: true }),
			Placeholder.configure({ placeholder: "填写活动介绍，可插入图片、表格和附件" }),
			Markdown,
		],
		content: defaultValue,
		contentType: "markdown",
		immediatelyRender: false,
		editable: !disabled,
		editorProps: {
			attributes: { class: "tiptap-editor" },
			handlePaste: (_view, event) => {
				const files = Array.from(event.clipboardData?.files ?? []);
				if (!files.length) return false;
				event.preventDefault();
				void handleFiles(files);
				return true;
			},
			handleDrop: (_view, event) => {
				const files = Array.from(event.dataTransfer?.files ?? []);
				if (!files.length) return false;
				event.preventDefault();
				void handleFiles(files);
				return true;
			},
		},
		onUpdate: ({ editor: current }) => setMarkdown(current.getMarkdown()),
	});

	async function handleFiles(files: File[]) {
		const room = Math.max(0, limits.maxFiles - attachmentsRef.current.length);
		if (!room) {
			setError(`每个活动最多 ${limits.maxFiles} 个附件`);
			return;
		}
		if (files.length > room) setError(`附件数量超出上限，本次最多再上传 ${room} 个`);
		for (const file of files.slice(0, room))
			await upload(file, file.type.startsWith("image/") ? "image" : "file");
	}

	async function upload(file: File, kind: "image" | "file") {
		setError("");
		if (attachmentsRef.current.length >= limits.maxFiles) {
			setError(`每个活动最多 ${limits.maxFiles} 个附件`);
			return;
		}
		if (file.size > limits.maxSizeMb * 1024 * 1024) {
			setError(`单个附件不能超过 ${limits.maxSizeMb}MB`);
			return;
		}
		setUploading(kind);
		try {
			const response = await fetch("/api/activity-attachments", {
				method: "POST",
				headers: {
					"Content-Type": "application/octet-stream",
					"x-file-name": encodeURIComponent(file.name),
					...(activityId ? { "x-activity-id": activityId } : {}),
				},
				body: file,
			});
			const data = (await response.json()) as AttachmentItem & { error?: string };
			if (!response.ok) throw new Error(data.error || "上传失败");
			commitAttachments((current) =>
				current.some((row) => row.id === data.id) ? current : [...current, data],
			);
			if (data.kind === "IMAGE")
				editor?.chain().focus().setImage({ src: data.url, alt: data.name }).run();
		} catch (uploadError) {
			setError((uploadError as Error).message);
		} finally {
			setUploading(null);
		}
	}

	function removeImageNodes(url: string) {
		const positions: { from: number; to: number }[] = [];
		editor?.state.doc.descendants((node, position) => {
			if (node.type.name === "image" && node.attrs.src === url)
				positions.push({ from: position, to: position + node.nodeSize });
		});
		for (const position of positions.reverse())
			editor?.chain().deleteRange(position).run();
	}

	async function removeAttachment(item: AttachmentItem) {
		setError("");
		try {
			const response = await fetch(`/api/activity-attachments/${item.id}`, { method: "DELETE" });
			if (!response.ok) {
				const data = (await response.json()) as { error?: string };
				throw new Error(data.error || "删除失败");
			}
			commitAttachments((current) => current.filter((row) => row.id !== item.id));
			if (item.kind === "IMAGE") removeImageNodes(item.url);
		} catch (removeError) {
			setError((removeError as Error).message);
		}
	}

	if (!editor) {
		return <div className="min-h-40 rounded-md border bg-muted/30" aria-hidden />;
	}

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<input type="hidden" name={name} value={markdown} />
			{attachments.map((item) => (
				<input key={item.id} type="hidden" name="attachmentIds" value={item.id} />
			))}
			<div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 p-1">
				<ToolbarButton label="撤销" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
					<Undo2 />
				</ToolbarButton>
				<ToolbarButton label="重做" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
					<Redo2 />
				</ToolbarButton>
				<span className="mx-1 h-5 w-px bg-border" />
				<ToolbarButton label="二级标题" active={editor.isActive("heading", { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
					<Heading2 />
				</ToolbarButton>
				<ToolbarButton label="加粗" active={editor.isActive("bold")} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
					<Bold />
				</ToolbarButton>
				<ToolbarButton label="斜体" active={editor.isActive("italic")} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
					<Italic />
				</ToolbarButton>
				<ToolbarButton label="删除线" active={editor.isActive("strike")} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}>
					<Strikethrough />
				</ToolbarButton>
				<span className="mx-1 h-5 w-px bg-border" />
				<ToolbarButton label="无序列表" active={editor.isActive("bulletList")} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
					<List />
				</ToolbarButton>
				<ToolbarButton label="有序列表" active={editor.isActive("orderedList")} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
					<ListOrdered />
				</ToolbarButton>
				<ToolbarButton label="任务列表" active={editor.isActive("taskList")} disabled={disabled} onClick={() => editor.chain().focus().toggleTaskList().run()}>
					<ListChecks />
				</ToolbarButton>
				<ToolbarButton label="引用" active={editor.isActive("blockquote")} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
					<Quote />
				</ToolbarButton>
				<ToolbarButton label="代码块" active={editor.isActive("codeBlock")} disabled={disabled} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
					<Code2 />
				</ToolbarButton>
				<span className="mx-1 h-5 w-px bg-border" />
				<ToolbarButton
					label="插入链接"
					active={editor.isActive("link")}
					disabled={disabled}
					onClick={() => {
						const previous = editor.getAttributes("link").href as string | undefined;
						const href = window.prompt("链接地址（http/https）", previous ?? "https://");
						if (href === null) return;
						if (!href.trim()) {
							editor.chain().focus().extendMarkRange("link").unsetLink().run();
							return;
						}
						editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
					}}
				>
					<Link2 />
				</ToolbarButton>
				<ToolbarButton label="插入表格" disabled={disabled} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
					<Table2 />
				</ToolbarButton>
				<ToolbarButton label="插入图片" disabled={disabled || uploading !== null} onClick={() => imageInput.current?.click()}>
					<ImagePlus />
				</ToolbarButton>
				<ToolbarButton label="上传附件" disabled={disabled || uploading !== null} onClick={() => fileInput.current?.click()}>
					<Paperclip />
				</ToolbarButton>
				<ToolbarButton label="分割线" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
					<Minus />
				</ToolbarButton>
			</div>
			<input
				ref={imageInput}
				type="file"
				accept={imageAccept}
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void upload(file, "image");
					event.target.value = "";
				}}
			/>
			<input
				ref={fileInput}
				type="file"
				accept={fileAccept}
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void upload(file, "file");
					event.target.value = "";
				}}
			/>
			<div className="min-h-48 rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring/40">
				<EditorContent editor={editor} />
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				<span>支持 Markdown：标题、列表、表格、代码块、链接、图片</span>
				<span>可拖拽或粘贴上传，最多 {limits.maxFiles} 个附件，单个不超过 {limits.maxSizeMb}MB</span>
				<span>允许：{limits.allowed.join("、")}</span>
			</div>
			{uploading && <p className="text-xs text-muted-foreground">{uploading === "image" ? "图片上传中…" : "附件上传中…"}</p>}
			{error && <p className="text-xs text-destructive">{error}</p>}
			{attachments.length > 0 && (
				<ul className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
					{attachments.map((item) => (
						<li key={item.id} className="flex min-w-0 items-center gap-2 text-sm">
							<Paperclip className="size-4 shrink-0 text-muted-foreground" />
							<a className="min-w-0 flex-1 truncate hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">
								{item.name}
							</a>
							<span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.size)}</span>
							<Button type="button" variant="ghost" size="icon-sm" aria-label={`删除附件 ${item.name}`} onClick={() => void removeAttachment(item)}>
								<X />
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
