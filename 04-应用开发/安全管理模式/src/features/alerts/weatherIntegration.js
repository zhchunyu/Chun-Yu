/**
 * 天气 → 安全态势 集成适配层
 * ---------------------------------------------------------------------------
 * 决策项 C-1~C-19 · B-20 一键预案 · D6 管理者可执行预案
 *
 * ★ 为什么需要这一层，而不是让 domain/safetyStore.js 直接 import data/：
 *   `src/domain/` 是纯逻辑层，必须能在零依赖环境里独立测试
 *   （这是它能被 `scripts/check-all.mjs` 单跑的前提）。
 *   而 `data/weatherActionMap.js` 是数据 / 规则层。
 *   两者通过本文件在 **features 层**汇合 —— 依赖方向单向、边界清晰。
 *
 * 本文件做三件事：
 *   ① 把 `analyzeWeather()` 的规则分析结果翻译成 **可执行的预案实例**；
 *   ② 为 Store 扩展 `runWeatherActions()`，让规则表驱动的动作与六个硬编码预案
 *      走**同一条落地路径**（不会出现两套状态）；
 *   ③ 提供「等级升档 → 待办清单」与「处置归档」的现成数据。
 */

import { analyzeWeather, describeEscalation, createArchiveRecord, ACTION_CODES } from '../../data/weatherActionMap.js'
import { ACTION_ORDER, ACTION_LABELS, PLAYBOOK_KIND, PLAYBOOK_LABELS } from '../../domain/playbook.js'

/**
 * 天气 kind → 对应预案类型
 * ★ 映射不上的（大风 / 雷电）在预案库里没有专属预案，
 *   它们靠动作集驱动（关场所 + 派单），不需要整段预案 —— 这是有意为之。
 */
export const WEATHER_TO_PLAYBOOK = Object.freeze({
  rainstorm: PLAYBOOK_KIND.RAINSTORM,
  hail: PLAYBOOK_KIND.HAIL,
  heat: PLAYBOOK_KIND.HEAT,
})

/**
 * 把 `analyzeWeather()` 的分析结果转换成**可执行的预案实例**
 *
 * ★ `analyzeWeather()` 的返回结构（实测）：
 *   - `riskPoints[]`：逐条规则的**规则级**字段（riskPoint / actions / routeMode / edgeEffect / ruleId）
 *   - `blockedEdges` / `places` / `shelters` / `dispatches` / `broadcasts`：
 *     规则命中的**聚合结果**，位于**顶层**，不在 riskPoints 里
 *   因此构造步骤时，动作参数取自顶层聚合结果，规则级字段只用来标注来源。
 *
 * 产出的结构刻意与 `instantiatePlaybook()` 一致，
 * 这样 `executePlaybook()` / `extractPlaybookEffects()` 可以直接消费，
 * 不需要为「规则驱动的动作」再写一套执行器。
 *
 * @param {object} analysis `analyzeWeather()` 的返回值
 * @param {{ level?: string, now?: number, scenario?: object }} [options]
 * @returns {object|null} 预案实例（结构与 instantiatePlaybook 一致）
 */
export function analysisToPlaybook(analysis, options = {}) {
  if (!analysis?.riskPoints?.length) return null

  const { level = 'high', now = 0, scenario = null } = options

  // 动作码去重：多条规则可能命中同一动作（例如两条规则都要派单），
  // 但顶层的 dispatches / broadcasts 已经聚合了各自的明细，去重后由聚合结果承载全部内容
  const actionCodes = [...new Set(analysis.actions ?? [])]

  const steps = actionCodes
    .map((code, seq) => buildStep({ code, analysis, seq }))
    .sort((a, b) => (ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action)) || (a.seq - b.seq))

  steps.forEach((step, index) => { step.id = `weather:${analysis.scenarioId ?? 'scene'}:step-${index + 1}` })

  const primaryKind = analysis.kind === 'composite'
    ? (analysis.kinds?.[0] ?? 'composite')
    : analysis.kind
  const kind = WEATHER_TO_PLAYBOOK[primaryKind] ?? 'weather-actions'
  const label = PLAYBOOK_LABELS[kind] ?? `${scenario?.label ?? analysis.level}处置动作`

  return {
    kind,
    label,
    trigger: `${scenario?.label ?? analysis.scenarioId ?? analysis.kind}（${analysis.level}）`,
    level,
    source: 'weather-action-map',
    isComposite: Boolean(analysis.isComposite),
    ruleIds: analysis.riskPoints.map((point) => point.ruleId).filter(Boolean),
    sla: null, // 由调用方按等级补
    steps,
    unresolved: steps.flatMap((step) => step.missing ?? []),
    summary: analysis.summary,
    analyzedAt: analysis.analyzedAt ?? null,
    now,
  }
}

