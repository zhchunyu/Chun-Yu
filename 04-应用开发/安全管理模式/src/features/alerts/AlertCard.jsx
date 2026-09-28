/**
 * 单条预警卡片
 * ---------------------------------------------------------------------------
 * 决策项 B-15 处置流 · B-16 超时升级 · B-20 一键预案 + 可撤销 · B-21 全链路留痕
 *
 * ★ 预警卡片与普通信息流卡片的区别就在三样：**分级、责任人、时限**。
 *   这是一张"任务卡"，不是一个"内容卡"。
 */

import {
  jsx, classNames,
  AlertTriangle, Users, Clock, UserCheck, Route, Megaphone, DoorClosed,
  Footprints, Camera, Play, RotateCcw, Eye, CheckCircle, ChevronRight, Ban,
} from '../../components/icons.js'
// ★ 用显式 `.js` 扩展名：本目录的组件在源码里是 `.jsx`，
//   但按项目约定（与其他 domain/data 模块一致）导入路径统一写 `.js`，
//   由构建器解析。写成 './EvidenceChain.jsx' 会在只处理 .js 的解析链路下失败。
import { EvidenceChain } from './EvidenceChain.js'
import { ACTION_CODES, ACTION_LABELS } from '../../domain/playbook.js'
import { ALERT_STATE, ALERT_STATE_LABELS, SEVERITY_COLORS, checkSla } from '../../domain/alert.js'

/** 动作码 → 图标组件 */
const ACTION_ICONS = {
  [ACTION_CODES.BROADCAST]: Megaphone,
  [ACTION_CODES.BLOCK_EDGE]: Ban,
  [ACTION_CODES.REROUTE]: Route,
  [ACTION_CODES.DISPATCH]: UserCheck,
  [ACTION_CODES.CLOSE_PLACE]: DoorClosed,
  [ACTION_CODES.HIGHLIGHT_ROUTE]: Route,
  [ACTION_CODES.PAUSE_OUTDOOR]: Footprints,
  [ACTION_CODES.LOG_EVIDENCE]: Camera,
}

/** 哪些状态下允许启动预案（已发布之后才有处置意义） */
export const DISPATCHABLE_STATES = Object.freeze([
  ALERT_STATE.PUBLISHED,
  ALERT_STATE.DISPATCHED,
  ALERT_STATE.RESOLVED,
])

