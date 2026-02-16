/**
 * app.js — Main application logic for mindmap
 */

(function() {
  'use strict';

  // State
  let currentGraphId = null;
  let currentGraphData = null;
  let graphsList = [];
  let searchTimeout = null;

  // DOM elements
  const graphListEl = document.getElementById('graph-list');
  const loadingOverlay = document.getElementById('loading-overlay');
  const inspectorEl = document.getElementById('inspector');
  const inspectorTitle = document.getElementById('inspector-title');
  const inspectorBody = document.getElementById('inspector-body');
  const inspectorClose = document.getElementById('inspector-close');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const legendItems = document.getElementById('legend-items');

  // Stats elements
  const statNodes = document.getElementById('stat-nodes');
  const statRels = document.getElementById('stat-rels');
  const statGraphs = document.getElementById('stat-graphs');
  const statSync = document.getElementById('stat-sync');

  // ========== INITIALIZATION ==========

  async function init() {
    // Load stats
    loadGlobalStats();

    // Load graphs list
    await loadGraphList();

    // Initialize graph renderer
    const container = document.getElementById('graph-container');
    GraphRenderer.init(container, {
      onNodeClick: handleNodeClick
    });

    // Load default graph
    const defaultGraph = 'mind';
    const hasDefault = graphsList.some(g => g.id === defaultGraph);
    if (hasDefault) {
      loadGraph(defaultGraph);
    } else if (graphsList.length > 0) {
      loadGraph(graphsList[0].id);
    } else {
      hideLoading();
      showEmpty();
    }

    // Setup events
    setupSearch();
    inspectorClose.addEventListener('click', closeInspector);

    // Auto-refresh stats
    setInterval(loadGlobalStats, 60000);
  }

  // ========== GRAPHS LIST ==========

  async function loadGraphList() {
    try {
      graphsList = await API.graphs();
      renderGraphList();
    } catch (err) {
      console.error('Failed to load graphs:', err);
      graphsList = [];
    }
  }

  function renderGraphList() {
    graphListEl.innerHTML = '';

    if (graphsList.length === 0) {
      graphListEl.innerHTML = '<div class="empty-state"><p>No graphs synced yet</p></div>';
      return;
    }

    for (const graph of graphsList) {
      const el = document.createElement('div');
      el.className = 'graph-item' + (graph.id === currentGraphId ? ' active' : '');
      el.innerHTML = `
        <div class="graph-name">${escapeHtml(graph.id)}</div>
        <div class="graph-meta">
          <span>${graph.node_count || 0} nodes</span>
          <span>${graph.rel_count || 0} rels</span>
          ${graph.top_type ? `<span class="graph-type-badge">${escapeHtml(graph.top_type)}</span>` : ''}
        </div>
      `;
      el.addEventListener('click', () => loadGraph(graph.id));
      graphListEl.appendChild(el);
    }
  }

  // ========== LOAD GRAPH ==========

  async function loadGraph(graphId) {
    if (currentGraphId === graphId && currentGraphData) return;

    currentGraphId = graphId;
    showLoading();
    closeInspector();
    clearSearch();
    renderGraphList(); // Update active state

    try {
      currentGraphData = await API.graph(graphId);
      GraphRenderer.render(currentGraphData);
      updateLegend();
      hideLoading();
    } catch (err) {
      console.error('Failed to load graph:', err);
      hideLoading();
      showEmpty();
    }
  }

  // ========== STATS ==========

  async function loadGlobalStats() {
    try {
      const stats = await API.stats();
      statNodes.textContent = formatNumber(stats.total_nodes);
      statRels.textContent = formatNumber(stats.total_relationships);
      statGraphs.textContent = formatNumber(stats.total_graphs);
      statSync.textContent = stats.last_sync ? timeAgo(stats.last_sync) : '—';
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  // ========== SEARCH ==========

  function setupSearch() {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();

      if (!q) {
        searchResults.classList.remove('open');
        searchResults.innerHTML = '';
        GraphRenderer.highlightNodes([]);
        return;
      }

      searchTimeout = setTimeout(() => performSearch(q), 200);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        clearSearch();
      }
    });

    // Close search results on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) {
        searchResults.classList.remove('open');
      }
    });
  }

  async function performSearch(q) {
    if (!currentGraphId) return;

    try {
      const results = await API.search(currentGraphId, q);
      renderSearchResults(results);

      // Highlight matching nodes in graph
      const names = results.map(n => n.name);
      GraphRenderer.highlightNodes(names);
    } catch (err) {
      console.error('Search failed:', err);
    }
  }

  function renderSearchResults(results) {
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-result-item"><span class="result-name" style="color:var(--text-muted)">No results</span></div>';
      searchResults.classList.add('open');
      return;
    }

    searchResults.innerHTML = results.slice(0, 15).map(node => `
      <div class="search-result-item" data-name="${escapeAttr(node.name)}">
        <span class="result-name">${escapeHtml(node.name)}</span>
        <span class="result-type">${escapeHtml(node.type || 'Unknown')}</span>
      </div>
    `).join('');

    // Click handlers
    searchResults.querySelectorAll('.search-result-item[data-name]').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.name;
        GraphRenderer.focusNode(name);
        const node = GraphRenderer.nodes.find(n => n.name === name);
        if (node) handleNodeClick(node);
        searchResults.classList.remove('open');
      });
    });

    searchResults.classList.add('open');
  }

  function clearSearch() {
    searchInput.value = '';
    searchResults.classList.remove('open');
    searchResults.innerHTML = '';
    GraphRenderer.highlightNodes([]);
  }

  // ========== NODE INSPECTOR ==========

  function handleNodeClick(node) {
    if (!node) {
      closeInspector();
      return;
    }

    inspectorTitle.textContent = node.name;
    inspectorBody.innerHTML = '';

    // Type badge
    const color = NODE_COLORS[node.type] || NODE_COLORS.Unknown;
    const typeEl = document.createElement('div');
    typeEl.className = 'inspector-type';
    typeEl.style.background = color + '22';
    typeEl.style.color = color;
    typeEl.style.border = `1px solid ${color}44`;
    typeEl.textContent = node.type || 'Unknown';
    inspectorBody.appendChild(typeEl);

    // Properties — dynamic key-value rows for all fields
    const props = node.properties || {};
    const propKeys = Object.keys(props);
    if (propKeys.length > 0) {
      const section = createInspectorSection('Properties');
      const propsDiv = document.createElement('div');
      propsDiv.className = 'inspector-props';

      for (const key of propKeys) {
        let val = props[key];
        if (val == null) continue;
        if (typeof val === 'object') val = JSON.stringify(val, null, 2);
        val = String(val);

        const propEl = document.createElement('div');
        propEl.className = 'inspector-prop';
        // Long values get full-width block display
        const isLong = val.length > 80 || val.includes('\n');
        if (isLong) {
          propEl.classList.add('inspector-prop--block');
          propEl.innerHTML = `
            <span class="prop-key">${escapeHtml(key)}</span>
            <span class="prop-value prop-value--block">${escapeHtml(val)}</span>
          `;
        } else {
          propEl.innerHTML = `
            <span class="prop-key">${escapeHtml(key)}</span>
            <span class="prop-value">${escapeHtml(val)}</span>
          `;
        }
        propsDiv.appendChild(propEl);
      }
      section.appendChild(propsDiv);
      inspectorBody.appendChild(section);
    }

    // Metadata
    const metaSection = createInspectorSection('Metadata');
    const metaDiv = document.createElement('div');
    metaDiv.className = 'inspector-props';
    metaDiv.innerHTML += `<div class="inspector-prop"><span class="prop-key">graph</span><span class="prop-value">${escapeHtml(node.graph_id || currentGraphId || '—')}</span></div>`;
    if (node.created_at) {
      metaDiv.innerHTML += `<div class="inspector-prop"><span class="prop-key">created</span><span class="prop-value">${escapeHtml(formatDate(node.created_at))}</span></div>`;
    }
    if (node.updated_at) {
      metaDiv.innerHTML += `<div class="inspector-prop"><span class="prop-key">updated</span><span class="prop-value">${escapeHtml(formatDate(node.updated_at))}</span></div>`;
    }
    metaDiv.innerHTML += `<div class="inspector-prop"><span class="prop-key">connections</span><span class="prop-value">${node.connections != null ? node.connections : '—'}</span></div>`;
    metaSection.appendChild(metaDiv);
    inspectorBody.appendChild(metaSection);

    // Connections
    const connections = findConnections(node.name);
    if (connections.length > 0) {
      const connSection = createInspectorSection(`Connections (${connections.length})`);

      for (const conn of connections.slice(0, 30)) {
        const connEl = document.createElement('div');
        connEl.className = 'inspector-connection';
        const isOutgoing = conn.source === node.name;
        connEl.innerHTML = `
          <span class="conn-dir">${isOutgoing ? '→' : '←'}</span>
          <span class="conn-rel">${escapeHtml(conn.type)}</span>
          <span class="conn-node">${escapeHtml(isOutgoing ? conn.target : conn.source)}</span>
        `;
        connEl.addEventListener('click', () => {
          const targetName = isOutgoing ? conn.target : conn.source;
          const targetNode = GraphRenderer.nodes.find(n => n.name === targetName);
          if (targetNode) {
            GraphRenderer.focusNode(targetName);
            handleNodeClick(targetNode);
          }
        });
        connSection.appendChild(connEl);
      }

      if (connections.length > 30) {
        const moreEl = document.createElement('div');
        moreEl.style.cssText = 'padding: 8px; text-align: center; color: var(--text-muted); font-size: 11px;';
        moreEl.textContent = `+ ${connections.length - 30} more`;
        connSection.appendChild(moreEl);
      }

      inspectorBody.appendChild(connSection);
    }

    inspectorEl.classList.add('open');
  }

  function findConnections(nodeName) {
    if (!currentGraphData || !currentGraphData.relationships) return [];
    return currentGraphData.relationships.filter(
      r => r.source === nodeName || r.target === nodeName
    );
  }

  function closeInspector() {
    inspectorEl.classList.remove('open');
  }

  function createInspectorSection(title) {
    const section = document.createElement('div');
    section.className = 'inspector-section';
    const titleEl = document.createElement('div');
    titleEl.className = 'inspector-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);
    return section;
  }

  // ========== LEGEND ==========

  function updateLegend() {
    const types = GraphRenderer.getNodeTypes();
    legendItems.innerHTML = '';

    const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);

    for (const [type, count] of sorted) {
      const color = NODE_COLORS[type] || NODE_COLORS.Unknown;
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${escapeHtml(type)} (${count})`;
      legendItems.appendChild(item);
    }
  }

  // ========== UI HELPERS ==========

  function showLoading() {
    loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  function showEmpty() {
    const container = document.getElementById('graph-container');
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◇</div>
        <p>No graph data available. Run a sync to populate.</p>
      </div>
    `;
  }

  // ========== UTILITY FUNCTIONS ==========

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatNumber(n) {
    if (n == null) return '—';
    return n.toLocaleString();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      let d;
      const num = Number(dateStr);
      if (!isNaN(num) && num > 1e9 && num < 1e11) {
        // Unix epoch seconds
        d = new Date(num * 1000);
      } else if (!isNaN(num) && num > 1e12) {
        // Unix epoch milliseconds
        d = new Date(num);
      } else {
        d = new Date(dateStr);
      }
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '—';
    try {
      const now = Date.now();
      const num = Number(dateStr);
      let then;
      if (!isNaN(num) && num > 1e9 && num < 1e11) {
        then = num * 1000;
      } else if (!isNaN(num) && num > 1e12) {
        then = num;
      } else {
        then = new Date(dateStr).getTime();
      }
      if (isNaN(then)) return '—';
      const diff = now - then;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch {
      return dateStr;
    }
  }

  // ========== BOOT ==========

  document.addEventListener('DOMContentLoaded', init);
})();
