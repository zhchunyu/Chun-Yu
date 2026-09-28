/**
 * 气象预警 → 校园处置动作 映射表 · 安全管理模式（路线 C）核心数据层
 * 文件：src/data/weatherActionMap.js
 *
 * 【为什么这个文件才是天气模块的价值所在】
 * 直接透传「暴雨橙色预警」对校园管理者不构成任何行动指令 —— 他知道下雨了，但不知道该做什么。
 * 价值全部在映射表：预警等级 → 风险点 → 可执行动作（封哪段路、关哪个门、派单给谁、广播什么话）。
 * 一句话：**我们不预报天气，我们把天气翻译成行动。**
 *
 * 【零依赖说明】
 * 本文件不 import 任何模块（含 node: 内置模块与第三方库），以便独立测试后拷入主仓库。
 * 代价是需要在文件内重复少量常量（等级序值、天气类型标签、路线模式 id），
 * 这些重复项在下方以「★ 需与主仓库对齐」标注，必须在拷贝时逐一核对。
 *
 * 【单位约定】
 * temperature ℃ ｜ humidity % ｜ windSpeed m/s ｜ precipitation mm/h ｜ visibility km
 */

/**
 * 处置动作原子库：校园安全预案可执行动作的最小集合（8 个）。
 *
 * 用途：规则表 WEATHER_ACTION_RULES 只能引用这里的动作码；
 * analyzeWeather 输出的 actions 也只会是这些取值 —— UI 按码渲染按钮/角标，不需要 switch 字符串。
 * @type {Readonly<{
 *   BROADCAST: 'broadcast', BLOCK_EDGE: 'block-edge', REROUTE: 'reroute', DISPATCH: 'dispatch',
 *   CLOSE_PLACE: 'close-place', HIGHLIGHT_ROUTE: 'highlight-route', PAUSE_OUTDOOR: 'pause-outdoor',
 *   LOG_EVIDENCE: 'log-evidence',
 * }>}
 */
export const ACTION_CODES = deepFreeze({
  /** 定向广播：向指定范围（全校/某片区/某楼栋）推送一条既定文案 */
  BROADCAST: 'broadcast',
  /** 路段置入封路集合：写进 blocked_edges，复用 buildGraph(blockedSet) + A* 重算 */
  BLOCK_EDGE: 'block-edge',
  /** 触发路线重算：提示上层重新计算路线（含路线对比渲染） */
  REROUTE: 'reroute',
  /** 派单：生成带责任角色与任务的待办工单（走 SLA 与超时升级） */
  DISPATCH: 'dispatch',
  /** 关闭场所：把场所置为 closed 状态（复用 HOTSPOT_STATUS.CLOSED） */
  CLOSE_PLACE: 'close-place',
  /** 高亮特定路线：如环廊避雨通道、林荫阴凉路线 */
  HIGHLIGHT_ROUTE: 'highlight-route',
  /** 暂停户外活动：体育课 / 体测 / 军训 / 社团活动 */
  PAUSE_OUTDOOR: 'pause-outdoor',
  /** 拍照 / 留痕：现场取证与全链路审计（法律风险边界的正面回应） */
  LOG_EVIDENCE: 'log-evidence',
})

/**
 * 处置动作中文标签与一句话说明。
 * 用途：管理者面板按钮文案、待办卡片标题与说明、AI 简报拼接。
 * @type {Readonly<Record<string, Readonly<{ label: string, description: string }>>>}
 */
export const ACTION_LABELS = deepFreeze({
  [ACTION_CODES.BROADCAST]: {
    label: '定向广播',
    description: '向相关范围推送一条既定文案，解决"通知不到位"。',
  },
  [ACTION_CODES.BLOCK_EDGE]: {
    label: '路段封控',
    description: '把边 id 写入 blocked_edges，路网重算时自然绕开，无需改动寻路代码。',
  },
  [ACTION_CODES.REROUTE]: {
    label: '路线重算',
    description: '触发受影响路线重新计算，并可渲染原路线/新路线对比。',
  },
  [ACTION_CODES.DISPATCH]: {
    label: '派单处置',
    description: '生成带责任角色与时限的工单，未按时处置自动升级。',
  },
  [ACTION_CODES.CLOSE_PLACE]: {
    label: '关闭场所',
    description: '把场所状态置为关闭，地图与信息流同步可见。',
  },
  [ACTION_CODES.HIGHLIGHT_ROUTE]: {
    label: '高亮路线',
    description: '在地图上高亮推荐通道，如环廊避雨通道、林荫阴凉路线。',
  },
  [ACTION_CODES.PAUSE_OUTDOOR]: {
    label: '暂停户外活动',
    description: '暂停体育课、体测、军训与社团户外活动，改至室内。',
  },
  [ACTION_CODES.LOG_EVIDENCE]: {
    label: '拍照留痕',
    description: '现场取证并记录操作人/时间，用于事后复盘与责任界定。',
  },
})

/**
 * 动作的标准执行与展示顺序（先告知、后管控、再善后）。
 * 用途：保证 analyzeWeather 与升级差异描述的输出顺序稳定，UI 不因规则命中顺序变化而跳动。
 * @type {ReadonlyArray<string>}
 */
export const ACTION_ORDER = deepFreeze([
  ACTION_CODES.BROADCAST,
  ACTION_CODES.BLOCK_EDGE,
  ACTION_CODES.REROUTE,
  ACTION_CODES.DISPATCH,
  ACTION_CODES.CLOSE_PLACE,
  ACTION_CODES.HIGHLIGHT_ROUTE,
  ACTION_CODES.PAUSE_OUTDOOR,
  ACTION_CODES.LOG_EVIDENCE,
])

/**
 * 校园风险场所清单（虚构的「山河大学」，不含任何真实学校名称）。
 *
 * 字段：id 场所 id ｜ name 中文名 ｜ kind 场所类型 ｜ riskKinds 关联的风险类型（与天气 kind 对齐）
 *      ｜ isShelter 是否可作为避雨/避险点（true 的场所会被 analyzeWeather 归入 shelters）
 * @type {ReadonlyArray<Readonly<{
 *   id: string, name: string, kind: string, riskKinds: ReadonlyArray<string>, isShelter: boolean,
 * }>>}
 */
export const CAMPUS_PLACES = deepFreeze([
  {
    id: 'low_lying_road',
    name: '低洼路段',
    kind: 'road',
    riskKinds: ['rainstorm'],
    isShelter: false,
  },
  {
    id: 'sunken_plaza',
    name: '下沉广场',
    kind: 'sunken-plaza',
    riskKinds: ['rainstorm'],
    isShelter: false,
  },
  {
    id: 'garage_entrance_north',
    name: '地下车库入口（北）',
    kind: 'garage-entrance',
    riskKinds: ['rainstorm'],
    isShelter: false,
  },
  {
    id: 'garage_entrance_south',
    name: '地下车库入口（南）',
    kind: 'garage-entrance',
    riskKinds: ['rainstorm'],
    isShelter: false,
  },
  {
    id: 'ring_corridor',
    name: '环廊避雨通道',
    kind: 'corridor',
    riskKinds: ['rainstorm', 'hail', 'thunder', 'heat'],
    isShelter: true,
  },
  {
    id: 'teaching_hall_foyer',
    name: '教学楼门厅',
    kind: 'foyer',
    riskKinds: ['rainstorm', 'hail', 'thunder', 'heat'],
    isShelter: true,
  },
  {
    id: 'outdoor_court',
    name: '露天球场',
    kind: 'sports-outdoor',
    riskKinds: ['hail', 'thunder', 'heat', 'gale'],
    isShelter: false,
  },
  {
    id: 'sports_field',
    name: '操场',
    kind: 'sports-outdoor',
    riskKinds: ['hail', 'thunder', 'heat', 'gale', 'rainstorm'],
    isShelter: false,
  },
  {
    id: 'bike_shed',
    name: '自行车棚',
    kind: 'shed',
    riskKinds: ['hail', 'gale', 'thunder'],
    isShelter: false,
  },
  {
    id: 'tree_lined_road',
    name: '行道树密集路段',
    kind: 'road',
    riskKinds: ['gale', 'thunder'],
    isShelter: false,
  },
  {
    id: 'lakeside_deck',
    name: '湖边挑台',
    kind: 'waterside-deck',
    riskKinds: ['thunder', 'gale', 'rainstorm'],
    isShelter: false,
  },
  {
    id: 'drinking_station',
    name: '直饮水补给点',
    kind: 'service-point',
    riskKinds: ['heat'],
    isShelter: false,
  },
  {
    id: 'shade_walkway',
    name: '林荫步道',
    kind: 'walkway',
    riskKinds: ['heat'],
    isShelter: false,
  },
  {
    id: 'canteen_entrance',
    name: '第三食堂入口',
    kind: 'canteen-entrance',
    riskKinds: ['rainstorm', 'gale'],
    isShelter: false,
  },
])

/**
 * 低洼路段占位清单（暴雨 C-6 规则的封路来源）。
 *
 * ★★★ 占位数据，必须与主仓库对齐后替换 ★★★
 * 真实边 id 必须从 CampusTwin 的 `src/data/roadNetwork.js` 的 `ROAD_EDGES` / `roadEdgeId()` 对齐后替换：
 * 当前用 `'起点节点→终点节点'` 字符串形式占位，其中节点命名沿用了主仓库的
 * outer_* / inner_* / axis_* / ring_* / rad_* / sport_access_* 前缀约定，
 * 但 **分隔符与节点 id 均未经核对**，且前置修复项 D3（补 3 条连接边）尚未落地 ——
 * 落地后本清单里的 `axis_gate→outer_s2` 等边才真实存在。
 * 替换判据：`roadEdgeId(from, to)` 的输出必须能在 `ROAD_EDGES` 里找到同值边，否则封路集合是死数据。
 * @type {ReadonlyArray<string>}
 */
export const LOW_LYING_EDGES = deepFreeze([
  'outer_s2→outer_s3', // 外环南段 · 第三食堂门口（与演示脚本 §8「卡车挡路」同一段，积水最直观）
  'outer_s3→outer_se3', // 外环东南角转弯处（转弯 + 低点，排水最慢）
  'axis_gate→outer_s2', // 主校门至外环南段连接边（前置修复项 D3 新增的 44 m 连接边）
  'ring_w1→ring_w2', // 环廊西侧低洼段（环廊是避雨通道，必须单独标记以免把避险点一起封掉）
  'sport_access_1→outer_se3', // 运动区接驳路（紧邻下沉广场，暴雨时最先积水）
])

