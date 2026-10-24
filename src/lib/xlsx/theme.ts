export type BorderWeight = "thin" | "medium" | "thick";
export type BorderSide = "top" | "right" | "bottom" | "left";
export type CellBorders = Partial<Record<BorderSide, BorderWeight>>;

export type FontSpec = {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  name?: string;
};

export type AlignmentSpec = {
  horizontal?: "left" | "center" | "right";
  vertical?: "top" | "center" | "bottom";
  wrapText?: boolean;
};

export type StyleSpec = {
  font?: FontSpec;
  fill?: string;
  border?: CellBorders;
  alignment?: AlignmentSpec;
  numFmtId?: number;
};

const BLACK = "FF000000";
const WHITE = "FFFFFFFF";
const allThin: CellBorders = { top: "thin", right: "thin", bottom: "thin", left: "thin" };
const centered: AlignmentSpec = { horizontal: "center", vertical: "center" };
const centeredWrap: AlignmentSpec = { horizontal: "center", vertical: "center", wrapText: true };
const leftWrap: AlignmentSpec = { horizontal: "left", vertical: "center", wrapText: true };

const normalFont: FontSpec = { name: "等线", size: 11 };
const boldFont: FontSpec = { name: "等线", size: 11, bold: true };
const headerFont: FontSpec = { name: "等线", size: 10, bold: true };
const groupFont: FontSpec = { name: "等线", size: 11, bold: true };
const metaFont: FontSpec = { name: "等线", size: 10, color: "FF595959" };
const mutedFont: FontSpec = { name: "等线", size: 9, color: "FF7F7F7F", italic: true };

// Pastel header bands keep every module visually separate while staying printable in
// black and white. The layout assigns bands by module order, never by module name, so a
// renamed, inserted or removed module still gets a complete, readable colour band.
const BAND_PALETTE = [
  { header: "FFFFF2CC", group: "FFFFE699" },
  { header: "FFE2EFDA", group: "FFC6E0B4" },
  { header: "FFDDEBF7", group: "FFBDD7EE" },
  { header: "FFFCE4EC", group: "FFF7C6D9" },
  { header: "FFD9F2F2", group: "FFB7E1E1" },
  { header: "FFFBE5D6", group: "FFF8CBAD" },
  { header: "FFE4DFEC", group: "FFCCC1DA" },
  { header: "FFEDEDED", group: "FFD9D9D9" },
] as const;

export const BAND_COUNT = BAND_PALETTE.length;

export function bandStyle(index: number, level: "header" | "group" = "header") {
  const normalized = ((index % BAND_COUNT) + BAND_COUNT) % BAND_COUNT;
  return `band${normalized}${level === "group" ? "Group" : ""}`;
}

const styles: Record<string, StyleSpec> = {
  default: {},
  title: { font: { name: "等线", size: 18, bold: true, color: "FF1F2937" }, alignment: centered },
  subtitle: { font: { name: "等线", size: 12, bold: true }, alignment: centeredWrap },
  meta: { font: metaFont, alignment: centeredWrap },
  metaLeft: { font: metaFont, alignment: leftWrap },
  header: { font: headerFont, fill: "FFD9E1F2", border: allThin, alignment: centeredWrap },
  fixedHeader: { font: headerFont, fill: "FFD9E1F2", border: allThin, alignment: centeredWrap },
  group: { font: groupFont, fill: "FFDDEBF7", border: allThin, alignment: centeredWrap },
  deductionHeader: { font: headerFont, fill: "FFFCE4EC", border: allThin, alignment: centeredWrap },
  resultHeader: { font: headerFont, fill: "FFDDEBF7", border: allThin, alignment: centeredWrap },
  input: { font: normalFont, fill: "FFFFF2CC", border: allThin, alignment: centered, numFmtId: 2 },
  inputReadonly: { font: normalFont, fill: WHITE, border: allThin, alignment: centered, numFmtId: 2 },
  formula: { font: normalFont, fill: WHITE, border: allThin, alignment: centered, numFmtId: 2 },
  formulaText: { font: normalFont, fill: WHITE, border: allThin, alignment: centered },
  percent: { font: normalFont, fill: WHITE, border: allThin, alignment: centered, numFmtId: 10 },
  text: { font: normalFont, fill: WHITE, border: allThin, alignment: centered },
  textLeft: { font: normalFont, fill: WHITE, border: allThin, alignment: { horizontal: "left", vertical: "center", wrapText: true } },
  total: { font: boldFont, fill: "FFE2EFDA", border: allThin, alignment: centered, numFmtId: 2 },
  status: { font: normalFont, fill: WHITE, border: allThin, alignment: centered },
  signature: { font: normalFont, fill: WHITE, border: allThin, alignment: centered },
  grid: { font: normalFont, fill: WHITE, border: allThin, alignment: centered },
  note: { font: metaFont, alignment: leftWrap },
  muted: { font: mutedFont, alignment: leftWrap },
};

for (let index = 0; index < BAND_PALETTE.length; index += 1) {
  const palette = BAND_PALETTE[index];
  styles[`band${index}`] = { font: headerFont, fill: palette.header, border: allThin, alignment: centeredWrap };
  styles[`band${index}Group`] = { font: groupFont, fill: palette.group, border: allThin, alignment: centeredWrap };
  styles[`band${index}Left`] = { font: headerFont, fill: palette.header, border: allThin, alignment: leftWrap };
  styles[`band${index}GroupLeft`] = { font: groupFont, fill: palette.group, border: allThin, alignment: leftWrap };
}

export const THEME_STYLES: Readonly<Record<string, StyleSpec>> = styles;

export const DEFAULT_FONT: FontSpec = normalFont;
export const BORDER_COLOR = BLACK;
