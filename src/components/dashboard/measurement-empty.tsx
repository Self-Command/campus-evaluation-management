import Link from "next/link";
import { NoData } from "./page-heading";
import { buttonVariants } from "@/components/ui/button";
export function MeasurementEmpty({ admin }: { admin: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <NoData
        title="尚无测评周期"
        description={
          admin
            ? "创建周期并设置评分方案后，就可以维护活动、审核参与记录和发布成绩。"
            : "学校创建测评周期后，可以在这里查看活动、提交申报和查看成绩。"
        }
      />
      {admin && (
        <Link href="/terms?new=1" className={buttonVariants()}>
          创建测评周期
        </Link>
      )}
    </div>
  );
}
