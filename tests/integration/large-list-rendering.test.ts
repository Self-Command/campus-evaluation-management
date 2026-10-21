import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { expect, test } from "vitest";

const guardedFiles = [
  "src/app/(workspace)/publication/_components/publication.tsx",
  "src/app/(workspace)/imports/_components/import-wizard.tsx",
];

const unboundedSources = [
  "preview.missing",
  "preview.cohortChanges?.added",
  "preview.cohortChanges?.removed",
  "snapshot.data.payload?.results",
  "preview.rows",
];

test("发布预检、快照和导入预览不得直接渲染整批学生名单", () => {
  const violations: string[] = [];
  for (const file of guardedFiles) {
    const path = join(process.cwd(), file);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText() === "map"
      ) {
        const target = node.expression.expression.getText();
        if (unboundedSources.includes(target)) {
          const position = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          violations.push(`${file}:${position.line + 1} ${target}.map(...)`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
