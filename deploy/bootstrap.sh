#!/usr/bin/env bash
# 在腾讯云终端中运行：下载固定版本的预构建包，校验后交给正式安装器。
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { printf '请在服务器root终端运行，或使用sudo bash执行。\n' >&2; exit 1; }
for command in curl sha256sum tar python3; do
    command -v "$command" >/dev/null || { printf '缺少必要工具：%s，请先安装后重试。\n' "$command" >&2; exit 1; }
done
PACKAGE_URL=https://raw.githubusercontent.com/18829781266/Financial_Management_System/main/deploy/bundles/huitong-server-98d1bda.tar.gz
PACKAGE_SHA256=10c117ebb4d34c2898510a6633765058738d08c30a504e0c335de6a96fc46716
download_directory=$(mktemp -d /tmp/huitong-download.XXXXXXXX)
cleanup() { local status=$?; rm -rf -- "$download_directory"; exit "$status"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

printf '正在下载汇通云服务器安装包（源码版本98d1bda，约3.1MB）……\n'
curl --fail --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --connect-timeout 15 --max-time 300 \
    "$PACKAGE_URL" -o "$download_directory/huitong-server.tar.gz"
printf '%s  %s\n' "$PACKAGE_SHA256" "$download_directory/huitong-server.tar.gz" | sha256sum --check --status || {
    printf '安装包SHA-256不一致，已停止安装。\n' >&2; exit 1;
}
# 检查压缩包路径和类型；不把链接、特殊设备或越界文件解压到系统中。
python3 - "$download_directory/huitong-server.tar.gz" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    total = 0
    names = set()
    for member in archive:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'huitong-server':
            raise SystemExit('压缩包路径无效。')
        if not (member.isfile() or member.isdir()) or '\\' in member.name or member.name in names:
            raise SystemExit('压缩包存在链接、重复路径或特殊文件。')
        names.add(member.name)
        total += member.size
        if total > 64 * 1024 * 1024 or len(names) > 10000:
            raise SystemExit('安装包超出预期大小。')
    if 'huitong-server/deploy/install.sh' not in names or 'huitong-server/RELEASE.json' not in names:
        raise SystemExit('安装包缺少正式安装器或发布清单。')
print('安装包完整性与安全路径校验通过。')
PY
tar --extract --gzip --file "$download_directory/huitong-server.tar.gz" \
    --directory "$download_directory" --no-same-owner --no-same-permissions
bash "$download_directory/huitong-server/deploy/install.sh"
