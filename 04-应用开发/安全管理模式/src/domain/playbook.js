/**
 * 处置预案库与动作原子
 * ---------------------------------------------------------------------------
 * 路线 B / 决策项 B-18 六个预案 · B-19 八个动作 · B-20 一键执行 + 可撤销
 *
 * ★ 设计意图：预案不是一段文字，而是**一组具体动作**。
 *   一键预案 = 安全模块从「看」到「做」的分界。
 *   演示时点一下「启动预案」，地图上同时出现：
 *   封路段变红、路线自动重算、通知弹窗、派单卡片 —— 这一下点击是整场演示的高潮。
 */

import { SEVERITY, SLA_TABLE, ALERT_STATE } from './alert.js'

/** ★ 处置动作原子库（决策项 B-19，恰好八个） */
export const ACTION_CODES = Object.freeze({
  BROADCAST: 'broadcast', // 定向广播
  BLOCK_EDGE: 'block-edge', // 路段置入封路集合
  REROUTE: 'reroute', // 触发路线重算
  DISPATCH: 'dispatch', // 派单
  CLOSE_PLACE: 'close-place', // 关闭场所
  HIGHLIGHT_ROUTE: 'highlight-route', // 高亮特定路线（如环廊避雨通道）
  PAUSE_OUTDOOR: 'pause-outdoor', // 暂停户外活动
  LOG_EVIDENCE: 'log-evidence', // 拍照 / 留痕
})

export const ACTION_LABELS = Object.freeze({
  broadcast: { label: '定向广播', detail: '向指定范围推送一句话提示' },
  'block-edge': { label: '路段封闭', detail: '将路段置入 blocked_edges，触发 A* 重算' },
  reroute: { label: '路线重算', detail: '重算受影响路线并渲染新旧对比' },
  dispatch: { label: '派单', detail: '生成任务卡并推送给责任人，带响应时限' },
  'close-place': { label: '关闭场所', detail: '将场所状态置为 closed，地图标记封闭' },
  'highlight-route': { label: '高亮路线', detail: '高亮推荐通行路线（如环廊避雨通道）' },
  'pause-outdoor': { label: '暂停户外活动', detail: '暂停体育课、军训、社团等户外安排' },
  'log-evidence': { label: '留痕', detail: '记录处置过程，形成可审计的时间线' },
})

/** 动作执行的确定性顺序（先隔离风险，再改路线，最后通知） */
export const ACTION_ORDER = Object.freeze([
  ACTION_CODES.BLOCK_EDGE,
  ACTION_CODES.CLOSE_PLACE,
  ACTION_CODES.PAUSE_OUTDOOR,
  ACTION_CODES.REROUTE,
  ACTION_CODES.HIGHLIGHT_ROUTE,
  ACTION_CODES.DISPATCH,
  ACTION_CODES.BROADCAST,
  ACTION_CODES.LOG_EVIDENCE,
])

export const PLAYBOOK_KIND = Object.freeze({
  CROWD_OVERFLOW: 'crowd-overflow', // ① 人流超限
  ROAD_BLOCKED: 'road-blocked', // ② 道路占用
  RAINSTORM: 'rainstorm', // ③ 暴雨
  HAIL: 'hail', // ④ 冰雹
  HEAT: 'heat', // ⑤ 高温
  BIG_EVENT: 'big-event', // ⑥ 大型活动
})

export const PLAYBOOK_LABELS = Object.freeze({
  'crowd-overflow': '人流超限分流预案',
  'road-blocked': '道路占用处置预案',
  rainstorm: '暴雨应急联动预案',
  hail: '冰雹避险预案',
  heat: '高温防护预案',
  'big-event': '大型活动散场预案',
})

/**
 * 低洼路段清单（暴雨封路用）
 * ★ 占位边 id —— 真实值必须与 `src/data/roadNetwork.js` 的 `ROAD_EDGES` / `roadEdgeId()` 对齐后替换
 */
export const LOW_LYING_EDGES = Object.freeze([
  'outer_s2→outer_s3',
  'outer_s3→inner_e_s4',
  'axis_gate→outer_s2',
])

