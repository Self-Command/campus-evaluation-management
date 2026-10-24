import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/server/db";
import { attachmentRoot } from "../src/server/activity-attachments";

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
const stale = await db.activityAttachment.findMany({
	where: { activityId: null, createdAt: { lt: cutoff } },
	select: { id: true, storageKey: true, name: true },
	orderBy: { createdAt: "asc" },
});
for (const row of stale) {
	await unlink(join(attachmentRoot(), row.storageKey)).catch(() => {});
}
if (stale.length) {
	await db.activityAttachment.deleteMany({
		where: { id: { in: stale.map((row) => row.id) } },
	});
}
console.log(
	stale.length
		? `已清理 ${stale.length} 个超过 24 小时未绑定的活动附件。`
		: "没有需要清理的活动附件。",
);
await db.$disconnect();