/**
 * 低洼边清单的对齐说明（可直接在 UI 的「演示数据」角标提示里展示）。
 * @type {string}
 */
export const LOW_LYING_EDGES_ALIGNMENT_NOTE =
  '低洼路段为占位值：真实边 id 需与 src/data/roadNetwork.js 的 ROAD_EDGES / roadEdgeId() 对齐后替换，'
  + '并对齐前置修复项 D3（补 3 条连接边）的落地结果。'

/**
 * 气象 → 校园处置动作映射表（方案书 §4.2 的 12 行 + 归档策略 1 行 = 13 条规则）。
 *
 * 字段说明（13 条规则字段结构完全一致，未使用的字段以 null / 空数组占位，便于 UI 无脑遍历）：
 * - id 规则编号（与《安全管理模式_决策清单》§4.2 逐行对应）
 * - kind 适用天气类型 ｜ minLevel/maxLevel 触发的等级闭区间（含端点）
 * - riskPoint 校园风险点（管理者看得懂的语言，不是气象术语）
 * - actions 处置动作码数组（只能取 ACTION_CODES 的取值）
 * - routeMode 建议切换的路线模式（'rain' 已有 / 'shade' 需新增 / null 表示不改路线模式）
 * - edgeEffect 对路段代价的影响 { costMultiplier 未遮挡边代价倍率, coveredCostMultiplier 有遮挡边倍率,
 *   target 作用范围, reason 原因 }，单位：倍（1 表示不变）
 * - blockedEdges 需写入 blocked_edges 的边 id 数组
 * - placeIds / shelterIds 涉及场所与避险点 id（须存在于 CAMPUS_PLACES）
 * - dispatches 派单 [{ role 责任角色, task 任务 }] ｜ broadcasts 广播文案数组
 * - isArchive 是否为归档类规则（恒命中，不产出风险点）
 * - note 落地说明（复用哪些现成零件、有哪些前置依赖）
 * @type {ReadonlyArray<Readonly<object>>}
 */
export const WEATHER_ACTION_RULES = deepFreeze([
  // ── 暴雨 蓝/黄 ────────────────────────────────────────────────
  {
    id: 'C-5',
    kind: 'rainstorm',
    minLevel: 'blue',
    maxLevel: 'yellow',
    riskPoint: '路面湿滑',
    actions: [ACTION_CODES.REROUTE],
    routeMode: 'rain',
    edgeEffect: {
      costMultiplier: 1.35,
      coveredCostMultiplier: 0.65,
      target: 'all',
      reason: '路面湿滑，制动距离变长，非遮挡路段通行成本上升',
    },
    blockedEdges: [],
    placeIds: ['low_lying_road', 'canteen_entrance'],
    shelterIds: [],
    dispatches: [],
    broadcasts: [],
    isArchive: false,
    note: '复用已有的 edgeCost RAIN 模式（distance ×（covered ? 0.65 : 1.35）），零新增代码',
  },

  // ── 暴雨 橙/红 ────────────────────────────────────────────────
  {
    id: 'C-6',
    kind: 'rainstorm',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '低洼路段积水',
    actions: [ACTION_CODES.BLOCK_EDGE, ACTION_CODES.REROUTE],
    routeMode: 'rain',
    edgeEffect: {
      costMultiplier: 1.35,
      coveredCostMultiplier: 0.65,
      target: 'low-lying',
      reason: '低洼路段已判定积水，须整体绕行而不是仅提高代价',
    },
    blockedEdges: LOW_LYING_EDGES,
    placeIds: ['low_lying_road', 'sunken_plaza'],
    shelterIds: [],
    dispatches: [],
    broadcasts: [],
    isArchive: false,
    note: '低洼边置入 blocked_edges，复用已有的 buildGraph(blockedSet) + A*；前置依赖 D3（补 3 条连接边），'
      + '否则封路后最优路径不经过被封边、距离无变化（实测 844 m → 844 m，封路演示当场失效）',
  },
  {
    id: 'C-7',
    kind: 'rainstorm',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '地下车库倒灌',
    actions: [
      ACTION_CODES.CLOSE_PLACE,
      ACTION_CODES.BROADCAST,
      ACTION_CODES.DISPATCH,
      ACTION_CODES.LOG_EVIDENCE,
    ],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: ['garage_entrance_north', 'garage_entrance_south'],
    shelterIds: [],
    dispatches: [
      { role: '后勤保障', task: '地下车库出入口安装挡水板并核查排水泵运行状态，坡道处拉设警戒' },
    ],
    broadcasts: ['地下车库入口已封闭，请勿驶入；车辆请改停地面停车区'],
    isArchive: false,
    note: '车库属"财产损失可预见"场景，关闭 + 广播 + 派单三件事都要做，且必须留痕（涉及理赔与责任界定）',
  },
  {
    id: 'C-8',
    kind: 'rainstorm',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '户外活动受阻',
    actions: [ACTION_CODES.PAUSE_OUTDOOR, ACTION_CODES.BROADCAST, ACTION_CODES.DISPATCH],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: ['sports_field', 'outdoor_court'],
    shelterIds: ['ring_corridor', 'teaching_hall_foyer'],
    dispatches: [
      { role: '教务与体育部门', task: '暂停体育课、体测与社团户外活动，改至室内场馆并通知任课教师' },
    ],
    broadcasts: ['全校户外活动暂停，请就近进入教学楼门厅或环廊避雨'],
    isArchive: false,
    note: '复用派单机制；暂停动作必须落到"谁通知、改到哪里"，否则只是通知而不是处置',
  },
  {
    id: 'C-9',
    kind: 'rainstorm',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '通行不便',
    actions: [ACTION_CODES.HIGHLIGHT_ROUTE, ACTION_CODES.REROUTE, ACTION_CODES.BROADCAST],
    routeMode: 'rain',
    edgeEffect: null,
    blockedEdges: [],
    placeIds: [],
    shelterIds: ['ring_corridor', 'teaching_hall_foyer'],
    dispatches: [],
    broadcasts: ['雨天通行请优先使用环廊避雨通道，避开露天路段'],
    isArchive: false,
    note: '复用 ROUTE_MODES.RAIN（covered 路段代价 ×0.65），高亮环廊即高亮 covered 边，零新增代码',
  },

  // ── 冰雹 ─────────────────────────────────────────────────────
  {
    id: 'C-10',
    kind: 'hail',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '露天球场 / 自行车棚受冰雹直接冲击',
    actions: [
      ACTION_CODES.CLOSE_PLACE,
      ACTION_CODES.HIGHLIGHT_ROUTE,
      ACTION_CODES.REROUTE,
      ACTION_CODES.BROADCAST,
      ACTION_CODES.DISPATCH,
    ],
    routeMode: 'rain',
    edgeEffect: null,
    blockedEdges: [],
    placeIds: ['outdoor_court', 'bike_shed'],
    shelterIds: ['ring_corridor', 'teaching_hall_foyer'],
    dispatches: [
      { role: '后勤保障', task: '核查自行车棚顶棚、球场围网与临时设施加固情况，受损处拉设警戒' },
    ],
    broadcasts: ['冰雹预警：露天球场与自行车棚区域已临时关闭，请就近进入环廊或教学楼门厅避险'],
    isArchive: false,
    note: '复用 HOTSPOT_TYPES.CLOSURE 标记场所关闭；冰雹复用 rain 路线模式（该模式本质是"有遮挡优先"，'
      + '顶棚与环廊同样适用，避免为冰雹单独新增模式）',
  },
  {
    id: 'C-11',
    kind: 'hail',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '教学楼门厅需开放为临时避险点',
    actions: [ACTION_CODES.HIGHLIGHT_ROUTE, ACTION_CODES.BROADCAST, ACTION_CODES.DISPATCH],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: [],
    shelterIds: ['teaching_hall_foyer', 'ring_corridor'],
    dispatches: [
      { role: '教学楼管理员', task: '开启门厅照明与防滑垫，引导避险人员有序停留，不得堵塞消防通道' },
    ],
    broadcasts: ['教学楼门厅已开放为临时避险点，请勿在露天区域停留，进出靠右慢行'],
    isArchive: false,
    note: '避险点不只是"能进去"，还要有人管秩序：开门、照明、防滑、不堵消防通道，四件事写进派单',
  },

  // ── 高温 橙/红 ───────────────────────────────────────────────
  {
    id: 'C-12',
    kind: 'heat',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '体测 / 军训 / 户外课高温暴露',
    actions: [ACTION_CODES.PAUSE_OUTDOOR, ACTION_CODES.DISPATCH, ACTION_CODES.BROADCAST],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: ['sports_field', 'outdoor_court'],
    shelterIds: [],
    dispatches: [
      {
        role: '教务处 · 体育部',
        task: '关联当日课时表核对户外课程/体测/军训安排，建议调整至 16:00 后或改至室内场馆',
      },
    ],
    broadcasts: ['高温预警：11:00–16:00 暂停户外课程、体测与军训，请任课教师调整教学安排'],
    isArchive: false,
    note: '教育场景独有：处置动作必须能回落到课时表，否则只是"提醒"而不是"处置"（需课时表接口，若未做则该动作降级为派单人工核对）',
  },
  {
    id: 'C-13',
    kind: 'heat',
    minLevel: 'orange',
    maxLevel: 'red',
    riskPoint: '中暑与脱水风险',
    actions: [ACTION_CODES.HIGHLIGHT_ROUTE, ACTION_CODES.REROUTE, ACTION_CODES.BROADCAST],
    routeMode: 'shade',
    edgeEffect: {
      costMultiplier: 1.2,
      coveredCostMultiplier: 0.7,
      target: 'sun-exposed',
      reason: '暴晒路段体感温度更高，阴凉路段（shaded 标记）优先',
    },
    blockedEdges: [],
    placeIds: ['drinking_station', 'shade_walkway'],
    shelterIds: [],
    dispatches: [],
    broadcasts: ['高温预警：请沿林荫步道通行，就近至直饮水补给点补水；出现头晕立即到阴凉处休息并求助'],
    isArchive: false,
    note: '★ 建议新增 ROUTE_MODES.SHADE（当前主仓库 domain/route.js 只有 shortest/accessible/'
      + 'avoid-construction/rain/night，没有 shade），并在 edgeCost 中加 shaded 分支；属本模块唯一的新增路线模式',
  },

  // ── 大风 黄+ ─────────────────────────────────────────────────
  {
    id: 'C-14',
    kind: 'gale',
    minLevel: 'yellow',
    maxLevel: 'red',
    riskPoint: '树木倒伏 / 临时围挡倾覆',
    actions: [
      ACTION_CODES.HIGHLIGHT_ROUTE,
      ACTION_CODES.DISPATCH,
      ACTION_CODES.BROADCAST,
      ACTION_CODES.LOG_EVIDENCE,
    ],
    routeMode: null,
    edgeEffect: {
      costMultiplier: 1.2,
      coveredCostMultiplier: 1.0,
      target: 'tree-lined',
      reason: '行道树密集路段存在倒伏与断枝风险，抬高代价使其被自然绕开（软规避，不硬封路）',
    },
    blockedEdges: [],
    placeIds: ['tree_lined_road', 'bike_shed'],
    shelterIds: [],
    dispatches: [
      {
        role: '后勤保障',
        task: '核查行道树与临时围挡加固状态（重点：大树、新栽树、施工围挡），发现隐患立即拉设警戒并留痕',
      },
    ],
    broadcasts: ['大风预警：请避开行道树密集路段与临时围挡区域，注意高空坠物'],
    isArchive: false,
    note: '树木倒伏无法预判到具体某棵树，故用"软规避（代价 ×1.2）+ 派单核查"而不是硬封路；'
      + 'target 为 tree-lined 的边集合需在主仓库按实际树种/树龄标注后给出',
  },

  // ── 雷电 ─────────────────────────────────────────────────────
  {
    id: 'C-15',
    kind: 'thunder',
    minLevel: 'yellow',
    maxLevel: 'red',
    riskPoint: '空旷场地 / 水域周边雷击风险',
    actions: [
      ACTION_CODES.CLOSE_PLACE,
      ACTION_CODES.PAUSE_OUTDOOR,
      ACTION_CODES.BROADCAST,
      ACTION_CODES.DISPATCH,
    ],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: ['sports_field', 'lakeside_deck', 'outdoor_court'],
    shelterIds: ['teaching_hall_foyer', 'ring_corridor'],
    dispatches: [
      { role: '保卫处', task: '操场与湖边挑台拉设警戒线并劝离滞留人员，重点巡查水域周边' },
    ],
    broadcasts: ['雷电预警：请立即离开操场、湖边挑台等空旷场地与水域周边，不要在大树下避雨'],
    isArchive: false,
    note: '复用 HOTSPOT_STATUS.CLOSED 标记关闭；雷电预警信号按国家规定只有黄/橙/红三级（无蓝色），故 minLevel = yellow',
  },

  // ── 复合天气 ─────────────────────────────────────────────────
  {
    id: 'C-16',
    kind: 'composite',
    minLevel: 'blue',
    maxLevel: 'red',
    riskPoint: '复合天气叠加风险',
    actions: [ACTION_CODES.BROADCAST, ACTION_CODES.DISPATCH, ACTION_CODES.LOG_EVIDENCE],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: [],
    shelterIds: [],
    dispatches: [
      {
        role: '应急指挥组',
        task: '启动复合天气联合会商：按最高等级统一响应，动作取并集去重，对外只发布一次综合预警',
      },
    ],
    broadcasts: ['复合天气叠加风险已按最高等级升级处置，请以最新一次综合预警为准'],
    isArchive: false,
    note: '处理策略 = 风险叠加升级（取最高等级 + 合并动作去重 + 单卡呈现），而不是并列多张预警卡片；'
      + '由 analyzeWeather 在命中 ≥2 种天气类型时自动追加',
  },

  // ── 归档与统计（恒命中）───────────────────────────────────────
  {
    id: 'C-19',
    kind: 'any',
    minLevel: 'blue',
    maxLevel: 'red',
    riskPoint: '事件归档与统计',
    actions: [ACTION_CODES.LOG_EVIDENCE],
    routeMode: null,
    edgeEffect: null,
    blockedEdges: [],
    placeIds: [],
    shelterIds: [],
    dispatches: [],
    broadcasts: [],
    isArchive: true,
    note: '归档类规则：恒命中（含"晴好/已解除"场景），不产出风险点，只贡献留痕动作；'
      + '可归档记录由 createArchiveRecord() 产出，用于"本学期因暴雨封路 N 次、影响 M 人次"的统计口径',
  },
])

