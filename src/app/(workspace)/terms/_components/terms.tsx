"use client";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, ArrowUpRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { phaseLabels, dateText } from "@/lib/business-labels";
export function Terms({
  terms,
  admin,
  create = false,
}: {
  terms: {
    id: string;
    name: string;
    phase: string;
    revision: number;
    createdAt: string;
    scheme: { nodes: unknown[] };
  }[];
  admin: boolean;
  create?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(create && admin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const columns: ColumnDef<DataTableFeatures, (typeof terms)[number]>[] = [
    {
      accessorKey: "name",
      header: "测评周期",
      cell: ({ row }) => (
        <Link href={`/terms/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: "phase",
      header: "阶段",
      cell: ({ row }) => <Badge variant="outline">{phaseLabels[row.original.phase]}</Badge>,
    },
    { id: "nodes", header: "评分模块", cell: ({ row }) => `${row.original.scheme.nodes.length} 个` },
    { accessorKey: "revision", header: "方案修订" },
    { accessorKey: "createdAt", header: "创建时间", cell: ({ row }) => dateText(row.original.createdAt) },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <Link href={`/terms/${row.original.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          进入周期
        </Link>
      ),
    },
  ];
  return (
    <>
      <TemplateDirectory
        title="测评周期"
        description={`共 ${terms.length} 个周期。每周期使用一套评分方案。`}
        data={terms}
        columns={columns}
        actions={
          admin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus data-icon="inline-start" />
              新建周期
            </Button>
          ) : undefined
        }
        mobile={(term) => (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between gap-2">
              <p className="font-medium">{term.name}</p>
              <Badge variant="outline">{phaseLabels[term.phase]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {term.scheme.nodes.length} 个评分模块 · 方案修订 {term.revision}
            </p>
            <Link
              href={`/terms/${term.id}`}
              className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
            >
              进入周期工作区
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </div>
        )}
      />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建测评周期</DialogTitle>
            <DialogDescription>创建后先配置评分方案，确认无误再开启申报。</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const term = await requestJson<{ id: string }>("/api/terms", {
                  name: f.get("name"),
                  template: f.get("template") === "school",
                });
                router.push(`/terms/${term.id}`);
              } catch (err) {
                setError((err as Error).message);
                setBusy(false);
              }
            }}
          >
            <Feedback error={error} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="term-name">周期名称</FieldLabel>
                <Input id="term-name" name="name" required maxLength={80} placeholder="例如：2026—2027学年第一学期" />
              </Field>
              <Field>
                <FieldLabel htmlFor="term-template">初始评分方案</FieldLabel>
                <NativeSelect id="term-template" name="template">
                  <NativeSelectOption value="blank">空白方案（自行配置）</NativeSelectOption>
                  <NativeSelectOption value="school">学校制度样例（需按实际制度调整）</NativeSelectOption>
                </NativeSelect>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={busy}>
              {busy ? "正在创建…" : "创建并配置"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
