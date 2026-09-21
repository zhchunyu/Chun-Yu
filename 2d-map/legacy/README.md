# legacy/ —— 已退役的旧路线（保留备查，不再维护）

这里放的是项目早期"**真实地理坐标 + QGIS + 影像瓦片 + Leaflet**"路线的产物。
校园改为**虚拟构建**、改用**平面米坐标 + 纯 SVG** 之后，这些东西都不再是主线。

**保留原因**：项目没有 git，删掉就找不回来了。这里只做归档，不保证能跑。

## 目录内容

```
legacy/
├── leaflet-version/          Leaflet 前端（已被 web/ 的纯 SVG 版取代）
│   ├── index.html
│   ├── main.js               图层渲染 + Dijkstra + 点击交互
│   ├── style.css
│   └── lib/leaflet/          本地化的 Leaflet 1.9.4
└── geo-data-demo/            旧的经纬度演示数据
    ├── demo/                 原 data/demo/*.geojson（已转成平面坐标）
    └── control_points.example.csv   仿射标定控制点样例（已无用）
```

## 为什么退役

| 资产 | 退役原因 |
|------|----------|
| 832 片 Esri 影像瓦片 | 二进制，AI 读不了也 diff 不了；虚拟校园不需要影像。**已删除**（9.9 MB，可用 `scripts/archive/fetch_tiles.py` 重下） |
| 两个 `.exe` 启动器 | 二进制黑盒，改一行逻辑要重新打包。**已删除**（18.6 MB），改用根目录的 `.bat` + `scripts/*.py` |
| Leaflet | 外部依赖，行为改不动；方案B 零依赖 |
| QGIS / 仿射变换 | 依赖 GUI 工具，与"AI 驱动开发"冲突 |
| 经纬度坐标 | 虚拟校园不需要地理参照，平面米坐标更简单 |

## 还能用吗

- `leaflet-version/` 的路径引用已经失效（数据目录变了、瓦片已删），**不能直接跑**。
  要看旧实现长什么样可以读代码。
- `geo-data-demo/` 是 `scripts/make_campus.py` 的输入，保留以便重现那次转换。

## 想恢复怎么办

- 瓦片：`python scripts/archive/fetch_tiles.py --help`（脚本还在，改一下 bbox 即可）
- exe：`scripts/archive/build_exe.bat`（会重新打包 `scripts/start_server.py`）
  但**不建议**——exe 正是我们要摆脱的东西。

对应的旧文档在 `docs/archive/`。
