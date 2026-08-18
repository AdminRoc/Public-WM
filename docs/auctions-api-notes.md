# WM 拍卖（Auctions）API 调研笔记 —— auctions.html 开发依据

2026-07-02 登录态下（用户 `-CSC-2026` / slug `csc-2026`）在 warframe.market/zh-hans/auctions
页面上下文实测。覆盖三类特殊对象：已揭示的裂罅Mod（riven）/ 赤毒玄骸（lich）/ 帕尔沃斯的姐妹（sister）。

## 一、搜索（公开，无需登录）

`GET https://api.warframe.market/v1/auctions/search`（header: `Platform: pc`, `Language: zh-hans`）

- 必带 `type=riven|lich|sister`；**riven 必须带 `weapon_url_name`**（缺则 400 requirements_not_met）；
  lich/sister 的 weapon_url_name 可选。
- 每次最多返回约 500 条（`payload.auctions`）。
- 通用：`buyout_policy=direct|with_bids|all`、`sort_by=price_asc|price_desc|positive_attr_desc|...`
- riven 参数：`positive_stats`（逗号分隔≤3，值为 attribute url_name）、`negative_stats`、
  `polarity=madurai|vazarin|naramon|any`、`mod_rank`、`re_rolls_min/max`、`mastery_rank_min/max`
- lich/sister 参数：`element`、`having_ephemera=true|false`、`damage_min/max`、`quirk`

### 返回条目字段（顶层）
```
id, item, owner{ingame_name,status,...}, starting_price, buyout_price, top_bid,
minimal_reputation, note, note_raw, visible, closed, is_direct_sell, is_marked_for,
platform, crossplay, created, updated, winner, private
```
### item（按 type）
- riven: `{type:'riven', weapon_url_name, name(词条内部名), polarity, mod_rank, mastery_level,
  re_rolls, attributes:[{url_name, value, positive}]}`
- lich/sister: `{type, weapon_url_name, element, damage, having_ephemera, quirk?}`

## 二、字典 manifest（本地化：武器名/词条名 中英对照）

**全部是 v2、公开、返回 `{data:[...]}`，每项含 `i18n:{en:{name,icon,thumb}, 'zh-hans':{...}}`：**
| 端点 | 条数 | 关键字段 |
|---|---|---|
| `GET /v2/riven/weapons` | 417 | id, slug, gameRef, group(primary/secondary/melee), rivenType(rifle/pistol/...), disposition, reqMasteryRank, i18n |
| `GET /v2/riven/attributes` | 32 | id, slug, gameRef, group, prefix, suffix, i18n |
| `GET /v2/lich/weapons` | 21 | id, slug, gameRef, reqMasteryRank, i18n |
| `GET /v2/sister/weapons` | 11 | id, slug, gameRef, reqMasteryRank, i18n |
| `GET /v2/lich/ephemeras` `/v2/sister/ephemeras` | 7 | id, slug, gameRef, animation, element, i18n |
| `GET /v2/lich/quirks` `/v2/sister/quirks` | — | id, slug, i18n |

> WM 网页把这些缓存在 localStorage `manifests/riven*` `manifests/lich*` `manifests/sister*`，
> 版本号在 `versions`（base64 时间戳，用于判断是否需重新拉取）。
> **我们的做法**：GitHub Action（海外出口，可达 WM）定期抓这些 v2 端点，合并成一份精简
> 中英字典存进仓库 `data/wm-auction-dicts.json`，前端同源加载（大陆可达），与 avg_prices 同模式。

## 三、我的拍卖 / 写操作（需登录）

- 读（公开）：`GET /v1/profile/{slug}/auctions` — 实测 200，返回 `payload.auctions`（我方全部拍卖）。
- 写（需 WM JWT，v1 用 `Authorization: JWT <token>`，我们 Worker 已存有该 token）：
  - 创建：`POST /v1/auctions/create`（body：type + item 各字段 + starting_price/buyout_price/note/private）
  - 改价/编辑：`PUT /v1/auctions/entry/{id}`
  - 关闭/下架：`PUT /v1/auctions/entry/{id}/close`
  - 提高刷新时间：`PUT /v1/auctions/entry/{id}/reup`（可选）

## 四、复制求购信息按钮（WM 源站没有，我们独有）

搜索结果每条卡片加"复制求购"按钮，生成游戏内私聊指令（`/w ` + 空格 + 卖家 ingame_name + 消息）：
```
/w {owner.ingame_name} Hi! I WTB your {武器英文名}'s Riven Mod in {价格} platinum.
```
lich/sister 版本把 "Riven Mod" 换成对应品类描述（例如 "Kuva {weapon} Lich" / "{weapon} Sister"）。
武器名用英文（游戏内交易通用英文名），价格取 buyout_price。点击 `navigator.clipboard.writeText`。

## 五、页面规划（分阶段）

**阶段 A（只读，零风险，先交付）**
- 三类 tab（riven/lich/sister）切换；各自完整筛选器（武器下拉/词条多选/极性/元素/幻纹/循环/段位/伤害区间）
- 全站搜索比价：结果卡片（武器图标+名+词条/属性+卖家+在线状态+价格）
- **每条卡片"复制求购"按钮**（第四节模板）
- **中英双语切换**（复用字典 i18n；沿用 index 的 .bw-lang-btn 组件）
- 我的同类拍卖只读展示

**阶段 B（写操作，需真实账号谨慎分步验证）**
- 单个上架 / 单个下架（close）/ 单个改价（复用抽屉表单模式）
- 批量改价 / 批量上架（复用 shared.js 的 runBatch 引擎 + 失败面板）
- 识图上架：裂罅Mod 截图含词条与数值，需专门的词条解析器把 OCR 文本行映射到
  attributes url_name + value（结合 /v2/riven/attributes 字典）

## 六、与现有架构衔接

- Worker 需新增 v1 auctions 代理路由 + v2 字典代理（现有 wmFetch 是 v2 JWT；v1 写操作用
  `Authorization: JWT`，需单独 wmV1Fetch 帮手）。搜索/字典为公开 GET，可直接代理并 CDN 缓存。
- 入口：主页 index.html 的紫色横幅 `.bw-auctions-entry`（已就位），不占顶栏。
