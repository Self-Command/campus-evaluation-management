"use client";
// List, detail, export and retention controls adapted from the selected
// template's users directory (D/users/_components/users.tsx) and invoice
// detail sheet. Server-side filtering and cursor paging are preserved.
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCcw, Search, Settings2, Trash2 } from "lucide-react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { roleLabels } from "@/lib/business-labels";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type AuditItem = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorLogin: string | null;
  actorRole: string | null;
  action: string;
  actionLabel: string;
  category: string;
  categoryLabel: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  reason: string | null;
  result: "SUCCESS" | "FAILURE" | "DENIED" | "PARTIAL";
  resultLabel: string;
  requestId: string | null;
  route: string | null;
  method: string | null;
  ip: string | null;
  details: unknown;
  createdAt: string;
  highRisk: boolean;
};

type AuditList = {
  items: AuditItem[];
  total: number;
  pageSize: number;
  nextCursor: string | null;
};

type FilterOptions = {
  actions: { value: string; label: string; count: number }[];
  roles: { value: string; count: number }[];
  categories: { value: string; label: string }[];
  results: { value: string; label: string }[];
};

type OpsPolicy = {
  auditRetentionDays: number;
  auditAutoPurgeEnabled: boolean;
  backupRetentionCount: number;
  backupSafetyRetentionDays: number;
  previousDatabaseRetentionDays: number;
  restoreReportRetentionDays: number;
  restoreCandidateTtlMinutes: number;
  lastPurgeAt: string | null;
  lastPurgeCount: number | null;
  lastPurgeResult: string | null;
  lastRestoreAt: string | null;
  revision: number;
};

type PurgePreview = {
  count: number;
  cutoff: string;
  retentionDays: number;
  earliest: string | null;
  latest: string | null;
  tableBytes: number;
  databaseBytes: number;
  totalRows: number;
  diskFreeBytes: number | null;
  warning: boolean;
  recoveryWindowActive: boolean;
};

type Draft = {
  from: string;
  to: string;
  actor: string;
  role: string;
  category: string;
  action: string;
  result: string;
  keyword: string;
  reason: string;
};

const emptyDraft: Draft = { from: "", to: "", actor: "", role: "", category: "", action: "", result: "", keyword: "", reason: "" };

function dateInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function defaultDraft(): Draft {
  return { ...emptyDraft, from: dateInput(new Date(Date.now() - 6 * 86_400_000)), to: dateInput(new Date()) };
}

