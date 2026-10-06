import { useCallback, useEffect, useRef, useState } from 'react'
import { describeServerError, supabase } from '../../data/supabaseClient.js'
import { createClientMessageId, hydrateHallMessages, listHallMessages, mergeHallMessages, retractHallMessage, sendHallMessage } from '../../data/hallService.js'

const EMPTY_STATE = { messages: [], historyStatus: 'idle', connectionStatus: 'idle', error: '', hasMore: false, loadingOlder: false }

export function useRealtimeHall({ userId, regionId }) {
  const identity = `${userId ?? 'guest'}:${regionId}`
  const [state, setState] = useState({ ...EMPTY_STATE, identity })
  const connectionRef = useRef(null)
  const sendAttempt = useRef(null)

  useEffect(() => { sendAttempt.current = null }, [userId])
  useEffect(() => {
    setState({ ...EMPTY_STATE, identity, historyStatus: userId ? 'loading' : 'idle', connectionStatus: userId ? 'connecting' : 'idle' })
    if (!userId || !supabase) { connectionRef.current = null; return undefined }

    let disposed = false
    let cursor = null
    let realtimeConnected = false
    let loadingOlder = false
    let refreshTimer
    let latestRequestId = 0
    let eventVersion = 0
    let resetVersion = 0
    let resetRequested = false
    const liveUpdates = new Map()
    const removedIds = new Set()
    const update = (changes) => {
      if (!disposed) setState((current) => ({ ...current, ...changes }))
    }
    const merge = (messages, reset = false) => {
      if (!disposed) setState((current) => ({ ...current, messages: mergeHallMessages(reset ? [] : current.messages, messages, removedIds) }))
    }
    const refresh = async (reset = false) => {
      if (disposed) return
      const requestId = ++latestRequestId
      const snapshotVersion = eventVersion
      resetRequested = resetRequested || reset
      if (reset) resetVersion += 1
      try {
        const page = await listHallMessages({ regionId })
        if (disposed || requestId !== latestRequestId) return
        const afterSnapshot = [...liveUpdates.values()].filter((entry) => entry.version > snapshotVersion).map((entry) => entry.message)
        merge(mergeHallMessages(page.messages, afterSnapshot, removedIds), resetRequested)
        if (resetRequested || !cursor) {
          cursor = page.before
          update({ hasMore: page.hasMore })
        }
        resetRequested = false
        for (const [id, entry] of liveUpdates) if (entry.version <= snapshotVersion) liveUpdates.delete(id)
        update({ historyStatus: 'ready', error: '' })
      } catch (error) {
        if (!disposed && requestId === latestRequestId) update({ historyStatus: 'error', error: describeServerError(error, '历史消息加载失败，请重试') })
      }
    }
    const loadOlder = async () => {
      if (disposed || loadingOlder || !cursor) return
      loadingOlder = true
      const paginationVersion = resetVersion
      update({ loadingOlder: true, error: '' })
      try {
        const page = await listHallMessages({ regionId, before: cursor })
        if (disposed || paginationVersion !== resetVersion) return
        cursor = page.before
        merge(page.messages)
        update({ hasMore: page.hasMore })
      } catch (error) {
        update({ error: describeServerError(error, '更早消息加载失败，请重试') })
      } finally {
        loadingOlder = false
        update({ loadingOlder: false })
      }
    }
    const handleChange = (payload) => {
      const version = ++eventVersion
      const row = payload.new
      if (payload.eventType === 'DELETE') {
        if (payload.old?.id) removedIds.add(payload.old.id)
        merge([])
        return
      }
      if (!row?.id) return
      if (row.deleted_at) {
        removedIds.add(row.id)
        merge([])
        return
      }
      hydrateHallMessages([row]).then((messages) => {
        if (disposed) return
        for (const message of messages) {
          if ((liveUpdates.get(message.id)?.version ?? 0) < version) liveUpdates.set(message.id, { message, version })
        }
        merge(messages)
      }).catch(() => {
        if (disposed) return
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => refresh(), 500)
      })
    }
    // Subscribe before reading history so the initial snapshot has no gap.
    const filter = { event: '*', schema: 'public', table: 'hall_messages' }
    if (regionId !== 'all') filter.filter = `region_id=eq.${regionId}`
    const channel = supabase.channel(`campus-hall:${userId}:${regionId}`)
      .on('postgres_changes', filter, handleChange)
      .subscribe((status) => {
        if (disposed) return
        realtimeConnected = status === 'SUBSCRIBED'
        if (realtimeConnected) {
          update({ connectionStatus: 'live' })
          refresh(true)
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          update({ connectionStatus: navigator.onLine ? 'reconnecting' : 'offline' })
        }
      })
    connectionRef.current = {
      identity, loadOlder, refresh,
      merge: (messages) => {
        for (const message of messages) liveUpdates.set(message.id, { message, version: ++eventVersion })
        merge(messages)
      },
    }
    refresh(true)

    const online = () => { update({ connectionStatus: realtimeConnected ? 'live' : 'reconnecting' }); refresh(true) }
    const offline = () => update({ connectionStatus: 'offline' })
    const resume = () => { if (document.visibilityState === 'visible') refresh(true) }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', resume)
    // Polling repairs missed events and supplies history even if Realtime is unavailable.
    const poll = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') refresh() }, 30000)
    return () => {
      disposed = true
      latestRequestId += 1
      clearInterval(poll)
      clearTimeout(refreshTimer)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', resume)
      if (connectionRef.current?.identity === identity) connectionRef.current = null
      supabase.removeChannel(channel)
    }
  }, [identity, userId, regionId])

  const sendMessage = useCallback(async ({ content, regionId: targetRegion }) => {
    if (!userId) throw new Error('请先登录后发消息')
    if (!navigator.onLine) throw new Error('当前离线，草稿已保留，请联网后重试')
    const text = content.trim()
    if (sendAttempt.current?.userId !== userId || sendAttempt.current?.content !== text || sendAttempt.current?.regionId !== targetRegion) {
      sendAttempt.current = { userId, content: text, regionId: targetRegion, clientMessageId: createClientMessageId() }
    }
    const attempt = sendAttempt.current
    const message = await sendHallMessage({ ...attempt, authorId: userId })
    if (connectionRef.current?.identity === identity && (regionId === 'all' || targetRegion === regionId)) connectionRef.current.merge([message])
    if (sendAttempt.current === attempt) sendAttempt.current = null
    return message
  }, [userId, identity, regionId])

  const retractMessage = async (id) => {
    if (!userId) throw new Error('请先登录')
    await retractHallMessage(id, userId)
    if (connectionRef.current?.identity === identity) connectionRef.current.refresh(true)
  }
  return {
    ...(state.identity === identity ? state : { ...EMPTY_STATE, historyStatus: userId ? 'loading' : 'idle' }),
    sendMessage, retractMessage,
    loadOlder: () => connectionRef.current?.loadOlder(),
    retry: () => connectionRef.current?.refresh(true),
  }
}
