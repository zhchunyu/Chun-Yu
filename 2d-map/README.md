# 虚拟校园 2D 导航地图 · 方案B（纯前端 SVG）

> 面向 **AI 驱动开发** 的校园导航项目：地图是一张 SVG，**零依赖、全文本、可 diff**；
> 校园是**虚拟构建**的，用平面米坐标，不需要 GIS、不需要影像、不需要打包 exe。
> 正确性用一条命令断言（57 项），不需要人眼看图。

## 一、快速开始

| 双击 | 作用 |
|------|------|
| `启动演示.bat` | 启动本地服务并自动打开浏览器 → <http://127.0.0.1:8123/web/> |
| `重建路网.bat` | 改完校园数据后重建 `data/graph.json`，并自动跑一次验证 |
| `自检.bat` | 只跑验证（57 项断言，退出码即结论）——AI 改完代码的回归门禁 |

命令行等价写法：

```bash
python scripts/start_server.py        # 启动服务（用系统 Python 即可）
python scripts/build_graph.py --out data/graph.json --check south_gate,E1
node web/verify.js                    # 57 项断言
```

**依赖**：Python 3.10+（仅标准库）和可选 Node.js。**不需要 pip 安装任何包，也不需要 npm。**

## 二、项目结构

```
26_9_21_2Dmap/
├── README.md
├── 启动演示.bat / 重建路网.bat / 自检.bat     ← 纯 ASCII 的 .bat（不是 exe）
├── data/
│   ├── campus/                ★ 校园源数据（平面米坐标，唯一真源，手改这里）
│   │   ├── buildings.json         建筑面
│   │   ├── roads.json             机动车道
│   │   ├── footways.json          人行步道
│   │   └── nodes.json             路网节点
│   └── graph.json             ← 由 campus/ 生成的路网图（前端消费，不要手改）
├── web/                       ★ 前端（方案B 主线，零依赖）
│   ├── index.html                 页面骨架：一张 <svg> + 6 个图层分组
│   ├── style.css                  全部地图样式（SVG 要素即 DOM，样式即 CSS）
│   ├── geo.js                     纯逻辑层：坐标/多边形/Dijkstra（浏览器/Node 双用）
│   ├── geo.esm.js                 ESM 包装（给 3D 工程的打包器用）
│   ├── app.js                     渲染与交互层
│   └── verify.js                  ★ 57 项自动化断言
├── scripts/
│   ├── start_server.py            静态服务 + 自动开浏览器
│   ├── build_graph.py             campus/*.json → graph.json
│   ├── make_campus.py             一次性坐标转换（已用过，留档）
│   ├── requirements.txt           说明：无需任何第三方包
│   └── archive/                   退役脚本（旧 GeoJSON/仿射/瓦片/exe 打包）
├── docs/
│   ├── README.md                  ★ 文档索引（按角色选阅读路线）
│   ├── 00-新人入门.md              ★ 5 分钟跑起来，新人从这里开始
│   ├── 03-路网与路径算法.md         建图、graph.json 结构、扩展点
│   ├── 05-方案B纯前端SVG路线.md     可行性验证报告与迁移记录
│   ├── 06-虚拟校园数据规范.md       ★ 改数据前必读
│   ├── 07-技术路线与架构.md         为什么这么设计、分层架构、数据流
│   ├── 08-与3D地图对接.md          ★ 2D↔3D 接口契约（3D 同学必读）
│   ├── 09-协作与开发规范.md         git 流程、验证门禁、改动 Checklist
│   └── archive/                   旧 QGIS / 仿射 / 影像采集文档（已退役）
├── legacy/                    旧 Leaflet 版与经纬度演示数据（保留备查，见其 README）
└── .gitignore                 挡住字节码/依赖目录/二进制/系统垃圾
```

## 三、为什么是这套选型

两条约束决定了几乎所有技术决定：

| 约束 | 决定 |
|------|------|
| **用 AI 工具做主要开发** | 源文件必须纯文本、可 diff、可 grep。所以：不用 QGIS（`.qgz` 是二进制）、不打包 exe（黑盒）、不引 Leaflet（外部依赖）、不用影像瓦片（二进制图片） |
| **虚拟构建的校园** | 不需要地理配准、不需要影像底图、不需要投影。所以：直接用**平面米坐标**，彻底摆脱经纬度与 GIS 工具链 |

具体收益：

- **地图就是 DOM**。每个建筑/道路/节点都是真实 SVG 节点，带语义属性：
  ```html
  <polygon class="building" data-name="图书馆" data-type="教学" data-floors="4" .../>
  <g class="route" data-from="south_gate" data-to="E1"
     data-distance-m="468.2" data-nodes="south_gate>cross_main>lib_gate>...">…</g>
  ```
  **路线算得对不对，读属性就知道**，不用数像素。AI 可以 `grep data-name` 找要素、
  改 CSS 调样式、加事件监听——全在它能读写的文本里。
- **算法与渲染分离**。`web/geo.js` 是浏览器/Node 双用，于是正确性可以在命令行断言。
- **零依赖**。整站纯文本，离线可用，没有 `node_modules`、没有 CDN。
- **体积**：整个项目 **0.34 MB**（迁移前含瓦片/exe/.venv 是 94.4 MB）。

## 四、怎么改地图数据

改 `data/campus/*.json`（纯文本，直接编辑），然后：

