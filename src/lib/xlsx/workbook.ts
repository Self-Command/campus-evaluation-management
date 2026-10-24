import { deflateRawSync } from "node:zlib";
import {
  BORDER_COLOR,
  DEFAULT_FONT,
  THEME_STYLES,
  type CellBorders,
  type FontSpec,
  type StyleSpec,
} from "@/lib/xlsx/theme";

// Minimal, dependency-free XLSX writer. Styles are resolved from the shared theme,
// merged ranges receive their fill and border on every covered cell, and each sheet can
// declare its own outline ranges and print profile. Formula cells keep cached values so
// viewers that do not recalculate still show the exported result.

export type CellStyle = string;

export type FormulaCell = {
  formula: string;
  /** Result written for viewers that do not recalculate immediately. */
  cached?: number | string | null;
  style?: CellStyle;
  borders?: CellBorders;
};
export type ValueCell = {
  value: string | number | null;
  style?: CellStyle;
  borders?: CellBorders;
};
export type CellInput = string | number | null | FormulaCell | ValueCell;

export type PrintSetup = {
  orientation?: "portrait" | "landscape";
  /** 8 = A3, 9 = A4. */
  paperSize?: number;
  fitToWidth?: number;
  fitToHeight?: number;
  /** Excel-style row span, e.g. "1:8". */
  repeatRows?: string;
  /** Excel-style column span, e.g. "A:C". */
  repeatColumns?: string;
  /** Excel-style range, e.g. "A1:Z50". */
  printArea?: string;
  margins?: { left?: number; right?: number; top?: number; bottom?: number; header?: number; footer?: number };
  footer?: string;
};

export type Outline = {
  /** Cell range such as "D3:J12". */
  range: string;
  weight?: "medium" | "thick";
};

