/**
 * 安全管理模式 · 通行热度异常检测基线模块
 * ============================================================================
 * 定位：`实时输入接入设计.md` §7「通行热度与主动探查」的可运行基线实现。
 *
 * 目标：从「人知道但没说出来」扩展到「**没人知道但数据知道**」——
 *      UGC 众包 → 数据驱动的态势感知。
 *
 * 完整机制（与设计文档逐条对齐）：
 *   ① 位置采样 → 路段计数：位置 ping 吸附到最近路段，按 edge × 15 min 桶累加
 *      ★ 用「路段」而不是「格网」做桶 —— 路网已经有了，比格网更贴合
 *   ② 同时段基线：近 7 天「同时间片」的中位数
 *      ★ 必须用中位数：一次运动会/开学能把均值拉高，之后天天误报
 *   ③ 异常判据：连续 K 个时间片 < 基线 15% → 疑似中断；可升级稳健 Z-score（MAD）
 *   ④ 排除已知原因（★ 防误报闸门）：官方封闭 / 施工 / 时段基线（夜间）/ 假期 /
 *      极端天气 / 已在 blocked_edges 里的边
 *   ⑤ 产出「建议核查」任务（★ **绝不自动发布「这条路有问题」**）：巡查派单 /
 *      众包悬赏 / 官方源交叉验证
 *
 * ★★ 本文件的两条硬约束：
 *   1. **零依赖纯 ESM** —— 不 import 任何项目文件、不 import 第三方库、
 *      连 node: 内置模块也不用（确定性随机自带 mulberry32）。
 *      这样它可以在任何环境下独立跑自检，之后原样拷进主仓库 `src/data/` 即可。
 *   2. **绝不自动发布** —— 本模块只产出「建议核查」任务卡，任何对外发布
 *      都必须经过人工确认；相关文案统一带 INSPECTION_DISCLAIMER 免责声明。
 *
 * 时间与单位约定：
 *   - 所有时间戳 ts 均为 **毫秒级 Unix 时间戳**（与 `Date.now()` 同口径）。
 *   - 时区：按**校区本地时间（默认 UTC+8）**切桶与判定昼夜，见
 *     CAMPUS_UTC_OFFSET_MINUTES（★ 占位常量，需与部署环境对齐）。
 *   - count / observed / baseline 的单位都是「**该 15 分钟桶内通过该路段的人次**」。
 *   - ratio / nightFactor / zScore 为无量纲比值。
 *
 * 命名口径：路段 id 形如 `outer_s2→outer_s3`（箭头为 U+2192），
 * 与 `07-项目文档/安全管理模式_技术路线与改进方案.md` 中 `blockEdge` 的写法一致。
 */

// ============================================================================
// 0. 常量
// ============================================================================

/**
 * 时间桶粒度（分钟）。设计文档 §7 ② 规定的 15 min 桶。
 * @type {number}
 */
export const BUCKET_MINUTES = 15

/**
 * 一天的时间桶数量。24 × 60 / 15 = 96。
 * @type {number}
 */
export const BUCKETS_PER_DAY = (24 * 60) / BUCKET_MINUTES

/**
 * 一个时间桶的毫秒数（15 min = 900000 ms）。
 * @type {number}
 */
export const MS_PER_BUCKET = BUCKET_MINUTES * 60 * 1000

/**
 * ★ 占位常量：校区本地时区相对 UTC 的偏移（分钟）。
 * 默认 480 = UTC+8（北京时间）。所有「当天第几个桶」「星期几」「夜间时段」判定
 * 都基于这个偏移换算，而不是运行机器的本地时区 —— 这样同一批数据在任何时区的
 * 机器上跑出来的桶键、基线、告警完全一致（可复现性要求）。
 * 约束：必须是 BUCKET_MINUTES 的整数倍（480 / 15 = 32 ✓），否则桶边界会错位。
 * 需与主仓库部署口径对齐后替换。
 * @type {number}
 */
export const CAMPUS_UTC_OFFSET_MINUTES = 480

/**
 * 「全周同刻」槽位键的通配日标记。基线表同时产出
 * `d5@14:15`（周五 14:15，星期几精确）与 `d*@14:15`（不分星期几，全周同刻）两种槽位；
 * 星期几精确槽样本不足（sampleDays < minDays）时，getBaseline 回退到通配槽。
 * @type {string}
 */
export const SLOT_ANY_DAY_MARK = 'd*'

/**
 * 异常类型枚举。设计文档 §7 ③。
 * @type {{ INTERRUPTED: string, CONGESTED: string }}
 */
export const ANOMALY_KINDS = Object.freeze({
  /** 疑似中断：连续 K 个时间片通行量低于基线的 dropRatio —— 「这条路可能不通了」 */
  INTERRUPTED: 'interrupted',
  /** 疑似异常拥堵：稳健 Z-score 超阈值且量级超过 spikeRatio —— 「这条路可能堵了/聚众了」 */
  CONGESTED: 'congested',
})

/**
 * 异常类型的中文标签（可直接上屏，避免 UI 层再写一套映射）。
 * @type {Readonly<Record<string, string>>}
 */
export const ANOMALY_KIND_LABELS = Object.freeze({
  [ANOMALY_KINDS.INTERRUPTED]: '疑似中断（长时间无人经过）',
  [ANOMALY_KINDS.CONGESTED]: '疑似异常拥堵（通行量远高于同时段）',
})

/**
 * 防误报闸门的排除原因枚举。设计文档 §7 ④ 的四类已知原因 + 已封路边。
 * @type {Readonly<Record<string, string>>}
 */
export const EXCLUSION_REASONS = Object.freeze({
  /** 官方已发布封闭通知（官方源 RAG） */
  OFFICIAL_CLOSURE: 'official-closure',
  /** 施工通知 */
  CONSTRUCTION: 'construction',
  /** 夜间时段（夜间本来就没车 —— 时段基线） */
  NIGHT: 'night',
  /** 假期 */
  HOLIDAY: 'holiday',
  /** 极端天气 */
  EXTREME_WEATHER: 'extreme-weather',
  /** 已在 blocked_edges 里的边（封路机制已覆盖，重复告警没有意义） */
  ALREADY_BLOCKED: 'already-blocked',
})

/**
 * 排除原因的中文标签。
 * @type {Readonly<Record<string, string>>}
 */
export const EXCLUSION_REASON_LABELS = Object.freeze({
  [EXCLUSION_REASONS.OFFICIAL_CLOSURE]: '官方已发布封闭通知',
  [EXCLUSION_REASONS.CONSTRUCTION]: '已发布施工通知',
  [EXCLUSION_REASONS.NIGHT]: '夜间时段（时段基线本来就低）',
  [EXCLUSION_REASONS.HOLIDAY]: '假期（在校人数本来就不足）',
  [EXCLUSION_REASONS.EXTREME_WEATHER]: '极端天气（停课/封校）',
  [EXCLUSION_REASONS.ALREADY_BLOCKED]: '该路段已在 blocked_edges 中（封路机制已覆盖）',
})

/**
 * 建议核查任务的类型枚举。设计文档 §7 ⑤ 的三条产出。
 * @type {{ PATROL: string, CROWDSOURCE: string, OFFICIAL_CHECK: string }}
 */
export const TASK_KINDS = Object.freeze({
  /** 巡查派单：给保卫/后勤推任务卡，「请前往确认」 */
  PATROL: 'patrol',
  /** 众包悬赏：给附近学生推「路过帮看一眼」，附上报模板，回来算贡献积分 */
  CROWDSOURCE: 'crowdsource',
  /** 官方源交叉验证：自动检索通知；无官方说明 → 升级为「待人工确认」 */
  OFFICIAL_CHECK: 'official-check',
})

/**
 * 任务类型的中文标签。
 * @type {Readonly<Record<string, string>>}
 */
export const TASK_KIND_LABELS = Object.freeze({
  [TASK_KINDS.PATROL]: '巡查派单',
  [TASK_KINDS.CROWDSOURCE]: '众包悬赏',
  [TASK_KINDS.OFFICIAL_CHECK]: '官方源交叉验证',
})

/**
 * 任务优先级枚举（P1 最急）。
 * @type {{ P1: string, P2: string, P3: string }}
 */
export const TASK_PRIORITY = Object.freeze({
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
})

/**
 * 优先级中文标签。
 * @type {Readonly<Record<string, string>>}
 */
export const TASK_PRIORITY_LABELS = Object.freeze({
  [TASK_PRIORITY.P1]: '紧急',
  [TASK_PRIORITY.P2]: '较急',
  [TASK_PRIORITY.P3]: '常规',
})

/**
 * 各优先级的处置时限（小时）。用于推导任务卡的 deadline。
 * 依据：巡查类任务「先到现场看一眼」的响应窗口；夜间/假期不额外顺延（由值班岗处理）。
 * @type {Readonly<Record<string, number>>}
 */
export const TASK_SLA_HOURS = Object.freeze({
  [TASK_PRIORITY.P1]: 1,
  [TASK_PRIORITY.P2]: 4,
  [TASK_PRIORITY.P3]: 24,
})

/**
 * ★ 免责声明：所有任务卡文案都必须带上它。
 * 这是项目的硬原则 —— **绝不自动发布「这条路有问题」**，只产出「建议核查」任务，
 * 由人确认后再走事件发布流程（见 `实时输入接入设计.md` §4.3 安全类强制闸门）。
 * @type {string}
 */
export const INSPECTION_DISCLAIMER = '★ 本任务为「建议核查」，只推送内部人员；未经人工核实与官方确认，不得对外发布「该路段有问题」。'

/**
 * 稳健 Z-score 公式系数：正态分布下 MAD ≈ 0.6745σ，故 z = 0.6745 × (x − median) / MAD。
 * @type {number}
 */
const MAD_TO_SIGMA = 0.6745

/**
 * MAD 为 0 时的回退系数：平均绝对偏差 MD ≈ 0.7979σ，故 σ ≈ 1.2533 × MD。
 * @type {number}
 */
const MEAN_ABS_DEV_TO_SIGMA = 1.2533

/**
 * 稳健 Z-score 至少需要的历史样本数（少于它算不出来，返回 null）。
 * @type {number}
 */
const MIN_Z_SCORE_SAMPLES = 3

/**
 * 当历史序列完全恒定（MAD = 0 且平均绝对偏差也为 0）时，
 * 任何偏离在 MAD 口径下都是「无穷大」。为保持数值可序列化（JSON 不能表达 Infinity），
 * 这里返回有限哨兵值 99，调用方按「远超阈值」处理。
 * @type {number}
 */
const CONSTANT_SERIES_Z = 99

/**
 * buildBaseline 的默认最小天数：样本不足 minDays 的槽位标记 insufficient: true，
 * **不能拿来判异常**（设计文档要求「样本不足不能拿来判异常」）。
 * @type {number}
 */
const DEFAULT_MIN_BASELINE_DAYS = 3

/**
 * detectAnomalies 的默认参数。
 * - dropRatio 0.15：低于同时段基线 15% 视为「异常地少」
 * - consecutiveBuckets 2：必须**连续** 2 个时间片（= 30 min）都低才算数，抑制单桶抖动
 * - spikeRatio 3.0：拥堵的量级下限（3 倍同时段基线）
 * - windowBuckets 4：事件聚簇窗口 —— 相邻异常桶间隔超过 4 个桶（1 h）就切成两次独立事件，
 *   允许中间夹少量抖动/丢包
 * - spikeZ 3.5：稳健 Z-score 阈值（拥堵的主判据）
 * @type {Readonly<object>}
 */
const DETECT_DEFAULTS = Object.freeze({
  dropRatio: 0.15,
  consecutiveBuckets: 2,
  spikeRatio: 3.0,
  windowBuckets: 4,
  spikeZ: 3.5,
})

/**
 * 夜间时段默认值：22:00 – 06:00（跨零点）。
 * @type {ReadonlyArray<number>}
 */
const DEFAULT_NIGHT_HOURS = Object.freeze([22, 6])

/**
 * 闸门判定顺序：先官方口径（封闭/施工/封路），再环境口径（天气/假期），最后时段口径（夜间）。
 * 一条异常命中多个原因时，excludedBy 取顺序里的第一个，其余记入 matchedReasons。
 * @type {ReadonlyArray<string>}
 */
const GATE_ORDER = Object.freeze([
  EXCLUSION_REASONS.OFFICIAL_CLOSURE,
  EXCLUSION_REASONS.CONSTRUCTION,
  EXCLUSION_REASONS.ALREADY_BLOCKED,
  EXCLUSION_REASONS.EXTREME_WEATHER,
  EXCLUSION_REASONS.HOLIDAY,
  EXCLUSION_REASONS.NIGHT,
])

/**
 * ★ 占位常量：演示用固定基准时间戳 = 校区本地 2026-09-28 16:00（周一）。
 * 刻意不用 `Date.now()`：只有固定日期 + 固定随机种子，`buildDemoDataset()`
 * 才能在任何机器、任何时候跑出**逐字节一致**的演示数据。
 * @type {number}
 */
export const DEMO_END_TS = Date.UTC(2026, 8, 28, 16, 0, 0) - CAMPUS_UTC_OFFSET_MINUTES * 60 * 1000

/**
 * 演示数据默认天数（对应决策清单 E-13 的「7 天 × 15 min 桶」标准规模）。
 * @type {number}
 */
const DEMO_DAYS = 7

/**
 * 演示数据默认随机种子。
 * @type {number}
 */
const DEMO_SEED = 20260928

/**
 * ★ 占位常量：默认演示路段 id（≥ 8 条，命名风格与项目一致）。
 *
 * ⚠️ **真实边 id 必须与主仓库 `src/data/roadNetwork.js` 的 `ROAD_EDGES` /
 *    `roadEdgeId(from, to)` 对齐后替换**（保证方向与箭头写法完全一致）。
 *    本文件的 id 取自 `Chun-Yu/02-三维资产/site/src/navigation.campus.js` 的
 *    ROAD_NODES / ROAD_EDGES（97 节点 / 109 边）以及设计文档里点名的示例边。
 *    注意：设计文档提到的补边 `outer_s3↔inner_e_s4` 在当前 ROAD_EDGES 里**尚不存在**，
 *    故本清单用真实存在的 `inner_e_s4→sport_access_w` 顶替。
 * @type {ReadonlyArray<string>}
 */
export const DEFAULT_EDGE_IDS = Object.freeze([
  'axis_gate→outer_s2',
  'outer_s2→outer_s3',
  'outer_se3→outer_se4',
  'outer_n→outer_nw1',
  'axis_plaza→axis_gate',
  'inner_e_s4→sport_access_w',
  'inner_w_s4→dorm_access_e',
  'ew_east_w→ew_east_e',
  'ring_s4→inner_e_mid',
  'dorm_access_w→dorm_access_e',
])

/**
 * ★ 占位常量：演示路段的流量量级与中文名（校门/中轴最大，生活区内部路最小）。
 * peak 的含义是「高峰 15 分钟桶的人次期望值」，用于合成日志，非真实测量值。
 * 真实数值应来自闸机/信标/WiFi 探针的标定结果。
 * @type {Readonly<Record<string, { peak: number, area: string, nearby: ReadonlyArray<string>, patrolUnit: string }>>}
 */
const DEFAULT_EDGE_SPECS = Object.freeze({
  'axis_gate→outer_s2': { peak: 320, area: '主校门 · 南段外环', nearby: ['主校门', '第三食堂'], patrolUnit: '南门片区巡逻岗' },
  'outer_s2→outer_s3': { peak: 260, area: '南段外环（食堂方向）', nearby: ['第三食堂', '明堂广场'], patrolUnit: '南门片区巡逻岗' },
  'outer_se3→outer_se4': { peak: 90, area: '东南外环', nearby: ['东南门', '运动区'], patrolUnit: '东南片区巡逻岗' },
  'outer_n→outer_nw1': { peak: 70, area: '北段外环', nearby: ['北门', '图书馆'], patrolUnit: '北门片区巡逻岗' },
  'axis_plaza→axis_gate': { peak: 240, area: '中轴大道南段', nearby: ['明堂广场', '主校门'], patrolUnit: '中轴片区巡逻岗' },
  'inner_e_s4→sport_access_w': { peak: 110, area: '运动区接驳路', nearby: ['体育馆', '操场'], patrolUnit: '东南片区巡逻岗' },
  'inner_w_s4→dorm_access_e': { peak: 150, area: '生活区接驳路', nearby: ['宿舍区', '第三食堂'], patrolUnit: '生活区巡逻岗' },
  'ew_east_w→ew_east_e': { peak: 130, area: '东西主路东段', nearby: ['图书馆', '环廊 S4 站'], patrolUnit: '中轴片区巡逻岗' },
  'ring_s4→inner_e_mid': { peak: 85, area: '环廊 S4 站接驳', nearby: ['环廊 S4 站', '图书馆'], patrolUnit: '环廊巡逻岗' },
  'dorm_access_w→dorm_access_e': { peak: 60, area: '生活区内部路', nearby: ['宿舍区'], patrolUnit: '生活区巡逻岗' },
})

/**
 * ★ 占位常量：校园作息节律（工作日），台阶函数，单位是「相对高峰的权重」。
 * 段格式 [起始分钟, 结束分钟, 权重]，区间左闭右开。
 * ⚠️ 所有段边界**必须是 15 的整数倍**（与时间桶对齐）——否则会出现
 *    「按权重算有量、按桶取却是 0」的错位（例如 09:50 不是桶起点，桶只有 09:45 / 10:00）。
 * 关键节律（设计文档要求「必须有真实的校园节律」）：
 *   - 早课高峰 07:30–08:00（1.00，全天最高）
 *   - 课间小峰 09:45–10:15（0.85）
 *   - 午间高峰 11:30–13:00（1.08 / 0.95）
 *   - 晚课高峰 17:30–18:30（1.00）
 *   - 晚自习下课小峰 21:30–22:00（0.80）
 *   - 夜间低谷 22:00–24:00（0.16 → 0.05），凌晨 00:00–05:00 恒为 0
 *   - 黎明 05:00–06:00（0.02，晨练/早班车）★ 工作日与周末**取同一权重**：
 *     若只有工作日非零，周末该时段就会「基线 2–12 次、实测 0 次」→ 每天必然误报
 * @type {ReadonlyArray<ReadonlyArray<number>>}
 */
