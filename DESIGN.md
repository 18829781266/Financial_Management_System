---
name: 汇通云
description: 深蓝导航、冷浅蓝画布与白色面板组成的财税工作台
colors:
  primary: "#2866e8"
  primary-hover: "#1d54ca"
  primary-soft: "#edf3ff"
  sidebar: "#172e48"
  canvas: "#f4f6fb"
  surface: "#ffffff"
  ink: "#233d5c"
  secondary-text: "#4f6681"
  muted-text: "#5f718a"
  line: "#dfe7f2"
  pending-surface: "#f2f5f9"
  success: "#19775c"
  warning: "oklch(51% .11 65)"
  danger: "oklch(50% .15 25)"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "27px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "0.2px"
  title:
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "0px"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    lineHeight: 1.7
  label:
    fontSize: "12px"
    fontWeight: 500
  metric:
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.6px"
rounded:
  badge: "5px"
  field: "7px"
  control: "8px"
  navigation: "12px"
  panel: "14px"
spacing:
  compact: "8px"
  control: "12px"
  mobile: "16px"
  metric-gap: "18px"
  panel: "22px"
  section: "24px"
  workspace: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    typography:
      fontSize: "13px"
      fontWeight: 500
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.control}"
    padding: "0 15px"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 12px"
  navigation-item:
    textColor: "#bfcee1"
    rounded: "{rounded.navigation}"
    padding: "0 12px"
    height: "54px"
  chip-review:
    backgroundColor: "oklch(97% .035 80)"
    textColor: "oklch(45% .095 65)"
    rounded: "{rounded.badge}"
    padding: "0 8px"
  metric-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "18px 21px"
---

# Design System: 汇通云

## Overview

**Creative North Star: "清晰的蓝色工作台"**

这个名称概括当前实现的视觉特征。财税人员在明亮的办公室内连续核对多个客户的凭证、原始单据与电子档案；深蓝导航提供稳定的位置感，冷浅蓝背景承托白色业务面板，蓝色主操作帮助定位下一步。重点仍是准确识别关系、比较金额、及时发现疑问，同时降低长时间操作的视觉疲劳。

当前视觉来源是最后加载的 frontend/src/workspace-theme.css 与 FeatureIcon.vue。此文档将用户本次要求的浅蓝视觉替换合入既有规范，记录已经实现的值；保留原规范中的业务边界、可访问性和原始文件保护要求。

**Key Characteristics:**

- 深蓝导航、冷浅蓝画布与白色内容表面。
- 蓝色操作与轻边框组织信息层级。
- 按功能着色的 SVG 图标辅助识别，正文保持清楚、克制。
- 金额与计数使用等宽数字；状态同时提供文字和必要的图标。

## Colors

前置 token 的值来自工作区主题；颜色以十六进制为主，保留已有状态色的 OKLCH 表达。下列名称描述使用角色，具体值以前置 token 为准。

### Primary

- **操作蓝**（primary / --ws-accent）：主按钮、链接、凭证编号、选中的缩略图与 Element Plus 主操作。
- **深操作蓝**（primary-hover / --ws-accent-hover）：主按钮悬停、键盘焦点和链接的增强状态。
- **浅蓝提示面**（primary-soft / --ws-accent-soft）：轻提示、工具按钮悬停、选中项目与输入焦点光环。

### Neutral

- **深海军蓝导航**（sidebar / --ws-sidebar）：侧栏底色；实际侧栏叠加深蓝渐变，保持浅色导航文字。
- **冷浅蓝画布**（canvas / --ws-canvas）：页面背景、搜索底色与批量操作区。
- **白色内容面**（surface / --ws-surface）：列表、统计卡、表单与业务弹窗。
- **蓝灰正文**（ink / --ws-ink）：标题、正文重点与金额。
- **次要蓝灰**（secondary-text / --ws-secondary）：表头、字段与说明。
- **辅助蓝灰**（muted-text / --ws-muted）：时间、辅助说明与元信息。
- **冷色边界**（line / --ws-line）：细边框、输入描边和分隔线。
- **待处理浅灰蓝**（pending-surface / --ws-warm）：待处理标签背景；变量名沿用既有接口。

### Named Rules

**The Semantic Status Rule.** 成功使用绿色状态色，待处理使用浅灰蓝表面，需要复核使用琥珀色，危险删除和错误保留红色。绿色只承担成功或验证等语义角色，不再构成页面皮肤。不能仅靠颜色区分业务状态，必须有文字和必要的图标。

Element Plus 的主色阶同步映射到操作蓝；其成功、警告和危险状态继续分别使用语义色。

## Typography

**Display Font:** 与正文共用系统无衬线字体，不加载额外展示字体。

**Body Font:** 前置 body.fontFamily 定义的系统字体，含中文系统回退。

**Label/Mono Font:** 金额、页码和计数采用 font-variant-numeric: tabular-nums，沿用正文家族。

**Character:** 文字紧凑而清楚，标题用字重和尺寸建立层级，金额与状态说明便于逐行核对。

### Hierarchy

