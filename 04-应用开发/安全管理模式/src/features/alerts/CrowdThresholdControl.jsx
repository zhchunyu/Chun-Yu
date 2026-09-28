/**
 * 人流阈值与容量控制（管理者）
 * ---------------------------------------------------------------------------
 * 决策项 A-11 容量口径分级配置 · A-12~A-14 阈值参数 · D6 管理者可调阈值
 *
 * ★ 这个控件承担一个答辩任务：**回答「你的阈值怎么定的」**。
 *   所以每一档不只给输入框，而是把**现实依据**一并显示出来
 *   （消防疏散容量、座位数、通道宽度人/min/m），
 *   并且实时展示"当前参数会带来什么后果"（需要连续几分钟才确认）。
 */

import { jsx, classNames, Users, Clock, Info, TrendingUp } from '../../components/icons.js'
import { CAPACITY_BASIS, PLACE_KIND_LABELS, computeCapacity, computeEffectiveCapacity } from '../../domain/crowd.js'
import { RISK_LEVEL_LABELS, RISK_LEVEL_COLORS, DEFAULT_THRESHOLDS } from '../../domain/crowdRisk.js'

/** 阈值档位展示顺序 */
const LEVELS = ['warn', 'high', 'critical']

/**
 * 把「驻留片数」翻译成人话
 * @param {number} dwell 驻留片数
 * @param {number} sampleSeconds 采样周期（秒）
 * @returns {string}
 */
export function describeDwell(dwell, sampleSeconds = 60) {
  const totalSeconds = dwell * sampleSeconds
  if (totalSeconds < 60) return `连续 ${dwell} 片（约 ${totalSeconds} 秒）`
  if (totalSeconds < 3600) return `连续 ${dwell} 片（约 ${Math.round(totalSeconds / 60)} 分钟）`
  return `连续 ${dwell} 片（约 ${Math.round((totalSeconds / 3600) * 10) / 10} 小时）`
}

/**
 * 把「冷却时长」翻译成人话
 * @param {number} cooldownMs
 * @returns {string}
 */