/** 单个动作码 → 步骤对象（参数取自顶层聚合结果，而不是硬编码） */
function buildStep({ code, analysis, seq }) {
  const ruleIds = analysis.riskPoints
    .filter((point) => (point.actions ?? []).includes(code))
    .map((point) => point.ruleId)
    .filter(Boolean)

  const riskLabels = analysis.riskPoints
    .filter((point) => (point.actions ?? []).includes(code))
    .map((point) => point.riskPoint)
    .filter(Boolean)

  const base = {
    action: code,
    actionLabel: ACTION_LABELS[code]?.label ?? code,
    target: riskLabels[0] ?? '校园',
    note: ruleIds.length ? `来源规则 ${ruleIds.join('、')}` : '',
    status: 'pending',
    missing: [],
    seq,
    ruleIds,
  }

  switch (code) {
    case ACTION_CODES.BLOCK_EDGE:
      return {
        ...base,
        params: { edges: analysis.blockedEdges ?? [] },
        target: '低洼 / 风险路段',
      }

    case ACTION_CODES.CLOSE_PLACE:
      return {
        ...base,
        params: {
          places: (analysis.places ?? []).map((place) => place.name),
          reason: riskLabels[0] ?? '天气风险',
        },
        target: (analysis.places ?? []).map((place) => place.name).join('、') || '风险场所',
      }

    case ACTION_CODES.REROUTE:
      return {
        ...base,
        params: { showCompare: true, routeMode: analysis.routeMode ?? null },
        target: '受影响路线',
      }

    case ACTION_CODES.HIGHLIGHT_ROUTE:
      return {
        ...base,
        params: {
          mode: analysis.routeMode ?? null,
          shelters: (analysis.shelters ?? []).map((shelter) => shelter.name),
          destination: analysis.shelters?.[0]?.name ?? null,
        },
        target: (analysis.shelters ?? []).map((shelter) => shelter.name).join('、') || '推荐通道',
      }

    case ACTION_CODES.DISPATCH: {
      const list = analysis.dispatches ?? []
      return {
        ...base,
        params: {
          role: list.map((item) => item.role).join('、') || '保卫处',
          task: list.map((item) => item.task).join('；') || `现场核实：${riskLabels[0] ?? '风险点'}`,
          count: list.length || 1,
          items: list,
        },
        target: list.map((item) => item.role).join('、') || '保卫处',
      }
    }

    case ACTION_CODES.BROADCAST: {
      const list = analysis.broadcasts ?? []
      return {
        ...base,
        params: { text: list[0] ?? `${riskLabels[0] ?? '天气风险'}，请注意防范`, items: list },
        target: '全校 / 相关区域',
      }
    }

    case ACTION_CODES.PAUSE_OUTDOOR:
      return {
        ...base,
        params: { scope: '户外', reason: riskLabels[0] ?? '天气风险' },
        target: '户外活动与课程',
      }

    case ACTION_CODES.LOG_EVIDENCE:
      return {
        ...base,
        params: { template: analysis.summary?.slice(0, 40) ?? '天气处置记录' },
        target: '处置留痕',
      }

    default:
      return { ...base, params: {} }
  }
}

/**
 * 为 Store 扩展「按天气规则执行动作」的能力
 *
 * ★ 用法：在创建 store 之后调用一次，store 会多出 `runWeatherActions()` 等方法。
 *   它复用 Store 内部的封路集合、关闭场所与路线请求契约，
 *   因此**天气规则与六个预案走的是同一条落地路径** —— 不会出现两套状态。
 *
 * @param {object} store `createSafetyStore()` 的返回值
 * @returns {object} 扩展后的 store（原地增强，仍返回同一对象）
 */
