import { Compass, Search, MessagesSquare, UserRound } from 'lucide-react'

const tabs = [
  { id: 'map', label: '首页', Icon: Compass },
  { id: 'explore', label: '地点', Icon: Search },
  { id: 'hall', label: '大厅', Icon: MessagesSquare },
  { id: 'me', label: '我的', Icon: UserRound },
]

export function MobileTabBar({ activeTab, onChange }) {
  return (
    <nav className="mobile-tab-bar" aria-label="主导航">
      {tabs.map(({ id, label, Icon }) => (
        <button
          className={`mobile-tab-bar__item${activeTab === id ? ' is-active' : ''}`}
          type="button"
          key={id}
          aria-current={activeTab === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <Icon size={19} strokeWidth={activeTab === id ? 2.3 : 1.8} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