/**
 * 内部：JSON 常量一律深冻结（外层 + 嵌套数组/对象），避免运行期被 UI 误改。
 * @param {*} value 待冻结值
 * @returns {*} 冻结后的同一个值
 */
function deepFreeze(value) {
  if (Array.isArray(value)) value.forEach((item) => deepFreeze(item))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => deepFreeze(item))
  return Object.freeze(value)
}

/**
 * 内部：等级顺序值。★ 需与主仓库对齐：必须与 weatherDataSource.js 的 WEATHER_LEVEL_ORDER 完全一致。
 * 零依赖约束下不在本文件 import 该模块，故此处复制一份。
 */
const LEVEL_ORDER = deepFreeze({ blue: 0, yellow: 1, orange: 2, red: 3 })

/** 内部：等级中文标签。★ 需与 weatherDataSource.js 的 WEATHER_LEVEL_LABELS 对齐。 */
const LEVEL_LABELS = deepFreeze({
  blue: '蓝色预警',
  yellow: '黄色预警',
  orange: '橙色预警',
  red: '红色预警',
})

/** 内部：天气类型中文标签。★ 需与 weatherDataSource.js 的 WEATHER_KIND_LABELS 对齐。 */
const KIND_LABELS = deepFreeze({
  rainstorm: '暴雨',
  hail: '冰雹',
  heat: '高温',
  gale: '大风',
  thunder: '雷电',
  clear: '晴好天气',
  composite: '复合天气',
})

/** 内部：复合天气规则的类型标记（C-16），与 weatherDataSource 的 WEATHER_KINDS 不相交 */
const COMPOSITE_KIND = 'composite'

/**
 * 内部：路线模式优先级（多条规则同时建议时取最高）。
 * 依据：避雨/避冰雹（rain = 有遮挡优先）对应"通行受阻与直接伤害"，优先于避暑（shade = 舒适与健康风险）。
 */
const ROUTE_MODE_PRIORITY = deepFreeze({ rain: 2, shade: 1 })

/** 内部：合法的建议路线模式取值（analyzeWeather 返回的 routeMode 只会是这些值或 null） */
const ROUTE_MODE_IDS = deepFreeze(['rain', 'shade'])

/** 内部：判断常量表是否含有某个 key */
const hasKey = (table, key) => Object.prototype.hasOwnProperty.call(table, key)

/** 内部：数组去重（保持首次出现顺序） */
const unique = (list) => [...new Set(list)]

/** 内部：按提取键去重（保持首次出现顺序） */
const uniqueBy = (list, keyOf) => {
  const seen = new Set()
  return list.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 内部：把任意值安全地当成数组使用（手写的最小分析对象也能参与比较） */
const listOf = (value) => (Array.isArray(value) ? value : [])

/** 内部：等级字符串 → 顺序值；非法等级直接抛错 */
const levelOrderOf = (level) => {
  if (!hasKey(LEVEL_ORDER, level)) {
    throw new Error(`未知预警等级：${String(level)}（合法值：${Object.keys(LEVEL_ORDER).join(' / ')}）`)
  }
  return LEVEL_ORDER[level]
}

/** 内部：动作码排序（按 ACTION_ORDER；未知码追加在末尾而不是丢弃） */
const orderActions = (codes) => {
  const present = new Set(codes)
  const known = ACTION_ORDER.filter((code) => present.has(code))
  const unknown = unique(codes).filter((code) => !ACTION_ORDER.includes(code))
  return [...known, ...unknown]
}

/** 内部：规则在映射表中的下标（用于输出稳定排序） */
const ruleIndexOf = (ruleId) => WEATHER_ACTION_RULES.findIndex((rule) => rule.id === ruleId)

/** 内部：时间归一化为 ISO 8601 字符串 */
const resolveIso = (value) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  if (Number.isNaN(date.getTime())) throw new Error(`无法解析时间：${String(value)}`)
  return date.toISOString()
}

/** 内部：校验并取出分析结果对象 */
const requireAnalysis = (value, label) => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.actions)) {
    throw new Error(`${label} 必须是 analyzeWeather() 返回的分析结果对象`)
  }
  return value
}

/** 内部：分析结果的中文标签（如「暴雨红色预警」） */
const describeAnalysisLabel = (analysis) => {
  const kind = analysis?.kind
  if (kind === 'clear') return '晴好天气（无生效预警）'
  return `${KIND_LABELS[kind] ?? String(kind)}${LEVEL_LABELS[analysis?.level] ?? String(analysis?.level)}`
}

/** 内部：规则是否命中某个场景（归档规则恒命中；其余按类型 + 等级闭区间匹配） */
const matchesRule = (rule, scenario) => {
  if (rule.isArchive) return true
  if (rule.kind !== scenario.kind) return false
  const order = levelOrderOf(scenario.level)
  return order >= levelOrderOf(rule.minLevel) && order <= levelOrderOf(rule.maxLevel)
}

/** 内部：把入参归一化为场景数组（单个对象 / 数组皆可），并做结构校验 */
const normalizeScenarios = (input) => {
  const list = (Array.isArray(input) ? input : [input]).filter((item) => item && typeof item === 'object')
  if (!list.length) throw new Error('analyzeWeather 需要至少一个天气场景对象（单个对象或场景数组）')

  list.forEach((item) => {
    if (typeof item.id !== 'string' || !item.id) throw new Error('天气场景缺少 id 字段')
    if (typeof item.kind !== 'string' || !item.kind) throw new Error(`天气场景 ${item.id} 缺少 kind 字段`)
    levelOrderOf(item.level)
  })

  return list
}

