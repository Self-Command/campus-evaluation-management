# 容器化部署手册

更新：2026-10-24。适用于 `campus-evaluation-management` 的生产与演示部署。镜像统一由 GitHub Actions 构建，不在部署主机编译。

## 1. 交付物

| 交付物 | 说明 |
| --- | --- |
| `ghcr.io/self-command/campus-evaluation-management:latest` | 最新正式标签 |
| `ghcr.io/self-command/campus-evaluation-management:<version>` | 语义化版本，如 `0.3.1` |
| `ghcr.io/self-command/campus-evaluation-management:sha-<short>` | 对应提交的不可变标签 |
| `campus-evaluation-image-amd64` | Actions 离线产物，含 `docker save` 压缩包与 SHA-256 |
| `compose.yaml` | 应用 + PostgreSQL 编排文件 |
| `.env.docker.example` | 环境变量模板 |

镜像支持 `linux/amd64` 与 `linux/arm64`，并包含 OCI 来源标签、Provenance 和 SBOM。

## 2. 推荐拓扑

```text
Internet
   │ HTTPS 443
   ▼
Nginx（TLS 终止、安全响应头、请求体限制）
   │ http://127.0.0.1:3200
   ▼
app 容器 ── 私有网络 ──► db 容器（PostgreSQL 18.4）
   │
   ├── evidence-data 卷（证明文件）
   └── attachments-data 卷（活动附件）
```

- 数据库不映射宿主机端口。
- 应用默认只绑定 `127.0.0.1`，由反向代理对外提供服务。
- 命名卷与 Compose 项目名 `campus-evaluation` 绑定，独立于服务器上其他项目。

最低建议：2 vCPU、2 GB 内存、10 GB 可用磁盘；正式数据量较大时按备份与附件增长扩容。

## 3. 前置条件

- Docker 24+，Docker Compose v2。
- 已解析到服务器的域名，例如 `evaluation.example.edu.cn`。
- 可用 443/80 端口及有效的 TLS 证书。
- 访问 GHCR 的网络。当前镜像包为公开，可匿名拉取；如仓库改为私有，GitHub PAT（classic）需要 `read:packages`，细粒度令牌需要 Packages 读取权限。

```bash
# 仅在镜像改为私有时需要登录
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

## 4. Compose 部署

```bash
install -d -m 0750 /srv/campus-evaluation
cd /srv/campus-evaluation
# 将仓库中的 compose.yaml 与 .env.docker.example 复制到本目录
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

编辑 `.env.docker`：

```dotenv
POSTGRES_DB=campus
POSTGRES_USER=campus
POSTGRES_PASSWORD=<24 位以上随机字符串>
NEXTAUTH_SECRET=<32 字节以上随机值>
NEXTAUTH_URL=https://evaluation.example.edu.cn
APP_IMAGE=ghcr.io/self-command/campus-evaluation-management:0.3.1
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=3200
RUN_MIGRATIONS=true
BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=<12–72 位，含字母与数字>
BOOTSTRAP_ADMIN_NAME=系统管理员
```

启动：

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
```

说明：

- 必须显式使用 `--env-file .env.docker`，避免误读项目根目录的开发 `.env`。
- `docker compose pull` 只拉取镜像；`docker compose up -d` 使用本地镜像启动，不会自动重新构建。
- 只有显式执行 `docker compose build` 才会在本机构建，生产环境不建议这样做。
- 首次启动会等待数据库、执行迁移并按需创建首个管理员。

### 离线镜像

无法访问 GHCR 时，在具备 GitHub 权限的机器上下载 Actions 产物：

```bash
gh run download --repo Self-Command/campus-evaluation-management \
  --name campus-evaluation-image-amd64 --dir ./campus-image
