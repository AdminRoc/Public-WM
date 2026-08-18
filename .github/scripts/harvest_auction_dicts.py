"""
拉取 WM 拍卖字典（裂罅Mod / 玄骸 / 姐妹），合并成单文件 data/auction-dicts.json。
格式: { "riven/weapons": [...], "riven/attributes": [...], ... } 每项含
i18n:{ en:{name,icon,thumb}, 'zh-hans':{name,...} }，一次拉取即得中英双语。

产出提交到 Public-WM 仓库 main 分支后，拍卖页（auctions.html）经 jsDelivr 引用：
  https://cdn.jsdelivr.net/gh/AdminRoc/Public-WM@main/data/auction-dicts.json
由于腾讯云 Pages 为手动低频部署，页面必须读取 jsDelivr 上的最新产物，
而不能读已部署的静态快照，避免部署间隔期内数据过时。

字典变化极低频，本脚本无需像均价那样小时级刷新；手动触发或每周 cron 即可。
"""
import json, os, urllib.request, sys

DIRECT = "https://api.warframe.market"

# name -> WM v2 路径（v2 返回 { data: [...] }，含 i18n 中英双语）
DICTS = {
    "riven/weapons":    "/v2/riven/weapons",
    "riven/attributes": "/v2/riven/attributes",
    "lich/weapons":     "/v2/lich/weapons",
    "lich/ephemeras":   "/v2/lich/ephemeras",
    "lich/quirks":      "/v2/lich/quirks",
    "sister/weapons":   "/v2/sister/weapons",
    "sister/ephemeras": "/v2/sister/ephemeras",
    "sister/quirks":    "/v2/sister/quirks",
}

HEADERS = {
    "User-Agent":      "publicwm-auction-dict-bot/1.0 (+https://github.com/AdminRoc/Public-WM)",
    "Accept":          "application/json",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Platform":        "pc",
    "Language":        "zh-hans",   # 同时返回 en + zh-hans 两套 i18n
    "Origin":          "https://warframe.market",
    "Referer":         "https://warframe.market/",
}

OUT = os.environ.get(
    "AUCTION_DICTS_OUT",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "auction-dicts.json"),
)


def fetch_json(path):
    req = urllib.request.Request(DIRECT + path, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    result = {}
    failures = []
    for name, path in DICTS.items():
        try:
            j = fetch_json(path)
            arr = (j or {}).get("data") or []
            result[name] = arr
            print(f"  {name}: {len(arr)} 条")
        except Exception as e:
            failures.append((name, str(e)))
            print(f"  {name}: 拉取失败 {e}")

    if failures:
        # 部分失败也照常写出（缺失的 key 前端会退化为空数组）
        print("部分字典拉取失败：", failures)

    out_dir = os.path.dirname(os.path.abspath(OUT))
    os.makedirs(out_dir, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(OUT) // 1024
    print(f"已保存 {OUT} ({len(result)} 组, {kb} KB)")

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
