# 汇通云 · 电子凭证自动匹配与归档后端

Java 17、Spring Boot 3.3、MyBatis-Plus、MySQL 8、Redis 7、PDFBox 3。下面按需求中的七个部分列出实现，所有业务逻辑均在 Service 层，Controller 只处理 HTTP 与参数校验。

## 1. 数据库核心表 SQL

[database/schema.sql](database/schema.sql) 包含 `voucher`、`voucher_entry`、`source_document`、`match_rule`、`match_relation`、`archive_book`、`sys_log` 七张表，以及 R01–R07 初始规则。金额使用 `DECIMAL(19,2)`，结构化 OCR 和规则条件使用 JSON；ERP 主键、文件指纹、凭证与单据关系具有唯一约束。凭证保留单独的数字序号以正确处理 `记-9` 与 `记-10` 的排序。

`match_relation.relation_id` 为整组关联 UUID；每行对应一个凭证与一个单据的金额分配，支持一对多和多对一。`allocated_amount` 保存分摊金额，档案生成时逐凭证及逐单据复核汇总。当前不支持多对多、负数红字与跨期间分摊。

## 2. 核心实体与 DTO

- [model/](src/main/java/com/langchao/archive/model/)：七个持久化实体。
- [api/ApiModels.java](src/main/java/com/langchao/archive/api/ApiModels.java)：嵌套校验的导入、分录、匹配、缺失、规则和归档请求。
- [mapper/](src/main/java/com/langchao/archive/mapper/)：MyBatis-Plus `BaseMapper`。

凭证导入要求借贷平衡，借方合计与凭证金额相同，日期与期间相符。`sourceSystem + externalId` 已存在时返回 409，整批原子回滚，客户端不能覆盖已匹配或锁定的数据。`imageUrl` 是内部 `/files/<UUID>.<ext>` 标识，须先经上传接口获得。

## 3. 匹配规则引擎

[engine/MatchingEngine.java](src/main/java/com/langchao/archive/engine/MatchingEngine.java) 使用策略注册表与责任链，按规则优先级运行。编号依次为发票号、合同号、银行流水号、审批单号、金额客商日期精确、金额客商日期模糊、金额汇总。空标识不会参与精确匹配，精确编号仍需通过金额检查。

`NameSimilarity` 实现 Levenshtein 相似度。`MoneyTolerance` 使用 `BigDecimal`，判断：

```text
差额 = abs(实际金额 - 预期金额)
上限 = max(绝对容差, abs(预期金额) × 相对容差)
通过 = 差额 <= 上限
```

默认绝对容差 0.05 元、相对容差 0、模糊名称阈值 0.85、日期窗口 7 天。复合评分按金额 45%、名称 35%、日期 20% 计算。分数是可解释的规则启发值，不是经过校准的统计概率；编号/汇总的固定评分也不代表实测准确率。

R07 使用带剪枝的子集搜索，并检查解的唯一性。单次候选超过 20 或搜索超过 100,000 节点时留给人工。多个可行组合、相互争用同一凭证或单据、字段缺失均保留在异常池，不任意取第一条。

[service/MatchService.java](src/main/java/com/langchao/archive/service/MatchService.java) 在事务中认领资源、写关联、更新状态；数据库提交后移除 Redis 待匹配集合。Redis 是可重建缓存，不能取代数据库状态。每次匹配都会根据数据库重建池。

[service/PeriodLock.java](src/main/java/com/langchao/archive/service/PeriodLock.java) 以会计期间为粒度使用 `SET NX`、30 秒租约、10 秒续租、随机 token 与 Lua 安全解锁。匹配和归档还按固定主键顺序 `SELECT ... FOR UPDATE`，即使 Redis 租约失效也由行锁和唯一键阻止重复认领。规则缓存 5 分钟，更新后失效，并使用 version 检查并发修改。

## 4. OCR 数据清洗

[util/OcrDataCleaner.java](src/main/java/com/langchao/archive/util/OcrDataCleaner.java) 提供金额、真实日历日期、客商名称清洗。金额去人民币符号、严格校验千分位及最多两位小数；拒绝把多个金额拼接成一个数字。支持 `20261020`、`2026/10/20`、`2026年10月20日` 等日期，输出 `LocalDate`（JSON 为 `YYYY-MM-DD`）。金额最大 16 位整数。

名称只移除末尾“有限公司、集团、股份”等法律形式，不随意删除主体中间的文字。[util/SupplierNormalizer.java](src/main/java/com/langchao/archive/util/SupplierNormalizer.java) 再查 Redis 标准客商映射：

