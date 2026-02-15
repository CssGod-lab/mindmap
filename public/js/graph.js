/**
 * graph.js — D3.js force-directed graph renderer
 */

const NODE_COLORS = {
  Belief: '#4ade80',
  Position: '#60a5fa',
  Thesis: '#f59e0b',
  Concept: '#a78bfa',
  Project: '#f472b6',
  Task: '#fb923c',
  Feature: '#34d399',
  Decision: '#fbbf24',
  Strategy: '#f87171',
  Principle: '#38bdf8',
  Philosophy: '#818cf8',
  Insight: '#e879f9',
  Experience: '#22d3ee',
  Question: '#fcd34d',
  Synthesis: '#a3e635',
  Agent: '#4ade80',
  Person: '#60a5fa',
  Token: '#fbbf24',
  Platform: '#fb923c',
  Method: '#34d399',
  Interaction: '#67e8f9',
  Response: '#c084fc',
  Blocker: '#ef4444',
  Architecture: '#8b5cf6',
  Milestone: '#10b981',
  Encounter: '#f472b6',
  Lesson: '#facc15',
  Evolution: '#2dd4bf',
  Evidence: '#38bdf8',
  Counterpoint: '#f87171',
  Identity: '#4ade80',
  Status: '#94a3b8',
  Reference: '#cbd5e1',
  Unknown: '#888888'
};