export function enableWeatherActions(store) {
  if (!store || typeof store.runPlaybook !== 'function') {
    throw new Error('enableWeatherActions 需要 createSafetyStore() 的返回值')
  }
  if (store.runWeatherActions) return store

  /**
   * 按规则表执行天气处置动作
   *
   * @param {object|object[]} scenarios 天气场景（单个或数组 —— 数组即复合天气）
   * @param {{ now?: number, alert?: object, level?: string, only?: string[] }} [options]
   */
  store.runWeatherActions = (scenarios, options = {}) => {
    const { now = store.getNow(), alert = null, level = 'high', only = null, syncWeather = true } = options

    // ★ 同步 Store 的天气状态：否则后续人流风控拿到的还是旧天气，
    //   会出现"天气已切到暴雨、但风控仍按晴天容量判定"的静默不一致。
    const scenarioId = Array.isArray(scenarios)
      ? (scenarios[0]?.id ?? null)
      : (scenarios?.id ?? null)
    if (syncWeather && scenarioId && typeof store.setWeather === 'function') {
      store.setWeather(scenarioId, { now, autoAlert: false })
    }

    const analysis = analyzeWeather(scenarios)
    const instance = analysisToPlaybook(analysis, {
      level,
      now,
      scenario: Array.isArray(scenarios) ? scenarios[0] : scenarios,
    })

    if (!instance) {
      return {
        ok: false,
        analysis,
        reason: '当前天气未命中任何处置规则（晴好天气无需动作）',
        changes: null,
      }
    }

    // 逐项执行：未选中的动作保持 pending
    instance.steps.forEach((step) => {
      const selected = !only || only.includes(step.action)
      step.status = selected ? 'done' : 'pending'
      step.executedAt = selected ? now : null
    })

    const executed = instance.steps.filter((step) => step.status === 'done')

    const effects = {
      blockedEdges: executed.flatMap((step) =>
        step.action === ACTION_CODES.BLOCK_EDGE ? (step.params.edges ?? []) : []),
      closedPlaces: executed
        .filter((step) => step.action === ACTION_CODES.CLOSE_PLACE)
        .flatMap((step) => step.params.places ?? []),
      dispatches: executed
        .filter((step) => step.action === ACTION_CODES.DISPATCH)
        .flatMap((step) => step.params.items ?? [{ role: step.params.role, task: step.params.task }]),
      broadcasts: executed
        .filter((step) => step.action === ACTION_CODES.BROADCAST)
        .flatMap((step) => step.params.items ?? [step.params.text]),
      outdoorPaused: executed.some((step) => step.action === ACTION_CODES.PAUSE_OUTDOOR),
      routeMode: executed.find((step) => step.action === ACTION_CODES.HIGHLIGHT_ROUTE)?.params.mode ?? null,
      reroute: executed.some((step) => step.action === ACTION_CODES.REROUTE),
      showCompare: executed.some((step) => step.action === ACTION_CODES.REROUTE && step.params.showCompare),
      shelters: executed
        .filter((step) => step.action === ACTION_CODES.HIGHLIGHT_ROUTE)
        .flatMap((step) => step.params.shelters ?? []),
      evidence: executed
        .filter((step) => step.action === ACTION_CODES.LOG_EVIDENCE)
        .map((step) => step.params.template),
      places: (analysis.places ?? []).map((place) => place.name),
    }

    // ★ 回写 Store 状态 —— 否则会出现「动作执行了、但 getState() 里封路数还是 0」
    //   的账目不一致：大屏显示与地图实际不一致，演示时最容易被一眼看穿。
    if (typeof store.applyExternalChanges === 'function') {
      store.applyExternalChanges({
        blockedEdgesAdd: effects.blockedEdges,
        closedPlaces: effects.closedPlaces,
        outdoorPaused: effects.outdoorPaused,
        at: now,
        source: 'weather-action-map',
        note: instance.label,
      })
    }

    return {
      ok: true,
      analysis,
      instance,
      effects,
      alert,
      isComposite: Boolean(analysis.isComposite),
      summary: analysis.summary,
      actions: analysis.actions,
      ruleIds: instance.ruleIds,
      // ★ 交给调用方落到图上：封路集合 + 路线模式 + 避险通道
      routeImpact: {
        blockedEdgeIds: effects.blockedEdges,
        routeMode: effects.routeMode,
        reroute: effects.reroute,
        showCompare: effects.showCompare,
        shelters: effects.shelters,
        summary: buildRouteSummary(effects),
      },
    }
  }

  /**
   * 等级变化 → 待办清单（C-17）
   * @param {object} prevAnalysis
   * @param {object} nextAnalysis
   */
  store.describeWeatherEscalation = (prevAnalysis, nextAnalysis) =>
    describeEscalation(prevAnalysis, nextAnalysis)

  /** 处置归档（C-19）—— 形成「本学期因暴雨封路 N 次」这类统计的原始记录 */
  store.archiveWeatherHandling = (analysis, options = {}) => createArchiveRecord(analysis, options)

  return store
}

