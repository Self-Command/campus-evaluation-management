"use server";
import { cookies } from "next/headers";
import { PREFERENCE_KEYS, parsePreference, type PreferenceKey } from "@/lib/preferences/preferences-config";

// Only allow template appearance preferences, never arbitrary auth cookies.
export async function setValueToCookie(key: string, value: string) {
  if (!PREFERENCE_KEYS.includes(key as PreferenceKey)) throw new Error("无效的外观选项");
  const name = key as PreferenceKey;
  if (parsePreference(name, value) !== value) throw new Error("无效的外观选项");
  (await cookies()).set(name, value, { path: "/", sameSite: "lax", maxAge: 604800 });
}
