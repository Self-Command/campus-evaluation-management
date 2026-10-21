// Removes the retired pointer-drag handlers from the scheme editor (replaced by the
// native HTML5 drag effect) and documents the intentional effect dependencies.
// A backup is written next to the scratch scripts first.
// Usage: node .scratch/clean-drag.mjs
import fs from "node:fs";

const target = "src/app/(workspace)/terms/_components/scheme-editor.tsx";
let text = fs.readFileSync(target, "utf8");
fs.writeFileSync(".scratch/scheme-editor.backup.tsx", text);

function removeFunction(source, name) {
  const start = source.indexOf(`\tfunction ${name}(`);
  if (start < 0) return { source, removed: false };
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`找不到 ${name} 的函数体`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        let end = i + 1;
        while (source[end] === "\n") end += 1;
        return { source: source.slice(0, start) + source.slice(end), removed: true };
      }
    }
  }
  throw new Error(`无法确定 ${name} 的结束位置`);
}

let removed = [];
for (const name of ["onModulePointerDown", "onModulePointerMove", "onModulePointerUp"]) {
  const result = removeFunction(text, name);
  text = result.source;
  if (result.removed) removed.push(name);
}

const pressStart = text.indexOf("\tconst press = useRef<{");
if (pressStart >= 0) {
  const end = text.indexOf("\t} | null>(null);", pressStart);
  if (end < 0) throw new Error("找不到 press ref 结尾");
  text = `${text.slice(0, pressStart)}${text.slice(end + "\t} | null>(null);\n".length)}`;
  removed.push("press ref");
}

if (!text.includes("eslint-disable-next-line react-hooks/exhaustive-deps")) {
  const deps = text.indexOf("\t}, [drag, editable, scheme]);");
  if (deps < 0) throw new Error("找不到原生拖放 effect 的依赖数组");
  text = `${text.slice(0, deps)}\t\t// The handlers below are recreated per render on purpose; the effect only needs\n\t\t// to rebind when the dragged module, editability or the scheme changes.\n\t\t// eslint-disable-next-line react-hooks/exhaustive-deps\n${text.slice(deps)}`;
}

fs.writeFileSync(target, text, "utf8");
console.log(`已移除：${removed.join("、") || "无"}`);
