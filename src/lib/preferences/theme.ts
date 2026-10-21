const THEME_MODE_OPTIONS = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
] as const;

export const THEME_MODE_VALUES = THEME_MODE_OPTIONS.map((o) => o.value);
export type ThemeMode = (typeof THEME_MODE_VALUES)[number];
export type ResolvedThemeMode = "light" | "dark";

// --- generated:themePresets:start ---

// Themes are complete visual treatments (radius, borders, shadows and colours),
// not only a primary colour swap. Each value matches an imported stylesheet in
// src/styles/presets/*.css and is applied through <html data-theme-preset>.
export const THEME_PRESET_OPTIONS = [
  {
    label: "默认主题",
    value: "default",
    description: "圆角与留白均衡，适合日常教学管理界面",
    primary: { light: "oklch(0.50 0.20 286)", dark: "oklch(0.72 0.16 286)" },
  },
  {
    label: "粗野主题",
    value: "brutalist",
    description: "直角、粗描边与硬阴影，区块辨识度高",
    primary: { light: "oklch(0.6489 0.237 26.9728)", dark: "oklch(0.7044 0.1872 23.1858)" },
  },
  {
    label: "柔和主题",
    value: "soft-pop",
    description: "大圆角与柔和阴影，信息层级更轻",
    primary: { light: "oklch(0.5106 0.2301 276.9656)", dark: "oklch(0.6801 0.1583 276.9349)" },
  },
  {
    label: "蜜橘主题",
    value: "tangerine",
    description: "暖色主色与浅灰层次，长时间阅读更舒适",
    primary: { light: "oklch(0.64 0.17 36.44)", dark: "oklch(0.64 0.17 36.44)" },
  },
  {
    label: "Vercel",
    value: "vercel",
    description: "黑白极简、强对比，信息最克制（tweakcn 主题）",
    primary: { light: "oklch(0 0 0)", dark: "oklch(1 0 0)" },
  },
  {
    label: "Claude",
    value: "claude",
    description: "米白纸感与暖棕强调色，长文阅读舒适（tweakcn 主题）",
    primary: { light: "oklch(0.6171 0.1375 39.0427)", dark: "oklch(0.6724 0.1308 38.7559)" },
  },
  {
    label: "T3 Chat",
    value: "t3-chat",
    description: "紫粉调、层次柔和，现代产品感强（tweakcn 主题）",
    primary: { light: "oklch(0.5316 0.1409 355.1999)", dark: "oklch(0.4607 0.1853 4.0994)" },
  },
  {
    label: "Supabase",
    value: "supabase",
    description: "绿色品牌强调色，企业后台感强（tweakcn 主题）",
    primary: { light: "oklch(0.8348 0.1302 160.9080)", dark: "oklch(0.4365 0.1044 156.7556)" },
  },
  {
    label: "Mono",
    value: "mono",
    description: "高对比黑白，报表与表格最清晰（tweakcn 主题）",
    primary: { light: "oklch(0.5555 0 0)", dark: "oklch(0.5555 0 0)" },
  },
] as const;

export const THEME_PRESET_VALUES = THEME_PRESET_OPTIONS.map((p) => p.value);

export type ThemePreset = (typeof THEME_PRESET_OPTIONS)[number]["value"];

// --- generated:themePresets:end ---