/** 环廊避雨通道（暴雨时高亮）—— 同样是占位边 id */
export const COVERED_ROUTE_EDGES = Object.freeze([
  'ring_n1→ring_n2',
  'ring_e1→ring_e2',
  'ring_s1→ring_s2',
])

/**
 * ★ 六个预案定义（决策项 B-18）
 *
 * 每个步骤含：动作码、目标、参数、以及**一句话人话说明**（演示与方案书都要用）。
 */
export const PLAYBOOKS = Object.freeze({
  [PLAYBOOK_KIND.CROWD_OVERFLOW]: Object.freeze({
    kind: PLAYBOOK_KIND.CROWD_OVERFLOW,
    label: PLAYBOOK_LABELS['crowd-overflow'],
    trigger: '人流占用率达到高风险档并完成驻留确认',
    defaultLevel: SEVERITY.HIGH,
    steps: Object.freeze([
      Object.freeze({
        action: ACTION_CODES.BROADCAST,
        target: '该地点周边 300 m',
        params: { text: '此处人流已达安全上限，建议前往就近的第二食堂或等候 10 分钟错峰' },
        note: '分流提示要给出**具体去处**，否则用户不会执行',
      }),
      Object.freeze({
        action: ACTION_CODES.HIGHLIGHT_ROUTE,
        target: '就近替代地点',
        params: { mode: 'shortest', destination: 'Canteen-2' },
        note: '同时高亮替代路线，把"建议"变成"可点的一步"',
      }),
      Object.freeze({
        action: ACTION_CODES.DISPATCH,
        target: '保安',
        params: { role: '保安', count: 2, task: '现场分流，引导排队队伍不占用车道' },
        note: '人流超限的真正风险往往是**溢出到车道**',
      }),
      Object.freeze({
        action: ACTION_CODES.LOG_EVIDENCE,
        target: '该地点',
        params: { template: '人流超限处置记录' },
        note: '留痕用于事后统计与责任界定',
      }),
    ]),
  }),

  [PLAYBOOK_KIND.ROAD_BLOCKED]: Object.freeze({
    kind: PLAYBOOK_KIND.ROAD_BLOCKED,
    label: PLAYBOOK_LABELS['road-blocked'],
    trigger: '通行类事件可信度通过并发布',
    defaultLevel: SEVERITY.MEDIUM,
    steps: Object.freeze([
      Object.freeze({
        action: ACTION_CODES.BLOCK_EDGE,
        target: '事发路段',
        params: { edgeId: '$edgeId' },
        note: '★ 复用现有 `blocked_edges` 机制，`aStar()` 一行不改',
      }),
      Object.freeze({
        action: ACTION_CODES.REROUTE,
        target: '受影响路线',
        params: { showCompare: true },
        note: '渲染原路线（灰虚线）+ 新路线（高亮 + 流动粒子）',
      }),
      Object.freeze({
        action: ACTION_CODES.DISPATCH,
        target: '后勤',
        params: { role: '后勤', task: '现场核实并清障' },
        note: '派单带响应时限，超时自动升级',
      }),
      Object.freeze({
        action: ACTION_CODES.BROADCAST,
        target: '途经该路段用户',
        params: { text: '$edgeLabel 暂时无法通行，已为你重新规划路线' },
        note: '广播文案由系统自动生成，含具体路段名',
      }),
    ]),
  }),

  [PLAYBOOK_KIND.RAINSTORM]: Object.freeze({
    kind: PLAYBOOK_KIND.RAINSTORM,
    label: PLAYBOOK_LABELS.rainstorm,
    trigger: '暴雨橙色或红色预警',
    defaultLevel: SEVERITY.HIGH,
    steps: Object.freeze([
      Object.freeze({
        action: ACTION_CODES.BLOCK_EDGE,
        target: '低洼路段',
        params: { edges: LOW_LYING_EDGES },
        note: '低洼路段积水风险最高，先隔离再谈疏导',
      }),
      Object.freeze({
        action: ACTION_CODES.CLOSE_PLACE,
        target: '地下车库入口',
        params: { place: '地下车库入口', reason: '暴雨倒灌风险' },
        note: '车库倒灌的损失远大于临时封闭的不便',
      }),
      Object.freeze({
        action: ACTION_CODES.PAUSE_OUTDOOR,
        target: '全校户外活动',
        params: { scope: '户外', reason: '暴雨预警' },
        note: '体育课、军训、社团活动一并暂停',
      }),
      Object.freeze({
        action: ACTION_CODES.HIGHLIGHT_ROUTE,
        target: '环廊避雨通道',
        params: { mode: 'rain', edges: COVERED_ROUTE_EDGES },
        note: '★ 复用已有 `ROUTE_MODES.RAIN`，零新增代码',
      }),
      Object.freeze({
        action: ACTION_CODES.BROADCAST,
        target: '全校',
        params: { text: '暴雨预警生效，请优先使用环廊避雨通道，避开低洼路段' },
        note: '一句话给出可执行动作，而不是复述气象级别',
      }),
      Object.freeze({
        action: ACTION_CODES.DISPATCH,
        target: '后勤',
        params: { role: '后勤', task: '排查低洼路段积水与排水口堵塞情况' },
        note: '预警落到具体任务才算闭环',
      }),
    ]),
  }),

  [PLAYBOOK_KIND.HAIL]: Object.freeze({
    kind: PLAYBOOK_KIND.HAIL,
    label: PLAYBOOK_LABELS.hail,
    trigger: '冰雹橙色或红色预警',
    defaultLevel: SEVERITY.HIGH,
    steps: Object.freeze([
      Object.freeze({
        action: ACTION_CODES.CLOSE_PLACE,
        target: '露天球场',
        params: { place: '露天球场', reason: '冰雹直接伤害风险' },
        note: '冰雹对露天场地的人是直接人身伤害',
      }),
      Object.freeze({
        action: ACTION_CODES.HIGHLIGHT_ROUTE,
        target: '教学楼门厅',
        params: { mode: 'shortest', destination: 'Teach-A' },
        note: '给出去处：门厅、食堂、图书馆均为避险点',
      }),
      Object.freeze({
        action: ACTION_CODES.BROADCAST,
        target: '全校',
        params: { text: '冰雹预警，请立即就近进入教学楼门厅或食堂避险，勿在露天停留' },
        note: '"立即就近"是关键措辞 —— 冰雹留给人的反应时间很短',
      }),
      Object.freeze({
        action: ACTION_CODES.DISPATCH,
        target: '后勤',
        params: { role: '后勤', task: '检查自行车棚与临时围挡受损情况' },
        note: '冰雹后必然有设施损坏，提前派核查任务',
      }),
    ]),
  }),

  [PLAYBOOK_KIND.HEAT]: Object.freeze({
    kind: PLAYBOOK_KIND.HEAT,
    label: PLAYBOOK_LABELS.heat,
    trigger: '高温橙色或红色预警',
    defaultLevel: SEVERITY.MEDIUM,
    steps: Object.freeze([
      Object.freeze({
        action: ACTION_CODES.PAUSE_OUTDOOR,
        target: '体测 / 军训 / 户外课',
        params: { scope: '户外课程与训练', reason: '高温中暑风险' },
        note: '★ 教育场景独有的动作 —— 直接关联课时安排',
      }),
      Object.freeze({
        action: ACTION_CODES.BROADCAST,
        target: '全校',
        params: { text: '高温预警，请避开 11:00–15:00 户外活动，就近补水点位于各教学楼门厅' },
        note: '给出时间窗与具体地点，而非泛泛提醒"注意防暑"',
      }),
      Object.freeze({
        action: ACTION_CODES.HIGHLIGHT_ROUTE,
        target: '阴凉路线',
        params: { mode: 'shade' },
        note: '建议新增 `ROUTE_MODES.SHADE` —— 优先有树荫与连廊的边',
      }),
      Object.freeze({
        action: ACTION_CODES.DISPATCH,
        target: '校医院',
        params: { role: '校医院', task: '备勤防暑物资并在运动区巡诊' },
        note: '高温风险集中在运动区与户外课程时段',
      }),
    ]),
  }),

  [PLAYBOOK_KIND.BIG_EVENT]: Object.freeze({
    kind: PLAYBOOK_KIND.BIG_EVENT,
    label: PLAYBOOK_LABELS['big-event'],
    trigger: '报备的大型活动临近散场',
    defaultLevel: SEVERITY.MEDIUM,
    steps: Object.freeze([
      Object.freeze({
        action: ACTION_CODES.HIGHLIGHT_ROUTE,
        target: '多向疏散路线',
        params: { mode: 'evacuate', multiPath: true },
        note: '★ 普通导航只做"我怎么去"，安全系统还要做"大家怎么撤"',
      }),
      Object.freeze({
        action: ACTION_CODES.BROADCAST,
        target: '活动参与人员',
        params: { text: '活动即将结束，请按引导分东、南、西三个方向离场，避免全部涌向主校门' },
        note: '把人流按方向劈开，是散场管理的核心动作',
      }),
      Object.freeze({
        action: ACTION_CODES.DISPATCH,
        target: '保安',
        params: { role: '保安', count: 4, task: '在三个方向出口引导分流' },
        note: '分流的关键在于出口处有人',
      }),
      Object.freeze({
        action: ACTION_CODES.LOG_EVIDENCE,
        target: '活动现场',
        params: { template: '大型活动散场记录' },
        note: '散场记录可用于下次活动的容量评估',
      }),
    ]),
  }),
})

