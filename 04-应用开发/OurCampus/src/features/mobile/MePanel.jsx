import { useRef, useState } from 'react'
import { Bookmark, ChevronDown, ChevronRight, Layers3, ShieldCheck, UtensilsCrossed, MapPin, Route as RouteIcon, Settings2, Star, Trash2, Wrench } from 'lucide-react'
import { EventComposer } from '../events/EventComposer.jsx'
import { MapLayerPanel } from '../map/MapLayerPanel.jsx'
import { SimulatedLocationPicker } from '../map/SimulatedLocationPicker.jsx'
import { SettingsPanel } from '../map/SettingsPanel.jsx'
import { FeedbackReviewPanel } from './FeedbackReviewPanel.jsx'
import { FacilityReportsPanel } from './FacilityReportsPanel.jsx'
import { PLACE_FEEDBACK_TYPES } from '../../domain/placeFeedback.js'
import { PersonalHome } from './PersonalHome.jsx'

export function MePanel({
  role,
  settings,
  locations,
  events,
  placeFeedback = [],
  currentLocationId,
  canUndoAdminAction,
  lastAdminAction,
  onRoleChange,
  onCurrentLocationChange,
  onSettingsChange,
  onResetSettings,
  onResetView,
  onFullscreen,
  onClearRoute,
  onResetDemoData,
  onUndoAdminAction,
  onPublishEvent,
  onUpdateEvent,
  onCloseEvent,
  onReviewPlaceFeedback,
  onUpdateFacilityReport,
  onSelectLocation,
  favoriteLocationIds = [],
  savedRoutes = [],
  onToggleFavorite,
  onPlanSavedRoute,
  onRemoveSavedRoute,
  lostFoundCount = 0,
  onOpenMyLostFound,
  auth,
  onOpenLogin,
  onOpenMyPublications,
  onOpenTimetable,
  onOpenMessages,
  unreadCount = 0,
  onOpenRepair,
  onOpenSubscriptions,
  onOpenReview,
  onOpenRestaurantManagement,
  onOpenLocationManagement,
  onBeforeLogout,
}) {
  const [showEventComposer, setShowEventComposer] = useState(false)
  const [showFeedbackReview, setShowFeedbackReview] = useState(false)
  const collectionRef = useRef(null)
  const favoritesRef = useRef(null)
  const routesRef = useRef(null)
  const revealCollection = (target) => {
    if (collectionRef.current) collectionRef.current.open = true
    requestAnimationFrame(() => (target === 'favorites' ? favoritesRef : routesRef).current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const facilityReports = placeFeedback.filter((entry) => entry.type === PLACE_FEEDBACK_TYPES.REPAIR)
  const ordinaryFeedback = placeFeedback.filter((entry) => entry.type !== PLACE_FEEDBACK_TYPES.REPAIR)

  return (
    <section className="mobile-page-panel mobile-page-panel--me" aria-label="我的主页">
      <PersonalHome auth={auth} onBeforeLogout={onBeforeLogout} onOpenLogin={onOpenLogin} onOpenMessages={onOpenMessages} unreadCount={unreadCount} onOpenTimetable={onOpenTimetable} onOpenMyPublications={onOpenMyPublications} onOpenFavorites={() => revealCollection('favorites')} onOpenRoutes={() => revealCollection('routes')} favoriteCount={favoriteLocationIds.length} />

      <div className="organized-account-menu">
        <button type="button" onClick={onOpenRepair}><Wrench size={20} /><span><strong>反馈与报修</strong><small>反馈校园设施问题，查看处理入口</small></span><ChevronRight size={17} /></button>
        <button type="button" onClick={onOpenSubscriptions}><Settings2 size={20} /><span><strong>订阅与通知设置</strong><small>关注的地点、类别与手机通知</small></span><ChevronRight size={17} /></button>
      </div>
      <details className="organized-collection" ref={collectionRef}>
        <summary><Star size={20} /><span><strong>收藏与常用路线</strong><small>{favoriteLocationIds.length} 个地点 · {savedRoutes.length} 条路线</small></span><ChevronDown size={17} /></summary>
      <section className="mobile-my-collections" aria-label="收藏和常用路线">
        <div className="mobile-my-collections__group" ref={favoritesRef}>
          <div className="mobile-my-collections__label"><Star size={14} /><strong>收藏地点</strong></div>
          {favoriteLocationIds.length ? favoriteLocationIds.map((locationId) => {
            const location = locations.find((entry) => entry.id === locationId)
            if (!location) return null
            return (
              <div className="mobile-my-collection-row" key={locationId}>
                <button type="button" onClick={() => onSelectLocation(locationId)}><MapPin size={14} /><span>{location.name}</span></button>
                <button className="mobile-my-collection-row__remove" type="button" aria-label={`取消收藏${location.name}`} onClick={() => onToggleFavorite(locationId)}><Trash2 size={14} /></button>
              </div>
            )
          }) : <p className="mobile-my-collections__empty">在地点详情卡片中点星标即可收藏。</p>}
        </div>
        <div className="mobile-my-collections__group" ref={routesRef}>
          <div className="mobile-my-collections__label"><Bookmark size={14} /><strong>保存的路线</strong></div>
          {savedRoutes.length ? savedRoutes.map((route) => {
            const originName = locations.find((entry) => entry.id === route.originId)?.name ?? '起点'
            const destinationName = locations.find((entry) => entry.id === route.destinationId)?.name ?? '终点'
            return (
              <div className="mobile-my-collection-row" key={route.id}>
                <button type="button" onClick={() => onPlanSavedRoute(route)}><RouteIcon size={14} /><span>{originName} → {destinationName}</span></button>
                <button className="mobile-my-collection-row__remove" type="button" aria-label={`删除${originName}到${destinationName}的路线`} onClick={() => onRemoveSavedRoute(route.id)}><Trash2 size={14} /></button>
              </div>
            )
          }) : <p className="mobile-my-collections__empty">路线卡片中可将常走路线加入收藏。</p>}
        </div>
      </section>

      </details>
      <details className="organized-settings">
        <summary><Settings2 size={20} /><span><strong>应用设置</strong><small>地图显示、路线偏好与操作提示</small></span><ChevronDown size={17} /></summary>
        <section className="mobile-me-card" aria-label="地图显示设置"><div className="mobile-me-card__heading"><Layers3 size={17} /><strong>地图显示</strong></div><MapLayerPanel settings={settings} onChange={onSettingsChange} compact /></section>
        <SettingsPanel settings={settings} onChange={onSettingsChange} onResetSettings={onResetSettings} onResetView={onResetView} onFullscreen={onFullscreen} onClearRoute={onClearRoute} showClearCurrentLocation={false} showDevelopmentTools={false} />
      </details>
      {role === 'manager' && <details className="organized-management">
        <summary><ShieldCheck size={20} /><span><strong>校园管理</strong><small>审核、窗口维护与地点管理</small></span><ChevronDown size={17} /></summary>
        <div className="organized-account-menu">
          <button type="button" onClick={onOpenReview}><ShieldCheck size={18} /><span><strong>校园信息审核</strong><small>确认 AI 草稿，发布有效通知</small></span><ChevronRight size={16} /></button>
          <button type="button" onClick={onOpenRestaurantManagement}><UtensilsCrossed size={18} /><span><strong>餐厅窗口管理</strong><small>选择餐厅后添加或删除窗口</small></span><ChevronRight size={16} /></button>
          <button type="button" onClick={onOpenLocationManagement}><MapPin size={18} /><span><strong>地点维护</strong><small>选择地点修改开放与人流状态</small></span><ChevronRight size={16} /></button>
        </div>
        <section className="mobile-manager-card"><button className="mobile-manager-card__toggle" type="button" aria-expanded={showFeedbackReview} onClick={() => setShowFeedbackReview((value) => !value)}>地点反馈审核 · {ordinaryFeedback.filter((entry) => entry.status === 'pending').length}</button>{showFeedbackReview && <FeedbackReviewPanel feedbacks={ordinaryFeedback} locations={locations} onReview={onReviewPlaceFeedback} />}</section>
        <FacilityReportsPanel reports={facilityReports} locations={locations} role={role} onStatusChange={onUpdateFacilityReport} />
        <section className="mobile-manager-card"><button className="mobile-manager-card__toggle" type="button" aria-expanded={showEventComposer} onClick={() => setShowEventComposer((value) => !value)}>本机热点管理</button>{showEventComposer && <EventComposer locations={locations} events={events} onPublish={onPublishEvent} onUpdate={onUpdateEvent} onClose={onCloseEvent} />}</section>
      </details>}
      {import.meta.env.DEV && <details className="organized-development">
        <summary><Settings2 size={18} /><span><strong>开发工具</strong><small>仅开发预览显示</small></span><ChevronDown size={16} /></summary>
        <SimulatedLocationPicker locations={locations} currentLocationId={currentLocationId} onChange={onCurrentLocationChange} compact />
        <SettingsPanel settings={settings} onChange={onSettingsChange} onResetSettings={onResetSettings} onResetView={onResetView} onFullscreen={onFullscreen} onClearRoute={onClearRoute} onResetDemoData={onResetDemoData} canUndoAdminAction={canUndoAdminAction} lastAdminAction={lastAdminAction} onUndoAdminAction={onUndoAdminAction} showClearCurrentLocation={false} />
      </details>}
    </section>
  )
}
