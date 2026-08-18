---
name: Public-WM / Boss Tool
description: CSC Alliance 内部工具，复刻 WM 个人订单页，虚空金匠（Orokin 金）为默认皮肤，另支持霓虹秩序(cyber)/碳素仪器(dark)/纸面阅读器(eyecare)/工程图纸(minimal)四套用户可切换主题
colors:
  bg-void:        "#07080f"
  bg-deep:        "#0d101e"
  card:           "rgba(10,16,34,0.84)"
  gold-primary:   "#d4a84a"
  gold-bright:    "#f0d878"
  gold-glow:      "rgba(212,168,74,0.55)"
  gold-border:    "rgba(185,142,52,0.38)"
  text-primary:   "#cce0f5"
  text-muted:     "#8aaccc"
  text-faint:     "rgba(180,200,220,0.35)"
  white:          "#f4faff"
  sell:           "#c44898"
  buy:            "#1e9068"
  warn:           "#e8924a"
  cyber-primary:  "#3c78ff"
  cyber-hot:      "#ff3c6e"
  cyber-purple:   "#9633ff"
  cyber-deep:     "#2846b4"
  dark-primary:   "#bec4ce"
  eyecare-primary: "#98703a"
  minimal-primary: "#98703a"
typography:
  display:
    fontFamily: Cako-Black
    fontSize: 1.8rem
    fontWeight: 700
    letterSpacing: 0.15em
  ui-label:
    fontFamily: xszt, PingFang SC, Microsoft YaHei, sans-serif
    fontSize: 0.82rem
    fontWeight: 600
  price-number:
    fontFamily: Teko-Bold-5
    fontSize: 1.4rem
    fontWeight: 700
  zh-body:
    fontFamily: xszt, PingFang SC, Microsoft YaHei, sans-serif
    fontSize: 0.9rem
  zh-display:
    fontFamily: 逐浪萌芽字, xszt, sans-serif
    fontSize: 1.2rem
rounded:
  sm: 4px
  md: 8px
  lg: 14px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 32px
motion:
  fast:    0.18s
  normal:  0.3s
  ease-out:    "cubic-bezier(0.16, 1, 0.3, 1)"
  ease-spring: "cubic-bezier(0.22, 0.68, 0, 1.2)"
---

## Overview

一个给 CSC Alliance 成员使用的内部 Warframe 交易工具，核心功能是复刻玩家个人订单页并增强可读性。它不是面向公众的展示页，而是**任务型工具**——用户来这里快速找到报价、比对数量、判断是否值得交易。

视觉情感参照是「Orokin 暗金工具台」——在虚空黑底上，金色精密仪器般的边框和数字，信息密度高，没有多余的装饰。与 Ws-Web 公站的竞速榜单氛围不同，Boss Tool 更偏「实用型 FUI」：减少炫技动画，增加信息密度，控件操作效率优先。

**五套用户可切换主题**（通过 `<html data-fui-theme="...">` 控制）：
1. `gold`（缺省，无 attribute 时回退）= **虚空金匠**（Orokin 金），暗金主色，旗舰华丽皮
2. `cyber` = **霓虹秩序**，电蓝/紫罗兰/霓虹红流动渐变
3. `dark` = **碳素仪器**，冷灰单色调、低装饰
4. `eyecare` = **纸面阅读器**，暖米白纸质、暖金棕强调
5. `minimal` = **工程图纸**，暖米纯色平铺、禁动画

主题通过 CSS 变量通道 `--g-primary / --g-mid / --g-deep / --g-hi` 实现全局换色，业务样式只引用通道变量，无需逐个覆盖。赛博主题额外引入 `--cyber-flow-grad`（全站唯一一条流动渐变）用于特定装饰元素。2026-07-18 起，组件级零件（输入框/幽灵按钮/浮起表面/语义文字等）一律消费「语义变量槽层」的 `--c-*` 槽位，见下文专章。

### 五主题设计定调（2026-07-18 拍板）

五主题 UI 全面优化时主控拍板的主题人格，后续所有组件施工照此办理：

