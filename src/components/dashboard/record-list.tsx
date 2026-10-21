"use client";
// Adapted from the selected dashboard template's users directory table and pagination.
import { useState, type ReactNode } from "react";
import type { ColumnDef, RowData } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { DataTable } from "./data-table";
import { NoData } from "./page-heading";

const PAGE_SIZE = 20;

export type RecordListTab<T> = {
	value: string;
	label: ReactNode;
	match: (row: T) => boolean;
};

export function RecordList<T extends RowData>({
	data,
	columns,
	mobile,
	searchText,
	searchPlaceholder = "按姓名或学号搜索",
	tabs,
	emptyTitle = "没有匹配的记录",
	emptyDescription = "请调整搜索或筛选条件。",
	tableClassName = "max-h-96",
}: {
	data: T[];
	columns: ColumnDef<DataTableFeatures, T>[];
	mobile?: (row: T) => ReactNode;
	searchText: (row: T) => string;
	searchPlaceholder?: string;
	tabs?: RecordListTab<T>[];
	emptyTitle?: string;
	emptyDescription?: string;
	tableClassName?: string;
}) {
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [tab, setTab] = useState(tabs?.[0]?.value || "");
	const activeTab = tabs?.find((item) => item.value === tab) ?? tabs?.[0];
	const keyword = query.trim().toLocaleLowerCase();
	const filtered = data.filter(
		(row) =>
			(!activeTab || activeTab.match(row)) &&
			(!keyword || searchText(row).toLocaleLowerCase().includes(keyword)),
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount);
	const pageRows = filtered.slice(
		(currentPage - 1) * PAGE_SIZE,
		currentPage * PAGE_SIZE,
	);
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<InputGroup className="min-w-0 md:w-80">
					<InputGroupAddon align="inline-start">
						<Search />
					</InputGroupAddon>
					<InputGroupInput
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setPage(1);
						}}
						placeholder={searchPlaceholder}
						aria-label={searchPlaceholder}
					/>
				</InputGroup>
				<p className="text-sm text-muted-foreground">
					共 {filtered.length} 条
				</p>
			</div>
			{tabs && tabs.length > 1 && (
				<Tabs
					value={activeTab?.value || ""}
					onValueChange={(value) => {
						setTab(value);
						setPage(1);
					}}
				>
					<TabsList className="w-full">
						{tabs.map((item) => (
							<TabsTrigger key={item.value} value={item.value}>
								{item.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			)}
			{pageRows.length ? (
				<div className={`min-w-0 overflow-auto ${tableClassName}`}>
					<DataTable data={pageRows} columns={columns} mobile={mobile} />
				</div>
			) : (
				<NoData title={emptyTitle} description={emptyDescription} />
			)}
			<Separator />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-muted-foreground">
					每页 {PAGE_SIZE} 条 · 第 {currentPage} / {pageCount} 页
				</p>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={currentPage <= 1}
						onClick={() => setPage(currentPage - 1)}
					>
						<ArrowLeft data-icon="inline-start" />
						上一页
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={currentPage >= pageCount}
						onClick={() => setPage(currentPage + 1)}
					>
						下一页
						<ArrowRight data-icon="inline-end" />
					</Button>
				</div>
			</div>
		</div>
	);
}
