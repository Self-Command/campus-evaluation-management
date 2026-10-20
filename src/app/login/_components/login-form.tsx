"use client";
// Adapted directly from Studio Admin auth/_components/login-form.tsx (MIT).

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Feedback } from "@/components/dashboard/feedback";

const formSchema = z.object({
  login: z.string().trim().min(1, "请输入学号或账号").max(64, "账号最多64个字符"),
  password: z.string().min(1, "请输入密码").max(128, "密码长度超出限制"),
});

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      login: "",
      password: "",
    },
  });
  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setError("");
    try {
      const result = await signIn("credentials", { ...data, redirect: false });
      if (!result?.ok) {
        setError("账号或密码不正确，或暂时无法登录。请核对后重试。");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("暂时无法连接登录服务，请稍后重试。");
    }
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
      </FieldGroup>
      <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "正在登录…" : "登录"}
      </Button>
    </form>
  );
}
