import { Activity, CalendarClock, LockKeyhole, MapPinned, Navigation, UsersRound, X } from 'lucide-react'
import { canManage, CROWD_STATUS_LABELS, OPEN_STATUS_LABELS, ROLE_LABELS } from '../../domain/campus.js'
import { StatusBadge } from '../../components/StatusBadge.jsx'

function openTone(status) {
  return status === 'open' ? 'open' : status === 'limited' ? 'limited' : 'closed'
}

function crowdTone(status) {
  return status === 'busy' ? 'busy' : status === 'normal' ? 'normal' : 'low'
}

export function LocationDetail({ location, events = [], role, onUpdate, onClose, onPlanRoute }) {
  if (!location) {
    return (
      <aside className="detail-panel detail-panel--empty">
        <div className="detail-panel__empty-icon"><MapPinned size={22} /></div>
        <strong>选择一个地点</strong>
        <p>从左侧列表选择地点，这里会展示它的校园状态。</p>
      </aside>
    )
  }

  const managerMode = canManage(role)

  return (
    <aside className="detail-panel">
      <div className="detail-panel__header">
        <div>
          <div className="eyebrow"><MapPinned size={13} /> 地点详情</div>
          <h2>{location.name}</h2>
        </div>
        <div>
          <button className="detail-close" type="button" onClick={onClose} aria-label="关闭地点详情"><X size={14} /></button>
          <span className="detail-panel__id">#{location.id.slice(0, 3).toUpperCase()}</span>
        </div>
      </div>

      <p className="detail-panel__description">{location.description}</p>

      <div className="detail-status-grid">
        <div className="detail-status-card">
          <span className="detail-status-card__label">开放状态</span>
          {managerMode ? (
            <select
              value={location.openStatus}
              onChange={(event) => onUpdate({ openStatus: event.target.value })}
            >
              {Object.entries(OPEN_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ) : <StatusBadge label={OPEN_STATUS_LABELS[location.openStatus]} tone={openTone(location.openStatus)} />}
        </div>
        <div className="detail-status-card">
          <span className="detail-status-card__label">当前人流</span>
          {managerMode ? (
            <select
              value={location.crowdStatus}
              onChange={(event) => onUpdate({ crowdStatus: event.target.value })}
            >
              {Object.entries(CROWD_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ) : <StatusBadge label={CROWD_STATUS_LABELS[location.crowdStatus]} tone={crowdTone(location.crowdStatus)} />}
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section__heading"><Activity size={15} /> 当前动态</div>
        {managerMode ? (
          <input
            className="detail-input"
            value={location.activity}
            onChange={(event) => onUpdate({ activity: event.target.value })}
            aria-label="当前动态"
          />
        ) : <p className="activity-copy">{location.activity || '暂无活动信息'}</p>}
      </div>

      {events.length > 0 && (
        <div className="detail-section detail-events">
          <div className="detail-section__heading"><Activity size={15} /> 现场热点</div>
          {events.map((event) => <div className="detail-event" key={event.id}><strong>{event.title}</strong><span>{event.impact}</span></div>)}
        </div>
      )}

      <div className="detail-meta-list">
        <div><CalendarClock size={15} /><span>数据更新时间</span><strong>{location.updatedAt}</strong></div>
        <div><UsersRound size={15} /><span>当前视角</span><strong>{ROLE_LABELS[role]}</strong></div>
        <div><LockKeyhole size={15} /><span>数据范围</span><strong>本地演示</strong></div>
      </div>

      <button className="detail-action" type="button" onClick={onPlanRoute}><Navigation size={14} /> 规划到这里</button>
    </aside>
  )
}
