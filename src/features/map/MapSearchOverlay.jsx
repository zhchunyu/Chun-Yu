import { Search, SlidersHorizontal } from 'lucide-react'
import { CATEGORIES, CATEGORY_LABELS } from '../../domain/campus.js'

const categoryOptions = Object.values(CATEGORIES)

export function MapSearchOverlay({ query, category, onQueryChange, onCategoryChange }) {
  return (
    <div className="map-search-overlay">
      <label className="map-search-field">
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">搜索校园地点</span>
        <input
          type="search"
          placeholder="搜索地点、服务或校园动态"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <span className="map-search-shortcut">⌘ K</span>
      </label>
      <label className="map-filter-select">
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span className="sr-only">地点分类</span>
        <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
          {categoryOptions.map((option) => <option value={option} key={option}>{CATEGORY_LABELS[option]}</option>)}
        </select>
      </label>
    </div>
  )
}
