import { db } from "@/server/db";

export async function organizationFixture(prefix: string, names = { college: "测试学院", major: "测试专业", className: "测试班级" }) {
  const college = await db.college.create({ data: { code: prefix, name: names.college } });
  const counselor = await db.user.create({ data: { login: `${prefix}-counselor`, name: "责任辅导员", role: "COUNSELOR", collegeId: college.id, passwordHash: "fixture-only", mustChangePassword: false } });
  const major = await db.major.create({ data: { code: "M", name: names.major, collegeId: college.id } });
  const schoolClass = await db.schoolClass.create({ data: { code: "C", name: names.className, majorId: major.id, counselorId: counselor.id } });
  return { college, major, schoolClass, counselor };
}
