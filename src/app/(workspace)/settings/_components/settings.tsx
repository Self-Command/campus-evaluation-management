"use client";
// Complete invoice.tsx/form/preview adapted for editable brand settings and real preview.
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Command } from "lucide-react";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
	FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	THEME_PRESET_OPTIONS,
	type ThemePreset,
} from "@/lib/preferences/theme";
type SettingsData = {
	siteName: string;
	siteDescription: string;
	pageTitle: string;
	themePreset: ThemePreset;
	loginFailureLimitEnabled: boolean;
	loginFailureMaxAttempts: number;
	loginFailureLockMinutes: number;
	logoAssetId: string | null;
	faviconAssetId: string | null;
	revision: number;
	updatedAt: string | null;
};
export function Settings() {
	const remote = useRemote<SettingsData>("/api/admin/settings");
	return (
		<>
			<RemoteState {...remote} />
			{remote.data && <SettingsForm value={remote.data} />}
		</>
	);
}
function SettingsForm({ value }: { value: SettingsData }) {
	const router = useRouter();
	const [draft, setDraft] = useState(value);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [uploading, setUploading] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [reason, setReason] = useState("");
	const [tab, setTab] = useState("brand");
	const [invalid, setInvalid] = useState<Record<string, string>>({});
	useUnsavedChanges(dirty || busy || !!uploading);
	function change(
		key: keyof SettingsData,
		next: string | null | boolean | number,
	) {
		setDraft((current) => ({ ...current, [key]: next }));
		setDirty(true);
		setSuccess("");
		setInvalid((current) => ({ ...current, [key]: "" }));
	}
	async function upload(
		file: File | undefined,
		key: "logoAssetId" | "faviconAssetId",
	) {
		if (!file || uploading) return;
		setUploading(key);
		setError("");
		try {
			if (file.size > 1048576) throw new Error("标识图片不能超过1MiB。");
			const response = await fetch("/api/admin/brand-assets", {
				method: "POST",
				headers: { "x-file-name": encodeURIComponent(file.name) },
				body: file,
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || "图片上传失败");
			change(key, result.id);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setUploading(null);
		}
	}
	return (
		<form
			className="flex flex-col gap-5"
			noValidate
			onSubmit={async (e) => {
				e.preventDefault();
				if (busy || uploading) return;
				setError("");
				setSuccess("");
				const issues: Record<string, string> = {};
				for (const [key, label, max] of [
					["siteName", "站点名称", 40],
					["siteDescription", "站点说明", 160],
					["pageTitle", "页面标题", 80],
				] as const) {
					if (!draft[key].trim() || draft[key].trim().length > max)
						issues[key] = `${label}需填写1至${max}个字符。`;
				}
				for (const [key, label, max] of [
					["loginFailureMaxAttempts", "连续失败次数", 100],
					["loginFailureLockMinutes", "临时锁定分钟数", 1440],
				] as const) {
					if (
						!Number.isInteger(draft[key]) ||
						draft[key] < 1 ||
						draft[key] > max
					)
						issues[key] = `${label}需填写1至${max}的整数。`;
				}
				if (reason.trim().length < 2 || reason.trim().length > 500)
					issues.reason = "请填写2至500个字符的修改理由。";
				setInvalid(issues);
				if (Object.keys(issues).length) {
					const first = Object.keys(issues)[0];
					setTab(
						first.startsWith("loginFailure")
							? "security"
							: first === "reason"
								? tab
								: "brand",
					);
					setError(issues[first]);
					requestAnimationFrame(() =>
						document
							.getElementById(
								(
									{
										siteName: "settings-name",
										siteDescription: "settings-description",
										pageTitle: "settings-title",
										reason: "settings-reason",
										loginFailureMaxAttempts: "settings-login-attempts",
										loginFailureLockMinutes: "settings-login-lock",
									} as Record<string, string>
								)[first],
							)
							?.focus(),
					);
					return;
				}
				setBusy(true);
				try {
					const saved = await requestJson<SettingsData>(
						"/api/admin/settings",
						{
							revision: draft.revision,
							siteName: draft.siteName,
							siteDescription: draft.siteDescription,
							pageTitle: draft.pageTitle,
							themePreset: draft.themePreset,
							loginFailureLimitEnabled: draft.loginFailureLimitEnabled,
							loginFailureMaxAttempts: draft.loginFailureMaxAttempts,
							loginFailureLockMinutes: draft.loginFailureLockMinutes,
							logoAssetId: draft.logoAssetId,
							faviconAssetId: draft.faviconAssetId,
							reason,
						},
						"PUT",
					);
					setDirty(false);
					setDraft(saved);
					setSuccess("设置已保存并生效。");
					router.refresh();
				} catch (err) {
					setError((err as Error).message);
				} finally {
					setBusy(false);
				}
			}}
		>
			<Feedback error={error} success={success} />
			<div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-4">
				<Field className="min-w-56 flex-1" data-invalid={!!invalid.reason}>
					<FieldLabel htmlFor="settings-reason">修改理由</FieldLabel>
					<Input
						id="settings-reason"
						disabled={busy}
						name="reason"
						value={reason}
						onChange={(e) => {
							setReason(e.target.value);
							setInvalid((current) => ({ ...current, reason: "" }));
						}}
						placeholder="2至500个字符，用于记录本次修改"
						required
						minLength={2}
						maxLength={500}
						aria-invalid={!!invalid.reason}
					/>
					{invalid.reason && <FieldError>{invalid.reason}</FieldError>}
				</Field>
				<Badge variant="outline">
					当前版本 {draft.revision}
					{dirty ? " · 有未保存修改" : ""}
				</Badge>
				<Button type="submit" disabled={busy || !!uploading}>
					{busy ? "正在保存…" : "保存并生效"}
				</Button>
			</div>
			<TemplateEditor
				preview={
					<div className="flex flex-col rounded-xl border bg-card">
						<div className="flex items-center justify-between px-4 py-4">
							<h2 className="font-medium text-lg">品牌效果</h2>
							<Badge variant="outline">
								{THEME_PRESET_OPTIONS.find(
									(option) => option.value === draft.themePreset,
								)?.label ?? "默认主题"}
							</Badge>
						</div>
						<div
							className="flex min-h-80 flex-col items-center justify-center gap-5 rounded-b-xl bg-muted p-6 text-center"
							data-theme-preset={draft.themePreset}
						>
							{draft.logoAssetId ? (
								<Image
									src={`/api/brand-assets/${draft.logoAssetId}`}
									alt="站点标识"
									width={80}
									height={80}
									unoptimized
									className="size-20 object-contain"
								/>
							) : (
								<Command className="size-12 text-primary" />
							)}
							<h2 className="break-words text-3xl">{draft.siteName}</h2>
							<p className="break-words text-muted-foreground">
								{draft.siteDescription}
							</p>
							<Separator />
							<p className="break-words text-sm">页面标题：{draft.pageTitle}</p>
							{draft.faviconAssetId && (
								<div className="flex items-center gap-2">
									<Image
										src={`/api/brand-assets/${draft.faviconAssetId}`}
										alt="网站图标"
										width={20}
										height={20}
										unoptimized
									/>
									<span className="text-sm text-muted-foreground">
										网站图标
									</span>
								</div>
							)}
						</div>
					</div>
				}
			>
				<Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
					<TabsList className="h-auto w-full flex-wrap">
						<TabsTrigger value="brand">品牌与标题</TabsTrigger>
						<TabsTrigger value="assets">标识与主题</TabsTrigger>
						<TabsTrigger value="security">登录安全</TabsTrigger>
					</TabsList>
					<TabsContent className="mt-4" value="brand">
						<FieldGroup>
							<Field data-invalid={!!invalid.siteName}>
								<FieldLabel htmlFor="settings-name">站点名称</FieldLabel>
								<Input
									id="settings-name"
									disabled={busy}
									value={draft.siteName}
									onChange={(e) => change("siteName", e.target.value)}
									required
									maxLength={40}
									aria-invalid={!!invalid.siteName}
								/>
								{invalid.siteName && (
									<FieldError>{invalid.siteName}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!invalid.siteDescription}>
								<FieldLabel htmlFor="settings-description">站点说明</FieldLabel>
								<Textarea
									id="settings-description"
									disabled={busy}
									value={draft.siteDescription}
									onChange={(e) => change("siteDescription", e.target.value)}
									required
									maxLength={160}
									rows={3}
									aria-invalid={!!invalid.siteDescription}
								/>
								{invalid.siteDescription && (
									<FieldError>{invalid.siteDescription}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!invalid.pageTitle}>
								<FieldLabel htmlFor="settings-title">页面标题</FieldLabel>
								<Input
									id="settings-title"
									disabled={busy}
									value={draft.pageTitle}
									onChange={(e) => change("pageTitle", e.target.value)}
									required
									maxLength={80}
									aria-invalid={!!invalid.pageTitle}
								/>
								{invalid.pageTitle && (
									<FieldError>{invalid.pageTitle}</FieldError>
								)}
							</Field>
						</FieldGroup>
					</TabsContent>
					<TabsContent className="mt-4" value="assets">
						<FieldGroup>
							{[
								["logoAssetId", "站点 Logo"],
								["faviconAssetId", "网站图标"],
							].map(([key, label]) => (
								<Field key={key}>
									<FieldLabel htmlFor={`settings-${key}`}>{label}</FieldLabel>
									<Input
										id={`settings-${key}`}
										type="file"
										accept="image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,.ico"
										disabled={!!uploading || busy}
										onChange={(e) =>
											void upload(e.target.files?.[0], key as "logoAssetId")
										}
									/>
									<FieldDescription>
										{uploading === key
											? "正在上传…"
											: "PNG、JPEG或ICO，最大1MiB。上传后需保存设置。"}
									</FieldDescription>
									{draft[key as "logoAssetId"] && (
										<Button
											type="button"
											variant="outline"
											className="self-start"
											disabled={busy}
											onClick={() => change(key as "logoAssetId", null)}
										>
											恢复默认{label}
										</Button>
									)}
								</Field>
							))}
							<Field>
								<FieldLabel>界面主题</FieldLabel>
								<div className="grid gap-2 sm:grid-cols-2">
									{THEME_PRESET_OPTIONS.map((option) => {
										const active = draft.themePreset === option.value;
										return (
											<button
												key={option.value}
												type="button"
												disabled={busy}
												aria-pressed={active}
												onClick={() => change("themePreset", option.value)}
												className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
													active
														? "border-primary bg-primary/5"
														: "hover:bg-muted/60"
												}`}
											>
												<span
													aria-hidden
													className="mt-0.5 size-8 shrink-0 rounded-md border"
													style={{
														background: `linear-gradient(135deg, ${option.primary.light} 0 58%, #e4e4e7 58% 100%)`,
													}}
												/>
												<span className="flex min-w-0 flex-col gap-0.5">
													<span className="text-sm font-medium">
														{option.label}
														{active ? "（当前）" : ""}
													</span>
													<span className="text-muted-foreground text-xs">
														{option.description}
													</span>
												</span>
											</button>
										);
									})}
								</div>
								<FieldDescription>
									主题会同时调整圆角、描边、阴影与主色，保存后全站生效；不影响已有成绩和结算记录。
								</FieldDescription>
							</Field>
						</FieldGroup>
					</TabsContent>
					<TabsContent className="mt-4" value="security">
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="settings-login-limit">
									登录失败限制
								</FieldLabel>
								<NativeSelect
									id="settings-login-limit"
									value={
										draft.loginFailureLimitEnabled ? "enabled" : "disabled"
									}
									disabled={busy}
									onChange={(e) =>
										change(
											"loginFailureLimitEnabled",
											e.target.value === "enabled",
										)
									}
								>
									<NativeSelectOption value="disabled">关闭</NativeSelectOption>
									<NativeSelectOption value="enabled">
										启用临时锁定
									</NativeSelectOption>
								</NativeSelect>
								<FieldDescription>
									启用后，连续登录失败达到指定次数的账号将在设定时间内暂停登录。
								</FieldDescription>
							</Field>
							{(
								[
									[
										"loginFailureMaxAttempts",
										"连续失败次数",
										"settings-login-attempts",
										100,
									],
									[
										"loginFailureLockMinutes",
										"临时锁定分钟数",
										"settings-login-lock",
										1440,
									],
								] as const
							).map(([key, label, id, max]) => (
								<Field key={key} data-invalid={!!invalid[key]}>
									<FieldLabel htmlFor={id}>{label}</FieldLabel>
									<Input
										id={id}
										type="number"
										inputMode="numeric"
										min={1}
										max={max}
										step={1}
										value={Number.isNaN(draft[key]) ? "" : draft[key]}
										disabled={busy}
										aria-invalid={!!invalid[key]}
										onChange={(e) =>
											change(
												key,
												e.target.value === ""
													? Number.NaN
													: Number(e.target.value),
											)
										}
									/>
									{invalid[key] && <FieldError>{invalid[key]}</FieldError>}
									<FieldDescription>
										可设置1至{max}的整数；关闭限制时保留此设置。
									</FieldDescription>
								</Field>
							))}
						</FieldGroup>
					</TabsContent>
				</Tabs>
			</TemplateEditor>
		</form>
	);
}
