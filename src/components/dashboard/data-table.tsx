"use client";
import { type ColumnDef, type RowData, useTable } from "@tanstack/react-table";
import { dataTableFeatures, type DataTableFeatures } from "@/lib/data-table-features";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { NoData } from "./page-heading";
// Adapted from Studio Admin's users table. Paging/filtering is performed by the server.
export function DataTable<T extends RowData>({
  data,
  columns,
  mobile,
  empty,
}: {
  data: T[];
  columns: ColumnDef<DataTableFeatures, T>[];
  mobile?: (row: T) => React.ReactNode;
  empty?: { title: string; description: string };
}) {
  const table = useTable({ features: dataTableFeatures, data, columns, manualPagination: true });
  if (!data.length)
    return (
      <NoData
        title={empty?.title ?? "没有匹配的记录"}
        description={empty?.description ?? "请调整筛选条件，或添加新的业务记录。"}
      />
    );
  return (
    <>
      {mobile && (
        <div className="flex min-w-0 flex-col divide-y break-words md:hidden">
          {data.map((row, index) => (
            <div key={index} className="min-w-0 p-4">
              {mobile(row)}
            </div>
          ))}
        </div>
      )}
      <div className={mobile ? "hidden min-w-0 max-w-full md:block" : "min-w-0 max-w-full"}>
        <Table className="**:data-[slot=table-cell]:px-4 **:data-[slot=table-head]:px-4">
          <TableHeader className="[&_tr]:border-t">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} className="py-4 font-normal">
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="border-border/60">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-3 py-4 align-middle">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
