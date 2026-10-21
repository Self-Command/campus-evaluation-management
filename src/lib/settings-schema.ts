import { z } from "zod";

export const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(40),
  siteDescription: z.string().trim().min(1).max(160),
  pageTitle: z.string().trim().min(1).max(80),
  themePreset: z.enum(["default", "violet", "blue"]),
  logoAssetId: z.string().max(100).nullable(),
  faviconAssetId: z.string().max(100).nullable(),
  loginFailureLimitEnabled: z.boolean().default(false),
  loginFailureMaxAttempts: z.number().int().min(1).max(100).default(5),
  loginFailureLockMinutes: z.number().int().min(1).max(1440).default(15),
}).strict();

export const defaultSettings = settingsSchema.parse({ siteName: "序衡", siteDescription: "高校综合测评管理", pageTitle: "高校综合测评管理", themePreset: "default", logoAssetId: null, faviconAssetId: null });
