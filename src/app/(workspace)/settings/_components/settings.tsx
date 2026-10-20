"use client";
// Complete invoice.tsx/form/preview adapted for editable brand settings and real preview.
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Command } from "lucide-react";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
type SettingsData = {
  siteName: string;
  siteDescription: string;
  pageTitle: string;
  themePreset: "default" | "violet" | "blue";
  logoAssetId: string | null;
  faviconAssetId: string | null;
  revision: number;
  updatedAt: string;
};
export function Settings() {
  const remote = useRemote<SettingsData>("/api/admin/settings");
  return (
    <>
      <RemoteState {...remote} />
      {remote.data && <SettingsForm key={remote.data.revision} value={remote.data} onSaved={remote.reload} />}
    </>
  );
}
function SettingsForm({ value, onSaved }: { value: SettingsData; onSaved: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useUnsavedChanges(dirty);
  function change(key: keyof SettingsData, next: string | null) {
    setDraft({ ...draft, [key]: next });
    setDirty(true);
    setSuccess("");
  }
  async function upload(file: File | undefined, key: "logoAssetId" | "faviconAssetId") {
    if (!file || uploading) return;
    setUploading(key);
    setError("");
    try {
      if (file.size > 1048576) throw new Error("标识图片不能超过1MiB。");
      const response = await fetch("/api/admin/brand-assets", {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "图片上传失败");
      change(key, result.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  }
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || uploading) return;
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await requestJson(
            "/api/admin/settings",
            {
              revision: draft.revision,
              siteName: draft.siteName,
              siteDescription: draft.siteDescription,
              pageTitle: draft.pageTitle,
              themePreset: draft.themePreset,
              logoAssetId: draft.logoAssetId,
              faviconAssetId: draft.faviconAssetId,
              reason: f.get("reason"),
            },
            "PUT",
          );
          setDirty(false);
          setSuccess("设置已保存并生效。");
          onSaved();
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Feedback error={error} success={success} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant="outline">
          当前修订 {value.revision}
          {dirty ? " · 有未保存修改" : ""}
        </Badge>
        <Button type="submit" disabled={busy || !!uploading || !dirty}>
          {busy ? "正在保存…" : "保存并生效"}
        </Button>
      </div>
      <TemplateEditor
        preview={
          <div className="flex flex-col rounded-xl border bg-card">
            <div className="flex items-center justify-between px-4 py-4">
              <h2 className="font-medium text-lg">品牌效果</h2>
              <Badge variant="outline">
                {draft.themePreset === "violet" ? "紫色" : draft.themePreset === "blue" ? "蓝色" : "默认"}
              </Badge>
            </div>
            <div
              className="flex min-h-80 flex-col items-center justify-center gap-5 rounded-b-xl bg-muted p-6 text-center"
              data-theme-preset={draft.themePreset}
            >
              {draft.logoAssetId ? (
                <Image
                  src={`/api/brand-assets/${draft.logoAssetId}`}
                  alt="站点标识"
                  width={80}
                  height={80}
                  unoptimized
                  className="size-20 object-contain"
                />
              ) : (
                <Command className="size-12 text-primary" />
              )}
              <h2 className="break-words text-3xl">{draft.siteName}</h2>
              <p className="break-words text-muted-foreground">{draft.siteDescription}</p>
              <Separator />
              <p className="break-words text-sm">页面标题：{draft.pageTitle}</p>
              {draft.faviconAssetId && (
                <div className="flex items-center gap-2">
                  <Image
                    src={`/api/brand-assets/${draft.faviconAssetId}`}
                    alt="网站图标"
                    width={20}
                    height={20}
                    unoptimized
                  />
                  <span className="text-sm text-muted-foreground">网站图标</span>
                </div>
              )}
            </div>
          </div>
        }
      >
        <Tabs defaultValue="brand">
          <TabsList className="w-full">
            <TabsTrigger value="brand">品牌与标题</TabsTrigger>
            <TabsTrigger value="assets">标识与主题</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-4" value="brand">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-name">站点名称</FieldLabel>
                <Input
                  id="settings-name"
                  value={draft.siteName}
                  onChange={(e) => change("siteName", e.target.value)}
                  required
                  maxLength={40}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-description">站点说明</FieldLabel>
                <Textarea
                  id="settings-description"
                  value={draft.siteDescription}
                  onChange={(e) => change("siteDescription", e.target.value)}
                  required
                  maxLength={160}
                  rows={3}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-title">页面标题</FieldLabel>
                <Input
                  id="settings-title"
                  value={draft.pageTitle}
                  onChange={(e) => change("pageTitle", e.target.value)}
                  required
                  maxLength={80}
                />
              </Field>
            </FieldGroup>
          </TabsContent>
          <TabsContent className="mt-4" value="assets">
            <FieldGroup>
              {[
                ["logoAssetId", "站点 Logo"],
                ["faviconAssetId", "网站图标"],
              ].map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`settings-${key}`}>{label}</FieldLabel>
                  <Input
                    id={`settings-${key}`}
                    type="file"
                    accept="image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon,.ico"
                    disabled={!!uploading || busy}
                    onChange={(e) => void upload(e.target.files?.[0], key as "logoAssetId")}
                  />
                  <FieldDescription>
                    {uploading === key ? "正在上传…" : "PNG、JPEG或ICO，最大1MiB。上传后需保存设置。"}
                  </FieldDescription>
                  {draft[key as "logoAssetId"] && (
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      disabled={busy}
                      onClick={() => change(key as "logoAssetId", null)}
                    >
                      恢复默认{label}
                    </Button>
                  )}
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor="settings-theme">基础主题</FieldLabel>
                <NativeSelect
                  id="settings-theme"
                  value={draft.themePreset}
                  onChange={(e) => change("themePreset", e.target.value)}
                >
                  <NativeSelectOption value="default">默认主题</NativeSelectOption>
                  <NativeSelectOption value="violet">紫色主题</NativeSelectOption>
                  <NativeSelectOption value="blue">蓝色主题</NativeSelectOption>
                </NativeSelect>
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>
        <Separator />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-reason">修改理由</FieldLabel>
            <Textarea id="settings-reason" name="reason" required minLength={2} maxLength={500} rows={3} />
            <FieldDescription>品牌与主题设置不会改变已有成绩和结算记录。</FieldDescription>
          </Field>
        </FieldGroup>
      </TemplateEditor>
    </form>
  );
}
