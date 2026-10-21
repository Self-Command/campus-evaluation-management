// Adds more tweakcn themes end to end: fetch through the local proxy, write the
// preset CSS from the registry cssVars, and register the theme in the option list
// and the settings enum. Themes that fail to download are skipped, not guessed.
// Usage: node .scratch/add-themes.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const candidates = [
  { name: "supabase", label: "Supabase", description: "绿色品牌强调色，企业后台感强（tweakcn 主题）" },
  { name: "mono", label: "Mono", description: "高对比黑白，报表与表格最清晰（tweakcn 主题）" },
];
fs.mkdirSync(".local/themes", { recursive: true });
const added = [];
for (const item of candidates) {
  const file = `.local/themes/${item.name}.json`;
  try {
    execFileSync("curl.exe", ["-s", "-x", "http://127.0.0.1:7890", "--max-time", "40", "-o", file, `https://tweakcn.com/r/themes/${item.name}`]);
    const theme = JSON.parse(fs.readFileSync(file, "utf8"));
    const light = theme.cssVars?.light ?? {};
    const dark = theme.cssVars?.dark ?? {};
    if (!light.primary || !dark.primary) throw new Error("缺少 primary");
    const declare = (vars) =>
      Object.entries(vars)
        .filter(([key, value]) => typeof value === "string" && value.trim() && /^[a-z0-9-]+$/i.test(key.replace(/^--/, "")))
        .map(([key, value]) => `  --${key.replace(/^--/, "")}: ${value.trim()};`)
        .join("\n");
    const css = `/*
label: ${item.label}
value: ${item.name}
source: https://tweakcn.com/r/themes/${item.name} (tweakcn registry, Apache-2.0 — see docs/licenses/tweakcn-APACHE-2.0.txt)
*/
:root[data-theme-preset="${item.name}"] {
${declare(light)}
}

.dark:root[data-theme-preset="${item.name}"] {
${declare(dark)}
}
`;
    fs.writeFileSync(`src/styles/presets/${item.name}.css`, css, "utf8");

    const globals = "src/app/globals.css";
    let text = fs.readFileSync(globals, "utf8");
    if (!text.includes(`${item.name}.css`)) {
      text = text.replace('@import "../styles/presets/tangerine.css";', `@import "../styles/presets/tangerine.css";\n@import "../styles/presets/${item.name}.css";`);
      fs.writeFileSync(globals, text, "utf8");
    }

    const themeFile = "src/lib/preferences/theme.ts";
    let options = fs.readFileSync(themeFile, "utf8");
    if (!options.includes(`value: "${item.name}"`)) {
      options = options.replace(
        "  },\n] as const;",
        `  },\n  {\n    label: "${item.label}",\n    value: "${item.name}",\n    description: "${item.description}",\n    primary: { light: "${light.primary}", dark: "${dark.primary}" },\n  },\n] as const;`,
      );
      fs.writeFileSync(themeFile, options, "utf8");
    }

    const schemaFile = "src/lib/settings-schema.ts";
    let schema = fs.readFileSync(schemaFile, "utf8");
    if (!schema.includes(`"${item.name}"`)) {
      schema = schema.replace(/"tangerine"\] as const/, `"tangerine", "${item.name}"] as const`);
      fs.writeFileSync(schemaFile, schema, "utf8");
    }
    added.push(`${item.name} (light ${light.primary} / dark ${dark.primary})`);
  } catch (error) {
    added.push(`${item.name} 跳过：${error.message}`);
  }
}
console.log(added.join("\n"));
console.log(fs.readdirSync("src/styles/presets").join(", "));
