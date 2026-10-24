#!/usr/bin/env bash
# 汇通云服务器：安装本地解压后的预构建发布包。不改动现有 SSH 或防火墙规则。
set -Eeuo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
APP_ROOT=/opt/huitong
CONFIG_DIR=/etc/huitong
NGINX_CONF=/etc/nginx/conf.d/huitong-cloud.conf
SERVICE=huitong-cloud.service
NODE_VERSION=24.19.0
PUBLIC_IP=${HUITONG_PUBLIC_IP:-119.45.210.141}
BUNDLE_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
STAGE_DIR=''
ROLLBACK_DIR=''
PREVIOUS_RELEASE=''
SWITCHED=0
CONFIG_WRITTEN=0
UNIT_WRITTEN=0
TIMER_WRITTEN=0
SERVICE_WAS_ACTIVE=0
SERVICE_WAS_ENABLED=0
APP_STOPPED=0
TIMER_WAS_ACTIVE=0
TIMER_WAS_ENABLED=0
FINISHED=0

fail() { printf '部署中止：%s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }
cleanup() {
    local result=$?
    if (( result != 0 && FINISHED == 0 && (CONFIG_WRITTEN || UNIT_WRITTEN || TIMER_WRITTEN || SWITCHED || APP_STOPPED) )); then
        printf '\n部署未完成，正在恢复本次替换前的应用与配置。\n' >&2
        set +e
        if (( SWITCHED )); then
            if (( ! SERVICE_WAS_ENABLED )); then systemctl disable "$SERVICE" >/dev/null 2>&1; fi
            systemctl stop "$SERVICE" >/dev/null 2>&1
            if [[ -n "$PREVIOUS_RELEASE" ]]; then
                ln -s "$PREVIOUS_RELEASE" "$APP_ROOT/.rollback-current"
                mv -Tf "$APP_ROOT/.rollback-current" "$APP_ROOT/current"
            else
                rm -f "$APP_ROOT/current"
            fi
        fi
        if [[ -n "$ROLLBACK_DIR" && -d "$ROLLBACK_DIR" ]]; then
            if (( CONFIG_WRITTEN )); then
                if [[ -f "$ROLLBACK_DIR/nginx.conf" ]]; then cp -a "$ROLLBACK_DIR/nginx.conf" "$NGINX_CONF"; else rm -f "$NGINX_CONF"; fi
            fi
            if (( UNIT_WRITTEN )); then
                if [[ -f "$ROLLBACK_DIR/app.service" ]]; then cp -a "$ROLLBACK_DIR/app.service" "/etc/systemd/system/$SERVICE"; else rm -f "/etc/systemd/system/$SERVICE"; fi
            fi
            if (( TIMER_WRITTEN )); then
                systemctl disable --now huitong-cert-renew.timer >/dev/null 2>&1
                for unit in huitong-cert-renew.service huitong-cert-renew.timer; do
                    if [[ -f "$ROLLBACK_DIR/$unit" ]]; then cp -a "$ROLLBACK_DIR/$unit" "/etc/systemd/system/$unit"; else rm -f "/etc/systemd/system/$unit"; fi
                done
            fi
        fi
        systemctl daemon-reload >/dev/null 2>&1
        if (( SERVICE_WAS_ACTIVE )); then systemctl start "$SERVICE" >/dev/null 2>&1; fi
        if (( TIMER_WAS_ENABLED )); then systemctl enable huitong-cert-renew.timer >/dev/null 2>&1; fi
        if (( TIMER_WAS_ACTIVE )); then systemctl start huitong-cert-renew.timer >/dev/null 2>&1; fi
        if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then systemctl reload nginx >/dev/null 2>&1; fi
        printf '安装日志见终端输出。软件包、初始账号配置及数据库备份保留，便于重试；未清空业务数据。\n' >&2
    fi
    [[ -z "$STAGE_DIR" ]] || rm -rf -- "$STAGE_DIR"
    [[ -z "$ROLLBACK_DIR" ]] || rm -rf -- "$ROLLBACK_DIR"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

[[ $EUID -eq 0 ]] || fail '请使用 sudo bash deploy/install.sh 或 root 运行。'
command -v flock >/dev/null || fail '缺少flock（util-linux）。'
exec 9>/run/lock/huitong-install.lock
flock -n 9 || fail '已有汇通云安装任务正在运行。'
[[ -f /etc/os-release ]] || fail '无法识别操作系统。仅支持 Ubuntu 22.04+ / Debian 12+。'
# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}" in
    ubuntu) [[ ${VERSION_ID%%.*} -ge 22 ]] || fail 'Ubuntu 至少需要22.04。' ;;
    debian) [[ ${VERSION_ID%%.*} -ge 12 ]] || fail 'Debian 至少需要12。' ;;
    *) fail "尚未验证此操作系统（${PRETTY_NAME:-unknown}）。请先提供系统版本，勿强制运行。" ;;
