// Plain-text excerpt for list cards; detail pages render Markdown instead.
export function markdownExcerpt(markdown: string, length = 160) {
	const text = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[#>*_`~|-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > length ? `${text.slice(0, length)}…` : text;
}