function formatTime(ts) {
  if (ts == null) return '—'
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatMinutes(minutes) {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} 分钟`
  return `${Math.round((minutes / 60) * 10) / 10} 小时`
}

/**
 * 预警卡片
 *
 * @param {object} props
 * @param {object} props.alert 预警对象（domain/alert.js createAlert 的产物）
 * @param {object} [props.playbook] 已实例化的预案（instantiatePlaybook 的产物）
 * @param {number} [props.now] 当前时间（用于 SLA 倒计时；不传则用 alert.raisedAt）
 * @param {boolean} [props.expanded=false] 是否默认展开证据链
 * @param {Function} [props.onExecutePlaybook] 启动预案回调
 * @param {Function} [props.onUndoPlaybook] 撤销预案回调
 * @param {Function} [props.onAdvance] 推进状态回调（派单 / 标记已处置 / 关闭）
 * @param {Function} [props.onSelect] 点击定位到地图
 * @param {string} [props.className]
 */
export function AlertCard({
  alert,
  playbook = null,
  now = null,
  expanded = false,
  onExecutePlaybook,
  onUndoPlaybook,
  onAdvance,
  onSelect,
  className,
}) {
  const at = now ?? alert.raisedAt
  const sla = checkSla(alert, at)
  const color = alert.color ?? SEVERITY_COLORS[alert.level] ?? SEVERITY_COLORS.medium
  const executed = Boolean(playbook?.steps?.some((step) => step.status === 'done'))
  const canDispatch = DISPATCHABLE_STATES.includes(alert.state) && Boolean(playbook)

  const header = jsx('header', { className: 'alert-card__header' },
    jsx('span', {
      className: 'alert-card__level',
      style: { backgroundColor: color },
      title: `严重度 ${alert.levelLabel}`,
    }, alert.levelLabel),
    jsx('div', { className: 'alert-card__headline' },
      jsx('button', {
        type: 'button',
        className: 'alert-card__title',
        onClick: onSelect ? () => onSelect(alert.locationId) : undefined,
        disabled: !onSelect,
      }, alert.title),
      jsx('div', { className: 'alert-card__meta' },
        jsx('span', null, `${alert.placeName ?? alert.locationId ?? '未知地点'}`),
        jsx('span', { className: 'alert-card__dot' }, '·'),
        jsx('span', null, formatTime(alert.raisedAt)),
        alert.state ? jsx('span', {
          className: classNames('alert-card__state', `is-${alert.state}`),
        }, ALERT_STATE_LABELS[alert.state] ?? alert.state) : null,
      ),
    ),
  )

  const escalation = alert.escalated
    ? jsx('div', { className: 'alert-card__escalation' },
        jsx(AlertTriangle, { size: 12 }),
        jsx('span', null, `分级上调：${alert.escalateReason}`))
    : null

  const slaRow = jsx('div', { className: classNames('alert-card__sla', sla.overdue ? 'is-overdue' : 'is-ontime') },
    jsx(Clock, { size: 13 }),
    jsx('span', { className: 'alert-card__sla-time' }, `时限 ${alert.sla?.label ?? '—'}`),
    jsx('span', { className: 'alert-card__sla-detail' }, sla.detail),
    sla.escalateTo?.length
      ? jsx('span', { className: 'alert-card__sla-target' }, `升级至 ${sla.escalateTo.join('、')}`)
      : null,
  )

  const actions = (playbook?.steps ?? []).map((step) => {
    const Icon = ACTION_ICONS[step.action] ?? Play
    return jsx('li', {
      className: classNames('playbook-step', `is-${step.status}`, step.missing?.length ? 'is-blocked' : null),
      key: step.id,
    },
      jsx('span', { className: 'playbook-step__icon' }, jsx(Icon, { size: 13 })),
      jsx('div', { className: 'playbook-step__body' },
        jsx('div', { className: 'playbook-step__line' },
          jsx('strong', null, ACTION_LABELS[step.action]?.label ?? step.action),
          jsx('span', { className: 'playbook-step__target' }, step.target),
        ),
        step.note ? jsx('div', { className: 'playbook-step__note' }, step.note) : null,
        step.missing?.length
          ? jsx('div', { className: 'playbook-step__missing' }, `缺少变量：${step.missing.join('、')}`)
          : null,
      ),
    )
  })

  const playbookBlock = playbook
    ? jsx('section', { className: 'alert-card__playbook' },
        jsx('div', { className: 'alert-card__playbook-head' },
          jsx('strong', null, playbook.label),
          jsx('span', { className: 'alert-card__playbook-count' }, `${playbook.steps.length} 个动作`),
        ),
        jsx('ul', { className: 'playbook-steps' }, actions),
        jsx('div', { className: 'alert-card__playbook-actions' },
          jsx('button', {
            type: 'button',
            className: classNames('btn', 'btn--primary', executed ? 'is-disabled' : null),
            onClick: canDispatch && onExecutePlaybook && !executed ? () => onExecutePlaybook(playbook) : undefined,
            disabled: !canDispatch || executed || !onExecutePlaybook,
            title: canDispatch ? '一键执行全部动作' : '预警尚未发布，暂不可执行预案',
          }, jsx(Play, { size: 13 }), executed ? '预案已执行' : '一键启动预案'),
          jsx('button', {
            type: 'button',
            className: classNames('btn', executed ? 'btn--danger' : 'is-disabled'),
            onClick: executed && onUndoPlaybook ? () => onUndoPlaybook(playbook) : undefined,
            disabled: !executed || !onUndoPlaybook,
            title: '撤销全部动作，封路与场所自动恢复',
          }, jsx(RotateCcw, { size: 13 }), '撤销'),
        ),
      )
    : null

  const dispatches = alert.dispatches?.length
    ? jsx('ul', { className: 'alert-card__dispatches' },
        alert.dispatches.map((item, index) => jsx('li', {
          className: classNames('dispatch-row', `is-${item.status}`),
          key: `${item.role}-${index}`,
        },
          jsx(UserCheck, { size: 12 }),
          jsx('span', { className: 'dispatch-row__role' }, item.role),
          jsx('span', { className: 'dispatch-row__task' }, item.task),
          item.count > 1 ? jsx('span', { className: 'dispatch-row__count' }, `×${item.count}`) : null,
          jsx('span', { className: 'dispatch-row__status' },
            item.status === 'resolved' ? '已处置' : item.status === 'dispatched' ? '处置中' : '待响应'),
        )),
      )
    : null

  const advanceButtons = onAdvance
    ? jsx('div', { className: 'alert-card__advance' },
        [ALERT_STATE.DISPATCHED, ALERT_STATE.RESOLVED, ALERT_STATE.CLOSED].map((state) =>
          jsx('button', {
            type: 'button',
            className: 'btn btn--ghost',
            key: state,
            onClick: () => onAdvance(alert, state),
          }, jsx(ChevronRight, { size: 12 }), ALERT_STATE_LABELS[state])),
      )
    : null

  const timeline = jsx('ol', { className: 'alert-card__timeline' },
    (alert.timeline ?? []).map((item, index) => jsx('li', {
      className: classNames('timeline-row', index === (alert.timeline.length - 1) ? 'is-latest' : null),
      key: `${item.state}-${index}`,
    },
      jsx('span', { className: 'timeline-row__time' }, formatTime(item.at)),
      jsx('span', { className: 'timeline-row__state' }, item.label ?? ALERT_STATE_LABELS[item.state] ?? item.state),
      jsx('span', { className: 'timeline-row__detail' }, item.detail ?? ''),
      item.actor ? jsx('span', { className: 'timeline-row__actor' }, item.actor) : null,
    )),
  )

  const evidenceBlock = jsx('details', { className: 'alert-card__evidence', open: expanded },
    jsx('summary', null, jsx(Eye, { size: 13 }), '查看 AI 判定依据与证据链'),
    jsx(EvidenceChain, { credibility: alert.credibility, evidence: alert.evidence ?? [] }),
  )

  // ★ 兼容两种形态：可信度可能是**对象**（含 score / threshold / breakdown，
  //   Store 与 AI 核查管线的标准产物），也可能是裸数字（简化调用方）。
  //   统一取分数用于显示，证据链则把整个对象传下去。
  const credibilityScore = typeof alert.credibility === 'number'
    ? alert.credibility
    : (alert.credibility?.score ?? null)

  const confidence = credibilityScore != null
    ? jsx('div', { className: 'alert-card__confidence' },
        jsx('span', { className: 'alert-card__confidence-label' }, '可信度'),
        jsx('span', {
          className: classNames(
            'alert-card__confidence-value',
            credibilityScore >= 0.75 ? 'is-high' : credibilityScore >= 0.65 ? 'is-mid' : 'is-low',
          ),
        }, `${Math.round(credibilityScore * 100)}%`),
        // 低于阈值时给出原因，避免只看到一个红数字
        credibilityScore < 0.65
          ? jsx('span', { className: 'alert-card__confidence-hint' }, '低于阈值，进人工审核队列')
          : null,
      )
    : null

  return jsx('article', {
    className: classNames('alert-card', `is-${alert.level}`, className),
    style: { '--alert-color': color },
    'aria-label': `${alert.levelLabel}预警：${alert.title}`,
  },
    header,
    escalation,
    slaRow,
    confidence,
    dispatches,
    playbookBlock,
    advanceButtons,
    evidenceBlock,
    jsx('details', { className: 'alert-card__history' },
      jsx('summary', null, jsx(CheckCircle, { size: 13 }), `处置时间线（${alert.timeline?.length ?? 0} 步）`),
      timeline,
    ),
  )
}

/**
 * 处置时效摘要条（供大屏 E-3 与卡片列表顶部使用）
 *
 * @param {object} props
 * @param {object} props.stats summarizeResponseTimes 的返回值
 * @param {{ total?: number, critical?: number, high?: number, overdue?: number }} [props.counts]
 * @param {string} [props.className]
 */
export function ResponseTimeStrip({ stats, counts = null, className }) {
  if (!stats) return null

  const metrics = [
    { key: 'avg', label: '平均响应', value: formatMinutes(stats.avgResponseMinutes), hint: '从上报到派单的平均时长' },
    { key: 'overdue', label: '超时率', value: `${stats.overdueRate ?? 0}%`, hint: `${stats.overdueCount ?? 0} 条超出响应时限`, warn: (stats.overdueRate ?? 0) > 0 },
    { key: 'closure', label: '闭环率', value: `${stats.closureRate ?? 0}%`, hint: `${stats.closedCount ?? 0} / ${stats.total ?? 0} 条已归档` },
  ]

  return jsx('section', { className: classNames('response-strip', className), 'aria-label': '处置时效' },
    jsx('div', { className: 'response-strip__heading' },
      jsx(Users, { size: 13 }),
      jsx('span', null, '处置时效'),
      jsx('small', null, '★ 有响应时间，才证明闭环真的闭合了'),
    ),
    jsx('div', { className: 'response-strip__metrics' },
      metrics.map((metric) => jsx('div', {
        className: classNames('response-metric', metric.warn ? 'is-warn' : null),
        key: metric.key,
        title: metric.hint,
      },
        jsx('span', { className: 'response-metric__value' }, metric.value),
        jsx('span', { className: 'response-metric__label' }, metric.label),
      )),
    ),
    counts
      ? jsx('div', { className: 'response-strip__counts' },
          `共 ${counts.total ?? 0} 条 ｜ 紧急 ${counts.critical ?? 0} ｜ 高 ${counts.high ?? 0} ｜ 超时 ${counts.overdue ?? 0}`)
      : null,
  )
}
