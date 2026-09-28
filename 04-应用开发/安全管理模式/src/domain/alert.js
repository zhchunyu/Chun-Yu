/**
 * 事故突发预警 · 分级矩阵与状态机
 * ---------------------------------------------------------------------------
 * 路线 B / 决策项 B-1~B-4 态势输入 · B-7 严重度 · B-8 场所敏感度 · B-9 时段权重
 *              B-10 五档 · B-11~B-16 状态机六分支与 SLA
 *
 * ★ 定位差异：现在的「事件」是**内容**（发出来给大家看），
 *   预警是**任务**（有人要去做事）。差别就在三样：分级、责任人、时限。
 *
 * ★ 状态机照抄 `实时输入接入设计.md` §6，不重新设计：
 *     上报 → 抽取中 → 待核查 ─┬─ 可信度 ≥ 阈值 → 已发布 → 已派单 → 已处置 → 已结束
 *                             └─ 可信度低 或 安全类 → 待核实（灰标，不打点）
 *   已发布 且 type = traffic/blocking → blocked_edges += 该边 → A* 重算
 *   已结束 / 证据矛盾                → blocked_edges -= 该边 → 路线自动恢复
 */

import { getPlaceSensitivity, PLACE_CAPACITY } from './crowd.js'

/** 严重度五档（决策项 B-10） */
export const SEVERITY = Object.freeze({
  INFO: 'info',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
})

export const SEVERITY_LABELS = Object.freeze({
  info: '提示',
  low: '低',
  medium: '中',
  high: '高',
  critical: '紧急',
})

export const SEVERITY_ORDER = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 })

export const SEVERITY_COLORS = Object.freeze({
  info: '#5b8def',
  low: '#3fa96a',
  medium: '#e0a92b',
  high: '#e2703a',
  critical: '#d1414a',
})

/**
 * 事件类型 → 基础严重度（★ 走规则不走 AI：可解释、可审计）
 * 与 `events.js` 的 `EVENT_TYPES` 五类对齐
 */
export const TYPE_BASE_SEVERITY = Object.freeze({
  safety: SEVERITY.HIGH, // 安全类：护栏松动、路灯损坏、地砖翘起
  traffic: SEVERITY.MEDIUM, // 通行类：车辆占道、剐蹭
  service: SEVERITY.LOW, // 服务类：快递积压、设施报修
  notice: SEVERITY.INFO, // 通知类：开馆时间调整
  help: SEVERITY.LOW, // 互助类：失物、组队
})

export const TYPE_BASE_REASONS = Object.freeze({
  safety: '安全类事件直接涉及人身安全，基础定级为「高」',
  traffic: '通行类事件影响流动效率，基础定级为「中」',
  service: '服务类事件影响体验但不涉安全，基础定级为「低」',
  notice: '通知类事件为信息传达，基础定级为「提示」',
  help: '互助类事件为自发协作，基础定级为「低」',
})

/** 夜间时段（决策项 B-9）：夜间处置资源少、视野差，同级别自动升档 */
export const NIGHT_HOURS = Object.freeze({ start: 22, end: 6 })

/**
 * SLA 响应时限与升级对象（决策项 B-15 / B-16）
 * ★ 没有时限的预警系统 = 一个通知列表。有时限 + 有升级，才是闭环的管理系统。
 */
export const SLA_TABLE = Object.freeze({
  critical: Object.freeze({
    responseMinutes: 3,
    escalateTo: ['保卫处值班', '校领导'],
    label: '3 分钟',
    channel: ['推送', '大屏闪烁', '值班电话'],
  }),
  high: Object.freeze({
    responseMinutes: 15,
    escalateTo: ['保卫处值班'],
    label: '15 分钟',
    channel: ['推送', '大屏常驻'],
  }),
  medium: Object.freeze({
    responseMinutes: 60,
    escalateTo: ['后勤', '属地管理员'],
    label: '60 分钟',
    channel: ['推送'],
  }),
  low: Object.freeze({
    responseMinutes: 24 * 60,
    escalateTo: [],
    label: '24 小时',
    channel: ['信息流'],
  }),
  info: Object.freeze({
    responseMinutes: 0,
    escalateTo: [],
    label: '不限时',
    channel: ['信息流'],
  }),
})

