"use client";
// Backup directory and restore wizard adapted from the selected template's
// users directory (D/users/_components/users.tsx) and invoice detail/preview
// (D/invoice/_components/invoice.tsx). Server-side backup manifests are the
// source of truth; the browser never invents job state.
import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Clock,
  Database,
  Download,
  HardDrive,
  Loader2,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type BackupItem = {
  id: string;
  filename: string;
  kind: "MANUAL" | "UPLOADED" | "SAFETY";
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string;
  pinned: boolean;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; name: string; login: string } | null;
  reason: string;
  appVersion: string;
  gitRevision: string;
  clientVersion: number;
  serverVersion: number;
  migrations: { name: string; checksum: string; finishedAt: string | null; rolledBackAt: string | null }[];
  bytes: number;
  sha256: string;
  sha256Prefix: string | null;
  snapshotId: string | null;
  databaseBytes: number;
  tables: { name: string; rows: number }[];
  sequenceCount: number;
  evidenceRows: number;
  activityAttachmentRows: number;
  errorCode?: string;
  errorMessage?: string;
  exists: boolean;
  sizeLabel: number;
};

type ActiveRestore = { phase: string; backupId: string; startedAt: string } | null;

type BackupList = {
  items: BackupItem[];
  summary: {
    total: number;
    pinned: number;
    failed: number;
    running: number;
    volumeBytes: number;
    volumeMaxBytes: number;
    pinnedBytes: number;
    freeBytes: number | null;
    lastCreatedAt: string | null;
    retentionCount: number;
    safetyRetentionDays: number;
    includesFiles: false;
    activeRestore: ActiveRestore;
  };
};

