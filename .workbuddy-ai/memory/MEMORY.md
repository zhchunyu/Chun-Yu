# 项目长期记忆 —— 春雨工作区

> ★ **本文件只是索引。** 几何坑 / 构件签名 / **完整 28 条铁律** / R0~R6 参数速查 / 静默失效陷阱完整版
> —— 全在 skill **`blender-socket-modeling`**。过程细节在 `.workbuddy-ai/memory/YYYY-MM-DD.md`。
> **动手做 Blender 相关的事之前，先加载那个 skill。**

## 0 合规红线（不可违反）
- 对外材料（方案/视频/PPT）**禁止出现学校名称、Logo、指导教师**；**全项目不出现任何题字**（匾额留空白石板）
- 视频 3-5 min；方案 PDF ≤10MB；网盘链接须永久有效

## 1 身份与节奏
- 第八届全球校园 AI 算法精英大赛 · AI+软件创新赛道（赛题 2）；产品 = 面向 C 端的未来校园社区软件
- 工作区 `...\Desktop\全国人工智能精英算法大赛\春雨工作区`；**我只负责建模层面**
- ★★ **汇报节奏（硬要求）**：每完成一阶段即停下汇报，确认后再进下一阶段；**不擅自批量破坏性动作**

## 2 当前状态（R0~R7 走完；已上线）
- 成图 `renders/` **63 张**；最新 = 配色 V2.4 + 占位体块压暗
- GLB `exports/山河大学_全园_R6.glb`：4.62 MB / 1,118,087 面 / 42 材质 / **Draco 必需**
- 交付层 `02-三维资产/建模图集/`（桌面打印版 + **单文件手机版** 1.9 MB base64 内嵌 + `选图清单.md`）
  ★ **总览 = 对照页（内部，讲改了什么）／图集 = 陈列页（对外，讲设计是什么）**
- ★★ **HTML 交付物必须自包含**：相对路径 + 中文文件名 = 换设备就缺图（已实测手机全裂）
- **GitHub 推送 + 公网部署已完成**（见 §3）；下一步 = `06-竞赛材料` 的方案 PDF / 视频 / PPT 正文（守 §0）

## 3 环境与网络（★ 2026-09-21 实测修正）
- **无头渲染一律用便携版** `C:/Users/31967/Blender/blender-4.5.9-windows-x64/blender.exe`（MSIX 5.2.2 不能命令行调用）
- Python `.../python/versions/3.13.12/python.exe`；图像处理用 `.../envs/default`（有 PIL / requests）
- ★★ **网络经代理 `127.0.0.1:54639`**：`github.com:443` **CONNECT 返 502 ⇒ `git push` 走不通**；
  **`api.github.com` 可达** ⇒ 推仓库改走 **Git Data API**（`tools/push_via_api.py`：blobs→tree→commit→ref）
- 可达 api.github.com · codeload · objects/uploads.githubusercontent · pypi · npmjs · 清华镜像
- ★ **公网部署用 `workbuddy_sites_deploy`**（静态站传 `02-三维资产/site/`，带 `userAskedToPublish:true`）
- MCP `~/.workbuddy-ai/mcp.json` → `blender`（桥接 `blender_bridge.py`:9876）

## 4 管线（完整版见 skill）
`BR_CFG_FILE=<json> blender.exe --background --factory-startup --python scripts/run_campus.py`
- `build_campus_site.py` → `build_extra[]`（`stage1→2→3→r0→…→rN→palette_retune.py`，**重标恒为末项**）
  → 存 `.blend` → 渲染 → **导出 GLB**（导出排最后：压平/抽稀是破坏性的）
- ★ **唯一真源 `configs/_src/rN_final.json`** → `make_render_configs.py` → `configs/rN.json`
- ★ **成图目录只能用 `BR_RENDER_DIR` 改**；三档 800×450/24 → 960×540/32 → 1600×900/110；**渲染确定性可复现**