sha256sum -c ./campus-image/campus-evaluation-image-amd64.tar.gz.sha256
gunzip -c ./campus-image/campus-evaluation-image-amd64.tar.gz | docker load
cat ./campus-image/image-reference.txt
```

把 `image-reference.txt` 中的标签写入 `.env.docker` 的 `APP_IMAGE`，再执行 `up -d`。也可以把镜像通过 `docker save`/`scp` 传到内网服务器后 `docker load`。

## 5. 首次管理员与迁移

入口脚本 `docker/entrypoint.sh` 的正常启动流程：

1. 等待 `DATABASE_URL` 可连接（`DB_WAIT_TIMEOUT_MS`，默认 60 秒）。
2. `RUN_MIGRATIONS=true` 时执行 `prisma migrate deploy`。
3. 设置 `BOOTSTRAP_ADMIN_LOGIN` 与 `BOOTSTRAP_ADMIN_PASSWORD` 时，如果库中没有任何管理员，创建初始管理员并标记首次改密。
4. 执行 `node server.js`。

单独执行：

```bash
docker compose --env-file .env.docker run --rm app migrate
docker compose --env-file .env.docker run --rm app bootstrap-admin
```

注意事项：

- 引导是幂等的；已有管理员时直接跳过，不覆盖密码。
- 创建成功后从 `.env.docker` 删除 `BOOTSTRAP_ADMIN_PASSWORD`，再 `up -d` 重建应用容器。
- 初始密码要求 12–72 位并同时包含字母和数字；登录名 3–64 位，仅限字母、数字、点、下划线和连字符。
- 数据库密码建议使用十六进制随机值，避免在连接串中需要 URL 编码。
- 不要执行 `prisma migrate reset` 或删除数据库卷来“修复”启动问题。

## 6. 直接拉取并运行

适合已有 PostgreSQL 或托管数据库的环境。先创建网络、数据库与卷：

```bash
docker network create campus-evaluation
docker volume create campus-db-data

docker run -d --name campus-db \
  --network campus-evaluation \
  --restart unless-stopped \
  -e POSTGRES_DB=campus \
  -e POSTGRES_USER=campus \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -v campus-db-data:/var/lib/postgresql \
  postgres:18.4-bookworm
```

> PostgreSQL 18 官方镜像的卷挂载点是 `/var/lib/postgresql`，`PGDATA` 位于其下的 `18/docker`。不要沿用旧版本的 `/var/lib/postgresql/data`。

执行迁移：

```bash
docker run --rm --network campus-evaluation \
  -e DATABASE_URL="postgresql://campus:${POSTGRES_PASSWORD}@campus-db:5432/campus" \
  ghcr.io/self-command/campus-evaluation-management:0.3.1 migrate
```

启动应用：

```bash
docker run -d --name campus-app \
  --network campus-evaluation \
  --restart unless-stopped \
  --stop-timeout 30 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -p 127.0.0.1:3200:3000 \
  -e DATABASE_URL="postgresql://campus:${POSTGRES_PASSWORD}@campus-db:5432/campus" \
  -e NEXTAUTH_URL="https://evaluation.example.edu.cn" \
  -e NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  -e RUN_MIGRATIONS=true \
  -e BOOTSTRAP_ADMIN_LOGIN=admin \
  -e BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e TZ=Asia/Shanghai \
  -v campus-evidence:/data/evidence \
  -v campus-attachments:/data/activity-attachments \
  ghcr.io/self-command/campus-evaluation-management:0.3.1
```

镜像自带健康检查。连接外部托管数据库时，删除 `campus-db` 相关步骤，并把 `DATABASE_URL` 指向实际数据库；托管数据库需允许应用服务器访问并启用 TLS（按供应商要求附加连接参数）。

## 7. Nginx 与 TLS

### 7.1 首次签发证书

先确保域名 A/AAAA 记录指向本机，并且 80 端口可达。创建一个仅 HTTP 的临时站点配置：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name evaluation.example.edu.cn;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
install -d -m 0755 /var/www/letsencrypt
certbot certonly --webroot -w /var/www/letsencrypt -d evaluation.example.edu.cn
```

### 7.2 完整反向代理配置

将以下内容写入独立的 `/etc/nginx/conf.d/campus-evaluation.conf`。不要改动服务器上其他项目的配置文件。`map` 名称使用项目专属前缀，避免与现有配置冲突。

```nginx
map $http_upgrade $campus_evaluation_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name evaluation.example.edu.cn;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name evaluation.example.edu.cn;

    ssl_certificate     /etc/letsencrypt/live/evaluation.example.edu.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/evaluation.example.edu.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:campus_evaluation_ssl:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;

    client_max_body_size 70m;
    proxy_connect_timeout 10s;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $campus_evaluation_connection_upgrade;
    }
}
```

