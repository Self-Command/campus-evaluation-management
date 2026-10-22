import { expect, test } from "vitest";
import yauzl from "yauzl";
import { buildWorkbook } from "@/lib/xlsx/workbook";

function readEntries(buffer: Buffer) {
  return new Promise<Record<string, string>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法打开工作簿"));
      const files: Record<string, string> = {};
      zip.on("entry", (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("无法读取条目"));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            files[entry.fileName] = Buffer.concat(chunks).toString("utf8");
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(files));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

test("公式工作簿可被正常解包，公式与打开即重算属性都存在", async () => {
  const workbook = buildWorkbook({
    name: "成绩",
    columns: [{ header: "学号" }, { header: "学业成绩" }, { header: "子项合计" }, { header: "总分" }],
    rows: [
      ["20260001", 88, { formula: "B2*0.4", cached: 35.2 }, { formula: "C2+1", cached: 36.2 }],
      ["20260002", null, { formula: "SUM(C2:C3)" }],
    ],
    freezeRows: 1,
  });
  expect(workbook.subarray(0, 2).toString("utf8")).toBe("PK");

  const files = await readEntries(workbook);
  expect(Object.keys(files).sort()).toEqual(
    ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
  );
  expect(files["xl/workbook.xml"]).toContain('fullCalcOnLoad="1"');
  const sheet = files["xl/worksheets/sheet1.xml"];
  expect(sheet).toContain("<f>B2*0.4</f>");
  expect(sheet).toContain("<f>SUM(C2:C3)</f>");
  expect(sheet).toContain("20260001");
  expect(sheet).toContain('ySplit="1"');
  // 缺录写空单元格，不写 0，避免把缺失当成真实零分。
  expect(sheet).not.toContain('<c r="B3"><v>0</v></c>');
});