- 只改**建筑** → 刷新浏览器即可（建筑不参与路由）；
- 改**节点/道路** → 双击 `重建路网.bat` 重建图，再刷新。

字段含义、坐标系约定、常见改动示例（加楼、加路、移动节点）见
**`docs/06-虚拟校园数据规范.md`**。

## 五、验证：57 项断言

```bash
node web/verify.js      # 或双击 自检.bat
```

不需要开浏览器、不需要截图。覆盖：

- 数据格式（`unit=meter`、坐标是 `x/y` 而非 `lat/lng`）
- 图结构自洽（adjacency 引用有效、边双向登记、权重 = 欧氏长度）
- **`graph.json` 与 `data/campus/*.json` 是否同步**（改了数据忘重建图会立刻报错）
- 坐标变换（画布尺寸 = 坐标跨度、北在上、全部落在画布内）
- Dijkstra 正确性（全节点对连通、距离对称、三角不等式）
- 路径几何（首尾与节点坐标对位、几何长度 = 权重）
- 性能（5000 次查询 < 1 秒）
- 前端契约（HTML id ↔ app.js 选择器 ↔ CSS class 一致；无 `lat/lng` 残留）

退出码 0 = 全绿，1 = 有失败项，可直接当 CI 门禁。

## 六、给 AI 协作的约定

1. **改代码后必须跑 `node web/verify.js`**，退出码非 0 就继续修，别改断言。
2. **`data/graph.json` 是派生产物**，永远由 `scripts/build_graph.py` 生成，不要手改。
3. **保持零依赖**。需要新能力时优先手写几十行，而不是引入 npm 包。
4. **`.bat` 文件必须纯 ASCII**。cmd.exe 按字节偏移解析批处理，UTF-8 中文会把
   后面的命令行吃掉（这个坑踩过：`node web\verify.js` 曾被吃成 `e.js`）。
5. **地图要素要带 `data-*` 语义属性**，方便后续用 CSS/grep 定位。
6. 几何/算法逻辑放 `web/geo.js`（纯逻辑，可 Node 断言），
   DOM 操作放 `web/app.js`（不可断言），别混。

## 七、文档索引

**完整索引与按角色推荐的阅读路线见 [`docs/README.md`](docs/README.md)。**

| 文档 | 内容 | 读者 |
|------|------|------|
| `docs/00-新人入门.md` | ★ 5 分钟跑起来、三个核心约定、第一次改动 | **所有人，从这里开始** |
| `docs/06-虚拟校园数据规范.md` | ★ 数据 schema 与改动指南 | 要改数据的人 |
| `docs/08-与3D地图对接.md` | ★ 坐标系契约、引擎转换、锚点表、代码示例 | **3D / 建模同学** |
| `docs/07-技术路线与架构.md` | 选型理由、分层架构、数据流、关键决策 | 想理解设计意图 |
| `docs/09-协作与开发规范.md` | git 流程、验证门禁、改动 Checklist | 第一次提交前 |
| `docs/03-路网与路径算法.md` | 建图、graph.json 结构、算法与扩展点 | 前端 / 算法 |
| `docs/05-方案B纯前端SVG路线.md` | 可行性验证报告、迁移记录 | 想了解历史 |
| `docs/archive/` | QGIS 工作流、仿射变换、影像采集（已退役） | 备查 |
| `legacy/README.md` | 退役资产清单与原因 | 备查 |

## 七·五、多人协作

仓库为**私有仓库**，通过 GitHub 邀请协作者。开始改之前请先读
`docs/09-协作与开发规范.md`，其中最关键的三条：

1. **改完必须跑 `node web/verify.js`**（57 项断言，退出码 0 才提交）；
2. **数据改动和代码改动分开提交**；
3. **`data/graph.json` 是派生产物**，冲突时不要手工合并，直接重建图。

首次推送到 GitHub 的步骤（仅负责人执行一次）见 `docs/09` 第 11 节。

## 八、迁移记录

早期版本走的是"真实地理坐标 + QGIS 数字化 + Esri 影像瓦片 + Leaflet + PyInstaller exe"。
在改为虚拟校园 + AI 驱动开发后，做了如下迁移：

| 项 | 处理 |
|----|------|
| 832 片影像瓦片（9.9 MB） | 删除（虚拟校园不需要；可用 `scripts/archive/fetch_tiles.py` 重下） |
| 两个 exe 启动器（18.6 MB） | 删除，改用 `.bat` + Python 源码 |
| `.venv`（65.6 MB） | 删除（脚本已全部只用标准库） |
| Leaflet 前端 | 移入 `legacy/leaflet-version/` |
| 经纬度演示数据 | 移入 `legacy/geo-data-demo/` |
| QGIS / 仿射文档 | 移入 `docs/archive/` |
| 坐标系统 | 经纬度 → **平面米**（忠实转换，布局不变，见 `scripts/make_campus.py`） |

顺带修掉的两个真 bug：

1. `start_server.py` 用 `urlopen` 探测端口，而某些环境会把"连到无人监听的本地端口"
   静默丢包而不是立即拒绝，导致启动要等 25 秒。已改用原始 socket 探测。
2. 旧投影用"每度 110540 米"的平均常数，在 37.4°N 会把南北向距离低估约 0.4%。
   已改用 WGS84 曲率半径（现仅在备用地理模式中使用）。
