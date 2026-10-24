import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";

export function MarkdownContent({ markdown, className = "" }: { markdown: string; className?: string }) {
	return (
		<div
			className={[
				"min-w-0 break-words text-sm leading-7",
				"[&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold",
				"[&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold",
				"[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold",
				"[&_p]:my-2",
				"[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
				"[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
				"[&_li]:my-1",
				"[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
				"[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]",
				"[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3",
				"[&_pre_code]:bg-transparent [&_pre_code]:p-0",
				"[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse",
				"[&_th]:border [&_th]:bg-muted/60 [&_th]:p-2 [&_th]:text-left",
				"[&_td]:border [&_td]:p-2",
				"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
				"[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border",
				"[&_hr]:my-5 [&_hr]:border-border",
				className,
			].join(" ")}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkBreaks]}
				rehypePlugins={[rehypeSanitize]}
				components={{
					a: ({ href, children, ...props }) => (
						<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
							{children}
						</a>
					),
					img: ({ src, alt, ...props }) => {
						// eslint-disable-next-line @next/next/no-img-element -- 附件图片必须经鉴权接口读取，不能交给会缓存/改写 URL 的图片优化器。
						return <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" {...props} />;
					},
				}}
			>
				{markdown}
			</ReactMarkdown>
		</div>
	);
}