- **gold = 虚空金匠**：旗舰华丽皮。环境动效（星空、halo、扫光、呼吸）全部保留，但金要回归唯一主角——历史组件里散落的紫/蓝装饰字面量收编为 `--c-special` / `--c-info` 两条功能色通道，金色字面量统一入 `--g-*` 通道；弱文字可读性设下限，不靠压透明度凑对比。
- **cyber = 霓虹秩序**：电蓝系（`60,120,255 / 150,60,255 / 40,70,180 / 255,60,110`）是唯一事实源，fui-core.css 头部那份旧青色系副本已被同步成同一组数值；流光渐变统一为 `--cyber-flow-grad` 一条；霓虹分职——蓝=主操作、品红=警示、紫=装饰。
- **dark = 碳素仪器**：灰阶拉开，卡片/面板明度从 8-22 提到 28-34 区间；装饰降级（暖雾、色偏 glitch 关掉）；语义色保留但降饱和，定位是仪表信号灯——这是明确的设计决策，不是没做完。
- **eyecare = 纸面阅读器**：输入框/浮层全面浅底化，语义文字档调深，装饰收口。
- **minimal = 工程图纸**：与 eyecare 同色系但纯色平铺，幽灵按钮保留可见描边，遮罩暖棕。平是风格，不是缺陷。

## Colors

**通用底色**（gold 默认值；cyber/dark 同族微调，eyecare/minimal 反转为暖米纸质）
- **bg-void** (`#07080f`)：页面底色（gold 档），近黑的深宇宙蓝；eyecare/minimal 反转为暖米白 `#f2e9d6`。
- **bg-deep** (`#0d101e`)：面板、卡片底，比 bg-void 稍亮；各主题在覆盖块里给同族值。
- **card** (`rgba(10,16,34,0.84)`)：半透明卡片，轻度透出底色形成玻璃感，但不到毛玻璃程度；eyecare/minimal 为米白卡片。

**语义色·标记色**（色条/边框/图标用，全主题保持不变；做文字用时走 `--c-*-text` 文字档，见「语义变量槽层」）
- **sell** (`#c44898`)：出售订单标记色，品红降饱和，不与金色主题的金色混淆。
- **buy** (`#1e9068`)：求购订单标记色，偏冷翡翠绿，与暗金底色协调。
- **warn** (`#e8924a`)：警告/提示色，琥珀橙。

**Orokin 金体系**（默认皮肤 `--g-primary: 212,168,74`）
- **gold-primary** (`#d4a84a`)：主金，边框、激活态、强调文字。
- **gold-bright** (`#f0d878`)：高光金，进度条顶端、标题渐变白区。
- **gold-border** (`rgba(185,142,52,0.38)`)：最常用边框，细线、半透明，大量卡片使用此边框。

**赛博主题 `cyber`**（`--g-primary: 60,120,255` 电蓝）：电蓝系四通道（`60,120,255 / 150,60,255 / 40,70,180 / 255,60,110`）是唯一事实源，fui-core.css 头部的同步副本必须保持同一组数值。用 `--cyber-flow-grad: linear-gradient(90deg, #3c78ff, #9633ff, #ffffff, #ff3c6e, #9633ff, #3c78ff)` 表达流动感，全站只此一条流光渐变；选择下拉框边框走这条渐变动画（`background-position` 无限循环），而非静态边框。旧文档里的青色系（`#05d9e8 / #ff2a6d / #7700ff / #2e7dff`）是 fui-core 残留副本，已废弃。

**暗黑 `dark`** (`--g-primary: 190,196,206`)：近中性冷灰，无彩度偏向；卡片/面板明度锚在 28-34 区间（碳素仪器灰阶），语义色降饱和作仪表信号灯。

**护眼 `eyecare`** (`--g-primary: 152,112,58`)：暖金棕强调 + 暖米白纸质底（`--c-bg: #f2e9d6`），降低蓝光刺激，适合长时间使用场景。

**极简 `minimal`** (`--g-primary: 152,112,58`，与 eyecare 同通道)：与护眼同色系的暖米纸质，但纯色平铺不用渐变，同时在 CSS 层将所有动画时长归零。

