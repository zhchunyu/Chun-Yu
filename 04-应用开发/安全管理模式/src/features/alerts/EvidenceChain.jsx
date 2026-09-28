/**
 * 可信度证据链
 * ---------------------------------------------------------------------------
 * 决策项 B-21 全链路留痕 · 对应「技术实现 20 分」的核心支撑
 *
 * ★ 这一屏解决一个具体问题：评审一定会问「为什么是 0.73？」。
 *   评分函数必须是**可分解的加权项**，每一项都能打印贡献明细。
 *   一个所有输入都得同一个分的评分函数看不出设计；
 *   一个有分层、可解释的评分函数，一眼就是设计过的。
 *
 * 组件同时承担"打脸自查"的职责：当分数退化成常数（例如所有事件都挤在
 * 53–55%），组件会在顶部给出显式警告，而不是把这个缺陷藏起来。
 */

import { jsx, classNames, ShieldCheck, AlertTriangle, CheckCircle, XCircle, Info } from '../../components/icons.js'

/** 五项加权因子的中文标签与口径说明（与 events.js 的评分实现保持一致） */
export const CREDIBILITY_FACTORS = Object.freeze({
  base: { label: '基础分', detail: '上报事件的最低可信度起点' },
  source: { label: '位置来源', detail: 'beacon 物理在场最强 +0.08 / auto 基准 0 / manual 防乱标 −0.05' },
  crowd: { label: '群体佐证', detail: '同一事件独立上报人数，按 user_id 去重后计数' },
  commonSense: { label: '常识一致性', detail: '锚点存在性校验 —— 地点是否真实存在于校园' },
  text: { label: '文本质量', detail: '描述长度与具体程度' },
})

/**
 * 把评分对象拆成可渲染的明细行。
 *
 * 兼容两种输入形态：
 *  1. `credibility.breakdown` 已是对象数组（推荐）：`[{ key, label, value, detail }]`
 *  2. `credibility` 是键值对：`{ base: 0.4, source: 0.05, ... }`
 *
 * @param {object} credibility 可信度对象
 * @returns {{ rows: object[], total: number, threshold: number, passed: boolean, degenerate: boolean, degenerateReason: string|null }}
 */
export function describeCredibility(credibility) {
  const total = credibility?.score ?? 0
  const threshold = credibility?.threshold ?? 0.65
  const passed = credibility?.passed ?? total >= threshold

  let rows = []

  if (Array.isArray(credibility?.breakdown)) {
    rows = credibility.breakdown.map((item) => ({
      key: item.key ?? item.label,
      label: item.label ?? CREDIBILITY_FACTORS[item.key]?.label ?? item.key,
      value: item.value ?? item.delta ?? 0,
      detail: item.detail ?? CREDIBILITY_FACTORS[item.key]?.detail ?? '',
    }))
  } else if (credibility && typeof credibility === 'object') {
    rows = Object.entries(CREDIBILITY_FACTORS)
      .filter(([key]) => typeof credibility[key] === 'number')
      .map(([key, meta]) => ({
        key,
        label: meta.label,
        value: credibility[key],
        detail: meta.detail,
      }))
  }

  // ★ 退化检测：若所有上报都得到同一个分数，评分函数等于没设计。
  //   这里只能就"当前这一条"做判断（是否所有分项都恰为默认值），
  //   跨条目的退化检测交给 detectScoreDegeneration()。
  const degenerate = rows.length > 0 && rows.every((row) => row.detail === CREDIBILITY_FACTORS[row.key]?.detail) &&
    total > 0 && total < threshold && rows.filter((row) => row.value > 0).length <= 2

  return {
    rows,
    total,
    threshold,
    passed,
    degenerate: Boolean(degenerate),
    degenerateReason: degenerate
      ? '本条评分的加分项过少（仅基础分与常识分），若批量上报都如此，说明评分函数退化成常数'
      : null,
  }
}

/**
 * ★ 跨条目退化检测 —— 演示前必须跑一次
 *
 * 实测教训：13 条事件里 11 条挤在 53–55%，分布为
 * `55% × 10、53% × 1、65% × 1、85% × 1`，导致「AI 把所有用户上报都判为不可信，
 * 产品像坏的」。这个函数用来在演示前把这个问题显式暴露出来。
 *
 * @param {number[]} scores 一批事件的可信度分数（0–1）
 * @returns {{ degenerate: boolean, distinct: number, mode: number|null, modeShare: number, detail: string }}
 */
