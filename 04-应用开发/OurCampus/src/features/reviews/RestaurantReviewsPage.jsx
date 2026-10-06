import { campusDisplayText } from '../../data/campusPresentation.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowUpRight, ChevronRight, Leaf, MessageSquare, PenLine, Search, Soup, Star, ThumbsUp, Trash2, UtensilsCrossed, Wheat, X } from 'lucide-react'
import { createLocalRestaurantReview, getExampleWindowReviews, getRestaurantWindows, loadLocalRestaurantReviews, saveLocalRestaurantReviews, summarizeReviews, WINDOW_CATEGORIES } from '../../data/restaurantReviews.js'
import { ReviewComposer } from './ReviewComposer.jsx'
import { RestaurantWindowManager } from './RestaurantWindowManager.jsx'
import { addRestaurantWindow, deleteRestaurantWindow, loadRestaurantWindows } from '../../data/restaurantWindows.js'

function FoodIcon({ type, size = 26 }) {
  const Icon = type === 'noodles' ? Soup : type === 'salad' ? Leaf : type === 'snack' ? Wheat : UtensilsCrossed
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true" />
}

function RatingStars({ rating, size = 12 }) {
  return <span className="restaurant-review-stars" role="img" aria-label={`${rating} 星`}>{[1, 2, 3, 4, 5].map((score) => <span className="restaurant-review-star" key={score} style={{ width: size, height: size }}><Star size={size} aria-hidden="true" /><Star className="restaurant-review-star__fill" size={size} fill="currentColor" style={{ clipPath: `inset(0 ${100 - Math.max(0, Math.min(1, rating - score + 1)) * 100}% 0 0)` }} aria-hidden="true" /></span>)}</span>
}

function ReviewItem({ review, onDelete }) {
  const [helpful, setHelpful] = useState(false)
  const date = review.isExample ? '示例评价' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(review.createdAt))
  return (
    <article className="window-review-item">
      <header>
        <span className="window-review-item__avatar" aria-hidden="true">{[...review.author][0]}</span>
        <div><strong>{campusDisplayText(review.author)}</strong><span>{date}{!review.isExample && ' · 本机发布'}</span></div>
        {review.price !== null && <span className="window-review-item__price">¥{review.price}</span>}
      </header>
      <RatingStars rating={review.rating} />
      <p>{campusDisplayText(review.content)}</p>
      {review.tags.length > 0 && <div className="window-review-item__tags">{review.tags.map((tag) => <span key={tag}>{campusDisplayText(tag)}</span>)}</div>}
      <footer>
        <button type="button" className={helpful ? 'is-active' : ''} aria-pressed={helpful} onClick={() => setHelpful((value) => !value)}><ThumbsUp size={13} />{helpful ? '已标为有用（本次）' : '觉得有用'}</button>
        {!review.isExample && <button type="button" onClick={() => onDelete(review.id)} aria-label="删除这条本机评价"><Trash2 size={13} />删除</button>}
      </footer>
    </article>
  )
}