## 语义变量槽层（2026-07-18 新增）

五主题设计审计的结论：**变量层是干净的，穿帮全在组件层**——大量组件把颜色字面量（hex/rgba）直接写死在业务选择器里，gold 下看着正常，一切到 cyber/dark/eyecare/minimal 就露出金色或深蓝的底子。main.css `:root` 里三档表面渐变的注释（main.css:91-94）早就批判过这个模式：写死字面量导致主题切换时只有最外层背景跟着变，导航栏/卡片全没反应。当年那轮只根治了 header/panel/card 三档渐变；本次施工把同一思路收口到剩下的所有零件——输入框、幽灵按钮、浮起表面、语义文字档、功能色、系统横幅、装饰遮罩，全部收编进语义槽。

**硬性规则**：组件一律消费语义槽变量，禁止写死颜色字面量。槽位在 main.css `:root` 给出 gold 默认值，四套非默认主题各一条 `html[data-fui-theme="…"]` 覆盖块改值；字面量只允许出现在这两处。新增零件先问「该吃哪个槽」，没有合适的槽就按同样结构补一个，不许在组件里开天窗。JS/canvas 需要主题色时用 `getComputedStyle` 读通道变量再拼 `rgba()`，禁止把槽位数值复制进 JS。

### 槽位清单与五主题取值

**输入框**——暗色主题是「黑底凹槽」，浅底主题是「米白凹槽」；focus 态只许同档加深/提亮，不许换色相。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-input-bg` | `rgba(0,0,0,.45)` | 深蓝黑凹槽（蓝调） | 中性灰黑凹槽 | `rgba(255,252,245,.75)` | `#f8f1e2`（纯色） |
| `--c-input-focus-bg` | `rgba(0,0,0,.6)` | 同档加深 | 同档加深 | `#fffdf8` | `#fffdf8` |
| `--c-input-text` | `var(--c-white)` | `var(--c-white)` | `var(--c-white)` | `var(--c-white)`（=#2f2a22，语义反转） | 同 eyecare |
| `--c-input-placeholder` | `rgba(96,120,152,.5)` | 蓝灰调 | 灰调 | `rgba(138,125,104,.55)` | `rgba(138,125,104,.55)` |

**幽灵按钮**——无填充按钮，暗底靠白光晕、浅底靠暖棕晕；minimal 的描边必须肉眼可见（工程图纸的线框感），不许再淡。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-btn-ghost-bg` | `rgba(255,255,255,.05)` | 蓝调光晕 | 灰调光晕 | `rgba(152,112,58,.06)` | `rgba(152,112,58,.06)` |
| `--c-btn-ghost-border` | `rgba(255,255,255,.14)` | 蓝调描边 | 灰调描边 | `rgba(152,112,58,.28)` | `rgba(152,112,58,.28)`（可见描边） |
| `--c-btn-ghost-hover` | `rgba(255,255,255,.12)` | 蓝调加深 | 灰调加深 | `rgba(152,112,58,.12)` | `rgba(152,112,58,.12)` |

**浮起表面**——第四档表面（下拉/抽屉/option），浮在 card 之上；minimal 不用渐变，`--c-float-grad` 与 `--c-float-bg` 同为纯色。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-float-grad` | 深蓝系渐变（现有效果固化） | 深紫蓝渐变 | 中性灰渐变 | 暖米白渐变 | 纯色（= `--c-float-bg`） |
| `--c-float-bg` | 深蓝纯色（option 等） | 蓝调纯色 | 中性灰纯色 | 暖米白纯色 | `#f8f1e2` |

