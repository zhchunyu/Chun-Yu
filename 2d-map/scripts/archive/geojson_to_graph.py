# -*- coding: utf-8 -*-
"""
将 QGIS 导出的路网 GeoJSON（线要素）转换为路径算法用的 节点-边 图结构。

输入（均可多个文件/通配符）：
  边文件  LineString/ MultiLineString，属性建议含 name(路名)、type(road/footway)
  节点文件（可选） Point，属性含 id、name

节点确定方式（二选一，自动判断）：
  1) 显式模式：线要素属性带 from/to，且能在节点文件中找到对应 id
  2) 自动吸附模式：取每条线的两端点，按容差吸附到已有节点，否则新建节点
     （QGIS 数字化时打开"捕捉"，端点重合即可被正确吸附）

输出 graph.json：
{
  "meta":  {...},
  "nodes": [{"id","name","lat","lng"}],
  "edges": [{"id","from","to","name","type","weight"(米),"geometry":[[lng,lat],...]}],
  "adjacency": {节点id: [{"to","weight","edge"}]}   # 双向
}

用法：
  python scripts/geojson_to_graph.py --out data/graph.json ^
        data/demo/roads.geojson data/demo/footways.geojson --nodes data/demo/nodes.geojson

可选：
  --snap-tol 3      自动吸附容差（米），默认 3
  --speed 1.2       步行速度 m/s，用于估算通行时间
  --check A,B       校验：计算 A->B 最短路径并打印
仅用标准库；若装了 networkx 会用它复核最短路径（不影响输出）。
"""
import argparse
import glob
import json
import math
import sys
from datetime import datetime

R_EARTH = 6371000.0


