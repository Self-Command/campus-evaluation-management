import { createStore } from "zustand/vanilla";

import { applyPreference } from "@/lib/preferences/preference-runtime";
import {
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  type PreferenceKey,
  type PreferenceValueMap,
} from "@/lib/preferences/preferences-config";
import { persistPreference } from "@/lib/preferences/preferences-storage";
import type { ResolvedThemeMode } from "@/lib/preferences/theme";
import { deleteClientCookie } from "@/lib/cookie.client";

export type PreferencesState = {
  values: PreferenceValueMap;
  resolvedThemeMode: ResolvedThemeMode;
  isSynced: boolean;
  setPreference: <K extends PreferenceKey>(key: K, value: PreferenceValueMap[K]) => void;
  resetTheme: (defaults: Pick<PreferenceValueMap, "theme_mode" | "theme_preset">) => void;
  resetPreferences: () => void;
};

export const createPreferencesStore = (initialValues: Partial<PreferenceValueMap> = {}) => {
  const values: PreferenceValueMap = {
    ...PREFERENCE_DEFAULTS,
    ...initialValues,
  };

  return createStore<PreferencesState>()((set) => ({
    values,
    resolvedThemeMode: values.theme_mode === "dark" ? "dark" : "light",
    isSynced: false,

    setPreference: (key, value) => {
      const resolvedThemeMode = applyPreference(key, value);

      set((state) => ({
        values: {
          ...state.values,
          [key]: value,
        } as PreferenceValueMap,
        ...(resolvedThemeMode ? { resolvedThemeMode } : {}),
      }));

      void persistPreference(key, value);
    },

    resetTheme: defaults => {
      applyPreference("theme_preset", defaults.theme_preset);
      const resolvedThemeMode = applyPreference("theme_mode", defaults.theme_mode);
      deleteClientCookie("theme_preset");
      deleteClientCookie("theme_mode");
      set(state => ({
        values: { ...state.values, ...defaults },
        ...(resolvedThemeMode ? { resolvedThemeMode } : {}),
      }));
    },

    resetPreferences: () => {
      let resolvedThemeMode: ResolvedThemeMode = "light";

      for (const key of PREFERENCE_KEYS) {
        const value = PREFERENCE_DEFAULTS[key];
        const resolved = applyPreference(key, value);

        if (resolved) resolvedThemeMode = resolved;
        void persistPreference(key, value);
      }

      set({
        values: { ...PREFERENCE_DEFAULTS },
        resolvedThemeMode,
      });
    },
  }));
};