esac
[[ -d /run/systemd/system ]] || fail '此安装器需要 systemd，请在云服务器本机终端运行。'
command -v python3 >/dev/null || fail '请先安装 python3，再运行安装器。'
python3 - "$PUBLIC_IP" "$BUNDLE_ROOT" <<'PY'
import hashlib, ipaddress, json, os, pathlib, stat, sys
ip = ipaddress.ip_address(sys.argv[1])
if ip.version != 4 or not ip.is_global:
    raise SystemExit('必须配置公网 IPv4 地址。')
if sys.version_info < (3,10):
    raise SystemExit('需要 Python 3.10+。')
root = pathlib.Path(sys.argv[2]).resolve()
manifest_path=root/'RELEASE.json'
manifest=json.loads(manifest_path.read_text())
if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('files'),list):
    raise SystemExit('发布清单格式无效。')
expected=set()
for item in manifest['files']:
    name=item['path']; rel=pathlib.PurePosixPath(name)
    if rel.is_absolute() or '..' in rel.parts or '\\' in name or name in expected or name=='RELEASE.json':
        raise SystemExit('发布清单包含不安全路径。')
    expected.add(name); path=root/name
    if not path.is_file() or path.is_symlink() or path.stat().st_size!=item['size']:
        raise SystemExit('发布文件缺失或大小不一致：'+name)
    if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
        raise SystemExit('发布文件校验失败：'+name)
actual=set()
for directory, dirs, files in os.walk(root, followlinks=False):
    for name in dirs+files:
        path=pathlib.Path(directory)/name
        if path.is_symlink(): raise SystemExit('发布目录不得包含符号链接。')
    for name in files:
        path=pathlib.Path(directory)/name
        if not stat.S_ISREG(path.stat().st_mode): raise SystemExit('发布目录包含非常规文件。')
        actual.add(path.relative_to(root).as_posix())
if actual-{'RELEASE.json'} != expected:
    raise SystemExit('目录中存在未列入清单的文件，必须在干净目录解压发布包。')
for required in ['deploy/server.mjs','deploy/install.sh','frontend/worker/auth.js','frontend/dist/client/index.html']:
    if required not in expected: raise SystemExit('发布包缺少必要文件：'+required)
print('发布清单与全部文件 SHA-256 校验通过。')
PY

for path in "$APP_ROOT" "$CONFIG_DIR" /var/lib/huitong "$NGINX_CONF" "$CONFIG_DIR/huitong.env"; do
    [[ ! -L "$path" ]] || fail "拒绝使用符号链接目录：$path"
done
if [[ -e "$APP_ROOT" && ! -f "$APP_ROOT/.managed-by-huitong" ]]; then
    fail "$APP_ROOT 已存在且不属于此安装器；请先核对，避免覆盖其他文件。"
fi
if getent passwd huitong >/dev/null; then
    [[ -f "$APP_ROOT/.managed-by-huitong" ]] || fail '系统已有名为huitong的账号，且未找到本应用管理标记；请先核对。'
    IFS=: read -r _ _ app_uid app_gid _ app_home app_shell < <(getent passwd huitong)
    [[ "$app_uid" -gt 0 && "$app_home" == /var/lib/huitong && "$app_shell" == /usr/sbin/nologin ]] || fail '现有huitong账号身份或目录异常。'
    [[ $(id -gn huitong) == huitong && $(id -G huitong) == "$app_gid" ]] || fail '现有huitong账号包含非预期的组权限。'
