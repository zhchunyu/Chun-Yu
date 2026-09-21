# -*- coding: utf-8 -*-
"""
一键重建路网图 data/graph.json（可打包为 exe 双击运行）。

数据源自动选择：
  1) data/raw/  下有 GeoJSON → 用正式数据（QGIS 导出的成果放这里）
  2) 否则回退 data/demo/     → 用演示数据
节点文件取同目录的 nodes.geojson（若有）。输出 data/graph.json。
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geojson_to_graph  # noqa: E402


def project_root():
    if getattr(sys, "frozen", False):  # PyInstaller 打包后
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pause():
    try:
        if sys.stdin.isatty():
            input("\n按回车键退出...")
    except Exception:
        pass


def main():
    root = project_root()
    os.chdir(root)
    print("工作目录:", root)

    raw = os.path.join(root, "data", "raw")
    demo = os.path.join(root, "data", "demo")
    has_raw = os.path.isdir(raw) and any(
        f.endswith(".geojson") for f in os.listdir(raw))
    src = raw if has_raw else demo
    print("数据源:", "正式数据 data/raw" if has_raw
          else "演示数据 data/demo（data/raw 里还没有 GeoJSON）")

    all_geo = sorted(f for f in os.listdir(src) if f.endswith(".geojson"))
    nodes = os.path.join(src, "nodes.geojson")
    edge_files = [os.path.join(src, f) for f in all_geo
                  if f != "nodes.geojson"]
    if not edge_files:
        print("错误: 数据目录里没有任何线要素 GeoJSON")
        pause()
        return

    argv = ["geojson_to_graph.py",
            "--out", os.path.join(root, "data", "graph.json"),
            *edge_files]
    if os.path.exists(nodes):
        argv += ["--nodes", nodes]
    if not has_raw:  # 演示数据固定做一次最短路自检
        argv += ["--check", "south_gate,W3"]

    sys.argv = argv
    try:
        geojson_to_graph.main()
        print("\n√ data/graph.json 已更新，刷新浏览器即可看到新数据")
    except SystemExit:
        # geojson_to_graph 内部 argparse 的正常退出
        pass
    except Exception:
        traceback.print_exc()
    finally:
        pause()


if __name__ == "__main__":
    main()
