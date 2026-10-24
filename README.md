# 汇通云 · 电子凭证自动匹配与归档系统

[在线站点](https://langchao-archive-cloud.tealtrail19.chatgpt.site/)

汇通云提供凭证与原始单据批量采集、规则匹配、人工复核、原件翻页及放大、PDF档案册生成与检索。采用 Vue 3、TypeScript、Element Plus；账号与权限由 Cloudflare Worker + D1 提供。仓库同时包含 Java 17 + Spring Boot 3、MyBatis-Plus、MySQL 8、Redis、PDFBox 配套财务业务后端。

## 项目结构

| 目录 | 内容 |
|---|---|
| `frontend/src` | 登录页、用户管理及全部财务工作区源码 |
| `frontend/worker` | 登录、会话、超级管理员创建与删除用户的服务端接口 |
| `frontend/db`、`frontend/drizzle` | 账号表结构、SQL迁移及Drizzle元数据 |
| `frontend/scripts` | 构建、本地管理员配置、D1预览及打包工具 |
| `frontend/tests` | 业务、认证和浏览器测试；仅包含合成夹具 |
| `backend` | Java财务业务API、SQL、OCR适配、匹配引擎、PDF归档及JUnit测试 |
| `docs` | 接口与按序代码清单、通用验证说明 |

## 本地运行完整站点

需要 Node.js 22.13+（建议24 LTS）。首次克隆后在项目根目录执行：

```sh
npm run setup
npm run auth:configure
npm run build
npm run db:local
npm run dev
```

管理员配置脚本在终端隐藏输入本地初始密码，仅将加盐摘要写入忽略的 `frontend/.sites-runtime/.dev.vars`。首次登录账号为 `admin`、姓名赵会计；密码由本地初始化时自行设置。已有数据库中的账号不会被配置脚本重置。

打开终端显示的 `http://127.0.0.1:5175`。`npm run dev` 运行实际Worker、D1和构建后的Vue页面；修改前端后重新 `npm run build`。`npm run db:local` 只操作本地D1，不连接线上数据库。

## 账号和权限

- 超级管理员可以创建及删除普通用户；普通用户没有用户管理权限。
- 删除前显示目标姓名和账号的确认框；服务端禁止删除超级管理员，并在事务中撤销被删除账号的全部会话。
- 退出登录需二次确认；取消或Escape不会注销。
- 密码使用独立随机盐的PBKDF2-SHA256摘要；登录令牌采用Secure、HttpOnly、SameSite Cookie，数据库只保存令牌摘要。
- 权限逐次由服务端验证，不能通过更改浏览器角色或直接调用接口提升权限。

仓库不包含任何线上密码、密钥、账号数据库或用户上传原件。测试账号仅用于本地隔离测试。

## 数据和业务模块

账号存储在D1，支持在不同浏览器登录。凭证、单据、规则和匹配关系仍保存在当前浏览器的本地存储中，原件及生成的PDF存于IndexedDB；这些财务数据不会因登录而自动跨设备同步。

支持JSON/CSV、PDF、图片及ZIP批量导入，文字型PDF字段提取、凭证续页合并和回单分拆；扫描影像需要补录或接入OCR。规则按配置优先级执行，未关联数据进入“请复核”；只有实际关联的数据展示在电子档案。支持最新导入优先、分页及批量删除、原件按真实版式翻页、单张放大、档案期间和实际凭证范围选择。原件、已有档案哈希及技术存储键在品牌更名时保持兼容。

## 独立云服务器部署

独立 Linux 部署使用 Node.js 24、SQLite 和 Nginx，保留当前网站的登录权限及全部浏览器财务功能。运行 `npm run build`、`npm run test:server`、`npm run package:server` 生成白名单安装包；安装、HTTPS、开机自启、备份和更新方法见 [汇通云服务器部署说明](deploy/README.md)。账号数据库保存在服务器的持久目录，财务原件及业务记录仍保存在访问者的浏览器中。更换网址不会自动迁移旧网址下的浏览器数据或已有 Sites 账号。

## Java业务后端

详见 [backend/README.md](backend/README.md) 和 [按序代码清单](docs/按序代码清单.md)。需要JDK17、Maven3.9、MySQL8、Redis7。复制 `backend/.env.example` 为未跟踪的本地配置并填入自己的值，按说明初始化与启动。

Java后端包含ERP导入、金额与名称清洗、策略及责任链匹配、Redis分布式锁、人工关联、PDFBox原件合并、哈希校验和关系检索。OCR默认关闭，配置PaddleOCR网关后可用；其他云OCR保留接口。

当前在线工作区没有自动把浏览器财务数据迁移到Java后端；Java业务API也尚未接入Worker账号认证和租户隔离。正式部署Java服务前需完成对应接入、授权及实际ERP/OCR联调。

## 构建和验证

```sh
npm test
npm run build
```

前端当前349项单元测试通过；登录权限38项、退出确认/删除用户/品牌29项真实Worker/D1浏览器检查通过，覆盖手机360/390px和桌面布局。浏览器测试从环境变量读取本地管理员口令，拒绝向生产地址创建或删除测试用户。Java后端保留JUnit测试及运行说明。

`frontend/dist`、依赖、PDF.js生成资源、截图、运行数据库和密钥均不提交，可由安装与构建步骤重建。托管发布产物包含Worker、Vue静态资源和 `dist/.openai/drizzle` 下的迁移；生产 `ADMIN_PASSWORD_HASH` 通过托管平台secret设置，不能写进源码。`.openai/hosting.json`保留当前站点标识，新建独立站点时须使用平台实际返回的新标识。

匹配率、OCR准确率与匹配准确率需要真实标注数据评估；规则置信度、哈希和应用只读状态不等同于实测准确率或法定存证认证。