fi
if [[ -f "$CONFIG_DIR/huitong.env" && ! -f "$APP_ROOT/.managed-by-huitong" ]]; then
    fail '检测到既有凭据配置但缺少本应用管理标记，请先核对。'
fi
for unit in huitong-cloud.service huitong-cert-renew.service huitong-cert-renew.timer; do
    unit_path="/etc/systemd/system/$unit"
    [[ ! -L "$unit_path" ]] || fail "拒绝覆盖符号链接单元：$unit_path"
    if [[ -e "$unit_path" ]] && ! head -1 "$unit_path" | grep -q '^# Managed by huitong-cloud installer'; then
        fail "$unit_path 已存在且不属于此安装器。"
    fi
done
if [[ -e "$NGINX_CONF" ]] && ! head -1 "$NGINX_CONF" | grep -q '^# Managed by huitong-cloud installer'; then
    fail "$NGINX_CONF 已存在且不属于此安装器。"
fi
# 首次安装遇到既有网站时停止，由操作者明确规划端口，不能覆盖其他网站。
if command -v ss >/dev/null; then
    listeners=$(ss -H -ltnp '( sport = :80 or sport = :443 )')
    if [[ -n "$listeners" && ! -f "$NGINX_CONF" ]]; then
        fail '80/443已被现有服务占用。请先规划共存方案；安装器没有停掉或覆盖该服务。'
    fi
    if [[ -n "$listeners" ]] && printf '%s' "$listeners" | grep -v 'nginx' >/dev/null; then
        fail '80/443包含非nginx服务，需先规划共存方案。'
    fi
    if [[ -n "$(ss -H -ltnp '( sport = :8787 )')" ]] && ! systemctl is-active --quiet "$SERVICE"; then
        fail '8787已被其他服务占用。'
    fi
else
    fail '缺少 ss（iproute2）；请先安装 iproute2 以检查现有服务。'
fi
if [[ ! -f "$CONFIG_DIR/huitong.env" && ! -r /dev/tty ]]; then
    fail '首次安装需要交互终端隐藏输入管理员初始密码。'
fi

log '检查完成，安装 nginx、证书工具及独立 Node.js24 运行环境。'
apt-get update
apt-get install -y --no-install-recommends nginx ca-certificates curl xz-utils python3-venv
install -d -m 755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/backups"
touch "$APP_ROOT/.managed-by-huitong"
install -d -m 700 "$CONFIG_DIR"
ROLLBACK_DIR=$(mktemp -d)
[[ ! -f "$NGINX_CONF" ]] || cp -a "$NGINX_CONF" "$ROLLBACK_DIR/nginx.conf"
[[ ! -f "/etc/systemd/system/$SERVICE" ]] || cp -a "/etc/systemd/system/$SERVICE" "$ROLLBACK_DIR/app.service"
for unit in huitong-cert-renew.service huitong-cert-renew.timer; do
    [[ ! -f "/etc/systemd/system/$unit" ]] || cp -a "/etc/systemd/system/$unit" "$ROLLBACK_DIR/$unit"
done
systemctl is-active --quiet "$SERVICE" && SERVICE_WAS_ACTIVE=1
systemctl is-enabled --quiet "$SERVICE" && SERVICE_WAS_ENABLED=1
systemctl is-active --quiet huitong-cert-renew.timer && TIMER_WAS_ACTIVE=1
systemctl is-enabled --quiet huitong-cert-renew.timer && TIMER_WAS_ENABLED=1
[[ ! -L "$APP_ROOT/current" ]] || PREVIOUS_RELEASE=$(readlink "$APP_ROOT/current")

