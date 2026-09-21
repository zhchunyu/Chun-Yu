# -*- coding: utf-8 -*-
"""
生成一套演示用校园 GeoJSON 数据（虚构"示例大学"），用于验证整条流水线：
  buildings.geojson  建筑面（QGIS 中对应 buildings 图层）
  roads.geojson      机动车道路段（对应 roads 图层，边带 from/to 属性）
  footways.geojson   人行步道段（对应 footways 图层）
  nodes.geojson      路网节点：交叉口 / 出入口（对应 nodes 图层，带 id、name 属性）

坐标系统一为 WGS84 经纬度（EPSG:4326），符合 GeoJSON 标准。
用法：
  python scripts/make_demo_data.py            # 输出到 data/demo/
  python scripts/make_demo_data.py data/demo  # 指定输出目录
"""
import json
import math
import os
import sys

# 校区中心（当前放在山西农业大学校园中心，WGS84；演示矢量是占位框架，
# 后续用 QGIS 在本地卫星影像上描摹真实校园后替换 data/demo 或 data/raw）
LAT0, LNG0 = 37.4229, 112.5785
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LNG = 111320.0 * math.cos(math.radians(LAT0))


def xy_to_lnglat(x, y):
    """局部平面坐标（米，x向东 y向北） -> WGS84 经纬度。"""
    return [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT]


def feature(geom_type, coords, props):
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": geom_type, "coordinates": coords},
    }


def fc(features):
    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# 节点：id, 中文名, 局部坐标 x(东), y(北) —— 单位米
# ---------------------------------------------------------------------------
NODES = [
    ("south_gate",   "南门",         0,   -220),
    ("cross_main",   "主干道交叉口",  0,    -80),
    ("road_w",       "主干道西端", -260,    -80),
    ("road_e",       "主干道东端",  260,    -80),
    ("A_s",          "教学楼A南路口", -160,  -40),
    ("teachA_gate",  "教学楼A南门", -160,     20),
    ("A_w",          "教学楼A西侧路口", -240,  20),
    ("W1",           "西北路口",    -240,    160),
    ("W2",           "教学楼B南门", -100,    160),
    ("W3",           "图书馆北门",    0,     160),
    ("W4",           "食堂南门",      80,    160),
    ("W5",           "宿舍南门",     160,    160),
    ("W6",           "操场西门",     300,    160),
    ("lib_gate",     "图书馆南门",    0,      20),
    ("lab_gate",     "实验楼南门",   160,     20),
    ("gym_gate",     "体育馆南门",   240,     20),
    ("E1",           "东侧路口",     300,     20),
]

# 边：起点id, 终点id, 路名, 类型(road=机动车道 / footway=人行步道)
EDGES = [
    ("south_gate",  "cross_main", "校园主干道", "road"),
    ("road_w",      "cross_main", "校园主干道", "road"),
    ("cross_main",  "road_e",     "校园主干道", "road"),
    ("cross_main",  "A_s",        "中央步道",   "footway"),
    ("A_s",         "teachA_gate", "教学楼A步道", "footway"),
    ("teachA_gate", "A_w",        "教学楼A西侧步道", "footway"),
    ("A_w",         "W1",         "西侧步道",   "footway"),
    ("cross_main",  "lib_gate",   "图书馆步道", "footway"),
    ("cross_main",  "lab_gate",   "实验楼步道", "footway"),
    ("teachA_gate", "lib_gate",   "南侧步道",   "footway"),
    ("lib_gate",    "lab_gate",   "南侧步道",   "footway"),
    ("lab_gate",    "gym_gate",   "体育馆步道", "footway"),
    ("gym_gate",    "E1",         "东侧步道",   "footway"),
    ("E1",          "W6",         "东侧步道",   "footway"),
    ("W1",          "W2",         "北部步道",   "footway"),
    ("W2",          "W3",         "北部步道",   "footway"),
    ("W3",          "W4",         "北部步道",   "footway"),
    ("W4",          "W5",         "北部步道",   "footway"),
    ("W5",          "W6",         "北部步道",   "footway"),
]

# 建筑面：名称, 类型, 矩形范围 x1,y1,x2,y2（米）
BUILDINGS = [
    ("图书馆",    "教学", (-40, 40, 40, 120)),
    ("教学楼A",   "教学", (-220, 40, -140, 120)),
    ("教学楼B",   "教学", (-140, 190, -60, 250)),
    ("实验楼",    "教学", (120, 40, 200, 120)),
    ("体育馆",    "体育", (200, 40, 280, 120)),
    ("食堂",      "生活", (40, 190, 120, 250)),
    ("宿舍1号楼", "生活", (130, 190, 190, 250)),
    ("宿舍2号楼", "生活", (210, 190, 270, 250)),
    ("操场",      "体育", (330, 40, 430, 220)),
]


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)

    node_pos = {nid: (x, y) for nid, _, x, y in NODES}

    nodes_fc = fc([
        feature("Point", xy_to_lnglat(x, y), {"id": nid, "name": name})
        for nid, name, x, y in NODES
    ])

    def edge_line(nid_from, nid_to):
        x1, y1 = node_pos[nid_from]
        x2, y2 = node_pos[nid_to]
        return [xy_to_lnglat(x1, y1), xy_to_lnglat(x2, y2)]

    roads_fc = fc([
        feature("LineString", edge_line(a, b),
                {"from": a, "to": b, "name": name, "type": typ})
        for a, b, name, typ in EDGES if typ == "road"
    ])

    footways_fc = fc([
        feature("LineString", edge_line(a, b),
                {"from": a, "to": b, "name": name, "type": typ})
        for a, b, name, typ in EDGES if typ == "footway"
    ])

    buildings_fc = fc([
        feature("Polygon", [
            [xy_to_lnglat(x1, y1), xy_to_lnglat(x2, y1),
             xy_to_lnglat(x2, y2), xy_to_lnglat(x1, y2), xy_to_lnglat(x1, y1)]
        ], {"name": name, "type": typ, "floors": 4})
        for name, typ, (x1, y1, x2, y2) in BUILDINGS
    ])

    for fname, data in [
        ("nodes.geojson", nodes_fc),
        ("roads.geojson", roads_fc),
        ("footways.geojson", footways_fc),
        ("buildings.geojson", buildings_fc),
    ]:
        path = os.path.join(out_dir, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        print(f"写入 {path}: {len(data['features'])} 个要素")

    print(f"\n完成。校区中心: lng={LNG0}, lat={LAT0}（WGS84）")
    print("下一步: python scripts/geojson_to_graph.py --out data/graph.json "
          "data/demo/roads.geojson data/demo/footways.geojson --nodes data/demo/nodes.geojson")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join("data", "demo")
    main(out)
