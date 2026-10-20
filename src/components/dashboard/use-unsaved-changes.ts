"use client";
import { useEffect } from "react";
const activeDrafts = new Set<symbol>();
export function hasUnsavedChanges() {
  return activeDrafts.size > 0;
}
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const draft = Symbol("draft");
    activeDrafts.add(draft);
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("有尚未保存的内容，是否离开当前页面？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      activeDrafts.delete(draft);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
}
