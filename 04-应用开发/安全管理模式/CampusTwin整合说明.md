# 安全管理模式 → CampusTwin 主页整合说明

> 目标：让安全管理的**所有可视化效果都呈现在 CampusTwin 主页（https://campustwin.pages.dev/）上**，
> 而不是另做一个独立页面。
> 日期：2026-09-28 ｜ 基于分支 `campustwin-afternoon` 实际源码
> **更新（2026-09-28 晚）**：面板由工具栏抽屉改为**居中浮层**；修复预警状态机（此前「一键启动预案」没有入口）；
> 安全模式不再跨会话记忆。
> 权威源码 = 分支 `campustwin-afternoon` 上的提交 `8685fd9`；本目录 `campus-twin-patch/` 只是对应快照。

---

## 一、整合结果

**安全模式已成为主页地图上的一等公民**，与既有地图同屏：

```
地图工具栏（左侧）
  ├─ 🛡 安全管理      ← 新增，点开后弹出**居中安全面板**；同时开启地图叠加层
  ├─ 地点分类 / 图层显示 / 角色模式 / 设置 / 我的位置 / 第一人称（既有，未改）

地图画布
  ├─ 2D 底图 + 既有地点标记 + 既有路线（未改）
  └─ ★ 安全叠加层（新增）：风险区四色圆 · 人流热力 · 封控路段虚线 · 避雨通道高亮 · 告警地点标签

安全面板（居中浮层，`min(1080px, 100%)` × 最高约 `88vh`）
  ├─ 左列：地图叠加图层 · 天气与应急联动 · 人流阈值风控 · 处置时效
  ├─ 右列：预警与可信度闸门 · 处置预案 · 路网联动范围
  └─ 标题栏与页脚常驻，正文内部滚动；宽屏双列、窄屏单列、手机横屏回到双列

图层面板（图层显示）
  └─ ★ 安全模式图层（新增，仅安全模式开启时出现）：风险区 / 人流热力 / 封控路段
```

### 面板为什么是居中浮层，而不是工具栏抽屉

第一版把面板挂在 `.map-toolbar`（左上角、展开后 206px 宽）内部当抽屉用，实测有三个问题：
抽屉自身没有底色，宽度一超出工具栏就"半透明地"压在地图上；面板位置贴着屏幕左下角、底部被视口裁掉；内容只能一路向下滚。
现在改为独立浮层：自带不透明卡片底色与圆角投影、视口居中、正文双列并在面板内部滚动，收起方式有三种
（右上 ×、Esc、点浮层外），**收起后地图叠加层保留** —— 演示「一键启动预案」时可以先看面板结论、收起面板再看地图上的封控路段。

### 深链接（可直接分享给评审）

| 链接 | 效果 |
| --- | --- |
| `/?safety=1` | 直接进入安全管理模式（面板 + 叠加层） |
| `/?safety=1&scene=2d` | 进入安全模式并切到 2D 总览（看风险叠加层） |
| `/?safety=0` | 显式关闭 |

> URL 开关是 `App.jsx` 里一个 `useEffect` 读取 `window.location.search` 实现的，
> 只在首次挂载时生效，之后交给用户操作。
> 安全模式本身**不跨会话记忆**：演示过 `?safety=1` 之后再用 `/` 打开，仍是干净的默认视图
> （否则普通链接会被上次演示的风险图层污染，看起来像"整合把原有体验弄坏了"）。

---

## 二、新增与改动清单

### 新增（约 2500 行）

| 路径 | 行数 | 作用 |
| --- | --- | --- |
| `src/domain/safety/capacity.js` | 437 | 容量口径（30 个真实建筑）、天气修正、**从真实路网推导的地点→路段映射** |
| `src/domain/safety/index.js` | 947 | 人流风控（迟滞/驻留/冷却/趋势/空间传导）、预警分级矩阵、状态机、六个预案 + 八个动作 |
| `src/app/useSafetyState.js` | 205 | 安全态势 Hook —— 面板与叠加层**共享同一份状态** |
| `src/data/safetyDemo.js` | 88 | 天气场景快照（W3）+ 三条演示上报（含可信度分项） |
| `src/features/safety/SafetyModePanel.jsx` | 356 | 安全管理面板（居中浮层，双列正文） |
| `src/features/safety/SafetyMapOverlay.jsx` | 168 | 地图叠加层（SVG 路段 + HTML 圆形风险区） |
| `src/domain/safety/safety.test.js` | 277 | 33 项 vitest 断言 |
| `docs/superpowers/specs/2026-09-28-safety-mode-design.md` | 65 | 本次整合的设计记录（背景/方案/验收/限制） |

