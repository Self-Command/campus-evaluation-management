import { beforeAll } from "vitest";
import { db } from "@/server/db";

const database = new URL(process.env.DATABASE_URL!);
if (database.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(database.pathname)) throw new Error("必须通过隔离数据库运行器执行");
// Each suite already removes its own older fixtures. Release the new restrictive
// history references first, so suite order cannot block that existing cleanup.
beforeAll(async () => {
  await db.studentAffiliation.deleteMany();
  await db.classCounselorAssignment.deleteMany();
  await db.schoolClass.updateMany({ data: { counselorId: null } });
});
