"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export type TermOption = { id: string; name: string; disposition: string; phase: string };

export type OrganizationTree = {
  colleges: { id: string; code: string; name: string; majors: { id: string; code: string; name: string; classes: { id: string; code: string; name: string }[] }[] }[];
};

export type ScopeValue = {
  scope: "ALL" | "COLLEGE" | "MAJOR" | "CLASS";
  college: string;
  major: string;
  className: string;
};

export const emptyScope = (): ScopeValue => ({ scope: "ALL", college: "", major: "", className: "" });

export function dateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

export function dateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function bytesText(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function scopeParams(scope: ScopeValue, params: URLSearchParams) {
  if (scope.scope === "ALL") return params;
  params.set("scope", scope.scope);
  if (scope.college) params.set("college", scope.college);
  if ((scope.scope === "MAJOR" || scope.scope === "CLASS") && scope.major) params.set("major", scope.major);
  if (scope.scope === "CLASS" && scope.className) params.set("className", scope.className);
  return params;
}

export function ScopeFields({
  value,
  onChange,
  orgs,
  disabled,
}: {
  value: ScopeValue;
  onChange: (next: ScopeValue) => void;
  orgs: OrganizationTree;
  disabled?: boolean;
}) {
  const college = orgs.colleges.find(row => row.name === value.college);
  const majors = college?.majors ?? [];
  const major = majors.find(row => row.name === value.major);
  const classes = major?.classes ?? [];
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        范围
        <NativeSelect
          className="w-28"
          disabled={disabled}
          value={value.scope}
          onChange={event => onChange({ ...emptyScope(), scope: event.target.value as ScopeValue["scope"] })}
        >
          <NativeSelectOption value="ALL">全校</NativeSelectOption>
          <NativeSelectOption value="COLLEGE">学院</NativeSelectOption>
          <NativeSelectOption value="MAJOR">专业</NativeSelectOption>
          <NativeSelectOption value="CLASS">班级</NativeSelectOption>
        </NativeSelect>
      </label>
      {value.scope !== "ALL" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          学院
          <NativeSelect
            className="w-44"
            disabled={disabled}
            value={value.college}
            onChange={event => onChange({ ...value, college: event.target.value, major: "", className: "" })}
          >
            <NativeSelectOption value="">请选择学院</NativeSelectOption>
            {orgs.colleges.map(row => <NativeSelectOption key={row.id} value={row.name}>{row.name}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      )}
      {(value.scope === "MAJOR" || value.scope === "CLASS") && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          专业
          <NativeSelect
            className="w-44"
            disabled={disabled || !value.college}
            value={value.major}
            onChange={event => onChange({ ...value, major: event.target.value, className: "" })}
          >
            <NativeSelectOption value="">请选择专业</NativeSelectOption>
            {majors.map(row => <NativeSelectOption key={row.id} value={row.name}>{row.name}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      )}
      {value.scope === "CLASS" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          班级
          <NativeSelect
            className="w-40"
            disabled={disabled || !value.major}
            value={value.className}
            onChange={event => onChange({ ...value, className: event.target.value })}
          >
            <NativeSelectOption value="">请选择班级</NativeSelectOption>
            {classes.map(row => <NativeSelectOption key={row.id} value={row.name}>{row.name}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      )}
    </>
  );
}

export function ExportZipDialog({
  open,
  onOpenChange,
  title,
  description,
  endpoint,
  filters,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  endpoint: string;
  filters: Record<string, string>;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    onError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, reason, filters }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.message || "导出失败，请重试");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "attachments.zip";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const files = response.headers.get("X-Export-Files") ?? "";
      const failed = Number(response.headers.get("X-Export-Failed") ?? 0);
      const partial = response.headers.get("X-Export-Status") === "PARTIAL";
      onDone(
        partial
          ? `已导出 ${files} 个文件，${failed} 个文件校验失败并记录在 errors.csv；清单见 manifest.csv。`
          : `已导出 ${files} 个文件，压缩包内含 manifest.csv 与原始文件。`,
      );
      setPassword("");
      setReason("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "导出失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={open => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description} 单次最多 2000 个文件、2 GiB。</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="attachment-export-password">当前密码</FieldLabel>
            <Input id="attachment-export-password" type="password" autoComplete="current-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="attachment-export-reason">导出理由</FieldLabel>
            <Textarea id="attachment-export-reason" rows={3} maxLength={500} disabled={busy} value={reason} placeholder="说明导出用途、接收方和保管方式" onChange={event => setReason(event.target.value)} />
            <FieldDescription>导出会记录操作日志；文件可能包含学生个人信息，请按数据保护要求保管。</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !password || reason.trim().length < 2} onClick={() => void submit()}>
            {busy ? "正在打包…" : "确认导出 ZIP"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
