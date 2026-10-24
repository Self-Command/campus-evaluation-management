"use client";

import { Check, Monitor, Moon, Palette, RotateCcw, Sun } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEME_PRESET_OPTIONS, type ThemeMode, type ThemePreset } from "@/lib/preferences/theme";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

type SiteThemeDefaults = { themePreset: ThemePreset; themeMode: ThemeMode };

export function ThemePreferences({ siteDefaults }: { siteDefaults: SiteThemeDefaults }) {
  const values = usePreferencesStore(state => state.values);
  const setPreference = usePreferencesStore(state => state.setPreference);
  const resetTheme = usePreferencesStore(state => state.resetTheme);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-sm">界面外观</h4>
          <span className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">站点默认 · {modeLabel(siteDefaults.themeMode)}</span>
        </div>
        <p className="text-muted-foreground text-xs">个人选择只保存在当前浏览器，不改变站点默认。</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-xs">深浅模式</span>
        <ToggleGroup
          className="w-full"
          size="sm"
          spacing={0}
          variant="outline"
          value={[values.theme_mode]}
          onValueChange={([mode]) => {
            if (mode) setPreference("theme_mode", mode as ThemeMode);
          }}
        >
          <ToggleGroupItem className="flex-1 gap-1.5" value="light">
            <Sun />浅色
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1 gap-1.5" value="dark">
            <Moon />深色
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1 gap-1.5" value="system">
            <Monitor />跟随系统
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-xs">主题风格</span>
        <div className="grid grid-cols-3 gap-1.5">
          {THEME_PRESET_OPTIONS.map(option => {
            const active = values.theme_preset === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                title={option.description}
                onClick={() => setPreference("theme_preset", option.value as ThemePreset)}
                className={cn(
                  "group relative flex min-w-0 flex-col gap-1 rounded-md border p-1.5 text-left transition-colors",
                  active ? "border-primary ring-1 ring-primary" : "hover:bg-muted/60",
                )}
              >
                <span
                  aria-hidden
                  className="h-7 w-full rounded-sm border"
                  style={{ background: `linear-gradient(135deg, ${option.primary.light} 0 55%, ${option.primary.dark} 55% 100%)` }}
                />
                <span className="truncate text-[11px]">{option.label}</span>
                {active && (
                  <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                    <Check className="size-2.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => resetTheme({ theme_mode: siteDefaults.themeMode, theme_preset: siteDefaults.themePreset })}
      >
        <RotateCcw />
        恢复站点默认
      </Button>
    </div>
  );
}

export function ThemePicker({ siteDefaults, imageBackground = false }: { siteDefaults: SiteThemeDefaults; imageBackground?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="调整界面外观"
            className={cn(
              "backdrop-blur",
              imageBackground && "border-white/30 bg-black/25 text-white hover:bg-black/40 hover:text-white",
            )}
          />
        }
      >
        <Palette />
        <span className="hidden sm:inline">外观</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <ThemePreferences siteDefaults={siteDefaults} />
      </PopoverContent>
    </Popover>
  );
}

function modeLabel(mode: ThemeMode) {
  return { light: "浅色", dark: "深色", system: "跟随系统" }[mode];
}