**语义文字档**——`--c-sell/--c-buy/--c-warn` 是标记色（色条/边框/图标），本组是文字档：语义徽章、提示文案里的文字色。暗底用 pastel 档，浅底必须调深否则糊成一片；dark 整体降饱和（仪表信号灯定位）。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-sell-text` | `#e07ab8` | 沿用 gold pastel 档 | 同族降饱和 | `#a03c7a` | `#a03c7a` |
| `--c-buy-text` | `#3dd6a0` | 沿用 gold pastel 档 | 同族降饱和 | `#1e7a52` | `#1e7a52` |
| `--c-warn-text` | `#f0a866` | 沿用 gold pastel 档 | 同族降饱和 | `#b06a20` | `#b06a20` |
| `--c-err-text` | `#e8a4cf` | 沿用 gold pastel 档 | 同族降饱和 | `#8f2a6b` | `#8f2a6b` |

**功能色通道**——RGB 三通道槽，用法同 `--g-*`（包成 `rgba(var(--c-info),.15)` 用）。gold 主题里历史散落的紫/蓝装饰字面量全部收编成这两条，让金回归唯一主角；cyber 下与霓虹分职对齐（紫=装饰、蓝=主操作）。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-special` | `150,80,220`（紫，装饰） | 霓虹紫族 | 灰紫降饱和 | 暖紫调深 | 同 eyecare |
| `--c-info` | `80,160,240`（蓝，信息/主操作） | 电蓝族 | 灰蓝降饱和 | 暖蓝调深 | 同 eyecare |

**系统横幅**——整页级错误/维护横幅三件套，同族同调；浅底主题整体调浅，避免一块深红砖砸在纸面上。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-alert-bg` | `#7c2d2d` | 同族蓝紫调 | 同族灰调 | 浅底暖红 | 同 eyecare |
| `--c-alert-border` | `#ffc4c4` | 同族 | 同族 | 调深描边 | 同 eyecare |
| `--c-alert-text` | `#f8d7d7` | 同族 | 同族 | 深红文字 | 同 eyecare |

**装饰**——星云/暖雾染色与弹窗遮罩。dark 装饰降级、minimal 整层关闭，这两套主题下 nebula 不参与渲染。

| 变量 | gold（默认） | cyber | dark | eyecare | minimal |
| --- | --- | --- | --- | --- | --- |
| `--c-nebula-tint` | `145,95,25`（RGB 通道） | 蓝紫族 | 关闭（装饰降级） | 极淡暖棕 | 关闭（整层不渲染） |
| `--c-mask` | 深黑蓝 | 深紫黑 | 中性黑灰 | `rgba(120,95,55,.35)`（暖棕） | `rgba(120,95,55,.35)`（暖棕） |

这套槽层与登录页的 `--lw-*` 页面语义层是上下级关系：`--lw-*` 装不下的通用零件（输入框、幽灵按钮、浮层）上收到全站 `--c-*` 槽，页面独有零件仍走页面局部变量——三层引用顺序不变：业务选择器 → 页面局部变量/语义槽 → 通道变量。

### 本次同步修正的文档漂移（2026-07-18）

- `--c-sell/--c-buy` 生效值是 `#c44898/#1e9068`（warn 维持 `#e8924a`）：main.css 早年在前部 `:root` 与后部校准块各定义了一份，本次已合并为单一事实源，本文档同步改口。
- eyecare 通道实为 `152,112,58`（暖金棕），不是旧文档写的 `196,172,110`。
- minimal 是与 eyecare 同色系（`152,112,58` 通道）的暖米纸质，不是旧文档写的近灰白（`190,190,196`）。
- `Orbitron`/`Rajdhani` 从未真正加载（全站 `@font-face` 不含这两款），fui-core 与本文档里的相关引用已移除；frontmatter 里的 cyber 青色系四色同步替换为电蓝系。

## Typography

Boss Tool 有更丰富的可选字体，通过 JS 动态修改 `--f-cjk-name` 和 `--f-en-name` 两个变量实现用户字体切换，浏览器自动按 `var(--f-en-name), var(--f-cjk-name), PingFang SC, Microsoft YaHei, sans-serif` 顺序分字形渲染。

**中文可选**（用户可从界面底部下拉切换）：
- `xszt`（星朱体）：默认，横细竖粗，与金色 Orokin 风格最协调
- `逐浪萌芽字`：圆润可爱
- `仓迹高德国妙黑`：黑体刚硬
- `演示秋鸿楷`：楷书温润