- **Headline**：页面标题使用前置 headline token；窄屏（≤760px）为 23px。
- **Title**：面板标题使用前置 title token；规则卡标题为 16px。
- **Body**：业务表格与一般说明使用前置 body token；金额为 14px、600 字重。
- **Label**：表头与统计标签为 12px；状态标签为 11px、500 字重、24px 行高。
- **Metric**：统计数值使用前置 metric token；≤760px 为 27px，≤380px 为 26px。

**The Numeric Alignment Rule.** 金额、页码和计数保留等宽数字；窄屏通过折叠结构和滚动容器适配，不缩小关键数据以勉强塞入。

## Layout

桌面采用侧栏与主内容分栏，侧栏宽 240px，顶部工具栏高 66px。主内容最大宽 1800px，默认内边距为上方 28px、左右 32px；≥1800px 时左右为 42px。四列统计卡间距为 18px，主面板维持可读的业务密度。

- ≤1200px：侧栏 196px，主内容左右留白 24px；档案区左列为 230px。
- 761–1120px：侧栏为 78px 图标栏，原有导航文字与次要内容按结构隐藏。
- ≤1000px：统计卡改为两列，最小高度 122px。
- ≤760px：侧栏 60px，顶部工具栏 58px；主内容左右 16px，统计卡间距 10px；档案工作区改为单列，列表最高 250px，标签栏允许横向滚动。
- ≤380px：主内容左右留白 12px，统计卡内部左右 10px。

保留现有菜单、页面结构与业务操作路径；视觉适配不新增菜单或改写流程。

## Elevation & Depth

面板和统计卡以白色表面、浅边框与背景色差表达层级，默认无阴影。主操作、选中标签、规则卡悬停与目录浮层使用少量阴影；彩色功能图标通过 SVG 内部的浅色渐变、微小投影和高光表现体积。

### Shadow Vocabulary

- **主按钮轻阴影**（0 4px 9px #2866e81a）：主按钮静止状态；悬停或聚焦时去除。
- **选中标签阴影**（0 2px 6px #25457409）：标签栏中的白色选中项。
- **规则卡悬停阴影**（0 3px 12px oklch(35% 0.03 255 / .05)）：鼠标悬停规则卡。
- **目录浮层阴影**（0 8px 24px oklch(30% .025 255 / .08)）：档案阅读器目录浮层。

## Shapes

形状以轻柔圆角和细边框为主：标签使用前置 badge 圆角，输入和搜索使用 field，按钮使用 control，导航与业务弹窗使用 navigation，面板和统计卡使用 panel。统计卡边框为 1px；导航当前项另有细竖条标识。图标采用 48×48 的 SVG 坐标系和圆角底座，实际显示尺寸随位置调整。

## Components

### Buttons

按钮清楚、克制，主要操作使用操作蓝与白色文字；次要按钮为白面、冷色描边和次要蓝灰文字。默认最小高度 39px，手机为 40px。按钮与导航通过 180ms 的背景色、边框、文字和阴影过渡响应状态；主按钮悬停使用深操作蓝，按下向下移动 1px。禁用按钮维持既有不可操作行为与半透明表现。

键盘焦点保持明显：全局可聚焦控件为 2px 轮廓、3px 外偏移；弹窗沿用原有更强的焦点规则。尊重 prefers-reduced-motion，工作区关闭过渡，图标关闭过渡和悬停位移。不使用常驻装饰动画或宽高动画。

### Chips

状态标签使用小圆角、淡色背景和描边。已匹配、待处理、需复核与缺失分别表达成功、中性、警告与错误；每个标签保留文字，必要时辅以图标。名称归集、附件关联、复核和正式档案册保持语义区别。

### Cards / Containers

统计卡、列表面板与规则卡使用白色表面、冷色边界和面板圆角。统计卡默认最小高度 136px、内边距 18px 21px；面板标题为 19px 22px。卡片静止时无阴影；规则卡悬停只增加轻阴影，不产生整体位移。

工作台、电子档案与异常处理顶部四张统计卡仅在精细指针悬停时以 200ms 缓出上移 3px，配合轻阴影和描边强调；功能图标上移 2px、放大至 1.05 倍，移开即恢复。待复核链接获得键盘焦点时，所属卡片提供相同的静态描边与阴影反馈。减少动态效果时取消卡片、图标位移和过渡，保留静态反馈；触屏不启用悬停运动，静态统计卡不添加点击语义。

### Workbench Metrics

工作台统计区使用独立 WorkbenchMetrics，按“独立图标 → 居中数字 → 标题”竖向排列，不显示说明小字、底部链接、分隔线及进度条。四卡沿用现有图标的蓝、青绿、淡紫和米杏色，以极浅纸面、淡色边界区分指标，数值统一深蓝。桌面卡高约174px、图标42px、数值42px；手机两列，卡高约160px、图标34px、数值34px。数字本体水平居中，单位靠右并沿基线对齐，千位计数适度缩小且不拆行。总数、已关联、待处理三卡为真实按钮，沿用原列表入口，悬停或聚焦时显示小箭头；覆盖率保持静态指标。悬停只增加轻阴影、色面强调和既有3px抬升，无常驻装饰动画。

