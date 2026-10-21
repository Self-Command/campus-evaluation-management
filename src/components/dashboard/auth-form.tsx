"use client";
import { useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupInput,
	InputGroupAddon,
	InputGroupButton,
} from "@/components/ui/input-group";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import { Feedback, requestJson } from "./feedback";
export function AuthForm({
	change = false,
	embedded = false,
}: {
	change?: boolean;
	embedded?: boolean;
}) {
	const router = useRouter();
	const [visible, setVisible] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	return (
		<form
			className="flex flex-col gap-6"
			onSubmit={async (e) => {
				e.preventDefault();
				if (busy) return;
				const data = new FormData(e.currentTarget);
				setBusy(true);
				setError("");
				try {
					if (change) {
						if (data.get("newPassword") !== data.get("confirmPassword"))
							throw new Error("两次新密码不一致");
						await requestJson("/api/password", {
							oldPassword: data.get("password"),
							newPassword: data.get("newPassword"),
						});
						await signOut({ callbackUrl: "/login?changed=1" });
					} else {
						const result = await signIn("credentials", {
							login: data.get("login"),
							password: data.get("password"),
							redirect: false,
						});
						if (!result?.ok)
							throw new Error("账号或密码不正确，或账号暂时无法登录");
						router.replace("/");
						router.refresh();
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : "请求失败，请重试");
					setBusy(false);
				}
			}}
		>
			<Feedback error={error} />
			<FieldGroup>
				{!change && (
					<Field>
						<FieldLabel htmlFor="login">学号或账号</FieldLabel>
						<Input
							id="login"
							name="login"
							autoComplete="username"
							required
							maxLength={64}
							autoFocus
						/>
					</Field>
				)}
				<Field>
					<FieldLabel htmlFor="password">
						{change ? "当前密码" : "密码"}
					</FieldLabel>
					<InputGroup>
						<InputGroupInput
							id="password"
							name="password"
							type={visible ? "text" : "password"}
							autoComplete="current-password"
							required
							maxLength={128}
						/>
						<InputGroupAddon align="inline-end">
							<InputGroupButton
								type="button"
								aria-label={visible ? "隐藏密码" : "显示密码"}
								onClick={() => setVisible(!visible)}
							>
								{visible ? <EyeOff /> : <Eye />}
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
				</Field>
				{change && (
					<>
						<Field>
							<FieldLabel htmlFor="newPassword">新密码</FieldLabel>
							<Input
								id="newPassword"
								name="newPassword"
								type="password"
								autoComplete="new-password"
								required
								minLength={12}
								maxLength={72}
								pattern="(?=.*[A-Za-z])(?=.*[0-9]).{12,72}"
								aria-describedby="password-help"
							/>
							<FieldDescription id="password-help">
								12～72个字符，同时包含字母和数字；不能与当前密码相同。
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="confirmPassword">确认新密码</FieldLabel>
							<Input
								id="confirmPassword"
								name="confirmPassword"
								type="password"
								autoComplete="new-password"
								required
								minLength={12}
								maxLength={72}
							/>
						</Field>
					</>
				)}
			</FieldGroup>
			<Button disabled={busy} type="submit" className="w-full">
				{busy ? "正在提交…" : change ? "保存新密码并重新登录" : "登录"}
			</Button>
			{change && !embedded && (
				<Button
					type="button"
					variant="outline"
					onClick={() => void signOut({ callbackUrl: "/login" })}
				>
					退出登录
				</Button>
			)}
		</form>
	);
}
