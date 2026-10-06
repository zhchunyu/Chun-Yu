import { describe, expect, it } from 'vitest'
import { locationRepository } from './locations.js'
import { filterLocations } from '../domain/campus.js'

describe('shared repository locations', () => {
  const locations = locationRepository.loadAll()

  it('loads the complete repository building list', () => {
    expect(locations).toHaveLength(30)
    expect(locations.every((location) => location.source === 'shared-repo')).toBe(true)
    expect(locations.map((location) => location.name)).toEqual(expect.arrayContaining([
      '主校门', '亭兰图书馆', '创新中心', '科研中心', '公共教学楼', '食堂', '商业街', '环廊S4站',
    ]))
  })

  it('searches repository aliases without changing stable ids', () => {
    expect(filterLocations(locations, '图书馆').map((location) => location.id)).toContain('library')
    expect(filterLocations(locations, '第一教学楼').map((location) => location.id)).toContain('teaching-a')
    expect(filterLocations(locations, '学生食堂').map((location) => location.id)).toContain('canteen')
    expect(filterLocations(locations, '医务室').map((location) => location.id)).toContain('hospital')
  })

  it('keeps the repository coordinate conversion for 2D and 3D', () => {
    const library = locations.find((location) => location.id === 'library')
    expect(library.mapPosition['2d']).toEqual([0.5, 300 / 595])
    expect(library.mapPosition['3d']).toEqual([0, 3, -518.4])
    expect(library.entryNodeId).toBe('library-entry')
  })
})