type RestoreReport = {
  restoreId: string;
  backupId: string;
  backupFilename: string;
  backupCreatedAt: string;
  backupBytes: number;
  backupHashMatched: boolean;
  generatedAt: string;
  status: "READY" | "REJECTED" | "COMPLETED" | "FAILED" | "ROLLED_BACK";
  restoreMode: string;
  includesFiles: false;
  blockers: { code: string; message: string }[];
  warnings: string[];
  migrations: {
    backupCount: number;
    localCount: number;
    needsForwardMigration: boolean;
    appliedNow: string[];
    checksumVerified: boolean;
    pendingAfter: number;
  };
  data: {
    currentDatabaseBytes: number;
    candidateDatabaseBytes: number;
    current: Record<string, number>;
    restored: Record<string, number>;
    currentTableCount: number;
    restoredTableCount: number;
    structureMissing: { name: string; currentRows: number }[];
  };
  audit: {
    afterBackup: number;
    byCategory: { category: string; count: number }[];
    sidecarEvents: number;
    sidecarBytes: number;
    sidecarSha256: string;
    firstAt: string | null;
    lastAt: string | null;
    imported: number;
    skipped: number;
  };
  admins: {
    restored: { login: string; name: string; mustChangePassword: boolean }[];
    operatorPresent: boolean;
    eligible: boolean;
  };
  sessions: { authSessions: number; loginFailureStates: number; captchas: number; attempts: number; oldPasswordHashes: boolean };
  settings: { key: string; current: unknown; restored: unknown }[];
  files: {
    evidenceRows: number;
    attachmentRows: number;
    currentEvidenceMissing: number;
    currentAttachmentMissing: number;
    restoredEvidenceMissing: number;
    restoredAttachmentMissing: number;
    evidenceOrphans: number;
    attachmentOrphans: number;
  };
  disk: { freeBytes: number | null; requiredBytes: number; currentDatabaseBytes: number; candidateDatabaseBytes: number };
  safetyBackupId: string | null;
  errorCode?: string;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

const terminalPhases = new Set(["completed", "failed", "rolled-back"]);
const executingRestorePhases = new Set(["confirmed", "snapshot", "exported", "swapping", "swapped"]);

const phaseLabels: Record<string, string> = {
  preflight: "预检中",
  ready: "预检通过，等待确认",
  confirmed: "已确认，准备安全快照",
  snapshot: "创建恢复前安全快照",
  exported: "导出审计旁路",
  swapping: "原子切换数据库",
  swapped: "切换完成，校验中",
  completed: "恢复完成",
  failed: "恢复失败",
  "rolled-back": "已自动回滚",
};

const tableLabels: Record<string, string> = {
  User: "账号",
  StudentProfile: "学生学籍",
  Term: "测评周期",
  Activity: "活动",
  Publication: "结果发布",
  Claim: "成果申报",
  Evidence: "证明材料",
  ActivityAttachment: "活动附件",
  Participation: "参与记录",
  RecognitionSource: "参与来源",
  Appeal: "成绩异议",
  AuditEvent: "操作日志",
};

const kindLabels: Record<BackupItem["kind"], string> = {
  MANUAL: "手动备份",
  UPLOADED: "上传备份",
  SAFETY: "安全快照",
};

const stageLabels: Record<string, string> = {
  QUEUED: "排队中",
  DUMPING: "正在导出",
  VERIFYING: "正在校验",
  COMPLETED: "已完成",
  FAILED: "失败",
  INTERRUPTED: "被中断",
  MISSING: "文件缺失",
  DELETING: "删除中",
};

function dateTime(value: string | null | undefined) {
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

function statusBadge(item: BackupItem) {
  if (item.status === "SUCCEEDED") return <Badge variant="secondary">可用</Badge>;
  if (item.status === "RUNNING") {
    return (
      <Badge variant="outline">
        <Loader2 className="animate-spin" />
        {stageLabels[item.stage] ?? item.stage}
      </Badge>
    );
  }
  return <Badge variant="destructive">失败</Badge>;
}

function reportBadge(status: RestoreReport["status"]) {
  if (status === "READY" || status === "COMPLETED") return <Badge variant="secondary">{status === "READY" ? "可执行恢复" : "恢复完成"}</Badge>;
  if (status === "REJECTED") return <Badge variant="destructive">预检未通过</Badge>;
  if (status === "ROLLED_BACK") return <Badge variant="outline">已回滚</Badge>;
  return <Badge variant="destructive">恢复失败</Badge>;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

async function putFile(url: string, file: File, token: string, onProgress: (percent: number) => void) {
  const chunkSize = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, file.size);
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("x-upload-token", token);
      xhr.setRequestHeader("x-upload-offset", String(offset));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(Math.min(99, Math.round(((offset + event.loaded) / file.size) * 100)));
      };
      xhr.onload = () => {
        let body: { error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText) as { error?: string };
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(body.error || `上传失败（HTTP ${xhr.status}）`));
      };
      xhr.onerror = () => reject(new Error("上传中断，请检查网络后重试"));
      xhr.send(file.slice(offset, end));
    });
  }
  onProgress(100);
}

