# Xuheng · Campus Comprehensive Evaluation

[简体中文](README.md) | English

[![CI](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/ci.yml/badge.svg)](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/ci.yml)
[![Publish container image](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Self-Command/campus-evaluation-management/actions/workflows/docker-publish.yml)
![Next.js](https://img.shields.io/badge/Next.js-16.4-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.3-149ECA?logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.4-336791?logo=postgresql)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)
![License](https://img.shields.io/badge/license-Proprietary-lightgrey)

A campus-wide comprehensive evaluation system built for real higher-education operations. It serves four roles — **school administrators, colleges, counselors and students** — and covers evaluation schemes, organization and accounts, activities and achievement claims, grade and deduction review, result publication, confirmation and appeals, rankings and scoped exports, auditing, backup and container delivery.

The system is designed around three promises: **correct scoring, scope-safe access, and a traceable record for every material change**.

**Live demo**: <https://demo.spacedo.org> (dedicated demo database, currently empty; do not enter real student data — the initial administrator account is provided offline by the deployment owner)

## Contents

- [Capabilities](#capabilities)
- [Screenshots](#screenshots)
- [Roles and workflows](#roles-and-workflows)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [First administrator and migrations](#first-administrator-and-migrations)
- [Operations, upgrades and backups](#operations-upgrades-and-backups)
- [Security](#security)
- [Quality](#quality)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [License](#license)

## Capabilities

### Evaluation schemes and rules

- Controlled lifecycle for evaluation terms: active, checking, published and archived.
- Visual scoring tree with modules, indicators, weights, caps, ratios, missing-grade policies and deductions.
- Validated saves, explainable previews at every level and impact analysis before a rule change takes effect.
- Rules, raw inputs, computed results and published versions are kept separate, so presentation changes never rewrite history.

### Four roles with organization scoping

- School administrators manage institution-wide schemes, organizations, accounts, activities, publication and exports.
- Colleges see and review only their own classes, students and records.
- Counselors work on assigned classes: grades, deductions, achievement scoring and activity participation review.
- Students access only their own profile, claims, results, confirmations and appeals.
- Account provisioning, imports, counselor handovers, disabling and password resets are recorded.

### Activities, achievements and recognition

- Activity audiences support school-wide, by-college and by-class modes; membership inside the selected scope is additive.
- Fixed-point activities with roster import, participation evidence, two-level review and reason-based correction.
- Activities can be ended early or reopened; changing points, scope or roster withdraws the public state.
- Student achievement claims are independent of activities. Evidence is stored privately; counselor scoring, college final review, return-for-revision and logical withdrawal are fully recorded.

### Grades, publication and results

- Counselors submit academic and physical-education grades plus deductions; a college must approve before they take effect.
- The same fact can only be counted once. Corrections, withdrawals and returns preserve reasons and version history.
- Publication runs completeness checks and produces an immutable result snapshot.
- Students confirm results online and can appeal before the deadline; administrators resolve appeals with an auditable conclusion.
- Rankings and exports are scope-limited. Detailed workbooks cover the full module tree, and totals, ratios and final scores use XLSX formulas; text is protected against formula injection.

### Operations and security

- NextAuth credentials login, five-letter image captcha, login throttling and forced password change at first login.
- Session versioning revokes old sessions immediately after disabling an account, resetting a password or changing a role.
- Evidence files are stored privately and downloaded only after object- and scope-level authorization.
- Material writes are transactional; imports are validated as a whole and provide batch history and guarded revocation.
- `/api/health/live` and `/api/health/ready` separate process liveness from database readiness.

### Audit, backup and attachment governance

- Administrator audit logs cover login, accounts, organization, terms, activities, participation, claims, grades, deductions, publication, appeals, imports/exports and settings. Reasons are shown as first-class fields, with filtering, detail, CSV export and retention-based purge.
- Database backups support creation, download, chunked upload, retention and a real restore preflight. A full restore enters maintenance mode, switches databases atomically after verification and rolls back on failure; all sessions are invalidated afterwards.
- Attachment management groups files by activity (one row per activity), supports school / college / major / class scope for activity attachments and student evidence, and exports ZIP archives with manifests, hashes and per-file errors.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/login.jpg" alt="Sign in" /><br /><sub><b>Sign in</b>: full-screen background, personal appearance, captcha and forced password change</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-dashboard.jpg" alt="Administrator dashboard" /><br /><sub><b>Administrator dashboard</b>: term, workload and school-wide progress</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/admin-scoring-scheme.jpg" alt="Scoring scheme" /><br /><sub><b>Scoring scheme</b>: modules, weights, caps and calculation basis</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-accounts.jpg" alt="Account management" /><br /><sub><b>Account management</b>: four roles, scope and status</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/admin-activities.jpg" alt="Activities" /><br /><sub><b>Activities</b>: audience, roster and publication state</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-grade-details.jpg" alt="Grade details" /><br /><sub><b>Grade details</b>: total, rank, composition and full evidence</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/admin-publication.jpg" alt="Publication" /><br /><sub><b>Publication</b>: checks, immutable versions and history</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/admin-export.jpg" alt="Grade export" /><br /><sub><b>School-wide export</b>: college filter, detail scope and formula sheets</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/college-grade-review.jpg" alt="College review" /><br /><sub><b>College review</b>: grades, deductions and return reasons</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/counselor-grade-entry.jpg" alt="Counselor entry" /><br /><sub><b>Counselor entry</b>: assigned-class roster and submission</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/student-activities.jpg" alt="Student activities" /><br /><sub><b>Student activities</b>: available activities and personal participation</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/student-results.jpg" alt="Student results" /><br /><sub><b>Student results</b>: total, composition, confirmation and appeals</sub></td>
  </tr>
</table>

> Screenshots come from the 2026-10-24 isolated all-role acceptance run. All records are fictional. The full evidence set is in the [acceptance report](docs/audit/全局验收测试-2026-10-24.md) (Chinese).

## Roles and workflows

| Role | Responsibilities | Main areas |
| --- | --- | --- |
| School administrator | Terms and schemes, organization and accounts, imports, activities, publication, appeals, rankings, school-wide exports | `/workspace`, `/terms`, `/accounts`, `/activities`, `/publications`, `/rankings` |
| College | Own students and classes, activity review, achievement final review, grade/deduction review, college exports | `/workspace`, `/reviews`, `/exports` |
| Counselor | Assigned students, grade and deduction submission, achievement scoring, activity review, class exports | `/workspace`, `/grades`, `/deductions`, `/reviews` |
| Student | Activities and participation, profile, achievement claims, result confirmation, appeals, personal transcript | `/workspace`, `/activities`, `/claims`, `/results` |

```mermaid
flowchart LR
  A[Scheme and term] --> B[Organization / accounts / profiles]
  B --> C[Activities and rosters]
  B --> D[Student achievement claims]
  C --> E[Counselor first review]
  D --> E
  E --> F[College final review]
  F --> G[Grades and deductions]
  G --> H[Pre-publication checks]
  H --> I[Immutable published version]
  I --> J[Student confirmation / appeals]
  J --> K[Rankings / scoped exports]
```

## Architecture

```mermaid
flowchart LR
  U[Browser] -->|HTTPS| N[Nginx / reverse proxy]
  N --> A[Next.js 16 standalone]
  A -->|Prisma 7 + pg| P[(PostgreSQL 18.4)]
  A -->|authorized reads| E[(Evidence volume)]
  A -->|authorized reads| T[(Attachment volume)]
  A -->|audit and versions| P
  G[GitHub Actions] -->|multi-arch OCI image + SBOM| R[(GHCR)]
  R --> A
```

| Layer | Technology |
| --- | --- |
| Web | Next.js 16.4 App Router, React 19.3, Server Components, Route Handlers |
| Language and validation | TypeScript 5.9, Zod 4 |
| UI | Base UI / shadcn component system, Tailwind CSS 4, TanStack Table 9, TipTap 3 |
| Authentication | NextAuth 4 (Credentials), bcrypt, image captcha, session revocation |
| Data | PostgreSQL 18.4, Prisma 7.10, `@prisma/adapter-pg` |
| Testing | Vitest integration tests, Playwright browser acceptance |
| Delivery | Multi-stage Docker, Compose, GHCR, GitHub Actions |

## Quick start

### 1. Docker Compose (recommended)

Requirements: Docker 24+, Docker Compose v2 and a GitHub account with `read:packages` access to the private container package.

```bash
git clone https://github.com/Self-Command/campus-evaluation-management.git
cd campus-evaluation-management
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

Edit `.env.docker` and set at least `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` and, optionally, the first administrator:

```dotenv
POSTGRES_PASSWORD=<24+ random characters>
NEXTAUTH_SECRET=<32+ random bytes>
NEXTAUTH_URL=https://evaluation.example.edu.cn
BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=<12–72 chars with letters and digits>
```

```bash
docker login ghcr.io -u <github-user>
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

Open `NEXTAUTH_URL`. The first sign-in forces a password change. Compose publishes the app only on `127.0.0.1`; terminate TLS at Nginx or Caddy and reverse-proxy to it.

### 2. Pull and run the image directly

Use this when PostgreSQL is managed externally. Apply migrations first:

```bash
docker run --rm \
  -e DATABASE_URL="postgresql://user:password@db-host:5432/campus" \
  ghcr.io/self-command/campus-evaluation-management:latest migrate
```

Then start the application:

```bash
docker run -d --name campus-app \
  -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL="postgresql://user:password@db-host:5432/campus" \
  -e NEXTAUTH_URL="https://evaluation.example.edu.cn" \
  -e NEXTAUTH_SECRET="<32+ random bytes>" \
  -e RUN_MIGRATIONS=true \
  -e BOOTSTRAP_ADMIN_LOGIN=admin \
  -e BOOTSTRAP_ADMIN_PASSWORD="<initial password>" \
  -v campus-evidence:/data/evidence \
  -v campus-attachments:/data/activity-attachments \
  --restart unless-stopped \
  ghcr.io/self-command/campus-evaluation-management:latest
```

See the [container deployment guide](docs/deploy/docker.md) for the full parameter list, Nginx example, upgrades and recovery.

### 3. Download the Actions-built offline image

Servers without GHCR access can use the workflow artifact (checksum included):

```bash
gh run download --repo Self-Command/campus-evaluation-management \
  --name campus-evaluation-image-amd64 --dir ./image
gunzip -c ./image/campus-evaluation-image-amd64.tar.gz | docker load
```

Set `APP_IMAGE` in `.env.docker` to the loaded image tag, then start Compose.

### 4. Local development

```bash
npm ci
npm run dev:setup   # creates a local .env without overwriting an existing one
npm run db:local    # starts local PostgreSQL
npx prisma migrate deploy
npm run dev
```

The development server runs at `http://127.0.0.1:3000`. See [development.md](docs/development.md).

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_DB` / `POSTGRES_USER` | Compose | `campus` / `campus` | Bundled database name and user |
| `POSTGRES_PASSWORD` | Compose | — | Database password; prefer URL-safe characters |
| `DATABASE_URL` | Direct run | Generated by Compose | PostgreSQL connection string |
| `NEXTAUTH_URL` | Yes | — | Public origin; must match the reverse-proxy host, no trailing slash |
| `NEXTAUTH_SECRET` | Yes | — | Signs sessions, captchas and export tokens; identical across replicas |
| `APP_IMAGE` | Compose | GHCR `latest` | Image tag to deploy |
| `APP_BIND_ADDRESS` | No | `127.0.0.1` | Host bind address; use `0.0.0.0` only for direct exposure |
| `APP_PORT` | No | `3000` | Host port |
| `TZ` | No | `Asia/Shanghai` | Container timezone |
| `RUN_MIGRATIONS` | No | `true` | Run `prisma migrate deploy` at startup |
| `DB_WAIT_TIMEOUT_MS` | No | `60000` | Maximum database wait time |
| `BOOTSTRAP_ADMIN_LOGIN` | No | — | First administrator login; requires the password |
| `BOOTSTRAP_ADMIN_PASSWORD` | No | — | Initial administrator password; change is forced |
| `BOOTSTRAP_ADMIN_NAME` | No | `系统管理员` | First administrator display name |
| `APP_TRUSTED_ORIGINS` | No | — | Extra trusted origins, comma separated |
| `EVIDENCE_DIR` | No | `/data/evidence` | Evidence volume |
| `ACTIVITY_ATTACHMENT_DIR` | No | `/data/activity-attachments` | Activity attachment volume |
| `BACKUP_DIR` | No | `/data/backups` (Compose) | In-app backups, upload staging and restore reports |
| `BACKUP_MAX_BYTES` | No | `2147483648` | Maximum uploaded backup size; hard-capped at 2 GiB |

> Never commit `.env.docker`. Generate secrets with `openssl rand -hex 24` and `openssl rand -base64 48`.

## First administrator and migrations

- On startup the entrypoint waits for PostgreSQL and, when `RUN_MIGRATIONS=true`, applies pending migrations.
- If `BOOTSTRAP_ADMIN_LOGIN` and `BOOTSTRAP_ADMIN_PASSWORD` are set and no administrator exists, an initial administrator is created with a forced password change.
- Remove the initial password from the environment after bootstrapping. The bootstrap is idempotent and never overwrites an existing administrator.
- Run either task explicitly:

```bash
docker compose --env-file .env.docker run --rm app migrate
docker compose --env-file .env.docker run --rm app bootstrap-admin
```

- With multiple replicas, let exactly one instance run migrations. Set `RUN_MIGRATIONS=false` on the others, or run the migration task before starting all replicas.

## Operations, upgrades and backups

```bash
curl -fsS https://evaluation.example.edu.cn/api/health/live
curl -fsS https://evaluation.example.edu.cn/api/health/ready
docker compose --env-file .env.docker logs -f app
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
```

Database backup:

```bash
docker compose --env-file .env.docker exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > campus-$(date +%F).dump
```

Administrators can also create, download and upload backups from the **Database backups** page. A full restore first materialises the dump in a candidate database, checks migrations and produces an impact report; after confirmation the site enters maintenance mode and switches databases atomically, rolling back on failure. Backups live on a dedicated `backup-data` volume, and the app image ships PostgreSQL 18 client tools. Database backups contain the database only; evidence and attachments use separate named volumes and must be backed up together with the database. During a restore the site only serves the maintenance page, and every user must sign in again afterwards. The [deployment guide](docs/deploy/docker.md) covers backup, restore, rollback and multi-replica migration.

## Security

- **Least-privilege container**: the app runs as UID 1001, drops all Linux capabilities and sets `no-new-privileges`.
- **Server-side authorization**: the client submits intent only; subject, role, scope, ownership, term stage and revision are re-checked on the server.
- **Session revocation**: disabling an account, resetting a password or changing a role advances the session version, so old sessions cannot write.
- **Private files**: evidence and attachments live on private volumes and are served only through authorized routes.
- **Atomic imports**: entire batches are validated first; invalid batches write nothing, and revocation is guarded by business references.
- **Immutable publication**: published results snapshot rules, inputs and computed values, so later data edits cannot alter history.
- **External secrets**: no database password, session key or administrator password is baked into the image.
- **Supply chain**: GitHub Actions builds the image with OCI source labels, provenance and an SBOM.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). Do not open public issues containing credentials or exploitation details.

## Quality

- The 2026-10-24 isolated acceptance run covered all four roles, core closed loops, authorization failures and exception paths on a dedicated PostgreSQL cluster and application port: **114/114 cases passed across 125 executions; 3 product defects were found and fixed**.
- CI runs Prisma generation, TypeScript type checking, ESLint, Vitest integration tests on an isolated database, and a production Next.js build on every push.
- The image workflow publishes `linux/amd64` and `linux/arm64` variants and also exports an amd64 archive for offline servers.
- Scope, isolation and fix evidence are recorded in the [acceptance report](docs/audit/全局验收测试-2026-10-24.md) (Chinese). Visual acceptance is performed on the deployed environment.

## Repository layout

```text
src/
  app/                 App Router pages and Route Handlers
  components/          Business and UI components
  lib/                 Scoring, validation and settings logic
  server/              Domain services, authorization, transactions, files, audit
prisma/
  schema.prisma        Data model
  migrations/          Versioned database migrations
docker/
  entrypoint.sh        Migration, bootstrap and startup entrypoint
  wait-for-db.cjs      Database readiness probe
  bootstrap-admin.cjs  First administrator bootstrap
docs/
  deploy/              Deployment guide
  audit/               Acceptance and implementation evidence
  architecture/        Architecture notes
  data/                Data model
  features/            Business designs
  design/              Frontend and UI standards
tests/
  integration/         Isolated-database integration tests
  e2e/                 Playwright browser tests
compose.yaml           PostgreSQL + application stack
Dockerfile             Multi-stage production image
```

## Documentation

| Document | Content |
| --- | --- |
| [Container deployment guide](docs/deploy/docker.md) | Compose, direct run, Nginx, TLS, upgrades, backup/restore and troubleshooting |
| [Global acceptance test](docs/audit/全局验收测试-2026-10-24.md) | 2026-10-24 all-role scope, results and fixes |
| [System architecture](docs/architecture/系统架构.md) | Application layers, authentication, data and runtime boundaries |
| [Data model](docs/data/数据模型.md) | Entities, relationships, states and constraints |
| [Product baseline](docs/product/产品开发基线.md) | Current scope, simplifications and boundaries |
| [College review policy](docs/product/学院职责与统一审核规范.md) | Roles, scoping, two-level review and return rules |
| [Local development](docs/development.md) | Environment, scripts and verification |
| [Documentation index](docs/README.md) | Entry point for all design and implementation documents |

## License

This is proprietary software. **All rights reserved.** No permission is granted to copy, distribute, modify or use it commercially without written permission from the copyright owner. Third-party components remain under their respective licenses. The dashboard template used as the frontend base is MIT licensed; its full text is kept in [dashboard-baseui-MIT.txt](docs/licenses/dashboard-baseui-MIT.txt).

School names, student names, IDs, grades and screenshots in this repository are fictional acceptance data and do not represent any real person or institution.
