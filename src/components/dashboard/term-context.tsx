"use client";
import { useEffect } from "react";
import { hasUnsavedChanges } from "./use-unsaved-changes";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { phaseLabels } from "@/lib/business-labels";
export type TermOption = { id: string; name: string; phase: string };
export function TermContext({
  terms,
  selected = "",
  dirty = false,
}: {
  terms: TermOption[];
  selected?: string;
  dirty?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const path = usePathname();
  const current = terms.find((t) => t.id === selected);
  useEffect(() => {
    if (selected)
      document.cookie = `measurement_term=${encodeURIComponent(selected)}; Path=/; SameSite=Lax; Max-Age=31536000`;
  }, [selected]);
  if (!terms.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <Field className="w-full sm:w-80">
        <FieldLabel htmlFor="term-context">测评周期</FieldLabel>
        <NativeSelect
          id="term-context"
          value={selected}
          onChange={(e) => {
            if ((dirty || hasUnsavedChanges()) && !window.confirm("切换周期会放弃尚未保存的内容，是否继续？")) return;
            const query = new URLSearchParams(params);
            query.set("termId", e.target.value);
            for (const key of ["page", "status", "publicationId", "college", "major", "className", "studentId"])
              query.delete(key);
            router.push(`${path.startsWith("/terms/") ? `/terms/${e.target.value}` : path}?${query}`);
          }}
        >
          {!terms.length && <NativeSelectOption value="">尚无周期</NativeSelectOption>}
          {terms.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              {t.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {current && (
        <Badge variant="secondary" className="mb-2">
          {phaseLabels[current.phase]}
        </Badge>
      )}
    </div>
  );
}