export function Backups() {
  const remote = useRemote<BackupList>("/api/admin/backups");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloadItem, setDownloadItem] = useState<BackupItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<BackupItem | null>(null);
  const [wizard, setWizard] = useState<{
    item: BackupItem;
    token: number;
    initialReport: RestoreReport | null;
  } | null>(null);
  const [openingReport, setOpeningReport] = useState(false);

  const data = remote.data;
  const running = Boolean(data?.items.some(item => item.status === "RUNNING"));
  const activeRestore = data?.summary.activeRestore ?? null;
  const activeRestoreBusy = Boolean(activeRestore && !terminalPhases.has(activeRestore.phase));
  const restoreExecuting = Boolean(activeRestore && executingRestorePhases.has(activeRestore.phase));
  const reload = remote.reload;

  useEffect(() => {
    if (!running && !restoreExecuting) return;
    const timer = window.setInterval(() => reload(), 4000);
    return () => window.clearInterval(timer);
  }, [running, restoreExecuting, reload]);

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  function refresh() {
    clearMessages();
    remote.reload();
  }

  function changeTable() {
    remote.reload();
  }

  async function openReport(item: BackupItem) {
    clearMessages();
    setOpeningReport(true);
    try {
      const result = await requestJson<{ report: RestoreReport | null }>(`/api/admin/backups/${item.id}/report`);
      if (!result.report) throw new Error("该备份还没有恢复报告，请先执行恢复预检。");
      setWizard({ item, token: Date.now(), initialReport: result.report });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setOpeningReport(false);
    }
  }

  async function openActivePreflight() {
    if (!activeRestore) return;
    const item = data?.items.find(row => row.id === activeRestore.backupId);
    if (!item) {
      setError("进行中的恢复任务对应备份已不存在，请进入维护状态页查看处理进度。");
      return;
    }
    await openReport(item);
  }

  const columns: ColumnDef<DataTableFeatures, BackupItem>[] = [
    {
      accessorKey: "filename",
      header: "备份文件",
      cell: ({ row }) => (
        <div className="min-w-0 max-w-72">
          <p className="truncate font-medium" title={row.original.filename}>
            {row.original.filename}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{kindLabels[row.original.kind]}</Badge>
            {row.original.pinned && <Badge variant="secondary">保留</Badge>}
            {!row.original.exists && <Badge variant="destructive">文件缺失</Badge>}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => (
        <div className="min-w-28 space-y-1">
          {statusBadge(row.original)}
          <p className="text-xs text-muted-foreground">
            {row.original.errorMessage ?? (row.original.completedAt ? `完成于 ${dateTime(row.original.completedAt)}` : "等待执行")}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "创建信息",
      cell: ({ row }) => (
        <div className="min-w-36 text-sm">
          <p className="tabular-nums">{dateTime(row.original.createdAt)}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.createdBy ? `${row.original.createdBy.name}（${row.original.createdBy.login}）` : "系统任务"}
          </p>
        </div>
      ),
    },
    {
      id: "size",
      header: "内容",
      cell: ({ row }) => (
        <div className="min-w-32 text-sm">
          <p className="tabular-nums">{bytesText(row.original.bytes)}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.migrations.length} 个迁移 · {row.original.tables.length} 张表
          </p>
          {row.original.sha256Prefix && <p className="font-mono text-[11px] text-muted-foreground">SHA {row.original.sha256Prefix}…</p>}
        </div>
      ),
    },
    {
      accessorKey: "reason",
      header: "理由",
      cell: ({ row }) => <p className="max-w-48 line-clamp-2 text-muted-foreground">{row.original.reason}</p>,
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => {
        const item = row.original;
        const ready = item.status === "SUCCEEDED" && item.exists;
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={!ready} onClick={() => { clearMessages(); setDownloadItem(item); }}>
              <Download data-icon="inline-start" />
              下载
            </Button>
            <Button size="sm" disabled={!ready || activeRestoreBusy} onClick={() => { clearMessages(); setWizard({ item, token: Date.now(), initialReport: null }); }}>
              <RotateCcw data-icon="inline-start" />
              恢复
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void openReport(item)}>
              报告
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { clearMessages(); setDeleteItem(item); }}>
              <Trash2 data-icon="inline-start" />
              删除
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Feedback error={error} success={success} />
      {activeRestoreBusy && activeRestore && (
        <Alert>
          <Clock />
          <AlertTitle>数据库恢复任务进行中：{phaseLabels[activeRestore.phase] ?? activeRestore.phase}</AlertTitle>
          <AlertDescription>
            <p>
              任务开始于 {dateTime(activeRestore.startedAt)}。系统在恢复期间暂停其他业务写入。
              {activeRestore.phase === "ready" ? "预检已通过，可在报告底部确认执行，或中止预检。" : "恢复执行期间无法在业务页面操作。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeRestore.phase === "ready" && (
                <Button size="sm" variant="outline" disabled={openingReport} onClick={() => void openActivePreflight()}>
                  查看恢复预检
                </Button>
              )}
              <a href="/maintenance" target="_blank" rel="noopener" className={buttonVariants({ size: "sm", variant: "outline" })}>
                打开恢复状态页
              </a>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={<Database />}
            label="可用备份"
            value={String(data.summary.total)}
            hint={`${data.summary.pinned} 份保留备份 · ${data.summary.failed} 份失败记录`}
          />
          <SummaryCard
            icon={<HardDrive />}
            label="备份卷占用"
            value={bytesText(data.summary.volumeBytes)}
            hint={`上限 ${bytesText(data.summary.volumeMaxBytes)} · 磁盘剩余 ${bytesText(data.summary.freeBytes)}`}
          />
          <SummaryCard
            icon={<Clock />}
            label="最近可用备份"
            value={data.summary.lastCreatedAt ? dateTime(data.summary.lastCreatedAt) : "暂无"}
            hint="只统计已完成且文件存在的备份"
          />
          <SummaryCard
            icon={<ShieldAlert />}
            label="保留策略"
            value={`${data.summary.retentionCount} 份`}
            hint={`安全快照保留 ${data.summary.safetyRetentionDays} 天 · 备份不含附件文件`}
          />
        </div>
      )}

      <RemoteState loading={remote.loading && !data} error={remote.error} reload={refresh} />
      {data && (
        <TemplateDirectory
          title="备份目录"
          description="创建备份在后台执行，完成后才可下载或用于恢复。恢复会替换整个数据库，不支持行级合并。"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={refresh}>
                <RefreshCcw data-icon="inline-start" />
                刷新
              </Button>
              <Button size="sm" variant="outline" disabled={activeRestoreBusy} onClick={() => { clearMessages(); setUploadOpen(true); }}>
                <Upload data-icon="inline-start" />
                上传备份
              </Button>
              <Button size="sm" disabled={activeRestoreBusy} onClick={() => { clearMessages(); setCreateOpen(true); }}>
                <Database data-icon="inline-start" />
                新建备份
              </Button>
            </>
          }
          data={data.items}
          columns={columns}
          mobile={item => (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {kindLabels[item.kind]} · {bytesText(item.bytes)} · {dateTime(item.createdAt)}
                  </p>
                </div>
                {statusBadge(item)}
              </div>
              <p className="text-sm text-muted-foreground">理由：{item.reason}</p>
              {item.errorMessage && <p className="text-sm text-destructive">{item.errorMessage}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={item.status !== "SUCCEEDED" || !item.exists} onClick={() => setDownloadItem(item)}>
                  下载
                </Button>
                <Button size="sm" disabled={item.status !== "SUCCEEDED" || !item.exists || activeRestoreBusy} onClick={() => setWizard({ item, token: Date.now(), initialReport: null })}>
                  恢复
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void openReport(item)}>报告</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteItem(item)}>删除</Button>
              </div>
            </div>
          )}
          empty={{
            title: "还没有数据库备份",
            description: activeRestoreBusy ? "恢复任务进行中，完成后可继续创建备份。" : "创建第一份备份，下载后请存放在受控的离线位置。",
          }}
        />
      )}

      <CreateBackupDialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open);
          if (!open) changeTable();
        }}
        onDone={message => {
          setSuccess(message);
          setCreateOpen(false);
          remote.reload();
        }}
        onError={setError}
      />

      <UploadBackupDialog
        open={uploadOpen}
        onOpenChange={open => {
          setUploadOpen(open);
          if (!open) changeTable();
        }}
        onDone={message => {
          setSuccess(message);
          setUploadOpen(false);
          remote.reload();
        }}
        onError={setError}
      />

      <DownloadDialog
        item={downloadItem}
        onClose={() => setDownloadItem(null)}
        onDone={message => {
          setSuccess(message);
          setDownloadItem(null);
        }}
        onError={setError}
      />

      <DeleteDialog
        item={deleteItem}
        onClose={() => setDeleteItem(null)}
        onDone={message => {
          setSuccess(message);
          setDeleteItem(null);
          remote.reload();
        }}
        onError={setError}
      />

      {wizard && (
        <RestoreWizard
          key={`${wizard.item.id}-${wizard.token}`}
          item={wizard.item}
          initialReport={wizard.initialReport}
          activeRestore={activeRestore}
          onClose={() => setWizard(null)}
          onChanged={() => remote.reload()}
        />
      )}
    </>
  );
}

function SummaryCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card className="gap-0">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
          {label}
        </CardDescription>
        <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function CreateBackupDialog({
  open,
  onOpenChange,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    onError("");
    try {
      const result = await requestJson<{ id: string; filename: string }>("/api/admin/backups", { reason });
      onDone(`备份任务已创建（${result.filename}），正在后台导出并校验；完成后可下载。`);
      setReason("");
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={open => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建数据库备份</DialogTitle>
          <DialogDescription>
            使用 PostgreSQL 一致性快照导出自定义格式备份，结束后会校验文件。备份只包含数据库，不包含证明与附件文件。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backup-create-reason">备份理由</FieldLabel>
            <Textarea id="backup-create-reason" rows={3} maxLength={500} value={reason} placeholder="说明版本、变更或保存目的" onChange={event => setReason(event.target.value)} />
            <FieldDescription>理由会写入操作日志；备份卷按保留数量自动清理未保留的旧备份。</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || reason.trim().length < 2} onClick={() => void submit()}>
            {busy ? "正在创建…" : "开始备份"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadBackupDialog({
  open,
  onOpenChange,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");

  function reset() {
    setFile(null);
    setPassword("");
    setReason("");
    setProgress(0);
    setStage("");
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    onError("");
    setProgress(0);
    setStage("正在创建上传会话…");
    try {
      const session = await requestJson<{ uploadId: string; token: string; maxBytes: number }>("/api/admin/backups/upload-sessions", {
        filename: file.name,
        size: file.size,
        reason,
        password,
      });
      setStage("正在上传文件…");
      await putFile(`/api/admin/backups/upload-sessions/${session.uploadId}`, file, session.token, setProgress);
      setStage("正在校验备份格式与哈希…");
      await requestJson(`/api/admin/backups/upload-sessions/${session.uploadId}/complete`, {});
      onDone("备份已上传并完成格式校验，可在列表中用于恢复或下载。");
      reset();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={open => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>上传数据库备份</DialogTitle>
          <DialogDescription>
            仅接受由本系统生成或兼容的 PostgreSQL 自定义格式（.dump）文件，最大 2 GiB。上传后服务端会校验格式、大小与 SHA-256。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backup-upload-file">备份文件</FieldLabel>
            <Input
              id="backup-upload-file"
              type="file"
              accept=".dump,application/octet-stream"
              disabled={busy}
              onChange={event => setFile(event.target.files?.[0] ?? null)}
            />
            <FieldDescription>{file ? `${file.name} · ${bytesText(file.size)}` : "选择 .dump 文件；上传期间不要关闭页面。"}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="backup-upload-password">当前密码</FieldLabel>
            <Input id="backup-upload-password" type="password" autoComplete="current-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="backup-upload-reason">上传理由</FieldLabel>
            <Textarea id="backup-upload-reason" rows={2} maxLength={500} disabled={busy} value={reason} placeholder="说明备份来源、版本和用途" onChange={event => setReason(event.target.value)} />
          </Field>
          {busy && (
            <div className="space-y-1.5" role="status">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{stage}</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !file || !password || reason.trim().length < 2} onClick={() => void submit()}>
            {busy ? "正在上传…" : "开始上传"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DownloadDialog({
  item,
  onClose,
  onDone,
  onError,
}: {
  item: BackupItem | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!item) return;
    setBusy(true);
    onError("");
    try {
      const result = await requestJson<{ url: string; filename: string; size: number }>(`/api/admin/backups/${item.id}/download`, {
        password,
        reason,
      });
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      onDone("下载链接已生成，浏览器开始下载（2 分钟内有效）。请将备份存放在受控位置。");
      setPassword("");
      setReason("");
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={open => !busy && !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>下载数据库备份</DialogTitle>
          <DialogDescription className="space-y-1">
            {item ? (
              <>
                <span className="block font-mono text-xs [overflow-wrap:anywhere]">{item.filename}</span>
                <span className="block">{bytesText(item.bytes)}。下载会记录到操作日志，链接两分钟内有效。</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backup-download-password">当前密码</FieldLabel>
            <Input id="backup-download-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="backup-download-reason">下载理由</FieldLabel>
            <Textarea id="backup-download-reason" rows={3} maxLength={500} value={reason} placeholder="说明保存位置、用途和保管人" onChange={event => setReason(event.target.value)} />
            <FieldDescription>备份含全部业务数据，请勿通过公共渠道传输。</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button disabled={busy || !password || reason.trim().length < 2} onClick={() => void submit()}>
            {busy ? "正在生成…" : "确认下载"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  item,
  onClose,
  onDone,
  onError,
}: {
  item: BackupItem | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!item) return;
    setBusy(true);
    onError("");
    try {
      await requestJson(`/api/admin/backups/${item.id}`, { password, reason }, "DELETE");
      onDone(`已删除备份 ${item.filename}。删除记录已写入操作日志。`);
      setPassword("");
      setReason("");
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={open => !busy && !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>删除数据库备份</DialogTitle>
          <DialogDescription>
            {item ? `将永久删除 ${item.filename} 及其清单，无法在系统内恢复。` : ""}
            {item?.kind === "SAFETY" ? "该文件是恢复安全快照，删除前请确认已有其他可用备份。" : ""}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="backup-delete-password">当前密码</FieldLabel>
            <Input id="backup-delete-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="backup-delete-reason">删除理由</FieldLabel>
            <Textarea id="backup-delete-reason" rows={3} maxLength={500} value={reason} placeholder="说明删除原因及替代备份" onChange={event => setReason(event.target.value)} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy || !password || reason.trim().length < 2} onClick={() => void submit()}>
            {busy ? "正在删除…" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestoreWizard({
  item,
  initialReport,
  activeRestore,
  onClose,
  onChanged,
}: {
  item: BackupItem;
  initialReport: RestoreReport | null;
  activeRestore: ActiveRestore;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [report, setReport] = useState<RestoreReport | null>(initialReport);
  const [reason, setReason] = useState(initialReport ? "" : "");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");

  const activeForThis = Boolean(activeRestore && activeRestore.backupId === item.id && activeRestore.phase === "ready");
  const canConfirm = report?.status === "READY" && activeForThis;

  async function preflight() {
    setBusy(true);
    setError("");
    setStage("正在创建候选数据库并执行真实恢复预检，数据量较大时需要数分钟…");
    try {
      const result = await requestJson<{ ok: boolean; restoreId: string; report: RestoreReport }>(`/api/admin/backups/${item.id}/restore/preflight`, { reason });
      setReport(result.report);
      setStage("");
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!report) return;
    setBusy(true);
    setError("");
    setStage("正在校验数据库指纹并启动恢复任务…");
    try {
      await requestJson(`/api/admin/backups/${item.id}/restore`, {
        restoreId: report.restoreId,
        reason,
        password,
        confirmPhrase: phrase,
        acknowledged,
      });
      // Full page load is required here: the proxy answers client-side navigation with the 503 maintenance page.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/maintenance");
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
      setStage("");
    }
  }

  async function abort() {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/admin/backups/${item.id}/restore/abort`, { restoreId: report.restoreId, reason: abortReason });
      onChanged();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const tables = report
    ? Array.from(new Set([...Object.keys(report.data.current), ...Object.keys(report.data.restored)]))
    : [];

  return (
    <Dialog open onOpenChange={open => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-4xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>恢复数据库：{item.filename}</DialogTitle>
          <DialogDescription>
            {report
              ? "预检在候选库中真实执行 pg_restore 与迁移校验，不会修改当前数据库。确认后系统将进入维护模式，创建安全快照并原子替换数据库。"
              : "恢复使用整库替换，不合并记录。预检会创建一个独立候选数据库并真实执行恢复与结构校验。"}
          </DialogDescription>
        </DialogHeader>

        <Feedback error={error} />

        {!report && (
          <>
            <Alert>
              <ShieldAlert />
              <AlertTitle>恢复会覆盖当前业务数据</AlertTitle>
              <AlertDescription>
                恢复后账号密码、角色、组织、测评周期、活动、成绩与申报以备份内容为准；当前会话会被全部清除，所有账号需要重新登录。证明与活动附件文件不会回滚。
              </AlertDescription>
            </Alert>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="restore-preflight-reason">预检理由</FieldLabel>
                <Textarea
                  id="restore-preflight-reason"
                  rows={3}
                  maxLength={500}
                  disabled={busy}
                  value={reason}
                  placeholder="说明恢复原因、目标时点和变更审批信息"
                  onChange={event => setReason(event.target.value)}
                />
                <FieldDescription>预检会读取整个备份并写入候选库；候选库在确认或中止后清理。</FieldDescription>
              </Field>
            </FieldGroup>
            {busy && (
              <Alert>
                <Loader2 className="animate-spin" />
                <AlertTitle>正在预检</AlertTitle>
                <AlertDescription>{stage}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
              <Button disabled={busy || reason.trim().length < 2} onClick={() => void preflight()}>
                {busy ? "正在执行预检…" : "开始恢复预检"}
              </Button>
            </DialogFooter>
          </>
        )}

        {report && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {reportBadge(report.status)}
              <Badge variant="outline">{report.restoreMode}</Badge>
              <span className="text-xs text-muted-foreground">生成于 {dateTime(report.generatedAt)}</span>
            </div>

            {report.blockers.length > 0 && (
              <Alert variant="destructive">
                <XCircle />
                <AlertTitle>存在阻断项，不能执行恢复</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    {report.blockers.map(blocker => <li key={blocker.code}>{blocker.message}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {report.warnings.length > 0 && (
              <Alert>
                <ShieldAlert />
                <AlertTitle>恢复影响提示</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    {report.warnings.map(warning => <li key={warning}>{warning}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {report.errorCode && (
              <Alert variant="destructive">
                <XCircle />
                <AlertTitle>{report.errorCode}</AlertTitle>
                <AlertDescription>{report.message ?? "恢复任务未成功完成。"}</AlertDescription>
              </Alert>
            )}

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ReportFact label="备份文件" value={report.backupFilename} />
              <ReportFact label="备份时间" value={dateTime(report.backupCreatedAt)} />
              <ReportFact label="备份大小" value={bytesText(report.backupBytes)} />
              <ReportFact label="哈希校验" value={report.backupHashMatched ? "SHA-256 一致" : "未匹配"} />
              <ReportFact label="当前库大小" value={bytesText(report.data.currentDatabaseBytes)} />
              <ReportFact label="候选库大小" value={bytesText(report.data.candidateDatabaseBytes)} />
              <ReportFact label="迁移状态" value={`备份 ${report.migrations.backupCount} 个 · 本地 ${report.migrations.localCount} 个 · 需前向迁移 ${report.migrations.needsForwardMigration ? "是" : "否"}`} />
              <ReportFact label="迁移校验" value={report.migrations.checksumVerified ? "校验和一致" : "校验未通过"} />
              <ReportFact label="审计旁路" value={`备份后 ${report.audit.afterBackup} 条事件；切换前导出 ${report.audit.sidecarEvents} 条（${bytesText(report.audit.sidecarBytes)}）`} />
              <ReportFact label="管理员账号" value={report.admins.eligible ? `${report.admins.restored.length} 个可登录账号${report.admins.operatorPresent ? "，当前操作者在备份中" : "，当前操作者不在备份中"}` : "备份中没有可登录管理员"} />
              <ReportFact label="会话重置" value="恢复后清空登录会话、失败计数与验证码记录，并提升所有账号的认证版本" />
              <ReportFact label="磁盘需求" value={`至少 ${bytesText(report.disk.requiredBytes)}，当前剩余 ${bytesText(report.disk.freeBytes)}`} />
            </dl>

            {report.migrations.appliedNow.length > 0 && (
              <p className="text-sm text-muted-foreground">
                预检中已对候选库执行 {report.migrations.appliedNow.length} 个前向迁移：{report.migrations.appliedNow.join("、")}
              </p>
            )}

            <Separator />
            <section className="space-y-2">
              <h3 className="text-sm font-medium">关键数据行数对比</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-normal">数据表</th>
                      <th className="px-3 py-2 text-right font-normal">当前库</th>
                      <th className="px-3 py-2 text-right font-normal">恢复后</th>
                      <th className="px-3 py-2 text-right font-normal">变化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map(table => {
                      const current = report.data.current[table] ?? 0;
                      const restored = report.data.restored[table] ?? 0;
                      return (
                        <tr key={table} className="border-t">
                          <td className="px-3 py-2">{tableLabels[table] ?? table}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{current.toLocaleString("zh-CN")}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{restored.toLocaleString("zh-CN")}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${restored === current ? "text-muted-foreground" : restored > current ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                            {restored === current ? "—" : `${restored > current ? "+" : ""}${(restored - current).toLocaleString("zh-CN")}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                当前库 {report.data.currentTableCount} 张表，恢复后 {report.data.restoredTableCount} 张表。
                {report.data.structureMissing.length > 0 && ` 当前存在但备份中缺失的表：${report.data.structureMissing.map(row => row.name).join("、")}。`}
              </p>
            </section>

            <Separator />
            <section className="space-y-2">
              <h3 className="text-sm font-medium">文件一致性（不会随数据库恢复）</h3>
              <p className="text-sm text-muted-foreground">
                证明 {report.files.evidenceRows} 条、活动附件 {report.files.attachmentRows} 条；当前库中有 {report.files.currentEvidenceMissing} 条证明、{report.files.currentAttachmentMissing} 条附件在文件卷中缺失。
                恢复后预计缺失：证明 {report.files.restoredEvidenceMissing} 条、附件 {report.files.restoredAttachmentMissing} 条。
              </p>
            </section>

            <Separator />
            {canConfirm ? (
              <section className="space-y-3">
                <h3 className="text-sm font-medium">确认执行整库恢复</h3>
                <Alert>
                  <ShieldAlert />
                  <AlertTitle>确认后立即进入维护模式</AlertTitle>
                  <AlertDescription>
                    系统会先创建安全快照，再切换数据库。若切换或校验失败会自动回滚。执行期间所有用户无法访问业务页面。
                  </AlertDescription>
                </Alert>
                {!report.admins.operatorPresent && (
                  <Alert variant="destructive">
                    <XCircle />
                    <AlertTitle>当前管理员账号不在备份中</AlertTitle>
                    <AlertDescription>恢复后当前账号可能无法登录，必须使用备份内的管理员账号。</AlertDescription>
                  </Alert>
                )}
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="restore-confirm-reason">恢复理由</FieldLabel>
                    <Textarea id="restore-confirm-reason" rows={2} maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} placeholder="填写审批单号或恢复原因" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="restore-confirm-password">当前密码</FieldLabel>
                    <Input id="restore-confirm-password" type="password" autoComplete="current-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="restore-confirm-phrase">确认短语</FieldLabel>
                    <Input id="restore-confirm-phrase" disabled={busy} value={phrase} placeholder="请输入：替换数据库" onChange={event => setPhrase(event.target.value)} />
                  </Field>
                  <Field orientation="horizontal">
                    <Switch id="restore-confirm-ack" checked={acknowledged} disabled={busy} onCheckedChange={setAcknowledged} />
                    <FieldLabel htmlFor="restore-confirm-ack">我已阅读影响说明，确认用该备份替换当前数据库</FieldLabel>
                  </Field>
                </FieldGroup>
                {busy && (
                  <p className="text-sm text-muted-foreground" role="status">
                    <Loader2 className="mr-1 inline animate-spin" />
                    {stage}
                  </p>
                )}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => setAbortOpen(true)}>中止预检并清理候选库</Button>
                  <Button
                    variant="destructive"
                    disabled={busy || !acknowledged || !password || reason.trim().length < 2 || phrase !== "替换数据库"}
                    onClick={() => void confirm()}
                  >
                    {busy ? "正在启动恢复…" : "执行整库恢复"}
                  </Button>
                </div>
                {abortOpen && (
                  <div className="rounded-lg border p-3">
                    <Field>
                      <FieldLabel htmlFor="restore-abort-reason">中止理由</FieldLabel>
                      <Textarea id="restore-abort-reason" rows={2} maxLength={500} value={abortReason} onChange={event => setAbortReason(event.target.value)} />
                    </Field>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setAbortOpen(false)}>返回</Button>
                      <Button size="sm" variant="destructive" disabled={busy || abortReason.trim().length < 2} onClick={() => void abort()}>确认中止</Button>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <DialogFooter>
                <Button variant="outline" onClick={onClose}>关闭</Button>
                {canConfirm && (
                  <Button variant="destructive" onClick={() => setAbortOpen(true)}>中止预检</Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
