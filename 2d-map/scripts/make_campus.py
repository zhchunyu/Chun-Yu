# -*- coding: utf-8 -*-
"""
把旧的经纬度演示数据转换为**纯平面米坐标**的虚拟校园数据。

为什么需要这个脚本：
  项目早期用的是"真实地理坐标 + QGIS + 影像瓦片"路线。现在校园是**虚拟构建**的，
  不需要任何地理参照，用平面米坐标更简单、更好编辑，也不再需要投影/控制点/QGIS。
  本脚本做一次忠实转换（布局不变），转换完成后 data/campus/*.json 即成为唯一数据源。

坐标约定（虚拟校园通用）：
  单位 = 米；原点 (0,0) = 全部要素的西南角；x 向东、y 向北（常规数学朝向，y 向上）。
  渲染时由 web/geo.js 的 makePlanarProjection() 翻成 SVG 的 y 向下。

用法：
  python scripts/make_campus.py                    # 从 legacy/geo-data-demo/demo 读旧数据
  python scripts/make_campus.py --src legacy/geo-demo --out data/campus
"""
import argparse
import json
import math
import os
import sys

# WGS84 椭球
WGS84_A = 6378137.0
WGS84_F = 1 / 298.257223563
WGS84_E2 = WGS84_F * (2 - WGS84_F)
DEG = math.pi / 180


def curvature_radii(lat_deg):
    """指定纬度处的曲率半径：M=子午圈(南北)，N=卯酉圈(东西)。"""
    phi = lat_deg * DEG
    w = math.sqrt(1 - WGS84_E2 * math.sin(phi) ** 2)
    return WGS84_A * (1 - WGS84_E2) / w ** 3, WGS84_A / w


def iter_coords(geom):
    """遍历任意 GeoJSON 几何里的所有坐标对。"""
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Point":
        yield c
    elif t in ("MultiPoint", "LineString"):
        for p in c:
            yield p
    elif t in ("MultiLineString", "Polygon"):
        for ring in c:
            for p in ring:
                yield p
    elif t == "MultiPolygon":
        for poly in c:
            for ring in poly:
                for p in ring:
                    yield p


def map_geom(geom, fn):
    """对几何内所有坐标应用 fn，返回同类型几何。"""
    def walk(c):
        return [walk(x) for x in c] if isinstance(c[0], list) else fn(c)
    return {"type": geom["type"], "coordinates": walk(geom["coordinates"])}


LAYERS = {
    "buildings": "buildings.geojson",
    "roads": "roads.geojson",
    "footways": "footways.geojson",
    "nodes": "nodes.geojson",
}


def main():
    ap = argparse.ArgumentParser(description="经纬度演示数据 -> 平面米坐标虚拟校园")
    ap.add_argument("--src", default="legacy/geo-data-demo/demo", help="旧数据目录（含 *.geojson）")
    ap.add_argument("--out", default="data/campus", help="输出目录")
    args = ap.parse_args()

    src = {k: os.path.join(args.src, v) for k, v in LAYERS.items()}
    for k, p in src.items():
        if not os.path.exists(p):
            sys.exit(f"错误: 找不到 {p}")

    data = {}
    for k, p in src.items():
        with open(p, encoding="utf-8") as f:
            data[k] = json.load(f)

    # ---- 1. 求全部要素的经纬度包围盒 ----
    lngs, lats = [], []
    for gj in data.values():
        for ft in gj["features"]:
            for c in iter_coords(ft["geometry"]):
                lngs.append(c[0])
                lats.append(c[1])
    min_lng, max_lng = min(lngs), max(lngs)
    min_lat, max_lat = min(lats), max(lats)
    lat_mid = (min_lat + max_lat) / 2

    # ---- 2. 局部等距投影：每度经/纬各多少米（用中心纬度的曲率半径）----
    M, N = curvature_radii(lat_mid)
    kx = N * math.cos(lat_mid * DEG) * DEG
    ky = M * DEG

    def to_xy(lng, lat):
        """-> [x 向东, y 向北]，单位米，原点在西南角。"""
        return [round((lng - min_lng) * kx, 1), round((lat - min_lat) * ky, 1)]

    # ---- 3. 转换并写出 ----
    os.makedirs(args.out, exist_ok=True)
    total_feats = 0
    for name, gj in data.items():
        out = {
            "format": "campus-plan/1",
            "unit": "meter",
            "origin": "原点 (0,0) = 西南角；x 向东、y 向北",
            "layer": name,
            "features": [
                {
                    "type": "Feature",
                    "properties": ft.get("properties") or {},
                    "geometry": map_geom(ft["geometry"], lambda c: to_xy(c[0], c[1])),
                }
                for ft in gj["features"]
            ],
        }
        dst = os.path.join(args.out, f"{name}.json")
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        total_feats += len(out["features"])
        print(f"  {name:<10} {len(out['features']):>3} 个要素 -> {dst}")

    xs = [(max_lng - min_lng) * kx, (max_lat - min_lat) * ky]
    print(f"\n转换完成: {total_feats} 个要素")
    print(f"  投影参数: kx={kx:.1f} m/°经  ky={ky:.1f} m/°纬  (中心纬度 {lat_mid:.5f}°)")
    print(f"  校园范围: {xs[0]:.1f} m (东西) × {xs[1]:.1f} m (南北)")


if __name__ == "__main__":
    main()
