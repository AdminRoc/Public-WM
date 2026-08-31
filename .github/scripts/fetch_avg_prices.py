"""
全量获取 WM 所有可交易物品均价，算法与 worker.js calcAvg 完全一致。
使用 /v2/orders/item/{slug}（本地可访问，v1 被 403）。
v2 字段：type(sell/buy), user.status(ingame/online/offline), visible, platinum
输出: avg_prices_full.json  格式: { slug: { avg, count, used, total, special,
      avg_zero?, avg_max?, stale? } }  （avg_zero/avg_max 仅可分级物品有，结构同 avg 本身；
      stale=true 表示本次拉不到新数据，沿用了上一次成功统计到的均价兜底）
支持断点续跑。

口径（2026-08 调整）：
- 样本 = in-game + online 的卖单合并统计（不再先 ingame 后降级 online）；
  offline 永不参与。
- count>=3：去掉最低价（第 1 位），取第 2 与第 3 位价格均值 = avg
- count 1~2：取全部价格均值
- count=0：沿用上次有效均价并标记 stale（而非清空显示"暂无其他卖家"）
- source 恒为 "combined"；special = count<3（样本少，参考性弱）
- 拉取真错误（网络/非 200）与"0 个卖单"严格区分：错误会补跑重试
  防数据缺口，补跑全败后才允许 stale 兜底。

本脚本原先存于私库 AdminRoc/Ws-Web-core，随产物管线一并迁移到 Public-WM
（公库），此后由 Public-WM 的 refresh-avg-prices.yml 每小时产出并提交
data/avg_prices_full.json，各站（Public-WM 自身 / Ws-Web-item 等）经
jsDelivr 引用该公库产物。
"""
import asyncio, json, time, os, random
import aiohttp

DIRECT_URL  = "https://api.warframe.market"
# 速率策略（每小时全量跑一次，须在 30 分钟内完成）：
# - 并发 12：3837 个物品约 8~12 分钟，远低于 30 分钟门槛
# - 随机间隔 0.4~1.0s：并发下的总请求频率 ≈ 12~20 req/s，WM 侧负载适中
# - 启动随机延迟 0~3min：错开整点脉冲，但不破坏小时节奏（原 30min 会撞下个整点）
# - 每 50 个 slug 后额外休息 2~5s
CONCURRENCY   = 12
MIN_DELAY     = 0.4
MAX_DELAY     = 1.0
STARTUP_JITTER_MAX = 3 * 60   # 3min
BATCH_SIZE    = 50
BATCH_PAUSE_MIN = 2
BATCH_PAUSE_MAX = 5
MAX_RETRIES   = 5              # 单次抓取内重试次数（429/5xx/网络错误）
RETRY_ROUNDS  = 3              # 主循环结束后对失败 slug 的补跑轮数
ITEMS_TIMEOUT = 30             # 物品总表单次请求超时
ITEMS_RETRIES = 5              # 物品总表请求重试次数（网络抖动时保管线不中断）
import os as _os
OUT_PATH    = _os.environ.get(
    "AVG_PRICES_OUT",
    _os.path.join(_os.path.dirname(__file__), r"..\..\..\..\data\avg_prices_full.json")
)

# 公共只读 API 必须自报身份；WM 官方规则禁止第三方应用伪装浏览器 UA。
HEADERS = {
    "User-Agent":      "publicwm-avg-price-bot/1.0 (+https://github.com/AdminRoc/Public-WM; hourly avg price data)",
    "Accept":          "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Platform":        "pc",
    "Language":        "en",
    "Origin":          "https://warframe.market",
    "Referer":         "https://warframe.market/",
}


def _sell_prices(all_orders, rank=None):
    """in-game + online 的卖单合并（offline 永不参与——挂机价严重失真）。
    rank=None 时不按等级过滤（整体均价口径）；rank=数字 时只统计该等级的卖单
    （用于可分级物品的"满级/零级"分别均价，字段名 rank，v2 订单接口实测确认，
    不是旧文档记载的 mod_rank）。"""
    return sorted(
        int(o["platinum"]) for o in all_orders
        if (o.get("type") or o.get("order_type") or o.get("orderType") or "").lower() == "sell"
        and o.get("visible", True) is not False
        and o.get("platinum", 0) > 0
        and (o.get("user") or {}).get("status", "").lower() in ("ingame", "online")
        and (rank is None or o.get("rank") == rank)
    )


def _trim_avg(all_orders, total, rank=None):
    """合并口径均价：
    1. count>=3：去掉最低价（第 1 位），取第 2 与第 3 位价格均值（对乱标低价
       与离谱高价都稳健，反映"实际可成交的偏低档位"）
    2. count 1~2：直接取全部价格均值
    3. count=0：avg=None（由调用方 _apply_stale_fallback 沿用上次有效值）
    special = count<3（样本少，参考性弱）。"""
    prices = _sell_prices(all_orders, rank)
    count  = len(prices)
    if count == 0:
        return {"avg": None, "count": 0, "used": 0, "total": total, "source": "combined", "special": True}

    if count >= 3:
        avg  = round((prices[1] + prices[2]) / 2)
        used = 2
    else:
        avg  = round(sum(prices) / count)
        used = count
    result = {"avg": avg, "count": count, "used": used, "total": total, "source": "combined"}
    if count < 3:
        result["special"] = True
    return result


