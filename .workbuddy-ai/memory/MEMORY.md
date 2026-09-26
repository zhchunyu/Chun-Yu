# 项目长期记忆 —— 春雨工作区

> ★ **本文件只是索引。** 几何坑 / 构件签名 / **完整 28 条铁律** / R0~R6 参数速查 / 静默失效完整版
> —— 全在 skill **`blender-socket-modeling`**。过程细节在 `.workbuddy-ai/memory/YYYY-MM-DD.md`。
> **动手做 Blender 相关的事之前，先加载那个 skill。**

## 0 合规红线（不可违反）
- 对外材料（方案/视频/PPT）**禁止出现学校名称、Logo、指导教师**；**全项目不出现任何题字**（匾额留空白石板）
- 视频 3-5 min；方案 PDF ≤10MB；网盘链接须永久有效

## 1 身份与节奏
- 第八届全球校园 AI 算法精英大赛 · AI+软件创新赛道（赛题 2）；产品 = 面向 C 端的未来校园社区软件
- 工作区 `...\Desktop\全国人工智能精英算法大赛\春雨工作区`；**我只负责建模层面**
- ★★ **汇报节奏（硬要求）**：每完成一阶段即停下汇报，确认后再进下一阶段；**不擅自批量破坏性动作**

## 2 当前状态（依据 `02-三维资产/规划调整方案V3.md`，执行偏差见其 §7）

| 阶段 | 内容 | 状态 |
|---|---|---|
| S1 | 建筑间距 / 分区扩地 | ✅ 生活区岸线太窄无法扩地 → 改缩楼体（**待向用户说明**） |
| S2 | 路网重构（补路/断头路/环廊重排） | ✅ 36 轮迭代，判据「路网穿楼相交面积 = 0」 |
| S3 | 环廊垂直交通 | ✅ 2026-09-25 |
| S4 | 立面格构 / 分区景观 / 屋面分色 / 缓丘 | ✅ a·b·c·d 全完成 |
| S5 | 全量重渲 + 重导 GLB + 站点重部署 | **✅ 全部完成**（71 张重渲 / GLB 重导 / 站点已上线 / 三路验证通过） |

**成图 `renders/` 71 张**（R0~R6 各 7/8/8/9/11/12/16 + R7 8 张 = 71；70 张 1600×900，`R0_垂直书院_正立面` 1000×1600）

- **S4-a 立面**：`build_campus_r5.py:solid_body()` 横条纹 → **实墙 + 竖向格构 + 竖长窗**；`gy/gx` 2.770→0.562。
  A/B `BR_R5_LANG=0`。★ **V3 §3.1 点名的 `fin_facade()` 是错的** —— 横条纹来源全在 `solid_body()`。
- **S4-b/c 景观**：`build_campus_r7_landscape.py`（挂 `_entrance_all.py` 后、`palette_retune.py` 前）；
  占用栅格 + 白名单 + 最大矩形抠图。硬质占分区地面 **100%→43.3%**、绿地占陆地 31.92%→**41.77%**、
  `pave` 24.92%→**14.13%**、`tree` 1.58%→**2.50%**；面数 +18.8%、对象 +8、材质不变。
  **未做**：浅凹 −0.8 m（地形零厚度 ⇒ 不可实现）、生活区 +1.5 m 台地（会埋掉 R5/R6 落位基准）。
- **S3 垂直交通**：站点 **15 处**（V3 写的 13 是错的）、最大间距 121 m；**15 处 = 开敞双跑楼梯 11（顺桥向）
  + 1:12 坡道 2 + 电梯塔 2**；侵入建筑 0.00 m²、树 0/15。
- **S4-d 屋面**：`palette_retune.py` V2.5→**V2.6**。★★ 修掉**静默失效**：工程里有**两个**"钛锌"材质 ——
  `M_钛锌屋面板`（r0，1 对象）与 **`M_钛锌板`**（r1 起重绑全局 `M_ZINC`，**32 对象**）；旧 `_RETUNE` 只写前者
  ⇒ 整个第五立面**从未被重标**。修法：按对象 `copy()` 成 `_暖灰`(25)+`_铜绿`(7)，原材质搬空并登记 `_ROOF_DEAD`。
  色值 暖灰 (0.155,0.136,0.112)/铜绿 (0.085,0.172,0.144)，粗度 0.78/金属度 0.10。屋面 `B>R` **71~78%→41~44%**。
  A/B `BR_ROOF_V2=1`。★ 顺带修 `make_overview_html.py` 材质色板**硬编码全错** ⇒ 改读 `renders/材质色板.json`。
