const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 18804;
const SYNC_KEY = process.env.SYNC_KEY || 'mindmap-sync-key-change-me';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Initialize database
const db = new Database(path.join(dataDir, 'mindmap.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS graphs (
    id TEXT PRIMARY KEY,
    name TEXT,
    node_count INTEGER DEFAULT 0,
    rel_count INTEGER DEFAULT 0,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT,
    graph_id TEXT,
    name TEXT,
    type TEXT,
    properties TEXT,
    created_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (graph_id, id)
  );

  CREATE TABLE IF NOT EXISTS relationships (
    id TEXT,
    graph_id TEXT,
    source TEXT,
    target TEXT,
    type TEXT,
    properties TEXT,
    created_at TEXT,
    PRIMARY KEY (graph_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_graph ON nodes(graph_id);
  CREATE INDEX IF NOT EXISTS idx_rels_graph ON relationships(graph_id);
  CREATE INDEX IF NOT EXISTS idx_nodes_graph_name ON nodes(graph_id, name);
  CREATE INDEX IF NOT EXISTS idx_nodes_graph_type ON nodes(graph_id, type);
`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// List all graphs with stats
app.get('/api/graphs', (req, res) => {
  try {
    const graphs = db.prepare(`
      SELECT g.id, g.name, g.node_count, g.rel_count, g.updated_at,
        (SELECT type FROM nodes WHERE graph_id = g.id GROUP BY type ORDER BY COUNT(*) DESC LIMIT 1) as top_type
      FROM graphs g ORDER BY g.updated_at DESC
    `).all();
    res.json(graphs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global stats
app.get('/api/stats', (req, res) => {
  try {
    const totalGraphs = db.prepare('SELECT COUNT(*) as count FROM graphs').get().count;
    const totalNodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
    const totalRels = db.prepare('SELECT COUNT(*) as count FROM relationships').get().count;
    const lastSync = db.prepare('SELECT MAX(updated_at) as last FROM graphs').get().last;
    res.json({
      total_graphs: totalGraphs,
      total_nodes: totalNodes,
      total_relationships: totalRels,
      last_sync: lastSync
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full graph
app.get('/api/graph/:id', (req, res) => {
  try {
    const graphId = req.params.id;
    const graph = db.prepare('SELECT * FROM graphs WHERE id = ?').get(graphId);
    if (!graph) return res.status(404).json({ error: 'Graph not found' });

    const nodes = db.prepare('SELECT * FROM nodes WHERE graph_id = ?').all(graphId).map(n => ({
      ...n,
      properties: n.properties ? JSON.parse(n.properties) : {}
    }));

    const relationships = db.prepare('SELECT * FROM relationships WHERE graph_id = ?').all(graphId).map(r => ({
      ...r,
      properties: r.properties ? JSON.parse(r.properties) : {}
    }));

    res.json({ id: graph.id, name: graph.name, nodes, relationships });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search nodes in a graph
app.get('/api/graph/:id/search', (req, res) => {
  try {
    const graphId = req.params.id;
    const q = req.query.q || '';
    if (!q) return res.json([]);

    const nodes = db.prepare(
      'SELECT * FROM nodes WHERE graph_id = ? AND name LIKE ? LIMIT 50'
    ).all(graphId, `%${q}%`).map(n => ({
      ...n,
      properties: n.properties ? JSON.parse(n.properties) : {}
    }));

    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get node + neighbors
app.get('/api/graph/:id/node/:name', (req, res) => {
  try {
    const graphId = req.params.id;
    const nodeName = decodeURIComponent(req.params.name);
    const depth = Math.min(parseInt(req.query.depth) || 1, 3);

    const node = db.prepare(
      'SELECT * FROM nodes WHERE graph_id = ? AND name = ?'
    ).get(graphId, nodeName);

    if (!node) return res.status(404).json({ error: 'Node not found' });

    // Collect neighbors up to depth
    const visited = new Set([nodeName]);
    let frontier = [nodeName];
    const allNodes = [{ ...node, properties: node.properties ? JSON.parse(node.properties) : {} }];
    const allRels = [];

    for (let d = 0; d < depth; d++) {
      if (frontier.length === 0) break;
      const placeholders = frontier.map(() => '?').join(',');

      const outRels = db.prepare(
        `SELECT * FROM relationships WHERE graph_id = ? AND source IN (${placeholders})`
      ).all(graphId, ...frontier);

      const inRels = db.prepare(
        `SELECT * FROM relationships WHERE graph_id = ? AND target IN (${placeholders})`
      ).all(graphId, ...frontier);

      const rels = [...outRels, ...inRels];
      const nextFrontier = [];

      for (const rel of rels) {
        allRels.push({ ...rel, properties: rel.properties ? JSON.parse(rel.properties) : {} });
        for (const name of [rel.source, rel.target]) {
          if (!visited.has(name)) {
            visited.add(name);
            nextFrontier.push(name);
            const neighbor = db.prepare(
              'SELECT * FROM nodes WHERE graph_id = ? AND name = ?'
            ).get(graphId, name);
            if (neighbor) {
              allNodes.push({ ...neighbor, properties: neighbor.properties ? JSON.parse(neighbor.properties) : {} });
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    // Deduplicate relationships
    const relSet = new Set();
    const uniqueRels = allRels.filter(r => {
      const key = `${r.graph_id}-${r.id}`;
      if (relSet.has(key)) return false;
      relSet.add(key);
      return true;
    });

    res.json({ node: allNodes[0], nodes: allNodes, relationships: uniqueRels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Graph stats
app.get('/api/graph/:id/stats', (req, res) => {
  try {
    const graphId = req.params.id;
    const graph = db.prepare('SELECT * FROM graphs WHERE id = ?').get(graphId);
    if (!graph) return res.status(404).json({ error: 'Graph not found' });

    const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes WHERE graph_id = ?').get(graphId).count;
    const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships WHERE graph_id = ?').get(graphId).count;
    const types = db.prepare(
      'SELECT type, COUNT(*) as count FROM nodes WHERE graph_id = ? GROUP BY type ORDER BY count DESC'
    ).all(graphId);

    res.json({
      id: graph.id,
      name: graph.name,
      node_count: nodeCount,
      rel_count: relCount,
      updated_at: graph.updated_at,
      node_types: types
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync endpoint (protected)
app.post('/api/sync', (req, res) => {
  const key = req.headers['x-sync-key'];
  if (key !== SYNC_KEY) {
    return res.status(403).json({ error: 'Invalid sync key' });
  }

  try {
    const { id, nodes, relationships } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing graph id' });

    const now = new Date().toISOString();
    const nodeList = nodes || [];
    const relList = relationships || [];

    const syncTransaction = db.transaction(() => {
      // Delete existing data for this graph
      db.prepare('DELETE FROM nodes WHERE graph_id = ?').run(id);
      db.prepare('DELETE FROM relationships WHERE graph_id = ?').run(id);

      // Insert nodes
      const insertNode = db.prepare(
        'INSERT INTO nodes (id, graph_id, name, type, properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const node of nodeList) {
        const nodeId = String(node.id || node.name || Math.random().toString(36).slice(2));
        const props = typeof node.properties === 'string' ? node.properties : JSON.stringify(node.properties || {});
        insertNode.run(
          nodeId,
          id,
          node.name || '',
          node.type || 'Unknown',
          props,
          node.created_at || node._created || now,
          node.updated_at || node._updated || now
        );
      }

      // Insert relationships
      const insertRel = db.prepare(
        'INSERT INTO relationships (id, graph_id, source, target, type, properties, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const rel of relList) {
        const relId = String(rel.id || `${rel.source}-${rel.type}-${rel.target}-${Math.random().toString(36).slice(2)}`);
        const props = typeof rel.properties === 'string' ? rel.properties : JSON.stringify(rel.properties || {});
        insertRel.run(
          relId,
          id,
          rel.source || '',
          rel.target || '',
          rel.type || 'RELATES_TO',
          props,
          rel.created_at || rel._created || now
        );
      }

      // Upsert graph metadata
      db.prepare(`
        INSERT INTO graphs (id, name, node_count, rel_count, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          node_count = excluded.node_count,
          rel_count = excluded.rel_count,
          updated_at = excluded.updated_at
      `).run(id, id, nodeList.length, relList.length, now);
    });

    syncTransaction();

    res.json({
      ok: true,
      graph: id,
      nodes: nodeList.length,
      relationships: relList.length,
      synced_at: now
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[mindmap] Server running on port ${PORT}`);
  console.log(`[mindmap] Database: ${path.join(dataDir, 'mindmap.db')}`);
  console.log(`[mindmap] Public dir: ${path.join(__dirname, 'public')}`);
});
