# Next.js 技术选型：官方资料核查

核查日期：2026-10-19。用于技术方案收尾，结论来自官方文档；下文区分框架能力与本项目的选型判断。

## 单项目应用

Next.js 的 Route Handlers 可接收 HTTP 请求、处理请求体并返回文件等内容，Server Actions 可执行页面发起的数据修改。结合本项目的管理与计分业务，采用一个项目容纳页面和服务端功能是当前建议；业务权限、审核和计算规则仍需在项目中实现。该系统需要服务端运行环境，静态导出无法承载这些写入流程。[Next.js 官方说明](https://nextjs.org/docs/app/guides/backend-for-frontend)

## 页面复用

shadcn/ui 官方 Blocks 提供侧栏、登录页及后台布局等可复制修改的界面代码。可据此搭建后台外壳，并用组件组合业务页面；学校申报、审核和评分树等交互仍需根据需求实现。[官方 Blocks](https://ui.shadcn.com/blocks)

## 数据库与版本

SQLite 将数据保存在文件中，适合本机演示等部署；多名用户通过同一个应用访问，并不等于每人直接共享数据库文件。它每个数据库同时只有一个写者，大量并发写入或多实例部署需要重新评估。将其作为首版候选，是基于本机／局域网演示目标的判断。[SQLite 官方适用场景](https://www.sqlite.org/whentouse.html)

Prisma 官网当前默认的 ORM 8 支持表将 SQLite 标记为实验性。ORM 7 的独立文档明确支持本地 SQLite 文件及相应驱动适配器；官方发布说明保留 ORM 7 维护期。因此本项目若选择 SQLite，当前建议使用 ORM 7 的正式版本组合，并在实施时核对 CLI、Client、驱动与 Node 的兼容性。[ORM 8 支持状态](https://www.prisma.io/docs/orm/supported-databases)、[ORM 7 SQLite 文档](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite)、[发布与维护说明](https://www.prisma.io/docs/orm/release-status)

## 学号登录

Better Auth 的 Username 插件支持用户名登录，但其公开的注册示例仍要求邮箱字段，Email 文档明确账号需要邮箱。因此它不能仅凭 Username 插件直接认定为本项目无需学生邮箱的建号方案。[Username 插件](https://better-auth.com/docs/plugins/username)、[Email 说明](https://better-auth.com/docs/concepts/email)

NextAuth.js v4 的 Credentials 可自定义凭据字段，通过 `authorize()` 查询本地账号并验证密码。它要求 JWT 会话，不负责持久化这些用户；管理员建号、密码哈希、重置密码和业务角色仍需由应用实现。官方2026年7月的维护说明将 v4 列为 LTS、v5 列为 beta。基于学号登录与本地账号需求，将 v4 Credentials 作为当前认证候选；正式采用前需核对所选 Next.js／React／Node 兼容组合，以及改密、停用和角色变化后的会话处理。[Credentials 文档](https://next-auth.js.org/providers/credentials)、[官方维护说明](https://better-auth.com/blog/security-update-july-2026)

## 生产模式与本地部署

Next.js 官方支持 Node 服务和 Docker 自托管，生产运行可以先构建再启动，也可以制作容器镜像。Docker Compose 官方提供单机生产部署说明。结合用户本地部署生产版本的目标，采用 Compose 编排应用与 PostgreSQL、数据库与附件分别持久化，并提供环境配置、迁移和恢复流程，是本项目的部署选择；服务入口的 HTTPS 与反向代理配置应随实际访问环境验证。[Next.js 部署](https://nextjs.org/docs/app/getting-started/deploying)、[Compose 生产部署](https://docs.docker.com/compose/how-tos/production/)

Prisma ORM 7 官方支持自托管 PostgreSQL 与对应驱动适配器。用户已选择 PostgreSQL，后续按该版本文档实施；选择理由是并发写入与后续部署的一致性，生产交付质量仍由应用实现和验证决定。[ORM 7 PostgreSQL 文档](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql)

## 声明依赖兼容性

本次读取的官方 npm registry 元数据显示：`next-auth` 的 `latest` 为4.24.15，声明支持 Next.js 12至16、React 17至19；`next` 的 `latest` 为16.4.2，支持 React 19；`react` 的 `latest` 为19.3.1。这说明 Next.js 16＋React 19＋NextAuth.js v4 在声明依赖层面相容，本次没有据此声称已经安装或完成运行测试。[NextAuth 元数据](https://registry.npmjs.org/next-auth/latest)、[Next 元数据](https://registry.npmjs.org/next/latest)、[React 元数据](https://registry.npmjs.org/react/latest)

Prisma ORM 7 的系统要求列出 Node `^20.19.0`、`^22.12.0`、`^24.0.0`，因此实施目标采用 Node 24 LTS 系列，补丁版本在实际构建与核心登录、会话、数据库操作验证后固定。[官方系统要求](https://www.prisma.io/docs/orm/v7/reference/system-requirements)
