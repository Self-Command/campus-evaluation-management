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
            ? "创建周期并配置制度后，即可维护活动、审核认定和发布测评结果。"
            : "学校建立测评周期后，可在这里查看活动、提交认定并核对测评结果。"
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
