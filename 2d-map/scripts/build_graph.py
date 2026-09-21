# -*- coding: utf-8 -*-
"""
把虚拟校园的平面数据（data/campus/*.json，单位：米）构建成路径算法用的
节点-边图 data/graph.json。

与旧版 geojson_to_graph.py 的区别：
  - 坐标是**平面米**，不是经纬度，所以不再需要 haversine 球面距离（改用欧氏距离）；
  - 节点字段是 x / y，不是 lat / lng；
  - 不依赖任何 GIS 工具链。

输入：
  线要素文件 roads.json / footways.json，属性建议含 from、to、name、type
  节点文件 nodes.json（可选），Point，属性含 id、name

节点确定方式（自动判断）：
  1) 显式模式：线要素带 from/to，且能在节点文件里找到对应 id
  2) 自动吸附模式：取线两端点，按容差吸附到已有节点，否则新建节点

输出 data/graph.json：
{
  "meta": {"format","unit","walk_speed_mps","generated_at","snap_tolerance_m"},
  "nodes": [{"id","name","x","y"}],
  "edges": [{"id","from","to","name","type","weight"(米),"geometry":[[x,y],...]}],
  "adjacency": {节点id: [{"to","weight","edge"}]}      # 双向
}

用法：
  python scripts/build_graph.py --out data/graph.json \
      data/campus/roads.json data/campus/footways.json --nodes data/campus/nodes.json
"""
import argparse
import glob
import json
import math
import os
import sys
from datetime import datetime

DEFAULT_SRC = "data/campus"


