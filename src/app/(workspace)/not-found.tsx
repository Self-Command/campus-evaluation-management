import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

export default function NotFound() {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchX />
				</EmptyMedia>
				<EmptyTitle>页面不存在或无权访问</EmptyTitle>
				<EmptyDescription>
					该页面可能已移动、已删除，或当前账号没有访问权限。
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
					返回首页
				</Link>
			</EmptyContent>
		</Empty>
	);
}
