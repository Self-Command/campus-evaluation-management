import { notFound } from "next/navigation";
import Link from "next/link";
import { pageSession } from "@/server/page-session";
import { listDuplicateGroups } from "@/server/account-duplicates";
import { PageHeading } from "@/components/dashboard/page-heading";
import { buttonVariants } from "@/components/ui/button";
import { DuplicateAccounts } from "./_components/duplicates";

export default async function AccountDuplicatesPage() {
	const user = await pageSession();
	if (user.role !== "ADMIN") notFound();
	const data = await listDuplicateGroups(user.sessionId);
	return (
		<>
			<PageHeading
				title="重复账号处置"
				description="核对同班同名、学号不同的学生账号。优先保留已有业务记录的账号；确认后停用重复账号并保留其历史记录，不删除账号。"
				action={
					<Link
						href="/accounts"
						className={buttonVariants({ variant: "outline" })}
					>
						返回账号管理
					</Link>
				}
			/>
			<DuplicateAccounts data={JSON.parse(JSON.stringify(data))} />
		</>
	);
}
