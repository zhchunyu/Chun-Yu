import { campusDisplayText } from '../../data/campusPresentation.js'
import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronRight, LogIn, MessageCircle, Send, Sparkles } from 'lucide-react'
import { describeServerError } from '../../data/supabaseClient.js'
import { CAMPUS_HALL_REGIONS } from '../../data/campusHall.js'
import { CampusHotspotsPanel } from './CampusHotspotsPanel.jsx'
import { LostFoundPanel } from './LostFoundPanel.jsx'
import { RestaurantHallSection } from './RestaurantHallSection.jsx'

const COMPOSER_REGIONS = CAMPUS_HALL_REGIONS.filter((region) => region.id !== 'all')
const REGION_LABELS = new Map(COMPOSER_REGIONS.map((region) => [region.id, region.label]))

export function HallPanel({ messages, selectedRegionId, onRegionChange, onSendMessage, activeSection, onSectionChange, locations, hotspots, posts, lostFoundFilter, onLostFoundFilterChange, onSubmitPost, onPostStatusChange, onDeletePost, onSelectLocation, onPlanRouteToLocation, onOpenRestaurantReviews, showLostFound, onLostFoundMapChange, auth, chat, onOpenLogin, onOpenAuv, information, onOpenInformation, onPublishInformation, onSubmitAsInformation }) {
  const [draft, setDraft] = useState('')
  const [composerRegionId, setComposerRegionId] = useState('living')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [retractingId, setRetractingId] = useState(null)
  const lastMessageRef = useRef(null)
  const shouldScrollToNewMessage = useRef(false)
  const loadedScope = useRef(null)
  const currentUserId = useRef(auth.user?.id)
  currentUserId.current = auth.user?.id

  useEffect(() => { setDraft(''); setSendError(''); shouldScrollToNewMessage.current = false }, [auth.user?.id])

  useEffect(() => {
    const scope = `${auth.user?.id}:${selectedRegionId}`
    const initialHistory = chat.historyStatus === 'ready' && loadedScope.current !== scope
    if ((initialHistory || shouldScrollToNewMessage.current) && messages.length > 0) {
      lastMessageRef.current?.scrollIntoView({ block: 'nearest', behavior: initialHistory ? 'auto' : 'smooth' })
      shouldScrollToNewMessage.current = false
    }
    if (chat.historyStatus === 'ready') loadedScope.current = scope
  }, [messages, auth.user?.id, selectedRegionId, chat.historyStatus])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    if (!auth.user) { onOpenLogin(); return }
    setSending(true)
    const senderId = auth.user.id
    setSendError('')
    try {
      await onSendMessage({ content, regionId: composerRegionId })
      if (currentUserId.current !== senderId) return
      shouldScrollToNewMessage.current = true
      if (selectedRegionId !== 'all' && selectedRegionId !== composerRegionId) onRegionChange(composerRegionId)
      setDraft('')
      lastMessageRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } catch (error) { if (currentUserId.current === senderId) setSendError(describeServerError(error, '发送未成功，草稿已保留，请重试')) }
    finally { setSending(false) }
  }
  const retract = async (id) => {
    if (retractingId) return
    setRetractingId(id)
    setSendError('')
    try { await chat.retractMessage(id) }
    catch (error) { setSendError(describeServerError(error, '撤回未成功，请重试')) }
    finally { setRetractingId(null) }
  }
  const chatLabel = !auth.user ? (auth.status === 'loading' ? '正在恢复登录…' : '登录后，与同学一起聊校园')
    : chat.connectionStatus === 'live' ? '实时聊天已连接'
    : chat.connectionStatus === 'offline' ? '当前离线，联网后会重新同步'
    : chat.connectionStatus === 'reconnecting' ? '实时连接重试中，消息仍会定时同步'
    : '正在连接校园大厅…'

  return (
    <section className="mobile-page-panel mobile-page-panel--hall" aria-label="校园大厅">
      <header className="mobile-page-heading mobile-hall-heading">
        <h2>校园大厅</h2>
        <div className="mobile-hall-demo-note">
          <MessageCircle size={15} aria-hidden="true" />
          <span>{activeSection === 'chat' ? chatLabel : activeSection === 'restaurants' ? '窗口名单由管理员维护，评价暂存本机。' : '云端校园信息与本机资料，按地区查看。'}</span>
        </div>
      </header>

      <button type="button" className="hall-auv-entry" onClick={onOpenAuv}><span><Sparkles size={20} aria-hidden="true" /></span><span><strong>AUV 校园助手</strong><small>问校园 · 分析事件</small></span><ChevronRight size={18} aria-hidden="true" /></button>
      <button type="button" className="campus-notifications-entry" onClick={onOpenInformation}><Bell size={20} /><span><strong>校园消息</strong><small>公共通知 · 我的上报 · 地点订阅</small></span>{information.unread > 0 && <b>{information.unread > 99 ? '99+' : information.unread}</b>}<ChevronRight size={18} /></button>

      <div className="community-tabs" role="group" aria-label="大厅功能">
        {[{ id: 'chat', label: '聊天' }, { id: 'hotspots', label: '校园热点' }, { id: 'lost-found', label: '失物招领' }, { id: 'restaurants', label: '餐厅评价' }].map((tab) => <button type="button" key={tab.id} className={activeSection === tab.id ? 'is-active' : ''} aria-pressed={activeSection === tab.id} onClick={() => onSectionChange(tab.id)}>{tab.label}</button>)}
      </div>

      {activeSection !== 'restaurants' && <div className="mobile-hall-regions" role="group" aria-label="按校园区域筛选大厅内容">
        {CAMPUS_HALL_REGIONS.map((region) => (
          <button
            className={`mobile-hall-region${selectedRegionId === region.id ? ' is-active' : ''}`}
            type="button"
            key={region.id}
            aria-pressed={selectedRegionId === region.id}
            onClick={() => onRegionChange(region.id)}
          >
            {region.label}
          </button>
        ))}
      </div>}

      <div className="community-scroll" hidden={activeSection !== 'hotspots'}>
        <CampusHotspotsPanel events={hotspots} locations={locations} regionId={selectedRegionId} onSelectLocation={onSelectLocation} onPlanRouteToLocation={onPlanRouteToLocation} onPublishInformation={onPublishInformation} />
      </div>
      <div className="community-scroll" hidden={activeSection !== 'lost-found'}>
        <LostFoundPanel posts={posts} locations={locations} regionId={selectedRegionId} filter={lostFoundFilter} onFilterChange={onLostFoundFilterChange} onRegionChange={onRegionChange} onSubmitPost={onSubmitPost} onStatusChange={onPostStatusChange} onDeletePost={onDeletePost} onSelectLocation={onSelectLocation} onPlanRouteToLocation={onPlanRouteToLocation} showMapMarkers={showLostFound} onMapMarkersChange={onLostFoundMapChange} currentUserId={auth.user?.id} cloudReady={information.status === 'ready'} />
      </div>
      {activeSection === 'restaurants' && <div className="community-scroll"><RestaurantHallSection locations={locations} onOpenReviews={onOpenRestaurantReviews} /></div>}

      {activeSection === 'chat' && <>
      <section className="mobile-hall-feed" aria-label="校园聊天消息">
        <div className="mobile-panel-section__heading mobile-hall-feed__heading">
          <h3>{selectedRegionId === 'all' ? '全部消息' : REGION_LABELS.get(selectedRegionId)}</h3>
          <span>{auth.user ? `${messages.length} 条消息` : '登录后可见'}</span>
        </div>
        {!auth.user ? <div className="mobile-hall-login-gate"><MessageCircle size={32} /><h3>认识校园里的新朋友</h3><p>登录后查看历史消息，按地区参与聊天。</p><button type="button" disabled={auth.status === 'loading'} onClick={onOpenLogin}><LogIn size={16} /> 登录 / 注册</button></div>
        : <>
        {chat.error && <div className="mobile-chat-error" role="alert"><span>{chat.error}</span><button type="button" onClick={chat.retry}>重试</button></div>}
        {chat.hasMore && <button className="mobile-chat-load-more" type="button" disabled={chat.loadingOlder} onClick={chat.loadOlder}>{chat.loadingOlder ? '加载中…' : '查看更早消息'}</button>}
        {messages.length > 0 ? (
          <ol className="mobile-hall-messages" aria-live="polite">
            {messages.map((message, index) => (
              <li
                className={`mobile-hall-message${message.authorId === auth.user.id ? ' is-own' : ''}`}
                key={message.id}
                ref={index === messages.length - 1 ? lastMessageRef : undefined}
              >
                <article>
                  <header className="mobile-hall-message__header">
                    <span className="mobile-hall-message__avatar" aria-hidden="true">{[...message.author][0]}</span>
                    <strong>{campusDisplayText(message.author)}</strong>
                    <span className="mobile-hall-message__region">{REGION_LABELS.get(message.regionId) ?? '校园'}</span>
                    <time dateTime={message.createdAt}>{message.time}</time>
                  </header>
                  <p>{campusDisplayText(message.content)}</p>
                  {message.authorId === auth.user.id && <button className="mobile-chat-report" type="button" onClick={() => onSubmitAsInformation(message)}>提交为动态</button>}
                  {message.authorId === auth.user.id && <button className="mobile-chat-retract" type="button" disabled={Boolean(retractingId)} onClick={() => retract(message.id)}>{retractingId === message.id ? '撤回中…' : '撤回'}</button>}
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mobile-panel-empty" role="status">{chat.historyStatus === 'loading' ? '正在加载历史消息…' : chat.historyStatus === 'error' ? '历史消息未能加载，请重试。' : '这个区域暂时还没有消息，发一条开启聊天吧。'}</p>
        )}
        </>}
      </section>

      <form className="mobile-hall-composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="mobile-hall-message">输入消息</label>
        <input
          id="mobile-hall-message"
          type="text"
          maxLength={200}
          placeholder={auth.user ? '聊聊校园里的新鲜事…' : '登录后即可发消息'}
          value={draft}
          disabled={!auth.user || sending}
          onChange={(event) => { setDraft(event.target.value); setSendError('') }}
        />
        <div className="mobile-hall-composer__actions">
          <label className="sr-only" htmlFor="mobile-hall-region">消息所属区域</label>
          <select
            id="mobile-hall-region"
            value={composerRegionId}
            disabled={sending}
            onChange={(event) => setComposerRegionId(event.target.value)}
          >
            {COMPOSER_REGIONS.map((region) => <option value={region.id} key={region.id}>{region.label}</option>)}
          </select>
          <button type="submit" disabled={!auth.user || !draft.trim() || sending || chat.connectionStatus === 'offline'}>
            <Send size={15} aria-hidden="true" /> {sending ? '发送中…' : '发送'}
          </button>
        </div>
        {sendError && <p className="mobile-chat-send-error" role="alert">{sendError}</p>}
      </form>
      </>}
    </section>
  )
}
