# 02 实施设计：直接个人申报、辅导员评分与统一退回

日期：2026-10-21。依据[学院职责与统一审核规范](../../docs/product/学院职责与统一审核规范.md)§2/§4/§5、02任务文档与ADR0005。本文件是第二批实施设计，不是完成记录。

## 1. 数据模型（增量迁移，不重写旧迁移）

开发库现状：PersonalClaim 0行、RecognitionProject 1行（保留不动）。

- 新枚举 `ClaimStatus`：PENDING_COUNSELOR 待辅导员 / PENDING_COLLEGE 待学院 / RETURNED 退回修改（交学生）/ RESCORING 待辅导员重评 / APPROVED 已通过 / ABANDONED 已放弃 / REVOKED 已撤销 / REJECTED 历史驳回（仅遗留）。
- PersonalClaim 改造：
  - 新增 `termId`（回填自 project.termId 后 NOT NULL，FK→Term）。
  - 新增 `title`（回填自 project.name 后 NOT NULL）。
  - `projectId`、`factKey` 改为可空（新申报无项目/事实键；旧唯一约束保留，NULL 不互斥）。
  - `status` 列类型 ReviewStatus→ClaimStatus，USING 映射：PENDING→PENDING_COUNSELOR、NEEDS_CHANGES→RETURNED、WITHDRAWN→ABANDONED，其余同名（当前库0行，无数据风险；映射规则仍写入迁移备查）。
  - 新增评分字段：`scoreNodeId`、`score Decimal(22,12)`、`scorerId`、`scoredAt`。
  - 保留 activityId（历史）、reviewReason/reviewerId/reviewedAt、revision、history、ClaimEvidence。
  - 索引：新增 [termId, status]，保留 [studentId, status]、[activityId, studentId]。
- RecognitionProject 表与旧行保留只读；`saveProject` 写接口一律拒绝（规范：旧配置写接口不可用）。
- ReviewStatus 枚举与 RecognitionSource 不动（活动认定仍是旧单级，第三批改）。

## 2. 状态机与动作（changeClaim，均携 revision 乐观并发）

| 动作 | 角色 | 允许前状态 | 必填 | 结果状态 |
|---|---|---|---|---|
| resubmit | 学生 | RETURNED | title/occurredOn/note/evidenceIds | PENDING_COUNSELOR（清当前评分，旧分入历史） |
| abandon | 学生 | PENDING_COUNSELOR、RETURNED | — | ABANDONED |
| submitScore | 辅导员 | PENDING_COUNSELOR、RESCORING | nodeId+score | PENDING_COLLEGE |
| return | 辅导员/学院 | 各自待审状态 | reason | RETURNED |
| approve | 学院 | PENDING_COLLEGE | —（score必须已存在） | APPROVED（inputRevision+1） |
| rescore | 学院 | PENDING_COLLEGE | reason | RESCORING |
| revoke | 管理员 | APPROVED | reason | REVOKED（inputRevision+1） |

- 学生提交/补充接口 `.strict()`：拒收 projectId/activityId/factKey/points/score 等（REV-01 伪造零写入）。
- 辅导员评分：节点必须为生效制度 ACTIVITY 叶子；分数在节点 minimum..maximum 内；合法零分有效，未填写=缺分不能通过（REV-02）。
- 范围：学生仅本人；辅导员仅当前为责任辅导员的班级学生；学院仅本院学生；管理员读与受控撤销。越范围 403/404（REV-02/03）。
- 学院 approve 时若 claim.activityId 存在，保留同活动重复认定检查（历史关联）。
- 阶段：提交/重提仅 ACTIVE；审核动作仅 ACTIVE；CHECKING/LOCKED 只读（与旧行为一致）。
- 放弃=逻辑删除：记录保留、历史保留、移出待办；已生效不可放弃（走撤销）（REV-07/08）。

## 3. 服务与API

- `src/server/claims.ts` 重写：saveProject 拒绝；submitClaim 四要素；changeClaim 上表；pageClaims 按角色限域（STUDENT本人、COUNSELOR授权班级、COLLEGE本院、ADMIN全部），where 用直接 termId，附学生组织信息。
- results.ts：APPROVED 申报贡献 = score ?? project.points（历史），nodeId = scoreNodeId ?? project.nodeId；claims where 改直接 termId。
- workbench.ts / publications.ts / terms.ts / corrections.ts：claim 查询改直接 termId；待审口径改 PENDING_COUNSELOR/PENDING_COLLEGE/RESCORING，待补口径改 RETURNED。
- API：POST/GET /api/claims、PATCH /api/claims/[id] 角色扩展 STUDENT/COUNSELOR/COLLEGE/ADMIN；POST /api/projects 保留路由但服务拒绝。

## 4. 前端（仅改既有同源页面，不新增布局）

- `/claims` 页守卫扩展四角色；`claims.tsx` 重构：删除项目页签、项目表单、活动关联（删 activity-association.tsx）、ScoringCorrection 入口。
  - 学生：名录+新建申报（标题/日期/说明/1-5证明）+详情（进度与拟认定分、退回后修改重提、待辅导员时可放弃）。
  - 辅导员：初审队列（状态筛选含待辅导员/待重评）+详情（材料/历史、选模块填分提交学院、退回修改填理由）。
  - 学院：终审队列+详情（通过、退回修改、退回重评，理由必填）。
  - 管理员：只读监督+已通过撤销（理由）。
- 侧栏：COUNSELOR/COLLEGE 增加“个人申报”入口；business-labels 增加新状态文案。
- 模板来源沿用已登记的 D/users + D/invoice + D/profile 组合，改后登记适配清单。

## 5. 测试与证据

- 适配 lifecycle/flow-repairs/workbench/evidence-preview 中旧申报断言（旧 projectId/factKey/单级审核断言按新流程重写，原证明所有权、并发、锁定断言保留）。
- 新增 tests/integration/claims-review.test.ts 覆盖 REV-01~08。
- scripts/test-http.ts 闭环改造：新申报无需项目、辅导员评分、学院终审、退回分支、伪造字段400。
- 迁移流程：backup-before-migration → verify-migration-recovery（隔离恢复）→ migrate deploy 开发库 → verify-additive-migration。
- typecheck / lint(max-warnings=0) / npm test（隔离55432）/ build + test-http 分别记录至审计文档。