- **S5 重渲 + 重导**：`CAMPUS_TAIL` 把 `_entrance_all.py` + `build_campus_r7_landscape.py` 提到**所有阶段**
  （否则图集割裂：R0~R4 无门廊、R5/R6 有）；`_teach_detail.py` 只留 r5/r6；`EXPORT_STAGE='r6'`、
  GLB = **`山河大学_全园_R7.glb`**。链长 r0(9)/r1(9)/r2(10)/r3(11)/r4(12)/r5(14)/r6(15)。
  71 张全量重渲（exit=0）；GLB **5.70 MB / 1 536 071 面**（导出前 2 317 949 面 / 393 对象 / 72 材质），
  清未引用材质 7 个、剔 `Haze`、压平 38 个 ColorRamp，已同步 `web-demo/assets/campus.glb`。
  配色体检（下半图）：暖% 21.75→25.12、冷% 37.76→36.73、「**冷−暖」+16.01 → +11.61**；过曝 7.30% → **7.01%**。
- 归档：`99-临时工作区/{视觉分型验证,分区景观验证,垂直交通验证,屋面配色验证}/`

- 交付层 `02-三维资产/建模图集/`（桌面打印版 + **单文件手机版** base64 内嵌 + `选图清单.md`）
  ★ **总览 = 对照页（内部，讲改了什么）／图集 = 陈列页（对外，讲设计是什么）**
- ★ **视觉叙事方案**（09-24）：`02-三维资产/视觉叙事方案.md`，主轴 R0~R6 → **四幕：命题/转译/序列/栖居**。
  **人眼机位 = `Z 4.6`**（`Z_TOP 3.0` + 眼高 1.6）—— 统计机位高度必须用此基准
- ★★ **HTML 交付物必须自包含**（相对路径 + 中文文件名 = 换设备就缺图，实测手机全裂）
- ★ **远程仓库** `https://github.com/zhchunyu/Chun-Yu`（**private**），交付分支 **`main`**（旧分支 `feat/2d-map-initial`）；
  `.blend` 走 Release（tag **`blend-projects`**）
- ★ **公网地址**（2026-09-26 重发）：`https://304afd6c537946b7bb81d0b073ba65ff.sg2.agentos-app.run`；
  **旧链接 `https://2cb735b0c4814c359bab62cc039d9c7a.sg2.agentos-app.run` 仍然 200 且内容逐字节相同**
  （同一沙箱的两个别名）⇒ 修正旧结论："同目录重发链接不变"应为**旧链接不失效、但工具可能回一个新别名**。
- ★★ **判"页面里的图是不是断了"不能只看 `naturalWidth`**：`loading="lazy"` 的图**没进视口就不发请求**，
  `naturalWidth=0` 但**没有任何 4xx**。⇒ 破图判据 = **请求已发出且状态 ≥400 / 解码失败**；
  自检前要**滚到底反复几次**触发懒加载。
- ★★ **WebGL canvas 的 `drawImage` 采样恒为 0**（默认 `preserveDrawingBuffer:false`，读的是空缓冲）
  ⇒ 判"3D 有没有出图"要用**页面自己的就绪标志**（本工程 = `window.__preview().ready`；
  `__ready` 是模块内变量、**不在 window 上**）或**真截图**，别读 canvas。
- ★ **`make_overview_html.py` 要跑 ~2 min**（71 张逐像素统计）⇒ 超前台 120 s 被 SIGTERM；
  Python stdout 块缓冲 ⇒ **exit 1 + 零输出**，看起来像崩了。**一律后台跑**。
- ★★ **站点入口一律用公网链接，不要双击 `site/index.html`**：`preview.html` 用 `<script type="module">`，
  ES module 受严格 CORS 检查，`file://` 的 origin 是 `null` ⇒ 脚本被拒 ⇒ 3D 遮罩永远停在「连接中…」。
  已加**经典脚本守卫** + `site/serve.cmd`（本地 `http://localhost:8123`）。
  ★ **`site/` 是产物**，补丁打在 `web-demo/preview.html` / `web-demo/src/preview.js` / `tools/make_site.py`。
- 下一步 = `06-竞赛材料` 的方案 PDF / 视频 / PPT 正文（守 §0）

## 3 环境与网络
- **无头渲染一律用便携版** `C:/Users/31967/Blender/blender-4.5.9-windows-x64/blender.exe`（MSIX 5.2.2 不能命令行调用）
- Blender 脚本用 `.../python/versions/3.13.12/python.exe`（无 PIL）；图像处理用 `.../envs/default/Scripts/python.exe`（有 PIL/requests，无 numpy）
- ★★ **网络经代理**：`github.com:443` CONNECT 返 **502 ⇒ `git push` 走不通**；**`api.github.com` 可达**
  ⇒ 推仓库走 **Git Data API**（`tools/push_via_api.py`：blobs→tree→commit→ref）。
  ★ **代理端口每次会话都会变** ⇒ 不当常量；判断"是不是代理问题"要**直连对照**（`curl` 不带 `-x` 再试）。