if [[ ! -x "$APP_ROOT/node/bin/node" ]] || [[ $("$APP_ROOT/node/bin/node" --version) != "v$NODE_VERSION" ]]; then
    STAGE_DIR=$(mktemp -d)
    case "$(uname -m)" in x86_64) architecture=x64;; aarch64|arm64) architecture=arm64;; *) fail '仅支持x86_64/ARM64架构。';; esac
    archive="node-v$NODE_VERSION-linux-$architecture.tar.xz"
    curl --fail --show-error --location --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$STAGE_DIR/SHASUMS256.txt"
    curl --fail --show-error --location --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/$archive" -o "$STAGE_DIR/$archive"
    (cd "$STAGE_DIR"; grep "  $archive\$" SHASUMS256.txt | sha256sum --check --status) || fail 'Node安装包校验失败。'
    mkdir "$STAGE_DIR/node"
    tar -xJf "$STAGE_DIR/$archive" --strip-components=1 -C "$STAGE_DIR/node"
    chown -R root:root "$STAGE_DIR/node"
    # umask077保护秘密；运行时发行包必须允许低权限服务账号读取和执行。
    chmod -R a+rX "$STAGE_DIR/node"
    chmod 755 "$STAGE_DIR/node"
    if [[ -d "$APP_ROOT/node" ]]; then mv "$APP_ROOT/node" "$APP_ROOT/backups/node-$(date -u +%Y%m%dT%H%M%S)"; fi
    mv "$STAGE_DIR/node" "$APP_ROOT/node"
    rm -rf "$STAGE_DIR"; STAGE_DIR=''
fi
"$APP_ROOT/node/bin/node" -e 'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)'

