"use client";
import { useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { buttonVariants, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
type Ranked = {
  studentId?: string;
  id?: string;
  name: string;
  login: string;
  college: string;
  major: string;
  className: string;
  rank: number | null;
  displayTotal?: string;
  total?: string;
};
type Filters = { publicationId: string; college: string; major: string; className: string; page: number };
export function Rankings({ termId, filters }: { termId: string; filters: Filters }) {
  const path = usePathname();
  const router = useRouter();
  const tab = useSearchParams().get("tab") || (path.startsWith("/terms/") ? "rankings" : "");
  const [college, setCollege] = useState(filters.college);
  const [major, setMajor] = useState(filters.major);
  const [className, setClassName] = useState(filters.className);
  const query = new URLSearchParams({
    termId,
    publicationId: filters.publicationId,
    college: filters.college,
    major: filters.major,
    className: filters.className,
    page: String(filters.page),
  });
  const remote = useRemote<{
    items: Ranked[];
    total: number;
    page: number;
    publication: { id: string; sequence: number };
    scopeOptions: { colleges: string[]; majors: string[]; classes: string[] };
  }>(`/api/rankings?${query}`);
  const columns: ColumnDef<DataTableFeatures, Ranked>[] = [
    {
      accessorKey: "rank",
      header: "名次",
      cell: ({ row }) => <Badge variant="outline">{row.original.rank ?? "无名次"}</Badge>,
    },
    { accessorKey: "name", header: "姓名" },
    { accessorKey: "login", header: "学号" },
    { accessorKey: "college", header: "学院" },
    { accessorKey: "major", header: "专业" },
    { accessorKey: "className", header: "班级" },
    {
      id: "score",
      header: "综合成绩",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.displayTotal ?? row.original.total ?? "未完成"}</span>
      ),
    },
  ];
  return (
    <>
      <RemoteState {...remote} />
      {remote.data && (
        <TemplateDirectory
          title={`第 ${remote.data.publication.sequence} 版排名`}
          description={`共 ${remote.data.total} 位学生。同分并列，后续名次按人数顺延。`}
          data={remote.data.items}
          columns={columns}
          actions={
            <a
              href={`/api/rankings/export?${new URLSearchParams({ termId, publicationId: remote.data.publication.id })}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              导出全校成绩明细表
            </a>
          }
          filters={
            <form action={path} className="flex w-full flex-wrap items-end gap-3">
              <input type="hidden" name="termId" value={termId} />
              {tab && <input type="hidden" name="tab" value={tab} />}
              <input type="hidden" name="publicationId" value={remote.data.publication.id} />
              {[
                {
                  key: "college",
                  label: "学院",
                  value: college,
                  options: remote.data.scopeOptions.colleges,
                  onChange: (value: string) => {
                    setCollege(value);
                    setMajor("");
                    setClassName("");
                    const next = new URLSearchParams(query);
                    next.set("college", value);
                    next.delete("major");
                    next.delete("className");
                    next.set("page", "1");
                    if (tab) next.set("tab", tab);
                    router.push(`${path}?${next}`);
                  },
                },
                {
                  key: "major",
                  label: "专业",
                  value: major,
                  options: remote.data.scopeOptions.majors,
                  onChange: (value: string) => {
                    setMajor(value);
                    setClassName("");
                    const next = new URLSearchParams(query);
                    next.set("college", college);
                    next.set("major", value);
                    next.delete("className");
                    next.set("page", "1");
                    if (tab) next.set("tab", tab);
                    router.push(`${path}?${next}`);
                  },
                },
                {
                  key: "className",
                  label: "班级",
                  value: className,
                  options: remote.data.scopeOptions.classes,
                  onChange: setClassName,
                },
              ].map((field) => (
                <Field key={field.key} className="w-full sm:w-44">
                  <FieldLabel htmlFor={`rank-${field.key}`}>{field.label}</FieldLabel>
                  <SearchableSelect
                    id={`rank-${field.key}`}
                    name={field.key}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder={`全部${field.label}`}
                    searchPlaceholder={`搜索${field.label}`}
                    options={field.options.map((value) => ({ value, label: value }))}
                  />
                </Field>
              ))}
              <Button type="submit" variant="outline">搜索</Button>
            </form>
          }
          pagination={{
            page: remote.data.page,
            total: remote.data.total,
            href: (page) => {
              const next = new URLSearchParams(query);
              next.set("page", String(page));
              if (tab) next.set("tab", tab);
              return `${path}?${next}`;
            },
          }}
          mobile={(row) => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.login}</p>
                </div>
                <Badge variant="outline">第 {row.rank ?? "—"} 名</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {row.college} · {row.major} · {row.className}
              </p>
              <p className="text-lg tabular-nums">{row.displayTotal ?? row.total ?? "待补齐"} 分</p>
            </div>
          )}
        />
      )}
    </>
  );
}