export function describeCooldown(cooldownMs) {
  const minutes = Math.round(cooldownMs / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.round((minutes / 60) * 10) / 10} 小时`
}

/**
 * 容量口径说明卡
 *
 * @param {object} props
 * @param {string} props.placeKind 场所类型
 * @param {{ name?: string, seats?: number, evacuationCapacity?: number, registered?: number,
 *           reported?: number, throughput?: number, widthMeters?: number }} [props.place] 场所配置
 * @returns {object|null}
 */
export function CapacityBasisCard({ placeKind, place = null }) {
  const basis = CAPACITY_BASIS[placeKind]
  if (!basis) return null

  const computed = place ? computeCapacity(place) : null

  return jsx('div', { className: 'capacity-basis' },
    jsx('div', { className: 'capacity-basis__head' },
      jsx(Info, { size: 12 }),
      jsx('strong', null, PLACE_KIND_LABELS[placeKind] ?? placeKind),
      jsx('span', { className: 'capacity-basis__formula' }, basis.label),
    ),
    jsx('p', { className: 'capacity-basis__rationale' }, basis.rationale),
    computed
      ? jsx('div', { className: 'capacity-basis__result' },
          `安全容量 ${computed.capacity} ${basis.unit}` +
          (place.name ? `（${place.name}）` : ''))
      : null,
  )
}

/**
 * 人流阈值控制面板
 *
 * @param {object} props
 * @param {object} props.thresholds 当前阈值配置
 * @param {Function} [props.onChange] 阈值变更回调 `(nextThresholds) => void`
 * @param {object} [props.weather] 当前天气（用于展示修正后的有效容量）
 * @param {Array<{ locationId: string, name: string, placeKind: string, place: object }>} [props.places=[]]
 * @param {number} [props.sampleSeconds=60] 采样周期（秒）
 * @param {boolean} [props.readOnly=false]
 * @param {string} [props.className]
 */
export function CrowdThresholdControl({
  thresholds = DEFAULT_THRESHOLDS,
  onChange,
  weather = null,
  places = [],
  sampleSeconds = 60,
  readOnly = false,
  className,
}) {
  const editable = !readOnly && typeof onChange === 'function'

  const update = (level, key, value) => {
    if (!editable) return
    const next = {
      ...thresholds,
      [level]: { ...thresholds[level], [key]: value },
    }
    onChange(next)
  }

  const rows = LEVELS.map((level) => {
    const config = thresholds[level]
    if (!config) return null

    const hysteresisBand = Math.round((config.up - config.down) * 1000) / 10

    return jsx('div', { className: 'threshold-row', key: level },
      jsx('div', { className: 'threshold-row__level' },
        jsx('span', {
          className: 'threshold-row__dot',
          style: { backgroundColor: RISK_LEVEL_COLORS[level] },
        }),
        jsx('strong', null, RISK_LEVEL_LABELS[level]),
      ),
      jsx('label', { className: 'threshold-field' },
        jsx('span', { className: 'threshold-field__label' }, '上升沿'),
        jsx('input', {
          type: 'number', min: 0, max: 2, step: 0.01,
          value: config.up,
          disabled: !editable,
          onChange: (event) => update(level, 'up', Number(event.target.value)),
          'aria-label': `${RISK_LEVEL_LABELS[level]}档上升沿阈值`,
        }),
      ),
      jsx('label', { className: 'threshold-field' },
        jsx('span', { className: 'threshold-field__label' }, '下降沿'),
        jsx('input', {
          type: 'number', min: 0, max: 2, step: 0.01,
          value: config.down,
          disabled: !editable,
          onChange: (event) => update(level, 'down', Number(event.target.value)),
          'aria-label': `${RISK_LEVEL_LABELS[level]}档下降沿阈值`,
        }),
      ),
      jsx('label', { className: 'threshold-field' },
        jsx('span', { className: 'threshold-field__label' }, '驻留片数'),
        jsx('input', {
          type: 'number', min: 1, max: 12, step: 1,
          value: config.dwell,
          disabled: !editable,
          onChange: (event) => update(level, 'dwell', Number(event.target.value)),
          'aria-label': `${RISK_LEVEL_LABELS[level]}档驻留片数`,
        }),
      ),
      jsx('div', { className: 'threshold-row__hint' },
        jsx(Clock, { size: 11 }),
        jsx('span', null,
          `迟滞带 ${hysteresisBand} 个百分点 ｜ 需${describeDwell(config.dwell, sampleSeconds)} ｜ 处置后 ${describeCooldown(config.cooldownMs)} 内不重复告警`),
      ),
    )
  })

  const weatherPreview = weather && weather.kind !== 'clear' && places.length
    ? jsx('div', { className: 'threshold-weather-preview' },
        jsx('div', { className: 'threshold-weather-preview__head' },
          jsx(TrendingUp, { size: 12 }),
          jsx('strong', null, `天气修正预览（${weather.label}）`),
        ),
        jsx('ul', null, places.slice(0, 4).map((item) => {
          const info = computeEffectiveCapacity(item.place, weather)
          const delta = info.baseCapacity - info.effectiveCapacity
          return jsx('li', { key: item.locationId },
            `${item.name}：容量 ${info.baseCapacity} → ${info.effectiveCapacity} 人`,
            jsx('span', { className: 'threshold-weather-preview__delta' },
              `（${info.scope === 'outdoor' ? '室外' : '室内'} ×${info.factor}，减少 ${delta} 人）`),
          )
        })),
      )
    : null

  const emptyPlaces = places.length === 0
    ? jsx('div', { className: 'threshold-empty' },
        jsx(Users, { size: 12 }),
        jsx('span', null, '未传入场所清单 —— 容量口径与天气修正预览需要场所配置（`places` 属性）'))
    : null

  return jsx('section', { className: classNames('crowd-threshold-control', className), 'aria-label': '人流阈值设置' },
    jsx('header', { className: 'crowd-threshold-control__head' },
      jsx(Users, { size: 14 }),
      jsx('strong', null, '人流阈值与容量口径'),
      readOnly
        ? jsx('span', { className: 'crowd-threshold-control__mode' }, '只读')
        : jsx('span', { className: 'crowd-threshold-control__mode is-editable' }, '管理者可调'),
    ),
    jsx('p', { className: 'crowd-threshold-control__intro' },
      '★ 阈值不是拍的：容量口径取自消防疏散容量、座位数与通道宽度人流量；' +
      '四项防抖机制（迟滞 / 驻留 / 冷却 / 趋势）避免告警响成背景噪音。'),
    jsx('div', { className: 'threshold-rows' }, rows),
    weatherPreview,
    emptyPlaces,
    places.length
      ? jsx('div', { className: 'capacity-basis-list' },
          jsx('div', { className: 'capacity-basis-list__head' }, '容量口径一览（评审问"阈值怎么定的"时看这里）'),
          [...new Set(places.map((item) => item.placeKind))].map((kind) =>
            jsx(CapacityBasisCard, { key: kind, placeKind: kind, place: places.find((p) => p.placeKind === kind)?.place ?? null })),
        )
      : null,
  )
}