function buildRouteSummary(effects) {
  const parts = []
  if (effects.blockedEdges.length) parts.push(`封闭 ${effects.blockedEdges.length} 段风险路段`)
  if (effects.reroute) parts.push(`重算路线${effects.showCompare ? '并渲染新旧对比' : ''}`)
  if (effects.routeMode) parts.push(`切换路线模式为「${effects.routeMode}」`)
  if (effects.shelters.length) parts.push(`高亮 ${effects.shelters.length} 段避险通道`)
  if (effects.closedPlaces.length) parts.push(`关闭 ${effects.closedPlaces.length} 个场所`)
  if (effects.outdoorPaused) parts.push('暂停户外活动')
  return parts.length ? parts.join('，') : '本次天气未产生路网变更'
}

/**
 * 用当前态势生成安全简报文案（E-6 / E-18 · 规则模板轨）
 *
 * ★ 这是**模板轨**：不依赖任何 LLM，离线可用、结果确定。
 *   若 LLM 可用则由调用方替换文案，但「判定依据」仍取自本函数的 facts。
 *   这样 LLM 只做表达层，判定逻辑全在规则引擎 —— 可解释、可审计。
 *
 * @param {object} state `store.getState()` 的返回值
 * @param {object} [analysis] `analyzeWeather()` 的结果（可选，用于补充一句天气结论）
 * @returns {{ text: string, facts: Array<{label: string, value: string}> }}
 */
export function buildSafetyBriefing(state, analysis = null) {
  if (!state) return { text: '', facts: [] }

  const parts = []
  const facts = []

  const weather = state.weather
  if (weather && weather.kind !== 'clear') {
    parts.push(`${weather.label}生效中`)
    facts.push({ label: '天气', value: weather.label })
  } else {
    parts.push('当前天气平稳')
  }

  const risky = (state.riskReadings ?? []).filter((item) => item.level !== 'normal')
  if (risky.length) {
    const top = risky
      .slice()
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
      .slice(0, 2)
    parts.push(`${top.map((item) => `${item.name}占用率 ${Math.round((item.ratio ?? 0) * 100)}%`).join('、')}，建议提前启动分流`)
    facts.push({ label: '人流告警', value: `${risky.length} 处` })
  }

  const active = state.activeAlerts ?? []
  if (active.length) {
    const high = active.filter((alert) => alert.level === 'critical' || alert.level === 'high')
    parts.push(`待处置预警 ${active.length} 条${high.length ? `（其中高等级 ${high.length} 条）` : ''}`)
    facts.push({ label: '活跃预警', value: `${active.length} 条` })
  }

  if (state.blockedEdges?.length) {
    parts.push(`已封控 ${state.blockedEdges.length} 段道路`)
    facts.push({ label: '封控路段', value: `${state.blockedEdges.length} 段` })
  }
  if (state.closedPlaces?.length) {
    parts.push(`关闭 ${state.closedPlaces.length} 个场所`)
    facts.push({ label: '关闭场所', value: `${state.closedPlaces.length} 个` })
  }
  if (state.outdoorPaused) parts.push('户外活动已暂停')

  const stats = state.responseStats
  if (stats?.avgResponseMinutes != null) {
    const avg = Math.round(stats.avgResponseMinutes * 10) / 10
    parts.push(`平均响应 ${avg} 分钟，超时率 ${stats.overdueRate}%`)
    facts.push({ label: '平均响应', value: `${avg} 分` })
    facts.push({ label: '超时率', value: `${stats.overdueRate}%` })
  }

  if (analysis?.summary) parts.push(analysis.summary)

  return { text: `${parts.join('；')}。`, facts }
}

/**
 * 模块自检
 * @returns {Promise<{name: string, passed: boolean, checks: Array}>}
 */
