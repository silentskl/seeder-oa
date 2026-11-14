# Seeder OA：Cloudflare → Ubuntu 24.04 Docker 迁移操作手册

**目标**：保持原域名 oa.smartenx.com，使用 Next.js Node 容器 + 本地 SQLite + 本地文件目录 + 5 分钟同步容器，替换 Cloudflare Workers / D1 / R2 / Cron。

Seeder 上游 v2.1.0 已支持 RUNTIME=node。本仓库额外提供 OA D1/R2 兼容层。D1 全量 SQL、用户/会话、Entity、HR、审批、Invoice、AI 配置和邮件同步任务均保留；R2 所有对象保留原始 key 和 Content-Type。旧 Cloudflare 数据不删除。

**特别重要：切换前必须禁止旧服务写入，否则导出和恢复无法保证一致。**

## 1. 迁移对应关系

| Cloudflare | Ubuntu |
|---|---|
| Worker smarten-oa | Docker Compose app |
| D1 PM_DB | /data/seeder-oa/seeder.db（SQLite） |
| R2 UPLOADS | /data/seeder-oa/uploads/（保留原 key） |
| Cloudflare 财务 Cron | Docker Compose mail-scheduler |
| Worker Secrets | deploy/ubuntu/.env (chmod 600) |
| HTTPS 域名 | Nginx TLS → 127.0.0.1:3000 |

不要在 Ubuntu 运行旧 update-deploy.sh，也不要直接运行默认的 apply-to-existing.sh，这两个脚本会操作 Cloudflare 发布。使用 deploy/ubuntu/prepare-app.sh，它仅本地打补丁，强制 OA_SKIP_DEPLOY=1。

## 2. 在原 Cloudflare 机器导出

~~~bash
cd /Users/sklang/Documents/work/seeder-oa
git pull --ff-only origin main
git submodule sync --recursive
git submodule update --init --recursive
cd seeder-oa-app && npm ci && cd ..

python3 -m venv /tmp/oa-r2-venv
source /tmp/oa-r2-venv/bin/activate
pip install -r deploy/ubuntu/requirements.txt

cd seeder-oa-app
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
cd ..
~~~

从 Cloudflare Dashboard → R2 创建只读 S3 API 凭证，在本机环境中设置（不要提交到 Git）：

~~~bash
export CLOUDFLARE_ACCOUNT_ID='<Cloudflare account ID>'
export R2_ACCESS_KEY_ID='<R2 read-only access key>'
export R2_SECRET_ACCESS_KEY='<R2 read-only secret>'
export CONFIRM_D1_DATABASE_ID='<当前生产 D1 数据库 ID>'
export CONFIRM_R2_BUCKET_NAME='<当前生产 R2 bucket>'
~~~

务必核对 seeder-oa-app/wrangler.jsonc 的 PM_DB 与 UPLOADS 绑定和 Dashboard。以往部署日志中的 D1 ID 是 a2113d04-54d8-4a16-b4e6-d0a1300ea341，**只是参考，不可代替当前验证**。R2 bucket 名称以当前配置为准。

~~~bash
# 彩排备份：持续有业务写入时可能不一致，仅用于预演
bash deploy/ubuntu/export-cloudflare.sh /secure/oa-export-rehearsal
~~~

导出包含 d1.sql、source.json（D1 SHA-256）、r2/（全部原始对象和 meta.json 元数据）及 r2-manifest.json（每个对象的 SHA-256）。

**正式导出**必须在 OA 和 webhook 禁止写入、旧 Cloudflare 财务 Cron 停止后，使用**新的空目录** /secure/oa-export-final，不能复用彩排目录。原 D1/R2/Worker 保留。

## 3. Ubuntu 环境准备

~~~bash
sudo apt update
sudo apt install -y git python3 sqlite3 rsync
# 另按 Docker 官方文档安装 Docker Engine + Compose v2

git clone --recurse-submodules https://github.com/silentskl/seeder-oa.git
cd seeder-oa
git submodule sync --recursive && git submodule update --init --recursive
bash deploy/ubuntu/prepare-app.sh

cp deploy/ubuntu/.env.example deploy/ubuntu/.env
chmod 600 deploy/ubuntu/.env
~~~

在 deploy/ubuntu/.env 中设置：

~~~dotenv
BETTER_AUTH_URL=https://oa.smartenx.com
OWNER_EMAIL=<现有 Owner 的邮箱>
BETTER_AUTH_SECRET=<Cloudflare 原值>
VCS_ENCRYPTION_KEY=<Cloudflare 原值>
OA_SETTINGS_MASTER_KEY=<Cloudflare 原值>
OA_FINANCE_SYNC_TOKEN=<Cloudflare 原值；若原来未配置则生成至少32字符的新值>
OA_MULTI_ENTITY_BUSINESS_ENABLED=<原开关值>
OA_FINANCE_MULTI_ENTITY_ENABLED=<原开关值>
OA_DATA_DIR=/data/seeder-oa
OA_HTTP_PORT=3000
~~~

**原密钥必须延续**：Better Auth Secret 用于会话签名；VCS Encryption Key 解密 Git 集成凭证；OA Settings Master Key 解密已保存的邮箱 Client Secret、ModelBridge Key 等。Cloudflare Worker Secret 通常不能从 Dashboard 反向读取原明文，应在原安全备份、密码管理器或 .oa-deploy-secrets 中恢复。缺少旧 OA Settings Master Key 时，不能仅生成新密钥替代，否则旧密文无法解密。

