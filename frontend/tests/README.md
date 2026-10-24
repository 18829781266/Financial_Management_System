# 回归测试

## 前端业务单元测试

```sh
npm ci
npm test
```

单元测试涵盖金额/名称清洗、多文件数据导入、PDF影像补录、整批校验、文件持久化、规则引擎、歧义与争用、手工匹配、异常恢复、批量删除关联完整性、归档保护及文件哈希的响应式持久化。

## 浏览器完整回归

先启动前端开发或生产预览服务。用独立浏览器上下文运行，测试数据保存在测试上下文，不改动用户自己的浏览器数据。

```sh
python -m pip install -r tests/e2e/requirements.txt
python -m playwright install chromium
# 默认 localhost:5173；如测试生产构建则改 BASE_URL。
python tests/e2e/all_modules.py
python tests/e2e/archive_workflow.py
```

环境变量 `BASE_URL` 可指向预览服务；`BROWSER_EXECUTABLE` 可选择本机 Chromium 路径。脚本不会绕过在线私有站点的登录验证，推荐对同一构建的本地预览执行。

- `all_modules.py`：46 项浏览器检查，覆盖七个模块、导入/删除、分页、原件持久化、PDF下载及手机布局。
- `archive_workflow.py`：20 项检查，覆盖手工匹配、解除、印章补核、真实原件PDF合并内容顺序、刷新后哈希不变、只读删除保护、CSV导出和重置。

测试产物保存在 `tests/e2e/artifacts/`，不提交到仓库。PDF/JSON/CSV夹具为合成示例，不包含业务数据。

真实 ERP、OCR API、MySQL/Redis 并发不是当前前端本地模式能执行的联调项；对应Java后端独立测试与配置见配套工程。

## 空金额与真实文件验证边界

新增money_validation.py的20项浏览器回归：区分未填写、格式错误和非正数；支持人民币前后缀、千分位和全角数字；错误金额不参与合计，错误行跨页定位；校验原始字符串，避免1e3/1.230被Number()放行。

这些测试使用合成夹具。V1.2 当时未能读取桌面文件；V1.3 已使用用户随后上传的实际ZIP验证。实际检查与合成测试分开记录，见《真实ZIP验证.md》。

## V1.3 文字PDF与ZIP

新增`pdf-voucher.test.ts`、`pdf-documents.test.ts`、`pdf-store.test.ts`、`import-files.test.ts`，覆盖续页累计、原借贷与红字、同页回单分拆、编号字符串、PDF默认复核、混合批次原子性、GBK压缩包路径及解压限制。测试均使用合成fixture。

三套浏览器脚本合计86项通过；实际ZIP的28项检查位于任务工作目录，不复制业务PDF及账户数据进仓库。V1.3共149项单元测试通过。

## V1.4 排序与阅读

`record-order.test.ts`新增16项，覆盖同毫秒批次、跨期间导入、时钟回拨、旧数据兼容、失败批次、删除后序号、编辑保序和刷新后继续递增。全套165项通过。生产构建上原86项浏览器回归再次通过；额外10项浏览器检查验证数据采集、异常、档案/全站检索与刷新后的倒序。三种宽度七模块及翻页/全屏共45项视觉检查通过（包含手机固定列遮挡修复的定向检查）。

## V1.5 付款人匹配与同步

全套236项单元测试通过。包含独立匹配引擎39项、单据提取16项及完整数据流26项，覆盖字段补录后的候选版本失效、规则实际执行、0.01元尾差、同类多单据汇总、候选争用、独立复核状态与工作稿引用同步。

`matching_workflow.py`提供18项可复现浏览器检查（在`tests/e2e/`运行），与旧86项合计104项。实际压缩包单独在隔离浏览器验证，不作为仓库夹具；范围和边界见《付款人匹配验证.md》。

## V1.6 原始单据预览

```sh
BASE_URL=http://localhost:5173 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/original_preview.py
```

V1.6全套247项单元测试通过。`original-preview.test.ts`的11项检查原件页序、文件复用、错误处理及资源释放。`original_preview.py`生成合成PDF/PNG到忽略的artifacts目录，通过真实上传及隔离存储检查22项：多页/单页、横竖/旋转页的等比原画面、颜色印章、字节不变、目录页数、跳页、缩放全屏、手机、缺原件与快速切换资源释放。原有`archive_workflow.py`20项再次通过，确认预览改变不影响合并内容顺序、下载哈希和归档锁定。

