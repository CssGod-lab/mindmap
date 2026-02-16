#!/usr/bin/env node

/**
 * sync.js — Syncs graphs from the local gpt-graph server to the mindmap server.
 * Designed to run from cron or manually.
 *
 * Environment variables:
 *   LOCAL_URL   — local graph server (default: http://127.0.0.1:8765)
 *   REMOTE_URL  — remote mindmap server (default: http://127.0.0.1:18804)
 *   SYNC_KEY    — auth key for /api/sync (default: mindmap-sync-key-change-me)
 */

const LOCAL_URL = process.env.LOCAL_URL || 'http://127.0.0.1:8765';
const REMOTE_URL = process.env.REMOTE_URL || 'http://127.0.0.1:18805';
const SYNC_KEY = process.env.SYNC_KEY || 'mindmap-sync-key-change-me';

// Prefixes to include
const INCLUDE_PREFIXES = ['mind', 'thought-'];
// Prefixes to exclude (higher priority)
const EXCLUDE_PREFIXES = ['social-', 'trading', 'encounter-'];

function shouldSync(graphId) {
  // Check exclusions first
  for (const prefix of EXCLUDE_PREFIXES) {
    if (graphId.startsWith(prefix)) return false;
  }
  // Check inclusions
  for (const prefix of INCLUDE_PREFIXES) {
    if (graphId === prefix || graphId.startsWith(prefix)) return true;
  }
  return false;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function syncGraph(graphId) {
  // Fetch from local graph server
  const graphData = await fetchJSON(`${LOCAL_URL}/v1/graph?id=${encodeURIComponent(graphId)}`);

  const payload = {
    id: graphId,
    nodes: graphData.nodes || [],
    relationships: graphData.relationships || []
  };

  // Push to remote
  const res = await fetch(`${REMOTE_URL}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Key': SYNC_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sync failed for ${graphId}: HTTP ${res.status} — ${text}`);
  }

  const result = await res.json();
  return result;
}

async function main() {
  console.log(`[sync] Starting sync from ${LOCAL_URL} → ${REMOTE_URL}`);
  console.log(`[sync] Time: ${new Date().toISOString()}`);

  // Fetch list of all graphs from local server
  let allGraphs;
  try {
    allGraphs = await fetchJSON(`${LOCAL_URL}/v1/graphs`);
  } catch (err) {
    console.error(`[sync] Failed to fetch graph list from ${LOCAL_URL}: ${err.message}`);
    process.exit(1);
  }

  // The response might be an array or an object with a graphs property
  const graphList = Array.isArray(allGraphs) ? allGraphs : (allGraphs.graphs || []);

  // Extract graph IDs
  const graphIds = graphList.map(g => typeof g === 'string' ? g : (g.id || g.name)).filter(Boolean);

  // Filter to whitelisted graphs
  const toSync = graphIds.filter(shouldSync);

  console.log(`[sync] Found ${graphIds.length} total graphs, ${toSync.length} match whitelist`);

  if (toSync.length === 0) {
    console.log('[sync] Nothing to sync. Done.');
    return;
  }

  let synced = 0;
  let failed = 0;

  for (const graphId of toSync) {
    try {
      const result = await syncGraph(graphId);
      console.log(`[sync] ✓ ${graphId} — ${result.nodes} nodes, ${result.relationships} rels`);
      synced++;
    } catch (err) {
      console.error(`[sync] ✗ ${graphId} — ${err.message}`);
      failed++;
    }
  }

  console.log(`[sync] Complete: ${synced} synced, ${failed} failed`);
}

main().catch(err => {
  console.error(`[sync] Fatal error: ${err.message}`);
  process.exit(1);
});
