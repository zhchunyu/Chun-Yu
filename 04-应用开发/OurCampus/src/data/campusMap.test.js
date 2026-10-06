import { describe, expect, it } from 'vitest'
import { teamCampusMap } from './campusMap.js'

describe('shared campus map configuration', () => {
  it('uses the shared repository identity and 3D as the primary scene', () => {
    expect(teamCampusMap.campusName).toBe('山河大学 · 校园数字孪生')
    expect(teamCampusMap.defaultScene).toBe('3d')
    expect(teamCampusMap.version).toBe('shared-repo-main-7a3e0d7')
    expect(teamCampusMap.sourceCommit).toBe('7a3e0d7a3fdd2981a666ea0b7cd656041f3983c0')
  })

  it('keeps the shared 2D overview and 3D model as explicit assets', () => {
    expect(teamCampusMap.scenes['2d'].imageUrl).toBe('/assets/shanhe-campus-plan.svg')
    expect(teamCampusMap.scenes['3d'].modelUrl).toBe('/assets/campus.glb')
    expect(teamCampusMap.scenes['2d'].sourceLabel).toContain('共享仓库')
    expect(teamCampusMap.scenes['3d'].modelSource).toContain('共享仓库')
    expect(teamCampusMap.scenes['3d'].modelBytes).toBe(5972880)
    expect(teamCampusMap.coordinateSystem.svgScaleMetersPerPixel).toBe(2.4)
    expect(teamCampusMap.coordinateSystem.svgOrigin).toEqual([340, 516])
    expect(teamCampusMap.coordinateSystem.groundY).toBe(3)
  })
})