def compute_avg(all_orders, max_rank=None, prev=None):
    """整体均价（avg 字段）之外，若该物品是可分级物品（items 字典里 maxRank>0，
    如 mod/arcane），额外算出 avg_zero（0级）与 avg_max（满级）两组独立均价——
    满级和零级价格往往差好几倍，混在一起算的"整体均价"对可分级物品没有参考意义。
    非可分级物品（max_rank 为 None 或 0）不附加这两个字段。
    同时附加 max_rank 本身——消费端（如 Public-WM 订单页）需要它来判断某一条
    具体订单的等级应该对应 avg_zero 还是 avg_max。
    prev 为上一次成功生成的同一条数据（含 avg_zero/avg_max），本次任一层级拉不到
    数据时用它兜底，见 _apply_stale_fallback。"""
    total  = len(all_orders)
    result = _apply_stale_fallback(_trim_avg(all_orders, total, rank=None), prev)
    if max_rank:
        result["avg_zero"]  = _apply_stale_fallback(_trim_avg(all_orders, total, rank=0), prev and prev.get("avg_zero"))
        result["avg_max"]   = _apply_stale_fallback(_trim_avg(all_orders, total, rank=max_rank), prev and prev.get("avg_max"))
        result["max_rank"]  = max_rank
    return result


def _apply_stale_fallback(cur, prev):
    """样本=0 或请求最终失败时（avg=None），沿用上一次成功抓取到的均价并标记
    stale=True，而不是直接清空显示"暂无其他卖家"——多数情况只是本次抓取窗口内
    该物品恰好没有符合条件的挂单，历史参考价依然比完全没有数字更有用。
    prev 为 None（该物品/该子字段之前也从未成功过）时无法兜底，维持 avg=None。"""
    if cur.get("avg") is not None:
        return cur
    if prev and prev.get("avg") is not None:
        carried = dict(prev)
        carried["stale"] = True
        return carried
    return cur


def _jitter_delay():
    return MIN_DELAY + random.random() * (MAX_DELAY - MIN_DELAY)


def _backoff_sleep(attempt):
    # 指数退避 + 随机抖动：5, 10, 20, 40, 80（上限 120s）
    return min((2 ** attempt) * 5, 120) + random.random() * 5


async def _fetch_items(session):
    """拉取全量物品列表，带指数退避重试。此请求若失败会让整条流水线中断，
    而 warframe.market 偶发超时/5xx，故与单物品抓取一样做重试保护。"""
    url = f"{DIRECT_URL}/v2/items"
    for attempt in range(ITEMS_RETRIES):
        try:
            async with session.get(
                url, headers=HEADERS,
                timeout=aiohttp.ClientTimeout(total=ITEMS_TIMEOUT)
            ) as r:
                if r.status != 200:
                    raise RuntimeError(f"GET {url} -> HTTP {r.status}")
                return await r.json(content_type=None)
        except Exception:
            if attempt < ITEMS_RETRIES - 1:
                await asyncio.sleep(_backoff_sleep(attempt))
                continue
            raise


async def fetch_slug(session, sem, slug, max_rank, prev_entry):
    """单物品抓取：真错误（非 200 / 网络异常）返回 (slug, "ERROR")，
    "0 个卖单"返回 (slug, 结果) 由 compute_avg 内部走 stale 兜底。
    调用方据此把 ERROR 的 slug 加入补跑清单，防止数据缺口。"""
    url = f"{DIRECT_URL}/v2/orders/item/{slug}"
    async with sem:
        for attempt in range(MAX_RETRIES):
            try:
                async with session.get(
                    url, headers=HEADERS,
                    timeout=aiohttp.ClientTimeout(total=20)
                ) as r:
                    if r.status == 429 or r.status == 509:
                        await asyncio.sleep(_backoff_sleep(attempt))
                        continue
                    if r.status != 200:
                        if attempt < MAX_RETRIES - 1:
                            await asyncio.sleep(1 + random.random())
                            continue
                        return slug, "ERROR"
                    data = await r.json(content_type=None)
                    orders = data.get("data") or []
                    await asyncio.sleep(_jitter_delay())
                    return slug, compute_avg(orders, max_rank, prev_entry)
            except Exception:
                await asyncio.sleep(0.5 + random.random())
    return slug, "ERROR"


