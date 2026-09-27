import { ArrowUpRight, Building2, Users } from 'lucide-react'
import { CATEGORY_LABELS, CROWD_STATUS_LABELS, OPEN_STATUS_LABELS } from '../../domain/campus.js'
import { EmptyState } from '../../components/EmptyState.jsx'
import { StatusBadge } from '../../components/StatusBadge.jsx'

function openTone(status) {
  return status === 'open' ? 'open' : status === 'limited' ? 'limited' : 'closed'
}

function crowdTone(status) {
  return status === 'busy' ? 'busy' : status === 'normal' ? 'normal' : 'low'
}

export function LocationList({ locations, selectedId, onSelect, onReset }) {
  if (locations.length === 0) {
    return <EmptyState onReset={onReset} />
  }

  return (
    <div className="location-list">
      {locations.map((location, index) => (
        <button
          className={`location-card ${selectedId === location.id ? 'is-selected' : ''}`}
          key={location.id}
          type="button"
          onClick={() => onSelect(location.id)}
          style={{ '--card-index': index }}
        >
          <div className="location-card__topline">
            <span className="location-card__index">0{index + 1}</span>
            <span className="location-card__category">{CATEGORY_LABELS[location.category]}</span>
            <ArrowUpRight className="location-card__arrow" size={17} />
          </div>
          <div className="location-card__title-row">
            <span className="location-card__icon"><Building2 size={18} /></span>
            <span>
              <strong>{location.name}</strong>
              <small>{location.description}</small>
            </span>
          </div>
          <div className="location-card__bottomline">
            <StatusBadge label={OPEN_STATUS_LABELS[location.openStatus]} tone={openTone(location.openStatus)} />
            <span className={`crowd-note crowd-note--${crowdTone(location.crowdStatus)}`}>
              <Users size={13} /> {CROWD_STATUS_LABELS[location.crowdStatus]}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}
