"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { SearchableMultiSelect } from "@/components/dashboard/searchable-multi-select";
import { MAX_EXPORT_COLLEGES, MAX_EXPORT_STUDENTS, MAX_EXPORT_STUDENTS_TEXT } from "@/lib/export-limits";

type ScopeClass = { id: string; name: string; major: string; college: string; collegeId: string; studentCount: number };
type ScopeCollege = { id: string; name: string; classCount: number; studentCount: number };
type ExportScope = {
	classes: ScopeClass[];
	colleges: ScopeCollege[];
	published: boolean;
	batchLabel: string;
	phase: string;
};

export function GradeExportDialog({
	termId,
	role,
	scope,
}: {
	termId: string;
	role: "ADMIN" | "COLLEGE" | "COUNSELOR";
	scope: ExportScope;
}) {
	const [open, setOpen] = useState(false);
	const [selectedColleges, setSelectedColleges] = useState<string[]>([]);
	const isAdmin = role === "ADMIN";
	const narrowed = isAdmin && selectedColleges.length > 0;
	const selectedSet = new Set(selectedColleges);
	const visibleClasses = narrowed
		? scope.classes.filter((item) => selectedSet.has(item.collegeId))
		: scope.classes;
	const visibleColleges = narrowed
		? scope.colleges.filter((item) => selectedSet.has(item.id))
		: scope.colleges;
	const total = isAdmin
		? visibleColleges.reduce((sum, item) => sum + item.studentCount, 0)
		: visibleClasses.reduce((sum, item) => sum + item.studentCount, 0);
	const overLimit = total > MAX_EXPORT_STUDENTS;
	const snapshot = role === "ADMIN" ? "school" : role === "COLLEGE" ? "college" : "counselor";
	const params = new URLSearchParams({ termId, scope: snapshot });
	if (narrowed) for (const collegeId of selectedColleges) params.append("collegeId", collegeId);
	const href = `/api/grades/export?${params}`;
	const rangeText = isAdmin
		? narrowed
			? `所选 ${selectedColleges.length} 个学院`
			: `全校 ${scope.colleges.length} 个学院`
		: role === "COLLEGE"
			? `本院 ${scope.classes.length} 个班级`
			: `本人负责的 ${scope.classes.length} 个班级`;
	const limitHint = isAdmin
		? narrowed
			? "请取消部分学院后导出"
			: "请选择部分学院后导出"
		: "请按班级分批导出";
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger className={buttonVariants({ variant: "outline" })}>导出成绩明细表</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>导出综合素质测评成绩明细表</DialogTitle>
					<DialogDescription>
						{scope.published
							? `按当前权限导出${rangeText}。统一明细表按学院、专业、班级、学号排序；正式发布快照保留公式和“评分规则”，录入项与参数已锁定，白色单元格显示发布时结果。`
							: `按当前权限导出${rangeText}。统一明细表按学院、专业、班级、学号排序；成绩明细保留公式，黄色单元格为录入项，修改后小计、比例分、扣分和总分自动重算。`}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
						<Badge variant={scope.published ? "default" : "secondary"}>
							{scope.published ? "正式发布快照" : "当前周期"}
						</Badge>
						<span className="text-sm text-muted-foreground">{scope.batchLabel}</span>
					</div>
					{isAdmin && (
						<Field>
							<FieldLabel>导出学院</FieldLabel>
							<SearchableMultiSelect
								label="学院"
								triggerLabel={
									selectedColleges.length
										? `已选 ${selectedColleges.length} 个学院`
										: "全部学院（默认导出全校）"
								}
								options={scope.colleges.map((item) => ({
									value: item.id,
									label: item.name,
									description: `${item.classCount} 个班级 · ${item.studentCount} 名学生`,
									disabled:
										!selectedColleges.includes(item.id) &&
										selectedColleges.length >= MAX_EXPORT_COLLEGES,
								}))}
								selected={selectedColleges}
								onToggle={(value) =>
									setSelectedColleges((current) => {
										if (current.includes(value)) return current.filter((item) => item !== value);
										if (current.length >= MAX_EXPORT_COLLEGES) return current;
										return [...current, value];
									})
								}
								emptyLabel="没有匹配的学院"
							/>
							<FieldDescription>
								不选择学院时导出全校；可搜索并多选学院。单次最多导出 {MAX_EXPORT_STUDENTS_TEXT} 名学生。
								{scope.colleges.length > MAX_EXPORT_COLLEGES && ` 单次最多选择 ${MAX_EXPORT_COLLEGES} 个学院。`}
							</FieldDescription>
						</Field>
					)}
					<div className="rounded-lg border">
						<div className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm">
							<span className="font-medium">导出范围</span>
							<span className="text-muted-foreground">共 {total} 名学生</span>
						</div>
						<div className="max-h-64 overflow-y-auto">
							{isAdmin
								? visibleColleges.map((item) => (
										<div key={item.id} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0">
											<div>
												<p className="font-medium">{item.name}</p>
												<p className="text-xs text-muted-foreground">
													{item.classCount} 个班级 · {item.studentCount} 名学生
												</p>
											</div>
											<Badge variant={narrowed ? "default" : "outline"}>
												{narrowed ? "已选" : "全校"}
											</Badge>
										</div>
									))
								: scope.classes.map((item) => (
										<div key={item.id} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0">
											<div>
												<p className="font-medium">{item.college} · {item.major} · {item.name}</p>
												<p className="text-xs text-muted-foreground">{item.studentCount} 名学生</p>
											</div>
											<Badge variant="outline">{role === "COLLEGE" ? "本院" : "负责班级"}</Badge>
										</div>
									))}
						</div>
					</div>
					{overLimit && (
						<p className="text-sm text-destructive" role="alert">
							当前范围共 {total} 名学生，超过单次 {MAX_EXPORT_STUDENTS_TEXT} 人上限，{limitHint}。
						</p>
					)}
					{!scope.published && (
						<p className="text-sm text-muted-foreground">
							当前周期尚未发布，导出内容为当前阶段明细；正式发布后请重新导出，以正式发布快照为准。
						</p>
					)}
					<Separator />
					<p className="text-xs text-muted-foreground">
						{scope.published
							? "导出的“成绩明细”为正式发布快照：公式与“评分规则”均保留，但录入项和参数已锁定；如需调整，请按异议或更正流程处理。"
							: "导出的“成绩明细”中，黄色单元格为成绩或扣分录入项，白色单元格由公式自动计算；“评分规则”为单独工作表，可调整参数后查看公式重算。请勿把当前阶段明细当作正式发布结果使用。"}
					</p>
				</div>
				<DialogFooter>
					{overLimit ? (
						<Button disabled>导出范围超过 {MAX_EXPORT_STUDENTS_TEXT} 人</Button>
					) : (
						<a href={href} className={buttonVariants()} onClick={() => setOpen(false)}>
							下载工作簿
						</a>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
