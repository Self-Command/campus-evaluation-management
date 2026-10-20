"use client";
// Adapted from dashboard/users/_components/users.tsx and users-table.tsx in the selected MIT template.
import type { ReactNode } from "react";
import type { ColumnDef, RowData } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Search, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { DataTable } from "./data-table";
export function TemplateDirectory<T extends RowData>({
  title,
  description,
  actions,
  filters,
  search,
  data,
  columns,
  mobile,
  pagination,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  filters?: ReactNode;
  search?: { action: string; query: string; placeholder: string; hidden?: Record<string, string> };
  data: T[];
  columns: ColumnDef<DataTableFeatures, T>[];
  mobile?: (row: T) => ReactNode;
  pagination?: { page: number; total: number; href: (page: number) => string; onPageChange?: (page: number) => void };
}) {
  const router = useRouter();
  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader className="border-b has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[1fr_auto]">
        <CardTitle className="text-xl leading-none">{title}</CardTitle>
        <CardDescription className="max-w-sm leading-snug">{description}</CardDescription>
        <CardAction className="col-start-1 row-start-auto flex w-full flex-wrap justify-start gap-2 justify-self-stretch md:col-start-2 md:row-span-2 md:row-start-1 md:w-auto md:justify-end md:justify-self-end">
          {search && (
            <form action={search.action} className="flex w-full min-w-0 gap-2 md:w-auto">
              {Object.entries(search.hidden || {}).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <InputGroup className="min-w-0 flex-1 md:w-64">
                <InputGroupAddon align="inline-start">
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  name="q"
                  placeholder={search.placeholder}
                  aria-label={search.placeholder}
                  defaultValue={search.query}
                />
              </InputGroup>
              <Button variant="outline" type="submit">
                搜索
              </Button>
            </form>
          )}
          {actions}
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4 px-0">
        {filters && <div className="flex flex-wrap items-center justify-between gap-3 px-4">{filters}</div>}
        <DataTable data={data} columns={columns} mobile={mobile} />
        {pagination && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3 px-4">
              <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-sm">
                <span>每页20条</span>
                <span>
                  第 {pagination.page} / {Math.max(1, Math.ceil(pagination.total / 20))} 页 · 共 {pagination.total} 条
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() =>
                    pagination.onPageChange
                      ? pagination.onPageChange(pagination.page - 1)
                      : router.push(pagination.href(pagination.page - 1))
                  }
                >
                  <ArrowLeft data-icon="inline-start" />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page * 20 >= pagination.total}
                  onClick={() =>
                    pagination.onPageChange
                      ? pagination.onPageChange(pagination.page + 1)
                      : router.push(pagination.href(pagination.page + 1))
                  }
                >
                  下一页
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
