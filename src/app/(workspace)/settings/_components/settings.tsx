"use client";
// Complete invoice.tsx/form/preview adapted for editable brand settings and real preview.
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Command, Upload } from "lucide-react";
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
	type ThemeMode,
	type ThemePreset,
} from "@/lib/preferences/theme";
import {
	authGlassStyle,
	authGlowToneOptions,
	type AuthGlowTone,
} from "@/lib/auth-glass";
type SettingsData = {
	siteName: string;
	siteDescription: string;
	pageTitle: string;
	themePreset: ThemePreset;
	defaultThemeMode: ThemeMode;
	loginBackgroundAssetId: string | null;
	loginNotice: string;
	loginCardBlur: number;
	loginCardOpacity: number;
	loginCardSaturation: number;
	loginCardGlow: number;
	loginCardGlowTone: AuthGlowTone;
	loginFailureLimitEnabled: boolean;
	loginFailureMaxAttempts: number;
	loginFailureLockMinutes: number;
	activityAttachmentMaxFiles: number;
	activityAttachmentMaxSizeMb: number;
	activityAttachmentAllowedExtensions: string[];
	logoAssetId: string | null;
	logoSize: number;
	faviconAssetId: string | null;
	revision: number;
	updatedAt: string | null;
};
const glassSliders = [
	{
		key: "loginCardBlur",
		label: "高斯模糊",
		id: "settings-login-card-blur",
		min: 0,
		max: 40,
		unit: "px",
		low: "0 清晰",
		high: "40 最强",
		description:
			"模糊透过卡片的背景细节，数值越高毛玻璃越明显；0 仍保留半透明玻璃。默认 24。",
	},
	{
		key: "loginCardOpacity",
		label: "不透明度",
		id: "settings-login-card-opacity",
		min: 20,
		max: 95,
		unit: "%",
		low: "20 通透",
		high: "95 厚实",
		description:
			"卡片底色浓度，越低越能透出背景。背景图较花时建议调高，保证文字清晰。默认 80。",
	},
	{
		key: "loginCardSaturation",
		label: "饱和度",
		id: "settings-login-card-saturation",
		min: 100,
		max: 200,
		unit: "%",
		low: "100 自然",
		high: "200 浓郁",
		description:
			"提升透过玻璃的背景色彩浓度，140–160 更接近高级玻璃质感。默认 145。",
	},
	{
		key: "loginCardGlow",
		label: "光晕强度",
		id: "settings-login-card-glow",
		min: 0,
		max: 100,
		unit: "",
		low: "0 内敛",
		high: "100 明亮",
		description:
			"控制卡片外发光与渐变描边的强度；0 时保留细描边但关闭外发光。默认 65。",
	},
] as const;
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
	const [extensionsText, setExtensionsText] = useState(
		value.activityAttachmentAllowedExtensions.join(", "),
	);
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
		key: "logoAssetId" | "faviconAssetId" | "loginBackgroundAssetId",
	) {
		if (!file || uploading) return;
		const background = key === "loginBackgroundAssetId";
		setUploading(key);
		setError("");
		try {
			if (file.size > (background ? 5 * 1048576 : 1048576))
				throw new Error(
					background ? "登录页背景不能超过5MB。" : "标识图片不能超过1MiB。",
				);
			const response = await fetch("/api/admin/brand-assets", {
				method: "POST",
				headers: {
					"x-file-name": encodeURIComponent(file.name),
					...(background ? { "x-asset-kind": "login-background" } : {}),
				},
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
				if (!Number.isInteger(draft.logoSize) || draft.logoSize < 16)
					issues.logoSize = "Logo 显示尺寸需填写不小于16的整数。";
				if (draft.loginNotice.length > 200)
					issues.loginNotice = "登录公告最多200个字符。";
				for (const [key, label, min, max] of [
					["loginCardBlur", "登录卡片模糊", 0, 40],
					["loginCardOpacity", "登录卡片不透明度", 20, 95],
					["loginCardSaturation", "登录卡片饱和度", 100, 200],
					["loginCardGlow", "登录卡片光晕强度", 0, 100],
				] as const) {
					if (
						!Number.isInteger(draft[key]) ||
						draft[key] < min ||
						draft[key] > max
					)
						issues[key] = `${label}需填写${min}至${max}的整数。`;
				}
				if (
					!authGlowToneOptions.some(
						(option) => option.value === draft.loginCardGlowTone,
					)
				)
					issues.loginCardGlowTone = "请选择有效的光晕色调。";
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
				const extensions = [
					...new Set(
						extensionsText
							.split(/[,，\s]+/)
							.map((item) => item.trim().toLowerCase().replace(/^\./, ""))
							.filter(Boolean),
					),
				];
				if (
					!extensions.length ||
					extensions.length > 20 ||
					extensions.some((item) => !/^[a-z0-9]{1,10}$/.test(item))
				)
					issues.extensions =
						"请填写1至20个后缀，小写字母或数字，不带点，用逗号分隔。";
				for (const [key, label, max] of [
					["activityAttachmentMaxFiles", "附件数量上限", 20],
					["activityAttachmentMaxSizeMb", "单个附件大小上限", 50],
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
							: ["extensions", "activityAttachmentMaxFiles", "activityAttachmentMaxSizeMb"].includes(first)
								? "activity"
								: first === "logoSize"
								? "assets"
								: first === "loginNotice" || first.startsWith("loginCard")
								? "login"
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
										activityAttachmentMaxFiles: "settings-attachment-files",
										activityAttachmentMaxSizeMb: "settings-attachment-size",
										extensions: "settings-attachment-extensions",
										logoSize: "settings-logo-size",
										loginNotice: "settings-login-notice",
										loginCardBlur: "settings-login-card-blur",
										loginCardOpacity: "settings-login-card-opacity",
										loginCardSaturation: "settings-login-card-saturation",
										loginCardGlow: "settings-login-card-glow",
										loginCardGlowTone: "settings-login-card-glow-tone",
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
							defaultThemeMode: draft.defaultThemeMode,
							loginBackgroundAssetId: draft.loginBackgroundAssetId,
							loginNotice: draft.loginNotice.trim(),
							loginCardBlur: draft.loginCardBlur,
							loginCardOpacity: draft.loginCardOpacity,
							loginCardSaturation: draft.loginCardSaturation,
							loginCardGlow: draft.loginCardGlow,
							loginCardGlowTone: draft.loginCardGlowTone,
							loginFailureLimitEnabled: draft.loginFailureLimitEnabled,
							loginFailureMaxAttempts: draft.loginFailureMaxAttempts,
							loginFailureLockMinutes: draft.loginFailureLockMinutes,
							activityAttachmentMaxFiles: draft.activityAttachmentMaxFiles,
							activityAttachmentMaxSizeMb: draft.activityAttachmentMaxSizeMb,
							activityAttachmentAllowedExtensions: extensions,
							logoAssetId: draft.logoAssetId,
							logoSize: draft.logoSize,
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
					tab === "login" ? (
						<div className="flex flex-col rounded-xl border bg-card">
							<div className="flex items-center justify-between px-4 py-4">
								<h2 className="font-medium text-lg">登录页预览</h2>
								<Badge variant="outline">按当前草稿</Badge>
							</div>
							<div
								className="relative flex min-h-80 items-center justify-center overflow-hidden rounded-b-xl bg-muted p-6"
								data-theme-preset={draft.themePreset}
							>
								{draft.loginBackgroundAssetId ? (
									<>
										<Image
											src={`/api/brand-assets/${draft.loginBackgroundAssetId}`}
											alt=""
											fill
											unoptimized
											sizes="(min-width: 1280px) 40vw, 100vw"
											className="object-cover"
										/>
										<div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/30 to-black/65" />
									</>
								) : (
									<div className="auth-default-background absolute inset-0" />
								)}
								<div
									className="auth-glass-scope relative w-full max-w-64"
									data-auth-glow-tone={draft.loginCardGlowTone}
									style={authGlassStyle(draft)}
								>
									<div aria-hidden className="auth-glass-aurora" />
									<div className="auth-glass-card relative z-10 w-full rounded-xl p-4 text-left">
										<div className="flex min-w-0 items-center gap-2">
											{draft.logoAssetId ? (
												// eslint-disable-next-line @next/next/no-img-element
												<img
													src={`/api/brand-assets/${draft.logoAssetId}`}
													alt={draft.siteName}
													style={{ height: 28, width: "auto" }}
													className="max-w-[70%] shrink-0 object-contain"
												/>
											) : (
												<>
													<Command className="size-5 shrink-0 text-primary" />
													<span className="truncate text-sm font-semibold">
														{draft.siteName}
													</span>
												</>
											)}
										</div>
										<p className="mt-4 text-lg font-semibold">欢迎登录</p>
										<p className="mt-1 text-xs text-muted-foreground">
											输入账号和密码进入工作台
										</p>
										{draft.loginNotice && (
											<p className="mt-3 max-h-20 overflow-hidden whitespace-pre-wrap rounded-md border bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed">
												{draft.loginNotice}
											</p>
										)}
										<div aria-hidden className="mt-4 grid gap-2">
											<div className="h-7 rounded-md border bg-background/70" />
											<div className="h-7 rounded-md border bg-background/70" />
											<div className="h-7 rounded-md bg-primary" />
										</div>
									</div>
								</div>
							</div>
							<p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
								背景与公告公开显示；保存后登录页与首次改密页同步生效。
							</p>
						</div>
					) : (
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
									// eslint-disable-next-line @next/next/no-img-element
									<img
										src={`/api/brand-assets/${draft.logoAssetId}`}
										alt="站点标识"
										style={{ height: draft.logoSize, width: "auto" }}
										className="max-h-56 max-w-full object-contain"
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
					)
				}
			>
				<Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
					<TabsList className="h-auto w-full flex-wrap">
						<TabsTrigger value="brand">品牌与标题</TabsTrigger>
						<TabsTrigger value="assets">标识与主题</TabsTrigger>
						<TabsTrigger value="login">登录页</TabsTrigger>
						<TabsTrigger value="security">登录安全</TabsTrigger>
						<TabsTrigger value="activity">活动附件</TabsTrigger>
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
										className="sr-only"
										disabled={!!uploading || busy}
										onChange={(e) => {
											const file = e.target.files?.[0];
											e.target.value = "";
											void upload(
												file,
												key as "logoAssetId" | "faviconAssetId",
											);
										}}
									/>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={!!uploading || busy}
											onClick={() =>
												document.getElementById(`settings-${key}`)?.click()
											}
										>
											<Upload data-icon="inline-start" />
											{uploading === key
												? "正在上传…"
												: draft[key as "logoAssetId"]
													? `更换${label}图片`
													: `选择${label}图片`}
										</Button>
										{draft[key as "logoAssetId"] && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={busy}
												onClick={() => change(key as "logoAssetId", null)}
											>
												恢复默认{label}
											</Button>
										)}
									</div>
									<FieldDescription>
										PNG、JPEG或ICO，最大1MiB。上传后需保存设置。
									</FieldDescription>
								</Field>
							))}
							<Field data-invalid={!!invalid.logoSize}>
								<FieldLabel htmlFor="settings-logo-size">
									站点 Logo 显示尺寸（像素）
								</FieldLabel>
								<Input
									id="settings-logo-size"
									type="number"
									inputMode="numeric"
									min={16}
									step={1}
									value={Number.isNaN(draft.logoSize) ? "" : draft.logoSize}
									disabled={busy}
									aria-invalid={!!invalid.logoSize}
									onChange={(e) =>
										change(
											"logoSize",
											e.target.value === ""
												? Number.NaN
												: Number(e.target.value),
										)
									}
								/>
								{invalid.logoSize && <FieldError>{invalid.logoSize}</FieldError>}
								<FieldDescription>
									表示 Logo 的显示高度，宽度按原图比例自动计算，不设上限；过宽时会缩放到容器宽度，侧栏折叠时自动缩小。建议上传前裁掉图片四周的空白。
								</FieldDescription>
							</Field>
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
							<Field>
								<FieldLabel htmlFor="settings-default-theme-mode">
									默认深浅模式
								</FieldLabel>
								<NativeSelect
									id="settings-default-theme-mode"
									value={draft.defaultThemeMode}
									disabled={busy}
									onChange={(e) =>
										change("defaultThemeMode", e.target.value as ThemeMode)
									}
								>
									<NativeSelectOption value="light">浅色</NativeSelectOption>
									<NativeSelectOption value="dark">深色</NativeSelectOption>
									<NativeSelectOption value="system">
										跟随系统
									</NativeSelectOption>
								</NativeSelect>
								<FieldDescription>
									未单独选择外观的访客和用户使用该默认值；用户仍可在登录页或顶栏自行切换，个人选择只保存在各自浏览器。
								</FieldDescription>
							</Field>
						</FieldGroup>
					</TabsContent>
					<TabsContent className="mt-4" value="login">
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="settings-login-background">
									登录页背景图
								</FieldLabel>
								<div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted">
									{draft.loginBackgroundAssetId ? (
										<Image
											src={`/api/brand-assets/${draft.loginBackgroundAssetId}`}
											alt="登录页背景当前图片"
											fill
											unoptimized
											sizes="(min-width: 1280px) 40vw, 100vw"
											className="object-cover"
										/>
									) : (
										<div className="auth-default-background absolute inset-0 flex items-center justify-center p-4">
											<span className="rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground">
												未上传背景，使用主题渐变
											</span>
										</div>
									)}
								</div>
								<Input
									id="settings-login-background"
									type="file"
									accept="image/png,image/jpeg,image/webp"
									className="sr-only"
									disabled={!!uploading || busy}
									onChange={(e) => {
										const file = e.target.files?.[0];
										e.target.value = "";
										void upload(file, "loginBackgroundAssetId");
									}}
								/>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={!!uploading || busy}
										onClick={() =>
											document
												.getElementById("settings-login-background")
												?.click()
										}
									>
										<Upload data-icon="inline-start" />
										{uploading === "loginBackgroundAssetId"
											? "正在上传…"
											: draft.loginBackgroundAssetId
												? "更换背景图"
												: "选择背景图"}
									</Button>
									{draft.loginBackgroundAssetId && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={() => change("loginBackgroundAssetId", null)}
										>
											移除背景图
										</Button>
									)}
								</div>
								<FieldDescription>
									支持 PNG、JPEG、WebP，最大 5MB；建议横版 1920×1080 以上。上传后需保存设置。
								</FieldDescription>
								<FieldDescription>
									背景图公开可见，请勿上传含学生姓名、成绩或证件信息的图片。移除后登录页恢复主题渐变背景。
								</FieldDescription>
							</Field>
							<Separator />
							<Field>
								<FieldLabel>玻璃卡片效果</FieldLabel>
								<FieldDescription>
									登录卡片使用随主题变化的高级玻璃与渐变光晕，以下参数同步应用到登录页和首次改密页。
								</FieldDescription>
							</Field>
							{glassSliders.map((item) => (
								<Field key={item.key} data-invalid={!!invalid[item.key]}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<FieldLabel htmlFor={item.id}>{item.label}</FieldLabel>
										<span className="text-muted-foreground text-sm tabular-nums">
											{draft[item.key]}
											{item.unit ? ` ${item.unit}` : ""}
										</span>
									</div>
									<input
										id={item.id}
										type="range"
										min={item.min}
										max={item.max}
										step={1}
										value={draft[item.key]}
										disabled={busy}
										onChange={(e) =>
											change(item.key, Number(e.target.value))
										}
										className="w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
										aria-invalid={!!invalid[item.key]}
									/>
									<div className="text-muted-foreground flex justify-between text-[11px]">
										<span>{item.low}</span>
										<span>{item.high}</span>
									</div>
									{invalid[item.key] && (
										<FieldError>{invalid[item.key]}</FieldError>
									)}
									<FieldDescription>{item.description}</FieldDescription>
								</Field>
							))}
							<Field data-invalid={!!invalid.loginCardGlowTone}>
								<FieldLabel htmlFor="settings-login-card-glow-tone">
									光晕色调
								</FieldLabel>
								<NativeSelect
									id="settings-login-card-glow-tone"
									value={draft.loginCardGlowTone}
									disabled={busy}
									aria-invalid={!!invalid.loginCardGlowTone}
									onChange={(e) =>
										change(
											"loginCardGlowTone",
											e.target.value as AuthGlowTone,
										)
									}
								>
									{authGlowToneOptions.map((option) => (
										<NativeSelectOption
											key={option.value}
											value={option.value}
										>
											{option.label} · {option.description}
										</NativeSelectOption>
									))}
								</NativeSelect>
								{invalid.loginCardGlowTone && (
									<FieldError>{invalid.loginCardGlowTone}</FieldError>
								)}
								<FieldDescription>
									主题色跟随所选界面主题与深浅模式；固定色调适合搭配背景图使用。
								</FieldDescription>
							</Field>
							<Separator />
							<Field data-invalid={!!invalid.loginNotice}>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<FieldLabel htmlFor="settings-login-notice">登录公告</FieldLabel>
									<span className="text-muted-foreground text-xs">
										{draft.loginNotice.length} / 200
									</span>
								</div>
								<Textarea
									id="settings-login-notice"
									disabled={busy}
									value={draft.loginNotice}
									onChange={(e) => change("loginNotice", e.target.value)}
									rows={3}
									maxLength={200}
									aria-invalid={!!invalid.loginNotice}
									placeholder="例如：本学期综合测评已开放，请在截止前完成确认。"
								/>
								{invalid.loginNotice && (
									<FieldError>{invalid.loginNotice}</FieldError>
								)}
								<FieldDescription>
									显示在登录卡片顶部，留空则不显示；仅支持纯文本，公告对所有访客可见，请勿填写学生个人信息。
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
					<TabsContent className="mt-4" value="activity">
						<FieldGroup>
							{(
								[
									["activityAttachmentMaxFiles", "每个活动最多附件数", "settings-attachment-files", 20],
									["activityAttachmentMaxSizeMb", "单个附件大小上限（MB）", "settings-attachment-size", 50],
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
												e.target.value === "" ? Number.NaN : Number(e.target.value),
											)
										}
									/>
									{invalid[key] && <FieldError>{invalid[key]}</FieldError>}
									<FieldDescription>可设置1至{max}的整数。</FieldDescription>
								</Field>
							))}
							<Field data-invalid={!!invalid.extensions}>
								<FieldLabel htmlFor="settings-attachment-extensions">
									允许上传的文件后缀
								</FieldLabel>
								<Input
									id="settings-attachment-extensions"
									value={extensionsText}
									disabled={busy}
									aria-invalid={!!invalid.extensions}
									onChange={(e) => {
										setExtensionsText(e.target.value);
										setDirty(true);
										setInvalid((current) => ({ ...current, extensions: "" }));
									}}
								/>
								{invalid.extensions && <FieldError>{invalid.extensions}</FieldError>}
								<FieldDescription>
									小写、不带点，用逗号分隔。默认：png, jpg, jpeg, webp, gif, pdf, doc, docx, xls, xlsx, ppt, pptx, zip, txt, md。
								</FieldDescription>
							</Field>
						</FieldGroup>
					</TabsContent>
				</Tabs>
			</TemplateEditor>
		</form>
	);
}