- 可达 api.github.com · codeload · objects/uploads.githubusercontent · pypi · npmjs · 清华镜像
- ★ **公网部署用 `workbuddy_sites_deploy`**（静态站传 `02-三维资产/site/`，带 `userAskedToPublish:true`）
- MCP `~/.workbuddy-ai/mcp.json` → `blender`（桥接 `blender_bridge.py`:9876）

## 4 管线
`BR_CFG_FILE=<json> blender.exe --background --factory-startup --python scripts/run_campus.py`

`build_campus_site.py` → `build_extra[]`：
`stage1→2→3→r0→…→r6→_trees_hero→_teach_detail→_entrance_all→`**`build_campus_r7_landscape`**`→palette_retune.py`
（**配色重标恒为末项**）→ 存 `.blend` → 渲染 → **导出 GLB**（最后：压平/抽稀是破坏性的）

- ★ **唯一真源 `configs/_src/rN_final.json`** → `make_render_configs.py` → `configs/rN.json`
- ★ **多阶段共享同一个 globals**（`run(path, extra)` 把 `g` 一路传下去），后跑阶段**覆盖同名全局变量**
  ⇒ 跨脚本传数据惯例：`RING_LOOP / RING_STATIONS / ring_at()`、`ENT_LIST`、`STATION_LIST`。
  ★ 但**定义只许有一处** —— 两处各算一份 = 定时炸弹
- ★ **成图目录只能用 `BR_RENDER_DIR` 改**；三档 800×450/24 → 960×540/32 → 1600×900/110；渲染确定性可复现

## 5 静默失效（每条都"不报错"；详情与代码见 skill）
1. **变量名 ≠ 材质名**：一律用**中文名**（`M_CONC` 静默返回 None）
2. **`set_in()` 前先问插槽是否被连线**（53 材质中 32 中招）
3. **`make_mat` 按名字缓存** ⇒ 色值只在**第一次定义它的阶段**写
4. **各阶段成图必须用"它自己的 config 链"渲**；查漏靠 `check_ab.py` 最大差（≤50 配色 / 200+ 几何）
5. **`Haze` 体域会污染 GLB**（导出端已剔除）
6. **占位体块 `M_体块_*` 最容易漏出画面**：判据"比清水混凝土略暗"（0.254~0.324）
7. ★★ **摆件落位要做成"量出来的"**：占用栅格 + 白名单 + **最大矩形（直方图+单调栈）**反复抠
   （别用"从四边内缩"，障碍在中间时缩不动）。**栅格步长必须小于最窄自由条带**（1.0 m）。
   配 `_cover_area()` 分清"本来没地"还是"被 margin 吃掉"
8. ★★ **`emit_to()`/`new_obj()` 是"新建对象"不是"替换"**（同名再调得 `.001`）⇒ 几何先进登记表 `_REG`，
   最后**统一落地一次**（几百株树 → 8 个对象）
9. ★★ **验收判据会"自己把成果吃掉"**（命中树冠归成硬质 ⇒ 刚种完的草坪反而变"硬"）
   ⇒ 判地面要**两级射线**（高空判建筑 / 低空 `Z_TOP+1.4` 判地面）。被迫的：树冠底 ~1.5 m、灌木顶 ~1.82 m
10. **同位置叠两层薄板 = 共面 ⇒ Cycles 花斑**（草地色斑抬 2 cm）
11. **"两处各自取同一个中心"必然打架**（水景与缓丘都取最大草坪正中 ⇒ 山堆在池子里）
    ⇒ 池子登记表 + `_in_pool()`，水池落位**提前**到铺草种树之前
12. ★ **射线量具三坑**：① 起点别放天上（先命中**自家出檐**），从"目标构件半高"起；
    ② 水平射线要**穿透**非 `BLD_` 与非本簇命中；③ 基准面用**实测值**不能用 `Z_TOP`（带台基的楼）。
    ★ 通用教训：**"量出来的值"和"用这个值的时候"必须是同一个基准**
13. ★ **`depsgraph` 必须在"建完模型之后"再取**（顶部取 ⇒ 空场景、`ray_cast` 全 `ok=False` **且不报错**）
14. ★ **同一张表不要在两处各算一份**（打印数字还能一致；口径一漂就出"树长在楼梯里"）
15. ★★ **"横条纹/竖条纹"可量化**：一阶差分 `|gx|`/`|gy|`，`gy/gx > 1` = 横条纹。PIL 即可（**不需要 numpy**）
16. ★★ **"某块太重/太黑/太条纹"先量是哪支脚本挂的**（`_diag_r5band.py` 逐**面**判）。★ **逐对象判没用**
    —— `flush()` 把同材质几百个盒子并进同一对象，对象级包围盒必然是"整栋楼"
