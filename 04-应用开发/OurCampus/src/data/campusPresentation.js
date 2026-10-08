// 只处理比赛展示内容，保留真实坐标、地点 ID 和服务端原始记录。
export const COMPETITION_PRESENTATION = true

export function campusDisplayText(value) {
  if (typeof value !== 'string' || !COMPETITION_PRESENTATION) return value
  return value
    .replace(/山西\s*农业\s*大学|山西农大|山西农业大學|Shanxi Agricultural University/gi, '校园')
    .replace(/太谷校区|太谷校园/g, '本校区')
    .replace(/农大西门/g, '校园西门')
    .replace(/校园[（(]本校区[）)]|校园\s*[·—-]\s*本校区/g, '本校区')
    // 行政区与专属楼名兜底：腾讯底图注记层已整体关闭，这里再防一层
    .replace(/太谷区|晋中市|山西省/g, '本地区')
    .replace(/亭兰图书馆|亭兰/g, '图书馆')
    // 上面几条替换可能拼出"校园校园"这类叠词，收拢一次
    .replace(/(校园|本校区|本地区)\1+/g, '$1')
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
