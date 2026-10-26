"use client";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
export function Feedback({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <Alert variant={error ? "destructive" : "default"} role={error ? "alert" : "status"}>
      <AlertTitle>{error ? "操作未完成" : "已完成"}</AlertTitle>
      <AlertDescription>{error || success}</AlertDescription>
    </Alert>
  );
}
export async function requestJson<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const result = (await response.json()) as { error?: string; code?: string };
  if (!response.ok) {
    if (response.status === 401 && result.code === "SESSION_REQUIRED") window.location.assign(new URL("/login", window.location.origin));
    throw new Error(
      (result.error || "请求失败，请重试") +
        (response.status === 409 ? "。输入已保留，请先核对最新记录后再提交。" : ""),
    );
  }
  return result as T;
}
