import { Activity, CircleDot, Radio, Users } from 'lucide-react'

export function CampusStatusOverlay({ locations, hotspotCount, lastSyncedAt }) {
  const openCount = locations.filter((location) => location.openStatus === 'open').length
  const busyCount = locations.filter((location) => location.crowdStatus === 'busy').length

  return (
    <div className="campus-status-overlay" aria-label="校园实时状态">
      <div className="campus-status-overlay__live"><span className="live-dot" /><Radio size={13} /> 状态同步中</div>
      <div className="campus-status-overlay__stats">
        <span><CircleDot size={13} />{openCount}/{locations.length} 开放</span>
        <span><Users size={13} />{busyCount} 处拥挤</span>
        <span><Activity size={13} />{hotspotCount} 个热点</span>
      </div>
      <small>更新于 {lastSyncedAt}</small>
    </div>
  )
}