/**
 * 预警状态机（照抄 §6，补「已派单/已处置」两个处置流状态）
 */
export const ALERT_STATE = Object.freeze({
  REPORTED: 'reported', // 上报
  EXTRACTING: 'extracting', // 抽取中（AI 五步可见）
  PENDING: 'pending', // 待核查
  VERIFYING: 'verifying', // 待核实（灰标，不打点）★ 安全类专用分支
  PUBLISHED: 'published', // 已发布
  DISPATCHED: 'dispatched', // 已派单
  RESOLVED: 'resolved', // 已处置
  CLOSED: 'closed', // 已结束
  CONTRADICTED: 'contradicted', // 证据矛盾 → 可信度回落
  REJECTED: 'rejected', // 人工驳回
})

export const ALERT_STATE_LABELS = Object.freeze({
  reported: '已上报',
  extracting: '抽取中',
  pending: '待核查',
  verifying: '待核实',
  published: '已发布',
  dispatched: '已派单',
  resolved: '已处置',
  closed: '已结束',
  contradicted: '证据矛盾',
  rejected: '已驳回',
})

/** 状态迁移表（显式声明，禁止随意跳转） */
export const ALERT_TRANSITIONS = Object.freeze({
  reported: ['extracting'],
  extracting: ['pending'],
  pending: ['published', 'verifying', 'rejected'],
  verifying: ['published', 'rejected'],
  published: ['dispatched', 'contradicted', 'closed'],
  dispatched: ['resolved', 'contradicted'],
  resolved: ['closed', 'contradicted'],
  contradicted: ['closed', 'published'],
  rejected: ['closed'],
  closed: [],
})

/** 默认可信度阈值（安全类走强制闸门，见 §4.3） */
export const CREDIBILITY = Object.freeze({
  DEFAULT_THRESHOLD: 0.65,
  SAFETY_THRESHOLD: 0.75, // ★ 安全类更严
})

/**
 * 判定一条状态迁移是否合法
 * @param {string} from 当前状态
 * @param {string} to 目标状态
 * @returns {{ allowed: boolean, detail: string }}
 */
export function canTransition(from, to) {
  const allowed = ALERT_TRANSITIONS[from] ?? []
  return {
    allowed: allowed.includes(to),
    detail: allowed.includes(to)
      ? `${ALERT_STATE_LABELS[from]} → ${ALERT_STATE_LABELS[to]} 合法`
      : `${ALERT_STATE_LABELS[from] ?? from} 不能直接迁移到 ${ALERT_STATE_LABELS[to] ?? to}（允许：${allowed.map((s) => ALERT_STATE_LABELS[s]).join('、') || '无'}）`,
  }
}

/**
 * 判断某时刻是否属于夜间时段（正确处理跨零点）
 * @param {number} ts 时间戳（毫秒）
 * @param {{ start?: number, end?: number }} [hours]
 * @returns {boolean}
 */
export function isNightTime(ts, hours = NIGHT_HOURS) {
  const hour = new Date(ts).getHours()
  const { start, end } = hours
  // 22:00–06:00 跨零点：hour ≥ 22 或 hour < 6
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end)
}

/**
 * ★ 预警分级矩阵：严重度 × 场所敏感度 × 时段权重（决策项 B-7 / B-8 / B-9）
 *
 * 设计意图：把「AI 分类」和「校园空间知识」真正接起来 ——
 * 同样的火情，宿舍楼和操场不是一个级别。
 *
 * @param {object} event 事件（含 type / locationId / severity 等）
 * @param {{ place?: object, placeKind?: string, at?: number, now?: number }} [context]
 * @returns {object} 分级结果（含完整推演过程，供证据链展示）
 */
