"use client";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback } from "@/components/dashboard/feedback";
import {
  ExportZipDialog,
  ScopeFields,
  bytesText,
  dateTime,
  emptyScope,
  scopeParams,
  type OrganizationTree,
  type ScopeValue,
} from "./shared";

type EvidenceItem = {
  id: string;
  ownerId: string;
  ownerName: string | null;
  ownerLogin: string | null;
  ownerStatus: "MISSING" | "NOT_STUDENT" | "NO_PROFILE" | "OK";
  studentNumber: string | null;
  college: string | null;
  major: string | null;
  className: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
  sources: ("RESULT" | "CLAIM" | "APPEAL" | "ACTIVITY")[];
  sourcesLabel: string;
  referenced: boolean;
  referenceCount: number;
  url: string;
};

type EvidenceList = {
  items: EvidenceItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: { files: number; bytes: number };
};

type Filters = {
  scope: ScopeValue;
  from: string;
  to: string;
  source: string;
  referenced: string;
  keyword: string;
};

const ownerStatusLabels: Record<EvidenceItem["ownerStatus"], string> = {
  MISSING: "账号不存在",
  NOT_STUDENT: "非学生账号",
  NO_PROFILE: "学生档案缺失",
  OK: "正常",
};

function defaultFilters(): Filters {
  return { scope: emptyScope(), from: "", to: "", source: "", referenced: "", keyword: "" };
}

function queryFor(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  if (filters.source) params.set("source", filters.source);
  if (filters.referenced) params.set("referenced", filters.referenced);
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  scopeParams(filters.scope, params);
  return params;
}

function ownerBadge(status: EvidenceItem["ownerStatus"]) {
  if (status === "OK") return null;
  return <Badge variant="destructive">{ownerStatusLabels[status]}</Badge>;
}