```bash
nginx -t
systemctl reload nginx
```

`NEXTAUTH_URL` 必须与 `https://evaluation.example.edu.cn` 完全一致（协议、主机、端口，无末尾斜杠）。更换域名或协议后必须同步修改并重启应用容器，否则登录回调会失败。

### 7.3 证书续期

`certbot` 的 systemd timer 通常已自动启用。验证：

```bash
systemctl list-timers | grep certbot
certbot renew --dry-run
```

续期后重载 Nginx（如现有 hook 未覆盖）：

```bash
certbot renew --deploy-hook "systemctl reload nginx"
```

## 8. 配置参考

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `POSTGRES_DB` | Compose | `campus` | 数据库名 |
| `POSTGRES_USER` | Compose | `campus` | 数据库用户 |
| `POSTGRES_PASSWORD` | Compose | — | 数据库密码，建议 URL 安全字符 |
| `DATABASE_URL` | 直接运行 | — | PostgreSQL 连接串 |
| `NEXTAUTH_URL` | 是 | — | 公开访问源，必须与反向代理一致 |
| `NEXTAUTH_SECRET` | 是 | — | 会话/验证码/导出令牌签名密钥，至少 32 字节 |
| `APP_IMAGE` | 否 | GHCR `latest` | 镜像标签 |
| `APP_BIND_ADDRESS` | 否 | `127.0.0.1` | 宿主机绑定地址 |
| `APP_PORT` | 否 | `3000` | 宿主机端口 |
| `TZ` | 否 | `Asia/Shanghai` | 时区 |
| `RUN_MIGRATIONS` | 否 | `true` | 启动时迁移 |
| `DB_WAIT_TIMEOUT_MS` | 否 | `60000` | 等待数据库秒数 |
| `BOOTSTRAP_ADMIN_LOGIN` | 否 | — | 首个管理员登录名 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 否 | — | 首个管理员初始密码 |
| `BOOTSTRAP_ADMIN_NAME` | 否 | `系统管理员` | 首个管理员显示名 |
| `APP_TRUSTED_ORIGINS` | 否 | — | 额外可信来源，逗号分隔 |
| `EVIDENCE_DIR` | 否 | `/data/evidence` | 证明目录 |
| `ACTIVITY_ATTACHMENT_DIR` | 否 | `/data/activity-attachments` | 附件目录 |
| `BACKUP_DIR` | 否 | `/data/backups`（Compose） | 应用内备份文件、上传暂存和恢复报告目录 |
| `BACKUP_MAX_BYTES` | 否 | `2147483648` | 允许上传的备份大小上限，应用硬上限 2 GiB |

生成密钥：

```bash
openssl rand -hex 24     # 数据库密码
openssl rand -base64 48  # NEXTAUTH_SECRET
```

## 9. 健康检查、升级与回滚

```bash
curl -fsS https://evaluation.example.edu.cn/api/health/live
curl -fsS https://evaluation.example.edu.cn/api/health/ready
```

- `live`：进程存活，不访问数据库。
- `ready`：数据库可连接、`User` 表可读、没有未完成的迁移。

升级：

```bash
cd /srv/campus-evaluation
cp .env.docker .env.docker.bak
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 app
```

升级前必须备份数据库与附件。数据库迁移通常只向前兼容；仅回退镜像而不回退数据库可能因 schema 不一致而失败。需要回滚时：

1. 停止应用。
2. 恢复升级前的数据库备份与附件卷。
3. 将 `.env.docker` 的 `APP_IMAGE` 改为上一版本标签。
4. 启动应用并检查 `ready`。

若上次数据库恢复未完成，入口脚本会跳过自动迁移和管理员初始化，应用以维护模式启动；先按 10.3 处理恢复状态，不要直接删除状态文件或数据卷。

## 10. 备份与恢复

