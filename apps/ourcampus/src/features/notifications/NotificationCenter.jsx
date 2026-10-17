import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bell, BellRing, Check, ChevronRight, MapPin, RefreshCw, Send, ShieldCheck, X } from 'lucide-react'
import { requireSupabase } from '../../data/supabaseClient.js'
import { campusDisplayText } from '../../data/campusPresentation.js'
import { INFORMATION_KINDS, PUBLIC_INFORMATION_KINDS, REPORT_STATUS, informationError, newReportId, retryCampusReport, reviewCampusReport, setReportStatus, submitCampusReport } from '../../data/campusInformation.js'
import { CampusPush, disablePushDevice, isAndroidPush } from '../../data/campusPush.js'
import './notifications.css'

const time = (value) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const localTime = (value) => new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const blankDraft = (seed = {}) => ({ clientId: newReportId(), kind: 'notice', title: '', body: '', locationId: '', ...seed })

function ReviewCard({ report, locations, events, onDone, run, busy }) {
  const [title, setTitle] = useState(report.title)
  const [summary, setSummary] = useState(report.analysis?.summary || report.body)
  const [locationId, setLocationId] = useState(report.location_id || report.analysis?.location_id || '')
  const [endAt, setEndAt] = useState(localTime(Date.now() + 4 * 3600000))
  const [scope, setScope] = useState('subscribers')
  const [eventId, setEventId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const related = events.filter((e) => e.locationId === locationId && e.informationKind === report.kind)
  const review = (publish) => run(async () => {
    await reviewCampusReport({ id: report.id, publish, title, summary, locationId, kind: report.kind,
      endAt: publish ? new Date(endAt).toISOString() : null, scope, eventId })
    await onDone()
  }, publish ? '审核通过，通知已写入消息中心；系统推送由后台处理。' : '已拒绝发布。')
  return <section className="information-card information-review">
    <span className="information-tag">{INFORMATION_KINDS[report.kind]} · 待审核</span>
    <h3>{campusDisplayText(report.title)}</h3><p>{campusDisplayText(report.body)}</p>
    <small>原始上报 · {time(report.created_at)}</small>
    {report.analysis?.summary && <p className="information-analysis">AI 草稿（未核实）：{campusDisplayText(report.analysis.summary)}</p>}
    <label>确认标题<input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>确认说明<textarea rows={3} maxLength={1500} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
    <label>确认地点<select value={locationId} onChange={(e) => { setLocationId(e.target.value); setEventId('') }}><option value="">请选择地点</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <label>通知有效至<input type="datetime-local" required value={endAt} onChange={(e) => setEndAt(e.target.value)} /></label>
    {related.length > 0 && <label>关联已有事件<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">创建新事件</option>{related.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select><small>同地点同类型只表示可能相关，请核对后选择。</small></label>}
    {PUBLIC_INFORMATION_KINDS.has(report.kind) ? <p className="information-public-note"><BellRing size={16} />公共通知将发送给所有注册用户。</p>
      : <label>通知范围<select value={scope} onChange={(e) => setScope(e.target.value)}><option value="subscribers">订阅相关地点或类别的用户</option><option value="all">全体注册用户</option></select></label>}
    <label className="information-consent"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已确认地点、内容和有效时间，允许按上述范围发布。</label>
    <div className="information-actions"><button disabled={busy || !confirmed || !locationId || !endAt || !title.trim() || !summary.trim()} onClick={() => review(true)}><ShieldCheck size={15} />确认并发布</button><button disabled={busy} onClick={() => review(false)}>不予发布</button></div>
  </section>
}

export function NotificationCenter({ auth, information, push, locations, onClose, onOpenLogin, onSelectLocation, onPlanRouteToLocation, initialDraft, noticeId }) {
  const [tab, setTab] = useState(initialDraft ? 'publish' : 'messages')
  const [draft, setDraft] = useState(() => blankDraft(initialDraft))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [detail, setDetail] = useState(null)
  const [consent, setConsent] = useState(false)
  const [subscribeLocation, setSubscribeLocation] = useState('')
  const [subscribeKind, setSubscribeKind] = useState('')
  const dialog = useRef(null)
  const userRef = useRef(auth.user?.id); userRef.current = auth.user?.id
  const userId = auth.user?.id
  const manager = auth.role === 'manager'
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.querySelector('button')?.focus()
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const list = [...dialog.current.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,select,a[href]')].filter((n) => n.getClientRects().length)
        const first = list[0]; const last = list.at(-1)
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [onClose])
  useEffect(() => { setDetail(null); setError(''); setSuccess('') }, [userId])
  const run = async (fn, text) => {
    if (busy) return
    const actor = userId
    setBusy(true); setError(''); setSuccess('')
    try { await fn(); if (userRef.current === actor && text) setSuccess(text) }
    catch (e) { if (userRef.current === actor) setError(informationError(e)) }
    finally { setBusy(false) }
  }
  const showNotice = async (notice) => {
    const actor = userId
    if (!notice || notice.recipient_id !== actor) return
    let target = null
    if (notice.related_type === 'event') {
      const { data, error: failed } = await requireSupabase().from('campus_events').select('*').eq('id', notice.related_id).maybeSingle()
      if (failed) throw failed
      target = data
    } else if (['lost-found', 'feedback'].includes(notice.related_type)) {
      const { data, error: failed } = await requireSupabase().from('campus_reports').select('*').eq('id', notice.related_id).maybeSingle()
      if (failed) throw failed
      target = data
    }
    if (userRef.current !== actor) return
    setDetail({ notice, target }); setTab('messages')
    await information.markRead(notice.id)
  }
  useEffect(() => {
    if (!noticeId || !userId || !/^[0-9a-f-]{36}$/i.test(noticeId)) return undefined
    let live = true
    requireSupabase().from('notifications').select('*').eq('id', noticeId).eq('recipient_id', userId).maybeSingle().then(async ({ data, error: failed }) => {
      if (!live) return
      if (failed) { setError(informationError(failed)); return }
      if (!data) { setError('这条通知已移除，或不属于当前账号。'); return }
      try { await showNotice(data) } catch (e) { if (live) setError(informationError(e)) }
    })
    return () => { live = false }
  }, [noticeId, userId])
  const publish = (e) => {
    e.preventDefault()
    run(async () => {
      await submitCampusReport(draft)
      if (userRef.current !== userId) return
      setDraft(blankDraft()); setTab('reports'); await information.refresh()
    }, '信息已保存到云端，后台分析完成后会更新状态。公共通知需要管理员确认。')
  }
  const subscribe = (e) => {
    e.preventDefault()
    run(async () => {
      const { error: failed } = await requireSupabase().from('campus_subscriptions').insert({ location_id: subscribeLocation, kind: subscribeKind })
      if (failed && failed.code !== '23505') throw failed
      await information.refresh()
    }, '订阅已保存。施工、封路和停水停电通知仍会面向所有注册用户。')
  }
  const reports = information.reports.filter((r) => r.author_id === userId)
  const pending = information.reports.filter((r) => ['submitted', 'analyzed'].includes(r.status) && !['lost', 'found'].includes(r.kind))
  return <div className="information-page" role="dialog" aria-modal="true" aria-labelledby="information-title" ref={dialog}>
    <div className="information-frame">
      <header><button aria-label="返回" onClick={onClose}><ArrowLeft size={20} /></button><div><small>OURCAMPUS</small><h2 id="information-title">消息与校园信息</h2></div><button aria-label="刷新消息" disabled={busy} onClick={() => run(information.refresh)}><RefreshCw size={18} /></button></header>
      <nav aria-label="消息中心分页">{[{ id: 'messages', text: `消息${information.unread ? ` ${information.unread}` : ''}` }, { id: 'publish', text: '发布' }, { id: 'reports', text: '我的上报' }, { id: 'subscriptions', text: '订阅' }, ...(manager ? [{ id: 'review', text: `审核 ${pending.length}` }] : [])].map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setDetail(null); setSuccess('') }}>{t.text}</button>)}</nav>
      <div className="information-scroll">
        {!userId ? <section className="information-empty"><Bell size={38} /><h3>登录后接收校园通知</h3><p>查看校园动态、订阅地点，开启手机系统通知。</p><button onClick={onOpenLogin}>登录 / 注册</button></section> : <>
          {(error || information.error) && <p className="information-error" role="alert">{error || information.error}</p>}
          {success && <p className="information-success" role="status">{success}</p>}
          {information.status === 'loading' && <p role="status">正在连接校园信息服务…</p>}
          {tab === 'messages' && <>
            <section className="information-push"><BellRing size={24} /><div><h3>不打开软件，也能收到提醒</h3><p>{!isAndroidPush() ? '系统通知请在安卓 APK 中开启。' : !push.status.configured ? '当前安装包尚未填入个推 AppID。配置推送应用后重新打包即可启用。' : push.status.enabled && push.status.permission === 'granted' ? (push.status.cid ? '设备已开启系统通知；服务端推送仍需配置。' : '正在获取设备推送标识…') : '允许通知后，公共校园消息可显示在手机通知栏。'}</p></div></section>
            {isAndroidPush() && push.status.configured && <section className="information-card">
              <p className="information-small">开启后个推处理设备标识、机型等信息以投递通知。校园推送接口不发送课表或应用定位坐标，并关闭 SDK 的智能、应景与应急推送。<a href="https://www.getui.com/privacy" target="_blank" rel="noreferrer">查看个推隐私政策</a></p>
              <label className="information-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />同意使用推送服务接收校园通知</label>
              <div className="information-actions"><button disabled={!consent || push.busy} onClick={push.enable}>开启系统通知</button><button disabled={busy} onClick={() => run(async () => { await disablePushDevice(); await push.refresh() }, '已停用本设备系统推送，站内消息继续保留。')}>关闭</button><button onClick={() => CampusPush.openSettings()}>系统设置</button></div>
              {push.error && <p className="information-error">{push.error}</p>}
            </section>}
            {detail ? <section className="information-card"><button className="information-text-button" onClick={() => setDetail(null)}>返回消息列表</button><h3>{campusDisplayText(detail.notice.title)}</h3><p>{campusDisplayText(detail.target?.impact ?? detail.target?.body ?? detail.notice.body)}</p><small>{time(detail.notice.created_at)}</small>{detail.target?.status && <p className="information-tag">{REPORT_STATUS[detail.target.status] ?? (detail.target.status === 'closed' ? '通知已结束' : Date.parse(detail.target.end_at) <= Date.now() ? '通知已过期' : '有效通知')}</p>}{detail.target?.details?.contact && <p>联系 / 领取方式：{campusDisplayText(detail.target.details.contact)}</p>}{detail.target?.location_id && <div className="information-actions"><button onClick={() => onSelectLocation(detail.target.location_id)}><MapPin size={15} />查看地点</button><button onClick={() => onPlanRouteToLocation(detail.target.location_id)}>导航到这里</button></div>}</section>
              : <><div className="information-list-heading"><span>校园提醒</span><button disabled={busy || !information.unread} onClick={() => run(() => information.markRead(), '已全部标为已读')}>全部已读</button></div>
                {!information.notices.length && information.status === 'ready' && <div className="information-empty"><Bell size={36} /><h3>暂时没有新通知</h3><p>公共施工通知、订阅更新和可能匹配的失物信息会出现在这里。</p></div>}
                {information.notices.map((n) => <button className={`information-notice${n.read_at ? '' : ' unread'}`} key={n.id} disabled={busy} onClick={() => run(() => showNotice(n))}><span className="information-notice-icon"><Bell size={19} /></span><span><strong>{campusDisplayText(n.title)}</strong><p>{campusDisplayText(n.body)}</p><small>{time(n.created_at)}</small></span><ChevronRight size={17} /></button>)}
                {information.more && <button className="information-text-button" disabled={busy} onClick={() => run(information.loadMore)}>查看更早消息</button>}
              </>}
          </>}
          {tab === 'publish' && <form className="information-card information-form" onSubmit={publish}><span className="information-eyebrow">让信息连接到校园</span><h3>发布一条校园信息</h3><p>信息先入库，再由后台分析。施工、封路、停水停电审核后给所有注册用户发通知。</p><label>信息类型<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{Object.entries(INFORMATION_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>标题<input required maxLength={80} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：东侧道路正在施工" /></label><label>地点<select value={draft.locationId} onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}><option value="">由描述匹配，或手动选择</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>说明<textarea required rows={5} maxLength={1500} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="发生了什么、何时看到、影响哪些位置？只写你知道的情况。" /></label>{draft.sourceMessageId && <small>来自你主动提交的大厅消息，普通聊天不会自动送给 AI。</small>}<button className="information-primary" disabled={busy || information.status !== 'ready'}><Send size={16} />{busy ? '提交中…' : '提交到云端分析'}</button></form>}
          {tab === 'reports' && <><div className="information-list-heading"><span>最近的上报</span><button onClick={() => setTab('publish')}>发布信息</button></div>{!reports.length && <p className="information-empty">暂时没有云端上报。原有本机发布仍保留在大厅。</p>}{reports.map((r) => <section className="information-card" key={r.id}><span className="information-tag">{INFORMATION_KINDS[r.kind]} · {r.analysis_status === 'failed' && r.status === 'submitted' ? '分析失败，可重试' : REPORT_STATUS[r.status]}</span><h3>{campusDisplayText(r.title)}</h3><p>{campusDisplayText(r.body)}</p>{r.analysis?.summary && <p className="information-analysis">AI 草稿：{campusDisplayText(r.analysis.summary)}<small>用户上报，尚未自动核实。</small></p>}{r.related_event_id && <small>发现同地点同类型的已有事件，管理员会核对关联。</small>}{r.related_report_id && <small>存在可能匹配的失物信息，请到消息列表核对。</small>}<small>{time(r.created_at)}</small><div className="information-actions">{r.analysis_status === 'failed' && r.status === 'submitted' && <button disabled={busy} onClick={() => run(async () => { await retryCampusReport(r.id); await information.refresh() }, '已重新加入分析队列')}>重试分析</button>}{['submitted', 'analyzed'].includes(r.status) && <button disabled={busy} onClick={() => run(async () => { await setReportStatus(r.id, 'withdrawn'); await information.refresh() }, '已撤回，上报不再进入后续匹配')}>撤回</button>}{['lost', 'found', 'repair'].includes(r.kind) && ['submitted', 'analyzed', 'published'].includes(r.status) && <button disabled={busy} onClick={() => run(async () => { await setReportStatus(r.id, 'resolved'); await information.refresh() }, '已标记完成')}>标记完成</button>}</div></section>)}</>}
          {tab === 'subscriptions' && <><section className="information-card"><h3>只接收与你相关的信息</h3><p>按地点和类型订阅；公共施工、封路和停水停电通知自动面向全体注册用户。</p><form onSubmit={subscribe}><label>地点<select value={subscribeLocation} onChange={(e) => setSubscribeLocation(e.target.value)}><option value="">全部地点</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>类别<select value={subscribeKind} onChange={(e) => setSubscribeKind(e.target.value)}><option value="">全部类别</option>{Object.entries(INFORMATION_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="information-primary" disabled={busy || information.status !== 'ready'}><Check size={16} />保存订阅</button></form></section>{information.subscriptions.map((s) => <div className="information-subscription" key={`${s.location_id}:${s.kind}`}><span>{locations.find((l) => l.id === s.location_id)?.name ?? '全部地点'} · {INFORMATION_KINDS[s.kind] ?? '全部类别'}</span><button aria-label="取消此订阅" disabled={busy} onClick={() => run(async () => { const { error: failed } = await requireSupabase().from('campus_subscriptions').delete().eq('user_id', userId).eq('location_id', s.location_id).eq('kind', s.kind); if (failed) throw failed; await information.refresh() }, '已取消订阅')}><X size={16} /></button></div>)}</>}
          {tab === 'review' && manager && <><p className="information-small">AI 只生成草稿。请确认现场信息和有效时间；施工等公共通知将全员发送。最近显示 100 条上报。</p>{pending.map((r) => <ReviewCard key={r.id} report={r} locations={locations} events={information.events} onDone={information.refresh} busy={busy} run={run} />)}{!pending.length && <p className="information-empty">没有待审核信息。</p>}{information.events.map((e) => <section className="information-card" key={e.id}><span className="information-tag">{e.informationScope === 'all' ? '全员通知' : '订阅通知'}</span><h3>{e.title}</h3><p>{e.impact}</p><button disabled={busy} onClick={() => run(async () => { const { error: failed } = await requireSupabase().rpc('campus_close_information_event', { p_id: e.id }); if (failed) throw failed; await information.refresh() }, '事件已结束，更新通知已加入队列')}>确认事件结束</button></section>)}</>}
        </>}
      </div>
    </div>
  </div>
}