## 5 静默失效六条（不记住就白干；详情见 skill）
1. **变量名 ≠ 材质名**：`bpy.data.materials.get('M_CONC')` **静默返回 None** —— 一律用**中文名**
2. **`set_in()` 前先问插槽是否被连线**：连线优先，写 `default_value` 无效（53 材质中 32 中招）
3. **`make_mat` 按名字缓存**：同名第二次调用的色值被静默忽略 → 色值只在**第一次定义它的阶段**写
4. **各阶段成图必须用"它自己的 config 链"渲**；查漏靠 `check_ab.py` **最大差**（≤50 配色 / **200+ 几何不一致**）
5. **`Haze` 体域会污染 GLB**（导出端已剔除、渲染端已加守卫）
6. **占位体块 `M_体块_*` 最容易漏出画面**：判据"**比清水混凝土略暗**"（现 0.254~0.324）
- 工具：`check_ab.py` · `make_ab_configs.py` · `check_palette.py`（**必须分上下半图**）· `check_palette_batch.py` ·
  `_diag_mats.py`/`_diag_blk.py`/`_diag_scene.py` · `diag_grid.py` · `make_site.py` · `push_via_api.py`

## 6 前端 3D 验证
- 无 agent-browser → **Edge 无头渲染替代**，见 skill `spa-webgl-page-inspector`
- ★ **`--virtual-time-budget` 不作用于 Web Worker** ⇒ 等 Draco 的页面永远停在遮罩
- ★ **判断窄屏版式必须用 Playwright 量 `scrollWidth`**；Edge `--screenshot` 会在较宽视口渲染再裁切（会误判）
- ★ `--screenshot` 输出路径**不能带中文**（写 `%TEMP%` 再 Read）；three.js 坐标 `(x,y,z)→(x,z,−y)`

---

# 山河大学（主线）

## 7 设定与路线
- **完全虚构校园**；设计以 `01-产品设计/` 为准（`设计任务书.md` D1~D10 / `设计方案修订纲要V2.md` / `总平面格局图.svg`）
- ★ 几何：**1 SVG px = 2.4 m**；原点 = 主校门 `(340,516)`；`W(sx,sy)=((sx−340)*2.4,(516−sy)*2.4)`；
  **X 东 / Y 北 / Z 上**；`Z_TOP 3.0` / 水面 `0.0` / `Z_BANK −3.4`；场地 X[−816,816] Y[0,1238]
- 命名 `BLD_<分区>_<Name>` / `SITE_*` / `ANCHOR_*`（**中轴节点 Y 全表见 skill**）
- 路线 R0 语言样板 → R1 山门+智谷 → R2 图书馆+讲堂 → R3 人文区 → R4 环廊 → R5 五区 → R6 滨水 → **R7 整合/预览/GLB**
- 三条跨阶段硬约束：①"取消"类构件提前到最早重做该区域的阶段拆除 ②清障只删 V2 已定"拆除/取消"的
  ③"改造"类保留旧版作"改造前"语境；实现走 `make_render_configs.py` 的 `STAGE_EXTRA`（**改生成器，不改阶段脚本**）
- 归档在 `08-交付与归档/`；总览页栏数按"有没有可对照的上一版"分档，硬凑两栏会写出 **404 的 img**

## 8 最高频铁律（完整 28 条在 skill）
1. 场地曲面 `flush(up=True)`；总平面显式 `cam_rot:[0,0,0]` + `sun_elev 27°`
2. 坡屋面薄壳：手推法线 + `cap_hole=True`；`roof_ring` 的 `z_in` 严格 > `z_out`（写反→倒坡）
3. **"盒子扣壳"一定读成机库 —— 缺的不是曲面，是檐**；**大面镜墙这个想法本身是错的**
4. **大面积单一平面必须给它结构**（楼板底加肋）；**错位堆叠必须"每层自成完整的盒"**
5. ★ **"某块太重/太黑"先量体量再谈颜色**（多数"太黑"其实是"太厚"）；**改配色后先 A/B 量化再全量重渲**
6. **地形是零厚度平面**：下挖要"挖洞 + 端头封头 + 查隐形盖板"
7. 其余（"取消"类拆除时机 / `layered()` / 下弦起拱 / `skirt_ring` 方向 / 悬空件诊断三步 /
   同一 list 不能 emit 两次 / 铺装带不重叠 / 轴视近景保塔冠塔基）**见 skill**
