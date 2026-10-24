import type { CellInput, SheetSpec } from "@/lib/xlsx/workbook";

// Small spreadsheet-formula evaluator used only by tests. It deliberately understands
// the function/operator subset emitted by the workbook builders so tests can verify the
// real formulas and parameter references instead of trusting cached values alone.

type Scalar = number | string;
type Ref = { sheet?: string; row: number; column: number; raw: string };

type SheetBook = Map<string, SheetSpec>;

const columnIndex = (letters: string) => {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
};

const columnLetters = (index: number) => {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
};

function parseRef(text: string, defaultSheet: string): Ref {
  const bang = text.lastIndexOf("!");
  const sheetPart = bang >= 0 ? text.slice(0, bang) : defaultSheet;
  const cellPart = bang >= 0 ? text.slice(bang + 1) : text;
  const sheet = sheetPart.startsWith("'") && sheetPart.endsWith("'")
    ? sheetPart.slice(1, -1).replaceAll("''", "'")
    : sheetPart;
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(cellPart);
  if (!match) throw new Error(`无法识别的单元格引用：${text}`);
  return { sheet, row: Number(match[2]) - 1, column: columnIndex(match[1]), raw: text };
}

type Token =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "ref"; value: string }
  | { type: "name"; value: string }
  | { type: "op"; value: string };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < formula.length) {
    const rest = formula.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (rest.startsWith('"')) {
      let value = "", cursor = index + 1;
      while (cursor < formula.length) {
        if (formula[cursor] === '"') {
          if (formula[cursor + 1] === '"') { value += '"'; cursor += 2; continue; }
          cursor += 1;
          break;
        }
        value += formula[cursor];
        cursor += 1;
      }
      tokens.push({ type: "string", value });
      index = cursor;
      continue;
    }
    if (rest.startsWith("'")) {
      let sheet = "", cursor = index + 1;
      while (cursor < formula.length) {
        if (formula[cursor] === "'") {
          if (formula[cursor + 1] === "'") { sheet += "'"; cursor += 2; continue; }
          cursor += 1;
          break;
        }
        sheet += formula[cursor];
        cursor += 1;
      }
      if (formula[cursor] !== "!") throw new Error(`工作表引用缺少感叹号：${formula}`);
      const cell = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(formula.slice(cursor + 1));
      if (!cell) throw new Error(`工作表引用缺少单元格：${formula}`);
      tokens.push({ type: "ref", value: `'${sheet.replaceAll("'", "''")}'!${cell[0]}` });
      index = cursor + 1 + cell[0].length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const reference = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(rest);
    if (reference) {
      tokens.push({ type: "ref", value: reference[0] });
      index += reference[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (name) {
      tokens.push({ type: "name", value: name[0] });
      index += name[0].length;
      continue;
    }
    const operator = /^(<=|>=|<>|[+\-*/&=<>(),:])/.exec(rest);
    if (operator) {
      tokens.push({ type: "op", value: operator[0] });
      index += operator[0].length;
      continue;
    }
    throw new Error(`无法识别的公式片段：${formula.slice(index)}`);
  }
  return tokens;
}

const numberValue = (value: Scalar) => typeof value === "number" ? value : value.trim() === "" ? 0 : Number(value);
const textValue = (value: Scalar) => typeof value === "string" ? value : String(value);

class Evaluator {
  private cache = new Map<string, Scalar>();
  private active = new Set<string>();
  constructor(private sheets: SheetBook) {}

  valueOf(sheet: string, row: number, column: number): Scalar {
    const key = `${sheet}!${row}:${column}`;
    const host = this.sheets.get(sheet);
    if (!host) throw new Error(`工作表不存在：${sheet}`);
    const autoHeader = host.autoHeader !== false && host.columns.some((item) => item.header);
    if (autoHeader && row === 0) return host.columns[column]?.header ?? "";
    const sourceRow = autoHeader ? row - 1 : row;
    const cell = host.rows[sourceRow]?.[column];
    return this.readCell(sheet, cell, key);
  }

  private readCell(sheet: string, cell: CellInput | undefined, key: string): Scalar {
    if (cell === undefined || cell === null) return "";
    if (typeof cell === "number") return cell;
    if (typeof cell === "string") return cell;
    if ("formula" in cell) {
      if (this.cache.has(key)) return this.cache.get(key)!;
      if (this.active.has(key)) throw new Error(`检测到循环引用：${key}`);
      this.active.add(key);
      const result = this.evaluate(cell.formula.replace(/^=/, ""), sheet);
      this.active.delete(key);
      this.cache.set(key, result);
      return result;
    }
    return cell.value === null ? "" : cell.value;
  }

  private evaluate(formula: string, sheet: string): Scalar {
    const tokens = tokenize(formula);
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    const peekOperator = (...values: string[]) => {
      const token = peek();
      return token?.type === "op" && typeof token.value === "string" && values.includes(token.value) ? token.value : null;
    };
    const expect = (value: string) => {
      const token = take();
      if (!token || token.type !== "op" || token.value !== value) throw new Error(`公式缺少 ${value}：${formula}`);
    };

    const primary = (): Scalar | Ref[] => {
      const token = take();
      if (!token) throw new Error(`公式意外结束：${formula}`);
      if (token.type === "number" || token.type === "string") return token.value;
      if (token.type === "ref") {
        const first = parseRef(token.value, sheet);
        if (peek()?.type === "op" && peek().type === "op" && (peek() as { value: string }).value === ":") {
          take();
          const secondToken = take();
          if (!secondToken || secondToken.type !== "ref") throw new Error(`区域结束单元格无效：${formula}`);
          const second = parseRef(secondToken.value, sheet);
          if (first.sheet !== second.sheet) throw new Error(`跨表区域暂不支持：${formula}`);
          const cells: Ref[] = [];
          for (let row = Math.min(first.row, second.row); row <= Math.max(first.row, second.row); row += 1)
            for (let column = Math.min(first.column, second.column); column <= Math.max(first.column, second.column); column += 1)
              cells.push({ sheet: first.sheet, row, column, raw: "" });
          return cells;
        }
        return this.valueOf(first.sheet ?? sheet, first.row, first.column);
      }
      if (token.type === "name") {
        expect("(");
        const args: (Scalar | Ref[])[] = [];
        if (!(peek()?.type === "op" && peek()!.value === ")")) {
          do {
            args.push(concat());
          } while (peek()?.type === "op" && peek()!.value === "," && take());
        }
        expect(")");
        return this.call(token.value.toUpperCase(), args);
      }
      if (token.type === "op" && token.value === "(") {
        const value = concat();
        expect(")");
        return value;
      }
      throw new Error(`无法解析的公式标记：${JSON.stringify(token)}`);
    };

    const unary = (): Scalar | Ref[] => {
      if (peek()?.type === "op" && peek()!.value === "-") { take(); return -numberValue(unary() as Scalar); }
      return primary();
    };
    const multiply = (): Scalar | Ref[] => {
      let value = unary() as Scalar;
      while (peekOperator("*", "/")) {
        const operator = take()!.value as string;
        const right = numberValue(unary() as Scalar);
        value = operator === "*" ? numberValue(value) * right : numberValue(value) / right;
      }
      return value;
    };
    const add = (): Scalar | Ref[] => {
      let value = multiply() as Scalar;
      while (peekOperator("+", "-")) {
        const operator = take()!.value as string;
        const right = numberValue(multiply() as Scalar);
        value = operator === "+" ? numberValue(value) + right : numberValue(value) - right;
      }
      return value;
    };
    const comparison = (): Scalar | Ref[] => {
      let value = add() as Scalar;
      while (peekOperator("=", "<>", "<", ">", "<=", ">=")) {
        const operator = take()!.value as string;
        const right = add() as Scalar;
        const leftText = textValue(value), rightText = textValue(right);
        const leftNumber = numberValue(value), rightNumber = numberValue(right);
        const result = operator === "=" ? leftText === rightText
          : operator === "<>" ? leftText !== rightText
            : operator === "<" ? leftNumber < rightNumber
              : operator === ">" ? leftNumber > rightNumber
                : operator === "<=" ? leftNumber <= rightNumber
                  : leftNumber >= rightNumber;
        value = result ? 1 : 0;
      }
      return value;
    };
    const concat = (): Scalar | Ref[] => {
      let value = comparison() as Scalar;
      while (peek()?.type === "op" && peek()!.value === "&") {
        take();
        value = textValue(value) + textValue(comparison() as Scalar);
      }
      return value;
    };

    const result = concat();
    if (Array.isArray(result)) return result.length ? this.valueOf(result[0].sheet!, result[0].row, result[0].column) : "";
    if (position !== tokens.length) throw new Error(`公式存在多余内容：${formula}`);
    return result;
  }

  private call(name: string, args: (Scalar | Ref[])[]): Scalar {
    const values: Scalar[] = args.flatMap((item) => {
      if (!Array.isArray(item)) return [item];
      return item.map((reference) => this.valueOf(reference.sheet!, reference.row, reference.column));
    });
    switch (name) {
      case "IF":
        return numberValue(values[0] ?? 0) !== 0 && textValue(values[0] ?? "") !== "" ? values[1] ?? "" : values[2] ?? "";
      case "N":
        return typeof values[0] === "number" ? values[0] : 0;
      case "SUM":
        return values.reduce<number>((total, value) => total + (typeof value === "number" ? value : 0), 0);
      case "MIN": {
        const numbers = values.filter((value): value is number => typeof value === "number");
        return numbers.length ? Math.min(...numbers) : 0;
      }
      case "MAX": {
        const numbers = values.filter((value): value is number => typeof value === "number");
        return numbers.length ? Math.max(...numbers) : 0;
      }
      case "COUNT":
        return values.filter((value) => typeof value === "number").length;
      default:
        throw new Error(`测试公式求值器不支持函数：${name}`);
    }
  }
}

export function evaluateWorkbook(sheets: SheetSpec[]) {
  const book: SheetBook = new Map(sheets.map((sheet) => [sheet.name, sheet]));
  const evaluator = new Evaluator(book);
  return {
    /** Evaluate a 1-based spreadsheet address such as D5 or '评分规则'!H2. */
    cell(reference: string, sheet = sheets[0]?.name ?? "") {
      const parsed = parseRef(reference, sheet);
      return evaluator.valueOf(parsed.sheet ?? sheet, parsed.row, parsed.column);
    },
    address(row: number, column: number) {
      return `${columnLetters(column)}${row}`;
    },
    row(sheetName: string, row: number) {
      const sheet = book.get(sheetName);
      if (!sheet) throw new Error(`工作表不存在：${sheetName}`);
      const autoHeader = sheet.autoHeader !== false && sheet.columns.some((item) => item.header);
      const width = Math.max(sheet.columns.length, ...sheet.rows.map((item) => item.length), 1);
      const index = row - 1;
      if (autoHeader && row === 1) return Array.from({ length: width }, (_, column) => evaluator.valueOf(sheetName, 0, column));
      return Array.from({ length: width }, (_, column) => evaluator.valueOf(sheetName, index, column));
    },
  };
}