### Inputs / Fields

输入与搜索使用白色表面、冷色细描边和小圆角。搜索框聚焦时改变描边；顶部搜索与用户搜索增加浅蓝外环。Element Plus 输入与选择框聚焦时使用操作蓝的内描边；错误和禁用行为保持既有语义。

### Navigation

侧栏叠加深蓝渐变，默认文字为浅蓝灰。导航项高 54px；悬停使用淡白覆盖，当前项使用蓝色渐变、白色文字和左侧浅蓝竖条。手机导航项高 44px。导航与桌面统计使用功能 SVG 图标，折叠后保留功能识别和原有可访问名称。

### Login

2026-11-12 用户参考图确定登录页使用深蓝展示区与浅色表单双栏。桌面容器宽度最多 1188px、最小高度 715px、圆角 26px，左右宽度为 52% / 48%。展示区使用白色品牌与标题、叠放凭证及浮动说明，表单使用浅蓝钥匙图标、浅色输入、蓝色主按钮和描边帮助框。手机改为上下排列，保留完整输入、提示与键盘操作；身份验证、记住账号和密码显隐行为保持原样。

### Archive Navigation

电子档案的四个视图按钮采用独立白色描边和浅蓝图标底座，桌面高度至少 54px，按钮之间间隔 10px。当前视图以浅蓝底、蓝色描边及文字突出，册数和关联组数使用真实数量徽标；不使用强饱和大面积填色。悬停仅改变背景、边框及图标 1px 微动，键盘焦点使用清晰的操作蓝轮廓。左右键、Home、End 只移动按钮焦点，Enter 或空格沿用原视图切换。手机改为完整的两行两列布局，保留四个入口、图标与数量，按钮高至少 68px；减少动态效果时取消图标位移。

### Archive Directory

同期间且标准化公司名相同的有效关联分组在目录中合为一个展示入口，凭证与单据按 ID 去重，名称关联和凭证关联保留各自的状态与匹配依据。不同期间、不同公司以及付款人待确认的分组保持分开。已生成档案册的凭证显示“查看档案册”并定位对应册，未生成的凭证保留生成入口；展示归集不修改底层关联或归档规则。

已关联资料在桌面使用独立的左侧归档目录和右侧详情列。目录占据完整一竖列，列表超过 420px 时内部滚动；右侧依次呈现凭证概览、已关联单据、分页及原件预览，单据与预览始终与右侧详情对齐，不跨到目录下方。即使只有一组归档，桌面仍保留左侧竖向目录。单据按原有每页 6 条完整展示，宽表格在右侧区域内部横向滚动；900px 及以下改为上下排列，保留全部内容和操作，不改变原件版式或业务逻辑。

生成档案册沿用现有弹窗，按所选期间和凭证范围列出尚待字段复核的具体附件，提供查看原件和复核入口；保存后保留生成范围并实时更新提示。零附件凭证提供复核入口，复用填写业务依据的“确认凭证无需外部附件”二次确认，完成后显示依据已记录。名称归集不跳过零附件确认，附件缺失不进入豁免流程；原有金额、分录、发票和原件校验继续执行。

### Feature Icons

FeatureIcon.vue 是自包含的彩色 SVG：总览和档案为蓝色，数据为青色，匹配和规则为紫色，异常为琥珀色，验证为青绿；日志使用蓝灰。每个功能具有主色、浅色、浅底与深色四个实际色值。底座渐变、纸张高光、微小投影和星点来自 SVG 本身；装饰性图标使用 aria-hidden，可操作元素的名称由周围文字或既有标签提供。

图标保持静止阅读，仅按钮或链接悬停时主体向上移动 1px；过渡为 180ms、cubic-bezier(.16,1,.3,1)，投影略微收缩。减少动态效果设置下取消这些过渡与位移。

## Do's and Don'ts

### Do:

- **Do** 使用冷浅蓝画布、深蓝导航、白色业务表面与操作蓝，新增局部样式引用既有工作区角色变量。
- **Do** 以文字和必要的图标同时表达业务状态，保留明显的键盘焦点及减少动态效果支持。
- **Do** 保留金额、页码和计数的等宽数字，并通过结构折叠和滚动适配窄屏。
- **Do** 保留现有菜单、页面、工作流程和原始文件查看能力。
- **Do** 让原始 PDF、图片、凭证纸张和导出内容保留自身呈现；仅阅读工具随工作区主题变色。

### Don't:

- **Don't** 将原有松绿导航或米白画布重新作为工作区皮肤。
- **Don't** 仅靠颜色区分业务状态，或通过缩小关键数据勉强适配窄屏。
- **Don't** 添加常驻装饰动画或宽高动画，或忽略减少动态效果偏好。
- **Don't** 通过视觉样式改变匹配、金额、权限、锁定或归档规则。
- **Don't** 混淆名称归集、附件关联、复核与正式档案册，或让工作区皮肤污染原始文件及导出内容。