**英文/数字可选**：
- `xszt`：默认，兼顾中英混排
- `Teko-Bold-5`：窄高度战术感数字，价格数字理想字体
- `LEMONMILK-MediumItalic`：斜体奶糖感
- `Cako-Black`：超宽粗体展示标题
- `Adieu-Regular-Bold`：衬线细节
- `Elsie-Black`：装饰花体

价格数字是视觉焦点，优先用 `Teko-Bold-5`（当用户切换为该字体时），否则随 `--f-en-name` 通道的当前字体。
中文正文一律走 `--f-cjk-name` 通道，不硬编码任何中文字体名。

## Layout

工具型布局，信息密度高于装饰密度：

- 顶部导航栏固定，与 Ws-Web 使用相同结构但更紧凑。
- 订单列表区：左侧固定过滤/搜索面板，右侧滚动订单卡片列表。
- 订单卡片：横向展示物品名 + 数量 + 价格，sell/buy 色标在左侧竖条上。
- 库存页面：网格布局，每格一个物品缩略图 + 数量徽章。
- 拍卖页面：表格形式，时间 + 起拍价 + 当前价列。

响应式断点与 Ws-Web 保持一致（640px），移动端订单卡片切换为垂直堆叠。

## Elevation & Depth

与 Ws-Web 一致的四级阴影体系，通过 CSS 变量定义：
- `shadow-bg`：`0 2px 12px rgba(0,0,0,.4)`
- `shadow-card`：`0 2px 16px rgba(0,0,0,.5)` + 内嵌主色细辉光
- `shadow-panel`：`0 4px 48px rgba(0,0,0,.65)` + 更强内嵌辉光
- `shadow-hover`：`0 8px 32px rgba(0,0,0,.55)` + `0 0 20px rgba(var(--g-primary),.12)`

**工具型降噪**：在订单列表密集场景下，卡片间的辉光强度比 Ws-Web 榜单低一档，避免视觉噪音影响快速扫读。

## Shapes

- 卡片圆角 `r-md: 8px`（略大于 Ws-Web 的 4px），更接近工具 UI 的实用感。
- 按钮胶囊 `999px`（与 Ws-Web 一致）。
- 价格数字标签矩形无圆角。
- sell/buy 色条：卡片左侧 `3px` 实色竖条，是最快速的语义标记。

## Components

```yaml
components:
  order-card:
    backgroundColor: "{colors.card}"
    borderLeft: "3px solid {colors.sell} 或 {colors.buy}"
    borderColor: "{colors.gold-border}"
    rounded: "{rounded.md}"
    shadow: "{shadow-card}"
  order-card-hover:
    shadow: "{shadow-hover}"
    backgroundColor: "rgba(var(--g-primary),0.06)"

  price-tag:
    fontFamily: "Teko-Bold-5 (当用户已切换) 或 --f-en-name 当前字体"
    textColor: "{colors.gold-primary}"
    fontSize: "1.4rem"

  theme-select:
    backgroundColor: "rgba(var(--g-primary),0.06)"
    borderColor: "{colors.gold-primary}"
    rounded: "{rounded.pill}"
    textColor: "{colors.gold-bright}"
  theme-select-cyber:
    border: "animated gradient via --cyber-flow-grad"

  boot-splash:
    backgroundColor: "var(--fui-boot-bg)"
    accentColor: "rgb(var(--g-primary))"
```

## Login Page Theming

登录页（login.html）是五套主题适配的第一个「完整页面级」样板，2026-07-18 定稿。它把全站通道变量的用法从骨架组件推进到整页表单，以后新建页面照此办理。

### 设计原则：暗金，不是明黄

登录页的视觉是「虚空黑底上的 Orokin 仪器」，强调金必须是**实心、中等明度的暗金**——读得清楚，但不荧光、不刺眼。锚点档位：

