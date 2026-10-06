import { describe, expect, it } from 'vitest'
import { clampMapScale, panMapViewport, zoomMapViewport } from './mapViewport.js'

describe('map viewport helpers', () => {
  it('clamps zoom to the supported map scale range', () => {
    expect(clampMapScale(0.2)).toBe(1)
    expect(clampMapScale(2.5)).toBe(2.5)
    expect(clampMapScale(8)).toBe(4)
  })

  it('moves the viewport when the user drags the map', () => {
    expect(panMapViewport({ scale: 2, offsetX: 4, offsetY: -3 }, 80, 25)).toEqual({
      scale: 2,
      offsetX: 84,
      offsetY: 22,
    })
  })

  it('keeps the zoom focus under the cursor', () => {
    expect(zoomMapViewport({ scale: 1, offsetX: 0, offsetY: 0 }, 1, { x: 100, y: 40 })).toEqual({
      scale: 1.2,
      offsetX: -20,
      offsetY: -8,
    })
  })
})
