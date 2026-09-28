/**
 * 安全管理模式 · 完整演示剧本（可执行）
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scenarios/demo-run.mjs              按时间线跑完整场演示，打印每幕结果
 *   node scenarios/demo-run.mjs --json       输出 JSON（供演示视频剧本 / 方案书取数）
 *   node scenarios/demo-run.mjs --skip-weather  不依赖 data 层，只用域层假数据跑通
 *
 * ★ 这个脚本有双重用途：
 *   1. **技术验证**：一条命令证明四条路线真的串起来了，不是纸上设计；
 *   2. **答辩剧本**：每一幕的打印文本可以直接当作演示视频的分镜文案，
 *      也是方案书「效果」章节的取数来源。
 *
 * 演示数据一律自我声明为演示数据（Y-1），不假装真实。
 */

import { createSafetyStore } from '../src/domain/safetyStore.js'
import {
  ALERT_STATE, ALERT_STATE_LABELS, checkSla, gradeAlert as gradeAlertRef,
} from '../src/domain/alert.js'
import { RISK_LEVEL_LABELS } from '../src/domain/crowdRisk.js'
import { PLAYBOOK_LABELS } from '../src/domain/playbook.js'
import { PLACE_CAPACITY as placeRef } from '../src/domain/crowd.js'

const args = process.argv.slice(2)
const AS_JSON = args.includes('--json')

// ---------------------------------------------------------------------------
// 时间基准：固定日期，保证演示完全可复现
// 2026-09-28（周一）11:20 起 —— 午间高峰前 10 分钟，最有戏剧性的时间点
// ---------------------------------------------------------------------------
const T0 = new Date(2026, 8, 28, 11, 20, 0).getTime()
const MIN = 60 * 1000
const at = (minutes) => T0 + minutes * MIN

