export const MAP_SCALE_MIN = 1
export const MAP_SCALE_MAX = 4

export function clampMapScale(scale) {
  return Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, scale))
}

export function panMapViewport(viewport, deltaX, deltaY) {
  return {
    ...viewport,
    offsetX: viewport.offsetX + deltaX,
    offsetY: viewport.offsetY + deltaY,
  }
}

export function zoomMapViewport(viewport, direction, focus = { x: 0, y: 0 }) {
  const nextScale = clampMapScale(viewport.scale * (direction > 0 ? 1.2 : 1 / 1.2))
  const ratio = nextScale / viewport.scale

  return {
    scale: nextScale,
    offsetX: focus.x + (viewport.offsetX - focus.x) * ratio,
    offsetY: focus.y + (viewport.offsetY - focus.y) * ratio,
  }
}
