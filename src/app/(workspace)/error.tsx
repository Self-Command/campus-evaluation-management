"use client";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>暂时无法加载此页面</AlertTitle>
      <AlertDescription>
        <p>请重试；如仍无法打开，请联系管理员。</p>
        <Button variant="outline" onClick={reset}>
          重新加载
        </Button>
      </AlertDescription>
    </Alert>
  );
}
