import { useCallback, useEffect, useRef, useState } from 'react'
import { describeServerError, requireSupabase, supabase } from '../../data/supabaseClient.js'

const authLink = new URLSearchParams(window.location.hash.slice(1))
const startsInRecovery = authLink.get('type') === 'recovery' && Boolean(authLink.get('access_token'))

export function useCampusAuth() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [role, setRole] = useState('visitor')
  const [status, setStatus] = useState(supabase ? 'loading' : 'unconfigured')
  const [error, setError] = useState('')
  const [recoveryRequested, setRecoveryRequested] = useState(startsInRecovery)
  const userId = session?.user?.id ?? null
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  useEffect(() => {
    if (!supabase) return undefined
    let disposed = false
    let eventReceived = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (disposed) return
      eventReceived = true
      setSession(nextSession)
      setStatus('ready')
      setError('')
      if (event === 'PASSWORD_RECOVERY') setRecoveryRequested(true)
    })
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (disposed || eventReceived) return
      if (sessionError) {
        setError(describeServerError(sessionError, '登录状态恢复失败，请重新登录'))
        setStatus('error')
      } else {
        setSession(data.session)
        setStatus('ready')
      }
    }).catch(() => {
      if (!disposed && !eventReceived) {
        setError('网络连接失败，请重新登录')
        setStatus('error')
      }
    })
    return () => { disposed = true; subscription.unsubscribe() }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!supabase || !userId) return
    const [profileResult, roleResult] = await Promise.all([
      supabase.from('profiles').select('user_id,nickname,avatar_path').eq('user_id', userId).single(),
      supabase.rpc('campus_my_role'),
    ])
    if (userIdRef.current !== userId) return
    setRole(!roleResult.error && ['student', 'manager'].includes(roleResult.data) ? roleResult.data : 'visitor')
    if (profileResult.error || roleResult.error) {
      setError(describeServerError(profileResult.error ?? roleResult.error, '个人资料加载失败，请重试'))
      return
    }
    setProfile(profileResult.data)
    setError('')
  }, [userId])

  useEffect(() => {
    setProfile(null)
    setRole('visitor')
    if (userId) refreshProfile().catch(() => {
      if (userIdRef.current === userId) setError('个人资料加载失败，请检查网络')
    })
  }, [userId, refreshProfile])

  const login = async ({ email, password }) => {
    const { data, error: authError } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password })
    if (authError) throw authError
    return data
  }
  const register = async ({ email, password, nickname }) => {
    const { data, error: authError } = await requireSupabase().auth.signUp({
      email: email.trim(), password, options: { data: { nickname: nickname.trim() } },
    })
    if (authError) throw authError
    return data
  }
  const confirmEmail = async ({ email, token, type = 'email' }) => {
    const { data, error: authError } = await requireSupabase().auth.verifyOtp({ email: email.trim(), token: token.trim(), type })
    if (authError) throw authError
    if (type === 'recovery') setRecoveryRequested(true)
    return data
  }
  const resendConfirmation = async (email) => {
    const { error: authError } = await requireSupabase().auth.resend({ type: 'signup', email: email.trim() })
    if (authError) throw authError
  }
  const requestPasswordReset = async (email) => {
    const { error: authError } = await requireSupabase().auth.resetPasswordForEmail(email.trim())
    if (authError) throw authError
  }
  const updatePassword = async (password) => {
    const { error: authError } = await requireSupabase().auth.updateUser({ password })
    if (authError) throw authError
    setRecoveryRequested(false)
  }
  const logout = async () => {
    const { error: authError } = await requireSupabase().auth.signOut({ scope: 'local' })
    if (authError) throw authError
    setSession(null)
    setProfile(null)
    setRole('visitor')
    setRecoveryRequested(false)
  }
  const updateNickname = async (nickname) => {
    const value = nickname.trim()
    if (!value || [...value].length > 40) throw new Error('昵称请填写 1–40 个字')
    const { data, error: profileError } = await requireSupabase().from('profiles')
      .update({ nickname: value }).eq('user_id', userId).select('user_id,nickname,avatar_path').single()
    if (profileError) throw profileError
    if (userIdRef.current === userId) setProfile(data)
  }

  return {
    user: session?.user ?? null,
    profile: profile?.user_id === userId ? profile : null,
    role: profile?.user_id === userId ? role : 'visitor',
    status, error, recoveryRequested,
    login, register, confirmEmail, resendConfirmation, requestPasswordReset,
    updatePassword, logout, updateNickname, refreshProfile,
  }
}
