// Generates theme presets from the tweakcn registry items downloaded through the
// local proxy into .local/themes. Values are copied verbatim (oklch), so no colour
// approximation is introduced. Usage: node .scratch/gen-themes.mjs
import fs from "node:fs";
import path from "node:path";

const themes = [
  { name: "vercel", label: "Vercel", source: "https://tweakcn.com/r/themes/vercel" },
  { name: "claude", label: "Claude", source: "https://tweakcn.com/r/themes/claude" },
  { name: "t3-chat", label: "T3 Chat", source: "https://tweakcn.com/r/themes/t3-chat" },
];
const dir = "src/styles/presets";
const summary = [];
for (const theme of themes) {
  const item = JSON.parse(fs.readFileSync(path.join(".local/themes", `${theme.name}.json`), "utf8"));
  const light = item.cssVars?.light ?? {};
  const dark = item.cssVars?.dark ?? {};
  const declare = (vars, indent) =>
    Object.entries(vars)
      .filter(([key, value]) => typeof value === "string" && value.trim() && /^[a-z0-9-]+$/i.test(key.replace(/^--/, "")))
      .map(([key, value]) => `${indent}--${key.replace(/^--/, "")}: ${value.trim()};`)
      .join("\n");
  const css = `/*
label: ${theme.label}
value: ${theme.name}
source: ${theme.source} (tweakcn registry; verify LICENSE before redistribution)
*/
:root[data-theme-preset="${theme.name}"] {
${declare(light, "  ")}
}

.dark:root[data-theme-preset="${theme.name}"] {
${declare(dark, "  ")}
}
`;
  fs.writeFileSync(path.join(dir, `${theme.name}.css`), css, "utf8");
  summary.push(`${theme.name}: ${declare(light, "").split("\n").length} light / ${declare(dark, "").split("\n").length} dark | primary ${light.primary ?? light["--primary"]} / ${dark.primary ?? dark["--primary"]}`);
}
const globals = "src/app/globals.css";
let text = fs.readFileSync(globals, "utf8");
if (!text.includes("vercel.css")) {
  text = text.replace(
    '@import "../styles/presets/tangerine.css";',
    '@import "../styles/presets/tangerine.css";\n@import "../styles/presets/vercel.css";\n@import "../styles/presets/claude.css";\n@import "../styles/presets/t3-chat.css";',
  );
  fs.writeFileSync(globals, text, "utf8");
}
console.log(summary.join("\n"));
