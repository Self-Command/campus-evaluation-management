// System fonts keep the dashboard independent of external font services.
export const fontKeys = ["geist"] as const;
export type FontKey = (typeof fontKeys)[number];
export const fontOptions = [{ key: "geist" as const, label: "系统字体" }];
export const fontVars = "";
