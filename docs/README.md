# 开发文档索引

更新：2026-10-20。企业目标与当前实现分开记录；文档存在不表示功能完成。

## 按任务读取

先确定本次任务对应行，只读该行所需材料及对应源码。当前会话已读且未改动的材料不重复通读；需要确认时用 `rg -n` 定位标题/术语，再读相关段落。外部检索复用已核验来源，只补实际缺失部分。

| 当前工作 | 必读入口 | 按涉及范围补读 |
|---|---|---|
| 周期删除/评分列表、角色验证码登录、设置与证据预览 | [本轮方案](design/周期与评分列表改造方案.md) | [当前证据](audit/周期制度与登录设置实施验证-2026-10-20.md)、[证明预览边界](features/07-证明文件与资源治理.md)；学院后续审核仍独立分批 |
| 学院/辅导员、评分、审核退回、导入导出 | [最新统一审核规范](product/学院职责与统一审核规范.md) | [ADR0005](adr/0005-college-review-and-return-policy.md)；分批实施，实际证据见[学院流程记录](audit/学院流程实施与验证-2026-10-20.md) |
| 了解现状/接手 | [缺口台账](audit/现状与功能缺口.md) | [产品基线](product/产品开发基线.md)；不要用旧计划推断完成 |
| 确定需求/验收 | [场景与权限](product/业务场景与验收.md) | 对应下表详细设计；[术语](../GLOSSARY.md)相关条目 |
| 修改服务/事务 | [架构](architecture/系统架构.md) | 对应详细设计、[当前数据](data/数据模型.md)、[目标字典](data/目标字段字典.md)相关表 |
| 修改接口 | [接口约定](api/接口约定.md) | 当前/目标OpenAPI的对应operation与schema，禁止通读所有接口 |
| 重建页面 | [界面规范](design/界面设计规范.md) | [完整模板及响应式约束](design/前端从零重建规范.md)、对应功能设计；使用组件时读已安装shadcn技能和该组件官方文档 |
| 修改设置 | [设置设计](features/15-管理员设置中心.md) | 实际settings.ts白名单、设置schema及对应Next指南；通用配置矩阵尚未单列 |
| 执行本地任务 | [任务管理约定](agents/issue-tracker.md) | 当前任务及直接前置，不批量加载所有旧任务 |
| 文档替换/删除 | [清理清单](audit/文档清理清单.md) | 备份manifest与替代覆盖检查 |
| 安全/部署/验收 | [运行恢复设计](features/16-部署维护与恢复.md) | [身份安全](features/01-身份与账号安全.md)、[证明治理](features/07-证明文件与资源治理.md)、[验证记录与隔离](quality/验证证据与测试隔离.md)对应章节 |

## 功能详细设计

以下均为目标设计，实际差距见台账。01～16不是已完成功能计数。学院/班级范围、辅导员申报评分、统一退回/重评/放弃、活动材料及公式详细成绩的最新口径优先使用上表统一规范，不从旧API或历史状态推断已支持。

| 编号/需求 | 设计 | 主要当前源码入口 |
|---|---|---|
| 01 / ENT-01 | [身份与安全](features/01-身份与账号安全.md) | auth.ts、authorization.ts、initialize-admin.ts |
| 02 / ENT-02 | [账号组织档案](features/02-账号组织与档案.md) | accounts.ts、account-import.ts |
| 03 / ENT-03 | [周期范围模板](features/03-周期范围与模板.md) | terms.ts |
| 04 / ENT-04/05 | [评分与规则生效](features/04-评分制度与规则生效.md) | terms.ts、src/lib/scoring/ |
| 05 / ENT-06 | [活动与分值更正](features/05-活动目录与分值更正.md) | activities.ts |
| 06 / ENT-07 | [认定申报审核](features/06-认定申报与审核.md) | recognitions.ts、participation-import.ts |
| 07 / ENT-08 | [证明资源](features/07-证明文件与资源治理.md) | evidence.ts、upload-form.ts |
| 08 / ENT-09 | [成绩扣分](features/08-成绩扣分与更正.md) | grades.ts、deductions.ts |
| 09 / ENT-10 | [导入模板](features/09-导入中心与模板.md) | spreadsheet.ts、三类 *-import.ts |
| 10 / ENT-11 | [结果依据](features/10-结果与计算依据.md) | results.ts |
| 11 / ENT-12 | [发布确认异议](features/11-发布确认与异议.md) | publications.ts、appeals.ts；学院流程增量待对齐 |
| 12 / ENT-13 | [排名导出](features/12-排名与安全导出.md) | rankings.ts；新详细公式XLSX待实施 |
| 13 / ENT-14 | [锁定重开](features/13-锁定快照与重开.md) | publications.ts；不可变发布/快照及理由重开 |
| 14 / ENT-15 | [审计通知检索](features/14-审计通知与检索.md) | AuditEvent写入；查询/通知缺失 |
| 15 / ENT-16 | [管理员设置](features/15-管理员设置中心.md) | settings.ts；白名单及修订理由，复杂审批延后 |
| 16 / ENT-18 | [运行恢复](features/16-部署维护与恢复.md) | scripts/、api/health/ |

源码服务入口均相对 `src/server/`，特别是评分保存位于terms.ts。API对应 `src/app/api/`，模型以 `prisma/schema.prisma` 为当前事实。依赖版本以package-lock.json为准，不依靠文档缓存版本判断。

## 契约与证据

- [现有OpenAPI草案](api/openapi.current.yaml)：已有Route Handler行为；覆盖范围见[已核查接口](api/已核查接口与兼容边界.md)，不是本批所有新接口已同步的机器契约。
- [学院流程增量契约](api/学院流程增量契约.md)：按批次补充前后端约定，目标operation未实现前不开放功能入口；目标OpenAPI尚未单独建立。
- [验证证据与隔离](quality/验证证据与测试隔离.md)：各批实际验证方法及边界，完整需求追溯表尚未单列。
- [本轮有序任务](../.scratch/college-workflow/spec.md)：学院流程实施次序与门禁。
- [运行说明](development.md)：本地服务、脚本和验证边界。
- [模板来源核验](design/模板来源与适配清单.md)：具体页面来源、许可位置及采用边界。

索引中尚未落地的契约/设计文件属于本次编写中的交付，链接校验通过前不能宣称文档体系完成。旧精简方案、旧17项任务及旧原型不再作为需求入口；可恢复清理按清单逐文件执行。