async def run_pass(session, sem, tasks, prev_results, max_ranks, results, failed, round_no):
    """执行一轮抓取。主循环 round_no=0；补跑轮 round_no>=1 只处理 failed 清单。"""
    pending = tasks if round_no == 0 else list(failed)
    if not pending:
        return
    coros = [fetch_slug(session, sem, slug, max_ranks.get(slug, 0), prev_results.get(slug)) for slug in pending]
    done = 0
    failed.clear()
    for coro in asyncio.as_completed(coros):
        slug, result = await coro
        done += 1
        if result == "ERROR":
            failed.add(slug)
            continue
        if result is not None:
            results[slug] = result
        if done % 300 == 0:
            os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
            if os.environ.get("PRICE_DATA_SECRET"):
                try:
                    import crypto_price as _cp
                    _cp.save_json_encrypt(OUT_PATH, results)
                except Exception:
                    with open(OUT_PATH, "w", encoding="utf-8") as f:
                        json.dump(results, f, ensure_ascii=False, separators=(",", ":"))
            else:
                with open(OUT_PATH, "w", encoding="utf-8") as f:
                    json.dump(results, f, ensure_ascii=False, separators=(",", ":"))
        if done % BATCH_SIZE == 0 and done < len(pending):
            batch_pause = BATCH_PAUSE_MIN + random.random() * (BATCH_PAUSE_MAX - BATCH_PAUSE_MIN)
            await asyncio.sleep(batch_pause)
    print(f"  第{round_no}轮完成：成功 {len(pending) - len(failed)}，失败 {len(failed)}"
          + (f"，补跑剩余 {len(failed)}" if failed else ""))


async def main():
    # 启动随机延迟 0~3min：错开整点请求脉冲，同时不破坏小时节奏
    startup_delay = random.randint(0, STARTUP_JITTER_MAX)
    if startup_delay > 0:
        print(f"启动随机延迟 {startup_delay/60:.1f} 分钟，避免固定时刻脉冲...")
        await asyncio.sleep(startup_delay)

    print("正在获取全量物品列表...")
    async with aiohttp.ClientSession() as session:
        items_data = await _fetch_items(session)

    items  = [it for it in (items_data.get("data") or []) if it.get("slug")]
    slugs  = [it["slug"] for it in items]
    # maxRank>0 才是真正可分级物品（mod/arcane 等）；0 或缺省视为不可分级，不算 avg_zero/avg_max
    max_ranks = {it["slug"]: (it.get("maxRank") or 0) for it in items}
    print(f"共 {len(slugs)} 个物品，并发={CONCURRENCY}，预估 {len(slugs)*(MIN_DELAY+MAX_DELAY)/2/CONCURRENCY/60:.1f} 分钟")

    # 每次运行都全量重新拉取（不复用上次提交的旧文件作为跳过依据）。
    # OUT_PATH 仍会每 300 条落盘一次，仅用于本次运行中途意外中断时的进度保护。
    # 旧文件只用作"这次拉不到卖单/请求失败时"的兜底数据源（见 _apply_stale_fallback）。
    prev_results = {}
    if os.path.exists(OUT_PATH):
        try:
            if os.environ.get("PRICE_DATA_SECRET"):
                import crypto_price as _cp
                v = _cp.load_json(OUT_PATH)
                if v is not None:
                    prev_results = v
                else:
                    with open(OUT_PATH, "r", encoding="utf-8") as f:
                        prev_results = json.load(f) or {}
            else:
                with open(OUT_PATH, "r", encoding="utf-8") as f:
                    prev_results = json.load(f) or {}
        except Exception:
            prev_results = {}

    results = {}
    failed  = set()
    sem     = asyncio.Semaphore(CONCURRENCY)
    t0      = time.time()

    async with aiohttp.ClientSession() as session:
        await run_pass(session, sem, slugs, prev_results, max_ranks, results, failed, 0)
        # 真错误补跑：主循环结束后对失败 slug 反复补跑，防止数据缺口
        for rnd in range(1, RETRY_ROUNDS + 1):
            if not failed:
                break
            await run_pass(session, sem, slugs, prev_results, max_ranks, results, failed, rnd)

    # 补跑仍失败的：用上一次有效数据兜底，避免该物品直接消失（stale 标记）
    for slug in failed:
        prev = prev_results.get(slug)
        if prev and prev.get("avg") is not None:
            carried = dict(prev)
            carried["stale"] = True
            results[slug] = carried
            print(f"  兜底 {slug}：沿用上次均价 (stale)")
        else:
            print(f"  无兜底数据 {slug}：维持无均价")

    elapsed = time.time() - t0
    has_avg = sum(1 for v in results.values() if v.get("avg"))
    print(f"\n完成！均价:{has_avg}  共:{len(results)}/{len(slugs)}  耗时:{elapsed/60:.1f} 分钟")
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    if os.environ.get("PRICE_DATA_SECRET"):
        try:
            import crypto_price as _cp
            _cp.save_json_encrypt(OUT_PATH, results)
            kb = os.path.getsize(OUT_PATH) // 1024
            print(f"已保存(加密) {OUT_PATH}  ({kb} KB)")
        except Exception as e:
            print(f"WARN 加密失败回退明文: {e}")
            with open(OUT_PATH, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, separators=(",", ":"))
            kb = os.path.getsize(OUT_PATH) // 1024
            print(f"已保存 {OUT_PATH}  ({kb} KB)")
    else:
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, separators=(",", ":"))
        kb = os.path.getsize(OUT_PATH) // 1024
        print(f"已保存 {OUT_PATH}  ({kb} KB)")


if __name__ == "__main__":
    asyncio.run(main())
