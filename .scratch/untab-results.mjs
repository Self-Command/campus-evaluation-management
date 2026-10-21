// Turns the results page tab layout into the approved single-page layout:
// 概览 → 得分构成 → 计分依据, without rewriting the section contents.
// A backup is kept under .scratch so the change can be reverted quickly.
// Usage: node .scratch/untab-results.mjs
import fs from "node:fs";

const target = "src/app/(workspace)/results/_components/result-view.tsx";
let text = fs.readFileSync(target, "utf8");
fs.writeFileSync(".scratch/result-view.backup.tsx", text);

const replaceOnce = (from, to, label) => {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`找不到片段：${label}`);
  if (text.indexOf(from, index + 1) >= 0) throw new Error(`片段不唯一：${label}`);
  text = `${text.slice(0, index)}${to}${text.slice(index + from.length)}`;
};

replaceOnce(
  `<Tabs\n\t\t\t\t\t\tclassName="min-h-0 min-w-0 max-w-full flex-1 gap-0"\n\t\t\t\t\t\tdefaultValue="overview"\n\t\t\t\t\t>`,
  `<div className="flex min-w-0 max-w-full flex-col gap-8">`,
  "Tabs 开头",
);

const barStart = text.indexOf(`<div className="overflow-x-auto border-y">`);
if (barStart < 0) throw new Error("找不到页签栏");
const barEnd = text.indexOf("</TabsList>", barStart);
if (barEnd < 0) throw new Error("找不到页签栏结尾");
const barClose = text.indexOf("</div>", barEnd);
if (barClose < 0) throw new Error("找不到页签栏闭合");
text = `${text.slice(0, barStart)}${text.slice(barClose + "</div>".length)}`;

replaceOnce(
  `<TabsContent value="overview">`,
  `<section aria-label="成绩概览" className="flex flex-col gap-5">`,
  "overview",
);
replaceOnce(
  `<TabsContent value="modules" className="py-4">`,
  `<section aria-label="得分构成" className="flex flex-col gap-5 border-t pt-6">`,
  "modules",
);
replaceOnce(
  `<TabsContent value="basis" className="py-4">`,
  `<section aria-label="计分依据" className="flex flex-col gap-5 border-t pt-6">`,
  "basis",
);

const headings = [
  [`<p className="text-sm text-muted-foreground">\n\t\t\t\t\t\t\t\t每一项得多少分`, "得分构成"],
];
void headings;

const closes = text.split("</TabsContent>").length - 1;
if (closes !== 3) throw new Error(`页签闭合数量异常：${closes}`);
text = text.replace(/<\/TabsContent>/g, "</section>");
replaceOnce("</Tabs>\n", "</div>\n", "Tabs 结尾");

fs.writeFileSync(target, text);
console.log(`结果页已改为单页布局：替换页签闭合 ${closes} 处；备份在 .scratch/result-view.backup.tsx`);