# 摘要在管道内生成；原始口令不进入命令参数、文件或日志。
if [[ ! -f "$CONFIG_DIR/huitong.env" ]]; then
    read -r -s -p '设置超级管理员admin（赵会计）的初始密码，6–128字符：' password </dev/tty
    printf '\n' >/dev/tty
    read -r -s -p '再次输入密码：' confirmation </dev/tty
    printf '\n' >/dev/tty
    [[ "$password" == "$confirmation" ]] || fail '两次密码不一致。'
    password_hash=$(printf '%s' "$password" | "$APP_ROOT/node/bin/node" --input-type=module -e '
      import {pbkdf2Sync, randomBytes} from "node:crypto";
      let data=""; for await(const chunk of process.stdin)data+=chunk;
      if(data.length<6||data.length>128){console.error("密码须为6–128字符。");process.exit(1);}
      const salt=randomBytes(16); process.stdout.write(`pbkdf2-sha256$100000$${salt.toString("hex")}$${pbkdf2Sync(data,salt,100000,32,"sha256").toString("hex")}`);
    ')
    unset password confirmation
    printf 'PUBLIC_ORIGIN=https://%s\nHOST=127.0.0.1\nPORT=8787\nHUITONG_DATA_DIR=/var/lib/huitong\nADMIN_PASSWORD_HASH=%s\n' "$PUBLIC_IP" "$password_hash" >"$CONFIG_DIR/huitong.env"
    unset password_hash
    chmod 600 "$CONFIG_DIR/huitong.env"
else
    # 只核对公开地址，不打印或加载整份凭据配置。
    grep -Fxq "PUBLIC_ORIGIN=https://$PUBLIC_IP" "$CONFIG_DIR/huitong.env" || fail '已有配置的PUBLIC_ORIGIN不同；请先手动核对，安装器未改写原账号配置。'
    log '保留现有管理员配置、用户及会话数据库。'
fi
getent passwd huitong >/dev/null || useradd --system --user-group --home-dir /var/lib/huitong --shell /usr/sbin/nologin huitong
install -d -m 700 -o huitong -g huitong /var/lib/huitong
install -d -m 755 /var/lib/huitong-acme-webroot
python3 -m venv "$APP_ROOT/certbot"
"$APP_ROOT/certbot/bin/pip" --disable-pip-version-check install --upgrade 'certbot>=5.4,<6'

release_id="$(date -u +%Y%m%dT%H%M%S)-$(sha256sum "$BUNDLE_ROOT/RELEASE.json" | cut -c1-12)"
release_dir="$APP_ROOT/releases/$release_id"
mkdir -m 755 "$release_dir"
cp -a "$BUNDLE_ROOT/." "$release_dir/"
chown -R root:root "$release_dir"
find "$release_dir" -type d -exec chmod 755 {} +
find "$release_dir" -type f -exec chmod 644 {} +

# 隔离IP证书目录，避免改变服务器上其他证书的续期配置。
if [[ ! -f "$CONFIG_DIR/letsencrypt/live/huitong-ip/fullchain.pem" ]]; then
    CONFIG_WRITTEN=1
    sed "s/@@IP@@/$PUBLIC_IP/g" "$release_dir/deploy/nginx/huitong-http.conf" >"$NGINX_CONF"
    nginx -t
    systemctl enable --now nginx
    systemctl reload nginx
fi
log '核验或申请受信任的公网IP HTTPS证书。腾讯云安全组必须允许80/443入站。'
"$APP_ROOT/certbot/bin/certbot" certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --webroot --webroot-path /var/lib/huitong-acme-webroot --ip-address "$PUBLIC_IP" \
    --required-profile shortlived --cert-name huitong-ip --keep-until-expiring \
    --config-dir "$CONFIG_DIR/letsencrypt" --work-dir /var/lib/huitong-acme --logs-dir /var/log/huitong-acme

# 升级先暂停应用并备份SQLite及其WAL，保证备份的一致性；不删除旧版本。
if (( SERVICE_WAS_ACTIVE )); then APP_STOPPED=1; systemctl stop "$SERVICE"; fi
if [[ -n "$(find /var/lib/huitong -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    tar -C /var/lib -czf "$APP_ROOT/backups/data-$release_id.tar.gz" huitong
    chmod 600 "$APP_ROOT/backups/data-$release_id.tar.gz"
fi
ln -s "$release_dir" "$APP_ROOT/.next-current"
mv -Tf "$APP_ROOT/.next-current" "$APP_ROOT/current"
SWITCHED=1
UNIT_WRITTEN=1
install -m 644 "$release_dir/deploy/systemd/$SERVICE" "/etc/systemd/system/$SERVICE"
TIMER_WRITTEN=1
for unit in huitong-cert-renew.service huitong-cert-renew.timer; do
    install -m 644 "$release_dir/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl start "$SERVICE"
healthy=0
for attempt in {1..20}; do
    if curl --silent --fail --max-time 3 -H "Host: $PUBLIC_IP" -H 'X-Forwarded-Proto: https' http://127.0.0.1:8787/healthz >/dev/null; then healthy=1; break; fi
    sleep 1
done
(( healthy )) || fail '应用健康检查失败，可用 journalctl -u huitong-cloud 查看不含密码的服务日志。'
CONFIG_WRITTEN=1
sed "s/@@IP@@/$PUBLIC_IP/g" "$release_dir/deploy/nginx/huitong-https.conf" >"$NGINX_CONF"
nginx -t
systemctl enable --now nginx
systemctl reload nginx
# 本机TLS验证保持证书校验开启，同时确保反向代理和SPA均已接通。
curl --fail --silent --show-error --max-time 15 --resolve "$PUBLIC_IP:443:127.0.0.1" "https://$PUBLIC_IP/healthz" >/dev/null
curl --fail --silent --show-error --max-time 15 --resolve "$PUBLIC_IP:443:127.0.0.1" "https://$PUBLIC_IP/" >/dev/null
systemctl enable "$SERVICE"
systemctl enable --now huitong-cert-renew.timer
FINISHED=1
printf '\n汇通云服务器部署完成： https://%s/\n账号：admin（赵会计）；使用刚才设置或已有的管理员密码。\n' "$PUBLIC_IP"
printf '发布版本：%s\n账号数据库：/var/lib/huitong\n凭据配置：/etc/huitong/huitong.env（root专用）\n' "$release_id"
printf '服务：systemctl status huitong-cloud\n证书续期：systemctl list-timers huitong-cert-renew.timer\n'