系统内置“数据库备份”页面，管理员可创建、下载、上传备份，并在真实候选库预检后整库恢复。备份文件保存在 `BACKUP_DIR`（Compose 为 `backup-data` 卷），应用镜像已安装 PostgreSQL 18 客户端。内置恢复使用 `CREATE DATABASE`、`ALTER DATABASE ... RENAME` 和 `DROP DATABASE`，因此数据库账号需要 `CREATEDB` 权限并拥有目标数据库；Compose 内置数据库使用 `POSTGRES_USER`，默认满足。使用外部 PostgreSQL 时，请提前授予应用账号同等权限，否则预检会明确拒绝。

内置备份与恢复的边界：

- 备份是 PostgreSQL custom 格式 dump，只包含数据库，不含证明与活动附件文件。
- 上传备份时浏览器按 8 MiB 分块发送，反向代理 `client_max_body_size` 至少 70m；单文件上限由 `BACKUP_MAX_BYTES` 控制，应用硬上限 2 GiB。
- 恢复前必须通过候选库真实还原、迁移前缀/校验和、管理员可用性、行数与文件风险检查；预检后当前库再发生写入会使指纹失效，需要重新预检。
- 恢复确认后站点进入维护模式，只有维护页和恢复状态接口可访问；恢复完成后清空会话、递增所有账号会话版本，所有用户必须重新登录。
- 恢复失败或切换后校验失败时按状态机回滚；旧数据库、安全快照和恢复报告保留期由“日志与备份保留策略”控制。

### 10.1 数据库

管理员可直接在页面创建备份并下载到独立存储。需要命令行备份时：

```bash
install -d -m 0700 /srv/campus-evaluation/backups
cd /srv/campus-evaluation
docker compose --env-file .env.docker exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "backups/db-$(date +%Y%m%d-%H%M%S).dump"
docker compose --env-file .env.docker exec -T db pg_restore --list \
  < "backups/db-$(date +%Y%m%d-%H%M%S).dump" | head
```

### 10.2 附件与证明卷

Compose 项目名固定为 `campus-evaluation`，卷名为：

- `campus-evaluation_db-data`
- `campus-evaluation_evidence-data`
- `campus-evaluation_attachments-data`
- `campus-evaluation_backup-data`

```bash
docker run --rm \
  -v campus-evaluation_evidence-data:/data:ro \
  -v /srv/campus-evaluation/backups:/backup \
  alpine tar czf "/backup/evidence-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .

docker run --rm \
  -v campus-evaluation_attachments-data:/data:ro \
  -v /srv/campus-evaluation/backups:/backup \
  alpine tar czf "/backup/attachments-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
```

数据库、证明卷和附件卷必须在同一备份窗口内完成，否则可能出现引用与文件不一致。备份文件应加密并复制到独立存储。

### 10.3 恢复

优先使用页面内置恢复：

1. 在“数据库备份”选择目标备份，填写恢复理由并输入当前密码，执行预检。
2. 阅读影响报告：迁移前缀与校验和、各表行数、管理员账号、设置差异、附件缺失/孤儿风险。
3. 输入确认短语和备份内可用管理员登录名，开始恢复；站点进入维护模式。
4. 完成后使用备份时的管理员凭据重新登录，检查成绩、设置、附件下载与操作日志；确认无误后再通知用户。

应用无法启动或需要整机迁移时，才使用命令行恢复：

1. 停止应用写入：`docker compose --env-file .env.docker stop app`。
2. 将当前数据库与卷再做一次快照，防止恢复失败后无法回退。
3. 恢复数据库（示例；会覆盖现有对象，务必确认目标库）：

```bash
docker compose --env-file .env.docker exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < backups/db-YYYYMMDD-HHMMSS.dump
```

4. 将附件与证明恢复到对应卷。恢复前确认卷没有被其他项目使用。
5. 启动应用：`docker compose --env-file .env.docker start app`。
6. 检查 `live`、`ready`、登录、学生成绩页和附件下载。

如果上次内置恢复没有完成，入口脚本会读取 `BACKUP_DIR/restore-state.json`，在状态未终结时跳过自动迁移和管理员初始化，应用以维护模式启动。此时不要删除状态文件或数据卷；按恢复报告的人工指引处理，确认数据库可用后再由管理员完成或回滚恢复。

