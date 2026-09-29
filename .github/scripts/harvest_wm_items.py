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
import json, os, urllib.request
from wm_item_identity import (
    build_identity_manifest,
    load_json,
    validate_identity_continuity,
    write_json_atomic,
)

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
IDENTITIES_OUT = os.environ.get(
    "WM_IDENTITIES_OUT",
    os.path.join(os.path.dirname(os.path.abspath(OUT)), "wm-item-identities.json"),
)


def fetch_items():
    req = urllib.request.Request(DIRECT + "/v2/items", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    j = fetch_items()
    raw = (j or {}).get("data") or []
    if not isinstance(raw, list):
        raise RuntimeError("WM item response data is not a list")
    items = []
    for it in raw:
        i18n = it.get("i18n") or {}
        en = (i18n.get("en") or {}).get("name") or it.get("slug")
        zh_api = (i18n.get("zh-hans") or {}).get("name")
        items.append({
            "id":            it.get("id"),
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
    previous_doc = load_json(OUT, required=True) if os.path.exists(OUT) else {}
    if previous_doc and not isinstance(previous_doc, dict):
        raise RuntimeError("previous WM item manifest is not an object; keeping previous data")
    previous = (previous_doc or {}).get("data") or []
    if not isinstance(previous, list):
        raise RuntimeError("previous WM item manifest data is not a list; keeping previous data")
    identity_path = IDENTITIES_OUT
    previous_identity = load_json(identity_path, required=True) if os.path.exists(identity_path) else {}
    if previous_identity and not isinstance(previous_identity, dict):
        raise RuntimeError("previous WM item identity sidecar is not an object; keeping previous data")
    try:
        renames = validate_identity_continuity(previous, items)
        identity_manifest = build_identity_manifest(items, previous, previous_identity, renames)
    except ValueError as error:
        raise RuntimeError("WM item identity validation failed; keeping previous data: %s" % error) from error
    if renames:
        print("已验证 %d 个 slug 变更对应原有稳定 item id" % len(renames))

    out_dir = os.path.dirname(os.path.abspath(OUT))
    os.makedirs(out_dir, exist_ok=True)
    write_json_atomic(OUT, {"data": items})
    write_json_atomic(identity_path, identity_manifest)
    kb = os.path.getsize(OUT) // 1024
    print(f"已保存 {OUT} ({len(items)} 项, {kb} KB)")

if __name__ == "__main__":
    main()
