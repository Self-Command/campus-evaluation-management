/**
 * Boot script that reads user preference values from cookies or localStorage
 * based on the configured persistence mode.
 *
 * Runs early in <head> to apply the correct data attributes before hydration,
 * preventing layout or theme flicker and keeping RootLayout fully static.
 */
import { PREFERENCE_REGISTRY, SITE_DEFAULT_PREFERENCE_VALUE } from "@/lib/preferences/preferences-config";

export function ThemeBootScript() {
  const registry = JSON.stringify(PREFERENCE_REGISTRY);
  const siteDefault = JSON.stringify(SITE_DEFAULT_PREFERENCE_VALUE);

  const code = `
    (function () {
      try {
        var root = document.documentElement;
        var REGISTRY = ${registry};
        var SITE_DEFAULT = ${siteDefault};

        function readCookie(name) {
          var rows = document.cookie.split("; ");
          var value = null;
          for (var i = 0; i < rows.length; i += 1) {
            if (rows[i].indexOf(name + "=") === 0) {
              value = rows[i].slice(name.length + 1);
            }
          }
          if (value === null) return null;
          try {
            return decodeURIComponent(value);
          } catch (e) {
            return null;
          }
        }

        function writeCookie(name, value) {
          var secure = window.location.protocol === "https:" ? "; secure" : "";
          document.cookie = name + "=" + encodeURIComponent(value) + "; max-age=31536000; path=/; samesite=lax" + secure;
        }

        function readLocal(name) {
          try {
            return window.localStorage.getItem(name);
          } catch (e) {
            return null;
          }
        }

        function readServerDefault(key, definition) {
          var value = root.getAttribute(definition.attribute);
          return definition.values.indexOf(value) >= 0 ? value : definition.defaultValue;
        }

        function readStoredPreference(key, definition) {
          var cookieName = definition.cookieName || key;
          var value = readCookie(cookieName);

          if (value === SITE_DEFAULT) {
            return readServerDefault(key, definition);
          }

          if (definition.values.indexOf(value) >= 0) {
            return value;
          }

          if (value !== null) {
            return null;
          }

          var legacyName = definition.legacyCookieName;
          if (!legacyName) {
            return null;
          }

          var legacyValue = readCookie(legacyName);
          if (definition.values.indexOf(legacyValue) >= 0) {
            writeCookie(cookieName, legacyValue);
            return legacyValue;
          }

          return null;
        }

        function readPreference(key, definition) {
          var mode = definition.persistence;
          var value = null;

          if (mode === "localStorage") {
            value = readLocal(key);
          }

          if (!value && (mode === "client-cookie" || mode === "server-cookie")) {
            value = readStoredPreference(key, definition);
          }

          return definition.values.indexOf(value) >= 0 ? value : readServerDefault(key, definition);
        }

        var preferences = {};

        Object.keys(REGISTRY).forEach(function(key) {
          var definition = REGISTRY[key];
          var value = readPreference(key, definition);

          preferences[key] = value;
          root.setAttribute(definition.attribute, value);
        });

        var mode = preferences.theme_mode;
        var resolvedMode =
          mode === "system" && window.matchMedia
            ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
            : mode === "dark"
              ? "dark"
              : "light";

        root.classList.toggle("dark", resolvedMode === "dark");
        root.style.colorScheme = resolvedMode;

      } catch (e) {
        console.warn("ThemeBootScript error:", e);
      }
    })();
  `;

  /* biome-ignore lint/security/noDangerouslySetInnerHtml: required for pre-hydration boot script */
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
