import { Layers3, LocateFixed, Megaphone, PanelLeft, PersonStanding, Settings2, ShieldAlert, ShieldCheck, Tags } from 'lucide-react'
import { CAMERA_MODES } from '../../domain/camera.js'
import { RoleSwitcher } from '../roles/RoleSwitcher.jsx'
import { EventComposer } from '../events/EventComposer.jsx'
import { SimulatedLocationPicker } from './SimulatedLocationPicker.jsx'
import { MapLayerPanel } from './MapLayerPanel.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'

const tools = [
  { id: 'safety', label: '安全管理', icon: ShieldAlert },
  { id: 'categories', label: '地点分类', icon: Tags },
  { id: 'layers', label: '图层显示', icon: Layers3 },
  { id: 'role', label: '角色模式', icon: ShieldCheck },
  { id: 'settings', label: '设置', icon: Settings2 },
  { id: 'location', label: '我的位置', icon: LocateFixed },
  { id: 'camera', label: '第一人称', icon: PersonStanding },
]

export function MapToolbar({ open, activeTool, role, settings, locations, events, currentLocationId, cameraMode, canUndoAdminAction, lastAdminAction, onToggle, onToolChange, onRoleChange, onCurrentLocationChange, onCameraModeChange, onSettingsChange, onResetSettings, onResetView, onFullscreen, onClearRoute, onClearCurrentLocation, onResetDemoData, onPublishEvent, onUpdateEvent, onCloseEvent, onUndoAdminAction }) {
  const visibleTools = role === 'manager' ? [...tools, { id: 'events', label: '发布热点', icon: Megaphone }] : tools

  const handleToolClick = (toolId) => {
    if (toolId === 'camera') {
      onCameraModeChange(cameraMode === CAMERA_MODES.FIRST_PERSON ? CAMERA_MODES.ORBIT : CAMERA_MODES.FIRST_PERSON)
      return
    }

    if (toolId === 'location' && !open) {
      onToggle(true)
      onToolChange(toolId)
      return
    }

    // ★ 安全管理模式：开启工具时同步打开安全叠加层与**居中浮层面板**
    //   面板本体由 MapWorkspace 渲染（居中浮层），这里只负责"开/关"这一个状态开关。
    if (toolId === 'safety') {
      const next = activeTool === toolId ? null : toolId
      onToolChange(next)
      onSettingsChange?.(next === 'safety'
        ? { safetyMode: true, showSafetyPanel: true }
        : { safetyMode: false })
      if (next === 'safety') onToggle(true)
      return
    }

    onToolChange(activeTool === toolId ? null : toolId)
  }

  return (
    <aside className={`map-toolbar ${open ? 'is-expanded' : ''}`} aria-label="地图工具栏">
      <button className="map-toolbar__toggle" type="button" onClick={() => { if (open) onToolChange(null); onToggle() }} aria-expanded={open} aria-label={open ? '收起工具栏' : '展开工具栏'}>
        <PanelLeft size={17} />
        <span>{open ? '收起工具' : '地图工具'}</span>
      </button>
      <div className="map-toolbar__tools">
        {visibleTools.map(({ id, label, icon: Icon }) => (
          <button
            className={`map-tool-button ${activeTool === id ? 'is-active' : ''} ${id === 'safety' && settings.safetyMode ? 'is-safety-on' : ''}`}
            type="button"
            key={id}
            onClick={() => handleToolClick(id)}
            aria-pressed={id === 'camera' ? cameraMode === CAMERA_MODES.FIRST_PERSON : activeTool === id}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {open && activeTool === 'role' && (
        <div className="map-toolbar__drawer">
          <RoleSwitcher role={role} onChange={onRoleChange} />
        </div>
      )}
      {open && activeTool === 'categories' && <div className="map-toolbar__hint">使用上方搜索浮层筛选地点分类。</div>}
      {open && activeTool === 'layers' && <MapLayerPanel settings={settings} onChange={onSettingsChange} />}
      {open && activeTool === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={onSettingsChange}
          onResetSettings={onResetSettings}
          onResetView={onResetView}
          onFullscreen={onFullscreen}
          onClearRoute={onClearRoute}
          onClearCurrentLocation={onClearCurrentLocation}
          onResetDemoData={onResetDemoData}
          canUndoAdminAction={canUndoAdminAction}
          lastAdminAction={lastAdminAction}
          onUndoAdminAction={onUndoAdminAction}
        />
      )}
      {open && activeTool === 'location' && (
        <SimulatedLocationPicker locations={locations} currentLocationId={currentLocationId} onChange={onCurrentLocationChange} />
      )}
      {open && activeTool === 'events' && role === 'manager' && <EventComposer locations={locations} events={events} onPublish={onPublishEvent} onUpdate={onUpdateEvent} onClose={onCloseEvent} />}
    </aside>
  )
}
