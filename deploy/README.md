# 汇通云服务器部署

此目录将当前 Vue 网站及登录权限服务部署到独立 Linux 服务器。网站名称为“汇通云”，systemd 服务显示“汇通云服务器”。不改变服务器主机名、SSH配置或现有网站。

## 支持环境

- 已验收 TencentOS Server3.3（RHEL8兼容），同时支持Ubuntu22.04/24.04及更新版本、Debian12及更新版本；均需systemd和x86_64/ARM64。
- 公网IP默认`119.45.210.141`。首次安装的80/443/8787不能被其他应用占用；遇到现有网站会停止，需先规划共存方案。服务端8787仅绑定127.0.0.1。
- 腾讯云安全组需允许80、443入站。若firewalld正在运行，安装器仅新增`http`、`https`服务并保留SSH规则；8787不对公网开放。80用于证书验证和自动续期，不能在安装后关闭。
- 服务器需正常访问其系统软件仓库、`nodejs.org`、PyPI、Let's Encrypt ACME。TencentOS使用官方Python3.11和nginx1.24模块流；系统Python3.6保持不变。Node24.19.0安装包会校验官方SHA-256。
- 本次TencentOS验收主机的SELinux为Disabled。为避免绕过现有安全策略，若后续启用SELinux，安装器会停止并要求先补充专门策略，而不会自动关闭或放宽SELinux。

## 打包与安装

已生成V2.7源码版本`007702d`的预构建安装包，服务器无需运行npm构建。可在腾讯云服务器的root终端执行下面的入口；它会下载约3.1MB的固定版本安装包，核对SHA-256及压缩包路径，再调用正式安装器：

```sh
curl --fail --location --proto '=https' https://raw.githubusercontent.com/18829781266/Financial_Management_System/main/deploy/bootstrap.sh -o /root/huitong-bootstrap.sh && bash /root/huitong-bootstrap.sh
```

执行前应先核对本文件的支持环境和端口要求；普通用户需将脚本下载到自己的目录并用sudo运行。脚本运行时会隐藏输入两次应用管理员初始密码。GitHub不能访问、系统不支持、端口占用或证书申请失败时会显示错误并停止，不能据此认为已部署。

当前安装包在仓库中保存为`huitong-server-007702d.tar.gz.part-00`至`part-04`五个固定分片，入口脚本按顺序下载并在临时目录重组。完整包SHA-256：`4afe7a02b9153bc861763028920d6e9e652a427efde845499d9a4e90b9ab4f86`。包内`RELEASE.json`记录`applicationVersion=2.7.0`、`sourceCommit=007702d28f5b6b3e4587e237683552e7886a01e6`和`sourceDirty=false`。

开发机器在仓库根目录运行：

```sh
npm run setup
npm run build
node deploy/package.mjs
```

以打包命令实际打印的文件名为准，发布包只含构建后页面、生产运行服务、账号SQL迁移和安装文件，不含现有账号、密码、用户财务原件、测试数据或Java运行时依赖。`RELEASE.json`列出每个文件的大小和SHA-256。

把`huitong-server.tar.gz`和同名`.sha256`校验文件上传至服务器，在腾讯云终端的上传目录执行：

```sh
sha256sum -c huitong-server.tar.gz.sha256
mkdir huitong-deploy
mv huitong-server.tar.gz huitong-deploy/
cd huitong-deploy
tar -xzf huitong-server.tar.gz
cd huitong-server
sudo bash deploy/install.sh
```

解压目录必须干净；不要把压缩包、数据库或自建配置移进`huitong-server`目录。升级时换用新的空目录。

首次安装会隐藏输入两次管理员初始密码。账号为`admin`、姓名赵会计。可以设置此前使用的应用管理员密码；安装器不接触、保存或修改root服务器登录密码。不要用`bash -x`运行，也不要把密码放进命令参数。再次部署保留既有账号与密码配置。

默认站点地址：`https://119.45.210.141/`。如部署不同公网IP，在运行安装器前设置公开地址参数：

