import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { collectNewNotices } from '../../data/notificationRelevance.js'
import { campusDisplayText } from '../../data/campusPresentation.js'

export function CampusNoticeBanner({ userId, information, covered, onOpen }) {
  const baseline = useRef({ ownerId: userId, seen: null })
  const [alert, setAlert] = useState(null)
  useEffect(() => {
    if (baseline.current.ownerId !== userId) { baseline.current = { ownerId: userId, seen: null }; setAlert(null) }
    if (!userId || information.status !== 'ready') return
    const result = collectNewNotices(baseline.current.seen, information.notices)
    baseline.current.seen = result.seen
    if (result.fresh.length && document.visibilityState === 'visible') setAlert({ userId, notice: result.fresh[0], count: result.fresh.length })
  }, [userId, information.status, information.notices])
  useEffect(() => {
    if (!alert) return
    const timer = setTimeout(() => setAlert(null), 10000)
    return () => clearTimeout(timer)
  }, [alert])
  if (!alert || alert.userId !== userId || covered) return null
  return <aside className="campus-notice-banner" aria-label="新的校园提醒">
    <button type="button" onClick={() => { onOpen(alert.notice.id); setAlert(null) }}>
      <Bell size={21} /><span role="status"><strong>{campusDisplayText(alert.notice.title)}</strong><small>{campusDisplayText(alert.notice.reason || alert.notice.body)}{alert.count > 1 ? ` · 另有 ${alert.count - 1} 条新提醒` : ''}</small></span>
    </button><button type="button" aria-label="暂时收起提醒" onClick={() => setAlert(null)}><X size={18} /></button>
  </aside>
}
