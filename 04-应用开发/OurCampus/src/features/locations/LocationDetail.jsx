import { useEffect, useState } from 'react'
import { Activity, CalendarClock, Check, ChevronRight, ExternalLink, Flag, LockKeyhole, MapPinned, Navigation, RotateCcw, Star, UsersRound, UtensilsCrossed, X } from 'lucide-react'
import { canManage, CROWD_STATUS_LABELS, OPEN_STATUS_LABELS, ROLE_LABELS } from '../../domain/campus.js'
import { StatusBadge } from '../../components/StatusBadge.jsx'
import { PlaceFeedbackSheet } from './PlaceFeedbackSheet.jsx'
import { isRestaurantLocation } from '../../data/restaurantReviews.js'
import { canShowCampusLink } from '../../data/campusPresentation.js'

function openTone(status) {
  return status === 'open' ? 'open' : status === 'limited' ? 'limited' : 'closed'
}

function crowdTone(status) {
  return status === 'busy' ? 'busy' : status === 'normal' ? 'normal' : 'low'
}

function editableValues(location) {
  return {
    openStatus: location?.openStatus ?? 'open',
    crowdStatus: location?.crowdStatus ?? 'normal',
    activity: location?.activity ?? '',
  }
}

function formatUpdatedAt(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '暂无记录'

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function LocationDetail({ location, events = [], lostFoundPosts = [], onOpenLostFound, onOpenReviews, role, isFavorite = false, onToggleFavorite, onUpdate, onClose, onPlanRoute, onSubmitFeedback }) {
  const [draft, setDraft] = useState(() => editableValues(location))
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false)

  useEffect(() => {
    setDraft(editableValues(location))
    setShowFeedbackSheet(false)
  }, [location?.id, location?.openStatus, location?.crowdStatus, location?.activity])

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
  const hasChanges = draft.openStatus !== location.openStatus
    || draft.crowdStatus !== location.crowdStatus
    || draft.activity !== (location.activity ?? '')

  return (
    <>
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

      {isRestaurantLocation(location) && onOpenReviews && (
        <button className="restaurant-review-entry" type="button" onClick={onOpenReviews}>
          <span className="restaurant-review-entry__icon"><UtensilsCrossed size={20} /></span>
          <span><strong>窗口评价</strong><small>按窗口看口碑，分享用餐体验</small></span>
          <ChevronRight size={17} />
        </button>
      )}

      <div className="detail-status-grid">
        <div className="detail-status-card">
          <span className="detail-status-card__label">开放状态</span>
          {managerMode ? (
            <select
              value={draft.openStatus}
              onChange={(event) => setDraft((current) => ({ ...current, openStatus: event.target.value }))}
            >
              {Object.entries(OPEN_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ) : <StatusBadge label={OPEN_STATUS_LABELS[location.openStatus]} tone={openTone(location.openStatus)} />}
        </div>
        <div className="detail-status-card">
          <span className="detail-status-card__label">当前人流</span>
          {managerMode ? (
            <select
              value={draft.crowdStatus}
              onChange={(event) => setDraft((current) => ({ ...current, crowdStatus: event.target.value }))}
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
            value={draft.activity}
            onChange={(event) => setDraft((current) => ({ ...current, activity: event.target.value }))}
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
        {lostFoundPosts.length > 0 && <button className="community-location-posts" type="button" onClick={onOpenLostFound}><strong>这里有 {lostFoundPosts.length} 条失物信息</strong><span>{lostFoundPosts.map((post) => post.title).join('、')} · 打开大厅查看</span></button>}
        <div><CalendarClock size={15} /><span>数据更新时间</span><strong>{formatUpdatedAt(location.updatedAt)}</strong></div>
        {location.updatedBy && <div><UsersRound size={15} /><span>最近修改人</span><strong>{location.updatedBy}</strong></div>}
        <div><UsersRound size={15} /><span>当前视角</span><strong>{ROLE_LABELS[role]}</strong></div>
        <div><LockKeyhole size={15} /><span>数据范围</span><strong>本地演示</strong></div>
      </div>

      {managerMode && hasChanges && (
        <div className="detail-edit-actions">
          <button type="button" onClick={() => setDraft(editableValues(location))}><RotateCcw size={13} />取消修改</button>
          <button type="button" onClick={() => onUpdate(draft)}><Check size={13} />保存修改</button>
        </div>
      )}
      {canShowCampusLink(location.externalUrl) && (
        <a className="detail-external-link" href={location.externalUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} /> 访问官网
        </a>
      )}
      <button className={`detail-favorite-action${isFavorite ? ' is-active' : ''}`} type="button" aria-pressed={isFavorite} onClick={onToggleFavorite}>
        <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} /> {isFavorite ? '已收藏地点' : '收藏地点'}
      </button>
      <button className="detail-feedback-action" type="button" onClick={() => setShowFeedbackSheet(true)}>
        <Flag size={14} /> 反馈地点
      </button>
      <button className="detail-action" type="button" onClick={onPlanRoute}><Navigation size={14} /> 规划到这里</button>
    </aside>
    {showFeedbackSheet && onSubmitFeedback && (
      <PlaceFeedbackSheet
        location={location}
        onClose={() => setShowFeedbackSheet(false)}
        onSubmitFeedback={onSubmitFeedback}
      />
    )}
    </>
  )
}