const WEEKDAY_RHYTHM_SEGMENTS = Object.freeze([
  [0, 300, 0],        // 00:00–05:00 深夜：无通行（合成数据建模为 0）
  [300, 360, 0.02],   // 05:00–06:00 黎明：晨练 / 早班车（工作日与周末一致）
  [360, 420, 0.18],   // 06:00–07:00 起床 / 早操
  [420, 450, 0.75],   // 07:00–07:30 早课前段
  [450, 480, 1.0],    // 07:30–08:00 ★早课高峰
  [480, 570, 0.62],   // 08:00–09:30 第一二节课（人在教室）
  [570, 585, 0.5],    // 09:30–09:45
  [585, 615, 0.85],   // 09:45–10:15 ★课间换教室小峰
  [615, 690, 0.5],    // 10:15–11:30
  [690, 750, 1.08],   // 11:30–12:30 ★午间高峰
  [750, 780, 0.95],   // 12:30–13:00 午间高峰尾
  [780, 840, 0.6],    // 13:00–14:00
  [840, 930, 0.45],   // 14:00–15:30 下午课
  [930, 1050, 0.55],  // 15:30–17:30 课后活动
  [1050, 1110, 1.0],  // 17:30–18:30 ★晚课高峰
  [1110, 1140, 0.62], // 18:30–19:00 晚饭尾
  [1140, 1260, 0.5],  // 19:00–21:00 晚自习 / 社团活动
  [1260, 1290, 0.42], // 21:00–21:30
  [1290, 1320, 0.8],  // 21:30–22:00 ★晚自习下课小峰
  [1320, 1380, 0.16], // 22:00–23:00 夜间（回宿舍）
  [1380, 1440, 0.05], // 23:00–24:00 夜间低谷
])

/**
 * ★ 占位常量：校园作息节律（周末/节假日）。与工作日的区别：
 *   - 没有早课高峰，06:00–08:00 只有早餐/晨跑量（0.12 → 0.5）
 *   - 上午爬到 0.5–0.62，午间高峰仍在（0.90）
 *   - 15:00–18:30 是体育/社团活动高峰（0.68 → 0.80），比工作日下午高
 *   - 夜间略晚睡（22:00–24:00 为 0.20 / 0.08）
 * 注 1：同一时刻的工作日/周末权重比被刻意限制在 [0.5, 1.5] 量级 —— 因为 7 天窗口里
 *       「全周同刻」基线会把两类日子混在一起，比值过大就会自己造出误报。
 * 注 2：00:00–05:00 为 0，05:00–06:00 与工作日**同权重**（两边都不为零），
 *       避免出现「一边 0、一边非 0」的同刻槽 —— 那是必然误报（实测过：10 条边 × 2 个周末日
 *       = 20 条假中断）。
 * @type {ReadonlyArray<ReadonlyArray<number>>}
 */
const WEEKEND_RHYTHM_SEGMENTS = Object.freeze([
  [0, 300, 0],        // 00:00–05:00 深夜：无通行
  [300, 360, 0.02],   // 05:00–06:00 黎明：晨跑（与工作日同权重）
  [360, 420, 0.12],   // 06:00–07:00 晨跑 / 早餐
  [420, 480, 0.5],    // 07:00–08:00 早餐（无早课高峰）
  [480, 600, 0.5],    // 08:00–10:00 图书馆 / 自习
  [600, 690, 0.62],   // 10:00–11:30 出行 / 活动
  [690, 780, 0.9],    // 11:30–13:00 ★午间高峰
  [780, 900, 0.62],   // 13:00–15:00 下午活动
  [900, 1020, 0.68],  // 15:00–17:00 ★体育 / 社团活动
  [1020, 1110, 0.8],  // 17:00–18:30 ★晚饭高峰
  [1110, 1260, 0.6],  // 18:30–21:00 晚间活动
  [1260, 1320, 0.55], // 21:00–22:00
  [1320, 1380, 0.2],  // 22:00–23:00
  [1380, 1440, 0.08], // 23:00–24:00
])

// ============================================================================
// 1. 时间桶工具
// ============================================================================

/** 两位补零。@param {number} n @returns {string} */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * 把时间戳换算成「校区本地时间」的各字段。
 * 用 UTC getter 读偏移后的时间，从而与运行机器的本地时区无关。
 * @param {number} ts 毫秒时间戳
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, dayOfWeek: number, minuteOfDay: number }}
 *   dayOfWeek：0=周日 … 6=周六；minuteOfDay：0–1439
 */
function campusParts(ts) {
  const shifted = new Date(ts + CAMPUS_UTC_OFFSET_MINUTES * 60 * 1000)
  const hour = shifted.getUTCHours()
  const minute = shifted.getUTCMinutes()
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour,
    minute,
    dayOfWeek: shifted.getUTCDay(),
    minuteOfDay: hour * 60 + minute,
  }
}

/**
 * 由「校区本地时间」字段反算毫秒时间戳（campusParts 的逆运算）。
 * day 允许越界（如 32 / -1），由 Date.UTC 自行进位，便于做日期加减。
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number }} parts
 * @returns {number} 毫秒时间戳
 */
function campusTs(parts) {
  const { year, month, day, hour = 0, minute = 0 } = parts
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0) - CAMPUS_UTC_OFFSET_MINUTES * 60 * 1000
}

/**
 * 把时间戳对齐到所在 15 分钟桶的起始时刻。
 * 因为 CAMPUS_UTC_OFFSET_MINUTES（480）是 15 的整数倍，按 epoch 整除对齐
 * 与按校区本地时刻对齐是同一件事。
 * @param {number} ts 毫秒时间戳
 * @returns {number} 该桶起始时刻的毫秒时间戳
 */
export function alignToBucket(ts) {
  return Math.floor(ts / MS_PER_BUCKET) * MS_PER_BUCKET
}

/**
 * 时间戳 → 当天第几个 15 分钟桶（0–95，按校区本地时间）。
 * @param {number} ts 毫秒时间戳
 * @returns {number} 0–95 的桶序号
 */
export function bucketIndex(ts) {
  return Math.floor(campusParts(ts).minuteOfDay / BUCKET_MINUTES)
}

/**
 * 时间戳 → 校区本地日期键 `YYYY-MM-DD`。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 如 `2026-09-28`
 */
function dateKeyOf(ts) {
  const p = campusParts(ts)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/**
 * 时间戳 → 所在 15 分钟桶的起始时钟 `HH:mm`（按校区本地时间）。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 如 `14:15`
 */
function clockOf(ts) {
  const p = campusParts(alignToBucket(ts))
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/**
 * 时间戳 → 中文星期。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 如 `周五`
 */
function weekdayLabelOf(ts) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][campusParts(ts).dayOfWeek]
}

/**
 * 路段键：`edgeId@YYYY-MM-DDTHH:mm`，其中时刻是**所在 15 分钟桶的起始时刻**
 * （校区本地时间）。作为「边 × 桶」的唯一稳定字符串键，可直接做 Map/对象键、日志键。
 * @param {string} edgeId 路段 id，如 `outer_s2→outer_s3`
 * @param {number} ts 毫秒时间戳（桶内任意时刻都会被对齐到桶起点）
 * @returns {string} 如 `outer_s2→outer_s3@2026-09-28T14:15`
 */
export function bucketKey(edgeId, ts) {
  return `${edgeId}@${dateKeyOf(ts)}T${clockOf(ts)}`
}

/**
 * 「同时段」键（**跨日期比较用**）：`d<星期几>@HH:mm`，含星期几信息。
 * 基线模块用它把「上周五 14:15」和「本周五 14:15」归到同一个槽位 ——
 * 校园流量强烈依赖星期几（周五下午 vs 周日下午完全不是一回事）。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 如 `d5@14:15`（周五 14:15）
 */
export function sameSlotKey(ts) {
  return `d${campusParts(ts).dayOfWeek}@${clockOf(ts)}`
}

/**
 * 「全周同刻」槽位键（星期几通配）：`d*@HH:mm`。
 * 用途：真实部署里 7 天窗口内每个「星期几精确槽」只有 1 个样本（sampleDays = 1），
 * 达不到 minDays → 基线表会把它标成 insufficient。此时 getBaseline 回退到本键
 * 对应的槽位（把一周 7 天的同一时刻放在一起算中位数，样本 7 天）。
 * 数据攒够 3 周以上后，星期几精确槽会自动变得可用，无需改代码。
 * @param {number} ts 毫秒时间戳
 * @returns {string} 如 `d*@14:15`
 */
export function sameSlotKeyAnyDay(ts) {
  return `${SLOT_ANY_DAY_MARK}@${clockOf(ts)}`
}

/**
 * 反向解析路段键（bucketKey 的逆运算）。
 * @param {string} key 形如 `outer_s2→outer_s3@2026-09-28T14:15` 的稳定键
 * @returns {{ edgeId: string, ts: number, dateKey: string, clock: string, bucketIndex: number,
 *   dayOfWeek: number, weekdayLabel: string, slotKey: string, anyDaySlotKey: string, valid: boolean } | null}
 *   解析失败返回 null；时刻不是 15 分钟整数倍时仍返回结果但 valid = false
 */
export function parseBucketKey(key) {
  if (typeof key !== 'string') return null
  const at = key.lastIndexOf('@')
  if (at <= 0 || at === key.length - 1) return null
  const edgeId = key.slice(0, at)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(key.slice(at + 1))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const ts = campusTs({ year, month, day, hour, minute })
  return {
    edgeId,
    ts,
    dateKey: `${match[1]}-${match[2]}-${match[3]}`,
    clock: `${match[4]}:${match[5]}`,
    bucketIndex: bucketIndex(ts),
    dayOfWeek: campusParts(ts).dayOfWeek,
    weekdayLabel: weekdayLabelOf(ts),
    slotKey: sameSlotKey(ts),
    anyDaySlotKey: sameSlotKeyAnyDay(ts),
    valid: hour < 24 && minute < 60 && minute % BUCKET_MINUTES === 0,
  }
}

/**
 * 反向解析「同时段」键（sameSlotKey / sameSlotKeyAnyDay 的逆运算）。
 * @param {string} slotKey 形如 `d5@14:15` 或 `d*@14:15`
 * @returns {{ dayOfWeek: number | null, anyDay: boolean, clock: string, minuteOfDay: number,
 *   bucketIndex: number, valid: boolean } | null} 解析失败返回 null
 */
export function parseSlotKey(slotKey) {
  if (typeof slotKey !== 'string') return null
  const match = /^d(\*|[0-6])@(\d{2}):(\d{2})$/.exec(slotKey)
  if (!match) return null
  const hour = Number(match[2])
  const minute = Number(match[3])
  return {
    dayOfWeek: match[1] === '*' ? null : Number(match[1]),
    anyDay: match[1] === '*',
    clock: `${match[2]}:${match[3]}`,
    minuteOfDay: hour * 60 + minute,
    bucketIndex: Math.floor((hour * 60 + minute) / BUCKET_MINUTES),
    valid: hour < 24 && minute < 60 && minute % BUCKET_MINUTES === 0,
  }
}

/**
 * 把任意时间表示转成毫秒时间戳。
 * 支持：数字（原样）、Date、`YYYY-MM-DD`（校区本地 00:00）、`YYYY-MM-DDTHH:mm`。
 * @param {number | string | Date} value 时间表示
 * @returns {number} 毫秒时间戳；无法识别时抛 TypeError
 */
function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (dateOnly) {
      return campusTs({ year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) })
    }
    const parsed = parseBucketKey(`_@${value}`)
    if (parsed) return parsed.ts
  }
  throw new TypeError(`无法识别的时间表示：${String(value)}（支持毫秒时间戳 / Date / 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm'）`)
}

