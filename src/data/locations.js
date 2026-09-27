import { REPO_BUILDINGS } from './sharedRepoBuildings.js'

const DEMO_STATUS = Object.freeze({
  'east-gate': { activity: '入口通行顺畅', crowdStatus: 'low', updatedAt: '8 分钟前' },
  library: { activity: '计算机学院讲座 · 14:00', crowdStatus: 'normal', updatedAt: '刚刚更新' },
  'teaching-a': { activity: '今日课程进行中', crowdStatus: 'busy', updatedAt: '5 分钟前' },
  canteen: { activity: '午餐高峰 · 建议错峰', crowdStatus: 'busy', updatedAt: '2 分钟前' },
  dormitory: { openStatus: 'limited', activity: '访客登记通道正常', crowdStatus: 'normal', updatedAt: '12 分钟前' },
  gymnasium: { activity: '今晚有校队训练', crowdStatus: 'low', updatedAt: '20 分钟前' },
})

const KEYWORDS_BY_ID = Object.freeze({
  'east-gate': ['快递', '访客', '咨询', '出入口'],
  library: ['阅读', '自习', '借阅', '讲座'],
  'teaching-a': ['教室', '上课', '课程', '教学'],
  canteen: ['吃饭', '餐饮', '窗口', '外卖'],
  dormitory: ['住宿', '生活', '登记'],
  gymnasium: ['运动', '篮球', '比赛', '活动'],
})

const demoLocations = REPO_BUILDINGS.map((building) => ({
  id: building.id,
  name: building.name,
  aliases: [...building.aliases],
  category: building.category,
  source: 'shared-repo',
  sourceBuildingName: building.name,
  modelAnchorId: building.modelAnchorId,
  mapPosition: { '2d': [...building.mapPosition], '3d': [...building.worldPosition] },
  entryNodeId: building.entryNodeId,
  firstPersonSpawnOffset: [...building.firstPersonSpawnOffset],
  description: building.description,
  keywords: [...new Set([...building.keywords, ...(KEYWORDS_BY_ID[building.id] ?? [])])],
  openStatus: 'open',
  crowdStatus: 'normal',
  activity: '',
  updatedAt: '刚刚更新',
  ...DEMO_STATUS[building.id],
}))

export const locationRepository = {
  loadAll() {
    return demoLocations.map((location) => ({
      ...location,
      aliases: [...location.aliases],
      keywords: [...location.keywords],
      mapPosition: {
        '2d': [...location.mapPosition['2d']],
        '3d': [...location.mapPosition['3d']],
      },
      firstPersonSpawnOffset: [...location.firstPersonSpawnOffset],
    }))
  },
}

export { demoLocations }