- **按钮渐变**：`#d9b25f → #b08a34`（135°）档，配深棕文字 `#2a1c04`；hover 只允许同档微亮（`#e2c172 → #bc9340`），不许跨档提亮。
- **强调文字/链接**：`#dfc07d` 档（介于主金 `#d4a84a` 与高光金 `#f0d878` 之间的中段），hover 同档微亮（`#eed9a4`）。
- **高光与透明度只给非阅读面**：描边、辉光、顶部金线、角括号等装饰部位走 `rgba(var(--g-primary), .x)` 通道，明暗随主题换；凡是「要读的字、要点的钮」一律实色填充。

**两个已被否决的极端（2026-07-18 两轮返工，勿再踩坑）**：

1. 第一轮把按钮/链接做成 40% 透明度的暗金（`rgba(212,168,74,.4)` 档）——实测文字看不清，被否。
2. 第二轮矫枉过正拉到 `#ffd980 / #ffd98a / #fff3d0 / #ffe9ad` 荧光黄——亮得过头、破坏观感，再被否。

教训：可读性靠「实心填充 + 明暗对比」解决，既不靠压透明度，也不靠拉荧光明度。中间档位的暗金是唯一正确解。

### 五主题配色映射

每套主题必须自带完整配色：cyber 下绝不能还是金色，eyecare/minimal 浅底上绝不能还是深蓝卡片。按钮、强调文字、卡片、输入框、装饰光晕五件事逐套过一遍（下表数值与 login.html 的 `--lw-*` 定义一致）：

| 主题 | 按钮 | 强调文字 | 卡片 | 输入框 | 装饰光晕 |
| --- | --- | --- | --- | --- | --- |
| gold（默认） | 实心 `#d9b25f→#b08a34` + 深棕字 `#2a1c04`；hover 同档微亮 `#e2c172→#bc9340` | `#dfc07d`，hover `#eed9a4` | 吃全站 `--c-panel-grad` 深蓝渐变 + `rgba(var(--g-deep),.22)` 边 + 顶部金线（中点高光 `#e8c86a`）+ 四角括号 | `rgba(0,0,0,.55)` 底，focus 加深至 `.68` + 金边 `rgba(var(--g-primary),.62)` + 左内嵌金条 | halo / 扫描线 / 角光全部走 `rgba(var(--g-*),…)` 通道，随主题自动换色 |
| cyber | 实心电蓝→紫罗兰 `#3c78ff→#9633ff` + 白字 `#ffffff`；**禁金色** | `#7aa8ff` 电蓝，hover `#9dbcff` | 深紫 `--c-panel-grad`；顶部线高光 `#9db9ff`，角括号可挂 `--cyber-flow-grad` 流动 | 深紫黑底沿用通道；focus 边 / 内嵌条走 `--g-*` 通道自动变电蓝 | 不单独覆盖，吃 `--g-*` 通道自动变蓝 / 紫，呼吸保留 |
| dark | 实心银灰 `#d2d8e0→#a6adba` + 炭黑字 `#17181c`；全程无彩 | `#d0d5de`，hover `#e6ebf2` | 炭黑 `--c-panel-grad` + 中性灰边；顶部线高光 `#e2e7ee` | `rgba(0,0,0,.4)` 底，focus `.55` + 灰白边 | 不单独覆盖，吃 `--g-*` 通道自动变灰白，保持安静单色 |
| eyecare | 实心暖金棕 `#b08a48→#8a6636` + 米白字 `#faf3e4`（浅底上按钮是深色块，文字用浅色，与暗色主题相反） | `#8a6636`（即 `--c-gold-bright`），hover `#a8823f` 微亮一档、不跳出暖金棕 | 米白 `--c-card-grad` + 暖棕边 + 暖棕系 `--shadow-card`；**禁深蓝卡片** | 米白底 `rgba(255,252,245,.75)`，focus 纯白 `#fffdf8`，深字 `#2f2a22` | halo / 扫描线 / 角光压成极淡暖棕（`rgba(120,95,55,.06)` 档），纸面保持干净 |
| minimal | 与护眼同档 `#b08a48→#8a6636`，无辉光、无扫光动画 | `#8a6636`，hover `#a8823f`（无过渡） | 纯色 `--c-card`（`#f8f1e2`）+ 单层细边 | 纯色 `#f8f1e2` 底，focus `#fffdf8` | `--lw-fx-display: none` 整层关闭；入场动画被全局 `.01ms` 归零属预期，勿写例外 |