/**
 * 实例化一个预案 —— 把模板里的 `$变量` 替换成具体值
 *
 * @param {string} kind 预案类型（PLAYBOOK_KIND 之一）
 * @param {Record<string, unknown>} context 变量表（如 { edgeId, edgeLabel, placeName }）
 * @param {{ level?: string, now?: number, dispatchCount?: number }} [options]
 * @returns {{ kind: string, label: string, level: string, sla: object, steps: object[], unresolved: string[], summary: string } | null}
 */
export function instantiatePlaybook(kind, context = {}, options = {}) {
  const template = PLAYBOOKS[kind]
  if (!template) return null

  const level = options.level ?? template.defaultLevel
  const now = options.now ?? 0
  const sla = SLA_TABLE[level] ?? SLA_TABLE.medium
  const unresolved = []

  const steps = template.steps.map((step, index) => {
    const { params, missing } = substituteParams(step.params, context)
    missing.forEach((key) => unresolved.push(`${step.action}:${key}`))
    return {
      id: `${kind}:step-${index + 1}`,
      order: ACTION_ORDER.indexOf(step.action),
      action: step.action,
      actionLabel: ACTION_LABELS[step.action]?.label ?? step.action,
      target: substituteString(step.target, context),
      params,
      note: step.note,
      status: 'pending',
      missing,
    }
  }).sort((a, b) => a.order - b.order)

  return {
    kind,
    label: template.label,
    trigger: template.trigger,
    level,
    sla: { ...sla, dueAt: sla.responseMinutes > 0 ? now + sla.responseMinutes * 60000 : null },
    steps,
    unresolved,
    summary: buildPlaybookSummary(template.label, steps, level),
  }
}

