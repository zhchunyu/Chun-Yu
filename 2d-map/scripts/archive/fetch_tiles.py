# -*- coding: utf-8 -*-
"""
通用 XYZ 瓦片下载器：把指定经纬度范围、指定缩放级别的底图瓦片
抓到本地目录（web/lib/tiles/<名称>/{z}/{x}/{y}.<ext>），供 Leaflet 离线加载。

可断点续传（已存在的瓦片自动跳过），带限速与重试，并按魔数校验真实格式。

用法示例（山农大校园 Esri 卫星影像）：
  python scripts/fetch_tiles.py ^
    --url "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" ^
    --bbox 112.555 37.405 112.605 37.445 ^
    --zooms 14-18 --out web/lib/tiles/satellite

参数：
  --bbox 西 南 东 北   （WGS84 经纬度）
  --zooms 14-18 或 14,16,18
  --ext  auto|jpg|png|webp|gif
         auto（默认）= 按响应内容的魔数自动决定后缀，最省心。
         注意：Esri World_Imagery 返回的是 **JPEG**，不是 PNG。
  --delay 0.12          每片间隔秒，礼貌限速
  --referer             可选，部分服务要求 Referer
注意：
  瓦片影像版权归其提供方（Esri 影像: Esri, Maxar, Earthstar Geographics），
  仅限校内课程项目等非商业用途，请保留前端 attribution，不要公开分发。
"""
import argparse
import math
import os
import sys
import time
import urllib.request

# 魔数 → 后缀
MAGIC = (
    (b"\xff\xd8\xff", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    (b"RIFF", "webp"),          # 还需再看 8..12 字节是否为 WEBP
)

ALL_EXTS = ("jpg", "png", "webp", "gif")


def sniff_ext(data):
    """按魔数返回真实后缀；不是图片则返回 None。"""
    for magic, ext in MAGIC:
        if data.startswith(magic):
            if ext == "webp" and data[8:12] != b"WEBP":
                return None
            return ext
    return None


def lnglat_to_tile(lng, lat, z):
    n = 2 ** z
    x = int((lng + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def parse_zooms(s):
    zs = set()
    for part in s.split(","):
        if "-" in part:
            a, b = part.split("-")
            zs.update(range(int(a), int(b) + 1))
        else:
            zs.add(int(part))
    return sorted(zs)


def existing_tile(d, y, ext):
    """断点续传：返回已存在的瓦片路径（兼容历史 .png/.jpg 混存）。"""
    cands = [f"{y}.{ext}"] if ext != "auto" else [f"{y}.{e}" for e in ALL_EXTS]
    for name in cands:
        p = os.path.join(d, name)
        if os.path.exists(p) and os.path.getsize(p) > 0:
            return p
    return None


def main():
    ap = argparse.ArgumentParser(description="XYZ 瓦片批量下载（断点续传）")
    ap.add_argument("--url", required=True,
                    help="瓦片URL模板，含 {z} {x} {y}")
    ap.add_argument("--bbox", nargs=4, type=float, required=True,
                    metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    ap.add_argument("--zooms", default="14-18", help="如 14-18 或 14,16")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--ext", default="auto", choices=["auto"] + list(ALL_EXTS),
                    help="auto=按魔数自动判定（默认）")
    ap.add_argument("--delay", type=float, default=0.12)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--referer", default=None)
    args = ap.parse_args()

    west, south, east, north = args.bbox
    os.makedirs(args.out, exist_ok=True)

    todo = 0
    done = skip = fail = 0
    for z in parse_zooms(args.zooms):
        x0, y0 = lnglat_to_tile(west, north, z)   # 左上
        x1, y1 = lnglat_to_tile(east, south, z)   # 右下
        n = 2 ** z
        xs = range(max(0, x0), min(n - 1, x1) + 1)
        ys = range(max(0, y0), min(n - 1, y1) + 1)
        for x in xs:
            for y in ys:
                todo += 1
                d = os.path.join(args.out, str(z), str(x))
                if existing_tile(d, y, args.ext):
                    skip += 1
                    continue
                url = args.url.replace("{z}", str(z)).replace("{x}", str(x)) \
                              .replace("{y}", str(y))
                req = urllib.request.Request(url, headers={
                    "User-Agent": "campus-map-tile-fetcher/1.0 (student project; contact: local)"
                })
                if args.referer:
                    req.add_header("Referer", args.referer)
                ok = False
                for attempt in range(1, args.retries + 1):
                    try:
                        with urllib.request.urlopen(req, timeout=20) as r:
                            data = r.read()
                        # 魔数校验：避免把 SSO 跳转页/错误页当成瓦片存下来
                        ext = args.ext if args.ext != "auto" else sniff_ext(data)
                        if ext is None:
                            raise ValueError(
                                f"响应不是图片（前16字节: {data[:16]!r}）")
                        os.makedirs(d, exist_ok=True)
                        with open(os.path.join(d, f"{y}.{ext}"), "wb") as fp:
                            fp.write(data)
                        done += 1
                        ok = True
                        break
                    except Exception as e:
                        if attempt == args.retries:
                            print(f"  失败 z{z}/{x}/{y}: {e}")
                        time.sleep(0.5 * attempt)
                if not ok:
                    fail += 1
                time.sleep(args.delay)
            print(f"z{z}: 进度 x={x - max(0, x0) + 1}/{len(xs)} "
                  f"(完成 {done} 跳过 {skip} 失败 {fail})", flush=True)

    print(f"\n完成: 共 {todo} 片，本次下载 {done}，已有 {skip}，失败 {fail}")
    print(f"输出目录: {os.path.abspath(args.out)}")
    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
