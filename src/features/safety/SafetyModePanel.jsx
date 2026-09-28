import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Ban, Camera, CheckCircle, Clock, DoorClosed, Footprints, Info,
  Megaphone, Route, ShieldAlert, TrendingUp, UserCheck, Users, X, XCircle,
} from 'lucide-react'
import {
  CAPACITY_BASIS, COVERED_ROUTE_EDGES, LOW_LYING_EDGES, PLACE_CAPACITY,
  PLACE_KIND_LABELS, computeEffectiveCapacity,
} from '../../domain/safety/capacity.js'
import {
  ACTION_CODES, ACTION_LABELS, ALERT_STATE, ALERT_STATE_LABELS,
  RISK_LEVEL, RISK_LEVEL_COLORS, RISK_LEVEL_LABELS, SEVERITY_LABELS, checkSla,
} from '../../domain/safety/index.js'

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

function formatClock(ts) {
  if (!ts) return '—'
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatMinutes(minutes) {
  if (minutes == null) return '—'
  return minutes < 60 ? `${Math.round(minutes * 10) / 10} 分` : `${Math.round((minutes / 60) * 10) / 10} 时`
}

/**
 * 安全管理模式面板
 * ---------------------------------------------------------------------------
 * 与地图**同屏**：面板给出态势与处置，地图给出空间可视化（风险区 / 封路 / 人流热力）。
 * 版面为**居中浮层**（由 MapWorkspace 的 `.safety-dialog` 定位）：
 *   · 上半部不再是"贴在工具栏里、下半截被裁掉"的抽屉，而是自带不透明底色与圆角的卡片；
 *   · 标题栏常驻，正文左右双列，超高时在面板内部滚动 —— 不会把内容推到屏幕左下角；
 *   · 关闭按钮 / Esc 收起面板，**地图叠加层保留**，方便对照面板结论看地图。
 *
 * 所有态势由 `useSafetyState` 统一计算，与 `SafetyMapOverlay` 共用同一份数据 ——
 * 不会出现「面板说高风险、地图没画红圈」的不一致。
 */
export function SafetyModePanel({
  safety,
  now = Date.now(),
  settings = {},
  onSettingsChange,
  onSelectLocation,
  onClose,
}) {
  const [expandedAlertId, setExpandedAlertId] = useState(null)
  const panelRef = useRef(null)
  const {
    weather, weatherId, setWeatherId, crowd, alerts, stats, recommendation, playbook,
    executedActions, blockedEdges, closedPlaces, outdoorPaused,
    runPlaybook, undoPlaybook, confirmAlert,
  } = safety

  const capacityPreview = ['canteen', 'library', 'stadium', 'dormitory']
    .map((id) => ({ id, config: PLACE_CAPACITY[id], info: computeEffectiveCapacity(PLACE_CAPACITY[id], weather) }))

  /** Esc 收起面板；打开时把焦点交给面板，键盘用户不会"迷失"在遮罩背后的地图上 */
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /** 点风险行 / 预警标题：先让选中结果露出来，再收起面板（否则详情被浮层挡住） */
  const focusLocation = (locationId) => {
    onSelectLocation?.(locationId)
    onClose?.()
  }

  return (
    <section
      className="safety-panel"
      role="dialog"
      aria-modal="true"
      aria-label="安全管理模式"
      ref={panelRef}
      tabIndex={-1}
    >
      <header className="safety-panel__head">
        <span className="safety-panel__mark"><ShieldAlert size={16} /></span>
        <span className="safety-panel__titles">
          <strong>安全管理模式</strong>
          <small>态势感知 · 预警闸门 · 处置闭环 —— 与地图叠加层同源</small>
        </span>
        <span className="safety-panel__badge">演示数据</span>
        <button
          type="button"
          className="safety-panel__close"
          onClick={() => onClose?.()}
          aria-label="收起安全面板"
          title="收起面板（地图叠加层保留）"
        >
          <X size={16} />
        </button>
      </header>

      <div className="safety-panel__body">
        <div className="safety-panel__cols">
          {/* ---------- 左列：态势感知 ---------- */}
          <div className="safety-panel__col">
            {/* ---------- 图层开关 ---------- */}
            <div className="safety-block safety-block--layers">
              <div className="safety-block__title"><Info size={13} /><span>地图叠加图层</span></div>
              <div className="safety-layer-toggles">
                {[
                  ['showSafetyPanel', '安全面板'],
                  ['showRiskZones', '风险区'],
                  ['showCrowdHeat', '人流热力'],
                  ['showBlockedRoads', '封控路段'],
                ].map(([key, label]) => (
                  <label key={key} className="safety-toggle">
                    <input
                      type="checkbox"
                      checked={settings[key] !== false}
                      onChange={(event) => onSettingsChange?.({ [key]: event.target.checked })}
                      aria-label={label}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* ---------- 天气场景切换（W3：无 Key、无后端） ---------- */}
            <div className="safety-block">
              <div className="safety-block__title">
                <Info size={13} /><span>天气与应急联动</span>
                <small>预置场景快照 · 无需 API Key</small>
              </div>
              <div className="safety-weather-chips">
                {safety.weatherScenarios.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`safety-chip ${item.id === weatherId ? 'is-active' : ''}`}
                    onClick={() => setWeatherId(item.id)}
                    aria-pressed={item.id === weatherId}
                  >
                    {item.icon} {item.label}
                  </button>
                ))}
              </div>
              <p className="safety-weather-text">{weather.text}</p>
              {weather.kind !== 'clear' && (
                <div className="safety-capacity-preview">
                  <div className="safety-capacity-preview__head"><TrendingUp size={12} /><span>天气修正后的安全容量</span></div>
                  <ul>
                    {capacityPreview.map((item) => (
                      <li key={item.id}>
                        <span>{item.config.name}</span>
                        <span className="safety-capacity-preview__delta">
                          {item.info.baseCapacity} → <strong>{item.info.effectiveCapacity}</strong> 人
                          <small>（{item.info.scope === 'outdoor' ? '室外' : '室内'} ×{item.info.factor}）</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* ---------- 人流阈值风控 ---------- */}
            <div className="safety-block">
              <div className="safety-block__title">
                <Users size={13} /><span>人流阈值风控</span>
                <small>{crowd.overview.summary}</small>
              </div>
              <ul className="safety-risk-list">
                {crowd.results
                  .slice()
                  .sort((a, b) => (b.reading?.ratio ?? 0) - (a.reading?.ratio ?? 0))
                  .slice(0, 6)
                  .map((item) => {
                    const level = item.evaluation?.level ?? RISK_LEVEL.NORMAL
                    return (
                      <li key={item.location.id} className={`safety-risk-row is-${level}`}>
                        <button type="button" className="safety-risk-row__name" onClick={() => focusLocation(item.location.id)}>
                          {item.location.name}
                        </button>
                        <span className="safety-risk-row__ratio">
                          {Math.round((item.reading?.ratio ?? 0) * 100)}%
                          <small> / {item.reading?.effectiveCapacity} 人</small>
                        </span>
                        <span className="safety-risk-row__level" style={{ color: RISK_LEVEL_COLORS[level] }}>
                          {RISK_LEVEL_LABELS[level]}
                        </span>
                        {item.evaluation?.dwellCount > 0 && (
                          <span className="safety-risk-row__dwell">驻留 {item.evaluation.dwellCount} 片</span>
                        )}
                      </li>
                    )
                  })}
              </ul>
              {crowd.propagation.propagated.length > 0 && (
                <div className="safety-propagation">
                  <div className="safety-propagation__head"><TrendingUp size={12} /><span>空间传导</span></div>
                  {crowd.propagation.propagated.slice(0, 3).map((item) => (
                    <p key={item.locationId}>{item.detail}</p>
                  ))}
                </div>
              )}
              <details className="safety-basis">
                <summary>容量口径一览（阈值不是拍的）</summary>
                <ul>
                  {Object.entries(CAPACITY_BASIS).map(([kind, basis]) => (
                    <li key={kind}>
                      <strong>{PLACE_KIND_LABELS[kind]}</strong>
                      <span>{basis.label}</span>
                      <small>{basis.rationale}</small>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {/* ---------- 处置时效（度量与态势同列，左右两列高度更接近） ---------- */}
            <div className="safety-block">
              <div className="safety-block__title">
                <CheckCircle size={13} /><span>处置时效</span>
                <small>有响应时间，才证明闭环真的闭合了</small>
              </div>
              <div className="safety-metrics">
                <div><span className="safety-metrics__value">{formatMinutes(stats.avgResponseMinutes)}</span><span className="safety-metrics__label">平均响应</span></div>
                <div><span className="safety-metrics__value">{stats.overdueRate}%</span><span className="safety-metrics__label">超时率</span></div>
                <div><span className="safety-metrics__value">{stats.closureRate}%</span><span className="safety-metrics__label">闭环率</span></div>
              </div>
            </div>
          </div>

          {/* ---------- 右列：预警与处置 ---------- */}
          <div className="safety-panel__col">
            {/* ---------- 预警与可信度闸门 ---------- */}
            <div className="safety-block">
              <div className="safety-block__title">
                <AlertTriangle size={13} /><span>预警与可信度闸门</span>
                <small>{alerts.length} 条</small>
              </div>
              <ul className="safety-alert-list">
                {alerts.slice(0, 5).map((alert) => {
                  const sla = checkSla(alert, now)
                  const expanded = expandedAlertId === alert.id
                  return (
                    <li key={alert.id} className={`safety-alert is-${alert.level}`} style={{ '--safety-accent': alert.color }}>
                      <div className="safety-alert__head">
                        <span className="safety-alert__level" style={{ background: alert.color }}>{alert.levelLabel}</span>
                        <button type="button" className="safety-alert__title" onClick={() => focusLocation(alert.locationId)}>
                          {alert.title}
                        </button>
                        <span className="safety-alert__state">{ALERT_STATE_LABELS[alert.state]}</span>
                      </div>
                      <div className="safety-alert__meta">
                        <span>{alert.placeName}</span>
                        <span>· {formatClock(alert.raisedAt)}</span>
                        {alert.credibility && <span>· 可信度 {Math.round(alert.credibility.score * 100)}%</span>}
                        {alert.escalated && <span className="safety-alert__escalate">· 分级上调（{alert.escalateReason}）</span>}
                      </div>
                      {sla.overdue && <div className="safety-alert__sla is-overdue"><Clock size={11} />{sla.detail}</div>}
                      {alert.state === ALERT_STATE.VERIFYING && (
                        <div className="safety-alert__gate">
                          <XCircle size={11} />
                          <span>安全类强制闸门：灰标不打点，等待人工核实</span>
                          <button type="button" className="safety-mini-btn" onClick={() => confirmAlert(alert)}>确认可信</button>
                        </div>
                      )}
                      <button type="button" className="safety-alert__toggle" onClick={() => setExpandedAlertId(expanded ? null : alert.id)}>
                        {expanded ? '收起判定依据' : '查看 AI 判定依据与证据链'}
                      </button>
                      {expanded && (
                        <div className="safety-evidence">
                          {alert.credibility?.breakdown && (
                            <>
                              <ul className="safety-evidence__rows">
                                {alert.credibility.breakdown.map((row) => (
                                  <li key={row.key}>
                                    <span className="safety-evidence__label">{row.label}</span>
                                    <span className={`safety-evidence__value ${row.value > 0 ? 'is-plus' : 'is-zero'}`}>
                                      {row.value > 0 ? '+' : ''}{Math.round(row.value * 100)}%
                                    </span>
                                    <span className="safety-evidence__detail">{row.detail}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="safety-evidence__formula">
                                {alert.credibility.breakdown.map((row) => Math.round(row.value * 100)).join(' + ')}
                                {' = '}{Math.round(alert.credibility.score * 100)}%
                                {' ／ 阈值 '}{Math.round((alert.credibility.threshold ?? 0.65) * 100)}%
                              </div>
                            </>
                          )}
                          <ul className="safety-evidence__grading">
                            {alert.grading?.evidence?.map((item, index) => (
                              <li key={`${item.label}-${index}`}>
                                <span>{item.label}</span>{item.detail}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* ---------- 处置预案 ---------- */}
            <div className="safety-block">
              <div className="safety-block__title">
                <Route size={13} /><span>处置预案</span>
                <small>{recommendation.reason}</small>
              </div>
              {playbook ? (
                <>
                  <div className="safety-playbook__head">
                    <strong>{playbook.label}</strong>
                    <span>（{SEVERITY_LABELS[playbook.level]} 级 · {playbook.sla.label}内响应）</span>
                  </div>
                  <ul className="safety-playbook__steps">
                    {playbook.steps.map((step) => {
                      const Icon = ACTION_ICONS[step.action] ?? Info
                      const done = executedActions.includes(step.id)
                      return (
                        <li key={step.id} className={done ? 'is-done' : ''}>
                          <Icon size={12} />
                          <span className="safety-playbook__action">{ACTION_LABELS[step.action]?.label}</span>
                          <span className="safety-playbook__target">{step.target}</span>
                          <small>{step.note}</small>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="safety-playbook__actions">
                    <button type="button" className="safety-action-btn is-primary" onClick={() => runPlaybook()}>
                      <ShieldAlert size={12} />一键启动预案
                    </button>
                    <button type="button" className="safety-action-btn" onClick={() => undoPlaybook()} disabled={!executedActions.length}>
                      <Footprints size={12} />撤销
                    </button>
                  </div>
                </>
              ) : (
                <p className="safety-empty">当前态势不需要启动预案（风险未达阈值）。</p>
              )}
            </div>

            {/* ---------- 联动范围 ---------- */}
            <div className="safety-block safety-block--link">
              <div className="safety-block__title"><Ban size={13} /><span>路网联动范围</span><small>与 affectedEdgeIds 同源</small></div>
              <p className="safety-link-note">
                当前封控 <strong>{blockedEdges.length}</strong> 段 · 关闭场所 <strong>{closedPlaces.length}</strong> 处
                · 户外活动 {outdoorPaused ? '已暂停' : '正常'}
              </p>
              <p className="safety-link-note is-dim">
                可用低洼路段 {LOW_LYING_EDGES.length} 段 · 避雨通道 {COVERED_ROUTE_EDGES.length} 段。
                封路集合写入既有 <code>affectedEdgeIds</code>，路线模块 <code>aStar()</code> 无需改动。
              </p>
            </div>
          </div>
        </div>
      </div>

      <footer className="safety-panel__foot">
        <span>面板关闭后，风险区 / 人流热力 / 封控路段叠加层仍保留在地图上。</span>
        <button type="button" className="safety-action-btn" onClick={() => onClose?.()}>
          <X size={12} />收起面板，看地图
        </button>
      </footer>
    </section>
  )
}