function substituteString(text, context) {
  if (typeof text !== 'string') return text
  return text.replace(/\$(\w+)/g, (match, key) => (context[key] != null ? String(context[key]) : match))
}

function substituteParams(params, context) {
  const missing = []
  const walk = (value) => {
    if (typeof value === 'string') {
      const replaced = value.replace(/\$(\w+)/g, (match, key) => {
        if (context[key] != null) return String(context[key])
        missing.push(key)
        return match
      })
      return replaced
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    }
    return value
  }
  return { params: walk(params), missing: [...new Set(missing)] }
}

function buildPlaybookSummary(label, steps, level) {
  const counts = {}
  for (const step of steps) {
    counts[step.actionLabel] = (counts[step.actionLabel] ?? 0) + 1
  }
  const detail = Object.entries(counts).map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join(' + ')
  return `启动「${label}」（${level} 级）：共 ${steps.length} 个动作 —— ${detail}`
}

/**
 * 从预案步骤中提取对路网的**直接副作用**
 * ★ 这是与路线 D「安全 ↔ 路网双向联动」的接线点
 *
 * @param {object} instance instantiatePlaybook 的返回值
 * @returns {{ blockedEdges: string[], unblockedHint: boolean, routeMode: string|null,
 *             closedPlaces: string[], dispatches: object[], broadcasts: string[],
 *             outdoorPaused: boolean, highlightRoute: object|null, requiresCompare: boolean }}
 */