export function StudentEvidence({ orgs }: { orgs: OrganizationTree }) {
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const query = useMemo(() => {
    const params = queryFor(applied);
    params.set("page", String(page));
    params.set("pageSize", "20");
    return `/api/admin/evidence?${params.toString()}`;
  }, [applied, page]);
  const remote = useRemote<EvidenceList>(query);
  const exportFilters = useMemo(() => Object.fromEntries(queryFor(applied)), [applied]);

  function apply() {
    setApplied({ ...draft, scope: { ...draft.scope } });
    setPage(1);
    setError("");
    setSuccess("");
  }

  function reset() {
    const next = defaultFilters();
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  const columns: ColumnDef<DataTableFeatures, EvidenceItem>[] = [
    {
      accessorKey: "name",
      header: "证明文件",
      cell: ({ row }) => (
        <div className="min-w-0 max-w-60">
          <p className="truncate font-medium" title={row.original.name}>{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.mime} · SHA {row.original.sha256.slice(0, 12)}…</p>
        </div>
      ),
    },
    {
      id: "student",
      header: "学生",
      cell: ({ row }) => (
        <div className="min-w-32">
          <p className="font-medium">{row.original.ownerName ?? "未知账号"}</p>
          <p className="text-xs text-muted-foreground">{row.original.ownerLogin ?? row.original.ownerId}</p>
          <div className="mt-1">{ownerBadge(row.original.ownerStatus)}</div>
        </div>
      ),
    },
    {
      id: "profile",
      header: "学籍",
      cell: ({ row }) => (
        <div className="min-w-36 text-sm">
          <p>{row.original.studentNumber ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {[row.original.college, row.original.major, row.original.className].filter(Boolean).join(" / ") || "无学籍档案"}
          </p>
        </div>
      ),
    },
    {
      id: "sources",
      header: "引用来源",
      cell: ({ row }) => (
        <div className="min-w-28 text-sm">
          <p>{row.original.sourcesLabel}</p>
          <p className="text-xs text-muted-foreground">{row.original.referenced ? `${row.original.referenceCount} 处引用` : "未被引用"}</p>
        </div>
      ),
    },
    {
      id: "size",
      header: "大小 / 上传时间",
      cell: ({ row }) => (
        <div className="min-w-32 text-sm">
          <p className="tabular-nums">{bytesText(row.original.size)}</p>
          <p className="text-xs text-muted-foreground">{dateTime(row.original.createdAt)}</p>
        </div>
      ),
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <a href={row.original.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download data-icon="inline-start" />
          下载
        </a>
      ),
    },
  ];

  return (
    <>
      <Feedback error={error} success={success} />
      {remote.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">证明文件</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{remote.data.summary.files.toLocaleString("zh-CN")}</p>
            <p className="mt-1 text-xs text-muted-foreground">按当前学生档案范围统计</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">证明总大小</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{bytesText(remote.data.summary.bytes)}</p>
            <p className="mt-1 text-xs text-muted-foreground">导出上限 2000 个文件 / 2 GiB</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">当前页</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{remote.data.page} / {remote.data.pageCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">每页 20 条，倒序排列</p>
          </div>
        </div>
      )}
      <RemoteState loading={remote.loading} error={remote.error} reload={remote.reload} />
      {remote.data && (
        <>
          <TemplateDirectory
            title="学生证明"
            description={`共 ${remote.data.total} 份证明；按学生当前学籍档案的学院、专业、班级范围筛选。`}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => remote.reload()}>
                  <RefreshCcw data-icon="inline-start" />
                  刷新
                </Button>
                <Button size="sm" onClick={() => { setError(""); setSuccess(""); setExportOpen(true); }}>
                  <Download data-icon="inline-start" />
                  导出当前范围
                </Button>
              </>
            }
            filters={
              <div className="flex w-full flex-wrap items-end gap-2">
                <ScopeFields value={draft.scope} onChange={scope => setDraft({ ...draft, scope })} orgs={orgs} />
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  引用来源
                  <NativeSelect className="w-32" value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })}>
                    <NativeSelectOption value="">全部来源</NativeSelectOption>
                    <NativeSelectOption value="RESULT">成果认定</NativeSelectOption>
                    <NativeSelectOption value="CLAIM">个人申报</NativeSelectOption>
                    <NativeSelectOption value="APPEAL">异议</NativeSelectOption>
                    <NativeSelectOption value="ACTIVITY">活动</NativeSelectOption>
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  引用状态
                  <NativeSelect className="w-32" value={draft.referenced} onChange={event => setDraft({ ...draft, referenced: event.target.value })}>
                    <NativeSelectOption value="">全部状态</NativeSelectOption>
                    <NativeSelectOption value="REFERENCED">已被引用</NativeSelectOption>
                    <NativeSelectOption value="UNREFERENCED">未被引用</NativeSelectOption>
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  上传开始
                  <Input type="date" className="w-36" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  上传结束
                  <Input type="date" className="w-36" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  关键词
                  <Input className="w-40" maxLength={80} placeholder="文件名、姓名、学号" value={draft.keyword} onChange={event => setDraft({ ...draft, keyword: event.target.value })} />
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
            }
            data={remote.data.items}
            columns={columns}
            mobile={item => (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{bytesText(item.size)} · {dateTime(item.createdAt)}</p>
                  </div>
                  {ownerBadge(item.ownerStatus)}
                </div>
                <p className="text-sm">{item.ownerName ?? "未知账号"} · {item.studentNumber ?? "无学号"}</p>
                <p className="text-sm text-muted-foreground">{[item.college, item.major, item.className].filter(Boolean).join(" / ") || "无学籍档案"}</p>
                <p className="text-sm text-muted-foreground">{item.sourcesLabel}{item.referenced ? ` · ${item.referenceCount} 处引用` : " · 未被引用"}</p>
                <a href={item.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>下载</a>
              </div>
            )}
            empty={{ title: "没有匹配的学生证明", description: "调整范围、来源或上传日期后重新查询。" }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              第 {remote.data.page} / {remote.data.pageCount} 页 · 共 {remote.data.total} 份证明
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= remote.data.pageCount} onClick={() => setPage(current => current + 1)}>下一页</Button>
            </div>
          </div>
        </>
      )}

      <ExportZipDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="导出学生证明 ZIP"
        description="按当前筛选条件导出学生证明文件，压缩包内包含 manifest.csv；学生档案状态与引用来源会写入清单。"
        endpoint="/api/admin/evidence/export"
        filters={exportFilters}
        onDone={message => { setSuccess(message); setExportOpen(false); }}
        onError={setError}
      />
    </>
  );
}