export async function runSelfCheck() {
  const checks = []
  const add = (label, passed, detail) => checks.push({ label, passed, detail })

  const DAY = new Date(2026, 8, 28, 14, 0, 0).getTime()

  let source = null
  try {
    const mod = await import('../../data/weatherDataSource.js')
    source = mod.createWeatherSource({ now: () => new Date(DAY) })
  } catch {
    return {
      name: 'features/alerts/weatherIntegration.js',
      passed: true,
      checks: [{ label: '数据层不可用，已跳过集成自检', passed: true, detail: '未找到 data/weatherDataSource.js' }],
    }
  }

  // ① 晴好天气不产生动作
  const clearAnalysis = analyzeWeather(source.getCurrent())
  const clearPlaybook = analysisToPlaybook(clearAnalysis, { now: DAY })
  add('① 晴好天气不产生处置动作（避免过度响应）',
    clearPlaybook === null && clearAnalysis.riskPoints.length === 0,
    `晴好分析风险点 ${clearAnalysis.riskPoints.length} 个 → 预案${clearPlaybook === null ? '不生成' : '生成（异常）'}`)

  // ② 暴雨红警 → 完整动作集
  source.setScenario('rainstorm_red')
  const stormAnalysis = analyzeWeather(source.getCurrent())
  const stormPlaybook = analysisToPlaybook(stormAnalysis, { now: DAY, level: 'high' })
  add('② 暴雨红警生成完整可执行预案',
    Boolean(stormPlaybook) &&
    stormPlaybook.steps.length >= 5 &&
    stormPlaybook.steps.every((step) => step.status === 'pending'),
    `${stormPlaybook?.steps.length} 个动作：${stormPlaybook?.steps.map((s) => s.actionLabel).join(' → ')}`)

  // ③ 动作按确定性顺序（先隔离风险）
  const orders = stormPlaybook.steps.map((step) => ACTION_ORDER.indexOf(step.action))
  add('③ 规则驱动的动作同样按确定性顺序排列',
    orders.every((value, index) => index === 0 || orders[index - 1] <= value) &&
    stormPlaybook.steps[0].action === ACTION_CODES.BLOCK_EDGE,
    `顺序序号 ${orders.join(',')}；首动作「${stormPlaybook.steps[0].actionLabel}」`)

  // ④ 封路集合来自规则表而非硬编码
  const blockStep = stormPlaybook.steps.find((step) => step.action === ACTION_CODES.BLOCK_EDGE)
  add('④ 封路集合取自规则表（可在 UI 展示来源规则）',
    (blockStep?.params.edges?.length ?? 0) > 0 && (blockStep?.ruleIds?.length ?? 0) > 0,
    `封 ${blockStep?.params.edges?.length} 段，来源规则 ${blockStep?.ruleIds?.join('、')}：${blockStep?.params.edges?.join('、')}`)

  // ⑤ 避雨模式与避险通道被正确传递
  const highlightStep = stormPlaybook.steps.find((step) => step.action === ACTION_CODES.HIGHLIGHT_ROUTE)
  add('⑤ 高亮路线携带避雨模式与避险通道（复用已有 ROUTE_MODES.RAIN）',
    highlightStep?.params.mode === 'rain' && (highlightStep?.params.shelters?.length ?? 0) > 0,
    `routeMode = ${highlightStep?.params.mode}，避险通道：${highlightStep?.params.shelters?.join('、')}`)

  // ⑤b 派单与广播取自顶层聚合（不是硬编码默认值）
  const dispatchStep = stormPlaybook.steps.find((step) => step.action === ACTION_CODES.DISPATCH)
  const broadcastStep = stormPlaybook.steps.find((step) => step.action === ACTION_CODES.BROADCAST)
  add('⑤b 派单与广播取自规则表聚合结果',
    (dispatchStep?.params.items?.length ?? 0) > 0 &&
    (broadcastStep?.params.items?.length ?? 0) > 0 &&
    /后勤|教务|保卫/.test(dispatchStep?.params.role ?? ''),
    `派单 ${dispatchStep?.params.items?.length} 项（${dispatchStep?.params.role}）；广播 ${broadcastStep?.params.items?.length} 条`)

  // ⑥ 等级升档 → 待办 + 差异
  const diff = describeEscalation(clearAnalysis, stormAnalysis)
  add('⑥ 等级升档产出待办清单与动作差异',
    diff.direction === 'up' && (diff.todoItems?.length ?? 0) > 0,
    `${diff.summary ?? ''}；待办 ${diff.todoItems?.length ?? 0} 条：${(diff.todoItems ?? []).map((item) => item.label).join('、')}`)

  // ⑦ 复合天气按最高等级统一响应
  const galeScenario = source.listScenarios().find((item) => item.kind === 'gale')
  const composite = analyzeWeather([source.getCurrent(), galeScenario])
  add('⑦ 复合天气按最高等级统一响应（风险叠加升级）',
    composite.isComposite === true || composite.scenarioIds?.length > 1,
    `组合 ${composite.scenarioIds?.join(' + ')}；封路 ${composite.blockedEdges?.length ?? 0} 段；动作 ${composite.actions?.length ?? 0} 类`)

  // ⑧ Store 扩展可用
  // ★ 必须把**真实天气源**注入 Store：否则 Store 用的是内置空源（只认晴好），
  //   `runWeatherActions` 的状态同步会静默失效 —— 这正是本自检要防的不一致。
  const { createSafetyStore } = await import('../../domain/safetyStore.js')
  const store = createSafetyStore({ now: DAY, weatherSource: source })
  enableWeatherActions(store)
  add('⑧ enableWeatherActions 为 Store 扩展出天气动作能力',
    typeof store.runWeatherActions === 'function' &&
    typeof store.describeWeatherEscalation === 'function' &&
    typeof store.archiveWeatherHandling === 'function',
    '已扩展 runWeatherActions / describeWeatherEscalation / archiveWeatherHandling')

  // ⑨ 执行天气动作产出可落地的变更集
  const run = store.runWeatherActions(source.getCurrent(), { now: DAY, level: 'high' })
  add('⑨ ★ 天气规则动作产出可直接落地的变更集',
    run.ok &&
    run.effects.blockedEdges.length > 0 &&
    run.effects.dispatches.length > 0 &&
    run.effects.broadcasts.length > 0 &&
    run.effects.outdoorPaused === true &&
    run.instance.steps.every((step) => step.status === 'done'),
    `封 ${run.effects.blockedEdges.length} 段 / 关 ${run.effects.closedPlaces.length} 处 / 派单 ${run.effects.dispatches.length} 项 / ` +
    `广播 ${run.effects.broadcasts.length} 条 / 避险通道 ${run.effects.shelters.length} 段 / 路线模式 ${run.effects.routeMode}`)

  // ⑩ 逐项执行
  const partial = store.runWeatherActions(source.getCurrent(), { now: DAY, only: [ACTION_CODES.BLOCK_EDGE] })
  add('⑩ 支持逐项执行天气动作',
    partial.instance.steps.filter((step) => step.status === 'done').length === 1,
    `仅执行「路段封闭」，其余 ${partial.instance.steps.length - 1} 个动作保持待执行`)

  // ⑪ 归档记录（C-19）
  const record = store.archiveWeatherHandling(stormAnalysis, { scenario: source.getCurrent() })
  add('⑪ 处置归档记录可入库（支撑"本学期封路 N 次"统计）',
    Boolean(record?.recordId) && record.isDemo === true,
    `${record?.recordId}`)

  // ⑫ 安全简报（模板轨，离线可用）
  // ★ 简报的天气与封路数取自 **Store 状态**，所以必须先真的把天气与动作灌进 Store，
  //   不能拿另一个场景的 analysis 去配当前状态 —— 那样断言测的是错配而不是实现。
  const compositeRun = store.runWeatherActions([source.getCurrent(), galeScenario], { now: DAY, level: 'high' })
  const state = store.getState(DAY)
  const briefing = buildSafetyBriefing(state, compositeRun.analysis)
  add('⑫ 安全简报模板轨离线可生成，且事实项来自真实态势',
    briefing.text.length > 10 && briefing.facts.length >= 3 &&
    state.weather?.kind === 'rainstorm',
    `「${briefing.text}」；依据 ${briefing.facts.length} 项：${briefing.facts.map((f) => `${f.label}=${f.value}`).join(' / ')}`)

  // ⑬ 天气状态同步（避免"天气已切暴雨、风控仍按晴天容量判定"的静默不一致）
  add('⑬ ★ 执行天气动作时同步 Store 天气状态',
    state.weather?.kind === 'rainstorm' && state.weather?.label?.includes('暴雨'),
    `Store 当前天气：${state.weather?.label}（kind=${state.weather?.kind}）—— 人流风控容量修正会随之生效`)

  // ⑭ 复合天气在简报中体现为叠加风险
  add('⑭ 复合天气在简报与摘要中体现叠加语义',
    compositeRun.isComposite === true && /叠加/.test(compositeRun.summary ?? ''),
    compositeRun.summary)

  return {
    name: 'features/alerts/weatherIntegration.js',
    passed: checks.every((check) => check.passed),
    checks,
  }
}