export function extractPlaybookEffects(instance) {
  const effects = {
    blockedEdges: [],
    routeMode: null,
    closedPlaces: [],
    dispatches: [],
    broadcasts: [],
    outdoorPaused: false,
    highlightRoute: null,
    requiresCompare: false,
    evidenceTemplates: [],
  }

  for (const step of instance?.steps ?? []) {
    switch (step.action) {
      case ACTION_CODES.BLOCK_EDGE:
        if (step.params.edgeId) effects.blockedEdges.push(step.params.edgeId)
        if (Array.isArray(step.params.edges)) effects.blockedEdges.push(...step.params.edges)
        break
      case ACTION_CODES.CLOSE_PLACE:
        effects.closedPlaces.push(step.params.place ?? step.target)
        break
      case ACTION_CODES.PAUSE_OUTDOOR:
        effects.outdoorPaused = true
        break
      case ACTION_CODES.REROUTE:
        effects.requiresCompare = Boolean(step.params.showCompare)
        break
      case ACTION_CODES.HIGHLIGHT_ROUTE:
        effects.routeMode = step.params.mode ?? effects.routeMode
        effects.highlightRoute = { mode: step.params.mode ?? null, destination: step.params.destination ?? null }
        break
      case ACTION_CODES.DISPATCH:
        effects.dispatches.push({ role: step.params.role, task: step.params.task, count: step.params.count ?? 1 })
        break
      case ACTION_CODES.BROADCAST:
        effects.broadcasts.push(step.params.text ?? step.target)
        break
      case ACTION_CODES.LOG_EVIDENCE:
        effects.evidenceTemplates.push(step.params.template ?? '处置记录')
        break
      default:
        break
    }
  }

  effects.blockedEdges = [...new Set(effects.blockedEdges)]
  return effects
}

/**
 * ★ 一键执行（决策项 B-20）—— 支持逐项执行与整体撤销
 *
 * 这里不直接改地图状态：本函数只产出**待应用的变更集**，
 * 由调用方（store / reducer）应用。这样风控逻辑与状态管理解耦，也便于测试。
 *
 * @param {object} instance instantiatePlaybook 的返回值
 * @param {{ at?: number, undo?: boolean, only?: string[] }} [options]
 * @returns {{ applied: object[], skipped: object[], changes: object, undoToken: string, summary: string }}
 */
