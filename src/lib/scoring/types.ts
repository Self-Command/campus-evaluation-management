import { z } from "zod";
export const decimalSchema = z.string().regex(/^-?\d{1,10}(?:\.\d{1,12})?$/, "整数最多10位、小数最多12位，不支持科学计数法");
export const nodeSchema = z.object({
  id: z.string().min(1).max(100), parentId: z.string().max(100).nullable(), name: z.string().trim().min(1).max(80),
  order: z.number().int().min(0).max(100000), kind: z.enum(["SUM", "WEIGHTED", "ACTIVITY", "GRADE"]),
  weight: decimalSchema.default("1"), cap: decimalSchema.nullable().default(null), floor: decimalSchema.nullable().default(null),
  normalize: z.boolean().default(false), rawMaximum: decimalSchema.nullable().default(null), targetMaximum: decimalSchema.nullable().default(null),
  minimum: decimalSchema.default("0"), maximum: decimalSchema.default("100"), required: z.boolean().default(false),
});
export const schemeSchema = z.object({ nodes: z.array(nodeSchema).min(1).max(5000), deductions: z.array(z.object({ id: z.string().min(1).max(100), nodeId: z.string().min(1).max(100), name: z.string().trim().min(1).max(80), coefficient: decimalSchema })).max(500) });
export type ScoringNode = z.infer<typeof nodeSchema>;
export type Scheme = z.infer<typeof schemeSchema>;
export type ScoringInput = { values: Record<string, string>; deductions: Record<string, string> };