export function gradeAlert(event, context = {}) {
  const at = context.at ?? context.now ?? event?.ts ?? 0
  const type = event?.type ?? 'notice'
  const locationId = event?.locationId ?? event?.anchorId ?? null

  const place = context.place ?? PLACE_CAPACITY[locationId] ?? null
  const placeKind = context.placeKind ?? place?.kind ?? 'plaza'
  const placeName = place?.name ?? locationId ?? '未知地点'

  const evidence = []

  // ① 基础严重度（规则，不走 AI）
  let order = SEVERITY_ORDER[TYPE_BASE_SEVERITY[type] ?? SEVERITY.LOW]
  evidence.push({
    label: '事件类型定级',
    detail: `${type} → 基础档「${SEVERITY_LABELS[TYPE_BASE_SEVERITY[type] ?? SEVERITY.LOW]}」· ${TYPE_BASE_REASONS[type] ?? '未配置类型'}`,
  })

  const baseOrder = order

  // ② 场所敏感度倍率
  // ★ 公式保持简单：(档位 + 1) × 倍率 − 1。
  //   为什么不把倍率差异"挤"进档位：分级只有 5 档，当基础档已到「高」时，
  //   ×1.2 与 ×1.3 都只能落到封顶的「紧急」—— 这是 5 档制的固有限制，
  //   硬用四舍五入去凑反而会在临界点上误伤（例如把 ×0.85 的教学场所误降档）。
  //   因此倍率的**梯度由 `sensitivityScore` 承担**（保留一位小数，可比较），
  //   档位只在跨过整档时才变化。
  const sensitivity = getPlaceSensitivity(placeKind)
  const sensitivityScore = (order + 1) * sensitivity.weight
  const afterPlace = Math.max(0, Math.min(SEVERITY_ORDER.critical, Math.round(sensitivityScore) - 1))
  evidence.push({
    label: '场所敏感度',
    detail: `${placeName}（${placeKind}）敏感度 ×${sensitivity.weight}，敏感度分值 ${sensitivityScore.toFixed(1)} —— ${sensitivity.reason}` +
      (afterPlace !== baseOrder ? `，档位由「${SEVERITY_LABELS[Object.keys(SEVERITY_ORDER).find((k) => SEVERITY_ORDER[k] === baseOrder)]}」` +
        `上调至「${SEVERITY_LABELS[Object.keys(SEVERITY_ORDER).find((k) => SEVERITY_ORDER[k] === afterPlace)]}」` : '，档位不变'),
  })

  // ③ 时段权重：夜间自动升一档
  const night = isNightTime(at)
  let finalOrder = afterPlace
  if (night && finalOrder < SEVERITY_ORDER.critical && finalOrder >= SEVERITY_ORDER.low) {
    finalOrder += 1
    evidence.push({
      label: '时段权重',
      detail: `事发时刻 ${formatHour(at)} 属夜间时段（${NIGHT_HOURS.start}:00–${NIGHT_HOURS.end}:00），` +
        `同级别自动升档至「${SEVERITY_LABELS[Object.keys(SEVERITY_ORDER).find((k) => SEVERITY_ORDER[k] === finalOrder)]}」—— 夜间处置资源少、视野差`,
    })
  } else {
    evidence.push({
      label: '时段权重',
      detail: night ? '夜间时段，但已处于最高档，不再上调' : `事发时刻 ${formatHour(at)} 属日间时段，不升档`,
    })
  }

  // ④ 显式声明的严重度可覆盖（人工/AI 判定优先）
  if (event?.severity && SEVERITY_ORDER[event.severity] != null) {
    if (SEVERITY_ORDER[event.severity] > finalOrder) {
      evidence.push({
        label: '显式严重度',
        detail: `事件自报严重度「${SEVERITY_LABELS[event.severity]}」高于矩阵推演结果，取较高者`,
      })
      finalOrder = SEVERITY_ORDER[event.severity]
    } else {
      evidence.push({
        label: '显式严重度',
        detail: `事件自报严重度「${SEVERITY_LABELS[event.severity]}」不高于矩阵推演结果「${SEVERITY_LABELS[Object.keys(SEVERITY_ORDER).find((k) => SEVERITY_ORDER[k] === finalOrder)]}」，以矩阵为准`,
      })
    }
  }

  const level = Object.keys(SEVERITY_ORDER).find((key) => SEVERITY_ORDER[key] === finalOrder)
  const sla = SLA_TABLE[level]

  return {
    eventId: event?.id ?? null,
    type,
    locationId,
    placeName,
    placeKind,
    level,
    levelLabel: SEVERITY_LABELS[level],
    levelOrder: finalOrder,
    color: SEVERITY_COLORS[level],
    night,
    sensitivity,
    sensitivityScore: Math.round(sensitivityScore * 10) / 10,
    sla: { ...sla, dueAt: sla.responseMinutes > 0 ? at + sla.responseMinutes * 60000 : null },
    escalated: finalOrder > baseOrder,
    escalateReason: finalOrder > baseOrder
      ? buildEscalateReason({ baseOrder, finalOrder, sensitivity, night, placeName })
      : null,
    evidence,
  }
}

