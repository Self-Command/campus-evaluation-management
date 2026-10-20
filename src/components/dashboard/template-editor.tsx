// Adapted from dashboard/invoice/_components/invoice.tsx and invoice-form.tsx.
import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
export function TemplateEditor({ children, preview }: { children: ReactNode; preview: ReactNode }) {
  return (
    <div className="grid min-w-0 max-w-full items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">{children}</div>
      <div className="min-w-0">{preview}</div>
    </div>
  );
}
export function EditorSection({ children }: { children: ReactNode }) {
  return (
    <>
      <Separator />
      <section className="flex min-w-0 flex-col gap-3">{children}</section>
    </>
  );
}