两个浅底主题的连带处理：错误框等语义色部件同步调深（eyecare/minimal 错误文字 `#8f2a6b`、边框 `rgba(168,46,124,.4)`），code/kbd 小标签改用暖棕透明底——浅底上沿用暗色主题的浅粉文字会糊成一片。

注意 eyecare/minimal 的语义反转：`--c-white` 在浅底主题里是深色 `#2f2a22`，`--c-text` 是暖棕灰 `#4a4138`——引用变量时想「语义」（正文 / 标题），不要想「颜色名」。

### `--lw-*` 局部变量 + 全站通道变量的配合约定

新建页面的主题适配分三层，引用顺序固定为：**业务选择器 → `--lw-*`（页面语义层）→ `--g-*` / `--c-*`（全站通道层）**。

- **通道层**（main.css 的 `:root` 与各 `html[data-fui-theme="…"]` 块提供；fui-core.css 头部有一份同步副本，改通道色时两个文件必须一起改）：
  - `--g-primary / --g-mid / --g-deep / --g-hi`：RGB 三通道数字槽（如 `212,168,74`），只能包进 `rgba(var(--g-primary), .5)` 用，负责边框、辉光、渐变中段等「结构不变、颜色随主题换」的部位。
  - `--c-*` 语义变量（`--c-bg / --c-text / --c-white / --c-card / --c-gold-bright / --c-header-grad / --c-panel-grad / --c-card-grad / --shadow-*`）：页面级背景、卡片、正文色直接吃这一层，不手写深色渐变字面量——历史教训：写死渐变导致主题切换时只有最外层背景跟着变，导航栏和卡片全没反应。
- **页面语义层 `--lw-*`**（login window 前缀，登录页首创；别的页面按页面另取两字母前缀，避免跨页污染）：只定义本页独有的零件——登录页是按钮渐变 `--lw-btn-grad` / `--lw-btn-hover-grad` / `--lw-btn-text`、强调文字 `--lw-accent-text` / `--lw-accent-text-hover`、输入框 `--lw-input-*`、错误框 `--lw-err-*`、装饰光效 `--lw-halo-grad` / `--lw-scan-grad` / `--lw-decor-grad` 与开关 `--lw-fx-display`、两级文字通道 `--lw-dim` / `--lw-text-hi`（RGB 三通道，配 alpha 用）。业务选择器只消费 `--lw-*`，不直接碰通道变量、更不写字面量。
- **声明与覆盖的位置**：默认值写在 `:root`（页面 `<style>` 内，靠 `--lw-` 前缀与全站变量隔离），每套非默认主题一条 `html[data-fui-theme="…"] { --lw-*: … }` 覆盖块（cyber/dark/eyecare/minimal 共四条，gold 走默认值）。主题适配只在覆盖块里改局部变量的值，不动任何业务选择器——这是「cyber 不能还是金色、eyecare 不能还是深蓝卡片」的机制保证。
- **默认值写法**：`--lw-*` 的默认值尽量用通道变量表达（如 `--lw-halo-grad` 里的 `rgba(var(--g-mid),.13)`），这类部位换主题时甚至不用进覆盖块（cyber/dark 的光晕就是这样自动变色的）；只有通道装不下的（按钮实心渐变两端色、强调文字、hover 提亮档）才写字面量，且字面量必须在每一条主题覆盖块里重新指定。minimal 优先用「开关变量」（如 `--lw-fx-display: none`）整层关闭装饰，而不是逐元素覆盖。

照抄流程：① `<head>` 按 main.css → fui-core.css → fui-core.js 顺序引入，`html[data-fui-theme]` 选择器即刻生效；② 页面级底色 / 卡片 / 正文直接引用 `--c-*`，页面独有零件在 `:root` 声明 `--lw-*` 并尽量用通道变量赋默认值；③ 为 cyber/dark/eyecare/minimal 各写一条覆盖块，按上表逐套过按钮 / 强调文字 / 卡片 / 输入框 / 光晕五件事；④ minimal 用开关变量关装饰、不补任何动效例外，eyecare/minimal 记得语义反转与语义部件调深。