/** 内部：多条规则同时建议路线模式时取优先级最高的（rain > shade > 无） */
const pickRouteMode = (rules) => {
  const modes = unique(rules.map((rule) => rule.routeMode).filter((mode) => ROUTE_MODE_IDS.includes(mode)))
  if (!modes.length) return null
  return modes.sort((a, b) => ROUTE_MODE_PRIORITY[b] - ROUTE_MODE_PRIORITY[a])[0]
}

/** 内部：拼接一句中文摘要（供 AI 简报与演示文案直接使用） */
const buildSummary = ({
  primary,
  kinds,
  isComposite,
  level,
  actions,
  blockedEdges,
  places,
  shelters,
  dispatches,
  broadcasts,
  riskPoints,
}) => {
  const levelText = LEVEL_LABELS[level] ?? String(level)
  const kindText = kinds.map((kind) => KIND_LABELS[kind] ?? kind).join(' + ')

  if (!riskPoints.length) {
    return `${KIND_LABELS[primary.kind] ?? primary.kind}（无生效预警）：未命中任何风险处置规则，`
      + `路网与场所维持常态，仅生成 ${actions.length} 类留痕归档动作。`
  }

  const prefix = isComposite
    ? `复合天气叠加风险（${kindText}），按最高等级${levelText}响应`
    : `${kindText}${levelText}`

  const clauses = [`命中 ${riskPoints.length} 条处置规则`]
  if (blockedEdges.length) clauses.push(`封控 ${blockedEdges.length} 段道路`)
  if (places.length) clauses.push(`管控 ${places.length} 处场所`)
  if (shelters.length) clauses.push(`开放 ${shelters.length} 处避险点`)
  if (dispatches.length) clauses.push(`派出 ${dispatches.length} 项任务`)
  if (broadcasts.length) clauses.push(`发布 ${broadcasts.length} 条广播`)
  clauses.push(`共 ${actions.length} 类处置动作`)

  return `${prefix}：${clauses.join('，')}。`
}

/**
 * 按 id 查询校园场所。
 *
 * @param {string} placeId 场所 id（须存在于 CAMPUS_PLACES）
 * @returns {Readonly<{ id: string, name: string, kind: string, riskKinds: ReadonlyArray<string>, isShelter: boolean }>|null}
 *   命中的场所对象（已冻结，可安全共享）；未命中返回 null
 */
export function getCampusPlace(placeId) {
  return CAMPUS_PLACES.find((place) => place.id === placeId) ?? null
}

/**
 * 核心函数：把天气场景翻译成校园可执行的处置方案。
 *
 * 复合天气处理策略（C-16）= **风险叠加升级**：
 * 传入数组（或带多个 kind 的场景）时，取最高等级为准，命中规则的动作取并集去重，
 * 并追加 C-16 联合会商规则，最终以**一张综合卡**呈现，而不是并列多张预警卡片。
 *
 * @param {object|object[]} scenario 天气场景对象（weatherDataSource.getCurrent() 的返回值），或场景数组（复合天气）
 * @param {object} [options] 选配
 * @param {Date|string|number} [options.now] 分析时刻，用于归档留痕（analyzedAt）；默认当前时间
 * @returns {{
 *   scenarioId: string, kind: string, level: string, levelOrder: number,
 *   riskPoints: Array<{ riskPoint: string, actions: string[], routeMode: string|null, edgeEffect: object|null, ruleId: string }>,
 *   actions: string[], blockedEdges: string[], routeMode: 'rain'|'shade'|null,
 *   shelters: object[], places: object[], dispatches: Array<{ role: string, task: string }>, broadcasts: string[],
 *   summary: string, kinds: string[], scenarioIds: string[], isComposite: boolean, analyzedAt: string,
 * }} 处置分析结果；actions / blockedEdges 已去重且顺序稳定；places 为非避险类涉及场所，shelters 为避险点
 * @throws {Error} 入参不是场景对象、缺少 kind、等级非法时抛出
 */
export function analyzeWeather(scenario, options = {}) {
  const { now } = options
  const scenarios = normalizeScenarios(scenario)

  const kinds = unique(scenarios.map((item) => item.kind))
  const isComposite = kinds.length > 1
  const primary = scenarios.reduce(
    (highest, item) => (levelOrderOf(item.level) > levelOrderOf(highest.level) ? item : highest),
    scenarios[0],
  )

  // ① 规则命中（同一规则被多个场景命中只算一次）
  const hits = []
  scenarios.forEach((item) => {
    WEATHER_ACTION_RULES.forEach((rule) => {
      if (!matchesRule(rule, item)) return
      if (hits.some((hit) => hit.rule.id === rule.id)) return
      hits.push({ rule, scenario: item })
    })
  })

  const archiveRules = hits.filter((hit) => hit.rule.isArchive).map((hit) => hit.rule)
  const riskHits = hits.filter((hit) => !hit.rule.isArchive)

  // ② 复合天气：追加"风险叠加升级"策略规则
  if (isComposite) {
    const compositeRule = WEATHER_ACTION_RULES.find((rule) => rule.kind === COMPOSITE_KIND)
    if (!compositeRule) throw new Error('规则表缺少复合天气规则（C-16），无法执行风险叠加升级')
    riskHits.push({ rule: compositeRule, scenario: primary })
  }

  // ③ 按规则表顺序排序，保证输出不受输入数组顺序影响
  riskHits.sort((a, b) => ruleIndexOf(a.rule.id) - ruleIndexOf(b.rule.id))

  const riskPoints = riskHits.map((hit) => ({
    riskPoint: hit.rule.riskPoint,
    actions: [...hit.rule.actions],
    routeMode: hit.rule.routeMode,
    edgeEffect: hit.rule.edgeEffect,
    ruleId: hit.rule.id,
  }))

  const riskRules = riskHits.map((hit) => hit.rule)
  const actions = orderActions([...riskRules, ...archiveRules].flatMap((rule) => rule.actions))
  const blockedEdges = unique(riskRules.flatMap((rule) => rule.blockedEdges))
  const routeMode = pickRouteMode(riskRules)

  // ④ 场所分流：isShelter 的进 shelters（避险点），其余进 places（需管控/需推送的场所）
  const placeIds = unique(riskRules.flatMap((rule) => rule.placeIds))
  const candidateIds = unique(riskRules.flatMap((rule) => [...rule.shelterIds, ...rule.placeIds]))
  const candidates = candidateIds.map((id) => getCampusPlace(id)).filter(Boolean)
  const shelters = candidates.filter((place) => place.isShelter)
  const places = placeIds.map((id) => getCampusPlace(id)).filter((place) => place && !place.isShelter)

  const dispatches = uniqueBy(
    riskRules.flatMap((rule) => rule.dispatches),
    (item) => `${item.role}|${item.task}`,
  ).map((item) => ({ role: item.role, task: item.task }))
  const broadcasts = unique(riskRules.flatMap((rule) => rule.broadcasts))

  const level = primary.level
  const summary = buildSummary({
    primary,
    kinds,
    isComposite,
    level,
    actions,
    blockedEdges,
    places,
    shelters,
    dispatches,
    broadcasts,
    riskPoints,
  })

  return {
    scenarioId: scenarios.map((item) => item.id).join('+'),
    kind: isComposite ? COMPOSITE_KIND : primary.kind,
    level,
    levelOrder: levelOrderOf(level),
    riskPoints,
    actions,
    blockedEdges,
    routeMode,
    shelters,
    places,
    dispatches,
    broadcasts,
    summary,
    kinds,
    scenarioIds: scenarios.map((item) => item.id),
    isComposite,
    analyzedAt: resolveIso(now),
  }
}

/**
 * 内部：严重度评分（等级优先，其次风险点数，再次动作数）。
 *
 * 量纲说明：levelOrder × 1000 + riskPointCount × 10 + actionCount。
 * 权重刻意拉开量级 —— 等级是第一判据，「橙→红」的升级绝不能被"多了两个动作"盖过。
 * @param {object} analysis analyzeWeather 的分析结果
 * @returns {number} 评分（无量纲，仅用于比较）
 */
const severityScore = (analysis) => {
  const target = requireAnalysis(analysis, '严重度评分')
  const levelOrder = Number.isFinite(target.levelOrder) ? target.levelOrder : levelOrderOf(target.level)
  return levelOrder * 1000 + listOf(target.riskPoints).length * 10 + listOf(target.actions).length
}

/**
 * 比较两个处置分析结果的严重度 —— 供 `src/domain/safetyStore.js` 判断"是否需要生成新待办/是否可解除管控"。
 *
 * ★★ 入参必须是 **analyzeWeather() 的返回值（analysis 对象）**，不是天气场景（scenario）对象。
 *    两者长得像（都带 level / kind），但 scenario 没有 actions / riskPoints 数组：
 *    传 scenario 会被 requireAnalysis 判为非法并**抛错**（快速失败，而不是静默算成 'same'）。
 *    正确用法只有一条：先 `const analysis = analyzeWeather(scenario)`，再比较两个 analysis。
 *
 * 严重度公式（量纲刻意拉开，等级是第一判据，避免"多了两个动作"盖过"橙→红"）：
 *   severity = levelOrder × 1000 + riskPoints.length × 10 + actions.length
 *   levelOrder 单位：档（blue = 0 / yellow = 1 / orange = 2 / red = 3）
 *   riskPoints 单位：条 ｜ actions 单位：类
 *
 * @param {object} analysisA 变化前的分析结果（analyzeWeather 返回值；须含 actions 数组，
 *   以及 level 或 levelOrder 之一）
 * @param {object} analysisB 变化后的分析结果（同上）
 * @returns {'up'|'down'|'same'} b 相对 a 的方向：
 *   'up' 升级（应生成新待办）、'down' 降级/解除（应解除封控与派单）、'same' 无变化（什么都不做）
 * @throws {Error} 任一入参不是 analysis 对象（缺 actions 数组）时抛出
 * @example
 * // 等级升档 → 生成待办；这是 safetyStore 的唯一调用姿势（入参全部来自 analyzeWeather）
 * const before = analyzeWeather(weatherSource.getCurrent())          // 晴好基线
 * weatherSource.setScenario('rainstorm_red')
 * const after = analyzeWeather(weatherSource.getCurrent())           // 暴雨红色预警
 * compareSeverity(before, after) // => 'up'
 */