不要在生产库直接执行 `prisma migrate reset`、`DROP DATABASE` 或删除数据卷。

## 11. 多副本与高可用

- 数据库使用外部 PostgreSQL 或可靠的主从方案；不要在同一主机上运行多个独立的 Compose 数据库副本。
- 只让一个实例执行迁移，其余实例设置 `RUN_MIGRATIONS=false`，或先运行一次性 `migrate` 任务。
- 证明与附件卷必须由所有副本共享（支持多挂载的文件存储），否则用户可能看到 404。
- `NEXTAUTH_SECRET` 必须在所有副本间一致，否则会话和令牌无法互认。
- 应用实例无状态，可以在 TLS 反向代理后水平扩展。粘性会话不是必需，但需要统一的共享存储和数据库。

## 12. 安全清单

- 数据库端口不对公网开放；Compose 默认不发布数据库端口。
- 应用端口只绑定 `127.0.0.1`，由 Nginx 终止 TLS。
- `.env.docker` 权限 `600`，不进入 Git、镜像或聊天记录。
- 初始管理员创建后立即删除 `BOOTSTRAP_ADMIN_PASSWORD`。
- 容器以 UID 1001 非 root 运行，`cap_drop: ALL` 与 `no-new-privileges` 已启用。
- 备份文件包含个人与成绩数据，必须加密、限制访问并设置保留期。
- 定期更新基础镜像与应用镜像，关注 GitHub Actions 构建结果和依赖更新 PR。
- 更换 `NEXTAUTH_SECRET` 会使现有会话与令牌失效，应安排维护窗口。

## 13. 故障排查

| 现象 | 排查方向 |
| --- | --- |
| 容器启动后退出，日志显示迁移失败 | 检查 `DATABASE_URL`、数据库连通性、密码中的特殊字符；不要清库重来 |
| `ready` 返回 503 | 数据库不可达、`User` 表不存在或存在未完成迁移；查看 `app` 与 `db` 日志 |
| Nginx 502 | 应用未启动、绑定地址/端口不一致，或 `APP_PORT` 与 Nginx `proxy_pass` 不一致 |
| 登录回调错误或登录后立即掉线 | `NEXTAUTH_URL` 与浏览器地址不一致；检查 `X-Forwarded-Proto` 和 HTTPS |
| 上传返回 413 | Nginx `client_max_body_size` 至少 70m；备份上传按 8 MiB 分块，附件单个上限由附件设置控制 |
| 恢复后打开页面只显示维护页 | 上次恢复未终结；查看 `BACKUP_DIR/restore-state.json` 与恢复报告，完成后由管理员解除，不要直接删状态文件 |
| 恢复预检提示缺少权限 | 外部 PostgreSQL 的应用账号需要 `CREATEDB` 且拥有目标数据库；内置 Compose 使用 `POSTGRES_USER`，通常无需额外授权 |
| 附件 404 / 权限错误 | 卷未挂载、挂载点错误，或多副本未共享同一存储 |
| 数据库密码含特殊字符导致连接失败 | 改用十六进制随机密码，或在 `DATABASE_URL` 中正确 URL 编码 |
| `prisma: not found` | 使用了自定义 ENTRYPOINT/CMD 覆盖镜像入口；恢复镜像默认启动方式 |
| 时区不正确 | 设置 `TZ` 并重启容器；确认宿主机时间同步 |
| 证书续期失败 | 检查 80 端口、ACME 路径、DNS 与 `certbot renew --dry-run` |

## 14. 上线验收清单

- [ ] 域名解析与 TLS 证书有效，HTTP 自动跳转 HTTPS。
- [ ] `NEXTAUTH_URL` 与公开地址完全一致。
- [ ] `live` 与 `ready` 均返回 200。
- [ ] 初始管理员已创建并完成首次改密，初始密码已从环境移除。
- [ ] 四类角色均可登录，且只能访问授权范围。
- [ ] 数据库、证明卷、附件卷均完成首次备份并验证可读。
- [ ] Nginx 配置独立、`nginx -t` 通过，未改动其他项目站点。
- [ ] 服务器重启后容器、Nginx 与证书续期均能自动恢复。
