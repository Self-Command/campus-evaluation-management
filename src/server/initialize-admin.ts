import { hash } from "bcryptjs";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
export async function initializeAdmin(login: string, password: string) {
  const passwordHash = await hash(password, 12);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109311)`;
    if (await tx.user.count({ where: { role: "ADMIN" } })) throw new Error("管理员已存在；初始化不会重置现有账号。");
    const user = await tx.user.create({ data: { login, name: "系统管理员", role: "ADMIN", passwordHash, mustChangePassword: true } });
    await recordAudit(tx, { actorId: user.id, action: "INITIAL_ADMIN_CREATED", targetId: user.id });
    return { id: user.id, login: user.login };
  });
}
