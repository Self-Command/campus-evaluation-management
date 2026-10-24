import type { CSSProperties } from "react";

export const authGlowToneValues = ["theme", "aurora", "sunset", "ocean"] as const;
export type AuthGlowTone = (typeof authGlowToneValues)[number];

export const authGlowToneOptions: ReadonlyArray<{
  value: AuthGlowTone;
  label: string;
  description: string;
}> = [
  { value: "theme", label: "主题色", description: "跟随当前界面主题，最克制" },
  { value: "aurora", label: "极光", description: "青绿与紫蓝渐变，通透清爽" },
  { value: "sunset", label: "日落", description: "暖金与珊瑚渐变，温暖醒目" },
  { value: "ocean", label: "深海", description: "湖蓝与靛紫渐变，冷静稳重" },
];

export function authGlassStyle(input: {
  loginCardBlur: number;
  loginCardOpacity: number;
  loginCardSaturation: number;
  loginCardGlow: number;
}): CSSProperties {
  const glow = Math.min(100, Math.max(0, input.loginCardGlow));
  return {
    "--auth-card-blur": `${input.loginCardBlur}px`,
    "--auth-card-opacity": `${input.loginCardOpacity}%`,
    "--auth-card-saturation": `${input.loginCardSaturation}%`,
    "--auth-glow-border": (0.34 + glow * 0.0066).toFixed(3),
    "--auth-glow-halo": (glow * 0.006).toFixed(3),
  } as CSSProperties;
}