/** 数值四舍五入到指定小数位。@param {number} value @param {number} [digits] @returns {number} */
function roundTo(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 夹取到 [min, max]。@param {number} value @param {number} min @param {number} max @returns {number} */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// ============================================================================
// 2. 统计工具（中位数 / MAD / 稳健 Z-score）
// ============================================================================

/** 取出数组里的有限数值。@param {unknown} values @returns {number[]} */
function finiteNumbers(values) {
  if (!Array.isArray(values)) return []
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * 中位数。**基线计算的唯一口径** —— 不用均值的原因见 buildBaseline 注释。
 * @param {number[]} values 数值数组（空数组或非数组返回 null）
 * @returns {number | null} 中位数；偶数个取中间两个的平均
 */
export function median(values) {
  const nums = finiteNumbers(values).slice().sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = nums.length >> 1
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

/**
 * 中位绝对偏差 MAD = median(|xᵢ − median(x)|)。
 * 稳健离散度：一次运动会/一次封路把某个值拉爆，MAD 也几乎不动，
 * 而标准差会被一个离群点直接带飞，导致闸门失效。
 * @param {number[]} values 数值数组
 * @returns {number | null} MAD；空数组返回 null
 */
export function mad(values) {
  const nums = finiteNumbers(values)
  const center = median(nums)
  if (center === null) return null
  return median(nums.map((value) => Math.abs(value - center)))
}

/**
 * 平均绝对偏差 MD = mean(|xᵢ − median(x)|)，仅作为 MAD = 0 时的回退尺度。
 * @param {number[]} nums 有限数值数组
 * @param {number} center 中心（中位数）
 * @returns {number} 平均绝对偏差
 */
function meanAbsDeviation(nums, center) {
  if (nums.length === 0) return 0
  const total = nums.reduce((sum, value) => sum + Math.abs(value - center), 0)
  return total / nums.length
}

/**
 * 稳健 Z-score：`z = 0.6745 × (value − median) / MAD`。
 *
 * MAD 为 0 时的处理（**明确写清并防除零**）：
 *   1. 先用「平均绝对偏差」当回退尺度：σ ≈ 1.2533 × MD；
 *   2. 若平均绝对偏差也是 0（历史序列完全恒定），说明偏离在 MAD 口径下是无穷大，
 *      此时 value === median 返回 0，否则返回有限哨兵 CONSTANT_SERIES_Z（±99），
 *      调用方按「远超阈值」处理（不返回 ±Infinity，保证 JSON 可序列化）；
 *   3. 历史样本数 < 3 或 value 非有限数 → 返回 null（算不出来，不要硬判）。
 * @param {number} value 当前观测值（人次）
 * @param {number[]} series 同时段历史观测序列（人次）
 * @returns {number | null} 稳健 Z-score，或 null 表示样本不足无法计算
 */
export function robustZScore(value, series) {
  const nums = finiteNumbers(series)
  if (!Number.isFinite(value) || nums.length < MIN_Z_SCORE_SAMPLES) return null
  const center = median(nums)
  if (center === null) return null
  let scale = mad(nums)
  if (scale === 0) scale = MEAN_ABS_DEV_TO_SIGMA * meanAbsDeviation(nums, center)
  if (scale === 0) {
    if (value === center) return 0
    return value > center ? CONSTANT_SERIES_Z : -CONSTANT_SERIES_Z
  }
  return roundTo((MAD_TO_SIGMA * (value - center)) / scale)
}

// ============================================================================
// 3. 同时段基线
// ============================================================================

/**
 * 拼基线表键：`edgeId@slotKey`（如 `outer_s2→outer_s3@d5@14:15`）。
 * @param {string} edgeId 路段 id
 * @param {string} slotKey 同时段键（`d5@14:15` 或 `d*@14:15`）
 * @returns {string} 基线表键
 */
function baselineKeyOf(edgeId, slotKey) {
  return `${edgeId}@${slotKey}`
}

/**
 * 拆基线表键。edges 里不含 `@`，故按第一个 `@` 切分。
 * @param {string} key 基线表键
 * @returns {{ edgeId: string, slotKey: string } | null}
 */
function splitBaselineKey(key) {
  const at = key.indexOf('@')
  if (at <= 0 || at === key.length - 1) return null
  return { edgeId: key.slice(0, at), slotKey: key.slice(at + 1) }
}

/**
 * 构建「边 × 同时段」基线表（设计文档 §7 ②）。
 *
 * ★ 为什么**必须用中位数而不是均值**：
 *   一次运动会 / 一次开学 / 一次校庆能把某条路的某个时段流量整体拉高，
 *   均值会被这几天拽上去，之后**天天误报**「异常偏高」；
 *   中位数只看排序中间的那个值，少数异常日几乎不影响它。
 *   （自检里有一条专门验证：注入一次 4 倍尖峰后中位数几乎不动，均值被拉高 > 20%。）
 *
 * 输出结构：普通对象（JSON 友好），键为 `edgeId@slotKey`，值为
 * ```
 * {
 *   edgeId,        // 路段 id
 *   slotKey,       // 'd5@14:15'（星期几精确）或 'd*@14:15'（全周同刻）
 *   median,        // 同时段中位数（人次 / 15 min）
 *   mad,           // 同时段中位绝对偏差（人次 / 15 min）
 *   mean,          // 同时段均值（仅用于对照与排查，**不参与判定**）
 *   sampleDays,    // 参与计算的天数
 *   dayValues,     // 各天的值（原始序列，供 robustZScore 复用，长度 = sampleDays）
 *   nightFactor,   // 夜间系数 = 本槽位中位数 ÷ 该边全天中位数（无量纲，纯诊断用）
 *   granularity,   // 'weekday' = 星期几精确槽；'any-day' = 全周同刻回退槽
 *   insufficient,  // true = 样本不足（sampleDays < minDays），**不能拿来判异常**
 * }
 * ```
 * 同一 (edgeId, 日期, 时刻) 若有多条采样，先按桶求和再按天聚合（防止重复 ping 放大计数）。
 *
 * @param {Array<{ edgeId: string, ts: number, count: number }>} samples 通行采样（单位：人次 / 15 min 桶）
 * @param {{ minDays?: number }} [options] minDays 默认 3：少于 3 天的槽位标记 insufficient
 * @returns {Record<string, object>} 基线表（冻结）；每个槽位额外提供 `key` 便于回查
 */
export function buildBaseline(samples, { minDays = DEFAULT_MIN_BASELINE_DAYS } = {}) {
  if (!Array.isArray(samples)) throw new TypeError('buildBaseline: samples 必须是数组')
  const minDaysValue = Number.isFinite(minDays) && minDays > 0 ? minDays : DEFAULT_MIN_BASELINE_DAYS

  // ① (edgeId, slotKey, 日期) → 当天该槽位的合计人次
  const dailyTotals = new Map()
  const accumulate = (edgeId, slotKey, dateKey, count) => {
    const key = `${edgeId}\u0000${slotKey}\u0000${dateKey}`
    const current = dailyTotals.get(key)
    dailyTotals.set(key, {
      edgeId,
      slotKey,
      dateKey,
      count: (current ? current.count : 0) + count,
    })
  }

  samples.forEach((sample) => {
    if (!sample || typeof sample.edgeId !== 'string') return
    const ts = Number(sample.ts)
    if (!Number.isFinite(ts)) return
    const count = Number.isFinite(sample.count) ? Math.max(0, sample.count) : 0
    const dateKey = dateKeyOf(ts)
    accumulate(sample.edgeId, sameSlotKey(ts), dateKey, count)
    accumulate(sample.edgeId, sameSlotKeyAnyDay(ts), dateKey, count)
  })

  // ② 按 (edgeId, slotKey) 汇总成序列
  const grouped = new Map()
  dailyTotals.forEach((entry) => {
    const key = baselineKeyOf(entry.edgeId, entry.slotKey)
    if (!grouped.has(key)) grouped.set(key, { edgeId: entry.edgeId, slotKey: entry.slotKey, pairs: [] })
    grouped.get(key).pairs.push({ dateKey: entry.dateKey, count: entry.count })
  })

  const table = {}
  const edgeAllValues = new Map()
  grouped.forEach((group, key) => {
    group.pairs.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0))
    const dayValues = group.pairs.map((pair) => pair.count)
    const slot = parseSlotKey(group.slotKey)
    const center = median(dayValues)
    table[key] = {
      key,
      edgeId: group.edgeId,
      slotKey: group.slotKey,
      median: center,
      mad: mad(dayValues),
      mean: roundTo(dayValues.reduce((sum, value) => sum + value, 0) / (dayValues.length || 1), 4),
      sampleDays: dayValues.length,
      dayValues,
      nightFactor: 0,
      granularity: slot && !slot.anyDay ? 'weekday' : 'any-day',
      insufficient: dayValues.length < minDaysValue,
    }
    if (slot && slot.anyDay) {
      if (!edgeAllValues.has(group.edgeId)) edgeAllValues.set(group.edgeId, [])
      edgeAllValues.get(group.edgeId).push(...dayValues)
    }
  })

  // ③ nightFactor：该槽位中位数 ÷ 该边全天（全时段）中位数，纯诊断量
  //    ★ 每条边只算一次全天中位数（否则 2680 个槽位各排一次 672 长度的数组，纯浪费）
  const overallMedianByEdge = new Map()
  edgeAllValues.forEach((values, edgeId) => overallMedianByEdge.set(edgeId, median(values)))
  Object.keys(table).forEach((key) => {
    const entry = table[key]
    const overall = overallMedianByEdge.get(entry.edgeId)
    entry.nightFactor = overall && overall > 0 && entry.median !== null ? roundTo(entry.median / overall, 4) : 0
  })

  return Object.freeze(table)
}

/**
 * 查询某边某时刻的基线。
 * 取值顺序：① 星期几精确槽（`d5@14:15`）→ ② 全周同刻槽（`d*@14:15`）。
 * 任一层若 `insufficient`（sampleDays < minDays）就跳过 —— **样本不足不能拿来判异常**。
 * @param {Record<string, object> | Map<string, object>} baselineTable buildBaseline 的输出
 * @param {string} edgeId 路段 id
 * @param {number} ts 毫秒时间戳
 * @returns {object | null} 基线项（含 median / mad / sampleDays / dayValues / granularity 等）；查不到返回 null
 */
export function getBaseline(baselineTable, edgeId, ts) {
  if (!baselineTable || typeof edgeId !== 'string' || !Number.isFinite(ts)) return null
  const read = (key) => {
    if (baselineTable instanceof Map) return baselineTable.get(key) || null
    return baselineTable[key] || null
  }
  const candidates = [
    baselineKeyOf(edgeId, sameSlotKey(ts)),
    baselineKeyOf(edgeId, sameSlotKeyAnyDay(ts)),
  ]
  for (const key of candidates) {
    const entry = read(key)
    if (entry && !entry.insufficient) return entry
  }
  return null
}

// ============================================================================
// 4. 异常检测
// ============================================================================

/**
 * 时间跨度文案：n 个 15 分钟桶 → 人话（如 `6 小时`、`45 分钟`、`1 小时 30 分钟`）。
 * @param {number} bucketCount 桶数
 * @returns {string} 中文时长
 */
function formatDuration(bucketCount) {
  const totalMinutes = Math.max(0, Math.round(bucketCount)) * BUCKET_MINUTES
  if (totalMinutes < 60) return `${totalMinutes} 分钟`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`
}

/**
 * 百分比文案（如 0.0571 → `5.7%`）。
 * @param {number} ratio 比值
 * @param {number} [digits] 小数位，默认 1
 * @returns {string} 百分比字符串
 */
function formatPercent(ratio, digits = 1) {
  return `${(ratio * 100).toFixed(digits)}%`
}

/**
 * 事件窗口文案：`2026-09-28 08:00 – 14:00（周一）`。
 * @param {number} startTs 起始桶时刻
 * @param {number} endExclusiveTs 结束（开区间）时刻
 * @returns {string} 中文时间段
 */
function formatWindow(startTs, endExclusiveTs) {
  const sameDay = dateKeyOf(startTs) === dateKeyOf(endExclusiveTs - MS_PER_BUCKET)
  const endClock = clockOf(endExclusiveTs - MS_PER_BUCKET + MS_PER_BUCKET)
  const tail = sameDay ? endClock : `${dateKeyOf(endExclusiveTs - MS_PER_BUCKET)} ${endClock}`
  return `${dateKeyOf(startTs)} ${clockOf(startTs)} – ${tail}（${weekdayLabelOf(startTs)}）`
}

/**
 * 严重度评分（0–100）与等级（low / medium / high / critical）。
 * 启发式：中断看**持续时长**（12 小时封顶）与**挖得多深**；拥堵看 Z-score 与量级。
 * 该评分同时被任务卡的 priority 复用（priority 由严重度与持续时间推导）。
 * @param {string} kind ANOMALY_KINDS 之一
 * @param {number} bucketCount 事件桶数
 * @param {number} ratio 观测 / 基线
 * @param {number | null} zScore 最极端桶的稳健 Z-score
 * @returns {{ severity: string, severityScore: number }} 等级与 0–100 分
 */
function computeSeverity(kind, bucketCount, ratio, zScore) {
  let score
  if (kind === ANOMALY_KINDS.INTERRUPTED) {
    const durationPart = Math.min(bucketCount, 24) / 24 // ★ 6 小时（24 桶）封顶：再久也只是「更久没人」，严重度饱和
    const depthPart = 1 - Math.min(ratio / DETECT_DEFAULTS.dropRatio, 1)
    score = 55 * durationPart + 45 * depthPart
  } else {
    const zPart = Math.min(Math.max(zScore === null ? 0 : zScore, 0), 10) / 10
    const ratioPart = Math.min(Math.max(ratio - 1, 0), 5) / 5
    score = 60 * zPart + 40 * ratioPart
  }
  const severityScore = Math.round(clamp(score, 0, 100))
  const severity = severityScore >= 80 ? 'critical' : severityScore >= 60 ? 'high' : severityScore >= 35 ? 'medium' : 'low'
  return { severity, severityScore }
}

/**
 * 校验检测选项：给了就必须是合法数值，否则抛 TypeError（避免静默错判）。
 * @param {unknown} value 选项值
 * @param {number} fallback 默认值
 * @param {string} name 选项名
 * @returns {number} 合法数值
 */
function numericOption(value, fallback, name) {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`detectAnomalies: 选项 ${name} 必须是有限数值，收到 ${String(value)}`)
  }
  return value
}

/**
 * 通行热度异常检测（设计文档 §7 ③）。
 *
 * 判据：
 *   - `interrupted` 疑似中断：**连续 K 个时间片**（默认 2 个 = 30 min）通行量
 *     < 基线中位数 × dropRatio（默认 15%）；
 *   - `congested` 疑似异常拥堵（升级判据）：稳健 Z-score ≥ spikeZ（默认 3.5）
 *     **且** 量级 ≥ 基线 × spikeRatio（默认 3.0）。加量级下限是为了防住
 *     「MAD 很小 → 微小波动也放大成高 Z」的假阳性。
 * 基线 `median <= 0` 的槽位（夜间本来就没车）直接跳过 —— 这就是设计文档 ④ 中
 * 「时段基线」在算法内部的第一道实现；闸门里还有一道 22:00–06:00 的显式排除。
 * 样本不足（insufficient / getBaseline 返回 null）的桶不参与判定，只计入 stats.skipped。
 * 相邻异常桶间隔 > windowBuckets 个桶则切成两次独立事件（容忍零星丢包/抖动）。
 *
 * @param {Array<{ edgeId: string, ts: number, count: number }>} samples 通行采样（人次 / 15 min 桶）
 * @param {Record<string, object> | Map<string, object>} baselineTable buildBaseline 的输出
 * @param {{ dropRatio?: number, consecutiveBuckets?: number, spikeRatio?: number,
 *   windowBuckets?: number, spikeZ?: number }} [options] 判据参数（默认见 DETECT_DEFAULTS）
 * @returns {Array<{ edgeId: string, kind: string, startTs: number, endTs: number, endExclusiveTs: number,
 *   bucketCount: number, spanBuckets: number, baseline: number, observed: number, ratio: number,
 *   baselinePerBucket: number, observedPerBucket: number, zScore: number | null, madRef: number,
 *   sampleDays: number, slotKeys: string[], severity: string, severityScore: number,
 *   windowText: string, evidence: string[] }>} 异常列表（按 startTs 升序）
 */
export function detectAnomalies(samples, baselineTable, options = {}) {
  if (!Array.isArray(samples)) throw new TypeError('detectAnomalies: samples 必须是数组')
  const config = options && typeof options === 'object' ? options : {}
  const dropRatio = numericOption(config.dropRatio, DETECT_DEFAULTS.dropRatio, 'dropRatio')
  const consecutiveBuckets = Math.max(1, Math.round(numericOption(config.consecutiveBuckets, DETECT_DEFAULTS.consecutiveBuckets, 'consecutiveBuckets')))
  const spikeRatio = numericOption(config.spikeRatio, DETECT_DEFAULTS.spikeRatio, 'spikeRatio')
  const windowBuckets = Math.max(0, Math.round(numericOption(config.windowBuckets, DETECT_DEFAULTS.windowBuckets, 'windowBuckets')))
  const spikeZ = numericOption(config.spikeZ, DETECT_DEFAULTS.spikeZ, 'spikeZ')

  // ① 聚合成 (edgeId, 桶) → 人次
  const seriesByEdge = new Map()
  samples.forEach((sample) => {
    if (!sample || typeof sample.edgeId !== 'string') return
    const ts = Number(sample.ts)
    if (!Number.isFinite(ts)) return
    const start = alignToBucket(ts)
    const count = Number.isFinite(sample.count) ? Math.max(0, sample.count) : 0
    if (!seriesByEdge.has(sample.edgeId)) seriesByEdge.set(sample.edgeId, new Map())
    const series = seriesByEdge.get(sample.edgeId)
    series.set(start, (series.get(start) || 0) + count)
  })

  const anomalies = []

  seriesByEdge.forEach((series, edgeId) => {
    const buckets = [...series.keys()].sort((a, b) => a - b)
    const flagged = []
    buckets.forEach((ts) => {
      const baselineEntry = getBaseline(baselineTable, edgeId, ts)
      if (!baselineEntry || baselineEntry.insufficient) return
      const center = baselineEntry.median
      if (!(center > 0)) return // 基线为 0（夜间/常年无人）→ 不判异常
      const observed = series.get(ts) || 0
      const ratio = observed / center
      const zScore = robustZScore(observed, baselineEntry.dayValues)
      const isDrop = ratio < dropRatio
      const isSpike = zScore !== null && zScore >= spikeZ && ratio >= spikeRatio
      if (!isDrop && !isSpike) return
      flagged.push({
        ts,
        observed,
        baseline: center,
        mad: baselineEntry.mad === null ? 0 : baselineEntry.mad,
        ratio,
        zScore,
        sampleDays: baselineEntry.sampleDays,
        slotKey: baselineEntry.slotKey,
        kind: isDrop ? ANOMALY_KINDS.INTERRUPTED : ANOMALY_KINDS.CONGESTED,
      })
    })

    // ② 先按严格连续（相邻桶）切「连续段」，再按 windowBuckets 容忍间隔聚成事件
    const kindOrder = [ANOMALY_KINDS.CONGESTED, ANOMALY_KINDS.INTERRUPTED]
    kindOrder.forEach((kind) => {
      const sameKind = flagged.filter((item) => item.kind === kind)
      const runs = []
      let run = []
      sameKind.forEach((item) => {
        const previous = run[run.length - 1]
        if (previous && item.ts - previous.ts === MS_PER_BUCKET) {
          run.push(item)
        } else {
          if (run.length > 0) runs.push(run)
          run = [item]
        }
      })
      if (run.length > 0) runs.push(run)

      const clusters = []
      runs.forEach((current) => {
        const previous = clusters[clusters.length - 1]
        const previousEnd = previous ? previous[previous.length - 1] : null
        const gap = previousEnd ? current[0].ts - previousEnd.ts : Infinity
        if (previous && gap <= (windowBuckets + 1) * MS_PER_BUCKET) {
          previous.push(...current)
        } else {
          clusters.push([...current])
        }
      })

      clusters.forEach((cluster) => {
        // ③ 连续 K 个时间片是硬门槛（中断按最长连续段算；拥堵同样要求成串，抑制单桶尖刺）
        const longestRun = (() => {
          let best = 1
          let current = 1
          for (let i = 1; i < cluster.length; i += 1) {
            current = cluster[i].ts - cluster[i - 1].ts === MS_PER_BUCKET ? current + 1 : 1
            if (current > best) best = current
          }
          return best
        })()
        if (longestRun < consecutiveBuckets) return

        const startTs = cluster[0].ts
        const endTs = cluster[cluster.length - 1].ts
        const endExclusiveTs = endTs + MS_PER_BUCKET
        const observedTotal = cluster.reduce((sum, item) => sum + item.observed, 0)
        const baselineTotal = cluster.reduce((sum, item) => sum + item.baseline, 0)
        const ratio = baselineTotal > 0 ? observedTotal / baselineTotal : 0
        const zScores = cluster.map((item) => item.zScore).filter((value) => value !== null)
        const zScore = zScores.length === 0
          ? null
          : kind === ANOMALY_KINDS.INTERRUPTED
            ? Math.min(...zScores)
            : Math.max(...zScores)
        const madRef = median(cluster.map((item) => item.mad)) || 0
        const sampleDays = Math.max(...cluster.map((item) => item.sampleDays))
        const bucketCount = cluster.length
        const baselinePerBucket = roundTo(baselineTotal / bucketCount, 4)
        const observedPerBucket = roundTo(observedTotal / bucketCount, 4)
        const { severity, severityScore } = computeSeverity(kind, bucketCount, ratio, zScore)
        const windowText = formatWindow(startTs, endExclusiveTs)
        const durationText = formatDuration(bucketCount)
        const slotKeys = [...new Set(cluster.map((item) => item.slotKey))]

        const evidence = kind === ANOMALY_KINDS.INTERRUPTED
          ? [
            `近 ${durationText}（${bucketCount} 个 15 分钟时间片）该路段通行量 ${observedTotal} 次，基线 ${Math.round(baselineTotal)} 次，仅为基线 ${formatPercent(ratio)}`,
            `判据：连续 ${consecutiveBuckets} 个时间片低于同时段基线 ${formatPercent(dropRatio, 0)}（阈值 ${roundTo(baselinePerBucket * dropRatio, 1)} 次 / 15 min），实际最长连续 ${longestRun} 个时间片低于阈值`,
            `稳健 Z-score（MAD）最低 ${zScore === null ? '不可算（样本不足）' : zScore}，同时段中位数 ${roundTo(baselinePerBucket, 1)} 次，MAD ${roundTo(madRef, 1)}`,
            `基线取自近 ${sampleDays} 天「同时段」中位数（中位数口径，抗运动会/开学等一次性拉高）`,
            `时间窗口：${windowText}`,
          ]
          : [
            `近 ${durationText}（${bucketCount} 个 15 分钟时间片）该路段通行量 ${observedTotal} 次，基线 ${Math.round(baselineTotal)} 次，达到基线的 ${roundTo(ratio, 2)} 倍`,
            `判据：稳健 Z-score ≥ ${spikeZ} 且量级 ≥ 基线 ${spikeRatio} 倍；实测最高 Z = ${zScore === null ? '不可算' : zScore}`,
            `稳健 Z-score（MAD）口径：同时段中位数 ${roundTo(baselinePerBucket, 1)} 次，MAD ${roundTo(madRef, 1)} 次`,
            `基线取自近 ${sampleDays} 天「同时段」中位数（中位数口径，抗一次性拉高）`,
            `时间窗口：${windowText}`,
          ]

        anomalies.push({
          edgeId,
          kind,
          startTs,
          endTs,
          endExclusiveTs,
          bucketCount,
          spanBuckets: (endExclusiveTs - startTs) / MS_PER_BUCKET,
          baseline: roundTo(baselineTotal, 1),
          observed: observedTotal,
          ratio: roundTo(ratio, 4),
          baselinePerBucket,
          observedPerBucket,
          zScore,
          madRef: roundTo(madRef, 2),
          sampleDays,
          slotKeys,
          severity,
          severityScore,
          windowText,
          evidence,
        })
      })
    })
  })

  return anomalies.sort((a, b) => a.startTs - b.startTs || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))
}

/**
 * 把一条异常（或一条任务相关的 anomaly）渲染成可直接打印 / 贴进演示日志的多行中文报告。
 * 证据链可解释是赛事的评分点（方案书「AI 算法设计科学」+ 可信度闸门）。
 * 注：时间窗口已经在 evidence 里（最后一条），这里不再重复一行。
 * @param {object} anomaly detectAnomalies / applyFalsePositiveGates 的产出对象
 * @returns {string} 多行文本（含严重度、证据链、闸门结论与免责声明）
 */
export function formatAnomalyReport(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') return '（无异常）'
  const lines = []
  lines.push(`【${ANOMALY_KIND_LABELS[anomaly.kind] || anomaly.kind}】${anomaly.edgeId}`)
  lines.push(`  严重度：${anomaly.severity || 'unknown'}（${anomaly.severityScore ?? 0}/100）`)
  ;(anomaly.evidence || []).forEach((line) => lines.push(`  · ${line}`))
  if (anomaly.excludedBy) {
    lines.push(`  ✗ 防误报闸门已排除：${anomaly.excludedByLabel || anomaly.excludedBy}`)
    if (anomaly.exclusionNote) lines.push(`    ${anomaly.exclusionNote}`)
  } else if (anomaly.gateNote) {
    lines.push(`  ✓ ${anomaly.gateNote}`)
  }
  lines.push(`  ${INSPECTION_DISCLAIMER}`)
  return lines.join('\n')
}

// ============================================================================
// 5. ★ 防误报闸门（设计文档 §7 ④）
// ============================================================================

/**
 * 把夜间时段配置规范化为「分钟」区间。
 * @param {ReadonlyArray<number> | null | undefined} nightHours `[起始小时, 结束小时]`，
 *   支持小数（22.5 = 22:30）；起始 > 结束表示跨零点；传 null 关闭夜间闸门
 * @returns {{ startMinute: number, endMinute: number } | null} 分钟区间；关闭时返回 null
 */
function normalizeNightHours(nightHours) {
  if (nightHours === null) return null
  const source = Array.isArray(nightHours) && nightHours.length >= 2 ? nightHours : DEFAULT_NIGHT_HOURS
  const start = Number(source[0])
  const end = Number(source[1])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { startMinute: 22 * 60, endMinute: 6 * 60 }
  const toMinute = (hour) => Math.round(clamp(hour, 0, 24) * 60)
  return { startMinute: toMinute(start), endMinute: toMinute(end) }
}

/**
 * 判断某个时间桶是否属于夜间时段（默认 22:00–06:00，跨零点）。
 * **按 15 分钟桶粒度判定**：取桶的**起始时刻**与夜间区间比较，因此
 *   - 21:45 的桶算白天、22:00 的桶算夜间（边界归属明确、可复现）；
 *   - 23:45 与次日 05:45 都算夜间（`minute >= start || minute < end` 正确处理跨零点）；
 *   - 06:00 的桶算白天。
 * @param {number} ts 毫秒时间戳（桶内任意时刻均可）
 * @param {ReadonlyArray<number> | null} [nightHours] 夜间时段，默认 [22, 6]；传 null 关闭
 * @returns {boolean} true = 该桶属于夜间
 */
export function isNightBucket(ts, nightHours = DEFAULT_NIGHT_HOURS) {
  const range = normalizeNightHours(nightHours)
  if (!range) return false
  const minute = campusParts(alignToBucket(ts)).minuteOfDay
  const { startMinute, endMinute } = range
  if (startMinute === endMinute) return false
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute
  return minute >= startMinute || minute < endMinute
}

/**
 * 把「带边与时间窗的记录」规范化：支持数组里混用多种写法。
 * 支持：
 *   - `{ edgeId, startTs, endTs, note?, source? }`
 *   - `{ edgeIds: [...], startTs, endTs }`（多边共用一条通知）
 *   - `{ startTs, endTs }`（不写边 = 全局生效，典型是极端天气）
 *   - startTs / endTs 可用毫秒时间戳、Date、`YYYY-MM-DD`、`YYYY-MM-DDTHH:mm`
 * @param {Array<object>} list 原始记录
 * @param {{ defaultEdgeIds?: string[] | null }} [options] defaultEdgeIds 为空时用的边集合（null = 全局）
 * @returns {Array<{ edgeIds: string[] | null, startTs: number, endTs: number, note: string }>} 规范化窗口
 */
function normalizeWindows(list, { defaultEdgeIds = null } = {}) {
  if (!Array.isArray(list)) return []
  const windows = []
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const edgeIds = Array.isArray(item.edgeIds) && item.edgeIds.length > 0
      ? item.edgeIds.slice()
      : typeof item.edgeId === 'string'
        ? [item.edgeId]
        : defaultEdgeIds
    try {
      const startTs = toTimestamp(item.startTs)
      const endTs = toTimestamp(item.endTs)
      windows.push({
        edgeIds: edgeIds && edgeIds.length > 0 ? edgeIds : null,
        startTs: Math.min(startTs, endTs),
        endTs: Math.max(startTs, endTs),
        note: typeof item.note === 'string' ? item.note : typeof item.source === 'string' ? item.source : '',
      })
    } catch {
      // 时间无法识别 → 这条记录直接忽略（不因脏数据炸掉整条链路）
    }
  })
  return windows
}

/**
 * 把假期列表规范化成「校区本地日期键」集合。
 * 支持 `'2026-10-01'`、`{ date: '2026-10-01', note }`、毫秒时间戳、Date。
 * @param {Array<string | number | Date | object>} list 假期列表
 * @returns {Map<string, string>} 日期键 → 备注
 */
function normalizeHolidays(list) {
  const holidays = new Map()
  if (!Array.isArray(list)) return holidays
  list.forEach((item) => {
    try {
      if (typeof item === 'string') {
        holidays.set(dateKeyOf(toTimestamp(item)), item)
        return
      }
      if (item instanceof Date || typeof item === 'number') {
        holidays.set(dateKeyOf(toTimestamp(item)), '')
        return
      }
      if (item && typeof item === 'object' && item.date !== undefined) {
        holidays.set(dateKeyOf(toTimestamp(item.date)), typeof item.note === 'string' ? item.note : '')
      }
    } catch {
      // 忽略脏数据
    }
  })
  return holidays
}

/**
 * 判断异常窗口与某个时间窗是否有交集（闭区间比较，用 endExclusiveTs 保证半开窗精确）。
 * @param {object} anomaly 异常对象
 * @param {{ edgeIds: string[] | null, startTs: number, endTs: number }} window 规范化窗口
 * @returns {boolean} 是否相交
 */
function overlaps(anomaly, window) {
  if (window.edgeIds && !window.edgeIds.includes(anomaly.edgeId)) return false
  const anomalyEnd = Number.isFinite(anomaly.endExclusiveTs) ? anomaly.endExclusiveTs : anomaly.endTs + MS_PER_BUCKET
  return anomaly.startTs < window.endTs && anomalyEnd > window.startTs
}

/**
 * 列出异常覆盖的校区本地日期键。
 * @param {object} anomaly 异常对象
 * @returns {string[]} 日期键数组（升序去重）
 */
function anomalyDates(anomaly) {
  const end = Number.isFinite(anomaly.endExclusiveTs) ? anomaly.endExclusiveTs : anomaly.endTs + MS_PER_BUCKET
  const dates = []
  for (let ts = alignToBucket(anomaly.startTs); ts < end; ts += MS_PER_BUCKET) {
    const key = dateKeyOf(ts)
    if (dates[dates.length - 1] !== key) dates.push(key)
  }
  return [...new Set(dates)]
}

/**
 * ★ 防误报闸门（设计文档 §7 ④，**必须有**）。
 *
 * 排除已知原因，把「数据看起来不对」和「确实出了事」分开：
 *   官方封闭 / 施工通知 → 时段基线（夜间）→ 假期 → 极端天气 → 已在 blocked_edges 里的边。
 *
 * 判定细节：
 *   - 封闭/施工/天气按**时间窗 × 边**求交集（不写 edgeId 的记录视为全局，典型是暴雨停课）；
 *   - 假期按异常的**覆盖日期**是否落在假期集合里；
 *   - 夜间：**只有整个事件窗口全部落在夜间**才排除（保守策略 —— 宁可多核查一次，
 *     也不放过横跨昼夜的事件）；结果里会带上 `nightBucketRatio` 供 UI 展示；
 *   - 一条异常命中多个原因时，`excludedBy` 取 GATE_ORDER 里第一个，其余记入 `matchedReasons`。
 *
 * 返回的对象都是**新对象**（不修改入参）：每条被排除的异常带
 * `excludedBy` / `excludedByLabel` / `exclusionNote`（中文说明）/ `matchedReasons`；
 * 通过闸门的异常带 `gateNote`（「未命中任何已知原因，建议人工核实」）与 `checkedGates`。
 *
 * @param {Array<object>} anomalies detectAnomalies 的输出
 * @param {{ officialClosures?: Array<object>, constructions?: Array<object>, holidays?: Array<string|object>,
 *   extremeWeatherWindows?: Array<object>, blockedEdgeIds?: string[],
 *   nightHours?: ReadonlyArray<number> | null }} [context] 已知原因上下文
 * @returns {{ confirmed: Array<object>, excluded: Array<object> }} 通过闸门的 / 被排除的异常
 */
export function applyFalsePositiveGates(anomalies, context = {}) {
  const list = Array.isArray(anomalies) ? anomalies : []
  const source = context && typeof context === 'object' ? context : {}
  const closures = normalizeWindows(source.officialClosures)
  const constructions = normalizeWindows(source.constructions)
  const weather = normalizeWindows(source.extremeWeatherWindows)
  const holidays = normalizeHolidays(source.holidays)
  const blockedEdgeIds = Array.isArray(source.blockedEdgeIds) ? source.blockedEdgeIds.slice() : []
  const nightHours = source.nightHours === undefined ? DEFAULT_NIGHT_HOURS : source.nightHours
  const nightEnabled = normalizeNightHours(nightHours) !== null

  const confirmed = []
  const excluded = []

  list.forEach((anomaly) => {
    if (!anomaly || typeof anomaly !== 'object') return
    const matches = []
    const end = Number.isFinite(anomaly.endExclusiveTs) ? anomaly.endExclusiveTs : anomaly.endTs + MS_PER_BUCKET
    const bucketCount = Math.max(1, Math.round((end - alignToBucket(anomaly.startTs)) / MS_PER_BUCKET))

    // ① 官方封闭
    const closure = closures.find((window) => overlaps(anomaly, window))
    if (closure) {
      matches.push({
        reason: EXCLUSION_REASONS.OFFICIAL_CLOSURE,
        note: `官方封闭通知覆盖「${anomaly.edgeId}」的 ${dateKeyOf(closure.startTs)} ${clockOf(closure.startTs)}–${clockOf(closure.endTs)}${closure.note ? `（来源：${closure.note}）` : ''}，该时段本来就该没人经过`,
      })
    }
    // ② 施工通知
    const construction = constructions.find((window) => overlaps(anomaly, window))
    if (construction) {
      matches.push({
        reason: EXCLUSION_REASONS.CONSTRUCTION,
        note: `已发布施工通知覆盖该路段 ${dateKeyOf(construction.startTs)} ${clockOf(construction.startTs)}–${clockOf(construction.endTs)}${construction.note ? `（来源：${construction.note}）` : ''}`,
      })
    }
    // ③ 已在 blocked_edges 里（封路机制已经处理过，重复告警没有信息量）
    if (blockedEdgeIds.includes(anomaly.edgeId)) {
      matches.push({
        reason: EXCLUSION_REASONS.ALREADY_BLOCKED,
        note: `「${anomaly.edgeId}」已在 blocked_edges 中，封路与绕行机制已覆盖，无需重复告警`,
      })
    }
    // ④ 极端天气
    const weatherWindow = weather.find((window) => overlaps(anomaly, window))
    if (weatherWindow) {
      matches.push({
        reason: EXCLUSION_REASONS.EXTREME_WEATHER,
        note: `极端天气窗口 ${dateKeyOf(weatherWindow.startTs)} ${clockOf(weatherWindow.startTs)}–${clockOf(weatherWindow.endTs)}${weatherWindow.note ? `（${weatherWindow.note}）` : ''}，停课/封校导致通行量整体下降`,
      })
    }
    // ⑤ 假期
    const hitDates = anomalyDates(anomaly).filter((dateKey) => holidays.has(dateKey))
    if (hitDates.length > 0) {
      matches.push({
        reason: EXCLUSION_REASONS.HOLIDAY,
        note: `事件覆盖 ${hitDates.join('、')}，属假期（在校人数本来就不足）${holidays.get(hitDates[0]) ? `：${holidays.get(hitDates[0])}` : ''}`,
      })
    }
    // ⑥ 夜间时段（按 15 分钟桶起始时刻判定，正确处理跨零点）
    let nightBucketCount = 0
    if (nightEnabled) {
      for (let ts = alignToBucket(anomaly.startTs); ts < end; ts += MS_PER_BUCKET) {
        if (isNightBucket(ts, nightHours)) nightBucketCount += 1
      }
    }
    const nightBucketRatio = roundTo(nightBucketCount / bucketCount, 4)
    if (nightEnabled && nightBucketCount === bucketCount) {
      const range = normalizeNightHours(nightHours)
      const formatHour = (minute) => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`
      matches.push({
        reason: EXCLUSION_REASONS.NIGHT,
        note: `事件窗口 ${bucketCount} 个时间片「全部」落在夜间时段 ${formatHour(range.startMinute)}–${formatHour(range.endMinute)}，夜间通行本就稀少，属已知原因（时段基线）`,
      })
    }

    if (matches.length > 0) {
      const ordered = GATE_ORDER
        .map((reason) => matches.find((match) => match.reason === reason))
        .filter(Boolean)
      const primary = ordered[0]
      excluded.push({
        ...anomaly,
        excludedBy: primary.reason,
        excludedByLabel: EXCLUSION_REASON_LABELS[primary.reason],
        exclusionNote: primary.note,
        matchedReasons: ordered.map((match) => match.reason),
        matchedReasonLabels: ordered.map((match) => EXCLUSION_REASON_LABELS[match.reason]),
        nightBucketRatio,
        gateCheckedAt: 'gate:false-positive',
      })
    } else {
      confirmed.push({
        ...anomaly,
        nightBucketRatio,
        checkedGates: GATE_ORDER.slice(),
        gateNote: '未命中任何已知原因（无封闭/施工/假期/极端天气记录，且不在 blocked_edges 与夜间时段），建议人工核实',
        gateCheckedAt: 'gate:false-positive',
      })
    }
  })

  return { confirmed, excluded }
}

