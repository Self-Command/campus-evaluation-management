"use client";
// Adapted from complete dashboard/users/_components/users.tsx and users-table.tsx.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "./template-directory";
import { useRemote } from "./use-remote";
import { RemoteState } from "./remote-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "./searchable-select";
import { dateText } from "@/lib/business-labels";
type Student = {
  id: string;
  login: string;
  name: string;
  college: string;
  major: string;
  className: string;
  total: string | null;
  complete: boolean | null;
  confirmedAt: string | null;
};
export function StudentDirectory({
  termId,
  onSelect,
  busy = false,
  actions,
  selectLabel = "读取成绩",
}: {
  termId: string;
  onSelect?: (login: string) => void;
  busy?: boolean;
  actions?: ReactNode;
  selectLabel?: string;
}) {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [draft, setDraft] = useState(query);
  const [page, setPage] = useState(Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1))));
  const [scope, setScope] = useState({
    college: params.get("college") || "",
    major: params.get("major") || "",
    className: params.get("className") || "",
  });
  const [draftScope, setDraftScope] = useState(scope);
  const remote = useRemote<{
    items: Student[];
    total: number;
    page: number;
    phase: string;
    scopeOptions: { colleges: string[]; majors: string[]; classes: string[] };
    publication: { id: string; sequence: number } | null;
  }>(`/api/results/students?${new URLSearchParams({ termId, q: query, ...scope, page: String(page) })}`);
  const resultHref = (login: string) =>
    `/results?${new URLSearchParams({ termId, tab: "results", login, q: query, ...scope, page: String(page) })}`;
  const action = (row: Student) =>
    onSelect ? (
      <Button variant="outline" size="sm" disabled={busy} onClick={() => onSelect(row.login)}>
        {selectLabel}
      </Button>
    ) : row.complete === null ? (
      <Link href={`/terms/${termId}?tab=scheme`} className={buttonVariants({ variant: "outline", size: "sm" })}>
        配置评分方案
      </Link>
    ) : (
      <Link href={resultHref(row.login)} className={buttonVariants({ variant: "outline", size: "sm" })}>
        查看结果
      </Link>
    );
  const columns: ColumnDef<DataTableFeatures, Student>[] = [
    {
      accessorKey: "name",
      header: "学生",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.login}</p>
        </div>
      ),
    },
    { accessorKey: "college", header: "学院" },
    { accessorKey: "major", header: "专业" },
    { accessorKey: "className", header: "班级" },
    {
      accessorKey: "total",
      header: "综合成绩",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.total ?? (row.original.complete === null ? "未计算" : "未完成")}
        </span>
      ),
    },
    {
      id: "status",
      header: "确认状态",
      cell: ({ row }) => (
        <Badge variant="outline">
          {row.original.confirmedAt
            ? "已确认"
            : row.original.complete === null
              ? "未生效"
              : row.original.complete
                ? "成绩完整"
                : "成绩未录完"}
        </Badge>
      ),
    },
    { id: "actions", header: "操作", cell: ({ row }) => action(row.original) },
  ];
  return (
    <>
      <RemoteState {...remote} />
      {remote.data && (
        <TemplateDirectory
          description={`共 ${remote.data.total} 位学生。${remote.data.publication ? `已发布第 ${remote.data.publication.sequence} 版，显示发布时的成绩。` : remote.data.phase === "CONFIGURATION" ? "评分方案配置中，暂时没有成绩。" : "显示本周期当前成绩，未录入和零分分开记录。"}`}
          data={remote.data.items}
          columns={columns}
          actions={actions}
          filters={
            <form
              className="flex w-full flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(draft.trim());
                setScope(draftScope);
                setPage(1);
              }}
            >
              <Field className="w-full sm:w-80">
                <FieldLabel htmlFor="student-directory-search">姓名或学号</FieldLabel>
                <Input
                  id="student-directory-search"
                  value={draft}
                  maxLength={80}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="搜索学生姓名或学号"
                />
              </Field>
              {(
                [
                  ["college", "学院", "colleges"],
                  ["major", "专业", "majors"],
                  ["className", "班级", "classes"],
                ] as const
              ).map(([key, label, options]) => (
                <Field key={key} className="w-full sm:w-44">
                  <FieldLabel htmlFor={`student-scope-${key}`}>{label}</FieldLabel>
                  <SearchableSelect
                    id={`student-scope-${key}`}
                    value={draftScope[key]}
                    onValueChange={(value) => {
                      const next = {
                        ...draftScope,
                        [key]: value,
                        ...(key === "college"
                          ? { major: "", className: "" }
                          : key === "major"
                            ? { className: "" }
                            : {}),
                      };
                      setDraftScope(next);
                      setScope(next);
                      setQuery(draft.trim());
                      setPage(1);
                    }}
                    placeholder={`全部${label}`}
                    searchPlaceholder={`搜索${label}`}
                    options={remote.data!.scopeOptions[options].map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Field>
              ))}
              <Button type="submit" variant="outline" disabled={busy}>
                搜索学生
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft("");
                  setQuery("");
                  setScope({ college: "", major: "", className: "" });
                  setDraftScope({ college: "", major: "", className: "" });
                  setPage(1);
                }}
              >
                重置筛选
              </Button>
            </form>
          }
          pagination={{
            page: remote.data.page,
            total: remote.data.total,
            href: (next) => `?${new URLSearchParams({ termId, q: query, ...scope, page: String(next) })}`,
            onPageChange: setPage,
          }}
          mobile={(row) => (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.login}</p>
                </div>
                <span className="tabular-nums">{row.total ?? (row.complete === null ? "方案配置中" : "待补齐")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {row.college} · {row.major} · {row.className}
              </p>
              {row.confirmedAt && <p className="text-xs text-muted-foreground">确认于 {dateText(row.confirmedAt)}</p>}
              {action(row)}
            </div>
          )}
        />
      )}
    </>
  );
}
