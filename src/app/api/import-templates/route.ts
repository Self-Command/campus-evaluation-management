import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  const auth = await authorize(kind === "participation" ? ["ADMIN", "PUBLISHER"] : ["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const templates = { accounts: { name: "学生账号模板-v1.csv", header: "学号,姓名,学院,专业,班级" }, grades: { name: "成绩输入模板-v1.csv", header: "学号,成绩" }, participation: { name: "活动参与名单模板-v1.csv", header: "学号" } };
  if (!kind || !(kind in templates)) return NextResponse.json({ error: "模板类型无效" }, { status: 400 });
  const template = templates[kind as keyof typeof templates];
  return new Response(`\uFEFF${template.header}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.name)}`, "Cache-Control": "private, no-store" } });
}