// ============================================================================
// 6. ★ 产出「建议核查」任务（绝不自动发布，设计文档 §7 ⑤）
// ============================================================================

/**
 * 由节点 id 推「区域中文名」（占位映射，真实部署应改为从 roadNetwork 的节点元数据取）。
 * @param {string} nodeId 道路节点 id，如 `outer_se3`
 * @returns {string} 区域中文名，如 `东南外环`
 */
function nodeAreaLabel(nodeId) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return '校园道路'
  if (nodeId === 'axis_gate' || nodeId === 'axis_south') return '主校门'
  if (nodeId.startsWith('axis_')) return '中轴大道'
  if (nodeId.startsWith('outer_s_e') || nodeId.startsWith('outer_se')) return '东南外环'
  if (nodeId.startsWith('outer_sw') || nodeId.startsWith('outer_s_w') || nodeId.startsWith('outer_s')) return '南段外环'
  if (nodeId.startsWith('outer_ne') || nodeId.startsWith('outer_e')) return '东段外环'
  if (nodeId === 'outer_n' || nodeId.startsWith('outer_nw')) return '北段外环'
  if (nodeId.startsWith('outer_w')) return '西段外环'
  if (nodeId.startsWith('inner_e')) return '内环东段'
  if (nodeId.startsWith('inner_w')) return '内环西段'
  if (nodeId.startsWith('inner')) return '内环'
  if (nodeId.startsWith('ring_')) return '智慧环廊'
  if (nodeId.startsWith('ew_')) return '东西主路'
  if (nodeId.startsWith('rad_')) return '放射支路'
  if (nodeId.startsWith('dorm_access_')) return '生活区道路'
  if (nodeId.startsWith('sport_access_')) return '运动区道路'
  return '校园道路'
}

/**
 * 由路段 id 生成人话标签（用于任务卡标题）：`东南外环 outer_se3→outer_se4`。
 * edgeMeta 里给了 `area` 就用它，否则由两端节点 id 推导；两端区域不同则用 `A · B`。
 * @param {string} edgeId 路段 id（形如 `from→to`）
 * @param {Record<string, { area?: string }>} [edgeMeta] 路段元数据表
 * @returns {{ edgeLabel: string, areaLabel: string, from: string, to: string }} 标签信息
 */
function describeEdge(edgeId, edgeMeta = {}) {
  const parts = String(edgeId).split('→')
  const from = parts[0] || edgeId
  const to = parts.length > 1 ? parts.slice(1).join('→') : ''
  const meta = edgeMeta && typeof edgeMeta === 'object' ? edgeMeta[edgeId] : null
  const derived = to && nodeAreaLabel(from) !== nodeAreaLabel(to)
    ? `${nodeAreaLabel(from)} · ${nodeAreaLabel(to)}`
    : nodeAreaLabel(from)
  const areaLabel = meta && typeof meta.area === 'string' && meta.area ? meta.area : derived
  return {
    edgeLabel: to ? `${areaLabel} ${from}→${to}` : `${areaLabel} ${from}`,
    areaLabel,
    from,
    to,
  }
}

