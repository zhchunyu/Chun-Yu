import { useState } from 'react'
import { LocationFilters } from '../locations/LocationFilters.jsx'
import { LocationList } from '../locations/LocationList.jsx'
import { CampusEventCalendar } from './CampusEventCalendar.jsx'
import { CampusServiceDirectory } from './CampusServiceDirectory.jsx'
import { IndoorNavigationNotice } from './IndoorNavigationNotice.jsx'
import { NearbyFacilitiesPanel } from './NearbyFacilitiesPanel.jsx'

export function ExplorePanel({
  locations,
  allLocations,
  calendarEvents = [],
  services = [],
  selectedId,
  query,
  category,
  onQueryChange,
  onCategoryChange,
  onSelectLocation,
  onPlanRouteToLocation,
  onReset,
  facilityContributions,
  livePosition,
  deviceLocationStatus,
  deviceLocationMessage,
  onLocateDevice,
  role,
  onSubmitFacility,
  onReviewFacility,
}) {
  const [section, setSection] = useState('places')

  return (
    <section className="mobile-page-panel mobile-page-panel--explore" aria-label="探索校园">
      <header className="mobile-page-heading mobile-page-heading--compact">
        <h2>地点</h2>
      </header>

      <div className="community-tabs" role="group" aria-label="地点浏览方式"><button type="button" className={section === 'places' ? 'is-active' : ''} aria-pressed={section === 'places'} onClick={() => setSection('places')}>校园地点</button><button type="button" className={section === 'nearby' ? 'is-active' : ''} aria-pressed={section === 'nearby'} onClick={() => setSection('nearby')}>附近设施</button></div>
      {section === 'nearby' ? <NearbyFacilitiesPanel locations={allLocations} contributions={facilityContributions} livePosition={livePosition} locationStatus={deviceLocationStatus} locationMessage={deviceLocationMessage} onLocate={onLocateDevice} role={role} onSubmitContribution={onSubmitFacility} onReviewContribution={onReviewFacility} onSelectLocation={onSelectLocation} onPlanRouteToLocation={onPlanRouteToLocation} /> : <>

      <LocationFilters
        query={query}
        category={category}
        onQueryChange={onQueryChange}
        onCategoryChange={onCategoryChange}
      />

      {category === 'all' && (
        <>
          <CampusServiceDirectory
            services={services}
            locations={allLocations}
            query={query}
            onSelectLocation={onSelectLocation}
            onPlanRouteToLocation={onPlanRouteToLocation}
          />
          {!query.trim() && (
            <>
              <CampusEventCalendar
                events={calendarEvents}
                locations={allLocations}
                onSelectLocation={onSelectLocation}
                onPlanRouteToLocation={onPlanRouteToLocation}
              />
              <IndoorNavigationNotice />
            </>
          )}
        </>
      )}

      <section className="mobile-panel-section" aria-label="校园地点">
        <div className="mobile-panel-section__heading">
          <h3>全部地点</h3>
          <span>{locations.length} 处</span>
        </div>
        <LocationList
          locations={locations}
          selectedId={selectedId}
          onSelect={onSelectLocation}
          onPlanRoute={onPlanRouteToLocation}
          onReset={onReset}
        />
      </section>

      </>}
    </section>
  )
}