def haversine(lng1, lat1, lng2, lat2):
    """两点球面距离（米）。"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def line_length(coords):
    total = 0.0
    for i in range(len(coords) - 1):
        total += haversine(coords[i][0], coords[i][1],
                           coords[i + 1][0], coords[i + 1][1])
    return total


def load_features(patterns):
    feats = []
    for pat in patterns:
        paths = glob.glob(pat)
        if not paths:
            sys.exit(f"错误: 找不到文件 {pat}")
        for p in paths:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            feats.extend(data.get("features", []))
    return feats


def iter_lines(geometry):
    """把 Point/LineString/MultiLineString 统一成若干条 [lng,lat] 序列。"""
    t = geometry.get("type")
    c = geometry.get("coordinates")
    if t == "LineString":
        yield c
    elif t == "MultiLineString":
        for part in c:
            yield part


class GraphBuilder:
    def __init__(self, snap_tol_m):
        self.snap_tol = snap_tol_m
        self.nodes = {}          # id -> {"name","lat","lng"}
        self._by_coord = {}      # (lng,lat)量化 -> id，用于同名坐标去重
        self.edges = []
        self._auto_seq = 0

    def _key(self, lng, lat):
        # 约 0.05 m 精度的量化，用于坐标级去重
        return (round(lng, 6), round(lat, 6))

    def add_named_node(self, nid, name, lng, lat):
        self.nodes[nid] = {"name": name or nid, "lat": lat, "lng": lng}
        self._by_coord[self._key(lng, lat)] = nid
        return nid

    def get_or_create_node(self, lng, lat):
        key = self._key(lng, lat)
        if key in self._by_coord:
            return self._by_coord[key]
        # 容差吸附：找最近已有节点
        best_id, best_d = None, float("inf")
        for nid, n in self.nodes.items():
            d = haversine(lng, lat, n["lng"], n["lat"])
            if d < best_d:
                best_id, best_d = nid, d
        if best_id is not None and best_d <= self.snap_tol:
            self._by_coord[key] = best_id
            return best_id
        self._auto_seq += 1
        nid = f"n{self._auto_seq:03d}"
        self.add_named_node(nid, None, lng, lat)
        return nid

    def add_edge(self, uid, from_id, to_id, name, etype, geometry, props):
        w = line_length(geometry)
        self.edges.append({
            "id": uid,
            "from": from_id,
            "to": to_id,
            "name": name,
            "type": etype,
            "weight": round(w, 2),
            "geometry": geometry,
            "props": {k: v for k, v in props.items()
                      if k not in ("from", "to", "name", "type")},
        })


def dijkstra(adj, start, end):
    import heapq
    dist = {start: 0.0}
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
            if nd < dist.get(v["to"], float("inf")):
                dist[v["to"]] = nd
                prev[v["to"]] = u
                heapq.heappush(pq, (nd, v["to"]))
    if end not in seen and end != start:
        return None, None
    path, u = [end], end
    while u != start:
        u = prev[u]
        path.append(u)
    return path[::-1], dist[end]


def main():
    ap = argparse.ArgumentParser(description="GeoJSON 路网 -> 节点-边图")
    ap.add_argument("edges", nargs="+", help="边 GeoJSON 文件（可多个/通配符）")
    ap.add_argument("--nodes", help="节点 GeoJSON 文件（可选）")
    ap.add_argument("--out", default="data/graph.json", help="输出 graph.json 路径")
    ap.add_argument("--snap-tol", type=float, default=3.0, help="自动吸附容差（米）")
    ap.add_argument("--speed", type=float, default=1.2, help="步行速度 m/s")
    ap.add_argument("--check", help="校验最短路径，如 --check south_gate,W3")
    args = ap.parse_args()

    gb = GraphBuilder(args.snap_tol)

    if args.nodes:
        for f in load_features([args.nodes]):
            g = f["geometry"]
            if g["type"] != "Point":
                continue
            props = f.get("properties") or {}
            lng, lat = g["coordinates"][:2]
            gb.add_named_node(props.get("id"), props.get("name"), lng, lat)
        print(f"载入命名节点 {len(gb.nodes)} 个")

    feats = load_features(args.edges)
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
                fid = gb.get_or_create_node(*geom[0])
                tid = gb.get_or_create_node(*geom[-1])
            gb.add_edge(f"e{i:03d}", fid, tid,
                        props.get("name"), props.get("type", "footway"),
                        [list(c[:2]) for c in geom], props)

    # 邻接表（双向；如需单向可按 props.oneway 过滤）
    adj = {nid: [] for nid in gb.nodes}
    for e in gb.edges:
        adj[e["from"]].append({"to": e["to"], "weight": e["weight"], "edge": e["id"]})
        adj[e["to"]].append({"to": e["from"], "weight": e["weight"], "edge": e["id"]})

    out = {
        "meta": {
            "crs": "EPSG:4326",
            "weight_unit": "meters",
            "walk_speed_mps": args.speed,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "snap_tolerance_m": args.snap_tol,
        },
        "nodes": [{"id": nid, **n} for nid, n in gb.nodes.items()],
        "edges": gb.edges,
        "adjacency": adj,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    total_m = sum(e["weight"] for e in gb.edges)
    print(f"图构建完成: {len(gb.nodes)} 节点 / {len(gb.edges)} 边 / 总长 {total_m:.0f} m")
    print(f"已写出 {args.out}")

    if args.check:
        a, b = args.check.split(",")
        path, dist = dijkstra(adj, a.strip(), b.strip())
        if path is None:
            print(f"校验: {a} -> {b} 不连通")
        else:
            mins = dist / args.speed / 60
            print(f"校验: {' -> '.join(path)}  总长 {dist:.0f} m ≈ {mins:.1f} 分钟步行")

    try:
        import networkx as nx  # 可选复核
        G = nx.Graph()
        for e in gb.edges:
            G.add_edge(e["from"], e["to"], weight=e["weight"])
        if args.check:
            a, b = args.check.split(",")
            w = nx.dijkstra_path_length(G, a.strip(), b.strip())
            print(f"networkx 复核: {w:.0f} m")
        print("networkx 连通性检查: "
              f"{'连通' if nx.is_connected(G) else '警告: 存在孤立分量!'}"
              f"（分量数 {nx.number_connected_components(G)}）")
    except ImportError:
        pass


if __name__ == "__main__":
    main()
