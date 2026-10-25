"use client";
// Adapted directly from Studio Admin auth/_components/login-form.tsx (MIT).

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Feedback } from "@/components/dashboard/feedback";

const formSchema = z.object({
	login: z
		.string()
		.trim()
		.min(1, "请输入学号或账号")
		.max(64, "账号最多64个字符"),
	password: z.string().min(1, "请输入密码").max(128, "密码长度超出限制"),
	captcha: z
		.string()
		.trim()
		.regex(/^[A-Za-z]{5}$/, "请输入图片中的五位英文字母"),
});

type CaptchaChallenge = { id: string; image: string; expiresAt: string };async function readCaptcha(signal?: AbortSignal): Promise<CaptchaChallenge> {
	const response = await fetch("/api/auth/captcha", {
		cache: "no-store",
		signal,
	});
	const next = await response.json();
	if (
		!response.ok ||
		!next.id ||
		!String(next.image).startsWith("data:image/svg+xml;base64,")
	)
		throw new Error("验证码暂时无法读取，请刷新重试。");
	return next;
}

export function LoginForm() {
	const router = useRouter();
	const [error, setError] = useState("");
	const [challenge, setChallenge] = useState<{
		id: string;
		image: string;
		expiresAt: string;
	} | null>(null);
	const [captchaLoading, setCaptchaLoading] = useState(true);
	const [captchaError, setCaptchaError] = useState("");
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			login: "",
			password: "",
			captcha: "",
		},
	});
	const setValue = form.setValue;
	const refreshCaptcha = useCallback(
		async (signal?: AbortSignal) => {
			setCaptchaLoading(true);
			setCaptchaError("");
			setChallenge(null);
			setValue("captcha", "", { shouldDirty: false });
			try {
				const next = await readCaptcha(signal);
				if (!signal?.aborted) setChallenge(next);
			} catch (err) {
				if (!signal?.aborted)
					setCaptchaError(
						(err as Error).message || "验证码暂时无法读取，请刷新重试。",
					);
			} finally {
				if (!signal?.aborted) setCaptchaLoading(false);
			}
		},
		[setValue],
	);
	useEffect(() => {
		const controller = new AbortController();
		void readCaptcha(controller.signal)
			.then((next) => {
				if (!controller.signal.aborted) setChallenge(next);
			})
			.catch((err: Error) => {
				if (!controller.signal.aborted) setCaptchaError(err.message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setCaptchaLoading(false);
			});
		return () => controller.abort();
	}, []);
	const onSubmit = async (data: z.infer<typeof formSchema>) => {
		setError("");
		if (!challenge || captchaLoading) return;
		try {
			const result = await signIn("credentials", {
				...data,
				captchaId: challenge.id,
				redirect: false,
			});
			if (!result?.ok) {
				setError(
					result?.error === "CaptchaInvalid"
						? "验证码错误或已过期，请输入新验证码。"
						: result?.error === "LoginLocked"
							? "连续登录失败已达到限制，请稍后再试。"
							: result?.error === "CredentialsSignin"
								? "账号或密码不正确，请核对后重试。"
								: "暂时无法登录，请稍后重试。",
				);
				await refreshCaptcha();
				return;
			}
			router.replace("/");
			router.refresh();
		} catch {
			setError("暂时无法连接登录服务，请稍后重试。");
			await refreshCaptcha();
		}
	};

	return (
		<form
			noValidate
			onSubmit={form.handleSubmit(onSubmit)}
			className="flex flex-col gap-4"
		>
			<Feedback error={error} />
			<FieldGroup className="gap-4">
				<Controller
					control={form.control}
					name="login"
					render={({ field, fieldState }) => (
						<Field className="gap-1.5" data-invalid={fieldState.invalid}>
							<FieldLabel htmlFor="login-account">学号或账号</FieldLabel>
							<Input
								{...field}
								id="login-account"
								type="text"
								placeholder="请输入学号或账号"
								autoComplete="username"
								disabled={form.formState.isSubmitting}
								aria-invalid={fieldState.invalid}
							/>
							{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
						</Field>
					)}
				/>
				<Controller
					control={form.control}
					name="password"
					render={({ field, fieldState }) => (
						<Field className="gap-1.5" data-invalid={fieldState.invalid}>
							<FieldLabel htmlFor="login-password">密码</FieldLabel>
							<Input
								{...field}
								id="login-password"
								type="password"
								placeholder="••••••••"
								autoComplete="current-password"
								disabled={form.formState.isSubmitting}
								aria-invalid={fieldState.invalid}
							/>
							{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
						</Field>
					)}
				/>
				<Controller
					control={form.control}
					name="captcha"
					render={({ field, fieldState }) => (
						<Field className="gap-1.5" data-invalid={fieldState.invalid}>
							<FieldLabel htmlFor="login-captcha">图片验证码</FieldLabel>
							<Input
								{...field}
								id="login-captcha"
								autoComplete="off"
								autoCapitalize="characters"
								spellCheck={false}
								placeholder="请输入图片中的五位英文字母"
								disabled={
									form.formState.isSubmitting || captchaLoading || !challenge
								}
								aria-invalid={fieldState.invalid}
								aria-describedby="login-captcha-status"
							/>
							<div className="flex flex-wrap items-center gap-2">
								{challenge && (
									<Button
										type="button"
										variant="outline"
										className="h-auto p-1"
										aria-label="刷新图片验证码"
										disabled={captchaLoading || form.formState.isSubmitting}
										onClick={() => void refreshCaptcha()}
									>
										<Image
											src={challenge.image}
											width={180}
											height={55}
											alt="英文验证码，点击可更换"
											unoptimized
										/>
									</Button>
								)}
								<Button
									type="button"
									variant="outline"
									disabled={captchaLoading || form.formState.isSubmitting}
									onClick={() => void refreshCaptcha()}
								>
									{captchaLoading ? "正在读取验证码…" : "换一张"}
								</Button>
							</div>
							<p
								id="login-captcha-status"
								className="text-sm text-muted-foreground"
								role={captchaError ? "alert" : "status"}
							>
								{captchaError || "验证码不区分字母大小写。"}
							</p>
							{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
						</Field>
					)}
				/>
			</FieldGroup>
			<Button
				className="w-full"
				type="submit"
				disabled={form.formState.isSubmitting || captchaLoading || !challenge}
			>
				{form.formState.isSubmitting ? "正在登录…" : "登录"}
			</Button>
		</form>
	);
}
