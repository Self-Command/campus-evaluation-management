import { describe, expect, test } from "vitest";
import { auditActions, auditCategories, auditCategoryLabels, auditResultLabels } from "@/server/audit-actions";

describe("审计动作目录", () => {
  test("每个动作都归入已声明分类并具有中文名称", () => {
    const categories = new Set<string>(auditCategories);
    for (const [name, meta] of Object.entries(auditActions)) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(categories.has(meta.category)).toBe(true);
      expect(meta.label.trim().length).toBeGreaterThan(0);
    }
    for (const category of auditCategories) expect(auditCategoryLabels[category]).toBeTruthy();
  });

  test("高风险备份与恢复动作要求填写理由", () => {
    for (const name of ["BACKUP_CREATED", "BACKUP_UPLOADED", "BACKUP_DOWNLOADED", "BACKUP_DELETED", "DATABASE_RESTORE_PREFLIGHTED", "DATABASE_RESTORE_STARTED"] as const) {
      expect(auditActions[name].category).toBe("BACKUP");
      expect(auditActions[name].requiresReason).toBe(true);
      expect(auditActions[name].highRisk).toBe(true);
    }
    expect(auditActions.DATABASE_RESTORE_COMPLETED.highRisk).toBe(true);
    expect(auditActions.DATABASE_RESTORE_ROLLED_BACK.highRisk).toBe(true);
    expect(auditActions.AUDIT_LOG_PURGED.requiresReason).toBe(true);
    expect(auditActions.AUDIT_LOG_EXPORTED.highRisk).toBe(true);
  });

  test("附件与证明导出分类为导入导出", () => {
    expect(auditActions.ACTIVITY_ATTACHMENTS_EXPORTED.category).toBe("IMPORT_EXPORT");
    expect(auditActions.STUDENT_EVIDENCE_EXPORTED.category).toBe("IMPORT_EXPORT");
    expect(auditActions.ACTIVITY_ATTACHMENTS_EXPORTED.requiresReason).toBe(true);
    expect(auditActions.STUDENT_EVIDENCE_EXPORTED.requiresReason).toBe(true);
  });

  test("审计结果标签覆盖全部状态", () => {
    expect(Object.keys(auditResultLabels).sort()).toEqual(["DENIED", "FAILURE", "PARTIAL", "SUCCESS"]);
  });
});