```sh
redis-cli HSET ocr:supplier:aliases 阿里云计算 阿里云
```

因此“阿里云计算有限公司”先变成“阿里云计算”，再由已审核别名映射到“阿里云”。系统不会凭名称包含关系擅自认定不同主体相同。

[ocr/OcrGateway.java](src/main/java/com/langchao/archive/ocr/OcrGateway.java) 是提供商适配接口。当前 `ConfiguredOcrGateway` 支持自建 PaddleOCR HTTP 网关；默认 `OCR_PROVIDER=disabled`，调用 OCR 明确返回 503。阿里云、腾讯云需要按其鉴权与字段结构实现该接口。配置 `OCR_PROVIDER=paddle-http`、`OCR_ENDPOINT`、`OCR_API_KEY` 后，网关接收 multipart `file`，返回：

```json
{"docType":"INVOICE","amount":"¥1,000.00","date":"2026/10/20","supplierName":"示例有限公司","invoiceNo":"INV001","contractNo":null,"bankFlowNo":null,"approvalNo":null,"sealPresent":true,"confidence":0.99,"rawFields":{}}
```

OCR 异常或入库失败会清理新文件。上传仅接受 PDF、PNG、JPEG（检查文件头），限制 20MB。供应商服务访问异常返回 502，不生成虚假的识别数据。

## 5. 档案册与 PDF 合并

[service/ArchiveService.java](src/main/java/com/langchao/archive/service/ArchiveService.java) 根据期间、相同凭证字别、数字序号范围生成档案。逐项核验匹配状态、预期附件数、凭证及单据分摊金额、发票章标记、影像存在性，然后按“凭证→发票→回单→合同→审批单→其他”顺序合并。PDF 保留原页，图片居中缩放到 A4，单册最多 5,000 页。

文件先写临时路径，再原子发布，保存 SHA-256、档案只读状态和日志；数据库事务失败会清理新档案。下载时重新计算哈希，检测到改动返回 409。原始单据有入库指纹时，生成前也会校验该指纹。

[storage/FileStorage.java](src/main/java/com/langchao/archive/storage/FileStorage.java) 将文件写入配置目录，业务只接收 UUID 内部标识，拒绝外部 URL、目录穿越与符号链接。

## 6. 核心 REST Controller

[api/ArchiveController.java](src/main/java/com/langchao/archive/api/ArchiveController.java) 提供：

| 方法与路径 | 请求/用途 |
|---|---|
| `POST /api/v1/vouchers/import` | JSON 导入 ERP 凭证 |
| `POST /api/v1/documents/ocr` | multipart `file` + `period` |
| `POST /api/v1/match/auto` | `{ "period":"2026-10" }` |
| `GET /api/v1/match/exceptions` | `period,page,size`；孤儿单据/无单据凭证 |
| `POST /api/v1/match/manual` | `{ "voucherId":1,"documentIds":[2,3],"reason":"已核对原件" }` |
| `POST /api/v1/archive/generate` | `{ "period":"2026-10","startVoucherNo":"记-001","endVoucherNo":"记-010" }` |
| `GET /api/v1/archive/search` | `period,voucherNo,invoiceNo,contractNo,supplierName,keyword,minAmount,maxAmount,page,size` |
| `GET /api/v1/archive/{id}/pdf` | 完整性校验后返回 PDF |
| `POST /api/v1/files` | 上传凭证影像，返回内部 `imageUrl` |
| `GET /api/v1/files/{fileName}` | 预览文件；档案 PDF 同样强制校验哈希 |
| `GET /api/v1/vouchers` / `documents` | `period,keyword,status,page,size` |
| `GET /api/v1/match/recommendations?voucherId=1` | 按金额和日期推荐待匹配单据 |
| `POST /api/v1/vouchers/{id}/missing` | `{ "reason":"原件尚未寄达" }` 并记日志 |
| `GET /api/v1/relations/{relationId}/chain` | 遍历上下游完整凭证、分录、单据、关系 |
| `GET /api/v1/rules` / `PUT /api/v1/rules/{ruleId}` | 查询/更改规则阈值、条件、启用状态、version |

成功：`{"code":0,"message":"success","data":...}`。错误通过 [GlobalExceptionHandler](src/main/java/com/langchao/archive/api/GlobalExceptionHandler.java) 统一返回 HTTP 状态与 `{code,statusCode,message}`，不暴露内部异常。分页 size 最大 100。