export type SheetSpec = {
  name: string;
  columns: { header?: string; width?: number }[];
  rows: CellInput[][];
  /** Number of leading rows kept frozen. */
  freezeRows?: number;
  /** Number of leading columns kept frozen. */
  freezeColumns?: number;
  /** Include a header row generated from `columns[].header` at row 1. Defaults to true. */
  autoHeader?: boolean;
  /** Style used by the generated header row. Defaults to "header". */
  headerStyle?: CellStyle;
  /** Cell ranges such as `A1:H1`. */
  merges?: string[];
  /** Lock every cell against editing while still allowing selection and formula inspection. */
  protected?: boolean;
  /** 1-based row heights. */
  rowHeights?: Record<number, number>;
  outlines?: Outline[];
  print?: PrintSetup;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function columnIndex(name: string) {
  let value = 0;
  for (const character of name) value = value * 26 + (character.charCodeAt(0) - 64);
  return value - 1;
}

const RANGE = /^([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)$/;

function parseRange(range: string) {
  const match = RANGE.exec(range);
  if (!match) return null;
  return {
    minRow: Number(match[2]),
    maxRow: Number(match[4]),
    minColumn: columnIndex(match[1]),
    maxColumn: columnIndex(match[3]),
  };
}

type NormalizedCell = {
  kind: "blank" | "text" | "number" | "formula";
  text?: string;
  number?: number;
  formula?: string;
  cached?: number | string;
  style: CellStyle;
  borders?: CellBorders;
  styleId?: number;
};

function normalizeCell(value: CellInput): NormalizedCell {
  if (value === null || value === undefined) return { kind: "blank", style: "default" };
  if (typeof value === "number") return { kind: "number", number: value, style: "default" };
  if (typeof value === "string") return value === "" ? { kind: "blank", style: "default" } : { kind: "text", text: value, style: "default" };
  const style = value.style ?? "default";
  if ("formula" in value) return { kind: "formula", formula: value.formula.replace(/^=/, ""), cached: value.cached ?? undefined, style, borders: value.borders };
  return value.value === null || value.value === ""
    ? { kind: "blank", style, borders: value.borders }
    : typeof value.value === "number"
      ? { kind: "number", number: value.value, style, borders: value.borders }
      : { kind: "text", text: value.value, style, borders: value.borders };
}

function mergeBorders(base: CellBorders | undefined, overrides: CellBorders | undefined) {
  if (!base && !overrides) return undefined;
  return { ...(base ?? {}), ...(overrides ?? {}) };
}

type PreparedSheet = {
  sheet: SheetSpec;
  cells: Map<number, Map<number, NormalizedCell>>;
  maxRow: number;
  maxColumn: number;
};

function prepareSheet(sheet: SheetSpec): PreparedSheet {
  const autoHeader = sheet.autoHeader !== false && sheet.columns.some((column) => column.header);
  const cells = new Map<number, Map<number, NormalizedCell>>();
  let maxRow = 0;
  let maxColumn = 0;
  const put = (row: number, column: number, cell: NormalizedCell) => {
    let line = cells.get(row);
    if (!line) {
      line = new Map();
      cells.set(row, line);
    }
    line.set(column, cell);
    maxRow = Math.max(maxRow, row);
    maxColumn = Math.max(maxColumn, column + 1);
  };

  if (autoHeader) {
    sheet.columns.forEach((column, index) => {
      put(1, index, normalizeCell({ value: column.header ?? "", style: sheet.headerStyle ?? "header" }));
    });
  }
  sheet.rows.forEach((row, index) => {
    const rowNumber = index + (autoHeader ? 2 : 1);
    row.forEach((value, column) => {
      const cell = normalizeCell(value);
      if (cell.kind === "blank" && cell.style === "default" && !cell.borders) return;
      put(rowNumber, column, cell);
    });
  });
  maxRow = Math.max(maxRow, sheet.rows.length + (autoHeader ? 1 : 0));
  maxColumn = Math.max(maxColumn, sheet.columns.length);

  for (const range of sheet.merges ?? []) {
    const parsed = parseRange(range);
    if (!parsed) continue;
    maxRow = Math.max(maxRow, parsed.maxRow);
    maxColumn = Math.max(maxColumn, parsed.maxColumn + 1);
    const topLeft = cells.get(parsed.minRow)?.get(parsed.minColumn);
    if (!topLeft) continue;
    for (let row = parsed.minRow; row <= parsed.maxRow; row += 1) {
      for (let column = parsed.minColumn; column <= parsed.maxColumn; column += 1) {
        if (row === parsed.minRow && column === parsed.minColumn) continue;
        put(row, column, { kind: "blank", style: topLeft.style, borders: topLeft.borders });
      }
    }
  }

  for (const outline of sheet.outlines ?? []) {
    const parsed = parseRange(outline.range);
    if (!parsed) continue;
    const weight = outline.weight ?? "medium";
    maxRow = Math.max(maxRow, parsed.maxRow);
    maxColumn = Math.max(maxColumn, parsed.maxColumn + 1);
    for (let row = parsed.minRow; row <= parsed.maxRow; row += 1) {
      for (let column = parsed.minColumn; column <= parsed.maxColumn; column += 1) {
        const onTop = row === parsed.minRow;
        const onBottom = row === parsed.maxRow;
        const onLeft = column === parsed.minColumn;
        const onRight = column === parsed.maxColumn;
        if (!onTop && !onBottom && !onLeft && !onRight) continue;
        let cell = cells.get(row)?.get(column);
        if (!cell) {
          cell = { kind: "blank", style: "grid" };
          put(row, column, cell);
        }
        cell.borders = {
          ...(cell.borders ?? {}),
          ...(onTop ? { top: weight } : {}),
          ...(onBottom ? { bottom: weight } : {}),
          ...(onLeft ? { left: weight } : {}),
          ...(onRight ? { right: weight } : {}),
        };
      }
    }
  }

  return { sheet, cells, maxRow, maxColumn };
}

function fontKey(font: FontSpec) {
  return JSON.stringify({ bold: !!font.bold, italic: !!font.italic, size: font.size ?? 11, color: font.color ?? "", name: font.name ?? "等线" });
}

function borderKey(border: CellBorders | undefined) {
  if (!border) return "";
  return (["left", "right", "top", "bottom"] as const).map((side) => `${side}:${border[side] ?? ""}`).join("|");
}

class StyleRegistry {
  private fonts: FontSpec[] = [DEFAULT_FONT];
  private fontIds = new Map<string, number>([[fontKey(DEFAULT_FONT), 0]]);
  private fills: (string | null)[] = [null, "gray125"];
  private fillIds = new Map<string, number>([
    ["none", 0],
    ["gray125", 1],
  ]);
  private borders: CellBorders[] = [{}];
  private borderIds = new Map<string, number>([["", 0]]);
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private xfIds = new Map<string, number>([["default", 0]]);

  private fontId(font: FontSpec) {
    const key = fontKey(font);
    const existing = this.fontIds.get(key);
    if (existing !== undefined) return existing;
    const id = this.fonts.length;
    this.fonts.push(font);
    this.fontIds.set(key, id);
    return id;
  }

  private fillId(color: string) {
    const existing = this.fillIds.get(color);
    if (existing !== undefined) return existing;
    const id = this.fills.length;
    this.fills.push(color);
    this.fillIds.set(color, id);
    return id;
  }

  private borderId(border: CellBorders | undefined) {
    const key = borderKey(border);
    const existing = this.borderIds.get(key);
    if (existing !== undefined) return existing;
    const id = this.borders.length;
    this.borders.push(border ?? {});
    this.borderIds.set(key, id);
    return id;
  }

  idFor(styleName: CellStyle, overrides?: CellBorders) {
    const base: StyleSpec = THEME_STYLES[styleName] ?? THEME_STYLES.default;
    const fontId = this.fontId(base.font ?? DEFAULT_FONT);
    const fillId = base.fill ? this.fillId(base.fill) : 0;
    const border = mergeBorders(base.border, overrides);
    const borderId = border ? this.borderId(border) : 0;
    const numFmtId = base.numFmtId ?? 0;
    const alignment = base.alignment;
    const key = JSON.stringify([fontId, fillId, borderId, numFmtId, alignment ?? null]);
    const existing = this.xfIds.get(key);
    if (existing !== undefined) return existing;
    const id = this.xfs.length;
    const attrs = [`numFmtId="${numFmtId}"`, `fontId="${fontId}"`, `fillId="${fillId}"`, `borderId="${borderId}"`, `xfId="0"`];
    if (fontId) attrs.push('applyFont="1"');
    if (fillId) attrs.push('applyFill="1"');
    if (borderId) attrs.push('applyBorder="1"');
    if (numFmtId) attrs.push('applyNumberFormat="1"');
    if (alignment) attrs.push('applyAlignment="1"');
    const alignmentAttrs = alignment
      ? [
          alignment.horizontal ? `horizontal="${alignment.horizontal}"` : "",
          alignment.vertical ? `vertical="${alignment.vertical}"` : "",
          alignment.wrapText ? 'wrapText="1"' : "",
        ].filter(Boolean)
      : [];
    const alignmentXml = alignmentAttrs.length ? `<alignment ${alignmentAttrs.join(" ")}/>` : "";
    this.xfs.push(`<xf ${attrs.join(" ")}>${alignmentXml}</xf>`);
    this.xfIds.set(key, id);
    return id;
  }

  toXml() {
    const fonts = this.fonts
      .map((font) => {
        const parts = [
          font.bold ? "<b/>" : "",
          font.italic ? "<i/>" : "",
          `<sz val="${font.size ?? 11}"/>`,
          font.color ? `<color rgb="${font.color}"/>` : "",
          `<name val="${escapeXml(font.name ?? "等线")}"/>`,
          '<family val="2"/>',
        ];
        return `<font>${parts.join("")}</font>`;
      })
      .join("");
    const fills = this.fills
      .map((color) => {
        if (color === null) return '<fill><patternFill patternType="none"/></fill>';
        if (color === "gray125") return '<fill><patternFill patternType="gray125"/></fill>';
        return `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`;
      })
      .join("");
    const side = (tag: "left" | "right" | "top" | "bottom", weight?: string) =>
      weight ? `<${tag} style="${weight}"><color rgb="${BORDER_COLOR}"/></${tag}>` : `<${tag}/>`;
    const borders = this.borders
      .map((border) => `<border>${side("left", border.left)}${side("right", border.right)}${side("top", border.top)}${side("bottom", border.bottom)}<diagonal/></border>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${this.fonts.length}">${fonts}</fonts>
<fills count="${this.fills.length}">${fills}</fills>
<borders count="${this.borders.length}">${borders}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>
</styleSheet>`;
  }
}

function cellXml(reference: string, cell: NormalizedCell) {
  const styleId = cell.styleId ?? 0;
  const styleAttr = styleId ? ` s="${styleId}"` : "";
  if (cell.kind === "blank") return styleId ? `<c r="${reference}"${styleAttr}/>` : "";
  if (cell.kind === "number") {
    if (!Number.isFinite(cell.number!)) return styleId ? `<c r="${reference}"${styleAttr}/>` : "";
    return `<c r="${reference}"${styleAttr}><v>${cell.number}</v></c>`;
  }
  if (cell.kind === "text") {
    return `<c r="${reference}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.text!)}</t></is></c>`;
  }
  const formula = `<f>${escapeXml(cell.formula!)}</f>`;
  const cached = cell.cached;
  if (typeof cached === "number" && Number.isFinite(cached)) return `<c r="${reference}"${styleAttr}>${formula}<v>${cached}</v></c>`;
  if (typeof cached === "string" && cached !== "") return `<c r="${reference}"${styleAttr} t="str">${formula}<v>${escapeXml(cached)}</v></c>`;
  return `<c r="${reference}"${styleAttr}>${formula}</c>`;
}

function sheetXml(prepared: PreparedSheet) {
  const { sheet, cells, maxRow, maxColumn } = prepared;
  const rowNumbers = new Set<number>(cells.keys());
  for (const row of Object.keys(sheet.rowHeights ?? {})) rowNumbers.add(Number(row));
  const bodyRows = [...rowNumbers]
    .sort((a, b) => a - b)
    .map((row) => {
      const line = cells.get(row);
      const height = sheet.rowHeights?.[row];
      const heightAttr = height ? ` ht="${height}" customHeight="1"` : "";
      const content = line
        ? [...line.entries()]
            .sort(([a], [b]) => a - b)
            .map(([column, cell]) => cellXml(`${columnName(column)}${row}`, cell))
            .join("")
        : "";
      return `<row r="${row}"${heightAttr}>${content}</row>`;
    })
    .join("");
  const freezeRows = Math.max(0, Math.min(sheet.freezeRows ?? 0, 100));
  const freezeColumns = Math.max(0, Math.min(sheet.freezeColumns ?? 0, 100));
  const topLeftCell = `${columnName(freezeColumns)}${freezeRows + 1}`;
  const activePane = freezeRows && freezeColumns ? "bottomRight" : freezeRows ? "bottomLeft" : "topRight";
  const pane = freezeRows || freezeColumns
    ? `<pane${freezeColumns ? ` xSplit="${freezeColumns}"` : ""}${freezeRows ? ` ySplit="${freezeRows}"` : ""} topLeftCell="${topLeftCell}" activePane="${activePane}" state="frozen"/>`
    : "";
  const cols = sheet.columns.length
    ? `<cols>${sheet.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 16}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const protection = sheet.protected ? '<sheetProtection sheet="1" objects="1" scenarios="1"/>' : "";
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((range) => `<mergeCell ref="${range}"/>`).join("")}</mergeCells>`
    : "";
  const print = sheet.print;
  const fit = !!print && (print.fitToWidth !== undefined || print.fitToHeight !== undefined);
  const sheetPr = fit ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : "";
  const printOptions = print ? '<printOptions horizontalCentered="1"/>' : "";
  const margins = print
    ? `<pageMargins left="${print.margins?.left ?? 0.25}" right="${print.margins?.right ?? 0.25}" top="${print.margins?.top ?? 0.45}" bottom="${print.margins?.bottom ?? 0.45}" header="${print.margins?.header ?? 0.2}" footer="${print.margins?.footer ?? 0.2}"/>`
    : "";
  const pageSetup = print
    ? `<pageSetup paperSize="${print.paperSize ?? 9}" orientation="${print.orientation ?? "landscape"}"${fit ? ` fitToWidth="${print.fitToWidth ?? 1}" fitToHeight="${print.fitToHeight ?? 0}"` : ""} horizontalDpi="300" verticalDpi="300"/>`
    : "";
  const headerFooter = print?.footer ? `<headerFooter><oddFooter>${escapeXml(print.footer)}</oddFooter></headerFooter>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheetPr}<dimension ref="A1:${columnName(Math.max(maxColumn - 1, 0))}${Math.max(maxRow, 1)}"/><sheetViews><sheetView workbookViewId="0"${freezeRows || freezeColumns ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${bodyRows}</sheetData>${protection}${merges}${printOptions}${margins}${pageSetup}${headerFooter}</worksheet>`;
}

function absoluteReference(reference: string) {
  return reference.replace(/^([A-Z]+)([0-9]+)$/, "$$$1$$$2");
}

function absoluteRange(range: string) {
  return range.split(":").map(absoluteReference).join(":");
}

function sheetNameForFormula(name: string) {
  return name.replaceAll("'", "''");
}

function definedNamesXml(sheets: SheetSpec[]) {
  const entries: string[] = [];
  sheets.forEach((sheet, index) => {
    const name = sheetNameForFormula(sheet.name);
    const titles: string[] = [];
    if (sheet.print?.repeatRows) titles.push(`'${name}'!$${sheet.print.repeatRows}`);
    if (sheet.print?.repeatColumns) titles.push(`'${name}'!$${sheet.print.repeatColumns}`);
    if (titles.length) entries.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXml(titles.join(","))}</definedName>`);
    if (sheet.print?.printArea) entries.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}">${escapeXml(`'${name}'!${absoluteRange(sheet.print.printArea)}`)}</definedName>`);
  });
  return entries.length ? `<definedNames>${entries.join("")}</definedNames>` : "";
}

function workbookFiles(sheets: SheetSpec[]) {
  if (!sheets.length) throw new Error("工作簿至少需要一个工作表");
  const prepared = sheets.map(prepareSheet);
  const registry = new StyleRegistry();
  let hasFormulas = false;
  for (const sheet of prepared) {
    for (const line of sheet.cells.values()) {
      for (const cell of line.values()) {
        cell.styleId = registry.idFor(cell.style, cell.borders);
        if (cell.kind === "formula") hasFormulas = true;
      }
    }
  }
  const worksheets = prepared.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: Buffer.from(sheetXml(sheet), "utf8") }));
  const overrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const sheetRels = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("");
  const calc = hasFormulas
    ? '<calcPr calcId="191029" calcMode="auto" forceFullCalc="1" fullCalcOnLoad="1"/>'
    : '<calcPr calcId="191029" calcMode="auto"/>';
  return [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
        "utf8",
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "utf8",
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets>${definedNamesXml(sheets)}${calc}</workbook>`,
        "utf8",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
        "utf8",
      ),
    },
    ...worksheets,
    { name: "xl/styles.xml", data: Buffer.from(registry.toXml(), "utf8") },
  ];
}

export function buildWorkbook(sheet: SheetSpec) {
  return createZip(workbookFiles([sheet]));
}

/** Multi-sheet workbook: the grade detail sheet plus the human-readable rules sheet. */
export function buildMultiSheetWorkbook(sheets: SheetSpec[]) {
  return createZip(workbookFiles(sheets));
}
