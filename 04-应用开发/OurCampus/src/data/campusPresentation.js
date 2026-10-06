// 只处理比赛展示内容，保留真实坐标、地点 ID 和服务端原始记录。
export const COMPETITION_PRESENTATION = true

export function campusDisplayText(value) {
  if (typeof value !== 'string' || !COMPETITION_PRESENTATION) return value
  return value
    .replace(/山西\s*农业\s*大学|山西农大|山西农业大學|Shanxi Agricultural University/gi, '校园')
    .replace(/太谷校区|太谷校园/g, '本校区')
    .replace(/农大西门/g, '校园西门')
    .replace(/校园[（(]本校区[）)]|校园\s*[·—-]\s*本校区/g, '本校区')
}

export function canShowCampusLink(value) {
  if (!value) return false
  if (!COMPETITION_PRESENTATION) return true
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname !== 'sxau.edu.cn' && !hostname.endsWith('.sxau.edu.cn')
  } catch { return false }
}

export function campusDisplayRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key,
    ['name', 'title', 'description', 'activity', 'impact', 'updatedBy'].includes(key)
      ? campusDisplayText(value) : value,
  ]))
}
