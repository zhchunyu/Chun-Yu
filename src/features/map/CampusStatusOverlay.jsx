import { Activity, CircleDot, Database, Users } from 'lucide-react'

function formatDataTimestamp(value) {
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return value || '未知'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

export function CampusStatusOverlay({ locations, hotspotCount, lastSyncedAt }) {
  const openCount = locations.filter((location) => location.openStatus === 'open').length
  const busyCount = locations.filter((location) => location.crowdStatus === 'busy').length

  return (
    <div className="campus-status-overlay" aria-label="校园演示状态">
      <div className="campus-status-overlay__live"><Database size={13} /> 本地演示数据</div>
      <div className="campus-status-overlay__stats">
        <span><CircleDot size={13} />{openCount}/{locations.length} 开放</span>
        <span><Users size={13} />{busyCount} 处拥挤</span>
        <span><Activity size={13} />{hotspotCount} 个热点</span>
      </div>
      <small>本地数据更新时间：{formatDataTimestamp(lastSyncedAt)}</small>
    </div>
  )
}