### 改动（既有业务逻辑**一行未改**）

| 文件 | 改动 |
| --- | --- |
| `src/App.jsx` | 引入 `useSafetyState`；给 `MapWorkspace` 传 `safety`/`now`；新增 URL 开关 effect |
| `src/data/appSettings.js` | 新增 4 个布尔设置（`safetyMode` 默认 **false**、`showRiskZones`、`showCrowdHeat`、`showBlockedRoads`） |
| `src/app/campusReducer.js` | 安全模式不从本地存储恢复（其余图层偏好照旧记忆） |
| `src/features/map/MapToolbar.jsx` | `tools` 数组新增 `safety` 项；面板不再挂在这里 |
| `src/features/map/MapWorkspace.jsx` | 透传 `safety`/`now`；挂载居中浮层；地图表层条件渲染 `SafetyMapOverlay` |
| `src/features/map/MapLayerPanel.jsx` | 新增安全模式图层分组（条件显示） |
| `src/styles.css` | +204 行样式，沿用既有纸墨色系 |
| `README.md` | 新增「安全管理模式」一节（入口、深链接、演示数据边界） |
| `.gitattributes` | `*.cmd text eol=crlf`（批处理在 Windows 上必须是 CRLF） |

**关键设计：`safetyMode` 默认关闭** —— 不改变既有默认体验，也不影响既有 75 项测试。

---

## 三、接口契约（与既有模块的接线点）

### ① ★ 封路：复用既有 `affectedEdgeIds`，`aStar()` 一行不改

```js
// 安全面板执行预案 → 得到真实边 id 集合
const run = executePlaybook(playbook, { at: now })
run.changes.blockedEdgesAdd
// → ['road:axis_gate:axis_plaza', 'road:axis_plaza:axis_valley_n', ...]

// 与既有机制同源：getActiveBlockedEdgeIds(events) 读的就是 event.affectedEdgeIds
// 所以安全模式的封路可以直接以事件形式发布，路线模块无需改动
```

`useSafetyState` 里的 `blockedEdges` 已经把**事件自带封路**与**预案写入封路**取并集：

```js
const fromEvents = events.flatMap((event) => event.affectedEdgeIds ?? [])
const fromPlaybook = appliedRun?.changes?.blockedEdgesAdd ?? []
return [...new Set([...fromEvents, ...fromPlaybook])]
```

### ② 人流：复用既有 `crowdStatus`，枚举降级为派生视图

面板不引入新数据源，而是把既有 `location.crowdStatus`（`low`/`normal`/`busy`）
**反解**成基准占用率（0.22 / 0.46 / 0.78），再跑风控：

```js
const STATUS_TO_RATIO = { low: 0.22, normal: 0.46, busy: 0.78 }
```

同时 `deriveCrowdStatus(ratio, risk)` 支持反向派生 —— 将来接入真实人流计数后，
既有 UI 读 `location.crowdStatus` 的地方零改动。

### ③ 天气：W3 方案（预置快照，无 Key、无后端）

`src/data/safetyDemo.js` 的 `WEATHER_SCENARIOS` 是静态快照。
升级到 L1 实时只需把这一处换成 `fetch('/api/weather')` 的结果，
`useSafetyState` 与所有组件都不用改。

> L1 必须走**服务端代理**：前端直连会把 Key 暴露（本项目历史上泄露过一把）。

### ④ 地图坐标：复用既有 `worldToMapPosition`

叠加层的路段端点直接用：

```js
const [ax, ay] = worldToMapPosition([node.x, 0, -node.y])  // → 0–1 归一化
```

因此与既有 `Campus2DViewer` 的路线 `<svg viewBox="0 0 100 100">` **天然对齐**。

---

## 四、验证（三层，全部实跑过）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 域层自检 | `node -e "import('./src/domain/safety/capacity.js')..."` | capacity **12/12 PASS**、index **15/15 PASS** |
| 单元测试 | `npx vitest run` | **16 文件 / 108 项全部通过**（既有 75 + 新增 33） |
| 生产构建 | `npx vite build` | **✓ built**（`dist/` 已同步） |
| 真实渲染 | 无头 Chrome（CDP 驱动，可点击后再截图） | 见 `campus-twin-patch/整合效果*.png` 三张 |

### 截图/交互里能看到什么（可核对）

