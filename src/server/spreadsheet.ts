import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import { fromBuffer } from "yauzl";
import { AccountError } from "@/server/accounts";
async function inspectZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new AccountError("XLSX 文件无效"));
      let entries = 0, size = 0;
      zip.on("error", () => reject(new AccountError("无法读取 XLSX")));
      zip.on("entry", entry => {
        entries++; size += entry.uncompressedSize;
        if (entries > 300 || size > 10 * 1024 * 1024 || entry.fileName.includes("vbaProject") || entry.fileName.startsWith("xl/externalLinks/")) { zip.close(); reject(new AccountError("工作簿过大或包含不支持的内容")); return; }
        if (entry.fileName.startsWith("xl/worksheets/") && entry.fileName.endsWith(".xml")) {
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) { zip.close(); reject(new AccountError("无法读取工作表")); return; }
            let xml = "";
            stream.on("error", () => { zip.close(); reject(new AccountError("无法读取工作表")); });
            stream.on("data", chunk => { xml += chunk.toString("utf8"); });
            stream.on("end", () => {
              if (/<(?:[\w.-]+:)?f(?:\s|\/|>)/.test(xml)) { zip.close(); reject(new AccountError("名单不支持公式，请转换为文本后上传")); return; }
              zip.readEntry();
            });
          });
        } else zip.readEntry();
      });
      zip.on("end", resolve); zip.readEntry();
    });
  });
}
export async function parseAccountFile(
	name: string,
	bytes: Buffer,
	options: { maxRows?: number; maxBytes?: number } = {},
) {
	const maxRows = options.maxRows ?? 100;
	const maxBytes = options.maxBytes ?? 1024 * 1024;
	if (bytes.length > maxBytes || !bytes.length)
		throw new AccountError(
			maxRows > 100
				? "文件需为5MB以内的 CSV 或 XLSX"
				: "文件需为1MB以内的 CSV 或 XLSX",
		);
  let raw: unknown[][];
  if (name.toLowerCase().endsWith(".csv")) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AccountError("CSV 请保存为 UTF-8 编码"); }
    try { raw = parse(text, { bom: true, skip_empty_lines: true, max_record_size: 16000, relax_column_count: false }); } catch { throw new AccountError("CSV 格式无效，请检查列数、引号及编码"); }
  } else if (name.toLowerCase().endsWith(".xlsx")) {
    await inspectZip(bytes);
    try {
      const sheets = await readXlsxFile(bytes);
      if (sheets.length !== 1) throw new Error("Expected one worksheet");
      raw = sheets[0].data;
    } catch { throw new AccountError("XLSX 无法读取，请使用普通文本单元格和单一名单工作表"); }
  } else throw new AccountError("仅支持 CSV 和 XLSX");
  if (raw.length < 2 || raw.length > maxRows + 1) throw new AccountError(`名单需包含表头及1–${maxRows}行学生，每批最多${maxRows}人`);
  if (raw[0].length > 30 || raw.some(row => row.length > 30)) throw new AccountError("每份名单最多30列");
  const headers = raw[0].map(v => String(v ?? "").trim());
  if (headers.some(header => !header)) throw new AccountError("表头不能为空，请删除空白列后重新上传");
  if (new Set(headers).size !== headers.length) throw new AccountError("表头不能重复，请保留每个字段唯一的中文列名");
  const rows = raw.slice(1).map(row => row.map(value => {
    // Numeric Excel student IDs cannot reliably preserve leading zeros or long digits.
    if (typeof value === "number") return { value: String(value), numeric: true };
    if (value === null || value === undefined) return { value: "", numeric: false };
    if (typeof value !== "string") throw new AccountError("名单仅允许文本，不支持日期、公式结果或特殊单元格");
    if (value.length > 200) throw new AccountError("单元格内容不能超过200个字符");
    return { value: value.trim(), numeric: false };
  }));
  return { headers, rows };
}
