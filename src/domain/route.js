import { campusRouteGraph, getEntryNodeId } from '../data/routeGraph.js'

export const ROUTE_MODES = Object.freeze({
  SHORTEST: 'shortest',
  ACCESSIBLE: 'accessible',
  AVOID_CONSTRUCTION: 'avoid-construction',
  RAIN: 'rain',
  NIGHT: 'night',
})

export const ROUTE_MODE_LABELS = Object.freeze({
  shortest: '最短路线',
  accessible: '无障碍路线',
  'avoid-construction': '避开施工',
  rain: '避雨路线',
  night: '夜间安全',
})

function edgeAllowed(edge, mode, blockedEdgeIds) {
  if (blockedEdgeIds.has(edge.id)) return false
  if (mode === ROUTE_MODES.ACCESSIBLE && !edge.accessible) return false
  if (mode === ROUTE_MODES.AVOID_CONSTRUCTION && edge.blocked) return false
  return true
}

function edgeCost(edge, mode) {
  if (mode === ROUTE_MODES.RAIN) return edge.distance * (edge.covered ? 0.65 : 1.35)
  if (mode === ROUTE_MODES.NIGHT) return edge.distance * (edge.safeAtNight ? 0.8 : 1.3)
  return edge.distance
}

function heuristic(a, b) {
  const dx = a.position[0] - b.position[0]
  const dz = a.position[2] - b.position[2]
  return Math.hypot(dx, dz)
}

function buildAdjacency(edges, mode, blockedEdgeIds) {
  const adjacency = new Map()

  const add = (from, to, edge) => {
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from).push({ nodeId: to, edge })
  }

  edges.filter((edge) => edgeAllowed(edge, mode, blockedEdgeIds)).forEach((edge) => {
    add(edge.from, edge.to, edge)
    add(edge.to, edge.from, edge)
  })

  return adjacency
}

function reconstruct(cameFrom, current) {
  const path = [current]
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)
    path.unshift(current)
  }
  return path
}

function findEdge(graph, from, to) {
  return graph.edges.find((edge) => (
    (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
  ))
}

function unavailableRoute(originId, destinationId, mode) {
  return {
    originId,
    destinationId,
    mode,
    distance: 0,
    durationMinutes: 0,
    status: 'unavailable',
    segments: [],
    nodeIds: [],
    points: [],
  }
}

function arrivedRoute(originId, destinationId, mode) {
  return {
    originId,
    destinationId,
    mode,
    distance: 0,
    durationMinutes: 0,
    status: 'arrived',
    segments: [],
    nodeIds: [],
    points: [],
  }
}

function buildRouteResult({ originId, destinationId, mode, nodeIds, graph, blockedEdgeIds }) {
  const segments = []
  let distance = 0

  for (let index = 1; index < nodeIds.length; index += 1) {
    const from = nodeIds[index - 1]
    const to = nodeIds[index]
    const edge = findEdge(graph, from, to)
    const segmentDistance = edge?.distance ?? heuristic(graph.nodes[from], graph.nodes[to])
    segments.push({ from, to, distance: segmentDistance })
    distance += segmentDistance
  }

  return {
    originId,
    destinationId,
    mode,
    distance: Math.round(distance),
    durationMinutes: Math.max(1, Math.ceil(distance / 60)),
    status: 'preview',
    segments,
    nodeIds,
    points: nodeIds.map((id) => graph.nodes[id].position),
    blockedEdgeIds: [...blockedEdgeIds],
  }
}

export function createCampusRoute({
  originId,
  destinationId,
  mode = ROUTE_MODES.SHORTEST,
  graph = campusRouteGraph,
  originNodeId,
  destinationNodeId,
  blockedEdgeIds = [],
}) {
  if (!originId || !destinationId) return null
  if (originId === destinationId) return arrivedRoute(originId, destinationId, mode)

  const start = originNodeId ?? getEntryNodeId(originId)
  const goal = destinationNodeId ?? getEntryNodeId(destinationId)
  if (!start || !goal || !graph.nodes[start] || !graph.nodes[goal]) {
    return unavailableRoute(originId, destinationId, mode)
  }

  const dynamicBlockedEdges = new Set(blockedEdgeIds)
  const adjacency = buildAdjacency(graph.edges, mode, dynamicBlockedEdges)
  const open = new Set([start])
  const cameFrom = new Map()
  const gScore = new Map([[start, 0]])
  const fScore = new Map([[start, heuristic(graph.nodes[start], graph.nodes[goal])]])

  while (open.size) {
    const current = [...open].sort((a, b) => fScore.get(a) - fScore.get(b))[0]
    if (current === goal) {
      return buildRouteResult({
        originId,
        destinationId,
        mode,
        nodeIds: reconstruct(cameFrom, current),
        graph,
        blockedEdgeIds: dynamicBlockedEdges,
      })
    }

    open.delete(current)
    for (const connection of adjacency.get(current) ?? []) {
      const tentative = gScore.get(current) + edgeCost(connection.edge, mode)
      if (tentative >= (gScore.get(connection.nodeId) ?? Infinity)) continue

      cameFrom.set(connection.nodeId, current)
      gScore.set(connection.nodeId, tentative)
      fScore.set(
        connection.nodeId,
        tentative + heuristic(graph.nodes[connection.nodeId], graph.nodes[goal]),
      )
      open.add(connection.nodeId)
    }
  }

  return unavailableRoute(originId, destinationId, mode)
}

export function createDemoRoute(args) {
  return createCampusRoute({ ...args, graph: args.graph ?? campusRouteGraph })
}
