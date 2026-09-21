# 01 · QGIS 数字化工作流

目标：把校园底图（无人机正射影像 / CAD 图 / 学校平面示意图）描摹成四类矢量图层，
导出为 GeoJSON，供后续建图与前端渲染。

## 1. 新建工程与加载底图

1. 打开 QGIS → `工程 → 新建`，先 `工程 → 属性 → 坐标参照系` 设为 **EPSG:4326 (WGS 84)**。
2. 底图三选一：
   - **XYZ 瓦片**（看真实卫星影像做参考）：`浏览器面板 → XYZ Tiles → 新建连接`，
     URL 填 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`（或高德/天地图影像瓦片地址）。
   - **学校平面图图片**：`图层 → 添加栅格图层` 直接加载 PNG/JPG。
     若图片只有像素坐标，先跳到《02-坐标系与仿射变换》做标定，再回来数字化。
   - **CAD 图**：直接把 `.dxf/.dwg` 拖进 QGIS（DWG 需先经 AutoCAD 另存为 DXF）；
     或用 QGIS 自带命令行转换：
     `"C:\Program Files\QGIS 3.44\bin\ogr2ogr.exe" -f GeoJSON out.geojson 校园.dxf`
3. 数字化期间可把底图图层半透明（图层面板不透明度滑条），描摹更准。

## 2. 建立四个矢量图层

`图层 → 创建图层 → 新建 Shapefile/GeoPackage 图层`，几何类型与字段如下
（**字段名必须一致**，下游脚本按字段名读取）：

| 图层 | 几何类型 | 必需字段 | 说明 |
|------|---------|---------|------|
| buildings | 面 (Polygon) | name, type, floors | 教学楼/宿舍/操场…；type: 教学/生活/体育 |
| roads | 线 (LineString) | from, to, name, type | type=road；from/to 填两端节点id（见下） |
| footways | 线 (LineString) | from, to, name, type | type=footway；人行步道、连廊、楼梯口 |
| nodes | 点 (Point) | id, name | 交叉口、建筑出入口、地标 |

> from/to 可以先不填——`geojson_to_graph.py` 支持自动吸附模式（见《03》），
> 但显式填写能让节点命名更有语义（如 `lib_gate` 图书馆南门）。

## 3. 数字化操作要点

1. 选中目标图层 → 图层面板点**铅笔图标**进入编辑模式。
2. **打开捕捉**（磁铁图标，快捷键 S）→ `工程 → 捕捉设置`：
   - 类型选 **顶点和线段**，容差 5~10 px；
   - 打开 **拓扑编辑** 和 **避免线段重叠**——这一步保证相邻路段端点严格重合，
     否则自动建图时路网会"断开"。
3. 面：沿建筑轮廓逐点点击，末点闭合到起点；线：沿道路中心线画；
   转弯处多加点，直线少加点。
4. 每画完一个要素，在弹出的属性表里填字段。
5. 完成后**保存编辑**（铅笔旁的软盘图标）。

## 4. 导出 GeoJSON

1. 图层面板右键图层 → `导出 → 要素另存为…`
2. 格式选 **GeoJSON**，CRS 选 **EPSG:4326**，文件名存到 `data/raw/`
   （如 `data/raw/buildings.geojson`），编码 UTF-8。
3. 四个图层各导出一次。之后运行（见 README 第四节）：

```bash
python scripts/geojson_to_graph.py --out data/graph.json data/raw/roads.geojson data/raw/footways.geojson --nodes data/raw/nodes.geojson
```

## 5. 常见坑

| 现象 | 原因 | 处理 |
|------|------|------|
| 前端路线断断续续 | 线端点没重合，吸附没开 | 开启捕捉/拓扑重画；或加大 `--snap-tol` |
| 地图位置和实际差几百米 | 底图未配准/CRS 不对 | 重做《02》控制点标定；确认导出 CRS=4326 |
| 某些中文乱码 | 导出编码非 UTF-8 | 导出对话框把编码改为 UTF-8 |
| CAD 坐标是本地施工坐标 | CAD 用的是自定义坐标系 | 视为"像素坐标"，走 affine_fit 标定流程 |