const acts = []
function record(act, title, detail, data = null) {
  acts.push({ act, title, detail, data })
  if (!AS_JSON) {
    console.log('')
    console.log(`\u001b[36m\u001b[1m【第 ${act} 幕】${title}\u001b[0m`)
    console.log(`  ${detail}`)
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        console.log(`  \u001b[2m${key}：\u001b[0m${value}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 天气源：优先用 data 层的 W3 预置场景，取不到则退化为内置假实现
// （这样脚本在没有 data 层时也能跑通，方便分阶段开发）
// ---------------------------------------------------------------------------
async function loadWeatherSource() {
  if (!args.includes('--skip-weather')) {
    try {
      const mod = await import('../src/data/weatherDataSource.js')
      return { source: mod.createWeatherSource({ now: () => new Date(T0) }), kind: 'data-layer', label: 'data/weatherDataSource.js（W3 预置场景快照）' }
    } catch { /* 落到下面的内置实现 */ }
  }
  const scenarios = {
    clear: { id: 'clear', label: '晴好', kind: 'clear', level: 'blue', text: '无气象预警', isDemo: true },
    rainstorm_red: { id: 'rainstorm_red', label: '暴雨红色预警', kind: 'rainstorm', level: 'red', text: '未来 3 小时内降雨量将达 100 毫米以上', isDemo: true },
  }
  const order = { blue: 0, yellow: 1, orange: 2, red: 3 }
  let current = scenarios.clear
  const records = []
  return {
    kind: 'builtin',
    label: '内置假天气源（未启用 data 层）',
    source: {
      getCurrent: () => current,
      getAlerts: () => (current.kind === 'clear' ? [] : [current]),
      listScenarios: () => Object.values(scenarios),
      setScenario: (id) => {
        const next = scenarios[id] ?? scenarios.clear
        records.push({
          fromLevel: current.level, toLevel: next.level, scenarioId: next.id,
          direction: order[next.level] > order[current.level] ? 'up' : order[next.level] < order[current.level] ? 'down' : 'same',
        })
        current = next
      },
      subscribe: () => () => {},
      history: () => records,
      mode: 'snapshot',
      available: true,
    },
  }
}

const weather = await loadWeatherSource()

// ---------------------------------------------------------------------------
// 场景：与真实平台对齐的占位数据
// ★ 锚点 id 用 CampusTwin 的 locationId 风格，路段 id 用 roadEdgeId() 的 `a→b` 形式
// ---------------------------------------------------------------------------
const store = createSafetyStore({
  weatherSource: weather.source,
  now: at(0),
  adjacency: {
    Canteen: ['Road-Axis', 'Plaza-Center', 'Canteen-2'],
    'Road-Axis': ['Canteen', 'Gate-Main'],
    'Plaza-Center': ['Canteen', 'Library'],
  },
  // 与真实路网对接：地点 → 关联路段（真实值需按 roadNetwork.js 的 ROAD_EDGES 替换）
  edgeIdResolver: (place) => ({
    第三食堂: 'outer_s2→outer_s3',
    亭兰图书馆: 'inner_e_s4→outer_s3',
    中央广场: 'axis_gate→outer_s2',
  }[place?.name] ?? null),
})

const reading = (locationId, name, placeKind, capacity, ratio, ts) => ({
  locationId, name, placeKind,
  count: Math.round(ratio * capacity),
  capacity,
  effectiveCapacity: capacity,
  ratio,
  trend: null,
  ts,
})

// ===========================================================================
// 第 1 幕：人流阈值风控 —— 午间高峰，食堂逼近容量上限
// ===========================================================================
const crowdReadings = [0.62, 0.74, 0.83, 0.91, 0.94, 0.96].map((ratio, index) =>
  reading('Canteen', '第三食堂', 'dining', 396, ratio, at(index)))
const crowd = store.ingestCrowdReadings(crowdReadings, { now: at(5) })
const crowdAlert = crowd.results.at(-1)?.alert
const riskPeek = store.peekRisk('Canteen')

record(1, '人流阈值风控：迟滞 + 驻留 + 冷却 + 趋势', '第三食堂午间高峰，占用率由 62% 升至 96%', {
  '安全容量口径': '座位数 330 × 1.2 瞬时容差 = 396 人',
  '占用率序列': crowdReadings.map((r) => `${Math.round(r.ratio * 100)}%`).join(' → '),
  '风控档位': `${RISK_LEVEL_LABELS[riskPeek.level]}（驻留确认 ${riskPeek.dwellCount} 片）`,
  '自动生成的预警': crowdAlert ? `「${crowdAlert.title}」· ${crowdAlert.levelLabel}` : '未生成',
  '证据链': crowdAlert?.evidence?.slice(0, 3).map((e) => `${e.label}：${e.detail}`).join(' ｜ ') ?? '—',
})

// 空间传播
record(1.1, '空间传导：拥挤向上游扩散', crowd.propagation.detail, Object.fromEntries(
  crowd.propagation.propagated.map((item) => [
    `${item.name}（距${item.sourceName} ${item.hop} 跳）`,
    `${RISK_LEVEL_LABELS[item.level]} · 强度 ${item.strength} —— ${item.detail}`,
  ]),
))

// ===========================================================================
// 第 2 幕：一键预案 —— 从"看到"到"做"
// ===========================================================================
const crowdPlan = store.planForAlert(crowdAlert, { now: at(6) })
const crowdRun = store.runPlaybook(crowdAlert, { now: at(6) })
record(2, '一键预案：人流超限分流', `${crowdPlan.reason}`, {
  '预案动作': crowdPlan.instance?.steps.map((s) => `${s.actionLabel}（${s.target}）`).join(' → ') ?? '—',
  '执行摘要': crowdRun.summary,
  '广播文案': crowdRun.changes.broadcasts.join(' ｜ ') || '—',
  '派单': crowdRun.changes.dispatches.map((d) => `${d.role}：${d.task}`).join(' ｜ ') || '—',
  '路网影响': crowdRun.routeImpact.summary,
})

// ===========================================================================
// 第 3 幕：天气应急联动 —— 暴雨红警升档
// ===========================================================================
const weatherResult = store.setWeather('rainstorm_red', { now: at(8) })
const weatherAlert = weatherResult.alert
record(3, '天气应急联动：暴雨红色预警升档', weatherResult.sideEffects.join('；') || '已切换场景', {
  '数据源': weather.label,
  '气象等级变化': `${weatherResult.previous?.label ?? '—'} → ${weatherResult.scenario?.label ?? '—'}（${weatherResult.direction}）`,
  '自动生成的预警': weatherAlert ? `「${weatherAlert.title}」· ${weatherAlert.levelLabel} · 状态 ${ALERT_STATE_LABELS[weatherAlert.state] ?? weatherAlert.state}` : '未生成',
})

// ===========================================================================
// 第 4 幕：★ 核心亮点 —— 气象翻译成行动 + 安全与路网双向联动
// ===========================================================================
const stormPlan = store.planForAlert(weatherAlert, { now: at(9) })
const stormRun = store.runPlaybook(weatherAlert, { now: at(9) })
const stormState = store.getState(at(9))

record(4, '★ 安全 ↔ 路网双向联动：预警一发布，路线自动改', `${stormPlan.reason}`, {
  '暴雨预案动作': stormPlan.instance?.steps.map((s) => s.actionLabel).join(' → ') ?? '—',
  '封控路段（blocked_edges）': stormState.blockedEdges.join('、') || '无',
  '关闭场所': stormState.closedPlaces.join('、') || '无',
  '暂停户外活动': stormState.outdoorPaused ? '是' : '否',
  '★ 路线模块可直接消费的参数': JSON.stringify(stormRun.routeImpact.routeRequest),
  '路线模式': `${stormRun.routeImpact.routeMode}（复用已有 ROUTE_MODES.RAIN，零新增代码）`,
  '广播': stormRun.changes.broadcasts.join(' ｜ ') || '—',
})

// ===========================================================================
// 第 5 幕：事故突发预警 —— 可信度闸门分出两条路
// ===========================================================================
// ★ 两条上报刻意选在**不同场所**，用来演示"同样的 AI 分类，不同场所不同级别"
const lowEvent = store.ingestEvent({
  id: 'e-railing', type: 'safety', title: '湖边挑台护栏松动', locationId: 'Library', ts: at(10),
  placeKind: 'teaching',
  ai: { credibility: { score: 0.55, threshold: 0.75 } },
}, { now: at(10) })

const highEvent = store.ingestEvent({
  id: 'e-truck', type: 'traffic', title: '三食堂门口停了辆卡车，无法通行', locationId: 'Canteen', ts: at(10),
  ai: { credibility: { score: 0.86, threshold: 0.65 } },
}, { now: at(10) })

record(5, '★ 可信度闸门：安全类低可信度不上图，通行类自动发布', '两条上报走两条完全不同的路', {
  '① 湖边挑台护栏松动（安全类 55%）': `${ALERT_STATE_LABELS[lowEvent.alert.state]} —— ${lowEvent.gate.detail}`,
  '② 卡车占道（通行类 86%）': `${ALERT_STATE_LABELS[highEvent.alert.state]} —— ${highEvent.gate.detail}`,
  '分级推演（护栏 · 图书馆）': lowEvent.grading.evidence.map((e) => `${e.label}：${e.detail}`).join(' ｜ '),
  '分级推演（卡车 · 食堂）': highEvent.grading.evidence.map((e) => `${e.label}：${e.detail}`).join(' ｜ '),
})

// 同一类事件在不同场所的定级梯度（★ 决策项 B-8 的可视化证明）
const gradient = [
  ['Plaza-Center', 'plaza', '中央广场'],
  ['Canteen', 'dining', '第三食堂'],
  ['Dorm-A', 'dormitory', '宿舍A栋'],
].map(([id, kind, name]) => {
  const grading = gradeAlertRef({ id: `g-${id}`, type: 'traffic', locationId: id, ts: at(10) },
    { placeKind: kind, place: placeRef[id], at: at(10) })
  return `${name} ×${grading.sensitivity.weight}（分值 ${grading.sensitivityScore}）→ ${grading.levelLabel}`
})
record(5.1, '★ 场所敏感度梯度：同类事件，不同场所不同级别', '安全类与通行类分别演示倍率如何产生档位差', {
  '通行类「车辆占道」在三个场所': gradient.join(' ｜ '),
  '为什么重要': '把「AI 分类」和「校园空间知识」真正接起来 —— 大多数方案里这两者是不相干的',
})

// ===========================================================================
// 第 6 幕：事故处置闭环 —— 派单 → 处置 → 归档
// ===========================================================================
const truckPlan = store.planForAlert(highEvent.alert, { now: at(11) })
const truckRun = store.runPlaybook(highEvent.alert, { now: at(11) })
const afterTruck = store.getState(at(11))
record(6, '事故处置闭环：封路 → 派单 → 处置 → 归档', truckRun.summary, {
  '预案': `${truckPlan.instance?.label} —— ${truckPlan.reason}`,
  '封控路段': truckRun.changes.blockedEdgesAdd.join('、') || '无',
  '路线对比渲染': truckRun.changes.showCompare ? '开启（原路线灰虚线 + 新路线高亮流动粒子）' : '未开启',
  '当前全部封控路段': afterTruck.blockedEdges.join('、') || '无',
  'SLA': `${highEvent.alert.sla.label}内响应，升级至 ${highEvent.alert.sla.escalateTo.join('、')}`,
})

// ===========================================================================
// 第 7 幕：★ 反向闭环 —— 证据矛盾 → 自动解封 → 路线恢复
// ===========================================================================
const blockedBefore = store.getBlockedEdges().length
const contradict = store.advanceAlertState(highEvent.alert.id, ALERT_STATE.CONTRADICTED, {
  at: at(13),
  detail: '另一用户上报「已通过，卡车已挪走」→ 证据矛盾 → 可信度回落',
})
const afterContradict = store.getState(at(13))
record(7, '★ 反向闭环：证据矛盾 → 自动解封 → 路线恢复', contradict.sideEffects.join(' ｜ '), {
  '触发': '他人上报「已通过」→ 证据矛盾 → 可信度回落',
  '封路数变化': `${blockedBefore} 段 → ${afterContradict.blockedEdges.length} 段`,
  '自动解封的路段': contradict.ok ? `outer_s2→outer_s3` : '—',
  '为什么这条最有说服力': '一次演示同时证明：多源交叉验证 + 状态机回落 + 路网联动解封',
})

// ===========================================================================
// 第 8 幕：天气降档 → 自动解封
// ===========================================================================
const downResult = store.setWeather('clear', { now: at(15) })
const afterDown = store.getState(at(15))
record(8, '天气降档 → 自动解封 + 场所恢复', downResult.sideEffects.join('；') || '已恢复晴好', {
  '封控路段': afterDown.blockedEdges.join('、') || '无（全部解除）',
  '关闭场所': afterDown.closedPlaces.join('、') || '无（全部恢复）',
  '暂停户外活动': afterDown.outdoorPaused ? '仍暂停' : '已恢复',
})

// ===========================================================================
// 第 9 幕：处置时效 —— 证明闭环真的闭合了
// ===========================================================================
const finalState = store.getState(at(20))
record(9, '★ 安全态势大屏：处置时效指标', finalState.responseStats.summary, {
  '风险总览': finalState.riskOverview.summary,
  '预警总数': `${finalState.alerts.length} 条（活跃 ${finalState.activeAlerts.length} 条）`,
  '平均响应时长': `${finalState.responseStats.avgResponseMinutes ?? '—'} 分钟`,
  '超时率': `${finalState.responseStats.overdueRate}%`,
  '闭环率': `${finalState.responseStats.closureRate}%`,
  '★ 为什么这个指标最重要': '有响应时间，才证明闭环真的闭合了 —— 否则系统只是个记录工具',
})

// ===========================================================================
// 第 10 幕：SLA 超时升级
// ===========================================================================
const overdue = store.checkSlaStatus(at(90))
record(10, 'SLA 超时自动升级', `检出 ${overdue.length} 条超时未处置预警`, Object.fromEntries(
  overdue.slice(0, 5).map((item) => [
    item.alert.title.slice(0, 22),
    `超时 ${Math.round(item.status.overdueMs / 60000)} 分钟 → 升级至 ${item.status.escalateTo.join('、') || '无'}`,
  ]),
))

// ===========================================================================
// 汇总
// ===========================================================================
const metrics = store.getMetrics(at(20))

if (AS_JSON) {
  console.log(JSON.stringify({
    meta: {
      scenario: '数字校园安全管理模式 · 完整演示剧本',
      timeBase: new Date(T0).toISOString(),
      weatherSource: weather.label,
      isDemo: true,
      note: '本演示全部使用合成数据，页面须标注「演示数据」；架构上支持接入闸机 / 信标 / WiFi 探针与真实气象源',
    },
    acts,
    metrics,
    blockedEdges: finalState.blockedEdges,
    logCount: store.getLog().length,
  }, null, 2))
} else {
  console.log('')
  console.log('\u001b[1m' + '═'.repeat(72) + '\u001b[0m')
  console.log('\u001b[1m演示汇总\u001b[0m')
  console.log(`  天气：${metrics.weather}`)
  console.log(`  风险总览：${metrics.riskOverview}`)
  console.log(`  预警：${metrics.alertCount} 条（活跃 ${metrics.activeAlertCount} 条）`)
  console.log(`  封控路段：${metrics.blockedEdgeCount} 段 ｜ 关闭场所：${metrics.closedPlaceCount} 个`)
  console.log(`  处置时效：平均响应 ${metrics.avgResponseMinutes ?? '—'} 分钟 · 超时率 ${metrics.overdueRate}% · 闭环率 ${metrics.closureRate}%`)
  console.log(`  全链路日志：${store.getLog().length} 条`)
  console.log('')
  console.log('\u001b[2m★ 本演示全部使用合成数据（isDemo）。架构上数据源可插拔，\u001b[0m')
  console.log('\u001b[2m  支持接入闸机 / 信标 / WiFi 探针与真实气象源；演示期只验证"机制"不宣称"效果"。\u001b[0m')
  console.log('\u001b[1m' + '═'.repeat(72) + '\u001b[0m')
}
