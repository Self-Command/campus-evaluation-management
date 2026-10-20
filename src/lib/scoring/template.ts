import template from "../../../docs/examples/学校评分模板.json";
import { nodeSchema, type Scheme } from "./types";
type TemplateNode = { id: string; name: string; kind: string; weight?: string; aggregation?: string; cap?: string; missing?: string; children?: TemplateNode[]; deductions?: TemplateNode[] };
export function schoolScheme(): Scheme {
  const nodes: Scheme["nodes"] = [], deductions: Scheme["deductions"] = [];
  const stack: { node: TemplateNode; parentId: string | null; order: number }[] = [{ node: template.root, parentId: null, order: 0 }];
  while (stack.length) {
    const { node, parentId, order } = stack.pop()!;
    nodes.push(nodeSchema.parse({ id: node.id, name: node.name, parentId, order, kind: node.kind === "group" ? node.aggregation === "weighted_sum" ? "WEIGHTED" : "SUM" : node.missing === "required" ? "GRADE" : "ACTIVITY", weight: node.weight ?? "1", cap: node.cap ?? null, required: node.missing === "required", maximum: node.missing === "required" ? "100" : "9999999999" }));
    for (const item of node.deductions ?? []) deductions.push({ id: item.id, nodeId: node.id, name: item.name, coefficient: item.weight ?? "1" });
    for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) stack.push({ node: node.children![i], parentId: node.id, order: i });
  }
  return { nodes, deductions };
}