export function RestaurantReviewsPage({ restaurant, authorName = '我', role = 'visitor', onClose }) {
  const [windows, setWindows] = useState(getRestaurantWindows)
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogError, setCatalogError] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const isManager = role === 'manager'
  const canManage = isManager && catalogState === 'ready'
  const examples = useMemo(() => getExampleWindowReviews(restaurant.id), [restaurant.id])
  const [localReviews, setLocalReviews] = useState(loadLocalRestaurantReviews)
  const [selectedWindowId, setSelectedWindowId] = useState(null)
  const [composerWindowId, setComposerWindowId] = useState(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [sort, setSort] = useState('recent')
  const [notice, setNotice] = useState('')
  const pageRef = useRef(null)
  const contentRef = useRef(null)
  const backRef = useRef(null)
  const selectedWindow = windows.find((window) => window.id === selectedWindowId) ?? null
  const restaurantLocalReviews = localReviews.filter((review) => review.restaurantId === restaurant.id && windows.some((window) => window.id === review.windowId))
  const allReviews = [...restaurantLocalReviews, ...examples.filter((review) => windows.some((window) => window.isExample && window.id === review.windowId))]
  const summary = summarizeReviews(allReviews)
  const windowReviews = selectedWindow ? allReviews.filter((review) => review.windowId === selectedWindow.id) : []
  const windowSummary = summarizeReviews(windowReviews)
  const visibleWindows = windows.filter((window) => (category === '全部' || window.category === category) && `${window.number}号${window.name}${window.category}`.includes(query.trim()))
  const visibleReviews = windowReviews.filter((review) => reviewFilter === 'all' || (reviewFilter === 'recommend' ? review.rating >= 4 : review.rating <= 3))
    .sort((a, b) => (sort === 'high' ? b.rating - a.rating : sort === 'low' ? a.rating - b.rating : 0) || Number(a.isExample) - Number(b.isExample) || Date.parse(b.createdAt) - Date.parse(a.createdAt))

  useEffect(() => {
    let active = true
    loadRestaurantWindows(restaurant.id).then((next) => {
      if (active) { setWindows(next); setCatalogState('ready') }
    }).catch((error) => { if (active) { setCatalogState('unavailable'); setCatalogError(error.message) } })
    return () => { active = false }
  }, [restaurant.id])
  useEffect(() => { if (!isManager) { setManagerOpen(false); setDeleteTarget(null) } }, [isManager])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    backRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus?.()
    }
  }, [])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
    if (!composerWindowId) backRef.current?.focus()
  }, [selectedWindowId])

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (managerOpen || deleteTarget) return // 管理表单在保存期间保持打开，使用其关闭按钮。
        if (composerWindowId) setComposerWindowId(null)
        else if (selectedWindowId) setSelectedWindowId(null)
        else onClose()
        return
      }
      if (event.key !== 'Tab') return
      const scope = pageRef.current?.querySelector('[data-review-composer]') ?? pageRef.current
      const focusable = [...(scope?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? [])]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [composerWindowId, selectedWindowId, managerOpen, deleteTarget, onClose])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  const selectWindow = (id) => { setSelectedWindowId(id); setReviewFilter('all'); setSort('recent') }
  const submitReview = (draft) => {
    if (!windows.some((window) => window.id === draft.windowId)) throw new Error('这个窗口已经移除，请重新选择')
    const review = createLocalRestaurantReview({ ...draft, restaurantId: restaurant.id, author: authorName })
    const next = [review, ...localReviews]
    saveLocalRestaurantReviews(next)
    setLocalReviews(next)
    selectWindow(draft.windowId)
    setComposerWindowId(null)
    setNotice('评价已保存到本机')
  }
  const deleteReview = (id) => {
    try {
      const next = localReviews.filter((review) => review.id !== id)
      saveLocalRestaurantReviews(next)
      setLocalReviews(next)
      setNotice('本机评价已删除')
    } catch (error) { setNotice(error.message) }
  }
  const submitWindow = async (draft) => {
    if (!canManage) throw new Error('请使用管理员账号，并确认窗口管理已开通')
    if (deleteTarget) {
      await deleteRestaurantWindow(restaurant.id, deleteTarget.id)
      setWindows((current) => current.filter((window) => window.id !== deleteTarget.id))
      if (selectedWindowId === deleteTarget.id) setSelectedWindowId(null)
      setDeleteTarget(null); setNotice('窗口已从服务器删除')
    } else {
      const added = await addRestaurantWindow(restaurant.id, draft)
      setWindows((current) => [...current, added].sort((a, b) => a.number.localeCompare(b.number, 'zh-CN', { numeric: true })))
      setManagerOpen(false); setQuery(''); setCategory('全部'); setNotice('窗口已添加，其他手机重新打开即可看到')
    }
  }

  return createPortal(
    <section className="restaurant-review-page" ref={pageRef} role="dialog" aria-modal="true" aria-labelledby="restaurant-review-page-title">
      <div className="restaurant-review-page__frame">
        <header className="restaurant-review-page__header">
          <button type="button" ref={backRef} onClick={() => selectedWindow ? setSelectedWindowId(null) : onClose()} aria-label={selectedWindow ? '返回窗口列表' : '返回上一页'}><ArrowLeft size={21} /></button>
          <div><h1 id="restaurant-review-page-title">{selectedWindow ? '窗口详情' : '餐厅评价'}</h1><span>{restaurant.name}</span></div>
          <span className="restaurant-review-page__preview">{isManager ? '管理员' : '校园食记'}</span>
        </header>

        <main className="restaurant-review-page__content" ref={contentRef}>
          {!selectedWindow ? <>
            <section className="restaurant-review-hero">
              <span className="restaurant-review-hero__eyebrow">校园食记 / WINDOW GUIDE</span>
              <h2>{restaurant.name}</h2><p>挑个窗口，看看同学怎么说。</p>
              <div className="restaurant-review-hero__art" aria-hidden="true"><Soup size={56} strokeWidth={1.35} /><span>一餐一评</span></div>
              <div className="restaurant-review-hero__stats">
                <div><strong>{summary.rating ?? '—'}<Star size={14} fill="currentColor" /></strong><span>评分预览</span></div>
                <div><strong>{windows.length}<small> 个</small></strong><span>餐厅窗口</span></div>
                <div><strong>{restaurantLocalReviews.length}<small> 条</small></strong><span>本机评价</span></div>
              </div>
            </section>
            <p className="restaurant-review-page__demo-note"><span />{catalogState === 'loading' ? '正在加载餐厅窗口…' : catalogState === 'ready' ? '窗口名单由管理员维护；评价暂存本机。' : '暂时展示示例窗口，真实窗口名单尚未加载。'}</p>
            {isManager && <div className="restaurant-window-admin"><div><strong>窗口管理</strong><small>{catalogState === 'ready' ? '按真实名单添加窗口' : catalogError || '正在连接服务器…'}</small></div><button type="button" disabled={!canManage} onClick={() => setManagerOpen(true)}>＋ 添加窗口</button></div>}
            <div className="restaurant-window-search"><Search size={17} /><input aria-label="搜索餐厅窗口" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜窗口编号、面食、米饭…" />{query && <button type="button" aria-label="清空窗口搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
            <div className="restaurant-window-categories" role="group" aria-label="窗口分类">{WINDOW_CATEGORIES.map((item) => <button key={item} type="button" className={category === item ? 'is-active' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <div className="restaurant-review-section-heading"><h3>逛逛窗口</h3><span>{visibleWindows.length} 个选择</span></div>
            <div className="restaurant-window-grid">
              {visibleWindows.map((window) => {
                const windowReviews = allReviews.filter((review) => review.windowId === window.id)
                const stats = summarizeReviews(windowReviews)
                return <button type="button" key={window.id} className={`restaurant-window-card restaurant-window-card--${window.tone}`} onClick={() => selectWindow(window.id)}>
                  <div className="restaurant-window-card__art"><span>{window.number}<small>号窗口</small></span><FoodIcon type={window.icon} size={42} />{window.isExample && <i>示例</i>}</div>
                  <div className="restaurant-window-card__body"><h4>{window.name}<ArrowUpRight size={15} /></h4><div className="restaurant-window-card__rating"><Star size={12} fill="currentColor" /><strong>{stats.rating ?? '—'}</strong><span>{stats.count} 条评价</span></div><p>{window.dish}</p><div className="restaurant-window-card__bottom"><span>{window.category}</span><span>{stats.price !== null ? `${window.isExample ? '参考样例' : '人均'} ¥${stats.price}` : '暂无价格'}</span></div></div>
                </button>
              })}
            </div>
            {!visibleWindows.length && <div className="restaurant-reviews-empty"><Search size={27} /><strong>{windows.length ? '没有找到这个窗口' : '还没有收录窗口'}</strong><p>{windows.length ? '试试窗口编号或其他分类。' : isManager ? '点击上方“添加窗口”，录入真实名单。' : '管理员收录真实窗口后，就可以查看和评价了。'}</p>{windows.length > 0 && <button type="button" onClick={() => { setQuery(''); setCategory('全部') }}>查看全部窗口</button>}</div>}
            <p className="restaurant-review-page__bottom-note">窗口按餐厅分别收录。</p>
          </> : <>
            <section className={`restaurant-window-intro restaurant-window-intro--${selectedWindow.tone}`}><div className="restaurant-window-intro__icon"><FoodIcon type={selectedWindow.icon} size={34} /></div><div><span>{selectedWindow.number} 号窗口{selectedWindow.isExample && ' · 示例'}</span><h2>{selectedWindow.name}</h2><p>{selectedWindow.description}</p></div></section>
            {canManage && !selectedWindow.isExample && <button className="restaurant-window-delete" type="button" onClick={() => setDeleteTarget(selectedWindow)}><Trash2 size={15} />删除这个窗口</button>}
            <section className="restaurant-window-score"><div><strong>{windowSummary.rating ?? '—'}</strong><RatingStars rating={Number(windowSummary.rating ?? 0)} size={14} /><span>{windowSummary.count} 条评价</span></div><div className="restaurant-window-score__details"><span><b>{windowSummary.recommended}%</b> 推荐评价占比</span><div><i style={{ width: `${windowSummary.recommended}%` }} /></div><small>{selectedWindow.isExample ? '统计包含示例内容，仅用于体验页面' : '统计仅包含当前设备保存的评价'}</small></div></section>
            <p className="restaurant-review-page__demo-note"><span />{selectedWindow.isExample ? '示例评价不代表真实口碑；本机发布仅当前设备可见。' : '评价暂存本机，仅当前设备可见。'}</p>
            <div className="restaurant-review-section-heading"><h3>同学怎么说</h3><select aria-label="评价排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">最新评价</option><option value="high">评分从高到低</option><option value="low">评分从低到高</option></select></div>
            <div className="restaurant-review-filters" role="group" aria-label="评价筛选">{[{ id: 'all', label: '全部' }, { id: 'recommend', label: '推荐 · 4–5 星' }, { id: 'complaint', label: '吐槽 · 1–3 星' }].map((filter) => <button type="button" key={filter.id} className={reviewFilter === filter.id ? 'is-active' : ''} aria-pressed={reviewFilter === filter.id} onClick={() => setReviewFilter(filter.id)}>{filter.label}</button>)}</div>
            <div className="window-review-list">{visibleReviews.map((review) => <ReviewItem key={review.id} review={review} onDelete={deleteReview} />)}</div>
            {!visibleReviews.length && <div className="restaurant-reviews-empty"><MessageSquare size={28} /><strong>这里还没有这类评价</strong><p>吃过这个窗口？写下你的感受吧。</p></div>}
          </>}
        </main>

        <footer className="restaurant-review-page__footer"><span>{selectedWindow ? `${selectedWindow.number} 号 · ${selectedWindow.name}` : '好吃的推荐，真实的感受'}<small>评价暂存本机</small></span><button type="button" disabled={!windows.length || catalogState === 'loading'} onClick={() => setComposerWindowId(selectedWindow?.id ?? windows[0]?.id)}><PenLine size={17} />写评价<ChevronRight size={15} /></button></footer>
        {notice && <p className="restaurant-review-page__notice" role="status">{notice}</p>}
        {composerWindowId && <ReviewComposer restaurant={restaurant} windows={windows} initialWindowId={composerWindowId} onClose={() => setComposerWindowId(null)} onSubmit={submitReview} />}
        {(managerOpen || deleteTarget) && isManager && <RestaurantWindowManager restaurant={restaurant} deletingWindow={deleteTarget} onClose={() => { setManagerOpen(false); setDeleteTarget(null) }} onSubmit={submitWindow} />}
      </div>
    </section>, document.body,
  )
}
