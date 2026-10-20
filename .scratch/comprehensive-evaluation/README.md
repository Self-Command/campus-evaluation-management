# 综合测评开发任务

用户已于2026-10-19确认任务粒度与依赖。17项任务按本地 Markdown 约定独立发布，状态均为 `ready-for-agent`；该标签表示任务已明确，执行仍需满足其阻塞条件。

父规格：[生产版本开发规格](spec.md)。父规格保持原状态和内容。

## 任务清单

| 编号 | 任务 | 直接依赖 |
| --- | --- | --- |
| 01 | [生产部署下的管理员登录与首次改密](issues/01-production-admin-login.md) | 无，可立即开始 |
| 02 | [三角色账号与学生档案管理](issues/02-accounts-student-profiles.md) | 01 |
| 03 | [学生账号批量导入](issues/03-account-import.md) | 02 |
| 04 | [学期与基础评分树配置](issues/04-term-scoring-tree.md) | 02 |
| 05 | [学校模板、通用计分与试算明细](issues/05-template-calculation-preview.md) | 04 |
| 06 | [活动展示与统一分值确认](issues/06-activities-uniform-points.md) | 04 |
| 07 | [单人参与证明、审核与计分查询](issues/07-single-participation-review.md) | 05、06 |
| 08 | [活动名单导入与共享证明](issues/08-bulk-activity-recognition.md) | 07 |
| 09 | [个人加分项目、申报与事实去重](issues/09-personal-claims.md) | 07 |
| 10 | [成绩录入、导入与完整结果查询](issues/10-grades-input-import.md) | 05 |
| 11 | [节点扣分登记与解释](issues/11-node-deductions.md) | 05 |
| 12 | [生效规则变更、数据迁移与统一重算](issues/12-live-configuration-changes.md) | 09、10、11 |
| 13 | [成绩发布、学生核对与异议处理](issues/13-publish-confirm-appeal.md) | 09、10 |
| 14 | [范围排名与 Excel 导出](issues/14-ranking-excel-export.md) | 10 |
| 15 | [学期锁定、结算快照与更正](issues/15-settlement-lock-correction.md) | 12、13、14 |
| 16 | [生产数据备份与隔离恢复](issues/16-backup-restore.md) | 15 |
| 17 | [生产版本端到端验收与演示交付](issues/17-production-acceptance.md) | 03、08、16 |

## 执行方式

每项任务包含完整业务交付、直接阻塞项、规格映射和可检查的验收条件。选择所有阻塞任务都已完成的任务；任务编号按依赖顺序排列，但独立分支不必等待无关编号。

当前唯一没有阻塞项的是01。先交付可部署、可登录的最小链路，再逐步加入配置、认定、计分和结算。测试、权限、日志和持久化随每个业务任务落实，17负责汇合后的完整验收，不替代前面任务的验证。

## 核查结果

任务共133条验收条件，覆盖82条用户故事、14组实施决定和16组规格验收项。依赖图无循环、无冗余直接边，最终任务包含所有前置分支；任务清单发布不表示功能已实现。
