import { BookOpen, ExternalLink, MapPin, Navigation, Phone } from 'lucide-react'
import { canShowCampusLink } from '../../data/campusPresentation.js'

function matchesQuery(service, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return [service.title, service.summary, service.hours, service.phone, ...(service.keywords ?? [])]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery))
}

export function CampusServiceDirectory({ services, locations, query, onSelectLocation, onPlanRouteToLocation }) {
  const visibleServices = services.filter((service) => matchesQuery(service, query))
  if (!visibleServices.length) return null

  const locationById = new Map(locations.map((location) => [location.id, location]))

  return (
    <section className="mobile-panel-section mobile-service-directory" aria-label="校园服务信息">
      <div className="mobile-panel-section__heading">
        <h3>校园服务</h3>
        <span>官方信息 · 未公开项会注明</span>
      </div>
      <div className="mobile-service-directory__list">
        {visibleServices.map((service) => {
          const location = service.locationId ? locationById.get(service.locationId) : null
          return (
            <article className="mobile-service-directory__card" key={service.id}>
              <header>
                <span className="mobile-service-directory__icon"><BookOpen size={17} aria-hidden="true" /></span>
                <div><strong>{service.title}</strong><p>{service.summary}</p></div>
              </header>
              <dl>
                <div><dt>开放时间</dt><dd>{service.hours || '暂无官方公开信息'}</dd></div>
                <div><dt>联系电话</dt><dd>
                  {service.phone
                    ? <a href={`tel:${service.phone.replace(/[^\d+]/g, '')}`}><Phone size={12} />{service.phone}</a>
                    : '暂无官方公开信息'}
                </dd></div>
              </dl>
              {service.phoneNote && <small className="mobile-service-directory__note">{service.phoneNote}</small>}
              <footer>
                {location && (
                  <>
                    <button type="button" onClick={() => onSelectLocation(location.id)}><MapPin size={13} />地点详情</button>
                    <button type="button" onClick={() => onPlanRouteToLocation(location.id)}><Navigation size={13} />导航</button>
                  </>
                )}
                {canShowCampusLink(service.website) && <a href={service.website} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />官网入口</a>}
                {!service.website && canShowCampusLink(service.sourceUrl) && <a href={service.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />官方来源</a>}
                {service.website && canShowCampusLink(service.sourceUrl) && <a className="mobile-service-directory__source" href={service.sourceUrl} target="_blank" rel="noopener noreferrer">信息来源</a>}
              </footer>
            </article>
          )
        })}
      </div>
    </section>
  )
}
