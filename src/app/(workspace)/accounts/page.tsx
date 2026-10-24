import Link from "next/link";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { listAccounts } from "@/server/accounts";
import { PageHeading } from "@/components/dashboard/page-heading";
import { buttonVariants } from "@/components/ui/button";
import { Accounts } from "./_components/accounts";
export default async function AccountsPage({
	searchParams,
}: {
	searchParams: Promise<{
		q?: string;
		page?: string;
		role?: string;
		disabled?: string;
	}>;
}) {
	const user = await pageSession();
	if (user.role !== "ADMIN") notFound();
	const p = await searchParams;
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const role = [
		"ADMIN",
		"COLLEGE",
		"COUNSELOR",
		"PUBLISHER",
		"STUDENT",
	].includes(p.role || "")
		? (p.role as "ADMIN" | "COLLEGE" | "COUNSELOR" | "PUBLISHER" | "STUDENT")
		: undefined;
	const disabled =
		p.disabled === "true" ? true : p.disabled === "false" ? false : undefined;
	const result = await listAccounts(
		user.sessionId,
		(p.q || "").slice(0, 80),
		page,
		{ role, disabled },
	);
	return (
		<>
			<PageHeading
				title="账号管理"
				description="添加、调整、停用或删除账号，重置密码；导入账号后可查看导入记录并整批撤销。"
				action={
					<div className="flex flex-wrap gap-2">
						<Link
							href="/imports?kind=accounts&view=history"
							className={buttonVariants({ variant: "outline" })}
						>
							导入记录
						</Link>
						<Link
							href="/accounts/duplicates"
							className={buttonVariants({ variant: "outline" })}
						>
							重复账号处置
						</Link>
					</div>
				}
			/>
			<Accounts
				data={JSON.parse(JSON.stringify(result))}
				query={p.q || ""}
				selfId={user.id}
				filters={{
					role: role || "",
					disabled: disabled === undefined ? "" : String(disabled),
				}}
			/>
		</>
	);
}