```sh
sudo HUITONG_PUBLIC_IP=您的公网IPv4 bash deploy/install.sh
```

安装器先核验清单、操作系统和端口，随后以低权限`huitong`系统账号运行网站。安装失败会恢复先前的应用软链接、本次替换的nginx/systemd配置及本次新增的firewalld网站规则；安装依赖、初始管理员配置和数据库备份会保留，便于排查重试。

## HTTPS与证书

账号Cookie要求HTTPS，PDF及文件哈希也依赖浏览器安全上下文。安装器在独立Python环境中固定使用Certbot5.4.0的IP证书功能，向Let's Encrypt优先申请`shortlived`证书，验证失败就停止，不会关闭Secure Cookie或使用自签名证书掩盖问题。

IP证书有效期较短，定时器每6小时检查续期并在成功后重新加载nginx。证书及ACME账户隔离在`/etc/huitong/letsencrypt`，不更改其他网站的证书配置。安装期间必须确保公网80可达。

```sh
systemctl status huitong-cloud
systemctl status nginx
systemctl list-timers huitong-cert-renew.timer
journalctl -u huitong-cloud -n 80 --no-pager
journalctl -u huitong-cert-renew.service -n 80 --no-pager
```

## 持久化、备份和升级

| 路径 | 用途 |
|---|---|
| `/opt/huitong/current` | 当前发布版本软链接 |
| `/opt/huitong/releases` | 历史发布版本，安装器不自动删除 |
| `/opt/huitong/node` | 本应用独立Node运行时 |
| `/etc/huitong/huitong.env` | root专用权限600，初始密码仅存加盐摘要 |
| `/var/lib/huitong` | 本服务器账号、会话及登录限流SQLite数据库 |
| `/opt/huitong/backups` | 升级前停止服务后生成的一致性数据库备份 |
| `/etc/nginx/conf.d/huitong-cloud.conf` | 本应用独立nginx站点配置 |

升级时上传新的发布包，在新空目录解压并重新运行安装器。安装器保留数据库和管理员配置；停止应用后备份数据库，原子切换当前版本，再检查本机健康及真实HTTPS页面后启用服务。数据库迁移有事务和版本清单。

回滚应用会保留当前账号数据库，不会悄悄恢复旧快照导致新建账号丢失。若后续版本含不兼容迁移，需先停止服务，在维护窗口核对并手动恢复相应备份；不要在有人使用系统时覆盖数据库。

## 数据边界与验证

此部署保留现有网站的数据保存方式：服务器持久保存账号和权限；凭证、单据、匹配关系与规则仍保存在访问者当前浏览器，原件及生成PDF在IndexedDB。换公网地址是新的浏览器来源，旧网址的财务数据不会自动迁移；原托管平台的普通用户账号也不会自动复制到新SQLite。超级管理员可在新服务创建普通用户。

打包不会擅自启用尚未接入权限/租户的Java业务API或接入第三方OCR。若需要多电脑共享同一套财务数据，需要另行完成业务数据库与附件存储接入。

安装完成后应从公网电脑打开HTTPS地址，用管理员登录，创建普通用户并验证登录、退出确认及删除后会话失效。原始单据导入、匹配、档案预览及PDF导出仍在浏览器执行。安装器的本机检查只能证明应用与反向代理通畅，不能代替公网安全组可达性测试。

## 本地生产适配测试

```sh
node --test deploy/runtime.test.mjs
bash -n deploy/install.sh
```

安装脚本需要真实systemd和公网IP证书验证；上述测试不会连接或修改云服务器。发布包已准备好不等于服务器已部署，必须以远程安装日志和公网访问结果为准。

Certbot IP支持依据：官方[5.4.0变更记录](https://github.com/certbot/certbot/blob/main/certbot/CHANGELOG.md)（webroot支持IP签发）、[命令行定义](https://github.com/certbot/certbot/blob/main/certbot/src/certbot/_internal/cli/__init__.py)（`--ip-address`及证书profile）。
