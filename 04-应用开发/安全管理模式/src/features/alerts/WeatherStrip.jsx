/**
 * 天气条 + 联动状态
 * ---------------------------------------------------------------------------
 * 决策项 W3 场景切换 · C-20 URL 参数 · C-21 管理者面板按钮 · C-17/C-18 升降档闭环
 *
 * ★ 这个组件要传达的核心信息不是"今天几度"，而是：
 *   **「我们不预报天气，我们把天气翻译成行动」** ——
 *   所以面板的主角是「已联动动作」清单，天气数值只是背景。
 */

import {
  jsx, classNames,
  CloudRain, CloudLightning, Thermometer, Wind, AlertTriangle,
  Megaphone, UserCheck, DoorClosed, Route, Footprints, Camera, Ban, Info,
} from '../../components/icons.js'
import { ACTION_CODES, ACTION_LABELS } from '../../domain/playbook.js'

/** 天气类型 → 图标 */
const KIND_ICONS = {
  rainstorm: CloudRain,
  hail: CloudLightning,
  heat: Thermometer,
  gale: Wind,
  thunder: CloudLightning,
  clear: Info,
}

const LEVEL_COLORS = {
  blue: '#5b8def',
  yellow: '#e0a92b',
  orange: '#e2703a',
  red: '#d1414a',
}

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

/**
 * 天气条
 *
 * @param {object} props
 * @param {object} props.scenario 当前天气场景（weatherDataSource 的产物）
 * @param {Array<{kind: string, label: string}>} [props.scenarios=[]] 可切换的场景列表（有则渲染切换按钮）
 * @param {object} [props.analysis] analyzeWeather 的结果（有则渲染「已联动动作」）
 * @param {{level?: string, label?: string, direction?: string}} [props.levelChange] 最近一次等级变化
 * @param {Function} [props.onChangeScenario] 场景切换回调
 * @param {boolean} [props.isDemo=true] 是否显示「演示数据」标注
 * @param {string} [props.className]
 */
export function WeatherStrip({
  scenario,
  scenarios = [],
  analysis = null,
  levelChange = null,
  onChangeScenario,
  isDemo = true,
  className,
}) {
  if (!scenario) return null

  const Icon = KIND_ICONS[scenario.kind] ?? Info
  const color = LEVEL_COLORS[scenario.level] ?? LEVEL_COLORS.blue

  const metrics = [
    { label: '气温', value: `${scenario.temperature}°C` },
    { label: '湿度', value: `${scenario.humidity}%` },
    { label: '风力', value: `${scenario.windSpeed} m/s` },
    { label: '降水', value: `${scenario.precipitation} mm/h` },
    { label: '能见度', value: `${scenario.visibility} km` },
  ]

  const changeBadge = levelChange && levelChange.direction && levelChange.direction !== 'same'
    ? jsx('span', {
        className: classNames('weather-strip__change', `is-${levelChange.direction}`),
      }, levelChange.direction === 'up'
        ? `↑ 升档（${levelChange.label ?? ''}）`
        : `↓ 降档（${levelChange.label ?? ''}）`)
    : null

  // ★ 主角：气象被翻译成了哪些校园动作
  const actions = analysis?.actions?.length
    ? jsx('ul', { className: 'weather-strip__actions' },
        analysis.actions.map((code) => {
          const ActionIcon = ACTION_ICONS[code] ?? Info
          return jsx('li', { className: 'weather-action', key: code },
            jsx(ActionIcon, { size: 12 }),
            jsx('span', { className: 'weather-action__label' }, ACTION_LABELS[code]?.label ?? code),
            jsx('span', { className: 'weather-action__detail' }, ACTION_LABELS[code]?.detail ?? ''),
          )
        }),
      )
    : jsx('div', { className: 'weather-strip__no-action' }, '当前天气未触发任何处置动作')

  const risks = analysis?.riskPoints?.length
    ? jsx('div', { className: 'weather-strip__risks' },
        jsx('span', { className: 'weather-strip__risks-label' }, '识别到的校园风险点：'),
        jsx('span', null, analysis.riskPoints.map((point) => point.riskPoint).join('、')),
      )
    : null

  const switcher = scenarios.length
    ? jsx('div', { className: 'weather-strip__switcher', role: 'group', 'aria-label': '天气场景切换' },
        scenarios.map((item) => jsx('button', {
          type: 'button',
          key: item.id,
          className: classNames('weather-chip', item.id === scenario.id ? 'is-active' : null),
          style: item.id === scenario.id ? { borderColor: LEVEL_COLORS[item.level] ?? LEVEL_COLORS.blue } : null,
          onClick: onChangeScenario ? () => onChangeScenario(item.id) : undefined,
          disabled: !onChangeScenario,
          title: item.text,
        }, `${item.icon ?? ''} ${item.label}`)),
      )
    : null

  return jsx('section', {
    className: classNames('weather-strip', className),
    style: { '--weather-color': color },
    'aria-label': '天气与应急联动',
  },
    jsx('header', { className: 'weather-strip__head' },
      jsx('span', { className: 'weather-strip__icon', style: { color } }, jsx(Icon, { size: 20 })),
      jsx('div', { className: 'weather-strip__title-block' },
        jsx('div', { className: 'weather-strip__title' },
          scenario.label,
          changeBadge,
          isDemo ? jsx('span', { className: 'demo-badge', title: '演示数据，非真实气象' }, '演示数据') : null,
        ),
        jsx('div', { className: 'weather-strip__text' }, scenario.text),
      ),
    ),
    jsx('div', { className: 'weather-strip__metrics' },
      metrics.map((metric) => jsx('div', { className: 'weather-metric', key: metric.label },
        jsx('span', { className: 'weather-metric__value' }, metric.value),
        jsx('span', { className: 'weather-metric__label' }, metric.label),
      )),
    ),
    switcher,
    jsx('div', { className: 'weather-strip__translation' },
      jsx('div', { className: 'weather-strip__translation-head' },
        jsx(AlertTriangle, { size: 13 }),
        jsx('strong', null, '气象 → 校园处置动作'),
        jsx('small', null, '★ 我们不预报天气，我们把天气翻译成行动'),
      ),
      risks,
      actions,
    ),
  )
}

/**
 * 天气升档差异提示（C-17）—— 展示"这次升档新增了哪些待办"
 *
 * @param {object} props
 * @param {{ summary?: string, todoItems?: Array<{label: string, detail?: string}>, addedActions?: string[], removedActions?: string[] }} props.escalation
 * @param {string} [props.className]
 */
export function WeatherEscalationNotice({ escalation, className }) {
  if (!escalation) return null

  const added = (escalation.todoItems ?? []).length
    ? jsx('ul', { className: 'escalation-todos' },
        escalation.todoItems.map((item, index) => jsx('li', { key: `${item.label}-${index}` },
          jsx('strong', null, item.label),
          item.detail ? jsx('span', null, item.detail) : null,
        )),
      )
    : null

  return jsx('aside', { className: classNames('escalation-notice', className), role: 'status' },
    jsx('div', { className: 'escalation-notice__head' },
      jsx(AlertTriangle, { size: 14 }),
      jsx('strong', null, '气象等级变化'),
    ),
    escalation.summary ? jsx('p', { className: 'escalation-notice__summary' }, escalation.summary) : null,
    added,
  )
}