## Do's and Don'ts

- **Do** 使用 CSS 变量通道（`--g-primary` 等），不在业务样式里硬编码 `#d4a84a`——否则主题切换会失效。
- **Do** 用 sell/buy 色区分订单方向：标记色（色条/边框/图标）全主题保持不变；做文字用时走 `--c-sell-text/--c-buy-text` 文字档（浅底调深、dark 降饱和），不要直接拿标记色当文字色。
- **Do** 组件颜色一律消费语义槽变量（`--c-input-*` / `--c-btn-ghost-*` / `--c-float-*` / `--c-*-text` / `--c-special` / `--c-info` / `--c-alert-*` / `--c-nebula-tint` / `--c-mask`）：新增零件先找槽，没有合适的槽就在 `:root` 与四个主题覆盖块里补一个，字面量只许出现在这两处。
- **Do** 让价格数字是页面上视觉权重最高的元素：最大字号、主色文字、最亮的字体（Teko-Bold-5）。
- **Do** 在开机动画里使用 `--g-primary` 通道颜色，确保五套主题的开机动画自动跟随主题色。
- **Do** 对字体切换只修改 `--f-cjk-name` 和 `--f-en-name` 两个变量，让 `--f-main` 自动重组，无需逐处修改。
- **Do** 金色强调一律「实心暗金」：按钮渐变锚 `#d9b25f→#b08a34` 档、强调文字锚 `#dfc07d` 档；可读性靠实心填充与明暗对比，不靠荧光明度（2026-07-18 两轮返工教训，详见 Login Page Theming）。
- **Do** 新页面的主题适配走「业务选择器 → 页面局部变量（如 `--lw-*`）→ 全站通道变量（`--g-*`/`--c-*`）」三层引用，主题差异只改各主题的局部变量覆盖块，不动业务选择器。
- **Don't** 在组件里写死颜色字面量（hex/rgba）——必须走语义槽。这正是 main.css:91-94 注释批判过、本次施工根治的模式：写死字面量会让非 gold 主题穿帮，且主题切换时只有最外层背景跟着变。
- **Don't** 在 JS/canvas 里写死主题色——必须用 `getComputedStyle` 读 `--g-*` / `--c-*` 通道再拼 `rgba()`，否则星空、流光这类 JS 绘制的装饰在非 gold 主题下穿帮。
- **Don't** 引用从未定义的 CSS 变量——`--c-fg` 幽灵变量事故：shared.js 的整页提示层内联样式写了 `color:var(--c-fg,#e8e0cc)`，而 `--c-fg` 在任何主题块里都未定义，gold 下暖米 fallback 不显眼、浅底主题上浅字直接糊在米白底上。教训：引用的变量必须能在 `:root` 找到定义；`var()` 的 fallback 是遮羞布不是修复，正确做法是改引既有槽（本例应吃 `--c-white`）。
- **Don't** 把强调金做成 40% 透明度（看不见）或 `#ffd980` 级荧光黄（刺眼）——两个极端均已被评审否决。
- **Don't** 在赛博主题下使用静态金色边框——赛博皮的选择框、强调边框必须走流动渐变（`--cyber-flow-grad` + `background-position` 动画）。
- **Don't** 将五套主题的颜色逻辑混写进业务组件——主题差异只在 `:root` 和 `html[data-fui-theme="..."]` 里处理。
- **Don't** 在极简模式（`minimal`）下添加任何过渡或动画——`minimal` 主题的设计原则是零动效、零辉光、最大可读性。
- **Don't** 为订单卡片添加缩略图异步加载——本项目明确移除了缩略图以避免带宽不足用户卡顿（参见 private-wm-no-order-thumbs.md 记忆）。
- **Don't** 让工具页和公站主页共用同一个组件文件——两个仓库各自维护各自的 CSS，通过 FUI 骨架（fui-core.css）保持开机动画统一，业务样式独立。
