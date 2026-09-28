/**
 * 安全态势大屏
 * ---------------------------------------------------------------------------
 * 决策项 E-1 风险总览 · E-2 预警时间线 · E-3 ★ 处置时效 · E-4 热力回放
 *        E-5 空间态势 · E-6 AI 安全简报 · D6 管理者视角
 *
 * ★ 大屏里最该做的不是花哨的图表，而是 **E-3 处置时效**：
 *   平均响应时长 / 超时率 / 闭环率。
 *   因为**有响应时间，才证明闭环真的闭合了** —— 否则系统只是个记录工具。
 */

import {
  jsx, classNames,
  ShieldAlert, Activity, Clock, CheckCircle, AlertTriangle, ListChecks,
  TrendingUp, Route, DoorClosed, Ban, Info,
} from '../../components/icons.js'
import { SEVERITY_LABELS, SEVERITY_COLORS, SEVERITY_ORDER, ALERT_STATE, ALERT_STATE_LABELS } from '../../domain/alert.js'
import { RISK_LEVEL_LABELS, RISK_LEVEL_COLORS } from '../../domain/crowdRisk.js'

/** 档位 → 展示顺序 */
const SEVERITY_ORDER_LIST = ['critical', 'high', 'medium', 'low', 'info']

function formatMinutes(minutes) {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes * 10) / 10} 分`
  return `${Math.round((minutes / 60) * 10) / 10} 时`
}

/**
 * 风险总览卡（E-1）
 *
 * @param {object} props
 * @param {{ counts: object, total: number, highest: string, summary: string }} props.overview
 * @param {number} [props.activeCount]
 * @param {string} [props.className]
 */
export function RiskOverview({ overview, activeCount = null, className }) {
  if (!overview) return null

  const items = SEVERITY_ORDER_LIST.map((level) => ({
    level,
    label: SEVERITY_LABELS[level],
    color: SEVERITY_COLORS[level],
    count: overview.counts?.[level] ?? 0,
  }))

  return jsx('section', { className: classNames('risk-overview', className), 'aria-label': '风险总览' },
    jsx('header', { className: 'risk-overview__head' },
      jsx(ShieldAlert, { size: 14 }),
      jsx('strong', null, '风险总览'),
      activeCount != null ? jsx('span', { className: 'risk-overview__active' }, `活跃 ${activeCount} 条`) : null,
    ),
    jsx('div', { className: 'risk-overview__grid' },
      items.map((item) => jsx('div', {
        className: classNames('risk-tile', `is-${item.level}`, item.count === 0 ? 'is-zero' : null),
        key: item.level,
        style: { '--tile-color': item.color },
      },
        jsx('span', { className: 'risk-tile__count' }, item.count),
        jsx('span', { className: 'risk-tile__label' }, item.label),
      )),
    ),
    jsx('div', { className: 'risk-overview__summary' }, overview.summary),
  )
}

/**
 * ★ 处置时效（E-3）—— 大屏里最重要的模块
 *
 * @param {object} props
 * @param {object} props.stats summarizeResponseTimes 的返回值
 * @param {string} [props.className]
 */
export function ResponseMetrics({ stats, className }) {
  if (!stats) return null

  const tiles = [
    {
      key: 'avg',
      icon: Clock,
      label: '平均响应时长',
      value: formatMinutes(stats.avgResponseMinutes),
      hint: '从上报到派单的平均耗时',
      warn: false,
    },
    {
      key: 'overdue',
      icon: AlertTriangle,
      label: '超时率',
      value: `${stats.overdueRate ?? 0}%`,
      hint: `${stats.overdueCount ?? 0} / ${stats.dispatchedCount ?? 0} 条超出响应时限`,
      warn: (stats.overdueRate ?? 0) > 10,
    },
    {
      key: 'closure',
      icon: CheckCircle,
      label: '闭环率',
      value: `${stats.closureRate ?? 0}%`,
      hint: `${stats.closedCount ?? 0} / ${stats.total ?? 0} 条已归档`,
      warn: false,
    },
    {
      key: 'dispatched',
      icon: ListChecks,
      label: '已派单',
      value: `${stats.dispatchedCount ?? 0}`,
      hint: `共 ${stats.total ?? 0} 条预警`,
      warn: false,
    },
  ]

  const byLevel = stats.byLevel ?? {}
  const levelRows = SEVERITY_ORDER_LIST
    .filter((level) => (byLevel[level]?.count ?? 0) > 0)
    .map((level) => jsx('li', { className: 'response-level-row', key: level },
      jsx('span', {
        className: 'response-level-row__dot',
        style: { backgroundColor: SEVERITY_COLORS[level] },
      }),
      jsx('span', { className: 'response-level-row__label' }, SEVERITY_LABELS[level]),
      jsx('span', { className: 'response-level-row__count' }, `${byLevel[level].count} 条`),
      jsx('span', { className: 'response-level-row__avg' },
        `平均 ${formatMinutes(byLevel[level].avgMinutes)}`),
    ))

  return jsx('section', { className: classNames('response-metrics', className), 'aria-label': '处置时效' },
    jsx('header', { className: 'response-metrics__head' },
      jsx(Activity, { size: 14 }),
      jsx('strong', null, '处置时效'),
      jsx('small', null, '★ 有响应时间，才证明闭环真的闭合了'),
    ),
    jsx('div', { className: 'response-metrics__grid' },
      tiles.map((tile) => jsx('div', {
        className: classNames('response-tile', tile.warn ? 'is-warn' : null),
        key: tile.key,
        title: tile.hint,
      },
        jsx('span', { className: 'response-tile__icon' }, jsx(tile.icon, { size: 13 })),
        jsx('span', { className: 'response-tile__value' }, tile.value),
        jsx('span', { className: 'response-tile__label' }, tile.label),
        jsx('span', { className: 'response-tile__hint' }, tile.hint),
      )),
    ),
    levelRows.length
      ? jsx('ul', { className: 'response-metrics__by-level' }, levelRows)
      : null,
  )
}

/**
 * 预警时间线（E-2）
 *
 * @param {object} props
 * @param {object[]} props.alerts
 * @param {number} [props.now]
 * @param {Function} [props.onSelectAlert]
 * @param {number} [props.max=8]
 * @param {string} [props.className]
 */
export function AlertTimeline({ alerts = [], now = null, onSelectAlert, max = 8, className }) {
  const visible = alerts.slice(0, max)

  return jsx('section', { className: classNames('alert-timeline', className), 'aria-label': '预警时间线' },
    jsx('header', { className: 'alert-timeline__head' },
      jsx(Clock, { size: 14 }),
      jsx('strong', null, '预警时间线'),
      jsx('span', { className: 'alert-timeline__count' }, `${alerts.length} 条`),
    ),
    visible.length
      ? jsx('ol', { className: 'alert-timeline__list' },
          visible.map((alert) => {
            const time = alert.raisedAt ? new Date(alert.raisedAt) : null
            const clock = time
              ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
              : '—'
            return jsx('li', {
              className: classNames('timeline-item', `is-${alert.level}`),
              key: alert.id,
              style: { '--item-color': alert.color ?? SEVERITY_COLORS[alert.level] },
            },
              jsx('button', {
                type: 'button',
                className: 'timeline-item__button',
                onClick: onSelectAlert ? () => onSelectAlert(alert) : undefined,
                disabled: !onSelectAlert,
              },
                jsx('span', { className: 'timeline-item__time' }, clock),
                jsx('span', { className: 'timeline-item__badge' }, alert.levelLabel),
                jsx('span', { className: 'timeline-item__title' }, alert.title),
                jsx('span', { className: 'timeline-item__state' },
                  ALERT_STATE_LABELS[alert.state] ?? alert.state),
              ),
            )
          }),
        )
      : jsx('div', { className: 'alert-timeline__empty' }, '暂无预警 —— 当前态势平稳'),
  )
}

/**
 * 空间态势：封路 / 关闭场所 / 暂停户外（E-5）
 *
 * @param {object} props
 * @param {string[]} [props.blockedEdges=[]]
 * @param {string[]} [props.closedPlaces=[]]
 * @param {boolean} [props.outdoorPaused=false]
 * @param {string[]} [props.risks=[]] 处于告警档位的地点描述
 * @param {string} [props.className]
 */
export function SpatialStatus({
  blockedEdges = [], closedPlaces = [], outdoorPaused = false, risks = [], className,
}) {
  const groups = [
    {
      key: 'blocked',
      icon: Ban,
      label: '封控路段',
      items: blockedEdges,
      empty: '无封控路段',
    },
    {
      key: 'closed',
      icon: DoorClosed,
      label: '关闭场所',
      items: closedPlaces,
      empty: '无关闭场所',
    },
  ]

  return jsx('section', { className: classNames('spatial-status', className), 'aria-label': '空间态势' },
    jsx('header', { className: 'spatial-status__head' },
      jsx(Route, { size: 14 }),
      jsx('strong', null, '空间态势'),
      jsx('small', null, '封路集合即喂给 createCampusRoute 的 blockedEdgeIds'),
    ),
    jsx('div', { className: 'spatial-status__groups' },
      groups.map((group) => jsx('div', { className: 'spatial-group', key: group.key },
        jsx('div', { className: 'spatial-group__head' },
          jsx(group.icon, { size: 12 }),
          jsx('span', null, group.label),
          jsx('span', { className: 'spatial-group__count' }, `${group.items.length}`),
        ),
        group.items.length
          ? jsx('ul', { className: 'spatial-group__list' },
              group.items.map((item) => jsx('li', { key: item }, item)))
          : jsx('div', { className: 'spatial-group__empty' }, group.empty),
      )),
      jsx('div', { className: 'spatial-group', key: 'outdoor' },
        jsx('div', { className: 'spatial-group__head' },
          jsx(TrendingUp, { size: 12 }),
          jsx('span', null, '户外活动'),
          jsx('span', { className: 'spatial-group__count' }, outdoorPaused ? '暂停' : '正常'),
        ),
        jsx('div', { className: classNames('spatial-group__state', outdoorPaused ? 'is-paused' : null) },
          outdoorPaused ? '已暂停（天气预案生效中）' : '正常进行'),
      ),
    ),
    risks.length
      ? jsx('div', { className: 'spatial-status__risks' },
          jsx('div', { className: 'spatial-status__risks-head' }, '人流告警地点'),
          jsx('ul', null, risks.map((item, index) => jsx('li', { key: `${item}-${index}` }, item))),
        )
      : null,
  )
}

/**
 * AI 安全简报（E-6 · E-18 LLM + 规则双轨）
 *
 * ★ 边界必须写清楚：LLM 只做**表达层**，级别、阈值、处置动作全部由规则引擎产出。
 *   所以组件把「生成方式」显式标出来，避免评审误以为判定是模型拍脑袋。
 *
 * @param {object} props
 * @param {string} props.text 简报正文
 * @param {'llm'|'template'|'fallback'} [props.generatedBy='template']
 * @param {Array<{label: string, value: string}>} [props.facts=[]] 简报依据的结构化事实
 * @param {string} [props.className]
 */
export function SafetyBriefing({ text, generatedBy = 'template', facts = [], className }) {
  if (!text) return null

  const modeLabel = {
    llm: 'LLM 生成（表达层）',
    template: '模板生成',
    fallback: '模板兜底（LLM 不可用）',
  }[generatedBy] ?? generatedBy

  return jsx('section', { className: classNames('safety-briefing', className), 'aria-label': 'AI 安全简报' },
    jsx('header', { className: 'safety-briefing__head' },
      jsx(Info, { size: 14 }),
      jsx('strong', null, 'AI 安全简报'),
      jsx('span', { className: 'safety-briefing__mode', title: '判定走规则引擎，LLM 只负责把结论说成人话' }, modeLabel),
    ),
    jsx('p', { className: 'safety-briefing__text' }, text),
    facts.length
      ? jsx('div', { className: 'safety-briefing__facts' },
          jsx('span', { className: 'safety-briefing__facts-label' }, '依据：'),
          facts.map((fact, index) => jsx('span', { className: 'safety-fact', key: `${fact.label}-${index}` },
            jsx('strong', null, `${fact.label} `),
            fact.value,
          )),
        )
      : null,
    jsx('div', { className: 'safety-briefing__note' },
      '判定逻辑（级别 / 阈值 / 处置动作）全部由规则引擎产出，可解释、可审计；' +
      'LLM 仅参与自然语言表达，不参与判定。'),
  )
}

/**
 * 安全态势大屏（组合以上模块）
 *
 * @param {object} props
 * @param {object} props.state safetyStore.getState() 的返回值
 * @param {string} [props.briefing] AI 简报正文
 * @param {'llm'|'template'|'fallback'} [props.briefingMode]
 * @param {Function} [props.onSelectAlert]
 * @param {string} [props.className]
 */
export function SafetyDashboard({ state, briefing = null, briefingMode = 'template', onSelectAlert, className }) {
  if (!state) return null

  const risks = (state.riskReadings ?? [])
    .filter((item) => item.level !== 'normal')
    .map((item) => `${item.name}：${RISK_LEVEL_LABELS[item.level]}（${Math.round((item.ratio ?? 0) * 100)}% / ${item.effectiveCapacity} 人）`)

  return jsx('div', { className: classNames('safety-dashboard', className) },
    jsx('div', { className: 'safety-dashboard__row safety-dashboard__row--top' },
      jsx(RiskOverview, {
        overview: state.riskOverview,
        activeCount: state.activeAlerts?.length ?? 0,
      }),
      jsx(ResponseMetrics, { stats: state.responseStats }),
    ),
    jsx('div', { className: 'safety-dashboard__row' },
      jsx(AlertTimeline, { alerts: state.alerts ?? [], onSelectAlert }),
      jsx(SpatialStatus, {
        blockedEdges: state.blockedEdges ?? [],
        closedPlaces: state.closedPlaces ?? [],
        outdoorPaused: Boolean(state.outdoorPaused),
        risks,
      }),
    ),
    briefing
      ? jsx(SafetyBriefing, {
          text: briefing,
          generatedBy: briefingMode,
          facts: [
            { label: '天气', value: state.weather?.label ?? '—' },
            { label: '预警', value: `${state.alerts?.length ?? 0} 条（活跃 ${state.activeAlerts?.length ?? 0}）` },
            { label: '封控路段', value: `${state.blockedEdges?.length ?? 0} 段` },
            { label: '平均响应', value: formatMinutes(state.responseStats?.avgResponseMinutes) },
          ],
        })
      : null,
  )
}
