export const auditCategories = [
  "AUTH",
  "ACCOUNT",
  "ORG",
  "TERM",
  "ACTIVITY",
  "PARTICIPATION",
  "CLAIM",
  "GRADE",
  "DEDUCTION",
  "PUBLICATION",
  "APPEAL",
  "IMPORT_EXPORT",
  "SETTINGS",
  "BACKUP",
  "LOG",
  "SYSTEM",
] as const;

export type AuditCategory = (typeof auditCategories)[number];
export type AuditResult = "SUCCESS" | "FAILURE" | "DENIED" | "PARTIAL";

export const auditCategoryLabels: Record<AuditCategory, string> = {
  AUTH: "登录认证",
  ACCOUNT: "账号与档案",
  ORG: "组织结构",
  TERM: "测评周期",
  ACTIVITY: "活动管理",
  PARTICIPATION: "参与认定",
  CLAIM: "成果申报",
  GRADE: "成绩管理",
  DEDUCTION: "扣分管理",
  PUBLICATION: "结果发布",
  APPEAL: "成绩异议",
  IMPORT_EXPORT: "导入导出",
  SETTINGS: "系统设置",
  BACKUP: "备份恢复",
  LOG: "操作日志",
  SYSTEM: "系统任务",
};

export const auditResultLabels: Record<AuditResult, string> = {
  SUCCESS: "成功",
  FAILURE: "失败",
  DENIED: "拒绝",
  PARTIAL: "部分成功",
};

export type ActionMeta = {
  category: AuditCategory;
  label: string;
  targetType?: string;
  requiresReason?: boolean;
  highRisk?: boolean;
};