- 左侧工具栏出现「**安全管理**」且高亮；点开后是**居中的不透明面板**，不再贴着屏幕左下角
- 面板：地图叠加图层开关（安全面板 / 风险区 / 人流热力 / 封控路段）
- 面板：天气与应急联动（晴好 / 暴雨红警 / 冰雹橙警 / 高温橙警 / 大风黄警 五个场景可切换）
- 面板：人流阈值风控 —— 默认 `严重 0 · 高风险 0 · 关注 2 · 正常 28`，列出 `公共教学楼 78% / 1200 人 关注`、`食堂 78% / 396 人 关注`；切到暴雨红警后 `公共教学楼 98% / 960 人 严重`、`食堂 98% / 317 人 严重`，并出现「天气修正后的安全容量」
- 面板：预警与可信度闸门 —— 状态会正确推进：`待核查` / `已发布` / `待核实`；`湖畔挑台护栏松动`（可信度 55% < 安全类阈值 75%）显示 **★ 安全类强制闸门：灰标不打点**，点「确认可信」后转为已发布
- 面板：处置预案 —— 暴雨红警下出现「暴雨应急联动预案」（路段封闭 / 关闭场所 / 暂停户外活动）与「一键启动预案」按钮
- 地图上：**「公共教学楼 关注 · 78%（936/1200 人）」「食堂 关注 · 78%（309/396 人）」标签**，以及对应的风险圆；叠加层的圆是**正圆**（不是被宽高比压扁的椭圆）
- 收起面板后叠加层仍在：封控路段虚线、避雨通道高亮、风险圆都留在地图上
- 四种视口都核对过版面：1500×1000 / 1280×800（双列）、820×900（单列）、844×390（手机横屏双列）

---

## 五、整合过程中抓到的真实缺陷

| # | 缺陷 | 后果 | 修法 |
| --- | --- | --- | --- |
| 1 | 手写的 `road:axis_lib_s:inner_w_s` 不在真实 `ROAD_EDGES` 里 | **封路静默失效** —— 运行期不报错，只是路封不上 | 改为从 `getRoadEdgeOptions()` **推导**全部 30 条映射，并加断言校验存在性 |
| 2 | 夜间升档多写了 `finalOrder >= SEVERITY_ORDER.low` 守卫 | 最低档（通知类）**夜间永远升不上去** —— 而"通知类夜里没人看"正是最需要升档的场景 | 去掉该守卫 |
| 3 | 叠加层用 `preserveAspectRatio="none"` 的 SVG 画圆 | 圆被 680:595 的宽高比**拉成椭圆**（第一版截图可见） | 风险区与热力改用 HTML 圆形（`border-radius: 50%` + `aspect-ratio: 1`），SVG 只画路段线 |
| 4 | `useSafetyState` 从组件文件 import 常量 | 循环依赖（hook ←→ 面板） | 常量抽到 `data/safetyDemo.js` |
| 5 | `useSafetyState` 导入路径多一级（`../../domain/`） | vite 构建失败（`UNRESOLVED_IMPORT`） | 改为 `../domain/` |
| 6 | 预警直接 `advanceAlert(alert, 'published')` 跳级 | **状态机静默拒绝**（`advanceAlert` 对非法跳转只返回 `{error}`，不抛错）→ 所有预警停在「已上报」，「可信度闸门」与「一键启动预案」两段演示都没有入口 | 按闸门判定的目标状态**逐跳推进**（reported → extracting → pending → published/verifying），并把 error 写进 timeline 而不是丢弃 |
| 7 | 面板挂在工具栏抽屉里、自身无底色 | 上半截透明压在地图上，内容被推到屏幕左下角且被视口裁掉 | 改为独立居中浮层（自带底色/圆角/投影 + 遮罩 + Esc/×/点外部收起） |
| 8 | `safetyMode` 被写进本地存储并在启动时恢复 | 演示过 `?safety=1` 之后，普通 URL `/` 也带着上次的风险图层，看起来像"整合弄坏了原有体验" | `createInitialState` 不从存储恢复安全模式（其余图层偏好照旧记忆） |

第 1 条和第 6 条是同一类问题：**运行期不报错，只是功能静默失效**。
第 6 条尤其隐蔽——状态机是"防呆"设计，它按设计拒绝了非法跳转，但调用方把返回值里的 `error` 丢掉了。

### 测试没能覆盖的部分（本次补上）

`useSafetyState` 是 hook，vitest 里没有组件环境，所以「状态机是否真的推进到已发布」只有人眼看截图才能发现。
本次用 Chrome DevTools Protocol 写了可交互的截图脚本（真点按钮再截图），
`确认可信 → 待核实转已发布`、`暴雨红警 → 一键启动预案`两条链路都点了实测。

