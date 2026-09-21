# -*- coding: utf-8 -*-
"""
仿射变换标定工具：建立 底图像素坐标 -> WGS84经纬度 的映射。

原理（对应方案 3.1 第 2 步）：在校园底图上选取 ≥4 个控制点，同时记录
  - 底图上的像素坐标 (px, py)
  - 实地 GPS/手机定位的经纬度 (lon, lat)
用最小二乘拟合六参数仿射变换：
  lon = a0 + a1*px + a2*py
  lat = b0 + b1*px + b2*py
并给出每个控制点的残差和 RMSE，用于评估底图变形。

控制点 CSV 格式（UTF-8，首行表头）：
  pixel_x,pixel_y,lon,lat
  120,340,116.31021,39.97153
  ...

用法：
  标定（查看精度）:
    python scripts/affine_fit.py data/control_points.csv
  标定并把像素坐标的 GeoJSON 转成经纬度:
    python scripts/affine_fit.py data/control_points.csv --apply in_pixel.geojson out_wgs84.geojson
  输出参数 JSON 供其他脚本复用:
    python scripts/affine_fit.py data/control_points.csv --save data/affine.json

仅用标准库实现（正规方程 + 高斯消元）。
"""
import argparse
import csv
import json
import math
import sys


def solve(A, b):
    """高斯消元解线性方程组 A x = b（n<=8 足够）。"""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            sys.exit("矩阵奇异：控制点退化（可能共线），请增加/分散控制点")
        M[col], M[piv] = M[piv], M[col]
        for r in range(n):
            if r == col:
                continue
            f = M[r][col] / M[col][col]
            for c in range(col, n + 1):
                M[r][c] -= f * M[col][c]
    return [M[i][n] / M[i][i] for i in range(n)]


def fit_affine(points):
    """points: [(px,py,lon,lat)] -> (a0,a1,a2,b0,b1,b2)。最小二乘正规方程。"""
    if len(points) < 3:
        sys.exit("至少需要 3 个控制点，建议 4 个以上并分布在图幅四角")
    # 两个独立的最小二乘（lon、lat 各 3 参数），共享设计矩阵
    n = len(points)
    A = [[1.0, p[0], p[1]] for p in points]
    AtA = [[sum(A[r][i] * A[r][j] for r in range(n)) for j in range(3)] for i in range(3)]
    At_lon = [sum(A[r][i] * p[2] for r, p in enumerate(points)) for i in range(3)]
    At_lat = [sum(A[r][i] * p[3] for r, p in enumerate(points)) for i in range(3)]
    a = solve([row[:] for row in AtA], At_lon)
    b = solve([row[:] for row in AtA], At_lat)
    return a + b


def apply_affine(params, px, py):
    a0, a1, a2, b0, b1, b2 = params
    return a0 + a1 * px + a2 * py, b0 + b1 * px + b2 * py


def report(points, params):
    print("仿射变换参数:")
    a0, a1, a2, b0, b1, b2 = params
    print(f"  lon = {a0:.8f} + {a1:.6e}*px + {a2:.6e}*py")
    print(f"  lat = {b0:.8f} + {b1:.6e}*px + {b2:.6e}*py")
    print("\n控制点残差（预测 - 实测）:")
    sq = 0.0
    for px, py, lon, lat in points:
        rlon, rlat = apply_affine(params, px, py)
        dlon = (rlon - lon) * math.cos(math.radians(lat)) * 111320.0
        dlat = (rlat - lat) * 111320.0
        d = math.hypot(dlon, dlat)
        sq += d * d
        print(f"  像素({px:7.1f},{py:7.1f})  误差 {d:7.2f} m")
    rmse = math.sqrt(sq / len(points))
    print(f"\nRMSE = {rmse:.2f} m  （>3~5 m 建议增加控制点或检查底图变形）")
    return rmse


def apply_to_geojson(params, src, dst):
    with open(src, encoding="utf-8") as f:
        data = json.load(f)

    def conv(coords):
        if isinstance(coords[0], (int, float)):
            lon, lat = apply_affine(params, coords[0], coords[1])
            return [round(lon, 7), round(lat, 7)]
        return [conv(c) for c in coords]

    def walk(g):
        g["coordinates"] = conv(g["coordinates"])

    feats = data.get("features", [])
    for f in feats:
        walk(f["geometry"])
    if data.get("geometry"):
        walk(data["geometry"])
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"已转换 {len(feats)} 个要素 -> {dst}（坐标已转为 WGS84 经纬度）")


def main():
    ap = argparse.ArgumentParser(description="像素->经纬度 仿射变换标定")
    ap.add_argument("control_points", help="控制点 CSV：pixel_x,pixel_y,lon,lat")
    ap.add_argument("--apply", nargs=2, metavar=("IN.geojson", "OUT.geojson"),
                    help="把像素坐标 GeoJSON 转为经纬度")
    ap.add_argument("--save", help="把参数保存为 JSON")
    args = ap.parse_args()

    points = []
    with open(args.control_points, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            points.append((float(row["pixel_x"]), float(row["pixel_y"]),
                           float(row["lon"]), float(row["lat"])))
    print(f"读取控制点 {len(points)} 个\n")

    params = fit_affine(points)
    report(points, params)

    if args.save:
        with open(args.save, "w", encoding="utf-8") as f:
            json.dump({"params": params, "note": "lon=a0+a1*px+a2*py; lat=b0+b1*px+b2*py"},
                      f, ensure_ascii=False, indent=1)
        print(f"参数已保存 -> {args.save}")
    if args.apply:
        apply_to_geojson(params, args.apply[0], args.apply[1])


if __name__ == "__main__":
    main()
