import { useState } from 'react'
import { Send, Square, X } from 'lucide-react'
import { HOTSPOT_TYPE_LABELS, HOTSPOT_TYPES } from '../../domain/campus.js'
import { getDefaultAffectedEdgeIds } from '../../data/events.js'

const typeOptions = Object.values(HOTSPOT_TYPES)

export function EventComposer({ locations, events, onPublish, onClose }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState(HOTSPOT_TYPES.ACTIVITY)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [heatLevel, setHeatLevel] = useState('medium')
  const [impact, setImpact] = useState('')

  const submit = (event) => {
    event.preventDefault()
    if (!title.trim() || !locationId) return

    onPublish({
      id: `event-${Date.now()}`,
      title: title.trim(),
      type,
      locationId,
      status: 'active',
      startAt: new Date().toISOString(),
      endAt: null,
      heatLevel,
      impact: impact.trim() || '暂无额外影响说明。',
      affectedEdgeIds: getDefaultAffectedEdgeIds({ type, locationId }),
      source: 'manager',
      visibleTo: ['visitor', 'student', 'manager'],
    })
    setTitle('')
    setImpact('')
  }

  return (
    <div className="event-composer">
      <div className="event-composer__heading"><span><Send size={14} /> 发布校园热点</span><X size={14} /></div>
      <form onSubmit={submit}>
        <label>热点标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：图书馆讲座开始" /></label>
        <div className="event-composer__grid">
          <label>类型<select value={type} onChange={(event) => setType(event.target.value)}>{typeOptions.map((option) => <option value={option} key={option}>{HOTSPOT_TYPE_LABELS[option]}</option>)}</select></label>
          <label>地点<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
        </div>
        <label>影响说明<input value={impact} onChange={(event) => setImpact(event.target.value)} placeholder="描述对校园的影响" /></label>
        <label>热度<select value={heatLevel} onChange={(event) => setHeatLevel(event.target.value)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <button className="event-composer__submit" type="submit">发布到地图</button>
      </form>
      <div className="event-composer__active"><small>正在显示的热点</small>{events.length === 0 && <span>暂无进行中的热点</span>}{events.map((event) => <div className="event-composer__event" key={event.id}><span>{event.title}</span><button type="button" onClick={() => onClose(event.id)} aria-label={`结束${event.title}`}><Square size={12} />结束</button></div>)}</div>
    </div>
  )
}
