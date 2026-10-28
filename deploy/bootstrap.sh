#!/usr/bin/env bash
# 在腾讯云终端中运行：下载固定版本的预构建包，校验后交给正式安装器。
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { printf '请在服务器root终端运行，或使用sudo bash执行。\n' >&2; exit 1; }
for command in curl sha256sum tar python3; do
    command -v "$command" >/dev/null || { printf '缺少必要工具：%s，请先安装后重试。\n' "$command" >&2; exit 1; }
done
PACKAGE_PART_PREFIX=https://raw.githubusercontent.com/18829781266/Financial_Management_System/main/deploy/bundles/huitong-server-007702d.tar.gz.part-
PACKAGE_SHA256=4afe7a02b9153bc861763028920d6e9e652a427efde845499d9a4e90b9ab4f86
download_directory=$(mktemp -d /tmp/huitong-download.XXXXXXXX)
cleanup() { local status=$?; rm -rf -- "$download_directory"; exit "$status"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

printf '正在下载汇通云服务器安装包（V2.7，源码版本007702d，约3.1MB）……\n'
: > "$download_directory/huitong-server.tar.gz"
for suffix in 00 01 02 03 04; do
    curl --fail --show-error --location --proto '=https' --tlsv1.2 \
        --retry 3 --connect-timeout 15 --max-time 300 \
        "${PACKAGE_PART_PREFIX}${suffix}" -o "$download_directory/package.part-${suffix}"
    cat "$download_directory/package.part-${suffix}" >> "$download_directory/huitong-server.tar.gz"
done
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
