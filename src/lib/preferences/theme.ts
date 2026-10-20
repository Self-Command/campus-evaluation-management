const THEME_MODE_OPTIONS = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
] as const;

export const THEME_MODE_VALUES = THEME_MODE_OPTIONS.map((o) => o.value);
export type ThemeMode = (typeof THEME_MODE_VALUES)[number];
export type ResolvedThemeMode = "light" | "dark";

// --- generated:themePresets:start ---

export const THEME_PRESET_OPTIONS = [
  { label: "默认", value: "default", primary: { light: "oklch(0.50 0.20 286)", dark: "oklch(0.72 0.16 286)" } },
  { label: "紫色", value: "violet", primary: { light: "oklch(0.50 0.20 286)", dark: "oklch(0.72 0.16 286)" } },
  { label: "蓝色", value: "blue", primary: { light: "oklch(0.50 0.18 255)", dark: "oklch(0.72 0.14 255)" } },
] as const;

export const THEME_PRESET_VALUES = THEME_PRESET_OPTIONS.map((p) => p.value);

export type ThemePreset = (typeof THEME_PRESET_OPTIONS)[number]["value"];

// --- generated:themePresets:end ---
