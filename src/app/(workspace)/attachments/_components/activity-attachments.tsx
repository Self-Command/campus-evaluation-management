"use client";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Eye, PackageOpen, RefreshCcw, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
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
  type TermOption,
} from "./shared";

type Audience = {
  scope: "ALL" | "COLLEGE" | "CLASS";
  scopeLabel: string;
  colleges: string[];
  collegesUnmatched: string[];
  classes: { key: string; college: string | null; major: string | null; className: string | null; matched: boolean }[];
};

type ActivityItem = {
  id: string;
  name: string;
  organizer: string;
  termId: string;
  termName: string;
  collegeId: string | null;
  collegeName: string;
  status: "DRAFT" | "WITHDRAWN" | "ACTIVE" | "ENDED";
  statusLabel: string;
  audience: Audience;
  startAt: string;
  endAt: string;
  updatedAt: string;
  publishedAt: string | null;
  attachmentCount: number;
  imageCount: number;
  fileCount: number;
  totalBytes: number;
  latestUploadAt: string | null;
  latestUploader: string | null;
};

type ActivityList = {
  items: ActivityItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: { activities: number; attachments: number; bytes: number };
  audienceHealth: {
    unmatchedCollegeActivities: number;
    unmatchedCollegeKeys: number;
    unmatchedClassActivities: number;
    unmatchedClassKeys: number;
  };
};

type ActivityDetail = {
  id: string;
  name: string;
  organizer: string;
  termName: string;
  collegeName: string;
  statusLabel: string;
  audience: Audience;
  startAt: string;
  endAt: string;
  attachments: { id: string; name: string; mime: string; size: number; kind: string; createdAt: string; sha256: string; uploader: string; url: string }[];
};

type Filters = {
  termId: string;
  status: string;
  keyword: string;
  ownerCollegeId: string;
  audienceScope: string;
  from: string;
  to: string;
  scope: ScopeValue;
};

function defaultFilters(terms: TermOption[]): Filters {
  const active = terms.find(term => term.disposition === "NORMAL");
  return {
    termId: active?.id ?? "",
    status: "",
    keyword: "",
    ownerCollegeId: "",
    audienceScope: "",
    from: "",
    to: "",
    scope: emptyScope(),
  };
}

function queryFor(filters: Filters) {
  const params = new URLSearchParams();
  if (filters.termId) params.set("termId", filters.termId);
  if (filters.status) params.set("status", filters.status);
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (filters.ownerCollegeId) params.set("ownerCollegeId", filters.ownerCollegeId);
  if (filters.audienceScope) params.set("audienceScope", filters.audienceScope);
  if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  scopeParams(filters.scope, params);
  return params;
}

function audienceText(audience: Audience) {
  if (audience.scope === "ALL") return "全校";
  if (audience.scope === "COLLEGE") {
    if (!audience.colleges.length) return "0 个学院";
    return audience.colleges.length > 2 ? `${audience.colleges.slice(0, 2).join("、")} 等 ${audience.colleges.length} 个学院` : audience.colleges.join("、");
  }
  if (!audience.classes.length) return "0 个班级";
  const names = audience.classes.map(row => row.college && row.major && row.className ? `${row.college}/${row.major}/${row.className}` : "无效班级范围");
  return names.length > 2 ? `${names.slice(0, 2).join("、")} 等 ${names.length} 个班级` : names.join("、");
}

function statusVariant(status: ActivityItem["status"]) {
  if (status === "ACTIVE") return "secondary" as const;
  if (status === "ENDED") return "outline" as const;
  return "destructive" as const;
}

