const demoEvents = [
  {
    id: 'event-library-lecture',
    title: '计算机学院讲座',
    type: 'activity',
    locationId: 'library',
    anchorId: 'ANCHOR_Library',
    status: 'active',
    startAt: '2026-09-19T08:00:00+08:00',
    endAt: '2026-09-19T20:30:00+08:00',
    heatLevel: 'medium',
    impact: '图书馆报告厅 18:30 开始，建议提前入场。',
    source: 'manager',
    positionSource: 'shared-repo-anchor',
    updatedAt: '刚刚更新',
    visibleTo: ['visitor', 'student', 'manager'],
  },
  {
    id: 'event-canteen-crowd',
    title: '学生食堂午餐高峰',
    type: 'crowd',
    locationId: 'canteen',
    anchorId: 'ANCHOR_Canteen',
    status: 'active',
    startAt: '2026-09-19T11:00:00+08:00',
    endAt: '2026-09-19T13:30:00+08:00',
    heatLevel: 'high',
    impact: '当前排队人数较多，建议错峰就餐。',
    source: 'manager',
    positionSource: 'shared-repo-anchor',
    updatedAt: '2 分钟前',
    visibleTo: ['visitor', 'student', 'manager'],
  },
  {
    id: 'event-east-road',
    title: '体育馆西侧道路维护',
    type: 'construction',
    locationId: 'gymnasium',
    status: 'active',
    startAt: '2026-09-19T07:30:00+08:00',
    endAt: '2026-09-20T18:00:00+08:00',
    heatLevel: 'medium',
    impact: '体育馆西侧路段临时施工，路线规划会自动避开。',
    anchorId: 'ANCHOR_Gymnasium',
    affectedEdgeIds: ['road:outer_sw3:outer_sw4'],
    source: 'manager',
    positionSource: 'shared-repo-anchor',
    updatedAt: '12 分钟前',
    visibleTo: ['visitor', 'student', 'manager'],
  },
]

export const eventRepository = {
  loadAll() {
    return demoEvents.map((event) => ({
      ...event,
      visibleTo: [...event.visibleTo],
      affectedEdgeIds: [...(event.affectedEdgeIds ?? [])],
    }))
  },
}

export function getActiveBlockedEdgeIds(events = []) {
  return [...new Set(events
    .filter((event) => event.status === 'active')
    .flatMap((event) => event.affectedEdgeIds ?? []))]
}

export function getDefaultAffectedEdgeIds({ type, locationId }) {
  if (type !== 'construction') return []

  const locationEdges = {
    gymnasium: ['road:outer_sw3:outer_sw4'],
    'teaching-a': ['road:inner_e_s7:inner_e_s8'],
    canteen: ['road:outer_s2:outer_s3'],
  }

  return locationEdges[locationId] ?? []
}

export { demoEvents }