function buildEscalateReason({ baseOrder, finalOrder, sensitivity, night, placeName }) {
  const parts = []
  if (sensitivity.weight > 1) parts.push(`场所敏感度 ×${sensitivity.weight}`)
  if (night) parts.push('夜间时段')
  return `分级由基础档上调 ${finalOrder - baseOrder} 档（${parts.join(' + ')}）`
}

function formatHour(ts) {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * ★ 可信度闸门（§4.3）—— 安全类强制走人工审核
 *
 * 设计意图对应需求基线 §九 点出的**法律风险**：发布错误的安全预警要担责。
 *
 * @param {object} event 事件（含 type 与 ai.credibility）
 * @param {{ publishedEvents?: object[] }} [context]
 * @returns {{ passed: boolean, state: string, gate: string, detail: string, score: number|null }}
 */
export function applyCredibilityGate(event, context = {}) {
  const type = event?.type ?? 'notice'
  const score = event?.ai?.credibility?.score ?? null
  const isSafety = type === 'safety'
  const threshold = isSafety ? CREDIBILITY.SAFETY_THRESHOLD : CREDIBILITY.DEFAULT_THRESHOLD

  if (score == null) {
    return {
      passed: false,
      state: ALERT_STATE.PENDING,
      gate: 'no-score',
      score: null,
      detail: '尚无可信度评分，停留「待核查」',
    }
  }

  const passed = score >= threshold
  return {
    passed,
    state: passed ? ALERT_STATE.PUBLISHED : isSafety ? ALERT_STATE.VERIFYING : ALERT_STATE.PENDING,
    gate: isSafety ? 'safety-mandatory' : 'default',
    score,
    threshold,
    detail: passed
      ? `可信度 ${(score * 100).toFixed(0)}% ≥ 阈值 ${(threshold * 100).toFixed(0)}%，自动发布`
      : `可信度 ${(score * 100).toFixed(0)}% < 阈值 ${(threshold * 100).toFixed(0)}%，` +
        (isSafety
          ? '★ 安全类强制闸门生效：进人工审核队列，前端只显示「待核实」、灰色虚标不打点'
          : '进人工审核队列，等待补充证据'),
  }
}

/**
 * 构造一条预警（从事件 + 分级结果）
 *
 * @param {object} event 原始事件
 * @param {object} grading gradeAlert 的返回值
 * @param {{ now?: number, place?: object }} [options]
 * @returns {object} 预警对象
 */
export function createAlert(event, grading, options = {}) {
  const now = options.now ?? grading?.sla?.dueAt != null
    ? (options.now ?? 0)
    : 0
  const at = event?.ts ?? now ?? 0

  return {
    id: `alert:${event?.id ?? Math.random().toString(36).slice(2, 10)}`,
    eventId: event?.id ?? null,
    type: event?.type ?? 'notice',
    title: event?.title ?? event?.text ?? '未命名事件',
    locationId: grading?.locationId ?? event?.locationId ?? null,
    placeName: grading?.placeName ?? null,
    placeKind: grading?.placeKind ?? null,
    level: grading?.level ?? SEVERITY.LOW,
    levelLabel: grading?.levelLabel ?? SEVERITY_LABELS.low,
    color: grading?.color ?? SEVERITY_COLORS.low,
    state: ALERT_STATE.REPORTED,
    credibility: event?.ai?.credibility?.score ?? null,
    sla: grading?.sla ?? SLA_TABLE.low,
    escalated: grading?.escalated ?? false,
    escalateReason: grading?.escalateReason ?? null,
    raisedAt: at,
    timeline: [
      { at, state: ALERT_STATE.REPORTED, label: '上报', detail: '用户在地图上选点并提交一句话描述' },
    ],
    dispatches: [],
    evidence: grading?.evidence ?? [],
    routeImpact: null, // 由 playbook / 路网联动填充
  }
}

/**
 * 推进预警状态机（含侧效应声明：封路 / 解封 / 派单 / 归档）
 *
 * @param {object} alert 预警对象
 * @param {string} nextState 目标状态
 * @param {{ at?: number, detail?: string, actor?: string, dispatch?: object }} [meta]
 * @returns {{ alert: object, transition: object, sideEffects: string[], error: string|null }}
 */
export function advanceAlert(alert, nextState, meta = {}) {
  const transition = canTransition(alert.state, nextState)
  if (!transition.allowed) {
    return { alert, transition, sideEffects: [], error: transition.detail }
  }

  const at = meta.at ?? alert.raisedAt ?? 0
  const actor = meta.actor ?? '系统'
  const sideEffects = []

  const next = {
    ...alert,
    state: nextState,
    timeline: [
      ...alert.timeline,
      {
        at,
        state: nextState,
        label: ALERT_STATE_LABELS[nextState],
        detail: meta.detail ?? transition.detail,
        actor,
      },
    ],
  }

  // ---- 侧效应声明（★ 这是"预警"与"信息流"的分界）----
  if (nextState === ALERT_STATE.DISPATCHED && meta.dispatch) {
    next.dispatches = [...next.dispatches, { ...meta.dispatch, at, status: 'dispatched' }]
    sideEffects.push(`派单给「${meta.dispatch.role}」：${meta.dispatch.task}`)
  }
  if (nextState === ALERT_STATE.PUBLISHED) {
    sideEffects.push('写入信息流 + 地图打点')
    if (isBlockingEvent(alert)) {
      sideEffects.push('blocked_edges += 该边（触发 A* 重算与路线对比渲染）')
    }
  }
  if (nextState === ALERT_STATE.CLOSED || nextState === ALERT_STATE.CONTRADICTED) {
    if (isBlockingEvent(alert)) {
      sideEffects.push('blocked_edges -= 该边（路线自动恢复）')
    }
    sideEffects.push('归档，形成本次事件的处置记录')
  }
  if (nextState === ALERT_STATE.VERIFYING) {
    sideEffects.push('★ 灰色虚标、不打点，仅进人工审核队列（安全类强制闸门）')
  }
  if (nextState === ALERT_STATE.RESOLVED && next.dispatches.length) {
    next.dispatches = next.dispatches.map((item) => ({ ...item, status: 'resolved', resolvedAt: at }))
    sideEffects.push('处置结果回写，用于统计响应时长与闭环率')
  }

  return { alert: next, transition, sideEffects, error: null }
}

/**
 * 是否属于「影响通行」的事件类型（决定是否联动封路）
 *
 * ★ 判定必须**保守**：只有明确影响通行的措辞才触发封路。
 *   漏封一条路的代价，远小于因为一条普通报修就莫名其妙封路。
 */
export const BLOCKING_KEYWORDS = Object.freeze([
  '挡路', '占用', '封闭', '无法通行', '过不去', '封路', '积水', '塌陷', '塌方', '堵死', '断交',
])

export function isBlockingEvent(alert) {
  const text = `${alert?.title ?? ''}${alert?.text ?? ''}`
  const hitKeyword = BLOCKING_KEYWORDS.find((word) => text.includes(word))
  if (hitKeyword) return true
  // 通行类事件本身即影响流动，无论措辞
  return alert?.type === 'traffic'
}

/**
 * 判定预警是否超时未处置，需升级
 *
 * @param {object} alert 预警对象
 * @param {number} now 当前时间
 * @returns {{ overdue: boolean, remainMs: number, overdueMs: number, escalateTo: string[], detail: string }}
 */
export function checkSla(alert, now) {
  const dueAt = alert?.sla?.dueAt
  const escalateTo = alert?.sla?.escalateTo ?? []

  if (dueAt == null) {
    return { overdue: false, remainMs: Infinity, overdueMs: 0, escalateTo, detail: '该等级不设响应时限' }
  }

  const settled = [ALERT_STATE.RESOLVED, ALERT_STATE.CLOSED, ALERT_STATE.REJECTED].includes(alert.state)
  const remainMs = dueAt - now

  if (settled) {
    const actual = (alert.timeline.find((item) => item.state === ALERT_STATE.DISPATCHED)?.at ?? now) - alert.raisedAt
    return {
      overdue: false,
      remainMs,
      overdueMs: 0,
      escalateTo,
      detail: `已在时限内进入处置流，响应时长 ${Math.max(0, Math.round(actual / 60000))} 分钟`,
    }
  }

  if (remainMs < 0) {
    return {
      overdue: true,
      remainMs,
      overdueMs: -remainMs,
      escalateTo,
      detail: `★ 超出响应时限 ${Math.round(-remainMs / 60000)} 分钟，应升级至：${escalateTo.join('、') || '无升级对象'}`,
    }
  }

  return {
    overdue: false,
    remainMs,
    overdueMs: 0,
    escalateTo,
    detail: `剩余响应时间 ${Math.round(remainMs / 60000)} 分钟`,
  }
}

/**
 * 处置时效统计（供安全态势大屏 E-3 —— ★「证明闭环真的闭合了」）
 *
 * @param {object[]} alerts 预警列表（含完整 timeline）
 * @returns {object} 时效指标
 */
export function summarizeResponseTimes(alerts = []) {
  const settled = alerts.filter((alert) => alert.timeline?.length)
  const responseMinutes = []
  let overdueCount = 0
  let closedCount = 0

  for (const alert of settled) {
    const dispatched = alert.timeline.find((item) => item.state === ALERT_STATE.DISPATCHED)
    const closed = alert.timeline.find((item) => item.state === ALERT_STATE.CLOSED)
    if (dispatched) {
      responseMinutes.push(Math.max(0, (dispatched.at - alert.raisedAt) / 60000))
    }
    if (closed) closedCount += 1
    if (alert.sla?.dueAt != null && dispatched && dispatched.at > alert.sla.dueAt) overdueCount += 1
  }

  const avg = responseMinutes.length
    ? responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length
    : null

  const byLevel = {}
  for (const level of Object.keys(SEVERITY_ORDER)) {
    const items = alerts.filter((alert) => alert.level === level)
    const durations = items
      .map((alert) => {
        const dispatched = alert.timeline?.find((item) => item.state === ALERT_STATE.DISPATCHED)
        return dispatched ? (dispatched.at - alert.raisedAt) / 60000 : null
      })
      .filter((value) => value != null)
    byLevel[level] = {
      count: items.length,
      avgMinutes: durations.length ? Math.round((durations.reduce((s, v) => s + v, 0) / durations.length) * 10) / 10 : null,
    }
  }

  return {
    total: alerts.length,
    dispatchedCount: responseMinutes.length,
    closedCount,
    avgResponseMinutes: avg == null ? null : Math.round(avg * 10) / 10,
    overdueCount,
    overdueRate: responseMinutes.length ? Math.round((overdueCount / responseMinutes.length) * 1000) / 10 : 0,
    closureRate: alerts.length ? Math.round((closedCount / alerts.length) * 1000) / 10 : 0,
    byLevel,
    summary: avg == null
      ? '暂无已派单预警，无法计算平均响应时长'
      : `平均响应 ${Math.round(avg * 10) / 10} 分钟 · 超时率 ${responseMinutes.length ? Math.round((overdueCount / responseMinutes.length) * 1000) / 10 : 0}% · 闭环率 ${alerts.length ? Math.round((closedCount / alerts.length) * 1000) / 10 : 0}%`,
  }
}

/**
 * 模块自检
 * @returns {{ name: string, passed: boolean, checks: Array<{label: string, passed: boolean, detail: string}> }}
 */
export function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  // 固定时间基准，保证可复现：2026-09-28（周一）14:00 与 23:00
  const DAY = new Date(2026, 8, 28, 14, 0, 0).getTime()
  const NIGHT = new Date(2026, 8, 28, 23, 0, 0).getTime()

  // ① 状态迁移合法性
  add('① 状态机迁移表生效（禁止非法跳转）',
    canTransition('reported', 'extracting').allowed &&
    !canTransition('reported', 'published').allowed &&
    !canTransition('closed', 'published').allowed,
    '上报→抽取中 合法；上报→已发布 非法；已结束→已发布 非法')

  // ② 场所敏感度：同样的事件类型在宿舍 vs 操场档位不同
  const dorm = gradeAlert({ id: 'e1', type: 'safety', locationId: 'Dorm-A', ts: DAY },
    { placeKind: 'dormitory', place: PLACE_CAPACITY['Dorm-A'], at: DAY })
  const sports = gradeAlert({ id: 'e2', type: 'safety', locationId: 'Playground', ts: DAY },
    { placeKind: 'sports', place: PLACE_CAPACITY.Playground, at: DAY })
  add('② ★ 场所敏感度：同一事件类型在宿舍与操场档位不同',
    SEVERITY_ORDER[dorm.level] > SEVERITY_ORDER[sports.level],
    `安全类事件：宿舍「${dorm.levelLabel}」（×${dorm.sensitivity.weight}）> 操场「${sports.levelLabel}」（×${sports.sensitivity.weight}）`)

  // ③ 夜间升档
  const dayNotice = gradeAlert({ id: 'e3', type: 'service', locationId: 'Library', ts: DAY },
    { placeKind: 'teaching', at: DAY })
  const nightNotice = gradeAlert({ id: 'e4', type: 'service', locationId: 'Library', ts: NIGHT },
    { placeKind: 'teaching', at: NIGHT })
  add('③ 时段权重：同一事件夜间自动升档',
    SEVERITY_ORDER[nightNotice.level] > SEVERITY_ORDER[dayNotice.level] && nightNotice.night === true,
    `服务类：14:00「${dayNotice.levelLabel}」→ 23:00「${nightNotice.levelLabel}」（夜间升档）`)

  // ④ 夜间判定跨零点
  add('④ 夜间时段判定正确处理跨零点',
    isNightTime(new Date(2026, 8, 28, 23, 30).getTime()) &&
    isNightTime(new Date(2026, 8, 29, 2, 0).getTime()) &&
    isNightTime(new Date(2026, 8, 29, 5, 59).getTime()) &&
    !isNightTime(new Date(2026, 8, 29, 6, 0).getTime()) &&
    !isNightTime(new Date(2026, 8, 28, 12, 0).getTime()),
    '23:30 是 / 02:00 是 / 05:59 是 / 06:00 否 / 12:00 否')

  // ⑤ 分级可解释性（用日间服务类事件验证"时段权重"分支也被记录）
  const serviceEvidence = dayNotice.evidence.length
  add('⑤ 分级携带完整推演证据链（含未升档时的时段说明）',
    dorm.evidence.length >= 3 && serviceEvidence >= 3 && Boolean(dorm.escalateReason) &&
    dayNotice.evidence.some((item) => item.label === '时段权重'),
    `宿舍安全类 ${dorm.evidence.length} 项证据，升档原因：${dorm.escalateReason}` +
    `；日间服务类 ${serviceEvidence} 项证据，含时段权重说明「${dayNotice.evidence.find((item) => item.label === '时段权重')?.detail}」`)

  // ⑥ 安全类强制闸门
  const safetyGate = applyCredibilityGate({ type: 'safety', ai: { credibility: { score: 0.55 } } })
  const serviceGate = applyCredibilityGate({ type: 'service', ai: { credibility: { score: 0.55 } } })
  const highSafety = applyCredibilityGate({ type: 'safety', ai: { credibility: { score: 0.9 } } })
  add('⑥ ★ 安全类强制闸门：阈值更严，且落到「待核实」而非普通待核查',
    safetyGate.passed === false &&
    safetyGate.state === ALERT_STATE.VERIFYING &&
    safetyGate.gate === 'safety-mandatory' &&
    serviceGate.state === ALERT_STATE.PENDING &&
    highSafety.passed === true,
    `安全类 55% → ${ALERT_STATE_LABELS[safetyGate.state]}（阈值 ${safetyGate.threshold}）；` +
    `服务类 55% → ${ALERT_STATE_LABELS[serviceGate.state]}（阈值 ${serviceGate.threshold}）；安全类 90% → 已发布`)

  // ⑦ SLA 与超时升级 —— 用「中」档（60 分钟时限）验证时限内/超时两种情形
  const mediumGrading = gradeAlert(
    { id: 'e6', type: 'traffic', locationId: 'Plaza-Center', ts: DAY },
    { placeKind: 'plaza', place: PLACE_CAPACITY['Plaza-Center'], at: DAY },
  )
  const mediumAlert = createAlert(
    { id: 'e6', type: 'traffic', title: '中央广场东侧车辆占道', locationId: 'Plaza-Center', ts: DAY },
    mediumGrading,
    { now: DAY },
  )
  const onTime = checkSla(mediumAlert, DAY + 40 * 60000)
  const overdue = checkSla(mediumAlert, DAY + 75 * 60000)
  add('⑦ SLA 时限与超时升级',
    mediumGrading.level === SEVERITY.MEDIUM &&
    onTime.overdue === false && overdue.overdue === true && overdue.escalateTo.length > 0,
    `「${mediumGrading.levelLabel}」档时限 ${mediumGrading.sla.label}：40 分钟后「${onTime.detail}」；75 分钟后「${overdue.detail}」`)

  // ⑧ 状态机推进 + 侧效应（封路 / 解封）
  // ★ 用「卡车占道无法通行」这类**确实影响通行**的事件，才能验证封路与解封成对出现
  const blockingGrading = gradeAlert(
    { id: 'e7', type: 'traffic', locationId: 'Canteen', ts: DAY },
    { placeKind: 'dining', place: PLACE_CAPACITY.Canteen, at: DAY },
  )
  const blockingAlert = createAlert(
    { id: 'e7', type: 'traffic', title: '三食堂门口停了辆卡车，无法通行', locationId: 'Canteen', ts: DAY },
    blockingGrading,
    { now: DAY },
  )
  let current = blockingAlert
  const steps = [
    [ALERT_STATE.EXTRACTING, {}],
    [ALERT_STATE.PENDING, {}],
    [ALERT_STATE.PUBLISHED, {}],
    [ALERT_STATE.DISPATCHED, { dispatch: { role: '保卫处', task: '现场核实并清障' } }],
    [ALERT_STATE.RESOLVED, {}],
    [ALERT_STATE.CLOSED, {}],
  ]
  const allSideEffects = []
  let advanceError = null
  for (const [state, meta] of steps) {
    const result = advanceAlert(current, state, { at: DAY + 60000, ...meta })
    if (result.error) { advanceError = result.error; break }
    current = result.alert
    allSideEffects.push(...result.sideEffects)
  }
  add('⑧ 状态机全链路可推进且侧效应成对（发布封路 / 结束解封）',
    advanceError === null &&
    allSideEffects.some((text) => text.includes('blocked_edges +=')) &&
    allSideEffects.some((text) => text.includes('blocked_edges -=')),
    advanceError ?? allSideEffects.join(' ｜ '))

  // ⑨ 非法迁移被拒绝且不破坏状态
  const illegal = advanceAlert(current, ALERT_STATE.PUBLISHED, { at: DAY })
  add('⑨ 非法迁移被拒绝且不破坏状态',
    illegal.error !== null && illegal.alert.state === current.state,
    illegal.error ?? '未拒绝（异常）')

  // ⑩ 处置时效统计
  const stats = summarizeResponseTimes([
    { ...current, level: 'high', raisedAt: DAY, sla: { dueAt: DAY + 15 * 60000 },
      timeline: [{ at: DAY, state: 'reported' }, { at: DAY + 4 * 60000, state: 'dispatched' }, { at: DAY + 20 * 60000, state: 'closed' }] },
    { ...current, level: 'critical', raisedAt: DAY, sla: { dueAt: DAY + 3 * 60000 },
      timeline: [{ at: DAY, state: 'reported' }, { at: DAY + 9 * 60000, state: 'dispatched' }] },
  ])
  add('⑩ ★ 处置时效统计（证明闭环真的闭合了）',
    stats.avgResponseMinutes != null && stats.overdueCount === 1 && stats.overdueRate > 0,
    stats.summary)

  // ⑪ 影响通行事件判定
  add('⑪ 影响通行事件识别（决定是否联动封路，判定必须保守）',
    isBlockingEvent({ type: 'traffic', title: '三食堂门口停了辆卡车' }) &&
    isBlockingEvent({ type: 'safety', title: '路面塌陷无法通行' }) &&
    !isBlockingEvent({ type: 'notice', title: '图书馆开馆时间调整' }) &&
    !isBlockingEvent({ type: 'safety', title: '实验楼后面的路灯坏了两盏' }),
    '通行类 / 含"无法通行"的安全类 → 触发封路；通知类 / 普通安全报修 → 不触发（避免莫名封路）')

  return {
    name: 'domain/alert.js',
    passed: checks.every((check) => check.passed),
    checks,
  }
}