export function ActivityAttachments({ terms, orgs }: { terms: TermOption[]; orgs: OrganizationTree }) {
  const [draft, setDraft] = useState<Filters>(() => defaultFilters(terms));
  const [applied, setApplied] = useState<Filters>(() => defaultFilters(terms));
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const query = useMemo(() => {
    const params = queryFor(applied);
    params.set("page", String(page));
    params.set("pageSize", "20");
    return `/api/admin/attachments/activities?${params.toString()}`;
  }, [applied, page]);
  const remote = useRemote<ActivityList>(query);
  const detail = useRemote<ActivityDetail>(selectedId ? `/api/admin/attachments/activities/${selectedId}` : null);

  function apply() {
    setApplied({ ...draft, scope: { ...draft.scope } });
    setPage(1);
    setError("");
    setSuccess("");
  }

  function reset() {
    const next = defaultFilters(terms);
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  const exportFilters = useMemo(() => Object.fromEntries(queryFor(applied)), [applied]);

  const columns: ColumnDef<DataTableFeatures, ActivityItem>[] = [
    {
      accessorKey: "name",
      header: "活动",
      cell: ({ row }) => (
        <div className="min-w-0 max-w-64">
          <p className="truncate font-medium" title={row.original.name}>{row.original.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.original.termName} · {row.original.organizer}
          </p>
        </div>
      ),
    },
    {
      id: "scope",
      header: "归属 / 受众",
      cell: ({ row }) => (
        <div className="min-w-32 text-sm">
          <p>{row.original.collegeName}</p>
          <p className="text-xs text-muted-foreground">{row.original.audience.scopeLabel}：{audienceText(row.original.audience)}</p>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => <Badge variant={statusVariant(row.original.status)}>{row.original.statusLabel}</Badge>,
    },
    {
      id: "attachments",
      header: "附件",
      cell: ({ row }) => (
        <div className="min-w-28 text-sm">
          <p className="tabular-nums">{row.original.attachmentCount} 个 · {bytesText(row.original.totalBytes)}</p>
          <p className="text-xs text-muted-foreground">
            图片 {row.original.imageCount} · 文件 {row.original.fileCount}
          </p>
        </div>
      ),
    },
    {
      id: "latest",
      header: "最近上传",
      cell: ({ row }) => (
        <div className="min-w-32 text-sm">
          <p className="tabular-nums">{dateTime(row.original.latestUploadAt)}</p>
          <p className="text-xs text-muted-foreground">{row.original.latestUploader ?? "—"}</p>
        </div>
      ),
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => setSelectedId(row.original.id)}>
          <Eye data-icon="inline-start" />
          查看附件
        </Button>
      ),
    },
  ];

  const health = remote.data?.audienceHealth;
  const healthTotal = health ? health.unmatchedCollegeActivities + health.unmatchedClassActivities : 0;

  return (
    <>
      <Feedback error={error} success={success} />
      {healthTotal > 0 && health && (
        <Alert>
          <PackageOpen />
          <AlertTitle>受众范围与当前组织目录不一致</AlertTitle>
          <AlertDescription>
            {health.unmatchedCollegeActivities > 0 && `有 ${health.unmatchedCollegeActivities} 个活动引用了已不存在或已改名的学院（${health.unmatchedCollegeKeys} 项）。`}
            {health.unmatchedClassActivities > 0 && `有 ${health.unmatchedClassActivities} 个活动引用了已不存在或已改名的班级（${health.unmatchedClassKeys} 项）。`}
            按学院或班级筛选时会使用当前组织目录，请先核对活动受众。
          </AlertDescription>
        </Alert>
      )}
      {remote.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Summary label="活动数" value={remote.data.summary.activities.toLocaleString("zh-CN")} hint="只统计至少有一个附件的活动" />
          <Summary label="附件数" value={remote.data.summary.attachments.toLocaleString("zh-CN")} hint="一个活动多个附件仍只显示一行" />
          <Summary label="附件总大小" value={bytesText(remote.data.summary.bytes)} hint="不包含学生证明文件" />
        </div>
      )}
      <RemoteState loading={remote.loading} error={remote.error} reload={remote.reload} />
      {remote.data && (
        <>
          <TemplateDirectory
            title="活动附件"
            description={`共 ${remote.data.total} 个活动有附件；筛选按活动受众范围匹配学院、专业或班级。`}
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
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  测评周期
                  <NativeSelect className="w-44" value={draft.termId} onChange={event => setDraft({ ...draft, termId: event.target.value })}>
                    <NativeSelectOption value="">全部周期</NativeSelectOption>
                    {terms.map(term => <NativeSelectOption key={term.id} value={term.id}>{term.name}{term.disposition !== "NORMAL" ? "（已归档）" : ""}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  状态
                  <NativeSelect className="w-28" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>
                    <NativeSelectOption value="">全部状态</NativeSelectOption>
                    <NativeSelectOption value="DRAFT">未发布</NativeSelectOption>
                    <NativeSelectOption value="WITHDRAWN">已撤回</NativeSelectOption>
                    <NativeSelectOption value="ACTIVE">进行中</NativeSelectOption>
                    <NativeSelectOption value="ENDED">已结束</NativeSelectOption>
                  </NativeSelect>
                </label>
                <ScopeFields value={draft.scope} onChange={scope => setDraft({ ...draft, scope })} orgs={orgs} />
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  归属学院
                  <NativeSelect className="w-40" value={draft.ownerCollegeId} onChange={event => setDraft({ ...draft, ownerCollegeId: event.target.value })}>
                    <NativeSelectOption value="">全部归属</NativeSelectOption>
                    <NativeSelectOption value="NONE">未指定学院</NativeSelectOption>
                    {orgs.colleges.map(college => <NativeSelectOption key={college.id} value={college.id}>{college.name}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  受众类型
                  <NativeSelect className="w-28" value={draft.audienceScope} onChange={event => setDraft({ ...draft, audienceScope: event.target.value })}>
                    <NativeSelectOption value="">全部受众</NativeSelectOption>
                    <NativeSelectOption value="ALL">全校</NativeSelectOption>
                    <NativeSelectOption value="COLLEGE">学院</NativeSelectOption>
                    <NativeSelectOption value="CLASS">班级</NativeSelectOption>
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
                  <Input className="w-40" maxLength={80} placeholder="活动、组织者、附件名" value={draft.keyword} onChange={event => setDraft({ ...draft, keyword: event.target.value })} />
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
                    <p className="text-xs text-muted-foreground">{item.termName} · {item.collegeName}</p>
                  </div>
                  <Badge variant={statusVariant(item.status)}>{item.statusLabel}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {item.audience.scopeLabel}：{audienceText(item.audience)}
                </p>
                <p className="text-sm">{item.attachmentCount} 个附件 · {bytesText(item.totalBytes)} · 最近 {dateTime(item.latestUploadAt)}</p>
                <Button size="sm" variant="outline" className="self-start" onClick={() => setSelectedId(item.id)}>查看附件</Button>
              </div>
            )}
            empty={{ title: "没有匹配的活动附件", description: "调整周期、范围或上传日期后重新查询。" }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              第 {remote.data.page} / {remote.data.pageCount} 页 · 共 {remote.data.total} 个活动
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= remote.data.pageCount} onClick={() => setPage(current => current + 1)}>下一页</Button>
            </div>
          </div>
        </>
      )}

      <Sheet open={!!selectedId} onOpenChange={open => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>活动附件</SheetTitle>
            <SheetDescription>下载活动附件会写入操作日志；单个活动最多显示的附件数量以系统设置为准。</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-5 pb-6">
            {detail.loading && <p className="text-sm text-muted-foreground">正在读取附件…</p>}
            {detail.error && <Feedback error={detail.error} />}
            {detail.data && (
              <>
                <div>
                  <p className="text-lg font-semibold">{detail.data.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {detail.data.termName} · {detail.data.organizer} · {detail.data.collegeName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {detail.data.statusLabel} · {detail.data.audience.scopeLabel}：{audienceText(detail.data.audience)}
                  </p>
                </div>
                <Separator />
                {detail.data.attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">该活动没有附件。</p>
                ) : (
                  <div className="flex flex-col divide-y rounded-lg border">
                    {detail.data.attachments.map(file => (
                      <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={file.name}>{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {file.kind === "IMAGE" ? "图片" : "文件"} · {bytesText(file.size)} · {dateTime(file.createdAt)} · {file.uploader}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">SHA-256 {file.sha256.slice(0, 16)}…</p>
                        </div>
                        <a href={file.url} className={buttonVariants({ variant: "outline", size: "sm" })} target="_blank" rel="noopener">
                          <Download data-icon="inline-start" />
                          下载
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ExportZipDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="导出活动附件 ZIP"
        description="按当前筛选条件导出全部匹配附件，压缩包内按活动分目录，并包含 manifest.csv。"
        endpoint="/api/admin/attachments/export"
        filters={exportFilters}
        onDone={message => { setSuccess(message); setExportOpen(false); }}
        onError={setError}
      />
    </>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
