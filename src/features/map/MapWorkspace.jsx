import { MapPin, Navigation } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState.jsx'
import { teamCampusMap } from '../../data/campusMap.js'
import { Campus2DViewer } from './Campus2DViewer.jsx'
import { Campus3DViewer } from './Campus3DViewer.jsx'
import { CampusStatusOverlay } from './CampusStatusOverlay.jsx'
import { MapSearchOverlay } from './MapSearchOverlay.jsx'
import { MapToolbar } from './MapToolbar.jsx'
import { MapSceneSwitcher } from './MapSceneSwitcher.jsx'
import { HotspotLegend } from '../events/HotspotLegend.jsx'
import { projectVisibleMapContent } from './mapVisibility.js'

export function MapWorkspace({
  locations,
  visibleLocations = locations,
  events,
  searchResults = [],
  selectedId,
  query,
  category,
  mapScene,
  toolbarOpen,
  activeTool,
  role,
  settings,
  resetViewToken,
  currentLocationId,
  cameraMode,
  routePlan,
  lastSyncedAt,
  canUndoAdminAction,
  lastAdminAction,
  onPublishEvent,
  onUpdateEvent,
  onCloseEvent,
  onUndoAdminAction,
  onToggleToolbar,
  onToolChange,
  onRoleChange,
  onCurrentLocationChange,
  onCameraModeChange,
  onSettingsChange,
  onResetSettings,
  onResetView,
  onFullscreen,
  onClearRoute,
  onClearCurrentLocation,
  onResetDemoData,
  onSelectLocation,
  onQueryChange,
  onSelectSearchResult,
  onCategoryChange,
  onMapSceneChange,
}) {
  const {
    visibleLocationIds,
    activeEvents,
    visibleEvents,
  } = projectVisibleMapContent({ visibleLocations, events, settings })
  const displayedRoutePlan = settings.showRoute ? routePlan : null

  return (
    <section className="map-workspace" aria-label={`${teamCampusMap.campusName}地图工作区`}>
      <MapSearchOverlay
        query={query}
        category={category}
        results={searchResults}
        onQueryChange={onQueryChange}
        onCategoryChange={onCategoryChange}
        onSelectResult={onSelectSearchResult}
      />
      <CampusStatusOverlay locations={locations} hotspotCount={activeEvents.length} lastSyncedAt={lastSyncedAt} />
      <MapSceneSwitcher scene={mapScene} onChange={onMapSceneChange} />
      <MapToolbar
        open={toolbarOpen}
        activeTool={activeTool}
        role={role}
        settings={settings}
        locations={locations}
        events={activeEvents}
        currentLocationId={currentLocationId}
        cameraMode={cameraMode}
        canUndoAdminAction={canUndoAdminAction}
        lastAdminAction={lastAdminAction}
        onToggle={onToggleToolbar}
        onToolChange={onToolChange}
        onRoleChange={onRoleChange}
        onCurrentLocationChange={onCurrentLocationChange}
        onCameraModeChange={onCameraModeChange}
        onSettingsChange={onSettingsChange}
        onResetSettings={onResetSettings}
        onResetView={onResetView}
        onFullscreen={onFullscreen}
        onClearRoute={onClearRoute}
        onClearCurrentLocation={onClearCurrentLocation}
        onResetDemoData={onResetDemoData}
        onPublishEvent={onPublishEvent}
        onUpdateEvent={onUpdateEvent}
        onCloseEvent={onCloseEvent}
        onUndoAdminAction={onUndoAdminAction}
      />

      <div className={`map-surface ${mapScene === '3d' ? 'map-surface--3d' : 'map-surface--2d'} ${displayedRoutePlan ? 'has-route' : ''}`} aria-label={mapScene === '3d' ? `${teamCampusMap.campusName}三维校园地图` : `${teamCampusMap.campusName}二维校园平面图`}>
        {mapScene === '2d' ? (
          <Campus2DViewer
            mapUrl={teamCampusMap.scenes['2d'].imageUrl}
            locations={locations}
            visibleLocationIds={visibleLocationIds}
            events={visibleEvents}
            selectedId={selectedId}
            currentLocationId={settings.showCurrentLocation ? currentLocationId : null}
            routePlan={displayedRoutePlan}
            showLabels={settings.showLabels}
            showStatusColors={settings.showStatusColors}
            showTips={settings.showTips}
            resetViewToken={resetViewToken}
            onSelectLocation={onSelectLocation}
          />
        ) : (
          <Campus3DViewer
            modelUrl={teamCampusMap.scenes['3d'].modelUrl}
            locations={locations}
            visibleLocationIds={visibleLocationIds}
            events={visibleEvents}
            selectedId={selectedId}
            currentLocationId={settings.showCurrentLocation ? currentLocationId : null}
            cameraMode={cameraMode}
            routePlan={displayedRoutePlan}
            showLabels={settings.showLabels}
            showStatusColors={settings.showStatusColors}
            showTips={settings.showTips}
            resetViewToken={resetViewToken}
            onSelectLocation={onSelectLocation}
            onCameraModeChange={onCameraModeChange}
            onSwitchTo2D={() => onMapSceneChange('2d')}
          />
        )}
        <div className="map-compass"><Navigation size={16} /><span>N</span></div>
        <div className="map-source-note">
          <MapPin size={15} />
          <span>
            <strong>{teamCampusMap.campusName}</strong>
            <small>{mapScene === '2d'
              ? `${teamCampusMap.scenes['2d'].sourceLabel} · ${teamCampusMap.version}`
              : `${teamCampusMap.scenes['3d'].modelSource} · ${teamCampusMap.scenes['3d'].modelSize} · ${teamCampusMap.version}`}</small>
          </span>
          <a href={mapScene === '2d' ? teamCampusMap.scenes['2d'].sourceUrl : teamCampusMap.scenes['3d'].modelSourceUrl} target="_blank" rel="noreferrer">查看来源</a>
        </div>
        {visibleLocations.length === 0 && !query.trim() && category !== 'all' && (
          <div className="map-empty-state">
            <EmptyState
              onReset={() => {
                onQueryChange('')
                onCategoryChange('all')
              }}
            />
          </div>
        )}
      </div>
      {settings.showHotspots && <HotspotLegend />}
    </section>
  )
}
