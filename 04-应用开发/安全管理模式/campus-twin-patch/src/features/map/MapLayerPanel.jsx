import { Layers3, ShieldAlert } from 'lucide-react'

const LAYERS = [
  { key: 'showLabels', label: '地点标签', description: '显示建筑和服务点名称' },
  { key: 'showHotspots', label: '校园热点', description: '显示活动、人流和施工状态' },
  { key: 'showRoute', label: '当前路线', description: '显示路线规划覆盖层' },
  { key: 'showCurrentLocation', label: '我的位置', description: '显示模拟当前位置' },
  { key: 'showStatusColors', label: '状态颜色', description: '显示开放和人流颜色提示' },
]

/** ★ 安全管理模式的三个叠加图层 —— 仅在安全模式开启时可见 */
const SAFETY_LAYERS = [
  { key: 'showRiskZones', label: '风险区', description: '四色风险区与告警地点标签' },
  { key: 'showCrowdHeat', label: '人流热力', description: '按占用率渲染的人流强度' },
  { key: 'showBlockedRoads', label: '封控路段', description: '封控路段与推荐 / 避雨通道' },
]

export function MapLayerPanel({ settings, onChange }) {
  const renderRows = (layers) => layers.map((layer) => (
    <label className="map-layer-row" key={layer.key}>
      <span>
        <strong>{layer.label}</strong>
        <small>{layer.description}</small>
      </span>
      <input
        type="checkbox"
        checked={settings[layer.key] !== false}
        onChange={(event) => onChange({ [layer.key]: event.target.checked })}
        aria-label={layer.label}
      />
    </label>
  ))

  return (
    <section className="map-layer-panel" aria-label="地图图层设置">
      <div className="map-panel-heading"><Layers3 size={14} /><span>地图图层</span></div>
      <div className="map-layer-list">{renderRows(LAYERS)}</div>

      {settings.safetyMode && (
        <>
          <div className="map-panel-heading map-panel-heading--safety">
            <ShieldAlert size={14} /><span>安全模式图层</span>
          </div>
          <div className="map-layer-list">{renderRows(SAFETY_LAYERS)}</div>
        </>
      )}
    </section>
  )
}