检索所有维度之间按 AND 组合；凭证号、发票号、合同号、客商穿透关联单据。关键词支持文本及编号检索，数据库有 ngram 全文索引。手工匹配需整组金额一致（允许 0.05 尾差），不能重用已被占用的单据。

ERP 请求例：

```json
{"sourceSystem":"KINGDEE","batchId":"2026-10-001","vouchers":[{"externalId":"ERP-0001","voucherNo":"记-001","period":"2026-10","summary":"支付云服务费","amount":1000.00,"voucherDate":"2026-10-20","supplierName":"阿里云","invoiceNo":"INV001","customFields":{},"imageUrl":"/files/先上传后替换此UUID.pdf","expectedAttachmentCount":1,"entries":[{"accountCode":"6602","accountName":"管理费用","direction":"DEBIT","amount":1000.00},{"accountCode":"1002","accountName":"银行存款","direction":"CREDIT","amount":1000.00}]}]}
```

## 7. 单元测试与验收

- [engine/MatchingEngineTest.java](src/test/java/com/langchao/archive/engine/MatchingEngineTest.java)：0.01 尾差、有限公司后缀、单凭证多发票、多凭证单单据、歧义、日期、期间、重复资源、禁用规则、可配置搜索预算等。
- [util/OcrDataCleanerTest.java](src/test/java/com/langchao/archive/util/OcrDataCleanerTest.java)：币种符号、千分位、括号负数、真实日期、非法输入、Redis 别名。
- [service/ArchiveServiceTest.java](src/test/java/com/langchao/archive/service/ArchiveServiceTest.java)：PDF/图片合并、页面顺序、内容哈希。
- [storage/FileStorageTest.java](src/test/java/com/langchao/archive/storage/FileStorageTest.java)：文件头、路径穿越与外部路径拒绝。

本次使用 Java 17 编译，35 个测试通过（0 failures / 0 errors）。单元测试无需运行 MySQL、Redis 或 OCR。数据库、Redis 并发与真实 OCR 的联调须在部署环境补验，尚未用企业标注样本测得生产准确率。

业务验收应使用独立人工标注集：综合匹配率 = 自动完成凭证数 / 可匹配凭证数（目标 >90%）；OCR准确率 = 正确业务字段数 / 抽检字段总数（目标 >98%）；匹配准确率 = 正确自动关联组数 / 自动关联总组数（目标 >95%）。建议按单据类型、低清图片、同金额客商、月末跨日、多单汇总分层抽样，并单列歧义转人工比例。不能用规则置信分代替实际准确率。

## 运行

要求 JDK 17+、Maven 3.9+、MySQL 8.0、Redis 7。已有数据库按管理员权限执行 SQL 并创建最小权限的应用账号；本地也可使用 compose：

```sh
cd backend
cp .env.example .env
# 编辑.env中的两个密码；读取变量前确认.env为你刚创建的可信文件
set -a
. ./.env
set +a
docker compose up -d
mvn test
mvn spring-boot:run
```

后端默认 `http://localhost:8080`。`docker compose` 只启动数据库和 Redis；Spring Boot 在宿主机运行。SQL 初始化脚本只在首次创建 MySQL 数据卷时运行，已有库须通过迁移工具升级。MySQL/Redis 仅监听本机。Dockerfile 另提供应用镜像构建，容器化联动时设置 `MYSQL_URL` 主机为 mysql、`REDIS_HOST=redis` 并挂载持久化 data 目录。

前端开发代理将 `/api` 转发到 8080。运行 `mvn package` 后可用 `java -jar target/electronic-archive-1.0.0.jar`，所有配置读取环境变量，实际密码和 OCR key 不入库、不提交。

## 部署边界

当前工程没有内置统一身份认证；本地默认操作者 `local-operator`，接入组织认证后读取 `Principal`。正式部署需接入认证/授权、组织隔离、TLS、访问审计、备份、文件保留策略与只读对象存储，并执行 MySQL/Redis 集成与压力测试。当前关系通过期间锁和数据库行锁保证应用写入一致性；直接写库必须遵守同一事务协议。

`sealPresent` 是 OCR/复核字段，不能验证章的真伪；SHA-256 与应用只读状态不能替代可信时间戳、电子签章、WORM或法定合规认证。电子发票免盖章等政策例外需要按企业档案制度扩展校验策略。本地文件适配器可替换为企业对象存储。