如果以前启用了 Google 登录、Resend Webhook/API Key、AI API Key、可信来源设置，也复制原环境变量。Cloudflare R2 Access Key 仅用于导出，不要放入 Ubuntu 的 Docker .env。

建议单独 SSD 云盘 /data/seeder-oa，启用磁盘加密与异地备份。预留至少 2 倍 R2 文件容量及 SQL/数据库恢复空间。

## 4. 彩排导入及一致性校验

通过 SSH/rsync 安全传输完整快照：

~~~bash
rsync -a --partial --progress /secure/oa-export-rehearsal/ \
  ubuntu@YOUR_HOST:/srv/oa-migration/rehearsal/
~~~

Ubuntu 运行：

~~~bash
cd ~/seeder-oa
python3 deploy/ubuntu/restore-cloudflare.py \
  --snapshot /srv/oa-migration/rehearsal \
  --data /data/seeder-oa-rehearsal
python3 deploy/ubuntu/verify-migration.py \
  --data /data/seeder-oa-rehearsal
~~~

验证包括 SQLite integrity_check / foreign_key_check、全部生产表和行数、所有 R2 对象哈希、所有数据库 r2_key 引用，结果记录在 migration-report.json。**恢复程序拒绝覆盖已存在的数据库和附件目录**。彩排数据与正式数据必须使用不同路径。

## 5. 最终迁移与切换流量

1. 安排维护窗口。将旧 Cloudflare OA 设为只读/维护、暂停审批与发票上传、旧财务 Cron、Resend inbound webhook 等写入。确认没有进行中的上传和审批。
2. 重新运行 export-cloudflare.sh 到新的 /secure/oa-export-final；传输到 /srv/oa-migration/final。不要使用彩排快照代替最后快照。
3. 在 Ubuntu 离线恢复、校验：

~~~bash
cd ~/seeder-oa
python3 deploy/ubuntu/restore-cloudflare.py \
  --snapshot /srv/oa-migration/final --data /data/seeder-oa
python3 deploy/ubuntu/verify-migration.py --data /data/seeder-oa
sudo chown -R 1000:1000 /data/seeder-oa
~~~

4. 构建 Node 镜像，并运行 Seeder 上游的 SQLite 迁移脚本（**不调用 Wrangler**）：

~~~bash
cd ~/seeder-oa/deploy/ubuntu
docker compose --env-file .env build
docker compose --env-file .env run --rm --no-deps app npm run db:migrate:node
docker compose --env-file .env up -d
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 app
docker compose --env-file .env logs --tail=100 mail-scheduler
~~~

5. 使用 nginx-oa.conf.example 的反代设置、申请有效 HTTPS 证书；首先通过测试机 hosts 文件指向 Ubuntu 检查 OA 登录、原用户/权限、发票 PDF、R2 证明文件、审批、AI 识别、邮箱及历史同步。
6. 验收通过后将 oa.smartenx.com 指向新服务器。确保 Cloudflare 原 Cron 仍停用，不要让两端分别写不同的数据库。原 Resend webhook 和 Google OAuth 回调保持同一 HTTPS 域名。
7. 旧 Cloudflare 数据和 Worker 至少保留完整回滚窗口；**不可立即删除**。

## 6. Ubuntu 日常备份与更新

备份 SQLite + 所有文件，短暂停止应用保证附件一致性：

~~~bash
cd ~/seeder-oa/deploy/ubuntu
docker compose --env-file .env stop
python3 backup-local.py --data /data/seeder-oa \
  --output /data/backups/seeder-oa-$(date +%Y%m%d-%H%M%S).tar.gz
docker compose --env-file .env up -d
~~~

建议每日异地加密备份并定期演练恢复。更新代码时：

~~~bash
cd ~/seeder-oa
git pull --ff-only origin main
git submodule sync --recursive && git submodule update --init --recursive
bash deploy/ubuntu/prepare-app.sh
cd deploy/ubuntu
docker compose --env-file .env stop
python3 backup-local.py --data /data/seeder-oa \
  --output /data/backups/oa-before-update-$(date +%Y%m%d-%H%M%S).tar.gz
docker compose --env-file .env build
docker compose --env-file .env run --rm --no-deps app npm run db:migrate:node
docker compose --env-file .env up -d
~~~

切回 Cloudflare 的风险：**Ubuntu 上线后产生的数据不会自动同步回 D1/R2**。如果要切回旧 Worker，必须先冻结新服务器写入、安排差量迁移或恢复共同快照，不能仅修改 DNS 而忽略新记录。

## 7. 常见问题

- **启动拒绝：数据库为空**：恢复目录错误或 OA_DATA_DIR 配置不一致，不能让服务启动空 DB。
- **SQLite readonly**：将 /data/seeder-oa 设为 Docker node 用户 UID 1000 可读写。
- **旧用户登录失败**：确认 BETTER_AUTH_URL / BETTER_AUTH_SECRET 以及 Nginx 的 X-Forwarded-Proto。
- **邮箱、ModelBridge Key 解密失败**：恢复原 OA_SETTINGS_MASTER_KEY。
- **VCS Token 失效**：恢复原 VCS_ENCRYPTION_KEY。
- **缺附件**：核对 R2 bucket、对象 key、verify-migration.py。
- **邮件同步不运行**：查看 mail-scheduler 日志并检查 OA_FINANCE_SYNC_TOKEN。
- **Docker Build 失败**：Ubuntu 需要访问 npm registry；不能把 Mac 的 node_modules 直接复制到 Linux。
