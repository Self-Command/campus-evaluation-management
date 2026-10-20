"use client";
import { Moon, Sun, Monitor, PanelTop } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
export function HeaderControls() {
  const values = usePreferencesStore((s) => s.values);
  const set = usePreferencesStore((s) => s.setPreference);
  const icons = { light: Moon, dark: Sun, system: Monitor };
  const Icon = icons[values.theme_mode];
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label="界面外观" />}>
          <PanelTop />
        </PopoverTrigger>
        <PopoverContent align="end">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="content-layout">内容布局</FieldLabel>
              <NativeSelect
                id="content-layout"
                value={values.content_layout}
                onChange={(e) => void set("content_layout", e.target.value as "centered" | "full-width")}
              >
                <NativeSelectOption value="centered">居中</NativeSelectOption>
                <NativeSelectOption value="full-width">全宽</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="sidebar-variant">导航样式</FieldLabel>
              <NativeSelect
                id="sidebar-variant"
                value={values.sidebar_variant}
                onChange={(e) => void set("sidebar_variant", e.target.value as "inset" | "sidebar" | "floating")}
              >
                <NativeSelectOption value="sidebar">侧边栏</NativeSelectOption>
                <NativeSelectOption value="inset">内嵌</NativeSelectOption>
                <NativeSelectOption value="floating">悬浮</NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`切换主题（当前${{ light: "浅色", dark: "深色", system: "跟随系统" }[values.theme_mode]}）`}
        onClick={() =>
          void set(
            "theme_mode",
            values.theme_mode === "light" ? "dark" : values.theme_mode === "dark" ? "system" : "light",
          )
        }
      >
        <Icon />
      </Button>
    </div>
  );
}