def dist(a, b):
    """平面欧氏距离（米）。平面坐标下这就是真实距离，不需要球面公式。"""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def line_length(coords):
    return sum(dist(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def load_features(patterns):
    feats = []
    for pat in patterns:
        paths = glob.glob(pat)
        if not paths:
            sys.exit(f"错误: 找不到文件 {pat}")
        for p in paths:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("unit") not in (None, "meter"):
                sys.exit(f"错误: {p} 的 unit 不是 meter，本脚本只处理平面米坐标")
            feats.extend(data.get("features", []))
    return feats


def iter_lines(geometry):
    """把 LineString / MultiLineString 统一成若干条坐标序列。"""
    t, c = geometry.get("type"), geometry.get("coordinates")
    if t == "LineString":
        yield c
    elif t == "MultiLineString":
        for part in c:
            yield part


class GraphBuilder:
    def __init__(self, snap_tol_m):
        self.snap_tol = snap_tol_m
        self.nodes = {}          # id -> {"name","x","y"}
        self._by_coord = {}      # 量化坐标 -> id
        self.edges = []
        self._auto_seq = 0

    @staticmethod
    def _key(x, y):
        # 0.05 m 精度量化，用于坐标级去重
        return (round(x, 2), round(y, 2))

    def add_named_node(self, nid, name, x, y):
        self.nodes[nid] = {"name": name or nid, "x": x, "y": y}
        self._by_coord[self._key(x, y)] = nid
        return nid

    def get_or_create_node(self, x, y):
        key = self._key(x, y)
        if key in self._by_coord:
            return self._by_coord[key]
        best_id, best_d = None, float("inf")
        for nid, n in self.nodes.items():
            d = math.hypot(x - n["x"], y - n["y"])
            if d < best_d:
                best_id, best_d = nid, d
        if best_id is not None and best_d <= self.snap_tol:
            self._by_coord[key] = best_id
            return best_id
        self._auto_seq += 1
        nid = f"n{self._auto_seq:03d}"
        self.add_named_node(nid, None, x, y)
        return nid

    def add_edge(self, uid, from_id, to_id, name, etype, geometry, props):
        self.edges.append({
            "id": uid,
            "from": from_id,
            "to": to_id,
            "name": name,
            "type": etype,
            "weight": round(line_length(geometry), 2),
            "geometry": geometry,
            "props": {k: v for k, v in props.items()
                      if k not in ("from", "to", "name", "type")},
        })


def dijkstra(adj, start, end):
    import heapq
    dists = {start: 0.0}
    prev = {}
    pq = [(0.0, start)]
    seen = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in seen:
            continue
        seen.add(u)
        if u == end:
            break
        for v in adj.get(u, []):
            nd = d + v["weight"]
            if nd < dists.get(v["to"], float("inf")):
                dists[v["to"]] = nd
                prev[v["to"]] = u
                heapq.heappush(pq, (nd, v["to"]))
    if end not in seen and end != start:
        return None, None
    path, u = [end], end
    while u != start:
        u = prev[u]
        path.append(u)
    return path[::-1], dists[end]


def main():
    ap = argparse.ArgumentParser(description="平面校园数据 -> 节点-边图")
    ap.add_argument("edges", nargs="*", help="线要素文件（默认 data/campus 下的 roads/footways）")
    ap.add_argument("--nodes", help="节点文件（默认 data/campus/nodes.json）")
    ap.add_argument("--out", default="data/graph.json", help="输出 graph.json")
    ap.add_argument("--snap-tol", type=float, default=3.0, help="自动吸附容差（米）")
    ap.add_argument("--speed", type=float, default=1.2, help="步行速度 m/s")
    ap.add_argument("--check", help="校验最短路径，如 --check south_gate,east_jct")
    args = ap.parse_args()

    edge_files = args.edges or [os.path.join(DEFAULT_SRC, "roads.json"),
                                os.path.join(DEFAULT_SRC, "footways.json")]
    node_file = args.nodes or os.path.join(DEFAULT_SRC, "nodes.json")

    gb = GraphBuilder(args.snap_tol)

    if os.path.exists(node_file):
        for f in load_features([node_file]):
            g = f["geometry"]
            if g["type"] != "Point":
                continue
            props = f.get("properties") or {}
            gb.add_named_node(props.get("id"), props.get("name"),
                              g["coordinates"][0], g["coordinates"][1])
        print(f"载入命名节点 {len(gb.nodes)} 个")

    feats = load_features(edge_files)
    print(f"载入线要素 {len(feats)} 条")
    for i, f in enumerate(feats, 1):
        props = f.get("properties") or {}
        for geom in iter_lines(f["geometry"]):
            if len(geom) < 2:
                continue
            p_from, p_to = props.get("from"), props.get("to")
            if p_from and p_to and p_from in gb.nodes and p_to in gb.nodes:
                fid, tid = p_from, p_to
            else:
                fid = gb.get_or_create_node(geom[0][0], geom[0][1])
                tid = gb.get_or_create_node(geom[-1][0], geom[-1][1])
            gb.add_edge(f"e{i:03d}", fid, tid, props.get("name"),
                        props.get("type", "footway"),
                        [[round(c[0], 2), round(c[1], 2)] for c in geom], props)

    adj = {nid: [] for nid in gb.nodes}
    for e in gb.edges:
        adj[e["from"]].append({"to": e["to"], "weight": e["weight"], "edge": e["id"]})
        adj[e["to"]].append({"to": e["from"], "weight": e["weight"], "edge": e["id"]})

    out = {
        "meta": {
            "format": "campus-graph/1",
            "unit": "meter",
            "crs": "local",
            "walk_speed_mps": args.speed,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "snap_tolerance_m": args.snap_tol,
        },
        "nodes": [{"id": nid, **n} for nid, n in gb.nodes.items()],
        "edges": gb.edges,
        "adjacency": adj,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    total_m = sum(e["weight"] for e in gb.edges)
    print(f"图构建完成: {len(gb.nodes)} 节点 / {len(gb.edges)} 边 / 总长 {total_m:.0f} m")
    print(f"已写出 {args.out}")

    # ---- 自检：连通性 ----
    start = next(iter(gb.nodes))
    reach = {start}
    stack = [start]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v["to"] not in reach:
                reach.add(v["to"])
                stack.append(v["to"])
    if len(reach) == len(gb.nodes):
        print(f"连通性自检: 全部 {len(gb.nodes)} 个节点连通 √")
    else:
        missing = set(gb.nodes) - reach
        print(f"连通性自检: 警告！{len(missing)} 个节点不可达: {sorted(missing)}")

    if args.check:
        a, b = (s.strip() for s in args.check.split(","))
        path, d = dijkstra(adj, a, b)
        if path is None:
            print(f"校验: {a} -> {b} 不连通")
        else:
            names = " -> ".join(gb.nodes[n]["name"] for n in path)
            print(f"校验: {names}  总长 {d:.0f} m ≈ {d / args.speed / 60:.1f} 分钟步行")


if __name__ == "__main__":
    main()
