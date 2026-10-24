import { z } from "zod";
import { authGlowToneValues } from "@/lib/auth-glass";

// The saved value is a complete visual theme (see src/styles/presets/*.css).
export const themePresetValues = ["default", "brutalist", "soft-pop", "tangerine", "vercel", "claude", "t3-chat", "supabase", "mono"] as const;
export const themePresetSchema = z.enum(themePresetValues);

export const defaultAttachmentExtensions = ["png", "jpg", "jpeg", "webp", "gif", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "txt", "md"] as const;

// The logo height is deliberately unbounded: wide logos are fitted to the
// container width, so an artificial pixel ceiling only makes marks look small.
export const logoSizeSchema = z.number().int().min(16).default(28);
export const loginCardBlurSchema = z.number().int().min(0).max(40).default(24);
export const loginCardOpacitySchema = z.number().int().min(20).max(95).default(80);
export const loginCardSaturationSchema = z.number().int().min(100).max(200).default(145);
export const loginCardGlowSchema = z.number().int().min(0).max(100).default(65);
export const loginCardGlowToneSchema = z.enum(authGlowToneValues).default("theme");
export const defaultThemeModeValues = ["light", "dark", "system"] as const;
export const defaultThemeModeSchema = z.enum(defaultThemeModeValues);

export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(40),
  siteDescription: z.string().trim().min(1).max(160),
  pageTitle: z.string().trim().min(1).max(80),
  themePreset: themePresetSchema,
  defaultThemeMode: defaultThemeModeSchema.default("light"),
  logoAssetId: z.string().max(100).nullable(),
  logoSize: logoSizeSchema,
  faviconAssetId: z.string().max(100).nullable(),
  loginBackgroundAssetId: z.string().max(100).nullable().default(null),
  loginNotice: z.string().trim().max(200).default(""),
  loginCardBlur: loginCardBlurSchema,
  loginCardOpacity: loginCardOpacitySchema,
  loginCardSaturation: loginCardSaturationSchema,
  loginCardGlow: loginCardGlowSchema,
  loginCardGlowTone: loginCardGlowToneSchema,
  loginFailureLimitEnabled: z.boolean().default(false),
  loginFailureMaxAttempts: z.number().int().min(1).max(100).default(5),
  loginFailureLockMinutes: z.number().int().min(1).max(1440).default(15),
  activityAttachmentMaxFiles: z.number().int().min(1).max(20).default(5),
  activityAttachmentMaxSizeMb: z.number().int().min(1).max(50).default(10),
  activityAttachmentAllowedExtensions: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,10}$/)).min(1).max(20).default([...defaultAttachmentExtensions]),
}).strict();

// Reading already-saved records tolerates values that are no longer offered
// (for example the retired violet/blue colour presets) so an old row can never
// break every page; writes still go through the strict schema above.
export const storedSettingsSchema = settingsSchema.extend({ themePreset: themePresetSchema.catch("default"), logoSize: logoSizeSchema.catch(28) });

export const defaultSettings = settingsSchema.parse({ siteName: "序衡", siteDescription: "高校综合测评管理", pageTitle: "高校综合测评管理", themePreset: "default", logoAssetId: null, faviconAssetId: null });
