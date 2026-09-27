import { FileCog, Maximize2, RotateCcw, Route, Trash2 } from 'lucide-react'

export function SettingsPanel({ settings, onChange, onResetSettings, onResetView, onFullscreen, onClearRoute, onClearCurrentLocation, onResetDemoData }) {
  return (
    <section className="settings-panel" aria-label="地图设置">
      <div className="map-panel-heading"><FileCog size={14} /><span>地图设置</span></div>
      <label className="settings-toggle">
        <span><strong>操作提示</strong><small>显示缩放、拖动和漫游提示</small></span>
        <input type="checkbox" checked={settings.showTips} onChange={(event) => onChange({ showTips: event.target.checked })} aria-label="操作提示" />
      </label>
      <div className="settings-actions">
        <button type="button" onClick={onResetView}><RotateCcw size={13} />重置视角</button>
        <button type="button" onClick={onFullscreen}><Maximize2 size={13} />全屏地图</button>
        <button type="button" onClick={onClearRoute}><Route size={13} />清除路线</button>
        <button type="button" onClick={onClearCurrentLocation}><Trash2 size={13} />清除模拟位置</button>
      </div>
      <div className="settings-footer-actions">
        <button type="button" onClick={onResetSettings}>恢复默认设置</button>
        <button type="button" onClick={onResetDemoData}>恢复演示数据</button>
      </div>
      <p className="settings-meta">v0.1.0 · 本地演示数据 · 已预留真实接口层</p>
    </section>
  )
}