export const auditActions = {
  AUTH_LOGIN_SUCCEEDED: { category: "AUTH", label: "登录成功", targetType: "AuthSession" },
  AUTH_LOGIN_FAILED: { category: "AUTH", label: "登录失败" },
  AUTH_LOGIN_LOCKED: { category: "AUTH", label: "账号锁定" },
  AUTH_LOGOUT: { category: "AUTH", label: "退出登录", targetType: "AuthSession" },
  AUTH_PASSWORD_CHANGED: { category: "AUTH", label: "修改本人密码", targetType: "User" },
  AUTH_ADMIN_REAUTH_FAILED: { category: "AUTH", label: "管理员二次认证失败" },
  PASSWORD_CHANGED: { category: "AUTH", label: "修改本人密码", targetType: "User" },
  LOGIN: { category: "AUTH", label: "登录成功", targetType: "AuthSession" },

  ACCOUNT_CREATED: { category: "ACCOUNT", label: "创建账号", targetType: "User", highRisk: true },
  ACCOUNT_UPDATED: { category: "ACCOUNT", label: "更新账号", targetType: "User", requiresReason: true, highRisk: true },
  ACCOUNT_DELETED: { category: "ACCOUNT", label: "删除账号", targetType: "User", requiresReason: true, highRisk: true },
  ACCOUNT_DUPLICATE_DISABLED: { category: "ACCOUNT", label: "停用重复账号", targetType: "User", requiresReason: true, highRisk: true },
  PASSWORD_RESET: { category: "ACCOUNT", label: "重置账号密码", targetType: "User", requiresReason: true, highRisk: true },
  SELF_ACCOUNT_UPDATED: { category: "ACCOUNT", label: "更新本人资料", targetType: "User" },
  STUDENT_PROFILE_UPDATED: { category: "ACCOUNT", label: "更正学生档案", targetType: "StudentProfile", requiresReason: true, highRisk: true },
  STUDENT_NUMBER_CORRECTED: { category: "ACCOUNT", label: "更正学号", targetType: "StudentProfile", requiresReason: true, highRisk: true },
  ACCOUNT_IMPORTED: { category: "IMPORT_EXPORT", label: "导入账号", targetType: "AccountImport", highRisk: true },
  ACCOUNT_IMPORT_COMMITTED: { category: "IMPORT_EXPORT", label: "提交账号导入", targetType: "AccountImport", highRisk: true },
  ACCOUNT_IMPORT_REVOKED: { category: "IMPORT_EXPORT", label: "撤销账号导入", targetType: "AccountImport", requiresReason: true, highRisk: true },
  INITIAL_ADMIN_CREATED: { category: "SYSTEM", label: "初始化管理员账号", targetType: "User", highRisk: true },

  ORGANIZATION_SAVED: { category: "ORG", label: "保存组织", targetType: "Organization", requiresReason: true, highRisk: true },
  ORGANIZATION_DELETED: { category: "ORG", label: "删除组织", targetType: "Organization", requiresReason: true, highRisk: true },

  TERM_CREATED: { category: "TERM", label: "创建测评周期", targetType: "Term", highRisk: true },
  TERM_RENAME: { category: "TERM", label: "重命名测评周期", targetType: "Term", requiresReason: true, highRisk: true },
  TERM_DELETE: { category: "TERM", label: "删除测评周期", targetType: "Term", requiresReason: true, highRisk: true },
  TERM_RESTORE: { category: "TERM", label: "恢复测评周期", targetType: "Term", requiresReason: true, highRisk: true },
  TERM_VOID: { category: "TERM", label: "作废测评周期", targetType: "Term", requiresReason: true, highRisk: true },
  TERM_ARCHIVE: { category: "TERM", label: "归档测评周期", targetType: "Term", requiresReason: true, highRisk: true },
  TERM_UNARCHIVE: { category: "TERM", label: "取消归档测评周期", targetType: "Term", requiresReason: true, highRisk: true },
  TERM_ACTIVATED: { category: "TERM", label: "启用测评周期", targetType: "Term", highRisk: true },
  TERM_LOCKED: { category: "TERM", label: "锁定测评结果", targetType: "SettlementSnapshot", highRisk: true },
  TERM_REOPENED: { category: "TERM", label: "重开测评周期", targetType: "TermReopen", requiresReason: true, highRisk: true },
  SCHEME_SAVED: { category: "TERM", label: "保存评分方案", targetType: "Term", highRisk: true },
  CHECKING_EXTENDED: { category: "TERM", label: "延长结果核对期限", targetType: "PublicationExtension", requiresReason: true },
  PUBLICATION_COHORT_CHANGED: { category: "TERM", label: "变更发布名册口径", targetType: "Term", requiresReason: true, highRisk: true },

  ACTIVITY_CREATED: { category: "ACTIVITY", label: "创建活动", targetType: "Activity" },
  ACTIVITY_UPDATED: { category: "ACTIVITY", label: "更新活动", targetType: "Activity" },
  ACTIVITY_HOST_REASSIGNED: { category: "ACTIVITY", label: "移交活动主办学院", targetType: "Activity", requiresReason: true, highRisk: true },
  ACTIVITY_PUBLISHED: { category: "ACTIVITY", label: "发布活动", targetType: "Activity", highRisk: true },
  ACTIVITY_UNPUBLISHED: { category: "ACTIVITY", label: "撤回活动发布", targetType: "Activity", highRisk: true },
  ACTIVITY_ENDED: { category: "ACTIVITY", label: "结束活动", targetType: "Activity" },
  ACTIVITY_REOPENED: { category: "ACTIVITY", label: "重新开放活动", targetType: "Activity" },
  ACTIVITY_EVIDENCE_ADDED: { category: "ACTIVITY", label: "上传活动证明", targetType: "ActivityEvidence" },
  ACTIVITY_EVIDENCE_REPLACED: { category: "ACTIVITY", label: "更换活动证明", targetType: "ActivityEvidence" },
  ACTIVITY_ATTACHMENT_UPLOADED: { category: "ACTIVITY", label: "上传活动附件", targetType: "ActivityAttachment" },
  ACTIVITY_ATTACHMENT_DELETED: { category: "ACTIVITY", label: "删除活动附件", targetType: "ActivityAttachment" },
  ACTIVITY_ATTACHMENT_DOWNLOADED: { category: "ACTIVITY", label: "下载活动附件", targetType: "ActivityAttachment" },

  PARTICIPATION_REVIEWED: { category: "PARTICIPATION", label: "审核活动参与", targetType: "Participation" },
  PARTICIPATION_BATCH_REVIEWED: { category: "PARTICIPATION", label: "批量审核活动参与", targetType: "ReviewBatch" },
  PARTICIPATION_CHANGED: { category: "PARTICIPATION", label: "变更活动参与", targetType: "Participation" },
  PARTICIPATION_IMPORT_COMMITTED: { category: "IMPORT_EXPORT", label: "提交活动名单导入", targetType: "ParticipationImport", highRisk: true },

  CLAIM_SUBMITTED: { category: "CLAIM", label: "提交成果申报", targetType: "PersonalClaim" },
  CLAIM_CHANGED: { category: "CLAIM", label: "处理成果申报", targetType: "PersonalClaim" },
  CLAIM_BATCH_CHANGED: { category: "CLAIM", label: "批量处理成果申报", targetType: "ReviewBatch" },

  GRADE_SAVED: { category: "GRADE", label: "保存成绩", targetType: "GradeInput", requiresReason: true, highRisk: true },
  GRADE_IMPORT_SUBMITTED: { category: "IMPORT_EXPORT", label: "提交成绩导入预检", targetType: "GradeImport" },
  GRADE_IMPORTED: { category: "GRADE", label: "导入成绩", targetType: "GradeInput", requiresReason: true, highRisk: true },
  GRADE_IMPORT_COMMITTED: { category: "IMPORT_EXPORT", label: "提交成绩导入", targetType: "GradeImport", highRisk: true },
  GRADE_CHANGE_SUBMITTED: { category: "GRADE", label: "提交成绩修改", targetType: "GradeChange", requiresReason: true, highRisk: true },
  GRADE_APPROVED: { category: "GRADE", label: "审核成绩修改", targetType: "GradeChange", requiresReason: true, highRisk: true },
  GRADE_CHANGE_CHANGED: { category: "GRADE", label: "处理成绩修改", targetType: "GradeChange" },
  GRADE_BATCH_CHANGED: { category: "GRADE", label: "批量处理成绩修改", targetType: "ReviewBatch" },
  GRADE_DETAIL_EXPORTED: { category: "IMPORT_EXPORT", label: "导出成绩明细", targetType: "Term", highRisk: true },
  GRADE_STATEMENT_EXPORTED: { category: "IMPORT_EXPORT", label: "导出成绩单", targetType: "Term", highRisk: true },
  SCORING_CORRECTED: { category: "GRADE", label: "更正计分结果", targetType: "Term", requiresReason: true, highRisk: true },

  DEDUCTION_SAVED: { category: "DEDUCTION", label: "保存扣分", targetType: "DeductionInput", requiresReason: true, highRisk: true },
  DEDUCTION_REVOKED: { category: "DEDUCTION", label: "撤销扣分", targetType: "DeductionInput", requiresReason: true, highRisk: true },
  DEDUCTION_CHANGE_SUBMITTED: { category: "DEDUCTION", label: "提交扣分申请", targetType: "DeductionChange", requiresReason: true },
  DEDUCTION_REVOKE_SUBMITTED: { category: "DEDUCTION", label: "提交扣分撤销申请", targetType: "DeductionChange", requiresReason: true },
  DEDUCTION_APPROVED: { category: "DEDUCTION", label: "审核扣分申请", targetType: "DeductionChange", requiresReason: true, highRisk: true },
  DEDUCTION_REVOKED_APPROVED: { category: "DEDUCTION", label: "审核扣分撤销", targetType: "DeductionChange", requiresReason: true, highRisk: true },
  DEDUCTION_CHANGE_CHANGED: { category: "DEDUCTION", label: "处理扣分申请", targetType: "DeductionChange" },
  DEDUCTION_BATCH_CHANGED: { category: "DEDUCTION", label: "批量处理扣分申请", targetType: "ReviewBatch" },

  RESULTS_PUBLISHED: { category: "PUBLICATION", label: "发布测评结果", targetType: "ResultPublication", highRisk: true },
  RESULT_CONFIRMED: { category: "PUBLICATION", label: "确认本人测评结果", targetType: "PublishedResult" },
  APPEAL_CREATED: { category: "APPEAL", label: "提交成绩异议", targetType: "ResultAppeal" },
  APPEAL_CHANGED: { category: "APPEAL", label: "处理成绩异议", targetType: "ResultAppeal" },
  APPEAL_BATCH_CHANGED: { category: "APPEAL", label: "批量处理成绩异议", targetType: "ReviewBatch" },

  SETTINGS_CHANGED: { category: "SETTINGS", label: "保存系统设置", targetType: "SiteSettings", requiresReason: true, highRisk: true },
  BRAND_ASSET_UPLOADED: { category: "SETTINGS", label: "上传品牌资源", targetType: "BrandAsset" },
  SYSTEM_POLICY_UPDATED: { category: "SETTINGS", label: "保存运行策略", targetType: "SystemPolicy", requiresReason: true, highRisk: true },

  AUDIT_LOG_EXPORT_STARTED: { category: "LOG", label: "开始导出操作日志", targetType: "AuditEvent" },
  AUDIT_LOG_EXPORTED: { category: "LOG", label: "导出操作日志", targetType: "AuditEvent", highRisk: true },
  AUDIT_LOG_EXPORT_FAILED: { category: "LOG", label: "操作日志导出失败", targetType: "AuditEvent" },
  AUDIT_LOG_PURGED: { category: "LOG", label: "清理操作日志", targetType: "AuditEvent", requiresReason: true, highRisk: true },
  AUDIT_RETENTION_CHANGED: { category: "LOG", label: "修改日志保留期", targetType: "SystemPolicy", requiresReason: true, highRisk: true },

  BACKUP_CREATED: { category: "BACKUP", label: "创建数据库备份", targetType: "Backup", requiresReason: true, highRisk: true },
  BACKUP_UPLOADED: { category: "BACKUP", label: "上传数据库备份", targetType: "Backup", requiresReason: true, highRisk: true },
  BACKUP_DOWNLOADED: { category: "BACKUP", label: "下载数据库备份", targetType: "Backup", requiresReason: true, highRisk: true },
  BACKUP_DELETED: { category: "BACKUP", label: "删除数据库备份", targetType: "Backup", requiresReason: true, highRisk: true },
  DATABASE_RESTORE_PREFLIGHTED: { category: "BACKUP", label: "预检数据库恢复", targetType: "Backup", requiresReason: true, highRisk: true },
  DATABASE_RESTORE_ABORTED: { category: "BACKUP", label: "中止数据库恢复预检", targetType: "Backup" },
  DATABASE_RESTORE_STARTED: { category: "BACKUP", label: "开始数据库恢复", targetType: "Backup", requiresReason: true, highRisk: true },
  DATABASE_RESTORE_COMPLETED: { category: "BACKUP", label: "完成数据库恢复", targetType: "Backup", highRisk: true },
  DATABASE_RESTORE_FAILED: { category: "BACKUP", label: "数据库恢复失败", targetType: "Backup", highRisk: true },
  DATABASE_RESTORE_AUDIT_IMPORTED: { category: "BACKUP", label: "回导恢复前审计记录", targetType: "Backup" },
  DATABASE_RESTORE_SECURITY_RESET: { category: "BACKUP", label: "重置恢复后安全状态", targetType: "Backup" },
  DATABASE_RESTORE_ROLLED_BACK: { category: "BACKUP", label: "回滚数据库恢复", targetType: "Backup", highRisk: true },

  STUDENT_EVIDENCE_EXPORT_STARTED: { category: "IMPORT_EXPORT", label: "开始导出学生证明", targetType: "Evidence" },
  STUDENT_EVIDENCE_EXPORTED: { category: "IMPORT_EXPORT", label: "导出学生证明", targetType: "Evidence", requiresReason: true, highRisk: true },
  STUDENT_EVIDENCE_EXPORT_FAILED: { category: "IMPORT_EXPORT", label: "学生证明导出失败", targetType: "Evidence" },
  ACTIVITY_ATTACHMENTS_EXPORT_STARTED: { category: "IMPORT_EXPORT", label: "开始导出活动附件", targetType: "ActivityAttachment" },
  ACTIVITY_ATTACHMENTS_EXPORTED: { category: "IMPORT_EXPORT", label: "导出活动附件", targetType: "ActivityAttachment", requiresReason: true, highRisk: true },
  ACTIVITY_ATTACHMENTS_EXPORT_FAILED: { category: "IMPORT_EXPORT", label: "活动附件导出失败", targetType: "ActivityAttachment" },
  EVIDENCE_DOWNLOADED: { category: "ACTIVITY", label: "下载学生证明", targetType: "Evidence" },
  EVIDENCE_UPLOADED: { category: "ACTIVITY", label: "上传学生证明", targetType: "Evidence" },
} as const satisfies Record<string, ActionMeta>;

export type AuditAction = keyof typeof auditActions;

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(auditActions, value);
}

export function auditActionMeta(action: AuditAction): ActionMeta {
  return auditActions[action];
}

export function termAuditAction(action: "rename" | "delete" | "restore" | "void" | "archive" | "unarchive"): AuditAction {
  return `TERM_${action.toUpperCase()}` as AuditAction;
}