/**
 * 由严重度评分推优先级（**priority 由严重度与持续时间推导** —— severityScore 里
 * 已经含了持续时间权重，见 computeSeverity），再按任务类型微调：
 * 巡查派单最急（人到现场才有信息），众包悬赏最缓（顺手看一眼），官方核查居中。
 * @param {number} severityScore 0–100 严重度评分
 * @param {string} kind TASK_KINDS 之一
 * @returns {{ priority: string, slaHours: number }} 优先级与时限
 */
function priorityFor(severityScore, kind) {
  let priority = severityScore >= 80 ? TASK_PRIORITY.P1 : severityScore >= 55 ? TASK_PRIORITY.P2 : TASK_PRIORITY.P3
  if (kind === TASK_KINDS.CROWDSOURCE) {
    priority = priority === TASK_PRIORITY.P1 ? TASK_PRIORITY.P2 : priority === TASK_PRIORITY.P2 ? TASK_PRIORITY.P3 : TASK_PRIORITY.P3
  }
  if (kind === TASK_KINDS.OFFICIAL_CHECK && priority === TASK_PRIORITY.P1) priority = TASK_PRIORITY.P2
  return { priority, slaHours: TASK_SLA_HOURS[priority] }
}

/** 时间戳 → 校区本地 `YYYY-MM-DDTHH:mm`。@param {number} ts @returns {string} */
function formatLocalStamp(ts) {
  return `${dateKeyOf(ts)}T${clockOf(ts)}`
}

/** 路段 id → 可安全用作 DOM id / 文件名的 slug。@param {string} edgeId @returns {string} */
function edgeSlug(edgeId) {
  return String(edgeId).replace(/[^0-9A-Za-z_]+/g, '-').replace(/^-+|-+$/g, '')
}

/** 巡查派单文案模板。@param {object} ctx @returns {string} */
function patrolTitle(ctx) {
  return ctx.anomaly.kind === ANOMALY_KINDS.INTERRUPTED
    ? `「${ctx.label}」近 ${ctx.durationText}无人经过，请前往确认`
    : `「${ctx.label}」通行量异常偏高（约同时段的 ${roundTo(ctx.anomaly.ratio, 1)} 倍），请前往疏导确认`
}

/** 众包悬赏文案模板。@param {object} ctx @returns {string} */
function crowdsourceTitle(ctx) {
  return ctx.anomaly.kind === ANOMALY_KINDS.INTERRUPTED
    ? `路过「${ctx.label}」的同学，帮忙看一眼是不是封路/施工了`
    : `路过「${ctx.label}」的同学，帮忙看一下是不是有活动或聚集`
}

/** 官方源核查文案模板。@param {object} ctx @returns {string} */
function officialTitle(ctx) {
  return `核实「${ctx.label}」是否已有官方封闭/施工/活动通知`
}

/**
 * ★ 产出「建议核查」任务卡（设计文档 §7 ⑤）。
 *
 * **绝不自动发布**：本函数只产出**内部流转**的建议核查任务，每条任务都带
 * INSPECTION_DISCLAIMER 免责声明与 `status: 'proposed'`，必须由人确认后
 * 才可能进入事件发布流程（`实时输入接入设计.md` §4.3 安全类强制闸门）。
 *
 * 任务编排（按异常类型）：
 *   - `interrupted` → 巡查派单（保卫/后勤）+ 众包悬赏（附近学生）+ 官方源交叉验证
 *   - `congested` → 巡查派单（现场疏导）+ 官方源交叉验证；严重度 high 以上再加众包
 *
 * 任务卡结构：`{ id, kind, edgeId, edgeLabel, priority, title, detail, suggestReporter,
 *   template, deadline, ... }`，其中 deadline 是**建议完成时间**（校区本地 ISO 字符串
 *   `YYYY-MM-DDTHH:mm`），基准时间取 `options.nowTs`，缺省用所有异常的**最晚结束时刻**
 *   （踩固定基准时间才能保证演示可复现）。
 *
 * @param {Array<object>} confirmedAnomalies applyFalsePositiveGates 的 confirmed（或未过闸门的原始异常）
 * @param {{ edgeMeta?: Record<string, { area?: string, nearby?: ReadonlyArray<string>, patrolUnit?: string }>,
 *   nowTs?: number }} [options] edgeMeta 路段元数据（中文名/附近地标/责任巡逻岗）；nowTs 基准时间
 * @returns {Array<object>} 任务卡数组（按优先级、开始时间排序）
 */
export function buildInspectionTasks(confirmedAnomalies, { edgeMeta = {}, nowTs } = {}) {
  const list = (Array.isArray(confirmedAnomalies) ? confirmedAnomalies : [])
    .filter((item) => item && typeof item === 'object' && typeof item.edgeId === 'string')
    .slice()
    .sort((a, b) => a.startTs - b.startTs || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))
  const meta = edgeMeta && typeof edgeMeta === 'object' ? edgeMeta : {}
  const referenceTs = Number.isFinite(nowTs)
    ? nowTs
    : list.reduce((latest, item) => {
      const end = Number.isFinite(item.endExclusiveTs) ? item.endExclusiveTs : item.endTs + MS_PER_BUCKET
      return Math.max(latest, end)
    }, 0)

  const tasks = []
  list.forEach((anomaly) => {
    const { edgeLabel, areaLabel, from, to } = describeEdge(anomaly.edgeId, meta)
    const edgeInfo = meta[anomaly.edgeId] || {}
    const nearby = Array.isArray(edgeInfo.nearby) && edgeInfo.nearby.length > 0 ? edgeInfo.nearby.join('、') : '该路段沿线'
    const patrolUnit = typeof edgeInfo.patrolUnit === 'string' && edgeInfo.patrolUnit ? edgeInfo.patrolUnit : `${areaLabel}巡逻岗`
    const durationText = formatDuration(anomaly.bucketCount || 1)
    const isInterrupted = anomaly.kind === ANOMALY_KINDS.INTERRUPTED
    const kindLabel = ANOMALY_KIND_LABELS[anomaly.kind] || anomaly.kind
    const evidenceText = (anomaly.evidence || []).map((line) => `    · ${line}`).join('\n')
    const ctx = { anomaly, label: edgeLabel, durationText, areaLabel, from, to }
    const kinds = isInterrupted
      ? [TASK_KINDS.PATROL, TASK_KINDS.CROWDSOURCE, TASK_KINDS.OFFICIAL_CHECK]
      : (anomaly.severity === 'high' || anomaly.severity === 'critical'
        ? [TASK_KINDS.PATROL, TASK_KINDS.CROWDSOURCE, TASK_KINDS.OFFICIAL_CHECK]
        : [TASK_KINDS.PATROL, TASK_KINDS.OFFICIAL_CHECK])

    kinds.forEach((kind) => {
      const { priority, slaHours } = priorityFor(anomaly.severityScore || 0, kind)
      const deadlineTs = referenceTs + slaHours * 60 * 60 * 1000
      const common = {
        edgeId: anomaly.edgeId,
        edgeLabel,
        areaLabel,
        priority,
        priorityLabel: TASK_PRIORITY_LABELS[priority],
        slaHours,
        deadline: formatLocalStamp(deadlineTs),
        deadlineTs,
        anomalyKind: anomaly.kind,
        anomalyKindLabel: kindLabel,
        severity: anomaly.severity || 'low',
        severityScore: anomaly.severityScore || 0,
        windowText: anomaly.windowText || '',
        evidence: (anomaly.evidence || []).slice(),
        status: 'proposed',
        requiresHumanReview: true,
        disclaimer: INSPECTION_DISCLAIMER,
      }

      if (kind === TASK_KINDS.PATROL) {
        tasks.push({
          ...common,
          id: `task-${TASK_KINDS.PATROL}-${edgeSlug(anomaly.edgeId)}-${anomaly.startTs}`,
          kind,
          kindLabel: TASK_KIND_LABELS[kind],
          title: patrolTitle(ctx),
          detail: [
            `位置：${edgeLabel}（${from} → ${to}），附近地标：${nearby}`,
            `情况：${kindLabel}，时间窗口 ${anomaly.windowText}。`,
            isInterrupted
              ? `数据：近 ${durationText}该路段通行量 ${anomaly.observed} 次，同时段基线 ${anomaly.baseline} 次，仅为基线的 ${formatPercent(anomaly.ratio)}。`
              : `数据：近 ${durationText}该路段通行量 ${anomaly.observed} 次，同时段基线 ${anomaly.baseline} 次，约为基线的 ${roundTo(anomaly.ratio, 2)} 倍。`,
            isInterrupted
              ? '请现场确认：是否已封闭/围挡、是否有施工或活动占用、是否有人员受伤或滞留、是否只是采样设备掉线。'
              : '请现场确认：是否有大型活动、聚集、商贩占道或事故，需要疏导则联系保卫处指挥中心。',
            '已排除的已知原因：无（本任务未命中官方封闭/施工/假期/极端天气/夜间时段/blocked_edges）。',
            `证据链：\n${evidenceText}`,
            INSPECTION_DISCLAIMER,
          ].join('\n'),
          suggestReporter: `保卫处 · ${patrolUnit}`,
          template: [
            '【现场核查回执】',
            `路段：${edgeLabel}`,
            '到场时间：【 】  核查人：【 】',
            '现场情况（单选）：□ 正常通行，无人无车  □ 已封闭/围挡  □ 施工占用  □ 活动占用  □ 事故  □ 采样设备故障  □ 其他【 】',
            '现场照片：【 】（至少 1 张，含路段特征物）',
            '初步结论：□ 无异常，可关闭  □ 确有异常，转事件上报（附类型与影响范围）',
            '备注：【 】',
          ].join('\n'),
        })
        return
      }

      if (kind === TASK_KINDS.CROWDSOURCE) {
        tasks.push({
          ...common,
          id: `task-${TASK_KINDS.CROWDSOURCE}-${edgeSlug(anomaly.edgeId)}-${anomaly.startTs}`,
          kind,
          kindLabel: TASK_KIND_LABELS[kind],
          title: crowdsourceTitle(ctx),
          detail: [
            `我们注意到「${edgeLabel}」（${nearby} 一带）在 ${anomaly.windowText} 的通行量${isInterrupted ? '明显低于' : '明显高于'}平时。`,
            '不用专门跑一趟 —— 如果你正好路过，顺手拍一张、说一句就行。',
            `核实有效的上报会计入贡献积分（本次 ${priority === TASK_PRIORITY.P3 ? 10 : 20} 分）。`,
            INSPECTION_DISCLAIMER,
          ].join('\n'),
          suggestReporter: `附近学生（众包悬赏，核实有效计 ${priority === TASK_PRIORITY.P3 ? 10 : 20} 贡献积分）`,
          template: [
            '【路过帮看一眼 · 上报模板】',
            '① 你现在看到的情况（单选）：□ 正常通行  □ 封路/围挡  □ 施工  □ 人多拥挤  □ 活动/集会  □ 看不清',
            '② 现场照片 1 张（拍路面 + 一个好认的参照物，如校门/食堂招牌）',
            '③ 一句话描述：【 】',
            '④ 定位：可在地图上点选锚点（默认已带该路段）',
            '提示：注意安全，不要进入围挡区域，不要与现场人员冲突。',
          ].join('\n'),
        })
        return
      }

      tasks.push({
        ...common,
        id: `task-${TASK_KINDS.OFFICIAL_CHECK}-${edgeSlug(anomaly.edgeId)}-${anomaly.startTs}`,
        kind,
        kindLabel: TASK_KIND_LABELS[kind],
        title: officialTitle(ctx),
        detail: [
          `系统在「${edgeLabel}」检测到${kindLabel}（${anomaly.windowText}）。`,
          '请检索校内官方渠道是否已有对应说明：保卫处通知 / 后勤保障部施工公告 / 教务处调课通知 / 校办公告 / 天气预警 / 校历假期。',
          '判定规则：有官方说明 → 关闭本任务并引用来源；无官方说明 → 升级为「待人工确认」，转交安全管理员决策是否发布。',
          `证据链：\n${evidenceText}`,
          INSPECTION_DISCLAIMER,
        ].join('\n'),
        suggestReporter: '安全管理值班员 · 官方源交叉验证',
        template: [
          '【官方源核查记录】',
          `路段：${edgeLabel}    时间窗口：${anomaly.windowText}`,
          '已检索渠道（勾选）：□ 保卫处通知  □ 后勤施工公告  □ 教务处调课  □ 校办公告  □ 天气预警  □ 校历/假期',
          '命中结果：□ 有官方说明（链接/编号：【 】，结论：已知原因，关闭）  □ 无官方说明（→ 升级「待人工确认」）',
          '核查人：【 】  核查时间：【 】',
        ].join('\n'),
      })
    })
  })

  const priorityRank = { [TASK_PRIORITY.P1]: 0, [TASK_PRIORITY.P2]: 1, [TASK_PRIORITY.P3]: 2 }
  return tasks.sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority]
    || b.severityScore - a.severityScore
    || a.deadlineTs - b.deadlineTs
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ============================================================================
// 7. 合成演示数据（★ 演示期的正当做法：虚量数据的正确用法）
// ============================================================================

/**
 * mulberry32 —— 32 位确定性伪随机数发生器（PRNG），自带实现、零依赖。
 * 同一 seed 在任何机器上产生完全相同的序列，保证演示数据可复现。
 * @param {number} seed 32 位整数种子
 * @returns {() => number} 调用一次返回 [0, 1) 区间的伪随机数
 */
export function mulberry32(seed) {
  let state = (Number(seed) || 0) >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 由节律段表生成 96 长度的权重表（台阶函数，段格式 [起始分钟, 结束分钟, 权重]）。
 * @param {ReadonlyArray<ReadonlyArray<number>>} segments 节律段表
 * @returns {number[]} 长度 96 的权重数组（索引 = 当天第几个 15 分钟桶）
 */
function buildRhythmTable(segments) {
  const table = new Array(BUCKETS_PER_DAY).fill(0)
  for (let index = 0; index < BUCKETS_PER_DAY; index += 1) {
    const minute = index * BUCKET_MINUTES
    const hit = segments.find((segment) => minute >= segment[0] && minute < segment[1])
    table[index] = hit ? hit[2] : 0
  }
  return table
}

/**
 * 生成合成通行日志（设计文档「演示期边界」的正当解法：合成 7 天日志 + 注入异常）。
 *
 * 数据模型：`人次 = 该边高峰量级 × 作息节律权重 × 当日波动因子 × (1 + 桶内噪声)`
 *   - **作息节律**（工作日 / 周末两套，见 WEEKDAY_RHYTHM_SEGMENTS / WEEKEND_RHYTHM_SEGMENTS）：
 *     早课高峰 07:30–08:00、课间小峰 09:50–10:10、午间高峰 11:30–13:00、
 *     晚课高峰 17:30–18:30、晚自习下课小峰 21:30–22:00、夜间低谷 22:00–06:00
 *     （00:00–05:00 建模为 0 —— 深夜无人通行，也让「夜间基线为 0 不判异常」这条
 *      设计意图在数据里自然成立）；
 *   - **工作日 vs 周末**：周末无早课高峰，上午更平，下午 15:00–18:30 是体育/社团高峰；
 *     两侧同一时刻的权重比刻意限制在 0.5–1.5 量级，避免「全周同刻」基线自己造出误报；
 *   - **当日波动因子** ∈ [0.9, 1.1]（天气/活动）；**桶内噪声** ∈ ±15%（3 个均匀分布求和）；
 *   - 期望值 > 0 的桶至少取 1（不会凭空出现 0 通行的白天桶 → 不制造假中断）。
 * 全部随机数来自 mulberry32，`seed` 相同 → 输出逐字节一致；`endTs` 默认取固定日期
 * （DEMO_END_TS = 2026-09-28 16:00）而不是 `Date.now()`，因此演示可复现。
 *
 * @param {{ days?: number, edgeIds?: ReadonlyArray<string>, endTs?: number, seed?: number }} [options]
 *   days 天数（默认 7，对应 E-13 标准规模）；edgeIds 路段清单（默认 DEFAULT_EDGE_IDS）；
 *   endTs 数据末尾时间戳（默认 DEMO_END_TS）；seed 随机种子（默认 20260928）
 * @returns {Array<{ edgeId: string, ts: number, count: number, source: string }>}
 *   采样数组，一条 = 一个 (路段 × 15 min 桶) 的人次；ts 为桶起始时刻
 */
export function generateSyntheticTrafficLog({
  days = DEMO_DAYS,
  edgeIds = DEFAULT_EDGE_IDS,
  endTs = DEMO_END_TS,
  seed = DEMO_SEED,
} = {}) {
  const dayCount = Math.max(1, Math.round(Number.isFinite(days) ? days : DEMO_DAYS))
  const ids = Array.isArray(edgeIds) && edgeIds.length > 0 ? edgeIds.slice() : DEFAULT_EDGE_IDS.slice()
  const lastBucket = alignToBucket(Number.isFinite(endTs) ? endTs : DEMO_END_TS)
  const random = mulberry32(seed)

  // 先抽「每日波动因子」，再抽桶内噪声 —— 固定抽取顺序 = 固定结果
  const dayFactors = []
  for (let day = 0; day < dayCount; day += 1) dayFactors.push(0.9 + random() * 0.2)

  // 每条边的量级：已知路段用占位标定值，未知路段按种子派生（保证自定义 edgeIds 也能跑）
  const peakByEdge = new Map()
  ids.forEach((edgeId) => {
    const spec = DEFAULT_EDGE_SPECS[edgeId]
    peakByEdge.set(edgeId, spec ? spec.peak : 60 + Math.round(random() * 240))
  })

  const weekdayTable = buildRhythmTable(WEEKDAY_RHYTHM_SEGMENTS)
  const weekendTable = buildRhythmTable(WEEKEND_RHYTHM_SEGMENTS)
  const totalBuckets = dayCount * BUCKETS_PER_DAY
  const samples = []

  for (let offset = totalBuckets - 1; offset >= 0; offset -= 1) {
    const ts = lastBucket - offset * MS_PER_BUCKET
    const parts = campusParts(ts)
    const isWeekend = parts.dayOfWeek === 0 || parts.dayOfWeek === 6
    const weight = (isWeekend ? weekendTable : weekdayTable)[bucketIndex(ts)]
    const dayIndex = Math.min(dayCount - 1, Math.floor((totalBuckets - 1 - offset) / BUCKETS_PER_DAY))
    const dayFactor = dayFactors[dayIndex]
    ids.forEach((edgeId) => {
      const expected = peakByEdge.get(edgeId) * weight * dayFactor
      if (expected <= 0) {
        samples.push({ edgeId, ts, count: 0, source: 'synthetic' })
        return
      }
      const noise = ((random() + random() + random()) / 1.5 - 1) * 0.15
      samples.push({ edgeId, ts, count: Math.max(1, Math.round(expected * (1 + noise))), source: 'synthetic' })
    })
  }

  return samples
}

/**
 * 向日志注入异常（演示「机制」用；真实部署里这个函数只用于压测与演练）。
 * **不修改入参**：返回新的采样数组（元素也是新对象），并按 ts、edgeId 升序排序。
 * drop 模式把桶计数写成 `spec.value`（默认 0 = 完全无人经过，也可以写 1/2 模拟「几乎没人」）；
 * spike 模式把原计数乘以 `spec.spikeFactor`（默认 4）。若目标桶在日志里不存在，会**新建**该桶。
 *
 * @param {Array<{ edgeId: string, ts: number, count: number }>} samples 原始采样
 * @param {Array<{ edgeId: string, startTs: number, bucketCount: number, mode?: 'drop' | 'spike',
 *   value?: number, spikeFactor?: number }>} specs 注入规格（startTs 支持时间戳/Date/字符串）
 * @returns {Array<object>} 新的采样数组
 */
export function injectAnomalies(samples, specs = []) {
  if (!Array.isArray(samples)) throw new TypeError('injectAnomalies: samples 必须是数组')
  const list = Array.isArray(specs) ? specs : [specs]
  const output = samples.map((sample) => ({ ...sample, ts: alignToBucket(Number(sample.ts)) }))
  const indexByKey = new Map()
  output.forEach((sample, index) => indexByKey.set(bucketKey(sample.edgeId, sample.ts), index))

  list.forEach((spec) => {
    if (!spec || typeof spec.edgeId !== 'string' || spec.startTs === undefined) return
    const startTs = alignToBucket(toTimestamp(spec.startTs))
    const bucketCount = Math.max(1, Math.round(Number.isFinite(spec.bucketCount) ? spec.bucketCount : 1))
    const mode = spec.mode === 'spike' ? 'spike' : 'drop'
    const factor = mode === 'spike'
      ? (Number.isFinite(spec.spikeFactor) ? spec.spikeFactor : Number.isFinite(spec.value) ? spec.value : 4)
      : (Number.isFinite(spec.value) ? spec.value : 0)
    for (let step = 0; step < bucketCount; step += 1) {
      const ts = startTs + step * MS_PER_BUCKET
      const key = bucketKey(spec.edgeId, ts)
      const index = indexByKey.get(key)
      const base = index === undefined
        ? { edgeId: spec.edgeId, ts, count: 0, source: 'synthetic' }
        : output[index]
      const count = mode === 'drop'
        ? Math.max(0, Math.round(factor))
        : Math.max(0, Math.round((Number.isFinite(base.count) ? base.count : 0) * factor))
      const record = { ...base, count, injected: true, injectMode: mode }
      if (index === undefined) {
        indexByKey.set(key, output.length)
        output.push(record)
      } else {
        output[index] = record
      }
    }
  })

  return output.sort((a, b) => a.ts - b.ts || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))
}