export function executePlaybook(instance, options = {}) {
  const { at = 0, undo = false, only = null } = options
  const applied = []
  const skipped = []

  for (const step of instance?.steps ?? []) {
    if (only && !only.includes(step.action)) {
      skipped.push({ id: step.id, action: step.action, reason: '未被选中执行' })
      continue
    }
    if (step.missing?.length) {
      skipped.push({ id: step.id, action: step.action, reason: `缺少变量：${step.missing.join('、')}` })
      continue
    }

    // ★ 必须回写原始步骤对象的 status：
    //   调用方（Store）依赖步骤状态来重算派生状态（如"是否仍需暂停户外活动"）。
    //   若只把状态放进返回的副本，原始步骤会永远停留在 pending，
    //   重算就永远读不到 done —— 撤销时会出现"该解除的没解除"。
    step.status = undo ? 'reverted' : 'done'
    step.executedAt = at

    applied.push({ ...step })
  }

  const changes = {
    blockedEdgesAdd: undo ? [] : [...new Set(applied.filter((s) => s.action === ACTION_CODES.BLOCK_EDGE)
      .flatMap((s) => [s.params.edgeId, ...(s.params.edges ?? [])]).filter(Boolean))],
    blockedEdgesRemove: undo ? [...new Set((instance?.steps ?? []).filter((s) => s.action === ACTION_CODES.BLOCK_EDGE)
      .flatMap((s) => [s.params.edgeId, ...(s.params.edges ?? [])]).filter(Boolean))] : [],
    closedPlaces: undo ? [] : [...new Set(applied.filter((s) => s.action === ACTION_CODES.CLOSE_PLACE)
      .map((s) => s.params.place ?? s.target))],
    reopenedPlaces: undo ? [...new Set((instance?.steps ?? []).filter((s) => s.action === ACTION_CODES.CLOSE_PLACE)
      .map((s) => s.params.place ?? s.target))] : [],
    routeMode: undo ? null : (applied.find((s) => s.action === ACTION_CODES.HIGHLIGHT_ROUTE)?.params.mode ?? null),
    highlightDestination: undo ? null
      : (applied.find((s) => s.action === ACTION_CODES.HIGHLIGHT_ROUTE)?.params.destination ?? null),
    reroute: !undo && applied.some((s) => s.action === ACTION_CODES.REROUTE),
    showCompare: !undo && applied.some((s) => s.action === ACTION_CODES.REROUTE && s.params.showCompare),
    dispatches: undo ? [] : applied.filter((s) => s.action === ACTION_CODES.DISPATCH)
      .map((s) => ({ role: s.params.role, task: s.params.task, count: s.params.count ?? 1 })),
    broadcasts: undo ? [] : applied.filter((s) => s.action === ACTION_CODES.BROADCAST).map((s) => s.params.text),
    outdoorPaused: !undo && applied.some((s) => s.action === ACTION_CODES.PAUSE_OUTDOOR),
    evidence: applied.filter((s) => s.action === ACTION_CODES.LOG_EVIDENCE).map((s) => s.params.template),
  }

  return {
    applied,
    skipped,
    changes,
    undoToken: `${instance?.kind ?? 'unknown'}@${at}`,
    summary: undo
      ? `已撤销「${instance?.label ?? ''}」：解除 ${changes.blockedEdgesRemove.length} 段封路，恢复 ${changes.reopenedPlaces.length} 个场所，路线自动恢复`
      : `已执行「${instance?.label ?? ''}」：${applied.length} 个动作生效` +
        (skipped.length ? `，${skipped.length} 个被跳过` : '') +
        ` —— ${changes.blockedEdgesAdd.length} 段封路 / ${changes.dispatches.length} 个派单 / ${changes.broadcasts.length} 条广播`,
  }
}

/**
 * 根据推理出的场景自动选择预案
 *
 * @param {{ severityLevel?: string, crowdRiskLevel?: string|null, weatherKind?: string|null,
 *           blocking?: boolean, bigEvent?: boolean }} input
 * @returns {{ kind: string|null, reason: string }}
 */
export function selectPlaybook(input = {}) {
  const { crowdRiskLevel, weatherKind, blocking, bigEvent } = input

  if (weatherKind === 'rainstorm') return { kind: PLAYBOOK_KIND.RAINSTORM, reason: '暴雨预警 → 暴雨应急联动预案' }
  if (weatherKind === 'hail') return { kind: PLAYBOOK_KIND.HAIL, reason: '冰雹预警 → 冰雹避险预案' }
  if (weatherKind === 'heat') return { kind: PLAYBOOK_KIND.HEAT, reason: '高温预警 → 高温防护预案' }
  if (bigEvent) return { kind: PLAYBOOK_KIND.BIG_EVENT, reason: '大型活动散场 → 散场分流预案' }
  if (blocking) return { kind: PLAYBOOK_KIND.ROAD_BLOCKED, reason: '事件影响通行 → 道路占用处置预案' }
  if (crowdRiskLevel === 'high' || crowdRiskLevel === 'critical') {
    return { kind: PLAYBOOK_KIND.CROWD_OVERFLOW, reason: `人流风控「${crowdRiskLevel}」→ 人流超限分流预案` }
  }
  return { kind: null, reason: '当前态势不需要启动预案（风险未达阈值）' }
}

