"use client";
// Searchable multi-select built on the template popover, checkbox and filter-menu
// patterns. Used where college/class lists can grow long.
import { useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

export type SearchableMultiSelectOption = {
	value: string;
	label: string;
	description?: string;
	disabled?: boolean;
};

export function SearchableMultiSelect({
	label,
	options,
	selected,
	onToggle,
	disabled,
	triggerLabel,
	emptyLabel = "没有匹配项",
}: {
	label: string;
	options: SearchableMultiSelectOption[];
	selected: string[];
	onToggle: (value: string) => void;
	disabled?: boolean;
	triggerLabel?: string;
	emptyLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const needle = query.trim().toLocaleLowerCase();
	const filtered = needle
		? options.filter((option) =>
				`${option.label} ${option.description ?? ""}`
					.toLocaleLowerCase()
					.includes(needle),
			)
		: options;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						className="w-full justify-between"
					/>
				}
			>
				<span className="flex min-w-0 items-center gap-2">
					<ListFilter data-icon="inline-start" />
					<span className="truncate">
						{triggerLabel ?? `${label} · 已选 ${selected.length} 项`}
					</span>
				</span>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(34rem,90vw)] p-0">
				<div className="flex items-center gap-2 border-b p-2">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<Input
						autoFocus
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={`搜索${label}`}
						className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
					/>
				</div>
				<ScrollArea className="h-72">
					<div className="flex flex-col gap-0.5 p-1">
						{filtered.map((option) => (
							<label
								key={option.value}
								className={
									option.disabled
										? "flex cursor-not-allowed items-start gap-2 rounded-md px-2 py-1.5 text-sm opacity-50 max-md:min-h-11"
										: "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11"
								}
							>
								<Checkbox
									className="mt-0.5"
									disabled={option.disabled}
									checked={selected.includes(option.value)}
									onCheckedChange={() => onToggle(option.value)}
								/>
								<span className="min-w-0">
									<span className="block break-words">{option.label}</span>
									{option.description && (
										<span className="block text-xs text-muted-foreground">
											{option.description}
										</span>
									)}
								</span>
							</label>
						))}
						{!filtered.length && (
							<p className="px-2 py-6 text-center text-sm text-muted-foreground">
								{emptyLabel}
							</p>
						)}
					</div>
				</ScrollArea>
				<div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
					<span>
						{filtered.length} / {options.length} 项
					</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setOpen(false)}
					>
						完成
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
