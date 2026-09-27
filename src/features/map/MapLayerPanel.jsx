import { Layers3 } from 'lucide-react'

const LAYERS = [
  { key: 'showLabels', label: '地点标签', description: '显示建筑和服务点名称' },
  { key: 'showHotspots', label: '校园热点', description: '显示活动、人流和施工状态' },
  { key: 'showRoute', label: '当前路线', description: '显示路线规划覆盖层' },
  { key: 'showCurrentLocation', label: '我的位置', description: '显示模拟当前位置' },
  { key: 'showStatusColors', label: '状态颜色', description: '显示开放和人流颜色提示' },
]

export function MapLayerPanel({ settings, onChange }) {
  return (
    <section className="map-layer-panel" aria-label="地图图层设置">
      <div className="map-panel-heading"><Layers3 size={14} /><span>地图图层</span></div>
      <div className="map-layer-list">
        {LAYERS.map((layer) => (
          <label className="map-layer-row" key={layer.key}>
            <span>
              <strong>{layer.label}</strong>
              <small>{layer.description}</small>
            </span>
            <input
              type="checkbox"
              checked={settings[layer.key]}
              onChange={(event) => onChange({ [layer.key]: event.target.checked })}
              aria-label={layer.label}
            />
          </label>
        ))}
      </div>
    </section>
  )
}