/** 相对 DEMO_END_TS 的校区本地时间。@param {number} dayOffset @param {number} hour @param {number} [minute] @returns {number} */
function demoTs(dayOffset, hour, minute = 0) {
  const parts = campusParts(DEMO_END_TS)
  return campusTs({ year: parts.year, month: parts.month, day: parts.day + dayOffset, hour, minute })
}

/**
 * ★ 占位常量：演示用异常注入清单（6 处 = 3 条能通过闸门 + 3 条被闸门挡下）。
 *   ① 今天 08:00–14:00 东南外环 6 小时无人 → **confirmed**（巡查派单「近 6 小时无人经过」）
 *   ② 上周三 14:00–15:30 运动区接驳路无人 → **confirmed**（第二条中断，验证多任务编排）
 *   ③ 上周五午间 南段外环 4 倍尖峰 → **confirmed**（疑似拥堵）
 *   ④ 上周六 10:00–12:00 北段外环无人 + 官方封闭通知 → **excluded: official-closure**
 *   ⑤ 上周五 15:00–16:00 生活区接驳路无人 + 已在 blocked_edges → **excluded: already-blocked**
 *   ⑥ 上周日 23:00–23:45 主校门无人 + 夜间时段 → **excluded: night**
 * confirmed : excluded = 3 : 3 —— 演示时既能看到「检出」，也能看到「我们不会误报」，
 * 且不会给人「系统把所有异常都当误报丢了」的印象。
 * @returns {Array<object>} 注入规格数组
 */
function buildDemoInjectionSpecs() {
  return [
    { key: 'confirmed-interrupt-6h', edgeId: 'outer_se3→outer_se4', startTs: demoTs(0, 8, 0), bucketCount: 24, mode: 'drop' },
    { key: 'confirmed-interrupt-90m', edgeId: 'inner_e_s4→sport_access_w', startTs: demoTs(-5, 14, 0), bucketCount: 6, mode: 'drop' },
    { key: 'confirmed-congested', edgeId: 'outer_s2→outer_s3', startTs: demoTs(-3, 11, 30), bucketCount: 4, mode: 'spike', spikeFactor: 4 },
    { key: 'excluded-closure', edgeId: 'outer_n→outer_nw1', startTs: demoTs(-2, 10, 0), bucketCount: 8, mode: 'drop' },
    { key: 'excluded-blocked', edgeId: 'inner_w_s4→dorm_access_e', startTs: demoTs(-3, 15, 0), bucketCount: 4, mode: 'drop' },
    { key: 'excluded-night', edgeId: 'axis_gate→outer_s2', startTs: demoTs(-1, 23, 0), bucketCount: 4, mode: 'drop' },
  ]
}

/**
 * ★ 占位常量：演示用「已知原因」上下文。
 * 刻意包含**不命中任何注入异常**的记录（东西主路施工通知、国庆假期、上周二暴雨窗口）
 * —— 用来证明闸门既挡得住该挡的，也不会乱挡（否则 confirmed 数量会掉下来）。
 * @returns {object} applyFalsePositiveGates 的 context
 */
function buildDemoGateContext() {
  return {
    officialClosures: [
      {
        edgeIds: ['outer_n→outer_nw1'],
        startTs: demoTs(-2, 10, 0),
        endTs: demoTs(-2, 12, 0),
        source: '后勤保障部 2026-09-26 通知：外环北段排水抢修临时封闭',
      },
    ],
    constructions: [
      {
        edgeIds: ['ew_east_w→ew_east_e'],
        startTs: demoTs(-4, 8, 0),
        endTs: demoTs(-4, 18, 0),
        source: '东西主路东段路面修补（与本次异常窗口无交集，用于验证闸门不误伤）',
      },
    ],
    holidays: ['2026-10-01', '2026-10-02', '2026-10-03'],
    extremeWeatherWindows: [
      {
        startTs: demoTs(-6, 14, 0),
        endTs: demoTs(-6, 18, 0),
        source: '暴雨橙色预警（全校停课，与本次异常窗口无交集）',
      },
    ],
    blockedEdgeIds: ['inner_w_s4→dorm_access_e'],
    nightHours: [22, 6],
  }
}

/**
 * 演示用路段元数据（中文名 / 附近地标 / 责任巡逻岗）。
 * 从 DEFAULT_EDGE_SPECS 派生，未标定的边用 deriveEdgeLabel 兜底。
 * @returns {Record<string, object>} buildInspectionTasks 的 edgeMeta
 */
function buildDemoEdgeMeta() {
  const meta = {}
  DEFAULT_EDGE_IDS.forEach((edgeId) => {
    const spec = DEFAULT_EDGE_SPECS[edgeId]
    meta[edgeId] = spec
      ? { area: spec.area, nearby: spec.nearby, patrolUnit: spec.patrolUnit }
      : {}
  })
  return meta
}

/**
 * 一键产出完整演示数据集（给演示页 / 大屏 / 自检用）。
 *
 * 流程：合成 7 天日志 → 注入 5 处异常 → 建同时段基线 → 检测异常 → 过防误报闸门 →
 *       生成建议核查任务卡。
 *
 * 预期结果（也是 runSelfCheck 断言的）：
 *   - 注入的异常**必须被检出**：confirmed ≥ 2
 *   - **至少 1 条被闸门正确排除**（演示「我们不会误报」）：excluded ≥ 1
 *   - 正常波动**不产生误报**：anomalyCount === 注入簇数（5）
 *
 * @param {{ seed?: number, days?: number }} [options] seed 随机种子；days 天数
 * @returns {{ samples: Array<object>, baselineTable: Record<string, object>, anomalies: Array<object>,
 *   confirmed: Array<object>, excluded: Array<object>, tasks: Array<object>,
 *   stats: { edgeCount: number, bucketCount: number, bucketSlotCount: number, sampleCount: number,
 *     logDays: number, dayCount: number,
 *     anomalyCount: number, confirmedCount: number, excludedCount: number, taskCount: number,
 *     judgedBucketCount: number, injectedBucketCount: number, seed: number, endTs: number } }}
 *   完整演示数据集。
 *
 *   ★ stats 各字段口径（避免「672 只够 1 天」这类误读）：
 *     - `edgeCount`           路段数 = 10
 *     - `bucketCount`         **去重后的时间桶数**（不同 ts 的个数）= 7 天 × 96 = 672
 *     - `bucketSlotCount`     **边 × 桶 单元数**（每边每桶一个计数）= 10 × 672 = 6720
 *     - `sampleCount`         采样条数（= bucketSlotCount，除非同一 (边,桶) 有多条采样）
 *     - `logDays`             日志时长（天）= 7（7 × 96 = 672 个桶 = 7 × 24 小时）
 *     - `dayCount`            日志**覆盖到的自然日数** = 8：日志止于今天 16:00，
 *                             往前推 7 × 24 小时会落到 8 天前那天的 16:15，
 *                             因此首日与末日各只覆盖半天 —— 这是「滑动 7 天窗口」的正常现象
 *     - `judgedBucketCount`   真正参与判定的桶数（基线可用且基线中位数 > 0）
 *     - `injectedBucketCount` 被注入改写的桶数（= 各注入规格 bucketCount 之和）
 */
export function buildDemoDataset({ seed = DEMO_SEED, days = DEMO_DAYS } = {}) {
  const totalDays = Math.max(1, Math.round(Number.isFinite(days) ? days : DEMO_DAYS))
  const samples = injectAnomalies(
    generateSyntheticTrafficLog({ days: totalDays, seed }),
    buildDemoInjectionSpecs(),
  )
  const baselineTable = buildBaseline(samples)
  const anomalies = detectAnomalies(samples, baselineTable)
  const { confirmed, excluded } = applyFalsePositiveGates(anomalies, buildDemoGateContext())
  const tasks = buildInspectionTasks(confirmed, { edgeMeta: buildDemoEdgeMeta() })

  const edgeIds = new Set(samples.map((sample) => sample.edgeId))
  const bucketStamps = new Set(samples.map((sample) => sample.ts))
  const dayKeys = new Set(samples.map((sample) => dateKeyOf(sample.ts)))
  const slots = new Set(samples.map((sample) => bucketKey(sample.edgeId, sample.ts)))
  // 参与判定的桶数：能查到可用基线（样本足、基线中位数 > 0）的桶 —— 证明检测链路真的跑过数据
  let judgedBucketCount = 0
  const seen = new Set()
  samples.forEach((sample) => {
    const key = bucketKey(sample.edgeId, sample.ts)
    if (seen.has(key)) return
    seen.add(key)
    const entry = getBaseline(baselineTable, sample.edgeId, sample.ts)
    if (entry && entry.median > 0) judgedBucketCount += 1
  })

  return {
    samples,
    baselineTable,
    anomalies,
    confirmed,
    excluded,
    tasks,
    stats: {
      edgeCount: edgeIds.size,
      bucketCount: bucketStamps.size,
      bucketSlotCount: slots.size,
      sampleCount: samples.length,
      logDays: totalDays,
      dayCount: dayKeys.size,
      anomalyCount: anomalies.length,
      confirmedCount: confirmed.length,
      excludedCount: excluded.length,
      taskCount: tasks.length,
      judgedBucketCount,
      injectedBucketCount: samples.filter((sample) => sample.injected === true).length,
      seed: Number(seed),
      endTs: DEMO_END_TS,
    },
  }
}

// ============================================================================
// 8. 自检（★ 真验证机制，不是空壳）
// ============================================================================

/**
 * 模块自检：**真正验证机制**，而不是「函数存在就返回 true」。
 * 覆盖：时间桶往返、中位数/MAD/Z-score 的已知值、中位数抗一次性拉高、
 * 样本不足不判异常、注入异常必被检出、连续 K 片门槛、正常波动不误报、
 * 闸门五类原因（含跨零点夜间）、绝不自动发布的任务卡文案、可复现性、校园节律。
 * @returns {{ name: string, passed: boolean, checks: Array<{ label: string, passed: boolean, detail: string }> }}
 *   name 模块名；passed 全部通过为 true；checks 逐项结果（detail 是实测值，便于排查）
 */
