# 序衡 · 高校综合测评管理

简体中文 | [English](README.en.md)

[![CI](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/ci.yml/badge.svg)](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/ci.yml)
[![Publish container image](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/docker-publish.yml)
![Next.js](https://img.shields.io/badge/Next.js-16.4-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.3-149ECA?logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.4-336791?logo=postgresql)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)
![License](https://img.shields.io/badge/license-Proprietary-lightgrey)

面向高校正式业务场景的综合测评管理系统。系统以**学校管理员、二级学院、辅导员、学生**四类身份为核心，覆盖测评制度配置、组织与账号、活动与成果认定、成绩与扣分审核、结果发布、确认与异议、排名与安全导出，以及审计、备份和容器化部署。

系统强调三件事：**分数算得准、数据只能被有权的人看到、每一次关键变更都能追溯**。

**在线演示**：<https://demo.spacedo.org>（独立演示数据库，当前为空库；请勿录入真实学生信息，初始管理员账号由部署方线下提供）

## 目录

- [核心能力](#核心能力)
- [界面预览](#界面预览)
- [角色与业务闭环](#角色与业务闭环)
- [技术架构](#技术架构)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [首次管理员与数据库迁移](#首次管理员与数据库迁移)
- [运行、升级与备份](#运行升级与备份)
- [安全设计](#安全设计)
- [质量保障](#质量保障)
- [项目结构](#项目结构)
- [文档](#文档)
- [许可证](#许可证)

## 核心能力

### 测评制度与规则

- 测评周期完整生命周期：进行中、核对中、已发布、归档等状态受控转换。
- 可视化评分树：模块、指标、权重、封顶、折算、缺失成绩政策与扣分项统一配置。
- 保存前可定位校验，试算解释每一层结果；制度变更提供影响预览，避免半批新口径。
- 规则、原始输入、计算结果与发布版本分离，界面或文案调整不会改写历史成绩。

### 四类身份与组织限域

- 学校管理员配置全校制度、组织、账号、活动、发布与导出。
- 二级学院只能查看和审核本院班级、学生与业务。
- 辅导员负责授权班级的成绩、扣分、成果评分和活动参与审核。
- 学生只访问本人档案、申报、成绩、确认与异议。
- 账号创建、批量导入、辅导员责任交接、停用与重置均保留操作痕迹。

### 活动、成果与认定

- 活动支持全校 / 按学院 / 按班级三种受众范围，范围内部取并集。
- 固定分值、参与名单导入、参与证明、两级审核与按理由更正。
- 活动可提前结束或重新开放；名单、分值或范围变更自动撤回公开状态。
- 学生个人成果申报独立于活动，证明材料私有存储，辅导员评分、学院终审、退回修改与逻辑放弃全程留痕。

### 成绩、发布与结果

- 辅导员录入学业 / 体育成绩与扣分，学院审核通过后才生效。
- 同一事实只计一次；更正、撤销与退回保留理由和历史版本。
- 发布前执行完整性检查，发布生成不可变版本快照。
- 学生在线确认成绩、在截止前提出异议；管理员处理并保留处理结论。
- 排名与成绩导出按角色限域，明细覆盖完整模块树，合计、比例与总分使用 XLSX 公式，文本内容防公式注入。

### 运行与安全

- NextAuth 凭据登录、五位图片验证码、登录失败限流、首次登录强制改密。
- 会话版本号支持停用、重置密码后的即时撤销。
- 证明附件私有存储、授权下载，按对象与组织范围校验。
- 关键业务写入事务化，批量导入提供整批校验、历史记录与受控撤销。
- `/api/health/live` 与 `/api/health/ready` 分别检查进程与数据库就绪状态。

## 界面预览

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/login.jpg" alt="登录页" /><br /><sub><b>统一登录</b>：身份选择、验证码与首次改密</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-dashboard.jpg" alt="管理员工作台" /><br /><sub><b>管理员工作台</b>：周期、待办与全校办理进度</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/admin-scoring-scheme.jpg" alt="评分方案" /><br /><sub><b>评分方案</b>：模块、权重、封顶与计分依据</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-accounts.jpg" alt="账号管理" /><br /><sub><b>账号管理</b>：四类身份、组织范围与账号状态</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/admin-activities.jpg" alt="活动管理" /><br /><sub><b>活动管理</b>：受众范围、参与名单与发布状态</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-grade-details.jpg" alt="成绩明细" /><br /><sub><b>成绩明细</b>：总分、排名、构成与完整依据</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/admin-publication.jpg" alt="结果发布" /><br /><sub><b>结果发布</b>：发布条件、不可变版本与历史</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-export.jpg" alt="成绩导出" /><br /><sub><b>全校导出</b>：学院筛选、明细范围与公式工作表</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/college-grade-review.jpg" alt="学院审核" /><br /><sub><b>学院审核</b>：成绩、扣分与退回理由</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/counselor-grade-entry.jpg" alt="辅导员录入" /><br /><sub><b>辅导员录入</b>：负责班级名单与成绩提交</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/student-activities.jpg" alt="学生活动" /><br /><sub><b>学生活动</b>：可参与活动与本人参与记录</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/student-results.jpg" alt="学生成绩" /><br /><sub><b>学生成绩</b>：总分、构成、确认与异议</sub></td>
  </tr>
</table>

> 截图来自 2026-10-24 全角色隔离验收，业务数据均为虚构。完整验收截图与报告见[全局验收测试](docs/audit/全局验收测试-2026-10-24.md)。

## 角色与业务闭环

| 角色 | 典型职责 | 核心入口 |
| --- | --- | --- |
| 学校管理员 | 周期与制度、组织与账号、导入、活动、发布、异议、排名与全校导出 | `/workspace`、`/terms`、`/accounts`、`/activities`、`/publications`、`/rankings` |
| 二级学院 | 本院学生与班级、活动参与审核、成果终审、成绩/扣分审核、本院导出 | `/workspace`、`/reviews`、`/exports` |
| 辅导员 | 负责班级学生、成绩与扣分提交、成果评分、活动参与审核、班级导出 | `/workspace`、`/grades`、`/deductions`、`/reviews` |
| 学生 | 活动与参与记录、学籍档案、成果申报、成绩确认、异议与本人成绩单 | `/workspace`、`/activities`、`/claims`、`/results` |

```mermaid
flowchart LR
  A[制度与周期] --> B[组织 / 账号 / 档案]
  B --> C[活动与参与名单]
  B --> D[个人成果申报]
  C --> E[辅导员初审]
  D --> E
  E --> F[学院终审]
  F --> G[成绩与扣分]
  G --> H[发布前核对]
  H --> I[不可变发布版本]
  I --> J[学生确认 / 异议]
  J --> K[排名 / 安全导出]
```

## 技术架构

```mermaid
flowchart LR
  U[浏览器] -->|HTTPS| N[Nginx / 反向代理]
  N --> A[Next.js 16 standalone]
  A -->|Prisma 7 + pg| P[(PostgreSQL 18.4)]
  A -->|授权读取| E[(证明卷)]
  A -->|授权读取| T[(活动附件卷)]
  A -->|审计与版本| P
  G[GitHub Actions] -->|多架构 OCI 镜像 + SBOM| R[(GHCR)]
  R --> A
```

| 层次 | 技术 |
| --- | --- |
| Web | Next.js 16.4 App Router、React 19.3、Server Components、Route Handlers |
| 语言与校验 | TypeScript 5.9、Zod 4 |
| UI | Base UI / shadcn 组件体系、Tailwind CSS 4、TanStack Table 9、TipTap 3 |
| 认证 | NextAuth 4（Credentials）、bcrypt、图片验证码、会话版本撤销 |
| 数据 | PostgreSQL 18.4、Prisma 7.10、`@prisma/adapter-pg` |
| 测试 | Vitest 集成测试、Playwright 浏览器验收 |
| 交付 | Docker 多阶段构建、Compose、GHCR、GitHub Actions |

## 快速开始

### 方式一：Docker Compose（推荐）

前置要求：Docker 24+、Docker Compose v2、可访问 GHCR 的 GitHub 账号（镜像为私有包，需要 `read:packages` 权限）。

```bash
git clone https://github.com/Self-Command/campus-evaluation-management.git
cd campus-evaluation-management
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

编辑 `.env.docker`，至少填写 `POSTGRES_PASSWORD`、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`，并按需设置首个管理员：

```dotenv
POSTGRES_PASSWORD=<24 位以上随机字符串>
NEXTAUTH_SECRET=<32 字节以上随机值>
NEXTAUTH_URL=https://evaluation.example.edu.cn
BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=<12–72 位，包含字母和数字>
```

```bash
docker login ghcr.io -u <github-user>
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

访问 `NEXTAUTH_URL`。首次登录会强制修改初始密码。Compose 默认只把应用发布到 `127.0.0.1`，由 Nginx/Caddy 终止 TLS 并反向代理。

### 方式二：直接拉取镜像运行

适用于已有 PostgreSQL 或托管数据库的环境。先准备数据库并执行迁移：

```bash
docker run --rm \
  -e DATABASE_URL="postgresql://user:password@db-host:5432/campus" \
  ghcr.io/self-command/campus-evaluation-management:latest migrate
```

再启动应用：

```bash
docker run -d --name campus-app \
  -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL="postgresql://user:password@db-host:5432/campus" \
  -e NEXTAUTH_URL="https://evaluation.example.edu.cn" \
  -e NEXTAUTH_SECRET="<32 字节以上随机值>" \
  -e RUN_MIGRATIONS=true \
  -e BOOTSTRAP_ADMIN_LOGIN=admin \
  -e BOOTSTRAP_ADMIN_PASSWORD="<初始密码>" \
  -v campus-evidence:/data/evidence \
  -v campus-attachments:/data/activity-attachments \
  --restart unless-stopped \
  ghcr.io/self-command/campus-evaluation-management:latest
```

详细参数、Nginx 配置、升级与恢复见[容器化部署手册](docs/deploy/docker.md)。

### 方式三：下载 Actions 构建的离线镜像

无法访问 GHCR 的服务器可以使用 GitHub Actions 产物（包含校验文件）：

```bash
gh run download --repo Self-Command/campus-evaluation-management \
  --name campus-evaluation-image-amd64 --dir ./image
gunzip -c ./image/campus-evaluation-image-amd64.tar.gz | docker load
```

加载后把 `.env.docker` 的 `APP_IMAGE` 改为产物中的镜像标签，再执行 Compose。

### 方式四：本地开发

```bash
npm ci
npm run dev:setup   # 生成本地 .env（不会覆盖已有文件）
npm run db:local    # 启动本地 PostgreSQL
npx prisma migrate deploy
npm run dev
```

开发地址为 `http://127.0.0.1:3000`。完整说明见[本地开发文档](docs/development.md)。

## 配置说明

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `POSTGRES_DB` / `POSTGRES_USER` | Compose | `campus` / `campus` | 内置数据库名称与用户 |
| `POSTGRES_PASSWORD` | Compose | — | 数据库密码；建议使用 URL 安全字符 |
| `DATABASE_URL` | 直接运行 | Compose 自动生成 | PostgreSQL 连接串 |
| `NEXTAUTH_URL` | 是 | — | 浏览器访问的公开源，必须与反向代理域名一致，不带末尾 `/` |
| `NEXTAUTH_SECRET` | 是 | — | 会话、验证码与导出令牌签名密钥；多副本必须一致 |
| `APP_IMAGE` | Compose | GHCR `latest` | 部署镜像标签 |
| `APP_BIND_ADDRESS` | 否 | `127.0.0.1` | 宿主机监听地址；直接暴露公网时改为 `0.0.0.0` |
| `APP_PORT` | 否 | `3000` | 宿主机端口 |
| `TZ` | 否 | `Asia/Shanghai` | 容器时区 |
| `RUN_MIGRATIONS` | 否 | `true` | 启动时执行 `prisma migrate deploy` |
| `DB_WAIT_TIMEOUT_MS` | 否 | `60000` | 等待数据库就绪的最长时间 |
| `BOOTSTRAP_ADMIN_LOGIN` | 否 | — | 首个管理员登录名；与密码同时设置才生效 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 否 | — | 首个管理员初始密码；首次登录强制改密 |
| `BOOTSTRAP_ADMIN_NAME` | 否 | `系统管理员` | 首个管理员显示名称 |
| `APP_TRUSTED_ORIGINS` | 否 | — | 额外可信来源，逗号分隔 |
| `EVIDENCE_DIR` | 否 | `/data/evidence` | 证明文件卷 |
| `ACTIVITY_ATTACHMENT_DIR` | 否 | `/data/activity-attachments` | 活动附件卷 |

> 生产环境不要把 `.env.docker` 提交到仓库。生成密钥示例：`openssl rand -hex 24`、`openssl rand -base64 48`。

## 首次管理员与数据库迁移

- 容器首次启动时，入口脚本会等待数据库就绪，并在 `RUN_MIGRATIONS=true` 时执行迁移。
- 如果设置了 `BOOTSTRAP_ADMIN_LOGIN` 与 `BOOTSTRAP_ADMIN_PASSWORD`，且库中不存在管理员，会创建一个必须首次改密的初始管理员。
- 创建成功后应从环境变量中移除初始密码并重新创建容器；引导逻辑是幂等的，不会覆盖已有管理员。
- 单独执行迁移或引导：

```bash
docker compose --env-file .env.docker run --rm app migrate
docker compose --env-file .env.docker run --rm app bootstrap-admin
```

- 多副本部署时，只让一个实例执行迁移；其余实例设置 `RUN_MIGRATIONS=false`，或先运行一次 `migrate` 任务再启动所有副本。

## 运行、升级与备份

```bash
# 健康检查
curl -fsS https://evaluation.example.edu.cn/api/health/live
curl -fsS https://evaluation.example.edu.cn/api/health/ready

# 查看日志
docker compose --env-file .env.docker logs -f app

# 拉取新版本并滚动更新
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

数据库备份：

```bash
docker compose --env-file .env.docker exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > campus-$(date +%F).dump
```

证明与活动附件位于独立命名卷，需与数据库一起备份。完整备份、恢复、回滚和多副本迁移策略见[容器化部署手册](docs/deploy/docker.md)。

## 安全设计

- **最小权限容器**：应用以 UID 1001 非 root 运行，丢弃全部 Linux capabilities，设置 `no-new-privileges`。
- **边界校验**：客户端只提交操作意图；主体、角色、组织范围、对象归属、周期阶段与修订号由服务端复核。
- **会话撤销**：停用账号、重置密码或角色变化会提升会话版本，旧会话不能继续写入。
- **文件隔离**：证明和附件使用私有卷与授权下载，不通过公共静态目录暴露。
- **导入原子性**：批量导入先整批校验，错误批次零写入；撤销受业务引用保护。
- **发布不可变**：发布结果保存规则、输入与计算快照，后续资料变化不污染历史版本。
- **密钥外置**：镜像不包含数据库密码、会话密钥或管理员密码，全部在运行时注入。
- **供应链**：镜像由 GitHub Actions 构建，带 OCI 来源标签、Provenance 与 SBOM。

安全问题请遵循 [SECURITY.md](SECURITY.md) 私下报告，不要公开提交包含凭据或利用细节的 Issue。

## 质量保障

- 2026-10-24 在独立 PostgreSQL 集群、独立应用端口上完成全角色验收：**114/114 用例通过，125 次执行，修复 3 个产品缺陷**，覆盖四类身份、核心闭环、越权与异常场景。
- CI 对每次提交执行：Prisma 生成、TypeScript 类型检查、ESLint、Vitest 隔离集成测试、Next.js 生产构建。
- 镜像发布工作流构建 `linux/amd64` 与 `linux/arm64`，同时导出可在内网服务器加载的 amd64 离线包。
- 验收边界、隔离证明与修复记录见[全局验收测试报告](docs/audit/全局验收测试-2026-10-24.md)；视觉验收以实际部署环境为准。

## 项目结构

```text
src/
  app/                 App Router 页面与 Route Handlers
  components/          业务组件与界面基础组件
  lib/                 评分、校验、设置等纯逻辑
  server/              领域服务、权限、事务、文件与审计
prisma/
  schema.prisma        数据模型
  migrations/          版本化数据库迁移
docker/
  entrypoint.sh        迁移、引导与启动入口
  wait-for-db.cjs      数据库就绪探测
  bootstrap-admin.cjs  首个管理员引导
docs/
  deploy/              部署手册
  audit/               验收与实施证据
  architecture/        架构说明
  data/                数据模型
  features/            业务设计
  design/              前端与界面规范
tests/
  integration/         隔离数据库集成测试
  e2e/                 Playwright 浏览器测试
compose.yaml           PostgreSQL + 应用编排
Dockerfile             多阶段生产镜像
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [容器化部署手册](docs/deploy/docker.md) | Compose、直接运行、Nginx、TLS、升级、备份恢复与故障排查 |
| [全局验收测试](docs/audit/全局验收测试-2026-10-24.md) | 2026-10-24 全角色验收范围、结果与缺陷修复 |
| [系统架构](docs/architecture/系统架构.md) | 应用分层、认证、数据与运行边界 |
| [数据模型](docs/data/数据模型.md) | 实体、关系、状态与约束 |
| [产品开发基线](docs/product/产品开发基线.md) | 当前交付范围、简化项与后续边界 |
| [学院职责与统一审核规范](docs/product/学院职责与统一审核规范.md) | 四类身份、限域、两级审核与退回规则 |
| [本地开发](docs/development.md) | 环境、脚本与验证方式 |
| [文档索引](docs/README.md) | 全部设计与实施文档入口 |

## 许可证

本项目为私有、专有软件，**保留所有权利**。未经版权所有者书面许可，不得复制、分发、修改或用于商业用途。第三方组件的许可证随其各自项目提供；前端所基于的仪表盘模板采用 MIT 许可证，许可全文保留在 [dashboard-baseui-MIT.txt](docs/licenses/dashboard-baseui-MIT.txt)。

仓库中的学校名称、学生姓名、学号、成绩与截图数据均为验收用虚构数据，不对应任何真实个人或机构。