const GraphRenderer = {
  svg: null,
  g: null,
  simulation: null,
  nodes: [],
  links: [],
  nodeElements: null,
  linkElements: null,
  linkLabels: null,
  nodeLabels: null,
  zoom: null,
  width: 0,
  height: 0,
  minimapCanvas: null,
  minimapCtx: null,
  onNodeClick: null,
  searchMatches: new Set(),
  isSearchActive: false,

  init(container, options = {}) {
    this.onNodeClick = options.onNodeClick || null;
    const rect = container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    // Clear previous
    container.innerHTML = '';

    // Create SVG
    this.svg = d3.select(container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height);

    // Arrow marker
    const defs = this.svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', 'rgba(255,255,255,0.15)');

    // Zoom
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
        this.updateMinimap();
      });

    this.svg.call(this.zoom);

    // Main group
    this.g = this.svg.append('g');

    // Minimap
    this.minimapCanvas = document.getElementById('minimap-canvas');
    if (this.minimapCanvas) {
      this.minimapCanvas.width = 160;
      this.minimapCanvas.height = 120;
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }

    // Handle resize
    this._resizeHandler = () => {
      const r = container.getBoundingClientRect();
      this.width = r.width;
      this.height = r.height;
      this.svg.attr('width', this.width).attr('height', this.height);
      if (this.simulation) {
        this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
        this.simulation.alpha(0.1).restart();
      }
    };
    window.addEventListener('resize', this._resizeHandler);
  },

  render(graphData) {
    if (!this.svg) return;
    if (!graphData || !graphData.nodes) return;

    // Process nodes — count connections
    const connectionCount = {};
    const nodeMap = {};

    this.nodes = graphData.nodes.map(n => {
      const node = {
        id: String(n.id),
        name: n.name || String(n.id),
        type: n.type || 'Unknown',
        properties: n.properties || {},
        created_at: n.created_at,
        updated_at: n.updated_at
      };
      connectionCount[node.name] = 0;
      nodeMap[node.name] = node;
      return node;
    });

    // Process links — resolve source/target to node objects by name
    this.links = [];
    if (graphData.relationships) {
      for (const rel of graphData.relationships) {
        const src = nodeMap[rel.source];
        const tgt = nodeMap[rel.target];
        if (src && tgt) {
          this.links.push({
            source: src,
            target: tgt,
            type: rel.type || 'RELATES_TO',
            properties: rel.properties || {}
          });
          connectionCount[src.name] = (connectionCount[src.name] || 0) + 1;
          connectionCount[tgt.name] = (connectionCount[tgt.name] || 0) + 1;
        }
      }
    }

    // Set connection count on nodes
    for (const node of this.nodes) {
      node.connections = connectionCount[node.name] || 0;
    }

    // Radius based on connections — big spread for visual hierarchy
    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(this.nodes, d => d.connections) || 1])
      .range([5, 40]);

    // Clear previous elements
    this.g.selectAll('*').remove();

    // Links
    this.linkElements = this.g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(this.links)
      .enter()
      .append('line')
      .attr('class', 'link-line')
      .attr('marker-end', 'url(#arrowhead)');

    // Link labels
    this.linkLabels = this.g.append('g')
      .attr('class', 'link-labels')
      .selectAll('text')
      .data(this.links)
      .enter()
      .append('text')
      .attr('class', 'link-label')
      .text(d => d.type);

    // Nodes
    this.nodeElements = this.g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(this.nodes)
      .enter()
      .append('circle')
      .attr('class', 'node-circle')
      .attr('r', d => radiusScale(d.connections))
      .attr('fill', d => NODE_COLORS[d.type] || NODE_COLORS.Unknown)
      .on('mouseover', (event, d) => this._showTooltip(event, d))
      .on('mouseout', () => this._hideTooltip())
      .on('click', (event, d) => {
        event.stopPropagation();
        if (this.onNodeClick) this.onNodeClick(d);
      })
      .call(this._drag());

    // Node labels — always show all
    this.nodeLabels = this.g.append('g')
      .attr('class', 'node-labels')
      .selectAll('text')
      .data(this.nodes)
      .enter()
      .append('text')
      .attr('class', 'node-label')
      .text(d => d.name.length > 28 ? d.name.slice(0, 26) + '…' : d.name)
      .attr('dy', d => radiusScale(d.connections) + 14);

    // Force simulation
    const chargeStrength = this.nodes.length > 200 ? -400 : this.nodes.length > 100 ? -600 : -800;
    const linkDistance = this.nodes.length > 200 ? 160 : this.nodes.length > 100 ? 220 : 280;

    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links).id(d => d.name).distance(linkDistance))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide().radius(d => radiusScale(d.connections) + 20).strength(0.9))
      .alphaDecay(this.nodes.length > 200 ? 0.05 : 0.02)
      .on('tick', () => this._tick(radiusScale));

    // Limit initial iterations for large graphs
    if (this.nodes.length > 200) {
      this.simulation.tick(80);
      this.simulation.alpha(0.1);
    }

    // Click on background to deselect
    this.svg.on('click', () => {
      if (this.onNodeClick) this.onNodeClick(null);
    });

    // Initial zoom to fit
    setTimeout(() => this.zoomToFit(), 500);
  },

  _tick(radiusScale) {
    this.linkElements
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    this.linkLabels
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2);

    this.nodeElements
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    this.nodeLabels
      .attr('x', d => d.x)
      .attr('y', d => d.y);

    this.updateMinimap();
  },

  _drag() {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  },

  _showTooltip(event, d) {
    const tooltip = document.getElementById('tooltip');
    tooltip.textContent = `${d.name} (${d.type}) — ${d.connections} connections`;
    tooltip.classList.add('visible');
    tooltip.style.left = (event.clientX + 12) + 'px';
    tooltip.style.top = (event.clientY - 8) + 'px';
  },

  _hideTooltip() {
    document.getElementById('tooltip').classList.remove('visible');
  },

  zoomToFit() {
    if (!this.nodes.length) return;
    const bounds = this.g.node().getBBox();
    if (bounds.width === 0 || bounds.height === 0) return;

    const padding = 60;
    const scale = Math.min(
      this.width / (bounds.width + padding * 2),
      this.height / (bounds.height + padding * 2),
      2
    );
    const tx = this.width / 2 - (bounds.x + bounds.width / 2) * scale;
    const ty = this.height / 2 - (bounds.y + bounds.height / 2) * scale;

    this.svg.transition().duration(750)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  },

  highlightNodes(names) {
    this.searchMatches = new Set(names.map(n => n.toLowerCase()));
    this.isSearchActive = names.length > 0;

    if (!this.nodeElements) return;

    if (!this.isSearchActive) {
      // Clear all highlights
      this.nodeElements.classed('highlighted', false).classed('faded', false);
      this.nodeLabels.classed('faded', false);
      this.linkElements.classed('faded', false);
      this.linkLabels.classed('faded', false);
      return;
    }

    this.nodeElements
      .classed('highlighted', d => this.searchMatches.has(d.name.toLowerCase()))
      .classed('faded', d => !this.searchMatches.has(d.name.toLowerCase()));

    this.nodeLabels
      .classed('faded', d => !this.searchMatches.has(d.name.toLowerCase()));

    // Fade links not connected to matches
    this.linkElements.classed('faded', d =>
      !this.searchMatches.has(d.source.name.toLowerCase()) &&
      !this.searchMatches.has(d.target.name.toLowerCase())
    );
    this.linkLabels.classed('faded', d =>
      !this.searchMatches.has(d.source.name.toLowerCase()) &&
      !this.searchMatches.has(d.target.name.toLowerCase())
    );
  },

  focusNode(name) {
    const node = this.nodes.find(n => n.name === name);
    if (!node || !node.x) return;

    const scale = 1.5;
    const tx = this.width / 2 - node.x * scale;
    const ty = this.height / 2 - node.y * scale;

    this.svg.transition().duration(500)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  },

  updateMinimap() {
    if (!this.minimapCtx || !this.nodes.length) return;

    const ctx = this.minimapCtx;
    const cw = 160;
    const ch = 120;
    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = 'rgba(10, 10, 10, 0.8)';
    ctx.fillRect(0, 0, cw, ch);

    // Find bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      if (n.x == null || n.y == null) continue;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 10;
    const scaleX = (cw - pad * 2) / rangeX;
    const scaleY = (ch - pad * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (cw - rangeX * scale) / 2;
    const offsetY = (ch - rangeY * scale) / 2;

    // Draw links
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const link of this.links) {
      if (link.source.x == null || link.target.x == null) continue;
      const x1 = (link.source.x - minX) * scale + offsetX;
      const y1 = (link.source.y - minY) * scale + offsetY;
      const x2 = (link.target.x - minX) * scale + offsetX;
      const y2 = (link.target.y - minY) * scale + offsetY;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    // Draw nodes
    for (const n of this.nodes) {
      if (n.x == null || n.y == null) continue;
      const x = (n.x - minX) * scale + offsetX;
      const y = (n.y - minY) * scale + offsetY;
      ctx.fillStyle = NODE_COLORS[n.type] || NODE_COLORS.Unknown;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  getNodeTypes() {
    const types = {};
    for (const n of this.nodes) {
      types[n.type] = (types[n.type] || 0) + 1;
    }
    return types;
  },

  destroy() {
    if (this.simulation) this.simulation.stop();
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    this.svg = null;
    this.g = null;
    this.simulation = null;
    this.nodes = [];
    this.links = [];
  }
};