export function runSelfCheck() {
  const checks = []
  const run = (label, fn) => {
    let passed = false
    let detail = ''
    try {
      const result = fn()
      if (result && typeof result === 'object' && 'passed' in result) {
        passed = result.passed === true
        detail = String(result.detail === undefined ? '' : result.detail)
      } else {
        passed = result === true
        detail = passed ? '通过' : '断言失败'
      }
    } catch (error) {
      passed = false
      detail = `抛出异常：${error && error.message ? error.message : String(error)}`
    }
    checks.push({ label, passed, detail })
  }
  const ok = (condition, detail) => ({ passed: condition === true, detail })
  const show = (value, max = 200) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text === undefined ? 'undefined' : text.length > max ? `${text.slice(0, max)}…` : text
  }

  // ---------- ① 时间桶工具 ----------
  run('bucketIndex：15 分钟粒度与 0–95 边界', () => {
    const cases = [
      [demoTs(0, 0, 0), 0],
      [demoTs(0, 0, 15), 1],
      [demoTs(0, 7, 30), 30],
      [demoTs(0, 14, 17), 57], // 桶内任意时刻都归到 14:15 这个桶
      [demoTs(0, 23, 45), 95],
    ]
    const actual = cases.map(([ts]) => bucketIndex(ts))
    const expected = cases.map(([, index]) => index)
    return ok(
      JSON.stringify(actual) === JSON.stringify(expected),
      `实测 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`,
    )
  })

  run('bucketKey 格式 + parseBucketKey 往返一致', () => {
    const ts = demoTs(0, 14, 15)
    const key = bucketKey('outer_s2→outer_s3', ts)
    const parsed = parseBucketKey(key)
    const formatOk = key === 'outer_s2→outer_s3@2026-09-28T14:15'
    const roundTrip = parsed && parsed.edgeId === 'outer_s2→outer_s3' && parsed.ts === ts && parsed.bucketIndex === 57
    return ok(formatOk && roundTrip, `key=${key}，parse=${show(parsed)}`)
  })

  run('sameSlotKey 含星期几（2026-09-28 周一 14:15 → d1@14:15）', () => {
    const slot = sameSlotKey(demoTs(0, 14, 15))
    const anyDay = sameSlotKeyAnyDay(demoTs(0, 14, 15))
    const friday = sameSlotKey(demoTs(-3, 14, 15))
    return ok(
      slot === 'd1@14:15' && anyDay === 'd*@14:15' && friday === 'd5@14:15',
      `周一=${slot}，全周同刻=${anyDay}，上周五=${friday}`,
    )
  })

  run('parseSlotKey 解析 d5@14:15 与 d*@14:15', () => {
    const friday = parseSlotKey('d5@14:15')
    const anyDay = parseSlotKey('d*@14:15')
    const invalid = parseSlotKey('x5@14:15')
    return ok(
      friday && friday.dayOfWeek === 5 && friday.bucketIndex === 57 && anyDay && anyDay.anyDay === true && invalid === null,
      `d5@14:15=${show(friday)}，d*@14:15=${show(anyDay)}，非法键=${show(invalid)}`,
    )
  })

  // ---------- ② 统计工具 ----------
  run('median：奇数/偶数/空数组', () => {
    const odd = median([3, 1, 2])
    const even = median([4, 1, 3, 2])
    const empty = median([])
    return ok(odd === 2 && even === 2.5 && empty === null, `median([3,1,2])=${odd}，median([4,1,3,2])=${even}，median([])=${empty}`)
  })

  run('mad：已知序列 1..5 的 MAD 为 1', () => {
    const value = mad([1, 2, 3, 4, 5])
    return ok(value === 1, `mad([1,2,3,4,5])=${value}，期望 1（|x-3| = 2,1,0,1,2 → 中位数 1）`)
  })

  run('robustZScore：0.6745×(x−median)/MAD + MAD=0 的防除零分支', () => {
    const series = [10, 11, 12, 13, 14]
    const z = robustZScore(20, series)
    const expected = roundTo((0.6745 * (20 - 12)) / mad(series), 4)
    const constantEqual = robustZScore(5, [5, 5, 5, 5])
    const constantHigher = robustZScore(9, [5, 5, 5, 5])
    const tooFew = robustZScore(9, [5, 5])
    return ok(
      z === expected && constantEqual === 0 && constantHigher === 99 && tooFew === null,
      `z(20)=${z}（期望 ${expected}）；恒定序列偏离=0 → ${constantEqual}；偏离=9 → ${constantHigher}（哨兵 99）；样本 2 个 → ${tooFew}`,
    )
  })

  // ---------- ③ 基线 ----------
  const normalLog = generateSyntheticTrafficLog({})
  const normalBaseline = buildBaseline(normalLog)

  run('buildBaseline：中位数与 sampleDays / insufficient 标记', () => {
    const ts = demoTs(0, 11, 45) // 今天午间高峰
    const anyDay = getBaseline(normalBaseline, 'outer_s2→outer_s3', ts)
    const weekdayEntry = normalBaseline[`outer_s2→outer_s3@${sameSlotKey(ts)}`]
    return ok(
      anyDay !== null && anyDay.sampleDays >= 3 && anyDay.insufficient === false
      && weekdayEntry && weekdayEntry.sampleDays === 1 && weekdayEntry.insufficient === true,
      `全周同刻槽：sampleDays=${anyDay && anyDay.sampleDays}，median=${anyDay && anyDay.median}，granularity=${anyDay && anyDay.granularity}；`
      + `星期几精确槽（d1@11:45）：sampleDays=${weekdayEntry && weekdayEntry.sampleDays}，insufficient=${weekdayEntry && weekdayEntry.insufficient}（7 天窗口内每个星期几只出现 1 次 → 不许拿来判异常）`,
    )
  })

  run('★ 中位数抗「一次性拉高」（运动会/开学），均值被拉高', () => {
    const ts = demoTs(0, 11, 45)
    const key = `outer_s2→outer_s3@${sameSlotKeyAnyDay(ts)}`
    const entry = normalBaseline[key]
    // 把「最忙的那一天」再拉成 4 倍（模拟运动会/开学）：中位数岿然不动，均值被拽高
    const peak = Math.max(...entry.dayValues)
    const doubled = entry.dayValues.map((value) => (value === peak ? value * 4 : value))
    const meanBefore = entry.dayValues.reduce((a, b) => a + b, 0) / entry.dayValues.length
    const meanAfter = doubled.reduce((a, b) => a + b, 0) / doubled.length
    const medianBefore = median(entry.dayValues)
    const medianAfter = median(doubled)
    const meanJump = (meanAfter - meanBefore) / meanBefore
    return ok(
      medianAfter === medianBefore && meanJump > 0.2,
      `把某天的流量拉成 4 倍后：中位数 ${medianBefore} → ${medianAfter}（不动），均值 ${roundTo(meanBefore, 1)} → ${roundTo(meanAfter, 1)}（+${formatPercent(meanJump)}）`,
    )
  })

  run('getBaseline：命中 / 未命中 / 基线不足时回退', () => {
    const hit = getBaseline(normalBaseline, 'outer_s2→outer_s3', demoBs())
    const miss = getBaseline(normalBaseline, '不存在的边→x', demoBs())
    const unavailable = getBaseline(buildBaseline(normalLog.filter((s) => s.ts >= alignToBucket(DEMO_END_TS) - MS_PER_BUCKET * 95)), 'outer_s2→outer_s3', alignToBucket(DEMO_END_TS))
    return ok(
      hit !== null && hit.granularity === 'any-day' && miss === null && unavailable === null,
      `命中：granularity=${hit && hit.granularity}、median=${hit && hit.median}；不存在的边 → ${miss}；只有 1 天数据的槽 → ${unavailable}（样本不足，返回 null）`,
    )
  })

  run('buildBaseline：nightFactor 语义 = 该槽位中位数 ÷ 该边全天中位数', () => {
    const noon = getBaseline(normalBaseline, 'outer_s2→outer_s3', demoBs(11, 45))
    const dawn = getBaseline(normalBaseline, 'outer_s2→outer_s3', demoBs(5, 15))
    const deepNight = getBaseline(normalBaseline, 'outer_s2→outer_s3', demoBs(3, 0))
    const noonFactor = noon ? noon.nightFactor : null
    const dawnFactor = dawn ? dawn.nightFactor : null
    return ok(
      noon !== null && noonFactor > 1 && dawn !== null && dawnFactor < 1
      && deepNight !== null && deepNight.median === 0
      && detectAnomalies(
        generateSyntheticTrafficLog({ days: 1, edgeIds: ['outer_s2→outer_s3'] })
          .map((sample) => (campusParts(sample.ts).hour === 3 ? { ...sample, count: 0 } : sample)),
        buildBaseline(generateSyntheticTrafficLog({ days: 1, edgeIds: ['outer_s2→outer_s3'] })),
      ).length === 0,
      `语义：nightFactor = 本槽位中位数 ÷ 该边全天中位数（>1 = 比全天平均更忙，<1 = 更闲，0 = 该边全天中位数为 0）。`
      + `实测 午间 11:45 = ${noonFactor}（中位数 ${noon ? noon.median : '—'} 次，>1 ✓ 高峰时段）；`
      + `黎明 05:15 = ${dawnFactor}（中位数 ${dawn ? dawn.median : '—'} 次，<1 ✓ 低谷时段）；`
      + `凌晨 03:00 的基线中位数为 ${deepNight ? deepNight.median : '—'} 次 → 检测层遇到 median <= 0 的槽位直接跳过（不判异常），`
      + `这正是设计文档 ④「时段基线（夜间本来就没车）」在算法内部的实现`,
    )
  })

  // ---------- ④ 异常检测 ----------
  const cleanSamples = generateSyntheticTrafficLog({})
  const cleanBaseline = buildBaseline(cleanSamples)

  run('★ 注入 6 小时中断 → 检出 interrupted，桶数与时间窗吻合', () => {
    const startTs = demoTs(0, 8, 0)
    const injected = injectAnomalies(cleanSamples, [{ edgeId: 'outer_se3→outer_se4', startTs, bucketCount: 24, mode: 'drop' }])
    const found = detectAnomalies(injected, buildBaseline(injected))
    const hit = found.find((item) => item.kind === ANOMALY_KINDS.INTERRUPTED && item.edgeId === 'outer_se3→outer_se4')
    return ok(
      hit !== undefined && hit.bucketCount === 24 && hit.startTs === startTs && hit.observed === 0,
      hit
        ? `检出 ${hit.kind}：${hit.edgeId}，桶数 ${hit.bucketCount}，观测 ${hit.observed} 次 / 基线 ${hit.baseline} 次，ratio=${hit.ratio}，severity=${hit.severity}；证据[0]=${hit.evidence[0]}`
        : `未检出，共 ${found.length} 条异常：${show(found.map((item) => `${item.edgeId}/${item.kind}`))}`,
    )
  })

  run('★ 注入 4 倍尖峰 → 检出 congested（Z-score 升级判据生效）', () => {
    const startTs = demoTs(-3, 11, 30)
    const injected = injectAnomalies(cleanSamples, [{ edgeId: 'outer_s2→outer_s3', startTs, bucketCount: 4, mode: 'spike', spikeFactor: 4 }])
    const found = detectAnomalies(injected, buildBaseline(injected))
    const hit = found.find((item) => item.kind === ANOMALY_KINDS.CONGESTED && item.edgeId === 'outer_s2→outer_s3')
    return ok(
      hit !== undefined && hit.bucketCount === 4 && hit.zScore >= 3.5 && hit.ratio >= 3,
      hit
        ? `检出 ${hit.kind}：桶数 ${hit.bucketCount}，ratio=${hit.ratio}，zScore=${hit.zScore}（阈值 3.5），severity=${hit.severity}`
        : '未检出拥堵',
    )
  })

  run('★ 连续 K 片门槛：只降 1 个桶不报，降 2 个桶才报', () => {
    const oneBucket = detectAnomalies(
      injectAnomalies(cleanSamples, [{ edgeId: 'outer_se3→outer_se4', startTs: demoTs(0, 9, 0), bucketCount: 1, mode: 'drop' }]),
      cleanBaseline,
    ).filter((item) => item.edgeId === 'outer_se3→outer_se4')
    const twoBuckets = detectAnomalies(
      injectAnomalies(cleanSamples, [{ edgeId: 'outer_se3→outer_se4', startTs: demoTs(0, 9, 0), bucketCount: 2, mode: 'drop' }]),
      cleanBaseline,
    ).filter((item) => item.edgeId === 'outer_se3→outer_se4')
    const threeBucketsWithK3 = detectAnomalies(
      injectAnomalies(cleanSamples, [{ edgeId: 'outer_se3→outer_se4', startTs: demoTs(0, 9, 0), bucketCount: 2, mode: 'drop' }]),
      cleanBaseline,
      { consecutiveBuckets: 3 },
    ).filter((item) => item.edgeId === 'outer_se3→outer_se4')
    // 顺带证明用例是隔离的：同一批数据里，未被注入的其它边不该有任何异常
    const otherEdges = detectAnomalies(
      injectAnomalies(cleanSamples, [{ edgeId: 'outer_se3→outer_se4', startTs: demoTs(0, 9, 0), bucketCount: 2, mode: 'drop' }]),
      cleanBaseline,
    ).filter((item) => item.edgeId !== 'outer_se3→outer_se4').length
    return ok(
      oneBucket.length === 0 && twoBuckets.length === 1 && threeBucketsWithK3.length === 0 && otherEdges === 0,
      `目标边（outer_se3→outer_se4）：1 桶 → ${oneBucket.length} 条（K=2 不报）；2 桶 → ${twoBuckets.length} 条（报）；同数据 K=3 → ${threeBucketsWithK3.length} 条（不报）；`
      + `同时其它边检出 ${otherEdges} 条（用例隔离，变量只有「连续桶数」）`,
    )
  })

  run('dropRatio 阈值：ratio 12% 报、18% 不报（卡在默认 0.15 的两侧）', () => {
    const startTs = demoTs(0, 9, 0)
    const baselineEntry = getBaseline(cleanBaseline, 'outer_se3→outer_se4', startTs)
    const base = baselineEntry ? baselineEntry.median : 0
    const lowCount = Math.max(1, Math.floor(base * 0.12))   // 12% < 15% → 应报
    const highCount = Math.max(1, Math.ceil(base * 0.18))   // 18% > 15% → 不应报
    const runCase = (count) => detectAnomalies(
      injectAnomalies(cleanSamples, [{ edgeId: 'outer_se3→outer_se4', startTs, bucketCount: 4, mode: 'drop', value: count }]),
      cleanBaseline,
    ).filter((item) => item.edgeId === 'outer_se3→outer_se4').length
    const lowHits = runCase(lowCount)
    const highHits = runCase(highCount)
    return ok(
      lowHits === 1 && highHits === 0,
      `同时段基线中位数 ${base} 次：注入 ${lowCount} 次（${formatPercent(lowCount / base)}，< 15%）→ 报 ${lowHits} 条；`
      + `注入 ${highCount} 次（${formatPercent(highCount / base)}，> 15%）→ 报 ${highHits} 条 —— 阈值边界两侧都验证到`,
    )
  })

  run('★ 正常波动不误报（3 个种子 × 无注入 → 原始异常 0、confirmed 0）', () => {
    const results = [DEMO_SEED, 7, 12345678].map((seed) => {
      const samples = generateSyntheticTrafficLog({ seed })
      const baseline = buildBaseline(samples)
      const anomalies = detectAnomalies(samples, baseline)
      const gated = applyFalsePositiveGates(anomalies, {})
      return { seed, raw: anomalies.length, confirmed: gated.confirmed.length }
    })
    const allClean = results.every((item) => item.raw === 0 && item.confirmed === 0)
    return ok(
      allClean,
      allClean
        ? `实测 ${show(results)}：无注入的正常波动**连一条原始异常都没有**，更不会有 confirmed —— 说明误报是在检测层被消掉的（不靠闸门兜底），闸门只用来挡「真异常但已知原因」`
        : `实测 ${show(results)}：仍有原始异常；raw 允许 > 0 但 confirmed 必须为 0（confirmed 全 0 = ${results.every((item) => item.confirmed === 0)}）`,
    )
  })

  run('工作日/周末同刻流量比落在判据安全区（不越 15% 下界、不越 3 倍上界）', () => {
    const weekday = new Map()
    const weekend = new Map()
    cleanSamples.forEach((sample) => {
      const parts = campusParts(sample.ts)
      const key = `${sample.edgeId}@${bucketIndex(sample.ts)}`
      const target = parts.dayOfWeek === 0 || parts.dayOfWeek === 6 ? weekend : weekday
      if (!target.has(key)) target.set(key, [])
      target.get(key).push(sample.count)
    })
    let minRatio = Infinity
    let maxRatio = 0
    let compared = 0
    let skippedZeroSlot = 0
    weekday.forEach((values, key) => {
      if (!weekend.has(key)) return
      const base = median(values)
      const other = median(weekend.get(key))
      // ★ 深夜槽（两侧中位数有一侧为 0）不计入：那是「本来就没人」，由夜间闸门/零基线跳过处理，
      //   拿它算比值只会得到 0，属于口径错误而不是误报风险
      if (!(base > 0) || !(other > 0)) {
        skippedZeroSlot += 1
        return
      }
      compared += 1
      const ratio = other / base
      if (ratio < minRatio) minRatio = ratio
      if (ratio > maxRatio) maxRatio = ratio
    })
    const minOk = minRatio > DETECT_DEFAULTS.dropRatio
    const maxOk = maxRatio < DETECT_DEFAULTS.spikeRatio
    return ok(
      compared > 0 && minOk && maxOk,
      `比较了 ${compared} 个同刻槽（另有 ${skippedZeroSlot} 个深夜 0 值槽已按口径排除）：`
      + `最小比 ${roundTo(minRatio, 3)}（须 > ${DETECT_DEFAULTS.dropRatio}，${minOk ? '通过' : '不通过'}）、`
      + `最大比 ${roundTo(maxRatio, 3)}（须 < ${DETECT_DEFAULTS.spikeRatio}，${maxOk ? '通过' : '不通过'}）`
      + ` —— 混合星期几的「全周同刻」基线不会自己造出误报`,
    )
  })

  run('校园节律真实：早课/午间/晚课高峰、课间小峰、深夜为 0、工作日 ≠ 周末', () => {
    const meanAt = (hour, minute, weekendOnly) => {
      const values = cleanSamples.filter((sample) => {
        const parts = campusParts(sample.ts)
        const isWeekend = parts.dayOfWeek === 0 || parts.dayOfWeek === 6
        if (weekendOnly !== undefined && isWeekend !== weekendOnly) return false
        return sample.edgeId === 'outer_s2→outer_s3' && parts.hour === hour && parts.minute === minute
      }).map((sample) => sample.count)
      return values.reduce((a, b) => a + b, 0) / (values.length || 1)
    }
    const morning = meanAt(7, 30, false)
    const noon = meanAt(12, 0, false)
    const evening = meanAt(17, 30, false)
    const inClass = meanAt(9, 30, false)
    const breakPeak = meanAt(9, 45, false)
    const deepNight = meanAt(3, 0, false)
    const dawn = meanAt(5, 15, false)
    const weekendDawn = meanAt(5, 15, true)
    const weekendMorning = meanAt(7, 30, true)
    const weekendAfternoon = meanAt(16, 0, true)
    const weekdayAfternoon = meanAt(16, 0, false)
    return ok(
      morning > noon * 0.8 && noon > evening * 0.9 && evening > 10 * Math.max(deepNight, 1)
      && breakPeak > inClass * 1.3 && deepNight === 0
      && dawn > 0 && weekendDawn > 0
      && weekendMorning < morning * 0.8 && weekendAfternoon > weekdayAfternoon,
      `工作日 07:30=${roundTo(morning, 1)}（早课高峰）、12:00=${roundTo(noon, 1)}（午间高峰）、17:30=${roundTo(evening, 1)}（晚课高峰）、`
      + `09:30=${roundTo(inClass, 1)} → 09:45=${roundTo(breakPeak, 1)}（课间小峰）、03:00=${roundTo(deepNight, 1)}（深夜 0）；`
      + `黎明 05:15 工作日=${roundTo(dawn, 1)} / 周末=${roundTo(weekendDawn, 1)}（两侧均 > 0，不制造「一边 0 一边非 0」的假中断）；`
      + `周末 07:30=${roundTo(weekendMorning, 1)}（无早课高峰）而 16:00=${roundTo(weekendAfternoon, 1)} > 工作日 ${roundTo(weekdayAfternoon, 1)}（体育/社团高峰）`,
    )
  })

  // ---------- ⑤ 防误报闸门 ----------
  const baseAnomaly = {
    edgeId: 'outer_n→outer_nw1',
    kind: ANOMALY_KINDS.INTERRUPTED,
    startTs: demoTs(-2, 10, 0),
    endTs: demoTs(-2, 11, 45),
    endExclusiveTs: demoTs(-2, 12, 0),
    bucketCount: 8,
    severityScore: 60,
    severity: 'high',
    evidence: ['测试用'],
  }

  run('闸门：官方封闭通知命中 → excludedBy = official-closure（含中文说明）', () => {
    const result = applyFalsePositiveGates([baseAnomaly], {
      officialClosures: [{ edgeId: 'outer_n→outer_nw1', startTs: demoTs(-2, 10, 0), endTs: demoTs(-2, 12, 0), source: '后勤通知' }],
    })
    const excluded = result.excluded[0]
    return ok(
      result.confirmed.length === 0 && excluded && excluded.excludedBy === EXCLUSION_REASONS.OFFICIAL_CLOSURE
      && typeof excluded.exclusionNote === 'string' && excluded.exclusionNote.includes('官方封闭通知'),
      excluded ? `excludedBy=${excluded.excludedBy}（${excluded.excludedByLabel}）；说明=${excluded.exclusionNote}` : '未被排除',
    )
  })

  run('闸门：施工 / 假期 / 极端天气 / blocked_edges 四类原因各自命中', () => {
    const cases = [
      [EXCLUSION_REASONS.CONSTRUCTION, { constructions: [{ edgeId: 'outer_n→outer_nw1', startTs: demoTs(-2, 9, 0), endTs: demoTs(-2, 13, 0) }] }],
      [EXCLUSION_REASONS.HOLIDAY, { holidays: ['2026-09-26'] }],
      [EXCLUSION_REASONS.EXTREME_WEATHER, { extremeWeatherWindows: [{ startTs: demoTs(-2, 0, 0), endTs: demoTs(-2, 23, 0), source: '暴雨' }] }],
      [EXCLUSION_REASONS.ALREADY_BLOCKED, { blockedEdgeIds: ['outer_n→outer_nw1'] }],
    ]
    const actual = cases.map(([, context]) => {
      const result = applyFalsePositiveGates([baseAnomaly], context)
      return result.excluded[0] ? result.excluded[0].excludedBy : 'none'
    })
    return ok(
      actual.every((value, index) => value === cases[index][0]),
      `实测 ${show(actual)}，期望 ${show(cases.map(([reason]) => reason))}`,
    )
  })

  run('★ 夜间闸门跨零点：23:00 / 02:00 / 05:45 排除，21:45 与 06:00 不排除', () => {
    const build = (hour, minuteOffset, buckets) => ({
      edgeId: 'axis_gate→outer_s2',
      kind: ANOMALY_KINDS.INTERRUPTED,
      startTs: demoTs(-1, hour, minuteOffset),
      endTs: demoTs(-1, hour, minuteOffset) + (buckets - 1) * MS_PER_BUCKET,
      endExclusiveTs: demoTs(-1, hour, minuteOffset) + buckets * MS_PER_BUCKET,
      bucketCount: buckets,
      severity: 'medium',
      severityScore: 50,
      evidence: [],
    })
    const nightLate = applyFalsePositiveGates([build(23, 0, 4)], { nightHours: [22, 6] }).excluded.length
    const nightEarly = applyFalsePositiveGates([build(2, 0, 4)], { nightHours: [22, 6] }).excluded.length
    const nightEdge = applyFalsePositiveGates([build(5, 45, 1)], { nightHours: [22, 6] }).excluded.length
    const dayEdge = applyFalsePositiveGates([build(21, 45, 1)], { nightHours: [22, 6] }).excluded.length
    const morning = applyFalsePositiveGates([build(6, 0, 1)], { nightHours: [22, 6] }).excluded.length
    const isNightFlags = [
      isNightBucket(demoTs(-1, 23, 0)),
      isNightBucket(demoTs(-1, 2, 0)),
      isNightBucket(demoTs(-1, 5, 45)),
      isNightBucket(demoTs(-1, 21, 45)),
      isNightBucket(demoTs(-1, 6, 0)),
    ]
    return ok(
      nightLate === 1 && nightEarly === 1 && nightEdge === 1 && dayEdge === 0 && morning === 0
      && JSON.stringify(isNightFlags) === JSON.stringify([true, true, true, false, false]),
      `排除数 [23:00, 02:00, 05:45, 21:45, 06:00] = ${show([nightLate, nightEarly, nightEdge, dayEdge, morning])}；isNightBucket = ${show(isNightFlags)}`,
    )
  })

  run('nightHours 可配置：传 null 关闭夜间闸门', () => {
    const nightAnomaly = {
      edgeId: 'axis_gate→outer_s2',
      kind: ANOMALY_KINDS.INTERRUPTED,
      startTs: demoTs(-1, 23, 0),
      endTs: demoTs(-1, 23, 45),
      endExclusiveTs: demoTs(-1, 23, 0) + 4 * MS_PER_BUCKET,
      bucketCount: 4,
      severityScore: 50,
      evidence: [],
    }
    const off = applyFalsePositiveGates([nightAnomaly], { nightHours: null })
    const custom = applyFalsePositiveGates([nightAnomaly], { nightHours: [23, 5] })
    return ok(
      off.confirmed.length === 1 && off.excluded.length === 0 && custom.excluded.length === 1,
      `nightHours=null → confirmed ${off.confirmed.length} / excluded ${off.excluded.length}；nightHours=[23,5] → excluded ${custom.excluded.length}`,
    )
  })

  run('闸门：横跨昼夜的事件不被夜间闸门吞掉（保守策略）', () => {
    const crossing = {
      edgeId: 'axis_gate→outer_s2',
      kind: ANOMALY_KINDS.INTERRUPTED,
      startTs: demoTs(-1, 21, 30),
      endTs: demoTs(-1, 22, 30),
      endExclusiveTs: demoTs(-1, 21, 30) + 13 * MS_PER_BUCKET,
      bucketCount: 13,
      severityScore: 70,
      severity: 'high',
      evidence: [],
    }
    const result = applyFalsePositiveGates([crossing], { nightHours: [22, 6] })
    const confirmed = result.confirmed[0]
    return ok(
      result.excluded.length === 0 && result.confirmed.length === 1 && confirmed.nightBucketRatio > 0 && confirmed.nightBucketRatio < 1,
      `21:30–00:45 的事件：nightBucketRatio=${confirmed && confirmed.nightBucketRatio}（部分夜间）→ 不排除，转人工核实`,
    )
  })

  run('闸门：不相关的已知原因不会误伤（无交集 → confirmed）', () => {
    const result = applyFalsePositiveGates([baseAnomaly], {
      officialClosures: [{ edgeId: 'inner_e_s4→sport_access_w', startTs: demoTs(-2, 10, 0), endTs: demoTs(-2, 12, 0) }],
      constructions: [{ edgeIds: ['ew_east_w→ew_east_e'], startTs: demoTs(-2, 0, 0), endTs: demoTs(-2, 23, 0) }],
      holidays: ['2026-10-01'],
      extremeWeatherWindows: [{ startTs: demoTs(-6, 14, 0), endTs: demoTs(-6, 18, 0) }],
      blockedEdgeIds: ['别人的边→x'],
    })
    return ok(
      result.excluded.length === 0 && result.confirmed.length === 1
      && result.confirmed[0].gateNote.includes('建议人工核实'),
      `无交集 → confirmed ${result.confirmed.length} / excluded ${result.excluded.length}；gateNote=${result.confirmed[0] && result.confirmed[0].gateNote}`,
    )
  })

  run('闸门不修改入参（异常对象仍是原样）', () => {
    const snapshot = JSON.stringify(baseAnomaly)
    applyFalsePositiveGates([baseAnomaly], { blockedEdgeIds: ['outer_n→outer_nw1'] })
    return ok(JSON.stringify(baseAnomaly) === snapshot, `调用前后入参序列化一致：${JSON.stringify(baseAnomaly) === snapshot}`)
  })

  // ---------- ⑥ 任务卡 ----------
  const demo = buildDemoDataset()
  const interruptedAnomaly = demo.confirmed.find((item) => item.kind === ANOMALY_KINDS.INTERRUPTED)

  run('★ 任务卡：中断事件产出巡查派单，文案是人话（含时长与「请前往确认」）', () => {
    const tasks = buildInspectionTasks(demo.confirmed, { edgeMeta: buildDemoEdgeMeta() })
    const patrol = tasks.find((task) => task.kind === TASK_KINDS.PATROL && task.anomalyKind === ANOMALY_KINDS.INTERRUPTED)
    return ok(
      patrol !== undefined && patrol.title.includes('6 小时') && patrol.title.includes('请前往确认')
      && patrol.edgeLabel.includes('outer_se3→outer_se4') && patrol.suggestReporter.includes('保卫处'),
      patrol ? `title=${patrol.title}；suggestReporter=${patrol.suggestReporter}；deadline=${patrol.deadline}；priority=${patrol.priority}（${patrol.priorityLabel}）` : '未产出巡查任务',
    )
  })

  run('★ 三类任务齐全 + 众包带上报模板 + 官方源交叉验证', () => {
    const tasks = buildInspectionTasks(demo.confirmed, { edgeMeta: buildDemoEdgeMeta() })
    const kinds = [...new Set(tasks.map((task) => task.kind))].sort()
    const crowdsource = tasks.find((task) => task.kind === TASK_KINDS.CROWDSOURCE)
    const official = tasks.find((task) => task.kind === TASK_KINDS.OFFICIAL_CHECK)
    return ok(
      kinds.length === 3 && crowdsource && crowdsource.template.includes('上报模板') && crowdsource.detail.includes('贡献积分')
      && official && official.detail.includes('升级为「待人工确认」'),
      `任务类型=${show(kinds)}；众包模板首行=${crowdsource && crowdsource.template.split('\n')[0]}；官方核查含升级规则=${!!(official && official.detail.includes('待人工确认'))}`,
    )
  })

  run('★ 绝不自动发布：所有任务带免责声明、status=proposed、requiresHumanReview', () => {
    const tasks = buildInspectionTasks(demo.confirmed, { edgeMeta: buildDemoEdgeMeta() })
    const allSafe = tasks.every((task) =>
      task.disclaimer === INSPECTION_DISCLAIMER
      && task.status === 'proposed'
      && task.requiresHumanReview === true
      && task.detail.includes('未经人工核实')
      && !/已发布|已确认异常|该路段有问题(?!」)/.test(task.title))
    return ok(allSafe && tasks.length > 0, `任务数 ${tasks.length}；全部含免责声明与人工复核标记=${allSafe}；示例 title=${tasks[0] && tasks[0].title}`)
  })

  run('任务卡 id 唯一、severityScore 越高 priority 越急、deadline 由 SLA 推导', () => {
    const tasks = buildInspectionTasks(demo.confirmed, { edgeMeta: buildDemoEdgeMeta() })
    const ids = new Set(tasks.map((task) => task.id))
    const rank = { [TASK_PRIORITY.P1]: 0, [TASK_PRIORITY.P2]: 1, [TASK_PRIORITY.P3]: 2 }
    // 巡查派单没有「按类型降档」的规则，因此按 severityScore 降序后，优先级必须单调变缓
    const patrols = tasks.filter((task) => task.kind === TASK_KINDS.PATROL)
      .slice()
      .sort((a, b) => b.severityScore - a.severityScore)
    const monotonic = patrols.every((task, index) => index === 0 || rank[patrols[index - 1].priority] <= rank[task.priority])
    const reference = Math.max(...demo.confirmed.map((item) => item.endExclusiveTs))
    const slaOk = tasks.every((task) => task.deadlineTs - reference === TASK_SLA_HOURS[task.priority] * 60 * 60 * 1000)
    return ok(
      ids.size === tasks.length && monotonic && slaOk && tasks.length > 0,
      `id 唯一 ${ids.size}/${tasks.length}；巡查派单按严重度降序后优先级单调变缓=${monotonic}（${show(patrols.map((t) => `${t.severityScore}→${t.priority}`))}）；`
      + `deadline = 基准(${formatLocalStamp(reference)}) + SLA ${show([...new Set(tasks.map((t) => `${t.priority}:${t.slaHours}h`))])} = ${slaOk}`,
    )
  })

  // ---------- ⑦ 合成数据与演示集 ----------
  run('★ 可复现：同 seed 两次生成逐字节一致，不同 seed 不同', () => {
    const a = JSON.stringify(generateSyntheticTrafficLog({ seed: 20260928 }))
    const b = JSON.stringify(generateSyntheticTrafficLog({ seed: 20260928 }))
    const c = JSON.stringify(generateSyntheticTrafficLog({ seed: 20260929 }))
    const demoA = buildDemoDataset()
    const demoB = buildDemoDataset()
    return ok(
      a === b && a !== c && JSON.stringify(demoA.anomalies) === JSON.stringify(demoB.anomalies),
      `同 seed 一致=${a === b}（长度 ${a.length}），换 seed 变化=${a !== c}；buildDemoDataset 两次 anomalies 一致=${JSON.stringify(demoA.anomalies) === JSON.stringify(demoB.anomalies)}`,
    )
  })

  run('injectAnomalies 不修改入参，drop 归零 / spike 放大正确', () => {
    const source = generateSyntheticTrafficLog({ days: 1, edgeIds: ['outer_s2→outer_s3'], seed: 5 })
    const snapshot = JSON.stringify(source)
    const startTs = source[40].ts
    const dropped = injectAnomalies(source, [{ edgeId: 'outer_s2→outer_s3', startTs, bucketCount: 3, mode: 'drop' }])
    const spiked = injectAnomalies(source, [{ edgeId: 'outer_s2→outer_s3', startTs, bucketCount: 3, mode: 'spike', spikeFactor: 5 }])
    const dropOk = dropped.filter((sample) => sample.ts >= startTs && sample.ts < startTs + 3 * MS_PER_BUCKET).every((sample) => sample.count === 0)
    const spikeOk = spiked.filter((sample) => sample.ts >= startTs && sample.ts < startTs + 3 * MS_PER_BUCKET)
      .every((sample) => sample.count === Math.round(source.find((item) => item.ts === sample.ts).count * 5))
    return ok(
      JSON.stringify(source) === snapshot && dropOk && spikeOk && dropped !== source,
      `入参未被修改=${JSON.stringify(source) === snapshot}；drop 归零=${dropOk}；spike ×5 正确=${spikeOk}；返回新数组=${dropped !== source}`,
    )
  })

  run('★ 演示数据集平衡：confirmed ≥ 3、excluded 2–5、无多报（原始异常数 = 注入簇数）', () => {
    const specs = buildDemoInjectionSpecs()
    const injected = specs.length
    const balanced = demo.stats.confirmedCount >= 3 && demo.stats.excludedCount >= 2 && demo.stats.excludedCount <= 5
    return ok(
      balanced && demo.stats.anomalyCount === injected && demo.stats.confirmedCount + demo.stats.excludedCount === injected,
      `原始异常 ${demo.stats.anomalyCount} 条 = 注入 ${injected} 簇（正常波动零误报）；`
      + `confirmed=${demo.stats.confirmedCount}（≥3 ✓）、excluded=${demo.stats.excludedCount}（2–5 ✓，占 ${formatPercent(demo.stats.excludedCount / injected, 0)}）；tasks=${demo.stats.taskCount}`,
    )
  })

  run('★ 演示数据集的排除原因覆盖 3 类（official-closure / already-blocked / night）', () => {
    const reasons = demo.excluded.map((item) => item.excludedBy).sort()
    const expected = [EXCLUSION_REASONS.ALREADY_BLOCKED, EXCLUSION_REASONS.NIGHT, EXCLUSION_REASONS.OFFICIAL_CLOSURE].sort()
    const notes = demo.excluded.map((item) => item.exclusionNote)
    return ok(
      JSON.stringify(reasons) === JSON.stringify(expected) && notes.every((note) => typeof note === 'string' && note.length > 10),
      `excludedBy=${show(reasons)}；三类中文说明：${show(notes.map((note) => note.slice(0, 42) + '…'))}`,
    )
  })

  run('★ 演示数据集 stats 口径自洽（边 × 桶 = sampleCount，覆盖自然日 8 天）', () => {
    const stats = demo.stats
    const injectedBuckets = buildDemoInjectionSpecs().reduce((sum, spec) => sum + spec.bucketCount, 0)
    return ok(
      stats.edgeCount === DEFAULT_EDGE_IDS.length
      && stats.logDays === DEMO_DAYS && stats.bucketCount === DEMO_DAYS * BUCKETS_PER_DAY
      && stats.bucketSlotCount === stats.edgeCount * stats.bucketCount
      && stats.sampleCount === stats.bucketSlotCount
      && stats.dayCount === DEMO_DAYS + 1 // 7×24h 数据止于今天 16:00 → 首尾各半天，共跨 8 个自然日
      && stats.judgedBucketCount > 0 && stats.injectedBucketCount === injectedBuckets,
      `stats=${show(stats)}`,
    )
  })

  run('★ 演示数据集 stats 与体量自洽（10 边 × 672 桶 = 6720 单元，含 3 条 confirmed 任务链）', () => {
    const stats = demo.stats
    const patrolCount = demo.tasks.filter((task) => task.kind === TASK_KINDS.PATROL).length
    return ok(
      stats.confirmedCount === 3 && patrolCount >= 3
      && demo.tasks.some((task) => task.anomalyKind === ANOMALY_KINDS.INTERRUPTED && task.title.includes('6 小时'))
      && demo.tasks.some((task) => task.anomalyKind === ANOMALY_KINDS.CONGESTED),
      `confirmed=${stats.confirmedCount}（2 条中断 + 1 条拥堵）、巡查派单 ${patrolCount} 张、任务合计 ${stats.taskCount} 张；`
      + `示例：${show(demo.tasks[0] && demo.tasks[0].title)}`,
    )
  })

  run('evidence 可打印：中断证据含总量、基线、百分比与时间窗', () => {
    const evidence = interruptedAnomaly ? interruptedAnomaly.evidence.join(' | ') : ''
    return ok(
      evidence.includes('通行量') && evidence.includes('基线') && evidence.includes('%') && evidence.includes('同时段')
      && formatAnomalyReport(interruptedAnomaly).includes('★ 本任务为「建议核查」'),
      interruptedAnomaly ? evidence : '未找到中断异常',
    )
  })

  run('detectAnomalies：非法选项抛错（不静默错判）', () => {
    let threw = false
    try {
      detectAnomalies(cleanSamples, cleanBaseline, { dropRatio: '0.15' })
    } catch (error) {
      threw = error instanceof TypeError
    }
    return ok(threw, `传入 dropRatio='0.15' 抛 TypeError = ${threw}`)
  })

  const passed = checks.every((check) => check.passed)
  return { name: 'safetyBaseline（通行热度异常检测基线）', passed, checks }
}

/** 自检内部用：DEMO_END_TS 当天某个时刻（默认 11:45，落在午间高峰槽上）。 */
function demoBs(hour = 11, minute = 45) {
  return demoTs(0, hour, minute)
}