function dateTime(value: string | Date | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function bytesText(value: number | null | undefined) {
  if (value === null || value === undefined) return "未知";
  if (value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function apiFilters(draft: Draft) {
  const filters: Record<string, string> = {};
  if (draft.from) filters.from = new Date(`${draft.from}T00:00:00`).toISOString();
  if (draft.to) filters.to = new Date(`${draft.to}T23:59:59.999`).toISOString();
  for (const key of ["actor", "role", "category", "action", "result", "keyword", "reason"] as const) {
    if (draft[key].trim()) filters[key] = draft[key].trim();
  }
  return filters;
}

function resultVariant(result: AuditItem["result"]) {
  if (result === "FAILURE" || result === "DENIED") return "destructive" as const;
  if (result === "PARTIAL") return "outline" as const;
  return "secondary" as const;
}

function actorText(item: AuditItem) {
  if (!item.actorName && !item.actorLogin) return "系统任务";
  return `${item.actorName ?? item.actorLogin ?? "未知"}${item.actorLogin ? `（${item.actorLogin}）` : ""}`;
}

export function AuditLogs() {
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [applied, setApplied] = useState<Draft>(defaultDraft);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [exportInfo, setExportInfo] = useState("");
  const options = useRemote<FilterOptions>("/api/admin/audit-logs/filter-options");
  const cursor = cursors.at(-1);
  const query = useMemo(() => {
    const params = new URLSearchParams(apiFilters(applied));
    params.set("pageSize", "20");
    if (cursor) params.set("cursor", cursor);
    return `/api/admin/audit-logs?${params.toString()}`;
  }, [applied, cursor]);
  const remote = useRemote<AuditList>(query);
  const detail = useRemote<AuditItem>(selectedId ? `/api/admin/audit-logs/${selectedId}` : null);
  const policy = useRemote<OpsPolicy>(policyOpen || purgeOpen ? "/api/admin/ops-policy" : null);

  function apply() {
    setApplied(draft);
    setCursors([undefined]);
    setError("");
    setSuccess("");
  }

  function reset() {
    const next = defaultDraft();
    setDraft(next);
    setApplied(next);
    setCursors([undefined]);
  }

  async function doExport() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/audit-logs/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, reason, filters: apiFilters(applied) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "导出失败，请重试");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "audit-logs.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      const rows = response.headers.get("X-Export-Rows") ?? "";
      setExportInfo(`已导出 ${rows || "全部"} 条记录，文件 ${filename}`);
      setSuccess("日志导出完成。文件包含操作者、理由与请求上下文，请妥善保管。");
      setPassword("");
      setReason("");
      setExportOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnDef<DataTableFeatures, AuditItem>[] = [
    {
      accessorKey: "createdAt",
      header: "时间",
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{dateTime(row.original.createdAt)}</span>,
    },
    {
      id: "actor",
      header: "操作者",
      cell: ({ row }) => (
        <div className="min-w-36">
          <p className="font-medium">{actorText(row.original)}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.actorRole ? roleLabels[row.original.actorRole as keyof typeof roleLabels] ?? row.original.actorRole : "系统"}
          </p>
        </div>
      ),
    },
    {
      id: "action",
      header: "操作",
      cell: ({ row }) => (
        <div className="min-w-44">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{row.original.actionLabel}</span>
            {row.original.highRisk && <Badge variant="outline">高风险</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{row.original.categoryLabel}</p>
        </div>
      ),
    },
    {
      id: "target",
      header: "对象",
      cell: ({ row }) => (
        <div className="max-w-52">
          <p className="truncate">{row.original.targetLabel ?? row.original.targetId ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{row.original.targetType ?? "无目标类型"}</p>
        </div>
      ),
    },
    {
      accessorKey: "reason",
      header: "理由",
      cell: ({ row }) => <p className="max-w-56 line-clamp-2 text-muted-foreground">{row.original.reason ?? "未填写"}</p>,
    },
    {
      accessorKey: "result",
      header: "结果",
      cell: ({ row }) => <Badge variant={resultVariant(row.original.result)}>{row.original.resultLabel}</Badge>,
    },
    {
      id: "detail",
      header: "",
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => setSelectedId(row.original.id)}>
          详情
        </Button>
      ),
    },
  ];

  const filters = (
    <div className="flex w-full flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        开始日期
        <Input type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} className="w-36" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        结束日期
        <Input type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} className="w-36" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        操作者
        <Input value={draft.actor} maxLength={80} placeholder="姓名或账号" onChange={event => setDraft({ ...draft, actor: event.target.value })} className="w-36" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        角色
        <NativeSelect value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value })} className="w-32">
          <NativeSelectOption value="">全部角色</NativeSelectOption>
          {(options.data?.roles ?? []).map(row => (
            <NativeSelectOption key={row.value} value={row.value}>
              {roleLabels[row.value as keyof typeof roleLabels] ?? row.value}（{row.count}）
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        分类
        <NativeSelect value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} className="w-32">
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {(options.data?.categories ?? []).map(row => (
            <NativeSelectOption key={row.value} value={row.value}>{row.label}</NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        动作
        <NativeSelect value={draft.action} onChange={event => setDraft({ ...draft, action: event.target.value })} className="w-40">
          <NativeSelectOption value="">全部动作</NativeSelectOption>
          {(options.data?.actions ?? []).map(row => (
            <NativeSelectOption key={row.value} value={row.value}>{row.label}（{row.count}）</NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        结果
        <NativeSelect value={draft.result} onChange={event => setDraft({ ...draft, result: event.target.value })} className="w-28">
          <NativeSelectOption value="">全部结果</NativeSelectOption>
          {(options.data?.results ?? []).map(row => (
            <NativeSelectOption key={row.value} value={row.value}>{row.label}</NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        关键词
        <Input value={draft.keyword} maxLength={100} placeholder="目标、请求、动作" onChange={event => setDraft({ ...draft, keyword: event.target.value })} className="w-40" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        修改理由
        <Input value={draft.reason} maxLength={200} placeholder="理由包含" onChange={event => setDraft({ ...draft, reason: event.target.value })} className="w-36" />
      </label>
      <div className="flex gap-2 pb-0.5">
        <Button size="sm" onClick={apply}>
          <Search data-icon="inline-start" />
          查询
        </Button>
        <Button size="sm" variant="outline" onClick={reset}>
          <RefreshCcw data-icon="inline-start" />
          重置
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => { setError(""); setSuccess(""); setExportOpen(true); }}>
          <Download data-icon="inline-start" />
          导出 CSV
        </Button>
        <Button variant="outline" onClick={() => { setError(""); setSuccess(""); setPolicyOpen(true); }}>
          <Settings2 data-icon="inline-start" />
          保留策略
        </Button>
      </div>
      <Feedback error={error} success={success} />
      {exportInfo && <p className="text-sm text-muted-foreground">{exportInfo}</p>}
      <RemoteState loading={remote.loading} error={remote.error} reload={remote.reload} />
      {remote.data && (
        <>
          <TemplateDirectory
            title="日志明细"
            description={`共 ${remote.data.total} 条记录；默认读取最近 7 天，单次查询范围最多 366 天。关键词检索范围最多 31 天。`}
            filters={filters}
            data={remote.data.items}
            columns={columns}
            mobile={item => (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.actionLabel}</span>
                  <Badge variant={resultVariant(item.result)}>{item.resultLabel}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{dateTime(item.createdAt)} · {actorText(item)}</p>
                <p>{item.targetLabel ?? item.targetType ?? "—"}</p>
                {item.reason && <p className="text-xs text-muted-foreground">理由：{item.reason}</p>}
                <Button variant="outline" size="sm" className="self-start" onClick={() => setSelectedId(item.id)}>查看详情</Button>
              </div>
            )}
            empty={{ title: "没有匹配的操作记录", description: "请调整日期、角色、动作或关键词后重新查询。" }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              第 {cursors.length} 页 · 每页 20 条 · 共 {remote.data.total} 条
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length <= 1}
                onClick={() => setCursors(current => current.slice(0, -1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!remote.data.nextCursor}
                onClick={() => remote.data?.nextCursor && setCursors(current => [...current, remote.data!.nextCursor!])}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={exportOpen} onOpenChange={open => { setExportOpen(open); if (!open) { setPassword(""); setReason(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>导出操作日志</DialogTitle>
            <DialogDescription>
              按当前筛选导出 CSV。文件包含操作者、角色、目标、理由、结果、IP 和请求信息；请妥善保管。单次上限 100000 条。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="audit-export-password">当前密码</FieldLabel>
              <Input id="audit-export-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="audit-export-reason">导出理由</FieldLabel>
              <Textarea id="audit-export-reason" value={reason} maxLength={500} rows={3} onChange={event => setReason(event.target.value)} placeholder="说明导出用途、接收方和保管方式" />
              <FieldDescription>理由会写入审计记录。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>取消</Button>
            <Button disabled={busy || !password || reason.trim().length < 2} onClick={() => void doExport()}>
              {busy ? "正在导出…" : "确认导出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>日志与备份保留策略</DialogTitle>
            <DialogDescription>
              日志最少保留 30 天，且不会删除最近 7 天记录。恢复后 24 小时内自动清理会暂停，避免按旧策略误删。
            </DialogDescription>
          </DialogHeader>
          {policy.loading && <p className="text-sm text-muted-foreground">正在读取策略…</p>}
          {policy.error && <Feedback error={policy.error} />}
          {policy.data && (
            <PolicyForm
              key={`${policy.data.revision}-${policy.data.auditRetentionDays}`}
              policy={policy.data}
              onSaved={message => {
                setSuccess(message);
                setPolicyOpen(false);
                policy.reload();
                remote.reload();
              }}
              onPurge={() => {
                setPolicyOpen(false);
                setPurgeOpen(true);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={purgeOpen} onOpenChange={open => { setPurgeOpen(open); if (!open) { setPassword(""); setReason(""); setConfirmPhrase(""); } }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>清理过期操作日志</DialogTitle>
            <DialogDescription>
              只删除保留期之前的记录；清理动作本身会写入审计。最近 7 天、当前清理记录和恢复保护窗口内的日志不会被删除。
            </DialogDescription>
          </DialogHeader>
          {policy.data && (
            <PurgeForm
              retentionDays={policy.data.auditRetentionDays}
              password={password}
              reason={reason}
              confirmPhrase={confirmPhrase}
              onPassword={setPassword}
              onReason={setReason}
              onConfirm={setConfirmPhrase}
              onDone={message => {
                setSuccess(message);
                setPurgeOpen(false);
                setPassword("");
                setReason("");
                setConfirmPhrase("");
                remote.reload();
                policy.reload();
              }}
              onError={setError}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={!!selectedId} onOpenChange={open => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>操作详情</SheetTitle>
            <SheetDescription>记录不可编辑或单条删除；需要清理时按保留策略批量执行。</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-5 pb-6">
            {detail.loading && <p className="text-sm text-muted-foreground">正在读取…</p>}
            {detail.error && <Feedback error={detail.error} />}
            {detail.data && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={resultVariant(detail.data.result)}>{detail.data.resultLabel}</Badge>
                  {detail.data.highRisk && <Badge variant="outline">高风险动作</Badge>}
                  <Badge variant="secondary">{detail.data.categoryLabel}</Badge>
                </div>
                <DefinitionList
                  rows={[
                    ["动作", detail.data.actionLabel],
                    ["时间", dateTime(detail.data.createdAt)],
                    ["操作者", actorText(detail.data)],
                    ["角色", detail.data.actorRole ? roleLabels[detail.data.actorRole as keyof typeof roleLabels] ?? detail.data.actorRole : "系统"],
                    ["目标类型", detail.data.targetType ?? "—"],
                    ["目标名称", detail.data.targetLabel ?? "—"],
                    ["目标 ID", detail.data.targetId ?? "—"],
                    ["理由", detail.data.reason ?? "未填写"],
                    ["IP", detail.data.ip ?? "—"],
                    ["请求方法", detail.data.method ?? "—"],
                    ["路由", detail.data.route ?? "—"],
                    ["请求 ID", detail.data.requestId ?? "—"],
                  ]}
                />
                <Separator />
                <div>
                  <h3 className="mb-2 text-sm font-medium">结构化详情</h3>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap break-all">
                    {detail.data.details ? JSON.stringify(detail.data.details, null, 2) : "无附加详情"}
                  </pre>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DefinitionList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[7rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PolicyForm({ policy, onSaved, onPurge }: { policy: OpsPolicy; onSaved: (message: string) => void; onPurge: () => void }) {
  const [retention, setRetention] = useState(String(policy.auditRetentionDays));
  const [autoPurge, setAutoPurge] = useState(policy.auditAutoPurgeEnabled);
  const [backupCount, setBackupCount] = useState(String(policy.backupRetentionCount));
  const [safetyDays, setSafetyDays] = useState(String(policy.backupSafetyRetentionDays));
  const [previousDays, setPreviousDays] = useState(String(policy.previousDatabaseRetentionDays));
  const [reportDays, setReportDays] = useState(String(policy.restoreReportRetentionDays));
  const [candidateTtl, setCandidateTtl] = useState(String(policy.restoreCandidateTtlMinutes));
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/admin/ops-policy", {
        revision: policy.revision,
        auditRetentionDays: Number(retention),
        auditAutoPurgeEnabled: autoPurge,
        backupRetentionCount: Number(backupCount),
        backupSafetyRetentionDays: Number(safetyDays),
        previousDatabaseRetentionDays: Number(previousDays),
        restoreReportRetentionDays: Number(reportDays),
        restoreCandidateTtlMinutes: Number(candidateTtl),
        reason,
        password,
      }, "PUT");
      onSaved("运行策略已保存，新的保留规则立即生效；已有日志不会补删。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Feedback error={error} />
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="policy-retention">日志保留天数</FieldLabel>
            <Input id="policy-retention" type="number" min={30} max={3650} value={retention} onChange={event => setRetention(event.target.value)} />
            <FieldDescription>最少 30 天；最近 7 天永不清理。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-auto">自动清理</FieldLabel>
            <div className="flex h-8 items-center gap-3">
              <Switch id="policy-auto" checked={autoPurge} onCheckedChange={setAutoPurge} />
              <span className="text-sm text-muted-foreground">{autoPurge ? "每天自动清理过期日志" : "仅允许手动清理"}</span>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-backup-count">备份保留份数</FieldLabel>
            <Input id="policy-backup-count" type="number" min={1} max={100} value={backupCount} onChange={event => setBackupCount(event.target.value)} />
            <FieldDescription>只统计非 pinned 的自动备份；上传与安全快照不计入。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-safety">安全快照保留天数</FieldLabel>
            <Input id="policy-safety" type="number" min={1} max={30} value={safetyDays} onChange={event => setSafetyDays(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-previous">旧数据库保留天数</FieldLabel>
            <Input id="policy-previous" type="number" min={1} max={30} value={previousDays} onChange={event => setPreviousDays(event.target.value)} />
            <FieldDescription>恢复后保留被替换的旧库，便于回滚。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-report">恢复报告保留天数</FieldLabel>
            <Input id="policy-report" type="number" min={7} max={3650} value={reportDays} onChange={event => setReportDays(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="policy-ttl">候选库有效期（分钟）</FieldLabel>
            <Input id="policy-ttl" type="number" min={10} max={120} value={candidateTtl} onChange={event => setCandidateTtl(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel>最近状态</FieldLabel>
            <div className="text-sm text-muted-foreground">
              <p>清理：{policy.lastPurgeAt ? `${dateTime(policy.lastPurgeAt)}，${policy.lastPurgeCount ?? 0} 条` : "尚未清理"}</p>
              <p>恢复：{policy.lastRestoreAt ? dateTime(policy.lastRestoreAt) : "未执行过恢复"}</p>
            </div>
          </Field>
        </div>
        <Separator />
        <Field>
          <FieldLabel htmlFor="policy-reason">修改理由</FieldLabel>
          <Textarea id="policy-reason" rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="说明调整保留期的原因" />
        </Field>
        <Field>
          <FieldLabel htmlFor="policy-password">当前密码</FieldLabel>
          <Input id="policy-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
        </Field>
      </FieldGroup>
      <DialogFooter className="flex-wrap">
        <Button variant="destructive" type="button" onClick={onPurge} disabled={busy}>
          <Trash2 data-icon="inline-start" />
          清理过期日志
        </Button>
        <Button variant="outline" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "正在保存…" : "保存策略"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PurgeForm({
  retentionDays,
  password,
  reason,
  confirmPhrase,
  onPassword,
  onReason,
  onConfirm,
  onDone,
  onError,
}: {
  retentionDays: number;
  password: string;
  reason: string;
  confirmPhrase: string;
  onPassword: (value: string) => void;
  onReason: (value: string) => void;
  onConfirm: (value: string) => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<{ days: number; data: PurgePreview | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const loading = preview?.days !== retentionDays;

  useEffect(() => {
    let active = true;
    requestJson<PurgePreview>("/api/admin/audit-logs/purge-preview", { retentionDays })
      .then(data => { if (active) setPreview({ days: retentionDays, data }); })
      .catch(cause => {
        if (!active) return;
        setPreview({ days: retentionDays, data: null });
        onError(cause instanceof Error ? cause.message : "读取清理预览失败");
      });
    return () => { active = false; };
  }, [retentionDays, onError]);

  async function execute() {
    setBusy(true);
    onError("");
    try {
      const result = await requestJson<{ deleted: number; tableBytesBefore: number; tableBytes: number }>("/api/admin/audit-logs/purge", {
        reason,
        confirmPhrase,
        password,
      });
      onDone(`已清理 ${result.deleted} 条过期日志；审计表占用由 ${bytesText(result.tableBytesBefore)} 变为 ${bytesText(result.tableBytes)}。`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "清理失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">正在统计可清理范围…</p>;
  if (!preview?.data) return <Feedback error="清理预览暂时不可用，请重试。" />;
  const data = preview.data;
  return (
    <>
      <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div><span className="text-muted-foreground">将删除</span><p className="text-xl font-semibold">{data.count} 条</p></div>
        <div><span className="text-muted-foreground">保留期截止</span><p>{dateTime(data.cutoff)}</p></div>
        <div><span className="text-muted-foreground">最早记录</span><p>{dateTime(data.earliest)}</p></div>
        <div><span className="text-muted-foreground">最晚记录</span><p>{dateTime(data.latest)}</p></div>
        <div><span className="text-muted-foreground">审计表占用</span><p>{bytesText(data.tableBytes)} / 全库 {bytesText(data.databaseBytes)}</p></div>
        <div><span className="text-muted-foreground">备份卷剩余空间</span><p>{bytesText(data.diskFreeBytes)}</p></div>
      </div>
      {data.recoveryWindowActive && <Feedback error="最近 24 小时内执行过数据库恢复，自动清理会暂停；手动清理仍会删除保留期之前的数据。" />}
      {data.warning && <Feedback error="审计表或磁盘占用已达到预警阈值，请先导出日志并评估磁盘空间。" />}
      {data.count === 0 ? (
        <p className="text-sm text-muted-foreground">按当前保留期没有可清理的日志。</p>
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="purge-reason">清理理由</FieldLabel>
            <Textarea id="purge-reason" rows={2} maxLength={500} value={reason} onChange={event => onReason(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="purge-phrase">确认短语</FieldLabel>
            <Input id="purge-phrase" value={confirmPhrase} onChange={event => onConfirm(event.target.value)} placeholder="输入“清理日志”" />
          </Field>
          <Field>
            <FieldLabel htmlFor="purge-password">当前密码</FieldLabel>
            <Input id="purge-password" type="password" autoComplete="current-password" value={password} onChange={event => onPassword(event.target.value)} />
          </Field>
        </FieldGroup>
      )}
      <DialogFooter>
        <Button
          variant="destructive"
          disabled={busy || data.count === 0 || password.length === 0 || reason.trim().length < 2 || confirmPhrase !== "清理日志"}
          onClick={() => void execute()}
        >
          {busy ? "正在清理…" : `确认删除 ${data.count} 条`}
        </Button>
      </DialogFooter>
    </>
  );
}
