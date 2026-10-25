"use client";
// Searchable single-select built on the template popover and command-list
// patterns. Use for organization, module and other lists that can grow long.
import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableOption = {
	value: string;
	label: string;
	description?: string;
	disabled?: boolean;
};

export function SearchableSelect({
	id,
	name,
	options,
	value: controlledValue,
	defaultValue = "",
	onValueChange,
	placeholder = "请选择",
	searchPlaceholder = "输入关键词搜索",
	disabled,
	required,
	className,
	emptyLabel = "没有匹配项",
}: {
	id?: string;
	name?: string;
	options: SearchableOption[];
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	placeholder?: string;
	searchPlaceholder?: string;
	disabled?: boolean;
	required?: boolean;
	className?: string;
	emptyLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const [internal, setInternal] = useState(defaultValue);
	const [query, setQuery] = useState("");
	const value = controlledValue === undefined ? internal : controlledValue;
	const selected = options.find((option) => option.value === value);
	const needle = query.trim().toLocaleLowerCase();
	const filtered = needle
		? options.filter((option) =>
				`${option.label} ${option.description ?? ""}`
					.toLocaleLowerCase()
					.includes(needle),
			)
		: options;
	function choose(next: string) {
		if (controlledValue === undefined) setInternal(next);
		onValueChange?.(next);
		setOpen(false);
		setQuery("");
	}
	return (
		<>
			{(name || required) && (
				<select
					name={name}
					value={value}
					required={required}
					disabled={disabled}
					onChange={(event) => choose(event.target.value)}
					className="sr-only"
					tabIndex={-1}
					aria-label={placeholder}
				>
					<option value="">{placeholder}</option>
					{options.map((option) => (
						<option
							key={option.value}
							value={option.value}
							disabled={option.disabled}
						>
							{option.label}
						</option>
					))}
				</select>
			)}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={
						<Button
							id={id}
							type="button"
							variant="outline"
							disabled={disabled}
							className={cn(
								"h-9 w-full justify-between px-3 font-normal",
								className,
							)}
						/>
					}
				>
					<span
						className={cn(
							"min-w-0 truncate text-left",
							!selected && "text-muted-foreground",
						)}
					>
						{selected?.label || placeholder}
					</span>
					<ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[min(34rem,90vw)] p-0">
					<div className="flex items-center gap-2 border-b p-2">
						<Search className="size-4 shrink-0 text-muted-foreground" />
						<Input
							autoFocus
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={searchPlaceholder}
							className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
						/>
					</div>
					<ScrollArea className="h-72">
						<div className="flex flex-col gap-0.5 p-1">
							{filtered.map((option) => (
								<button
									key={option.value}
									type="button"
									disabled={option.disabled}
									onClick={() => choose(option.value)}
									className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent max-md:min-h-11"
								>
									<Check
										className={cn(
											"mt-0.5 size-4 shrink-0",
											option.value === value ? "opacity-100" : "opacity-0",
										)}
									/>
									<span className="min-w-0">
										<span className="block break-words">{option.label}</span>
										{option.description && (
											<span className="block text-xs text-muted-foreground">
												{option.description}
											</span>
										)}
									</span>
								</button>
							))}
							{!filtered.length && (
								<p className="px-2 py-6 text-center text-sm text-muted-foreground">
									{emptyLabel}
								</p>
							)}
						</div>
					</ScrollArea>
					<div className="border-t px-3 py-2 text-xs text-muted-foreground">
						{filtered.length} / {options.length} 项
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}