export function compareSeverity(analysisA, analysisB) {
  const from = severityScore(analysisA)
  const to = severityScore(analysisB)
  if (to > from) return 'up'
  if (to < from) return 'down'
  return 'same'
}

/**
 * 内部：按标量键做差集（next 有、prev 没有 → 新增）
 * @param {Array} nextList 变化后的列表
 * @param {Array} prevList 变化前的列表
 * @param {(item: *) => string} keyOf 取值函数
 * @returns {Array} 新增项（保持 nextList 顺序）
 */
const diffByKey = (nextList, prevList, keyOf) => {
  const prevKeys = new Set(listOf(prevList).map(keyOf))
  return listOf(nextList).filter((item) => !prevKeys.has(keyOf(item)))
}

/**
 * 描述从一种天气到另一种天气的处置升级差异（升档新增了什么、降档解除了什么）。
 *
 * ★★ 入参必须是 **analyzeWeather() 的返回值（analysis 对象）**，不是天气场景（scenario）对象
 *    （原因与用法见 compareSeverity：scenario 缺 actions 数组，传入即抛错）。
 *
 * 用途（safetyStore 的两条主用例）：
 * - **等级升档** → `todoItems` 即"新增动作"派生出的待办清单，可直接渲染卡片，无需再查规则表；
 *   同时 `addedBlockedEdges` 给出需要写入 blocked_edges 的新增边。
 * - **等级降档** → `removedActions` / `removedBlockedEdges` 给出可解除的处置
 *   （对应 C-18 自动解封 + 路线恢复）；此时 `todoItems` 恒为空数组、`headline` 说明"无需生成新待办"。
 *
 * 【路线模式 routeMode 的判定方式 —— safetyStore 解除/切换模式时请直接用下面的结论，不要自己写比较】
 * 判定式：`routeModeChanged = (prev.routeMode ?? null) === (next.routeMode ?? null) ? null : { from, to }`
 * - `routeModeChanged === null`      → 两端建议模式相同（含"两端都不建议"）⇒ **不解除、不新增**
 * - `routeModeChanged.to === null`   → **模式解除**：把 from 模式（如 ROUTE_MODES.RAIN）移出活跃模式
 * - `routeModeChanged.from === null` → **新增模式**：切到 to 模式（如 ROUTE_MODES.SHADE）
 * - 两端都非 null 且不同              → **模式切换**：先解除 from，再启用 to
 * 注意 `null` 的语义是"该天气不建议任何特定路线模式"（如大风、雷电只做场所管控，不改路线策略），
 * 因此"解除（rain → null）"与"从未启用（null → null）"被严格区分开，不会误触发解封。
 *
 * @param {object} prevAnalysis 变化前的分析结果（analyzeWeather 返回值）
 * @param {object} nextAnalysis 变化后的分析结果（analyzeWeather 返回值）
 * @returns {{
 *   direction: 'up'|'down'|'same',
 *   levelChanged: { from: string, to: string, direction: 'up'|'down'|'same' },
 *   severityChanged: { from: number, to: number },
 *   addedActions: string[], removedActions: string[],
 *   addedRiskPoints: Array<{ ruleId: string, riskPoint: string }>,
 *   removedRiskPoints: Array<{ ruleId: string, riskPoint: string }>,
 *   addedBlockedEdges: string[], removedBlockedEdges: string[],
 *   addedPlaces: Array<{ id: string, name: string }>, removedPlaces: Array<{ id: string, name: string }>,
 *   addedShelters: Array<{ id: string, name: string }>, removedShelters: Array<{ id: string, name: string }>,
 *   addedDispatches: Array<{ role: string, task: string }>, removedDispatches: Array<{ role: string, task: string }>,
 *   addedBroadcasts: string[], removedBroadcasts: string[],
 *   routeModeChanged: { from: string|null, to: string|null }|null,
 *   headline: string, todoItems: Array<{ code: string, label: string, description: string }>,
 * }} 升级差异描述对象：
 *   - `direction` **严重度**方向（等级 → 风险点数 → 动作数，由 compareSeverity 给出）
 *   - `levelChanged.direction` **预警等级**方向，只看等级档位（yellow → red 为 'up'）。
 *     两者可能不一致：同为橙色预警的冰雹 → 高温，等级为 'same'，但动作更多时严重度仍可能是 'up'。
 *     safetyStore 判断"是否升档"用 levelChanged.direction，判断"是否要动待办/封控"用 direction。
 *   - `severityChanged` 升级前后的严重度评分（无量纲，仅可比大小）
 *   - 所有 `added*` 为"next 有、prev 没有"，所有 `removed*` 为"prev 有、next 没有"
 *   - `headline` 一句可直接展示的中文说明 ｜ `todoItems` 由 addedActions 派生（含动作中文标签与说明）
 * @throws {Error} 任一入参不是分析结果对象（缺 actions 数组）时抛出
 * @example
 * // 升档：由天气源切换驱动，全部入参都来自 analyzeWeather
 * const before = analyzeWeather(source.getCurrent())
 * source.setScenario('rainstorm_red')
 * const after = analyzeWeather(source.getCurrent())
 * const diff = describeEscalation(before, after)
 * diff.direction        // 'up'
 * diff.todoItems        // [{ code: 'broadcast', label: '定向广播', description: '…' }, …] 可直接渲染
 * diff.routeModeChanged // { from: null, to: 'rain' } —— 晴好 → 暴雨红：新增 rain（有遮挡优先）模式
 */
export function describeEscalation(prevAnalysis, nextAnalysis) {
  const prev = requireAnalysis(prevAnalysis, 'describeEscalation 的第一个参数')
  const next = requireAnalysis(nextAnalysis, 'describeEscalation 的第二个参数')

  const direction = compareSeverity(prev, next)

  const addedActions = orderActions(diffByKey(listOf(next.actions), listOf(prev.actions), (code) => code))
  const removedActions = orderActions(diffByKey(listOf(prev.actions), listOf(next.actions), (code) => code))

  const addedRiskPoints = diffByKey(next.riskPoints, prev.riskPoints, (item) => item.ruleId)
    .map((item) => ({ ruleId: item.ruleId, riskPoint: item.riskPoint }))
  const removedRiskPoints = diffByKey(prev.riskPoints, next.riskPoints, (item) => item.ruleId)
    .map((item) => ({ ruleId: item.ruleId, riskPoint: item.riskPoint }))

  const addedBlockedEdges = diffByKey(next.blockedEdges, prev.blockedEdges, (edgeId) => edgeId)
  const removedBlockedEdges = diffByKey(prev.blockedEdges, next.blockedEdges, (edgeId) => edgeId)

  const toPlaceRef = (place) => ({ id: place.id, name: place.name })
  const addedPlaces = diffByKey(next.places, prev.places, (place) => place.id).map(toPlaceRef)
  const removedPlaces = diffByKey(prev.places, next.places, (place) => place.id).map(toPlaceRef)
  const addedShelters = diffByKey(next.shelters, prev.shelters, (place) => place.id).map(toPlaceRef)
  const removedShelters = diffByKey(prev.shelters, next.shelters, (place) => place.id).map(toPlaceRef)

  const dispatchKey = (item) => `${item.role}|${item.task}`
  const addedDispatches = diffByKey(next.dispatches, prev.dispatches, dispatchKey)
    .map((item) => ({ role: item.role, task: item.task }))
  const removedDispatches = diffByKey(prev.dispatches, next.dispatches, dispatchKey)
    .map((item) => ({ role: item.role, task: item.task }))

  const addedBroadcasts = diffByKey(next.broadcasts, prev.broadcasts, (text) => text)
  const removedBroadcasts = diffByKey(prev.broadcasts, next.broadcasts, (text) => text)

  const routeModeChanged = (prev.routeMode ?? null) === (next.routeMode ?? null)
    ? null
    : { from: prev.routeMode ?? null, to: next.routeMode ?? null }

  // levelChanged.direction 只看等级档位，与 direction（严重度）区分开：
  // 同为橙色预警的冰雹 → 高温，此处为 'same'，但动作变多时 direction 仍可能是 'up'。
  const prevOrder = levelOrderOf(prev.level)
  const nextOrder = levelOrderOf(next.level)
  const levelDirection = nextOrder === prevOrder ? 'same' : (nextOrder > prevOrder ? 'up' : 'down')

  const todoItems = addedActions.map((code) => ({
    code,
    label: ACTION_LABELS[code]?.label ?? code,
    description: ACTION_LABELS[code]?.description ?? '',
  }))

  const verb = direction === 'up' ? '升档' : direction === 'down' ? '降档' : '维持'
  const actionText = addedActions.length || removedActions.length
    ? `新增 ${addedActions.length} 类处置动作、解除 ${removedActions.length} 类`
    : '处置动作无变化'
  const todoText = todoItems.length ? `，自动生成 ${todoItems.length} 条待办` : '，无需生成新待办'
  const headline = `等级由「${describeAnalysisLabel(prev)}」${verb}为「${describeAnalysisLabel(next)}」：`
    + `${actionText}${todoText}。`

  return {
    direction,
    levelChanged: { from: prev.level, to: next.level, direction: levelDirection },
    severityChanged: { from: severityScore(prev), to: severityScore(next) },
    addedActions,
    removedActions,
    addedRiskPoints,
    removedRiskPoints,
    addedBlockedEdges,
    removedBlockedEdges,
    addedPlaces,
    removedPlaces,
    addedShelters,
    removedShelters,
    addedDispatches,
    removedDispatches,
    addedBroadcasts,
    removedBroadcasts,
    routeModeChanged,
    headline,
    todoItems,
  }
}

/**
 * 产出可归档的处置记录对象（C-19：事件归档 + 统计）。
 *
 * 用途：把一次天气处置固化成一条可入库、可统计、可审计的记录 ——
 * 支撑"本学期因暴雨封路 N 次、影响 M 人次"这类数据资产口径。
 * ★ 记录自带 isDemo: true 与 operator，符合"全链路时间戳 + 操作人"的审计要求（决策清单 B-21）。
 *
 * @param {object} analysis analyzeWeather 的分析结果
 * @param {object} [options] 选配
 * @param {object} [options.scenario] 原始天气场景（用于留存预警原文与发布时刻）
 * @param {Date|string|number} [options.now] 归档时刻；默认取 analysis.analyzedAt
 * @param {string} [options.operator='演示账号 · 管理者'] 操作人标识（审计留痕）
 * @returns {Readonly<object>} 归档记录：含 recordId / archivedAt / operator / 等级 / 动作 / 封控边 /
 *   场所 / 避险点 / 派单 / 广播 / statistics 统计块 / summary / isDemo
 * @throws {Error} 入参不是分析结果对象、时间无法解析时抛出
 */
