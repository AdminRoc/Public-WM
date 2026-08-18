"""
拉取 WM 全部可交易物品总表，精简为前端 _items 所需字段，产出 data/wm-items.json。
格式: { "data": [ { id, slug, zh, en, thumb, icon, tags, bulkTradable, maxRank,
                    maxCharges, subtypes, maxAmberStars, maxCyanStars, rarity, tradingTax }, ... ] }
使用 Language: zh-hans 一次拿 en + zh-hans 两套 i18n（英文名 + 中文名）。

产出提交到 Public-WM 仓库 main 分支后，首页（main.js）经 jsDelivr 引用：
  https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/wm-items.json
由前端直接加载，边缘函数（pwm-api.wfspeed.run）不再拉取这份大体积物品表——
边缘函数只承担登录 / 订单 / 在线状态等轻动态操作。同均价/字典一样，页面读
jsDelivr 最新产物而非 Pages 部署快照，避免手动低频部署导致数据过时。
"""
import json, os, urllib.request, sys

DIRECT = "https://api.warframe.market"

HEADERS = {
    "User-Agent":      "publicwm-items-bot/1.0 (+https://github.com/AdminRoc/Public-WM)",
    "Accept":          "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Platform":        "pc",
    "Language":        "zh-hans",   # 同时返回 en + zh-hans 两套 i18n
    "Origin":          "https://warframe.market",
    "Referer":         "https://warframe.market/",
}

OUT = os.environ.get(
    "WM_ITEMS_OUT",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "wm-items.json"),
)


def fetch_items():
    req = urllib.request.Request(DIRECT + "/v2/items", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    j = fetch_items()
    raw = (j or {}).get("data") or []
    items = []
    for it in raw:
        if not it.get("id"):
            continue
        i18n = it.get("i18n") or {}
        en = (i18n.get("en") or {}).get("name") or it.get("slug")
        zh_api = (i18n.get("zh-hans") or {}).get("name")
        items.append({
            "id":            it["id"],
            "slug":          it.get("slug"),
            "zh":            zh_api or en,
            "en":            en,
            "thumb":         (i18n.get("en") or {}).get("thumb") or it.get("thumb") or None,
            "icon":          (i18n.get("en") or {}).get("icon") or it.get("icon") or None,
            "tags":          it.get("tags") or [],
            "bulkTradable":  it.get("bulkTradable") or False,
            "maxRank":       it.get("maxRank") or None,
            "maxCharges":    it.get("maxCharges") or None,
            "subtypes":      it.get("subtypes") or None,
            "maxAmberStars": it.get("maxAmberStars") or None,
            "maxCyanStars":  it.get("maxCyanStars") or None,
            "rarity":        it.get("rarity") or None,
            "tradingTax":    it.get("trading_tax") or None,
        })
    out_dir = os.path.dirname(os.path.abspath(OUT))
    os.makedirs(out_dir, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"data": items}, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(OUT) // 1024
    print(f"已保存 {OUT} ({len(items)} 项, {kb} KB)")

    if not items:
        sys.exit(1)


if __name__ == "__main__":
    main()