export function detectScoreDegeneration(scores = []) {
  if (!scores.length) {
    return { degenerate: false, distinct: 0, mode: null, modeShare: 0, detail: '无样本，无法判断评分分布' }
  }

  const rounded = scores.map((value) => Math.round(value * 100))
  const counts = new Map()
  for (const value of rounded) counts.set(value, (counts.get(value) ?? 0) + 1)

  let mode = null
  let modeCount = 0
  for (const [value, count] of counts) {
    if (count > modeCount) { mode = value; modeCount = count }
  }

  const modeShare = modeCount / rounded.length
  const distinct = counts.size
  // 判据：超过 6 成落在同一个分数，或全批只出现 2 种以下分数
  const degenerate = modeShare >= 0.6 || distinct <= 2

  return {
    degenerate,
    distinct,
    mode,
    modeShare: Math.round(modeShare * 1000) / 10,
    detail: degenerate
      ? `★ 评分退化：${rounded.length} 条中 ${modeCount} 条（${Math.round(modeShare * 100)}%）落在 ${mode}%，仅 ${distinct} 种取值 —— 评审会认为"AI 把所有上报都判为不可信"`
      : `分布正常：${rounded.length} 条共 ${distinct} 种取值，众数 ${mode}% 占 ${Math.round(modeShare * 100)}%`,
  }
}

function formatDelta(value) {
  const percent = Math.round(value * 100)
  return `${percent >= 0 ? '+' : ''}${percent}%`
}

/**
 * 证据链面板
 *
 * @param {object} props
 * @param {object} props.credibility 可信度对象
 * @param {Array<{label: string, detail: string}>} [props.evidence] 额外的判定证据（分级矩阵 / 风控阈值）
 * @param {boolean} [props.showFormula=true] 是否展示「合计 = …」算式
 * @param {string} [props.title='AI 判定依据']
 * @param {string} [props.className]
 */
export function EvidenceChain({
  credibility,
  evidence = [],
  showFormula = true,
  title = 'AI 判定依据',
  className,
}) {
  const info = describeCredibility(credibility)

  const header = jsx('div', { className: 'evidence-chain__header' },
    jsx(ShieldCheck, { size: 14 }),
    jsx('span', { className: 'evidence-chain__title' }, title),
    jsx('span', {
      className: classNames('evidence-chain__score', info.passed ? 'is-passed' : 'is-pending'),
    }, `${Math.round(info.total * 100)}%`),
    jsx('span', { className: 'evidence-chain__threshold' },
      `阈值 ${Math.round(info.threshold * 100)}%`),
  )

  const degenerateWarning = info.degenerate
    ? jsx('div', { className: 'evidence-chain__warning', role: 'alert' },
        jsx(AlertTriangle, { size: 13 }),
        jsx('span', null, info.degenerateReason))
    : null

  const rows = info.rows.map((row) => jsx('li', {
    className: classNames('evidence-row', row.value < 0 ? 'is-negative' : row.value > 0 ? 'is-positive' : 'is-neutral'),
    key: row.key,
  },
    jsx('span', { className: 'evidence-row__label' }, row.label),
    jsx('span', { className: 'evidence-row__value' }, formatDelta(row.value)),
    row.detail ? jsx('span', { className: 'evidence-row__detail' }, row.detail) : null,
  ))

  const formula = showFormula && info.rows.length
    ? jsx('div', { className: 'evidence-chain__formula' },
        `${info.rows.map((row) => Math.round(row.value * 100)).join(' + ')} = ${Math.round(info.total * 100)}%`)
    : null

  const verdict = jsx('div', {
    className: classNames('evidence-chain__verdict', info.passed ? 'is-passed' : 'is-pending'),
  },
    info.passed ? jsx(CheckCircle, { size: 13 }) : jsx(XCircle, { size: 13 }),
    jsx('span', null, info.passed
      ? '可信度达标，自动发布并在地图打点'
      : '★ 低于阈值，进入人工审核队列；安全类只显示「待核实」、灰色虚标不打点'),
  )

  const extra = evidence.length
    ? jsx('ul', { className: 'evidence-chain__extra' },
        jsx('li', { className: 'evidence-chain__extra-title' }, jsx(Info, { size: 12 }), '分级与风控判定依据'),
        evidence.map((item, index) => jsx('li', { className: 'evidence-extra-row', key: `${item.label}-${index}` },
          jsx('span', { className: 'evidence-extra-row__label' }, item.label),
          jsx('span', { className: 'evidence-extra-row__detail' }, item.detail),
        )),
      )
    : null

  return jsx('section', { className: classNames('evidence-chain', className), 'aria-label': title },
    header,
    degenerateWarning,
    jsx('ul', { className: 'evidence-chain__rows' }, rows),
    formula,
    verdict,
    extra,
  )
}