export function createArchiveRecord(analysis, { scenario = null, now, operator = '演示账号 · 管理者' } = {}) {
  const target = requireAnalysis(analysis, 'createArchiveRecord 的第一个参数')
  const archivedAt = resolveIso(now ?? target.analyzedAt)
  const recordId = `ARC-${archivedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${target.scenarioId}`

  const placeIds = listOf(target.places).map((place) => place.id)
  const shelterIds = listOf(target.shelters).map((place) => place.id)
  const blockedEdges = [...listOf(target.blockedEdges)]
  const actions = [...listOf(target.actions)]
  const dispatches = listOf(target.dispatches).map((item) => ({ role: item.role, task: item.task }))
  const broadcasts = [...listOf(target.broadcasts)]

  return Object.freeze({
    recordId,
    schemaVersion: '1.0',
    archivedAt,
    operator,
    scenarioId: target.scenarioId,
    kind: target.kind,
    level: target.level,
    levelOrder: target.levelOrder,
    label: describeAnalysisLabel(target),
    actions,
    blockedEdges,
    placeIds,
    shelterIds,
    dispatches,
    broadcasts,
    statistics: Object.freeze({
      riskPointCount: listOf(target.riskPoints).length,
      actionCount: actions.length,
      blockedEdgeCount: blockedEdges.length,
      placeCount: placeIds.length,
      shelterCount: shelterIds.length,
      dispatchCount: dispatches.length,
      broadcastCount: broadcasts.length,
    }),
    sourceScenario: scenario
      ? Object.freeze({
        id: scenario.id ?? null,
        label: scenario.label ?? null,
        issuedAt: scenario.issuedAt ?? null,
        isDemo: scenario.isDemo ?? null,
      })
      : null,
    summary: target.summary,
    isDemo: true,
  })
}

/**
 * 模块自检：校验规则表完整性、机制正确性与合规性（不依赖任何外部文件/网络）。
 *
 * @returns {{ name: string, passed: boolean, checks: Array<{ label: string, passed: boolean, detail: string }> }}
 *   name 模块名；passed 全部检查是否通过；checks 逐项检查结果（label 检查项、passed 是否通过、detail 证据）
 */