## V1.7 三态与档案边界

`match_status_workflow.py`覆盖导入待匹配、按钮触发、成功/未命中、期间隔离、刷新、人工复核保持复核、手工绑定入档、解绑/删除移除及档案检索边界。`matching_workflow.py`按新按钮流程验证规则配置真实执行。原件预览fixture已改为真实matched关系，不能依靠孤儿分组来预览。新增8项单元流程测试覆盖三态与旧存储跨期间恢复。

## V1.8 企业名称关联

`name-association.test.ts`有22项，覆盖付款/收款两侧、单位与往来主体、跨期间、多个主体歧义、同名新批次、规则快照、删除解绑、旧版本规则迁移及原金额关系保持。`name_association.py`有22项可复现浏览器检查，包含名称配置真实执行、企业原件、关联穿透、解除和手机布局。

金额附件专用回归（`pdf-store.test.ts`、`match_status_workflow.py`）明确停用名称用途，只验证财务分配规则；企业名称用途由新增套件单独验证。这样红字/多客商仍不能产生伪造的金额附件关系，同时能够按明确单位名称组织原件。

```sh
BASE_URL=http://localhost:5173 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/name_association.py
```

既有162项浏览器回归和新增22项均通过，实际压缩包另验证22项。实际原件不作为仓库内测试夹具。

## V1.9 原始单据独立关联同步

`name-association.test.ts`新增8项（合计30项），验证无凭证的5份名称关联、2份未命中、单例与跨期间、字段类型配置、交易主体歧义、非传递合并、新批次和删除失效。全套285项通过。

`document_association_sync.py`包含22项：保留其他期间演示凭证，仅针对7份合成原件执行；检查指定5份的实际行状态、两份未关联排除、档案5份原始PDF、统计一致、刷新、重复运行、规则启停和手机布局。已在生产构建预览验证。旧名称流程22项、状态闭环34项和全模块46项回归通过。

```sh
BASE_URL=http://localhost:4174 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/document_association_sync.py
```

## V2.0 清空全部数据

`reset-data.test.ts`7项检查首次空白、删除所有记录和孤儿文件、刷新保持、重新导入、文件失败回滚、持久化失败和并发保护；全套292项通过。`reset_data.py`16项检查空工作空间、取消保留、完整清空、文件仓库0、各模块0、刷新和清空后批量导入。`archive_workflow.py`重置段改为清空语义，22项通过；单据关联22项回归通过。旧模块测试通过`helpers.install_demo_fixture`显式注入隔离测试状态，空状态不会被测试夹具覆盖，生产无演示初始记录。

```sh
BASE_URL=http://localhost:4174 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/reset_data.py
```

## V2.1 单页原件放大

`original_page_zoom.py`使用生成的3页PDF和PNG，在生产构建预览通过19项检查，验证每页放大入口、指定源页、保持翻页位置、比例、缩放/100%/适合窗口、拖动、弹窗键盘隔离、独立全屏、旋转页、图片、资源复用、手机及Escape关闭。原有`original_preview.py`22项回归通过。

```sh
BASE_URL=http://localhost:4174 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/original_page_zoom.py
```

## V2.2 视觉与图标

`visual_refresh.py`23项检查桌面/手机七模块、空状态、双色图标和渐变唯一ID、表格金额字号、导入入口、导航及减少动态偏好。通过隔离测试夹具检查有数据列表；生产仍从空白状态开始。全模块46项、原件单页放大19项和清空16项回归通过。

```sh
BASE_URL=http://localhost:4174 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/visual_refresh.py
```

## V2.3 实际档案范围选择

`archive_range.py`23项检查月份日历、只允许已有凭证的月份、跨年、自然排序、原文件名、起止约束、中间已锁定区间、动态默认、月份切换/清空、实际生成PDF、取消及手机。`select_archive_range`通过日历和真实选项操作，`archive_endpoint_dropdown`按ARIA控件关联定位对应下拉，避开其他下拉的退场动画。归档22项、全模块46项回归通过。

```sh
BASE_URL=http://localhost:4174 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/archive_range.py
```
