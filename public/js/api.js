/**
 * api.js — Simple API client for the mindmap server
 */
const API = {
  graphs: () => fetch('/api/graphs').then(r => r.json()),
  graph: (id) => fetch(`/api/graph/${encodeURIComponent(id)}`).then(r => r.json()),
  search: (id, q) => fetch(`/api/graph/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
  node: (id, name, depth = 1) => fetch(`/api/graph/${encodeURIComponent(id)}/node/${encodeURIComponent(name)}?depth=${depth}`).then(r => r.json()),
  stats: () => fetch('/api/stats').then(r => r.json()),
  graphStats: (id) => fetch(`/api/graph/${encodeURIComponent(id)}/stats`).then(r => r.json()),
};
