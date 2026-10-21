import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { expect, test } from "vitest";

function tsxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? tsxFiles(path)
      : path.endsWith(".tsx")
        ? [path]
        : [];
  });
}

function tagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  return node.tagName.getText();
}

function hasExplicitType(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  return node.attributes.properties.some(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === "type",
  );
}

test("表单内的按钮必须显式声明 type，避免默认 type=button 阻断提交", () => {
  const root = process.cwd();
  const violations: string[] = [];

  for (const file of tsxFiles(join(root, "src"))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    function visit(node: ts.Node, insideForm = false) {
      const isForm =
        (ts.isJsxElement(node) && tagName(node.openingElement) === "form") ||
        (ts.isJsxSelfClosingElement(node) && tagName(node) === "form");
      const nextInsideForm = insideForm || isForm;

      if (
        insideForm &&
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ["Button", "button"].includes(tagName(node)) &&
        !hasExplicitType(node)
      ) {
        const position = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        violations.push(
          `${relative(root, file).replaceAll("\\", "/")}:${position.line + 1}`,
        );
      }

      ts.forEachChild(node, (child) => visit(child, nextInsideForm));
    }

    visit(source);
  }

  expect(violations).toEqual([]);
});
