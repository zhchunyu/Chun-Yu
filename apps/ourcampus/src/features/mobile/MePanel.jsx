import { campusDisplayText } from '../../data/campusPresentation.js'
import { useState } from 'react'
import { Bell, Bookmark, CalendarDays, ChevronDown, ChevronRight, Layers3, LogIn, LogOut, MapPin, Pencil, Route as RouteIcon, Settings2, Star, Trash2, UserRound } from 'lucide-react'
import { EventComposer } from '../events/EventComposer.jsx'
import { RoleSwitcher } from '../roles/RoleSwitcher.jsx'
import { describeServerError } from '../../data/supabaseClient.js'
import { MapLayerPanel } from '../map/MapLayerPanel.jsx'
import { SimulatedLocationPicker } from '../map/SimulatedLocationPicker.jsx'
import { SettingsPanel } from '../map/SettingsPanel.jsx'
import { FeedbackReviewPanel } from './FeedbackReviewPanel.jsx'
import { FacilityReportsPanel } from './FacilityReportsPanel.jsx'
import { PLACE_FEEDBACK_TYPES } from '../../domain/placeFeedback.js'

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
  onOpenTimetable,
  onOpenInformation,
  unreadCount = 0,
  onBeforeLogout,
}) {
  const [showEventComposer, setShowEventComposer] = useState(false)
  const [showFeedbackReview, setShowFeedbackReview] = useState(false)
  const [editingNickname, setEditingNickname] = useState(false)
  const [nickname, setNickname] = useState('')
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountNotice, setAccountNotice] = useState('')
  const displayName = campusDisplayText(auth.profile?.nickname ?? auth.user?.user_metadata?.nickname ?? '校园同学')
  const changeNickname = async (event) => {
    event.preventDefault()
    if (accountBusy) return
    if (!nickname.trim() || [...nickname.trim()].length > 40) { setAccountNotice('昵称请填写 1–40 个字'); return }
    setAccountBusy(true)
    setAccountNotice('')
    try { await auth.updateNickname(nickname); setEditingNickname(false); setAccountNotice('昵称已更新') }
    catch (error) { setAccountNotice(describeServerError(error, '昵称保存失败，请重试')) }
    finally { setAccountBusy(false) }
  }
  const logout = async () => {
    if (accountBusy) return
    setAccountBusy(true)
    setAccountNotice('')
    try { await onBeforeLogout?.(); await auth.logout(); setEditingNickname(false) }
    catch (error) { setAccountNotice(describeServerError(error, '退出失败，请重试')) }
    finally { setAccountBusy(false) }
  }
  const facilityReports = placeFeedback.filter((entry) => entry.type === PLACE_FEEDBACK_TYPES.REPAIR)
  const ordinaryFeedback = placeFeedback.filter((entry) => entry.type !== PLACE_FEEDBACK_TYPES.REPAIR)

  return (
    <section className="mobile-page-panel mobile-page-panel--me" aria-label="我的设置">
      <header className="mobile-page-heading mobile-page-heading--compact">
        <h2>我的</h2>
      </header>

      <section className="mobile-login-entry" aria-label="账号登录">
        <span className="mobile-login-entry__avatar">{auth.user ? [...displayName][0] : <UserRound size={21} aria-hidden="true" />}</span>
        <span className="mobile-login-entry__identity">
          <strong>{auth.status === 'loading' ? '正在恢复登录…' : auth.user ? displayName : '未登录'}</strong>
          <small>{auth.user ? auth.user.email : '登录后加入多人校园聊天'}</small>
        </span>
        {auth.user ? <button type="button" disabled={accountBusy} onClick={logout}><LogOut size={15} /> 退出</button>
          : <button type="button" disabled={auth.status === 'loading'} onClick={onOpenLogin}><LogIn size={15} aria-hidden="true" /> 登录 / 注册</button>}
      </section>

      {auth.user && <section className="mobile-account-settings" aria-label="账号资料">
        {editingNickname ? <form onSubmit={changeNickname}>
          <label htmlFor="account-nickname">大厅昵称</label>
          <div><input id="account-nickname" value={nickname} maxLength={40} disabled={accountBusy} autoComplete="nickname" onChange={(event) => setNickname(event.target.value)} /><button type="submit" disabled={accountBusy}>{accountBusy ? '保存中…' : '保存'}</button><button type="button" disabled={accountBusy} onClick={() => setEditingNickname(false)}>取消</button></div>
        </form> : <button type="button" onClick={() => { setNickname(displayName); setEditingNickname(true); setAccountNotice('') }}><Pencil size={14} /> 修改大厅昵称</button>}
      </section>}
      {(accountNotice || auth.error) && <p className="mobile-login-notice" role="status">{accountNotice || auth.error}{auth.error && <button className="mobile-account-retry" type="button" onClick={() => auth.refreshProfile().catch(() => setAccountNotice('资料加载失败，请稍后重试'))}>重试</button>}</p>}

      <section className="mobile-my-collections" aria-label="教务与学习"><div className="mobile-panel-section__heading"><h3>教务与学习</h3><span>个人课表</span></div><button className="community-my-entry" type="button" onClick={onOpenTimetable}><CalendarDays size={19} /><span><strong>我的课表</strong><small>导入教务课表 · 按周查看 · AI 规划</small></span><ChevronRight size={18} /></button></section>
      <button type="button" className="campus-notifications-entry" onClick={onOpenInformation}><Bell size={20} /><span><strong>消息中心</strong><small>通知 · 发布 · 订阅 · 系统推送设置</small></span>{unreadCount > 0 && <b>{unreadCount}</b>}<ChevronRight size={18} /></button>
      <section className="mobile-my-collections" aria-label="我的校园发布"><div className="mobile-panel-section__heading"><h3>我的发布</h3><span>本机与云端</span></div><button className="community-my-entry" type="button" onClick={onOpenMyLostFound}><MapPin size={18} /><span><strong>失物招领</strong><small>查看信息、更新认领状态</small></span><b>{lostFoundCount} 条</b></button></section>

      <FacilityReportsPanel
        reports={facilityReports}
        locations={locations}
        role={role}
        onStatusChange={onUpdateFacilityReport}
      />

      <section className="mobile-my-collections" aria-label="收藏和常用路线">
        <div className="mobile-panel-section__heading"><h3>收藏与常用路线</h3><span>保存在本机</span></div>
        <div className="mobile-my-collections__group">
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
        <div className="mobile-my-collections__group">
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

      <section className="mobile-me-card" aria-label="地图显示设置">
        <div className="mobile-me-card__heading"><Layers3 size={17} /><strong>地图显示</strong></div>
        <MapLayerPanel settings={settings} onChange={onSettingsChange} compact />
      </section>

      <details className="mobile-me-advanced">
        <summary>
          <Settings2 size={17} aria-hidden="true" />
          <span><strong>更多设置</strong><small>路线起点、偏好与演示管理</small></span>
          <ChevronDown className="mobile-me-advanced__chevron" size={17} aria-hidden="true" />
        </summary>
        <div className="mobile-me-advanced__content">
          <RoleSwitcher role={role} onChange={onRoleChange} />
          <SimulatedLocationPicker
            locations={locations}
            currentLocationId={currentLocationId}
            onChange={onCurrentLocationChange}
            compact
          />
          <SettingsPanel
            settings={settings}
            onChange={onSettingsChange}
            onResetSettings={onResetSettings}
            onResetView={onResetView}
            onFullscreen={onFullscreen}
            onClearRoute={onClearRoute}
            onResetDemoData={onResetDemoData}
            showClearCurrentLocation={false}
            canUndoAdminAction={canUndoAdminAction}
            lastAdminAction={lastAdminAction}
            onUndoAdminAction={onUndoAdminAction}
          />
          {role === 'manager' && (
            <>
              <section className="mobile-manager-card" aria-label="管理者演示工具">
                <button
                  className="mobile-manager-card__toggle"
                  type="button"
                  aria-expanded={showEventComposer}
                  onClick={() => setShowEventComposer((visible) => !visible)}
                >
                  {showEventComposer ? '收起热点管理' : '发布或管理校园热点'}
                </button>
                {showEventComposer && (
                  <EventComposer
                    locations={locations}
                    events={events}
                    onPublish={onPublishEvent}
                    onUpdate={onUpdateEvent}
                    onClose={onCloseEvent}
                  />
                )}
              </section>
              <section className="mobile-manager-card" aria-label="地点反馈审核工具">
                <button
                  className="mobile-manager-card__toggle mobile-manager-card__toggle--feedback"
                  type="button"
                  aria-expanded={showFeedbackReview}
                  onClick={() => setShowFeedbackReview((visible) => !visible)}
                >
                  <span>{showFeedbackReview ? '收起地点反馈审核' : '审核地点反馈'}</span>
                  {ordinaryFeedback.filter((entry) => entry.status === 'pending').length > 0 && (
                    <span className="mobile-manager-card__count">{ordinaryFeedback.filter((entry) => entry.status === 'pending').length}</span>
                  )}
                </button>
                {showFeedbackReview && (
                  <FeedbackReviewPanel feedbacks={ordinaryFeedback} locations={locations} onReview={onReviewPlaceFeedback} />
                )}
              </section>
            </>
          )}
          <p className="mobile-local-data-note">偏好、活动、报修、收藏和常用路线只保存在当前设备。</p>
        </div>
      </details>

    </section>
  )
}
