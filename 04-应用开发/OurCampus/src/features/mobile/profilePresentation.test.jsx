import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HallPanel } from './HallPanel.jsx'
import { PersonalHome } from './PersonalHome.jsx'

vi.mock('../../app/useBackLayer.js', () => ({ useBackLayer: () => {}, requestAppBack: () => {} }))
const userId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const avatarUrl = 'https://example.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg'
const hallProps = {
  messages: [{ id: 'message-1', authorId, author: '白云同学', authorAvatarUrl: avatarUrl, content: '你好', regionId: 'living', createdAt: '2026-10-21T08:00:00Z', time: '16:00' }],
  activeSection: 'chat', selectedRegionId: 'all', isFullscreen: true,
  auth: { user: { id: userId }, status: 'ready' },
  chat: { historyStatus: 'ready', connectionStatus: 'live', hasMore: false },
  information: { unread: 0 }, locations: [], hotspots: [], posts: [],
  onOpenMemberProfile: () => {},
}

afterEach(() => { vi.unstubAllGlobals() })
describe('shared public profile presentation', () => {
  it('renders the author image and an accessible profile entry in hall messages', () => {
    const html = renderToStaticMarkup(<HallPanel {...hallProps} />)
    expect(html).toContain(`src="${avatarUrl}"`)
    expect(html).toContain('aria-label="查看白云同学的主页"')
  })

  it('does not present the old local avatar as an already synced account avatar', () => {
    const legacy = 'data:image/jpeg;base64,bG9jYWwtYXZhdGFy'
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ avatar: legacy, bio: '仅本机签名' }) })
    const html = renderToStaticMarkup(<PersonalHome auth={{ user: { id: userId }, profile: { user_id: userId, nickname: '同学', avatar_path: null } }} />)
    const identity = html.match(/<span[^>]*personal-identity__avatar[^>]*>[\s\S]*?<\/span>/)?.[0] ?? ''
    expect(identity).not.toContain(legacy)
    expect(html).toContain('同步本机头像')
    expect(html).toContain('查看公开主页')
  })
})
