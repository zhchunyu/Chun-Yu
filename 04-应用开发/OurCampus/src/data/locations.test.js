import { describe, expect, it } from 'vitest'
import { locationRepository } from './locations.js'
import { filterLocations } from '../domain/campus.js'

// 合规守卫：真实校名/楼名不得回归（红线要求）。此处用 Unicode 转义，避免守卫本身在源码里写出原名。
const REAL_NAME_PATTERN = new RegExp([
  '\u5c71\u897f', '\u519c\u4e1a\u5927\u5b66', '\u519c\u5927', '\u592a\u8c37', '\u4ead\u5170',
  '\u5d07\u5b66\u697c', '\u5d07\u6587\u697c', '\u52e4\u5b66\u697c', '\u5d07\u5b9e\u697c', '\u5d07\u4fe1\u697c',
  '\u7406\u5316\u697c', '\u52a8\u79d1\u697c', '\u97e9\u6c0f\u697c', '\u7530\u6c0f\u697c',
  '\u8c37\u56ed', '\u6021\u99a8\u56ed', '\u78a7\u6843\u56ed', '\u777f\u667a', '\u5eb7\u99a8\u82d1',
  '\u8d44\u6e90\u73af\u5883\u5b66\u9662', '\u751f\u547d\u79d1\u5b66\u5b66\u9662',
  '\u519c\u4e1a\u5de5\u7a0b\u5b66\u9662', '\u52a8\u7269\u533b\u5b66\u4e2d\u5fc3',
  's' + 'xau',
].join('|'), 'i')

describe('campus locations', () => {
  const locations = locationRepository.loadAll()

  it('loads the complete location list with anonymised names', () => {
    expect(locations).toHaveLength(68)
    expect(locations.every((location) => location.source === 'campus-guide')).toBe(true)
    expect(locations.map((location) => location.name)).toEqual(expect.arrayContaining([
      '西校门', '图书馆', '明德楼', '禾香餐厅', '机械工程学院', '桃李餐厅', '23号公寓楼', '静园', '地下通道',
    ]))
  })

  it('keeps no real school, city or campus-specific name in the repository', () => {
    expect(JSON.stringify(locations)).not.toMatch(REAL_NAME_PATTERN)
  })

  it('searches aliases without changing stable ids', () => {
    expect(filterLocations(locations, '图书馆').map((location) => location.id)).toContain('library')
    expect(filterLocations(locations, '教学楼').map((location) => location.id)).toContain('teaching-a')
    expect(filterLocations(locations, '学生食堂').map((location) => location.id)).toContain('canteen')
    expect(filterLocations(locations, '医务室').map((location) => location.id)).toContain('hospital')
  })

  it('keeps the guide-image coordinate conversion for the 2D scene', () => {
    const library = locations.find((location) => location.id === 'library')
    expect(library.mapPosition['2d'][0]).toBeCloseTo(0.2272817657, 9)
    expect(library.mapPosition['2d'][1]).toBeCloseTo(0.4705882352, 9)
    expect(locations.every((location) => location.mapPosition['2d'].every((value) => value >= 0 && value <= 1))).toBe(true)
  })
})