第 1 条最值得说：**单元测试与自检都发现不了它** —— 边 id 格式合法、字符串非空、
逻辑上"封了一段路"，只有把 id 拿去和真实 `ROAD_EDGES` 对一遍才暴露。
现在这条校验已经固化进 `safety.test.js`（"地点 → 路段映射全部指向真实存在的边"）。

---

## 六、已知限制（诚实清单）

| # | 限制 | 影响 | 后续做法 |
| --- | --- | --- | --- |
| 1 | 叠加层**不随 2D 底图缩放/平移同步** | 底图的 `transform` 是 `Campus2DViewer` 的内部 state；默认视图下完全对齐，缩放后会错位 | 把 `SafetyMapOverlay` 移进 `.campus-2d-stage` 内，或让 viewer 暴露 viewport |
| 2 | 3D 场景暂不叠加 | 当前只在 `mapScene === '2d'` 时渲染 | 3D 需要投影到屏幕坐标，可复用 `Campus3DViewer` 的标签投影逻辑 |
| 3 | 人流计数是**派生**而非实测 | `crowdStatus` 枚举反解成占用率，不是真实计数 | 接入闸机 / 信标 / WiFi 探针后替换 `STATUS_TO_RATIO` 那一层 |
| 4 | 三条演示上报是构造的 | 线上真实事件结构没有 `ai.credibility` 字段，可信度闸门无从演示 | UI 已标注「演示数据」；接入真实评分管线后删除 `DEMO_REPORTS` |
| 5 | 容量数值是演示口径 | 座位数 / 疏散容量 / 住宿人数取校园常规量级 | 替换为后勤与保卫处的实测台账 |
| 6 | 覆盖层只在 2D 显示 | 3D 主视角下看不到风险区 | 同上第 2 条 |
| 7 | 移动端只做了基础适配 | 手机竖屏是单列 + 贴边浮层；横屏回到双列并压缩行距，但未按 `mobileLandscape.css` 的组织方式逐条打磨 | 按该文件的组织方式补全 |

### 演示数据边界（别当成实测）

容量台账、天气预警快照、三条上报样本（含可信度分项）都是**构造数据**，面板上标注了「演示数据」；
人流占用率由既有 `crowdStatus` 枚举反解，不是闸机/信标实测计数。
接入真实数据时，替换点分别是 `PLACE_CAPACITY`、`WEATHER_SCENARIOS`、`DEMO_REPORTS` 与 `STATUS_TO_RATIO` 四处。

---

## 七、如何运行

```bash
# 方式一：拿到完整工程（推荐）
git clone -b campustwin-afternoon https://github.com/zhchunyu/Chun-Yu.git campustwin
cd campustwin
npm ci
npm run dev            # → http://localhost:5173/?safety=1&scene=2d
npm test               # 108 项
npm run build          # 生产构建，产物在 dist/

# 方式二：直接看快照
# 本仓库 04-应用开发/安全管理模式/campus-twin-patch/ 里是整合涉及的那 14 个文件 + 3 张效果图
```

Windows 上也可以双击 `campus-twin-patch/预览.cmd`（与分支根目录那份一致），
它会起开发服务并自动打开 `http://127.0.0.1:5173/?safety=1&scene=2d`。

---

## 八、与主仓库的关系

本目录（`Chun-Yu/04-应用开发/安全管理模式/`）是**独立可验证的源工程**：
零依赖、自带 174 项自检、5 个组件校验、10 幕演示剧本，可在没有 CampusTwin 的环境里跑通。

本次整合把它**落地进真实页面**（代码在 `campustwin-afternoon` 分支）：

| 独立源工程 | → 落地版 |
| --- | --- |
| `domain/crowd.js` + `crowdRisk.js` | `domain/safety/capacity.js` + `domain/safety/index.js`（占位 id → 真实 30 建筑 / 真实边 id） |
| 深色验证台（`dev/index.html`） | 并入 `styles.css` 的纸墨色系（与既有设计语言一致） |
| 自带演示剧本 | `useSafetyState` + `?safety=1` 深链接 |

两边的域层逻辑一致，差异只在**数据对齐**与**视觉语言**。
落地版的权威源码在分支里（提交 `8685fd9`），`campus-twin-patch/` 只是便于评审阅读的快照 —— 不要在快照里改代码。

---

*本说明只记录整合内容，未改动既有 CampusTwin 业务逻辑。*
