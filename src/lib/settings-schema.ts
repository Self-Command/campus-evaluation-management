import { z } from "zod";

// The saved value is a complete visual theme (see src/styles/presets/*.css).
export const themePresetValues = ["default", "brutalist", "soft-pop", "tangerine", "vercel", "claude", "t3-chat", "supabase", "mono"] as const;
export const themePresetSchema = z.enum(themePresetValues);

export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(40),
  siteDescription: z.string().trim().min(1).max(160),
  pageTitle: z.string().trim().min(1).max(80),
  themePreset: themePresetSchema,
  logoAssetId: z.string().max(100).nullable(),
  faviconAssetId: z.string().max(100).nullable(),
  loginFailureLimitEnabled: z.boolean().default(false),
  loginFailureMaxAttempts: z.number().int().min(1).max(100).default(5),
  loginFailureLockMinutes: z.number().int().min(1).max(1440).default(15),
}).strict();

// Reading already-saved records tolerates values that are no longer offered
// (for example the retired violet/blue colour presets) so an old row can never
// break every page; writes still go through the strict schema above.
export const storedSettingsSchema = settingsSchema.extend({ themePreset: themePresetSchema.catch("default") });

export const defaultSettings = settingsSchema.parse({ siteName: "序衡", siteDescription: "高校综合测评管理", pageTitle: "高校综合测评管理", themePreset: "default", logoAssetId: null, faviconAssetId: null });