17. ★★ **改材质前先数用户数**：材质**不记录**"谁在用我"，`users` 只是计数；漏写一个名字 = 整批没改**且不报错**
18. ★★ **换色相时不要顺手改明度**：`metallic` 一降，同一 albedo 的成图亮度**自己往上跑** ⇒ 明度对齐旧值、只换色相
19. ★★ **"分区上色"只能拆材质**（对象级共享资源）：按对象 `copy()` 再改槽位；改前查 `ob.data.users > 1`；
    搬空的原材质**必须登记白名单**
20. ★ **"过曝率"抓不到"镜面屋面"**（metallic 0.42 但过曝 0.00% —— 它只是**反射了蓝天**）
    ⇒ 用 **`B>R` 占比**。★ 反过来：**铜绿本来就 `B>R`**，必须同时看均色三通道走向
21. ★★ **脚本要用什么就自己带**：`_entrance_all.py` 提到全阶段后连环炸 —— `put()`/`flush()` 只在
    `build_campus_r5.py` 定义，且 **`flush` 同名不同义**（`build_campus_site.py:638` 的
    `flush(name, mat, coll_target,…)` vs `build_campus_r5.py:177` 的 `flush(B, prefix, coll=C_BLD)`）。
    ⇒ **同名不同义的函数不该靠"谁后跑谁生效"区分**；提范围前先做**最短链试跑**
22. ★ **日志坑**：`grep -c "渲染完成:"` 在含 `\r` 的日志上返 0 ⇒ 用 Python `io.open(...).read().count(...)`

**工具**：`check_ab.py` · `make_ab_configs.py` · `check_palette.py`（**必须分上下半图**）· `check_palette_batch.py`
（★ `--step N` 的 value 不能被当成目录）· `_diag_mats/blk/scene.py` · `diag_grid.py` · `make_site.py` ·
`push_via_api.py` · `_entrance_all.py` + `_ent_render.py` · `_diag_vt_clear.py` · `_diag_tree.py` ·
`_vt_render.py`（`BR_VT_CAMS` 多机位 / `站点名=cam|tgt`）· `_diag_plan.py` · `_diag_edge.py` · `_diag_r5band.py` ·
`_tone_stats.py` · `_diag_roof.py` · `_dump_palette.py`（**材质色板真源** → `renders/材质色板.json`）
- ★ **规划体检 `_diag_plan.py`**：总平面网格射线 + 楼间距 + 道路覆盖率 + **路网穿楼相交面积**；
  开关 `BR_PLAN_FLIP/CROP/BBOX`。⇒ **每次大改几何后必跑**，判据「**穿楼面积 = 0**」。
  ★ 1.5 m 网格**查不出** 1.3 m 薄边侵入 ⇒ 用 `_diag_vt_clear.py`

**A/B 开关**：`BR_R5_LANG` · `BR_GRASS_V24` · `BR_ROOF_V2` · `BR_PALETTE_LINKED` · `BR_RENDER_DIR` ·
`BR_PLAN_FLIP/CROP/BBOX` · `BR_VT_CAMS/ONLY/CAM/TGT` · `BR_ENT_DIST/LAT/UP` · `BR_VTC_SAMP`


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
- 命名 `BLD_<分区>_<Name>` / `SITE_*` / `ANCHOR_*`（中轴节点 Y 全表见 skill）
- 路线 R0 语言样板 → R1 山门+智谷 → R2 图书馆+讲堂 → R3 人文区 → R4 环廊 → R5 五区 → R6 滨水 →
  **R7 整合/预览/GLB**
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
7. ★ **删掉一个"提供立体感"的构件，立体感不会自动转移**（S4-a）：旧立面靠挑檐的**水平阴影线**；
   修法**不是把挑檐加回来**（那就是横条纹），而是把**竖柱挑深**（0.40 → 0.52~0.64）
8. ★ **同一套节奏要在两处落件时，分格口径必须共用**（柱 `(i+0.5)/m` / 窗 `i/m` 天然错开半格；
   各算各的 ⇒ 柱窗错缝，**近景一眼假，且不报错**）
9. ★ **"再叠一层同类构件"多半是错的**（`v_lattice` 教训）：竖柱之外再叠格构带 ⇒ 读成一张密网格。
   **同一视觉意图，用一套构件 + 换材质表达**
10. 其余（"取消"类拆除时机 / `layered()` / 下弦起拱 / `skirt_ring` 方向 / 悬空件诊断三步 /
    同一 list 不能 emit 两次 / 铺装带不重叠 / 轴视近景保塔冠塔基）**见 skill**