/**
 * 模块自检
 * @returns {{ name: string, passed: boolean, checks: Array<{label: string, passed: boolean, detail: string}> }}
 */
export function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  const DAY = new Date(2026, 8, 28, 14, 0, 0).getTime()

  // ① 六个预案齐备
  add('① 预案库恰好六个（决策项 B-18）',
    Object.keys(PLAYBOOKS).length === 6,
    Object.values(PLAYBOOKS).map((item) => item.label).join(' / '))

  // ② 八个动作原子齐备
  add('② 动作原子恰好八个（决策项 B-19）',
    Object.keys(ACTION_CODES).length === 8,
    Object.values(ACTION_LABELS).map((item) => item.label).join(' / '))

  // ③ 动作按确定性顺序执行（先隔离风险，再改路线，最后通知）
  const storm = instantiatePlaybook(PLAYBOOK_KIND.RAINSTORM, {}, { now: DAY })
  const orders = storm.steps.map((step) => step.order)
  const isSorted = orders.every((value, index) => index === 0 || orders[index - 1] <= value)
  const isolationBeforeNotify =
    storm.steps.findIndex((step) => step.action === ACTION_CODES.BLOCK_EDGE) <
    storm.steps.findIndex((step) => step.action === ACTION_CODES.BROADCAST) &&
    storm.steps.findIndex((step) => step.action === ACTION_CODES.CLOSE_PLACE) <
    storm.steps.findIndex((step) => step.action === ACTION_CODES.DISPATCH)
  add('③ 动作按确定性顺序执行（先隔离风险，后通知）',
    isSorted && isolationBeforeNotify &&
    storm.steps[0].action === ACTION_CODES.BLOCK_EDGE,
    `执行顺序：${storm.steps.map((step) => step.actionLabel).join(' → ')}（序号 ${orders.join(',')} 单调不减）`)

  // ④ 暴雨预案效果提取：封路 + 避雨模式 + 派单
  const stormEffects = extractPlaybookEffects(storm)
  add('④ ★ 暴雨预案提取出封路 / 避雨路线 / 派单三类路网副作用',
    stormEffects.blockedEdges.length === LOW_LYING_EDGES.length &&
    stormEffects.routeMode === 'rain' &&
    stormEffects.dispatches.length >= 1 &&
    stormEffects.outdoorPaused === true,
    `${stormEffects.blockedEdges.length} 段低洼封路（${stormEffects.blockedEdges.join('、')}）；` +
    `路线模式 ${stormEffects.routeMode}（复用已有 ROUTE_MODES.RAIN）；` +
    `${stormEffects.dispatches.length} 个派单；户外活动已暂停`)

  // ⑤ 变量替换
  const blocked = instantiatePlaybook(PLAYBOOK_KIND.ROAD_BLOCKED,
    { edgeId: 'outer_s2→outer_s3', edgeLabel: '第三食堂东侧路段' }, { now: DAY })
  const blockStep = blocked.steps.find((step) => step.action === ACTION_CODES.BLOCK_EDGE)
  const broadcastStep = blocked.steps.find((step) => step.action === ACTION_CODES.BROADCAST)
  add('⑤ 预案变量替换正确（含嵌套与文案内插值）',
    blockStep.params.edgeId === 'outer_s2→outer_s3' &&
    broadcastStep.params.text.includes('第三食堂东侧路段') &&
    blocked.unresolved.length === 0,
    `封路段 ${blockStep.params.edgeId}；广播文案「${broadcastStep.params.text}」`)

  // ⑥ 缺变量时明确报告，不静默产出坏数据
  const incomplete = instantiatePlaybook(PLAYBOOK_KIND.ROAD_BLOCKED, {}, { now: DAY })
  const incompleteExec = executePlaybook(incomplete, { at: DAY })
  add('⑥ 缺变量时明确报告并跳过该步骤，不静默产出坏数据',
    incomplete.unresolved.length > 0 &&
    incompleteExec.skipped.length > 0 &&
    !incompleteExec.changes.blockedEdgesAdd.includes(undefined),
    `未解析变量：${incomplete.unresolved.join('、')}；跳过 ${incompleteExec.skipped.length} 个步骤，理由「${incompleteExec.skipped[0]?.reason}」`)

  // ⑦ 一键执行产出完整变更集
  const full = instantiatePlaybook(PLAYBOOK_KIND.RAINSTORM, { placeName: '第三食堂' }, { now: DAY })
  const exec = executePlaybook(full, { at: DAY })
  add('⑦ 一键执行产出完整变更集（封路/关场所/改路线/派单/广播）',
    exec.changes.blockedEdgesAdd.length > 0 &&
    exec.changes.closedPlaces.length > 0 &&
    exec.changes.reroute === false && // 暴雨预案不含 reroute 步骤
    exec.changes.dispatches.length > 0 &&
    exec.changes.broadcasts.length > 0 &&
    exec.changes.outdoorPaused === true,
    exec.summary)

  // ⑧ 撤销成对（封路与解封是同一套机制的两个方向）
  const undo = executePlaybook(full, { at: DAY + 60000, undo: true })
  add('⑧ ★ 整体撤销：封路集合与关闭场所成对解除',
    undo.changes.blockedEdgesAdd.length === 0 &&
    undo.changes.blockedEdgesRemove.length === exec.changes.blockedEdgesAdd.length &&
    undo.changes.reopenedPlaces.length === exec.changes.closedPlaces.length,
    undo.summary)

  // ⑨ 逐项执行
  const partial = executePlaybook(full, { at: DAY, only: [ACTION_CODES.BLOCK_EDGE, ACTION_CODES.DISPATCH] })
  add('⑨ 支持逐项执行（只做封路与派单）',
    partial.applied.length === 2 &&
    partial.changes.blockedEdgesAdd.length > 0 &&
    partial.changes.broadcasts.length === 0,
    `执行 ${partial.applied.length} 项，跳过 ${partial.skipped.length} 项；广播 ${partial.changes.broadcasts.length} 条（应为 0）`)

  // ⑩ SLA 随等级变化
  const highStorm = instantiatePlaybook(PLAYBOOK_KIND.RAINSTORM, {}, { now: DAY, level: SEVERITY.CRITICAL })
  add('⑩ 预案 SLA 随等级变化',
    highStorm.sla.responseMinutes === 3 && highStorm.sla.dueAt === DAY + 3 * 60000,
    `暴雨预案提升至紧急档 → 响应时限 ${highStorm.sla.label}，升级对象 ${highStorm.sla.escalateTo.join('、')}`)

  // ⑪ 场景自动选预案
  const picks = [
    selectPlaybook({ weatherKind: 'rainstorm' }).kind,
    selectPlaybook({ weatherKind: 'hail' }).kind,
    selectPlaybook({ weatherKind: 'heat' }).kind,
    selectPlaybook({ blocking: true }).kind,
    selectPlaybook({ crowdRiskLevel: 'high' }).kind,
    selectPlaybook({ bigEvent: true }).kind,
  ]
  add('⑪ 六种态势可自动选中对应预案',
    new Set(picks).size === 6 && picks.every(Boolean),
    picks.map((kind) => PLAYBOOK_LABELS[kind]).join(' / '))

  // ⑫ 风险未达阈值时不启动预案
  const noPlaybook = selectPlaybook({ crowdRiskLevel: 'normal' })
  add('⑫ 风险未达阈值时不启动预案（避免过度响应）',
    noPlaybook.kind === null,
    noPlaybook.reason)

  return {
    name: 'domain/playbook.js',
    passed: checks.every((check) => check.passed),
    checks,
  }
}
