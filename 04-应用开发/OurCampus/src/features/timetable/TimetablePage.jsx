import { campusDisplayText } from '../../data/campusPresentation.js'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, FileUp, MapPin, Sparkles } from 'lucide-react'
import { importTimetableFile } from '../../data/timetableImport.js'
import { canUseCalendar, coursesForWeek, createTimetablePrompt, currentTeachingWeek, dateAnchor, DAY_NAMES, loadTimetable, saveTimetable, scheduleConflicts, weekStartLabel } from '../../data/timetable.js'
import './timetable.css'

function weeksText(weeks) {
  const parts = []
  let start = weeks[0], previous = start
  for (const value of [...weeks.slice(1), Infinity]) {
    if (value === previous + 1) { previous = value; continue }
    parts.push(start === previous ? String(start) : `${start}–${previous}`); start = previous = value
  }
  return parts.join('、')
}

export function TimetablePage({ userId, onClose, onAskAi }) {
  const [timetable, setTimetable] = useState(() => loadTimetable(userId))
  const [preview, setPreview] = useState(null)
  const [week, setWeek] = useState(() => currentTeachingWeek(loadTimetable(userId)))
  const [startDate, setStartDate] = useState(() => loadTimetable(userId)?.termStart || '2026-08-30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileRef = useRef(null), backRef = useRef(null), frameRef = useRef(null), requestRef = useRef(0)
  const shown = preview || timetable
  const weekCourses = coursesForWeek(shown, week)
  const conflicts = shown ? scheduleConflicts(shown) : new Set()
  const subjectCount = new Set(shown?.courses.map((course) => course.name) ?? []).size
  const maxWeek = Math.max(16, ...(shown?.courses.flatMap((course) => course.weeks) ?? []))
  const goBack = () => { if (!busy) { if (preview) setPreview(null); else onClose() } }
  useBackLayer(true, goBack, 70)

  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; backRef.current?.focus()
    const key = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = [...frameRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled):not([type=file]),select:not(:disabled)')]
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { requestRef.current++; window.removeEventListener('keydown', key); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus?.() }
  }, [onClose])

  const readFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const version = ++requestRef.current
    setBusy(true); setError(''); setNotice('')
    try {
      const parsed = await importTimetableFile(file)
      if (version !== requestRef.current) return
      setPreview(parsed); setStartDate(parsed.termStart || ''); setWeek(1)
    } catch (failure) { if (version === requestRef.current) setError(failure.message || '课表读取失败，请重新选择文件') }
    finally { if (version === requestRef.current) setBusy(false) }
  }
  const confirmImport = () => {
    try {
      saveTimetable(userId, preview)
      setTimetable(preview); setPreview(null); setWeek(currentTeachingWeek(preview)); setError(''); setNotice('课表已导入并保存到本机')
    } catch (failure) { setError(failure.message) }
  }
  const updateDate = (event) => {
    event.preventDefault()
    const anchor = dateAnchor(startDate)
    if (!anchor) { setError('请填写有效的学期起始日期'); return }
    const next = { ...timetable, termStart: startDate, dateConfirmed: anchor.getUTCDay() === 1 }
    try { saveTimetable(userId, next); setTimetable(next); setError(''); setNotice(next.dateConfirmed ? '已更新第一教学周日期' : '已保留这个日期；因不是周一，继续按教学周查看') } catch (failure) { setError(failure.message) }
  }
  const askAi = () => {
    try { onAskAi(createTimetablePrompt(timetable, week)) } catch (failure) { setError(failure.message) }
  }

  return createPortal(<section className="timetable-page" role="dialog" aria-modal="true" aria-labelledby="timetable-title" ref={frameRef}>
    <div className="timetable-frame">
      <header className="timetable-header"><button ref={backRef} type="button" aria-label="返回服务" onClick={goBack} disabled={busy}><ArrowLeft size={21} /></button><div><h1 id="timetable-title">我的课表</h1><span>{shown ? `${shown.semester} · ${preview ? '导入预览' : '本机课表'}` : '把课程安排放进口袋里'}</span></div><button className="timetable-import" type="button" onClick={() => fileRef.current?.click()} disabled={busy}><FileUp size={16} />{busy ? '读取中…' : shown ? '重新导入' : '导入课表'}</button><input className="timetable-file" type="file" accept=".xls,application/vnd.ms-excel" ref={fileRef} onChange={readFile} aria-label="选择教务课表文件" disabled={busy} /></header>
      <main className="timetable-content">
        {error && <p className="timetable-alert" role="alert">{error}</p>}
        {notice && <p className="timetable-notice" role="status">{notice}</p>}
        {!shown ? <section className="timetable-empty"><span><CalendarDays size={40} strokeWidth={1.4} /></span><h2>从一张课表开始</h2><p>导入学校教务导出的学生个人课表，<br />课程、周次和教室会自动整理。</p><button type="button" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={18} />选择 .xls 课表文件</button><small>支持教务学生个人课表导出格式 · 最大 4 MB<br />在本机解析，确认前不替换已有课表</small></section> : <>
          <section className="timetable-overview"><div><span>本学期的学习安排</span><strong>{subjectCount}<small> 门课程</small></strong></div><CalendarDays size={37} strokeWidth={1.3} /><p>{shown.courses.length} 条上课安排 · 支持分周次和同格多课程</p></section>
          {preview ? <section className="timetable-preview-note"><strong>先核对，再导入</strong><p>已识别 {subjectCount} 门有时间的课程和 {preview.unscheduled.length} 门未排具体时间的课程。确认后{timetable ? '替换当前账号在本机的原课表' : '保存到当前账号的本机课表'}。</p><div><button type="button" onClick={() => { setPreview(null); setStartDate(timetable?.termStart || '2026-08-30'); setError('') }}>取消这次导入</button><button type="button" onClick={confirmImport}><Check size={16} />确认导入</button></div></section> : <form className="timetable-date" onSubmit={updateDate}><label htmlFor="timetable-start">第 1 教学周起始日期</label><div><input id="timetable-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /><button type="submit">保存</button></div><p>{canUseCalendar(timetable) ? '已按周一对齐，日期仅按课表计算；临时调课需自行核对。' : `${timetable.termStart || '起始日期'}${dateAnchor(timetable.termStart)?.getUTCDay() === 0 ? '是周日，与“第一周周一”冲突。' : '尚未与周一对齐。'}现按教学周查看，暂不推断今日课程。`}</p></form>}
          {shown.unscheduled.length > 0 && <section className="timetable-warning"><strong>还有课程需要补充时间</strong><p>{shown.unscheduled.map((course) => course.name).join('、')}：原表缺少具体星期、节次或教室，AI 规划时会提醒你确认。</p></section>}
          {conflicts.size > 0 && <p className="timetable-alert">检测到 {conflicts.size} 条课程安排有时间重叠，请核对原课表。</p>}
          <nav className="timetable-week" aria-label="选择教学周"><button type="button" disabled={week === 1} aria-label="上一教学周" onClick={() => setWeek((current) => current - 1)}><ChevronLeft size={19} /></button><div><select aria-label="教学周" value={week} onChange={(event) => setWeek(Number(event.target.value))}>{Array.from({ length: maxWeek }, (_, i) => <option value={i + 1} key={i + 1}>第 {i + 1} 教学周</option>)}</select><span>{weekStartLabel(shown, week)}</span></div><button type="button" disabled={week === maxWeek} aria-label="下一教学周" onClick={() => setWeek((current) => current + 1)}><ChevronRight size={19} /></button></nav>
          {DAY_NAMES.map((day, index) => {
            const courses = weekCourses.filter((course) => course.weekday === index + 1)
            return <section className="timetable-day" key={day}><header><h2>{day}</h2><span>{courses.length ? `${courses.length} 门` : '无已排课程'}</span></header>{courses.map((course) => <article className={`timetable-course${conflicts.has(course.id) ? ' is-conflict' : ''}`} key={course.id}><div className="timetable-course-time"><strong>{course.startTime}</strong><span>{course.endTime}</span><small>{course.periods[0]}–{course.periods[1]} 节</small></div><div className="timetable-course-copy"><h3>{campusDisplayText(course.name)}</h3><p><MapPin size={12} />{campusDisplayText(course.classroom)}</p><span>{campusDisplayText(course.teacher)}</span><small><Clock3 size={11} />第 {weeksText(course.weeks)} 周</small></div></article>)}</section>
          })}
          {preview && <details className="timetable-all"><summary>查看全部 {preview.courses.length} 条上课安排</summary>{preview.courses.map((course) => <p key={course.id}><strong>{campusDisplayText(course.name)}</strong><br />{DAY_NAMES[course.weekday - 1]} {course.startTime}–{course.endTime} · 第 {weeksText(course.weeks)} 周 · {campusDisplayText(course.classroom)}</p>)}</details>}
        </>}
      </main>
      <footer className="timetable-footer"><p>{userId ? '当前账号的课表 · 保存在本机' : '访客课表 · 保存在本机'}<small>切换账号分别保存；课表尚未同步到服务器。</small></p>{timetable && !preview && <button type="button" onClick={askAi}><Sparkles size={16} />让 AI 规划本周</button>}</footer>
    </div>
  </section>, document.body)
}
import { useBackLayer } from '../../app/useBackLayer.js'