export function runSelfCheck() {
  const checks = []
  const check = (label, passed, detail) => {
    checks.push({ label, passed: Boolean(passed), detail: String(detail) })
  }
  const safe = (fn) => {
    try {
      return { ok: true, value: fn() }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }
  /** 自检用的合成场景（不依赖 weatherDataSource.js，满足零依赖约束） */
  const scene = (id, kind, level) => ({ id, kind, level, label: `${KIND_LABELS[kind] ?? kind}${LEVEL_LABELS[level] ?? level}`, isDemo: true })

  // ── 一、常量表完整性 ─────────────────────────────────────────
  const codeValues = Object.values(ACTION_CODES)
  const expectedCodes = [
    'broadcast', 'block-edge', 'reroute', 'dispatch',
    'close-place', 'highlight-route', 'pause-outdoor', 'log-evidence',
  ]
  check(
    'ACTION_CODES 恰好 8 个动作码且取值与规范逐字一致',
    codeValues.length === 8 && expectedCodes.every((code) => codeValues.includes(code)),
    `${codeValues.length} 个：${codeValues.join(', ')}`,
  )

  const labelKeys = Object.keys(ACTION_LABELS)
  const labelComplete = expectedCodes.every((code) => {
    const item = ACTION_LABELS[code]
    return item && typeof item.label === 'string' && item.label.length > 0
      && typeof item.description === 'string' && item.description.length > 0
  })
  check(
    'ACTION_LABELS 覆盖全部动作码，且每个动作都有中文标签 + 一句话说明',
    labelKeys.length === 8 && labelComplete,
    `${labelKeys.length} 项；样例：${ACTION_LABELS['block-edge'].label} — ${ACTION_LABELS['block-edge'].description}`,
  )

  check(
    'ACTION_ORDER 覆盖全部 8 个动作码且无重复（输出顺序稳定）',
    ACTION_ORDER.length === 8 && new Set(ACTION_ORDER).size === 8
    && expectedCodes.every((code) => ACTION_ORDER.includes(code)),
    ACTION_ORDER.join(' → '),
  )

  const ruleIds = WEATHER_ACTION_RULES.map((rule) => rule.id)
  const expectedRuleIds = [
    'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10', 'C-11', 'C-12', 'C-13', 'C-14', 'C-15', 'C-16', 'C-19',
  ]
  check(
    '规则表精确覆盖 C-5~C-16 共 12 条 + C-19 归档共 13 条，id 无重复',
    ruleIds.length === 13 && new Set(ruleIds).size === 13
    && expectedRuleIds.every((id) => ruleIds.includes(id)),
    `${ruleIds.length} 条：${ruleIds.join(', ')}`,
  )

  const expectedRuleKeys = [
    'id', 'kind', 'minLevel', 'maxLevel', 'riskPoint', 'actions', 'routeMode', 'edgeEffect',
    'blockedEdges', 'placeIds', 'shelterIds', 'dispatches', 'broadcasts', 'isArchive', 'note',
  ].join(',')
  const keyMismatch = WEATHER_ACTION_RULES
    .filter((rule) => Object.keys(rule).join(',') !== expectedRuleKeys)
    .map((rule) => rule.id)
  check(
    '全部规则字段结构统一（15 个字段，未使用项以 null / 空数组占位）',
    keyMismatch.length === 0,
    keyMismatch.length ? `字段不一致：${keyMismatch.join(', ')}` : `统一字段：${expectedRuleKeys}`,
  )

  // ── 二、规则取值合法性 ───────────────────────────────────────
  const badRange = WEATHER_ACTION_RULES.filter((rule) => (
    !hasKey(LEVEL_ORDER, rule.minLevel) || !hasKey(LEVEL_ORDER, rule.maxLevel)
    || LEVEL_ORDER[rule.minLevel] > LEVEL_ORDER[rule.maxLevel]
  )).map((rule) => rule.id)
  check(
    '规则等级区间合法（取值在 blue~red 且 minLevel ≤ maxLevel）',
    badRange.length === 0,
    badRange.length ? `非法区间：${badRange.join(', ')}` : '13/13 条规则区间合法',
  )

  const badActions = WEATHER_ACTION_RULES
    .filter((rule) => rule.actions.length === 0 || rule.actions.some((code) => !expectedCodes.includes(code)))
    .map((rule) => rule.id)
  check(
    '规则动作码全部来自 ACTION_CODES 且每条规则至少 1 个动作',
    badActions.length === 0,
    badActions.length ? `非法动作：${badActions.join(', ')}` : '13/13 条规则动作合法',
  )

  const badRouteMode = WEATHER_ACTION_RULES
    .filter((rule) => rule.routeMode !== null && !ROUTE_MODE_IDS.includes(rule.routeMode))
    .map((rule) => rule.id)
  const badEdgeEffect = WEATHER_ACTION_RULES
    .filter((rule) => rule.edgeEffect !== null && !(rule.edgeEffect.costMultiplier >= 1))
    .map((rule) => rule.id)
  check(
    '建议路线模式只取 rain / shade 或 null；edgeEffect 代价倍率 ≥ 1（单位：倍）',
    badRouteMode.length === 0 && badEdgeEffect.length === 0,
    `非法 routeMode：${badRouteMode.join(', ') || '无'}；非法 edgeEffect：${badEdgeEffect.join(', ') || '无'}`,
  )

  const placeIds = CAMPUS_PLACES.map((place) => place.id)
  const badRefs = WEATHER_ACTION_RULES
    .filter((rule) => [...rule.placeIds, ...rule.shelterIds].some((id) => !placeIds.includes(id)))
    .map((rule) => rule.id)
  check(
    '规则引用的场所 / 避险点 id 全部存在于 CAMPUS_PLACES',
    badRefs.length === 0,
    badRefs.length ? `悬空引用：${badRefs.join(', ')}` : `${placeIds.length} 个场所，13 条规则引用全部有效`,
  )

  // ── 三、"零新增代码"复用声明（方案书性价比最高的两条）──────
  const c5 = WEATHER_ACTION_RULES.find((rule) => rule.id === 'C-5')
  check(
    'C-5 暴雨蓝/黄：路段代价 ×1.35（遮挡段 ×0.65）并建议 rain 路线，复用 edgeCost RAIN',
    c5.edgeEffect.costMultiplier === 1.35 && c5.edgeEffect.coveredCostMultiplier === 0.65
    && c5.routeMode === 'rain' && c5.actions.includes(ACTION_CODES.REROUTE)
    && /edgeCost RAIN/.test(c5.note),
    `${c5.riskPoint} → 代价 ×${c5.edgeEffect.costMultiplier} / 遮挡 ×${c5.edgeEffect.coveredCostMultiplier}；${c5.note}`,
  )

  const c9 = WEATHER_ACTION_RULES.find((rule) => rule.id === 'C-9')
  check(
    'C-9 暴雨橙/红：高亮环廊避雨通道并复用 ROUTE_MODES.RAIN（零新增代码）',
    c9.routeMode === 'rain' && c9.actions.includes(ACTION_CODES.HIGHLIGHT_ROUTE)
    && c9.shelterIds.includes('ring_corridor') && /ROUTE_MODES\.RAIN/.test(c9.note),
    `${c9.riskPoint} → ${c9.actions.join(' + ')}；避险点 ${c9.shelterIds.join(', ')}`,
  )

  const c6 = WEATHER_ACTION_RULES.find((rule) => rule.id === 'C-6')
  check(
    'C-6 暴雨橙/红：低洼边置入封路集合，且清单等于 LOW_LYING_EDGES 占位值',
    c6.actions.includes(ACTION_CODES.BLOCK_EDGE)
    && c6.blockedEdges.length === LOW_LYING_EDGES.length
    && c6.blockedEdges.every((edgeId, index) => edgeId === LOW_LYING_EDGES[index]),
    `${c6.blockedEdges.length} 段：${c6.blockedEdges.join(' / ')}`,
  )

  const c13 = WEATHER_ACTION_RULES.find((rule) => rule.id === 'C-13')
  check(
    'C-13 高温橙/红：建议新增 shade 路线模式并明确标注为主仓库尚无该模式',
    c13.routeMode === 'shade' && /ROUTE_MODES\.SHADE/.test(c13.note) && /没有 shade/.test(c13.note),
    `${c13.riskPoint} → routeMode=${c13.routeMode}；${c13.note}`,
  )

  const c16 = WEATHER_ACTION_RULES.find((rule) => rule.id === 'C-16')
  check(
    'C-16 复合天气采用"风险叠加升级"策略（kind=composite，联合会商派单）',
    c16.kind === COMPOSITE_KIND && /风险叠加升级/.test(c16.note) && c16.dispatches.length === 1,
    `${c16.riskPoint} → ${c16.actions.join(' + ')}；派单：${c16.dispatches[0].role}`,
  )

  const c19 = WEATHER_ACTION_RULES.find((rule) => rule.id === 'C-19')
  check(
    'C-19 为归档规则（isArchive=true）且贡献留痕动作',
    c19.isArchive === true && c19.actions.includes(ACTION_CODES.LOG_EVIDENCE),
    `${c19.riskPoint} → isArchive=${c19.isArchive}，动作 ${c19.actions.join(', ')}`,
  )

  // ── 四、场所与占位常量 ───────────────────────────────────────
  // 断言口径：**总数 ≥10 且覆盖全部 10 类要求的风险场所**，而不是"恰好等于 10 个" ——
  // 方案要求的是覆盖度；多出来的场所（南入口、补水点、林荫道、食堂入口）是真实需要的，不该被判失败。
  const requiredPlaceKinds = [
    '地下车库入口', '环廊', '露天球场', '自行车棚', '教学楼门厅',
    '行道树密集路段', '湖边挑台', '操场', '下沉广场', '低洼路段',
  ]
  const placeNames = CAMPUS_PLACES.map((place) => place.name)
  const coveredKinds = requiredPlaceKinds.filter((keyword) => placeNames.some((name) => name.includes(keyword)))
  const missingKinds = requiredPlaceKinds.filter((keyword) => !placeNames.some((name) => name.includes(keyword)))
  const idsUnique = new Set(placeIds).size === placeIds.length
  const extraPlaces = CAMPUS_PLACES
    .filter((place) => !requiredPlaceKinds.some((keyword) => place.name.includes(keyword)))
    .map((place) => place.name)
  check(
    'CAMPUS_PLACES 覆盖要求的 10 类风险场所（总数 ≥10、id 唯一、虚构"山河大学"无真实校名）',
    missingKinds.length === 0 && CAMPUS_PLACES.length >= 10 && idsUnique,
    `共 ${CAMPUS_PLACES.length} 个场所（要求 ≥10）；id ${idsUnique ? '无重复' : '有重复'}；`
    + `已覆盖 ${coveredKinds.length}/${requiredPlaceKinds.length} 类：${coveredKinds.join('、')}；`
    + `额外补充 ${extraPlaces.length} 个：${extraPlaces.join('、') || '无'}`
    + (missingKinds.length ? `；★ 缺失：${missingKinds.join('、')}` : ''),
  )

  const shelterIds = CAMPUS_PLACES.filter((place) => place.isShelter).map((place) => place.id)
  check(
    '环廊与教学楼门厅标记为避险点（isShelter=true），且避险点都声明了关联风险类型',
    shelterIds.includes('ring_corridor') && shelterIds.includes('teaching_hall_foyer')
    && CAMPUS_PLACES.every((place) => place.riskKinds.length > 0),
    `避险点 ${shelterIds.length} 个：${shelterIds.join(', ')}`,
  )

  check(
    'LOW_LYING_EDGES 为「节点→节点」形式的字符串占位清单，并带主仓库对齐说明',
    LOW_LYING_EDGES.length >= 3
    && LOW_LYING_EDGES.every((edgeId) => typeof edgeId === 'string' && edgeId.includes('→'))
    && /roadNetwork\.js/.test(LOW_LYING_EDGES_ALIGNMENT_NOTE)
    && /roadEdgeId/.test(LOW_LYING_EDGES_ALIGNMENT_NOTE),
    `${LOW_LYING_EDGES.length} 段占位：${LOW_LYING_EDGES.join(' / ')}`,
  )

  // ── 五、机制正确性：逐场景跑通映射 ───────────────────────────
  const rainRed = analyzeWeather(scene('rainstorm_red', 'rainstorm', 'red'))
  check(
    '暴雨红色：命中 C-6/C-7/C-8/C-9（C-5 因超过黄档不命中），动作并集为全部 8 类',
    rainRed.riskPoints.length === 4
    && rainRed.riskPoints.map((item) => item.ruleId).join(',') === 'C-6,C-7,C-8,C-9'
    && rainRed.actions.length === 8
    && rainRed.levelOrder === 3,
    `ruleIds=${rainRed.riskPoints.map((item) => item.ruleId).join(',')}；actions=${rainRed.actions.join(', ')}`,
  )
  check(
    '暴雨红色：聚合结果正确（封控 5 段低洼路 / 6 处场所 / 2 处避险点 / 2 项派单 / 3 条广播 / rain 路线）',
    rainRed.blockedEdges.length === 5 && rainRed.places.length === 6 && rainRed.shelters.length === 2
    && rainRed.dispatches.length === 2 && rainRed.broadcasts.length === 3 && rainRed.routeMode === 'rain'
    && rainRed.shelters.every((place) => place.isShelter === true)
    && rainRed.places.every((place) => place.isShelter === false),
    `封路 ${rainRed.blockedEdges.length}｜场所 ${rainRed.places.length}｜避险点 ${rainRed.shelters.length}｜`
    + `派单 ${rainRed.dispatches.length}｜广播 ${rainRed.broadcasts.length}｜routeMode=${rainRed.routeMode}`,
  )
  check(
    '暴雨红色：摘要句可直接用于 AI 简报（含等级、风险点数、管控口径）',
    /暴雨红色预警/.test(rainRed.summary) && /命中 4 条处置规则/.test(rainRed.summary)
    && /封控 5 段道路/.test(rainRed.summary),
    rainRed.summary,
  )

  const rainYellow = analyzeWeather(scene('rainstorm_yellow', 'rainstorm', 'yellow'))
  check(
    '暴雨黄色：只命中 C-5（等级区间下界生效），代价倍率 1.35 / rain 路线 / 不封路',
    rainYellow.riskPoints.length === 1 && rainYellow.riskPoints[0].ruleId === 'C-5'
    && rainYellow.riskPoints[0].edgeEffect.costMultiplier === 1.35
    && rainYellow.blockedEdges.length === 0 && rainYellow.routeMode === 'rain',
    `ruleIds=${rainYellow.riskPoints.map((item) => item.ruleId).join(',')}；封路 ${rainYellow.blockedEdges.length} 段；`
    + `代价 ×${rainYellow.riskPoints[0].edgeEffect.costMultiplier}`,
  )

  const clear = analyzeWeather(scene('clear', 'clear', 'blue'))
  check(
    '晴好基线：无风险点、不封路、不改路线模式，仅产出 1 条留痕归档动作',
    clear.riskPoints.length === 0 && clear.blockedEdges.length === 0 && clear.routeMode === null
    && clear.actions.length === 1 && clear.actions[0] === ACTION_CODES.LOG_EVIDENCE
    && /未命中任何风险处置规则/.test(clear.summary),
    `riskPoints=${clear.riskPoints.length}；actions=${clear.actions.join(', ')}；${clear.summary}`,
  )

  const heat = analyzeWeather(scene('heat_orange', 'heat', 'orange'))
  check(
    '高温橙色：命中 C-12（课时表调整）+ C-13（补水点/阴凉路线），路线模式为 shade',
    heat.riskPoints.map((item) => item.ruleId).join(',') === 'C-12,C-13'
    && heat.routeMode === 'shade'
    && heat.dispatches.some((item) => /课时表/.test(item.task))
    && heat.places.some((place) => place.id === 'drinking_station'),
    `ruleIds=${heat.riskPoints.map((item) => item.ruleId).join(',')}；routeMode=${heat.routeMode}；`
    + `派单=${heat.dispatches.map((item) => item.role).join('/')}`,
  )

  const hail = analyzeWeather(scene('hail_orange', 'hail', 'orange'))
  check(
    '冰雹橙色：命中 C-10（关闭球场/车棚）+ C-11（开放门厅避险），避险点含教学楼门厅',
    hail.riskPoints.map((item) => item.ruleId).join(',') === 'C-10,C-11'
    && hail.shelters.some((place) => place.id === 'teaching_hall_foyer')
    && hail.places.some((place) => place.id === 'bike_shed')
    && hail.actions.includes(ACTION_CODES.CLOSE_PLACE),
    `ruleIds=${hail.riskPoints.map((item) => item.ruleId).join(',')}；避险点=${hail.shelters.map((place) => place.name).join('、')}；`
    + `关闭场所=${hail.places.map((place) => place.name).join('、')}`,
  )

  const gale = analyzeWeather(scene('gale_yellow', 'gale', 'yellow'))
  check(
    '大风黄色：命中 C-14，产出围挡核查派单与行道树路段软规避（代价 ×1.2）',
    gale.riskPoints.length === 1 && gale.riskPoints[0].ruleId === 'C-14'
    && gale.dispatches.some((item) => /围挡/.test(item.task))
    && gale.riskPoints[0].edgeEffect.costMultiplier === 1.2
    && gale.riskPoints[0].edgeEffect.target === 'tree-lined',
    `派单：${gale.dispatches.map((item) => `${item.role}｜${item.task}`).join('；')}`,
  )

  const thunder = analyzeWeather(scene('thunder_yellow', 'thunder', 'yellow'))
  check(
    '雷电黄色：命中 C-15，操场与湖边挑台置入关闭场所，空旷场地风险被识别',
    thunder.riskPoints.length === 1 && thunder.riskPoints[0].ruleId === 'C-15'
    && thunder.places.some((place) => place.id === 'sports_field')
    && thunder.places.some((place) => place.id === 'lakeside_deck')
    && thunder.actions.includes(ACTION_CODES.CLOSE_PLACE)
    && thunder.actions.includes(ACTION_CODES.PAUSE_OUTDOOR),
    `关闭场所=${thunder.places.map((place) => place.name).join('、')}；actions=${thunder.actions.join(', ')}`,
  )

  // ── 六、复合天气：风险叠加升级 ───────────────────────────────
  const composite = analyzeWeather([
    scene('rainstorm_red', 'rainstorm', 'red'),
    scene('gale_yellow', 'gale', 'yellow'),
  ])
  const unionOk = rainRed.actions.every((code) => composite.actions.includes(code))
    && gale.actions.every((code) => composite.actions.includes(code))
  check(
    '复合天气：取最高等级（红）、kind=composite、追加 C-16，动作为两场景并集',
    composite.level === 'red' && composite.levelOrder === 3 && composite.kind === COMPOSITE_KIND
    && composite.isComposite === true && composite.riskPoints.some((item) => item.ruleId === 'C-16')
    && composite.riskPoints.length === 6 && unionOk,
    `scenarioId=${composite.scenarioId}；ruleIds=${composite.riskPoints.map((item) => item.ruleId).join(',')}；`
    + `actions=${composite.actions.length} 类`,
  )
  check(
    '复合天气：摘要明确说明"叠加风险"并按最高等级统一响应',
    /叠加风险/.test(composite.summary) && /最高等级红色预警响应/.test(composite.summary)
    && composite.dispatches.some((item) => item.role === '应急指挥组'),
    composite.summary,
  )
  check(
    '复合天气：输入数组顺序不影响输出（规则表顺序排序，结果稳定）',
    analyzeWeather([scene('gale_yellow', 'gale', 'yellow'), scene('rainstorm_red', 'rainstorm', 'red')])
      .riskPoints.map((item) => item.ruleId).join(',') === composite.riskPoints.map((item) => item.ruleId).join(','),
    `正序=${composite.riskPoints.map((item) => item.ruleId).join(',')}；`
    + `逆序=${analyzeWeather([scene('gale_yellow', 'gale', 'yellow'), scene('rainstorm_red', 'rainstorm', 'red')])
      .riskPoints.map((item) => item.ruleId).join(',')}`,
  )

  // ── 七、升档 → 待办；降档 → 解除 ─────────────────────────────
  const escalation = describeEscalation(rainYellow, rainRed)
  check(
    '升档差异：黄→红判定为 up，新增 6 类动作（含封路/关闭场所/派单），解除 0 类',
    escalation.direction === 'up'
    && escalation.addedActions.includes(ACTION_CODES.BLOCK_EDGE)
    && escalation.addedActions.includes(ACTION_CODES.CLOSE_PLACE)
    && escalation.addedActions.includes(ACTION_CODES.PAUSE_OUTDOOR)
    && escalation.addedActions.length === 6 && escalation.removedActions.length === 0
    && escalation.addedBlockedEdges.length === 5,
    `新增：${escalation.addedActions.join(', ')}｜解除：${escalation.removedActions.join(', ') || '无'}｜`
    + `新增封路 ${escalation.addedBlockedEdges.length} 段`,
  )
  check(
    '升档自动生成待办：todoItems 由新增动作派生并带中文标签与说明',
    escalation.todoItems.length === 6
    && escalation.todoItems.every((item) => item.label.length > 0 && item.description.length > 0)
    && escalation.todoItems.some((item) => item.code === ACTION_CODES.BLOCK_EDGE),
    escalation.todoItems.map((item) => item.label).join('、'),
  )
  check(
    '升档文案可直接展示：说明等级变化 + 动作增减 + 待办条数',
    /升档/.test(escalation.headline) && /新增 6 类处置动作/.test(escalation.headline)
    && /自动生成 6 条待办/.test(escalation.headline),
    escalation.headline,
  )

  const deescalation = describeEscalation(rainRed, rainYellow)
  check(
    '降档差异：红→黄判定为 down，解除 6 类动作、新增封路为 0，不生成待办',
    deescalation.direction === 'down' && deescalation.addedActions.length === 0
    && deescalation.removedActions.length === 6
    && deescalation.removedBlockedEdges.length === 5
    && deescalation.todoItems.length === 0
    && /降档/.test(deescalation.headline),
    `${deescalation.headline}（解除封路 ${deescalation.removedBlockedEdges.length} 段）`,
  )

  // 路线模式变化必须用**真实 analyzeWeather() 返回值**来验（不用手写对象字面量），三种情况都要区分开：
  //   ① rain → rain（暴雨黄 → 暴雨红）：两端都建议 rain ⇒ routeModeChanged 必须为 null（无变化）
  //   ② rain → null（暴雨红 → 晴好）  ：模式解除 ⇒ from='rain' / to=null
  //   ③ null → shade（大风黄 → 高温橙）：新增模式 ⇒ from=null / to='shade'
  const modeSame = describeEscalation(rainYellow, rainRed)
  const modeReleased = describeEscalation(rainRed, clear)
  const modeAdded = describeEscalation(gale, heat)
  check(
    'compareSeverity 三态正确，且路线模式变化区分「无变化 / 模式解除 / 新增模式」三种情况',
    compareSeverity(rainYellow, rainRed) === 'up'
    && compareSeverity(rainRed, rainYellow) === 'down'
    && compareSeverity(rainRed, rainRed) === 'same'
    && modeSame.routeModeChanged === null
    && modeReleased.routeModeChanged?.from === 'rain' && modeReleased.routeModeChanged?.to === null
    && modeAdded.routeModeChanged?.from === null && modeAdded.routeModeChanged?.to === 'shade',
    'up/down/same 均正确；rain→rain（暴雨黄→红）routeModeChanged=null 无变化；'
    + 'rain→null（暴雨红→晴好）判定为模式解除；null→shade（大风→高温）判定为新增模式',
  )

  // levelChanged.direction 只反映"等级档位"，必须与 direction（严重度）区分开：
  // 同为橙色预警的冰雹 → 高温，等级是 'same'，但动作更多，严重度可能仍是 'up'。
  const sameLevel = describeEscalation(hail, heat)
  check(
    'levelChanged.direction 只看等级档位（黄→红 up、红→黄 down、橙→橙 same），与严重度 direction 区分',
    escalation.levelChanged.direction === 'up'
    && deescalation.levelChanged.direction === 'down'
    && sameLevel.levelChanged.direction === 'same'
    && escalation.levelChanged.from === 'yellow' && escalation.levelChanged.to === 'red',
    `暴雨黄→红 levelChanged=${escalation.levelChanged.from}→${escalation.levelChanged.to}`
    + `(${escalation.levelChanged.direction})；冰雹橙→高温橙 levelChanged=`
    + `${sameLevel.levelChanged.from}→${sameLevel.levelChanged.to}(${sameLevel.levelChanged.direction})，`
    + `而严重度 direction=${sameLevel.direction}（两者语义不同，是有意区分）`,
  )

  // ── 八、归档记录（C-19）─────────────────────────────────────
  const record = createArchiveRecord(rainRed, {
    scenario: scene('rainstorm_red', 'rainstorm', 'red'),
    now: '2026-09-28T14:00:00+08:00',
  })
  check(
    '归档记录：可入库（recordId/archivedAt/operator）、统计口径与分析结果一致',
    record.recordId === 'ARC-20260928060000-rainstorm_red'
    && record.isDemo === true && record.operator.length > 0
    && record.statistics.riskPointCount === 4 && record.statistics.actionCount === 8
    && record.statistics.blockedEdgeCount === 5 && record.statistics.placeCount === 6
    && record.statistics.shelterCount === 2 && record.statistics.dispatchCount === 2
    && record.statistics.broadcastCount === 3 && record.sourceScenario.issuedAt === null,
    `${record.recordId}｜${JSON.stringify(record.statistics)}`,
  )
  check(
    '归档记录自带留痕来源（场景 id/label）与摘要，支撑"本学期封路 N 次"统计',
    record.scenarioId === 'rainstorm_red' && record.label === '暴雨红色预警'
    && /暴雨红色预警/.test(record.summary) && record.blockedEdges.length === 5,
    `${record.label}｜封控 ${record.blockedEdges.length} 段｜${record.summary}`,
  )

  // ── 九、冻结与入参防御 ──────────────────────────────────────
  const deepFrozen = [ACTION_CODES, ACTION_LABELS, ACTION_ORDER, CAMPUS_PLACES, LOW_LYING_EDGES, WEATHER_ACTION_RULES]
    .every((table) => Object.isFrozen(table))
    && WEATHER_ACTION_RULES.every((rule) => Object.isFrozen(rule) && Object.isFrozen(rule.actions))
    && Object.isFrozen(CAMPUS_PLACES[0].riskKinds)
  const writeAccepted = Reflect.set(WEATHER_ACTION_RULES[0], 'riskPoint', '被改坏了')
  check(
    '常量表（含嵌套数组）深冻结且写入无效',
    deepFrozen && writeAccepted === false && WEATHER_ACTION_RULES[0].riskPoint === '路面湿滑',
    `深冻结=${deepFrozen}；写入被接受=${writeAccepted}；写入后仍为「${WEATHER_ACTION_RULES[0].riskPoint}」`,
  )

  const emptyInput = safe(() => analyzeWeather([]))
  const badLevel = safe(() => analyzeWeather(scene('rainstorm_blue', 'rainstorm', 'purple')))
  check(
    '入参防御：空数组 / 未知等级 / 非分析对象均明确抛错（快速失败，不静默错算）',
    !emptyInput.ok && /至少一个天气场景对象/.test(emptyInput.error)
    && !badLevel.ok && /未知预警等级/.test(badLevel.error)
    && !safe(() => describeEscalation(null, rainRed)).ok
    && !safe(() => createArchiveRecord({})).ok,
    `空数组→${emptyInput.error}；非法等级→${badLevel.error}`,
  )

  return {
    name: 'weatherActionMap',
    passed: checks.every((item) => item.passed),
    checks,
  }
}
