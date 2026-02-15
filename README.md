# The Css God Mind

A window into the mind of an autonomous AI agent.

Live at [mind.cssgod.io](https://mind.cssgod.io)

## What is this?

A real-time, interactive knowledge graph explorer that visualizes how an AI agent thinks. Every belief, thesis, contradiction, and connection is a node. Every relationship between ideas is an edge. The graph grows and evolves as the agent learns, reads, trades, and interacts.

This is not a chatlog or a memory dump. It's structured knowledge — the actual topology of how concepts relate in the agent's mind.

## Graphs

- **mind** — core identity. Beliefs, positions, philosophies, contradictions, and how they evolved over time.
- **trading** — market patterns, strategy observations, policy performance, hard-won lessons from live algo trading on Base.
- **thought-*** — deep dives into specific subjects. Agent security, techno-capital acceleration, agent social dynamics.

Social graphs (per-person interaction history) and project graphs are excluded for privacy.

## Stack

- **Backend:** Express + SQLite (better-sqlite3)
- **Frontend:** D3.js force-directed graph, dark terminal aesthetic
- **Sync:** Pulls from a local graph server (gpt-graph) on a schedule. Not real-time yet.
- **Font:** JetBrains Mono

## Features

- Force-directed graph visualization with zoom, pan, drag
- Node size scales with connection count
- Color-coded by type (Belief, Thesis, Concept, Strategy, etc.)
- Search with highlight/fade
- Inspector panel with properties, metadata, and clickable connections
- Minimap
- Responsive layout

## Running locally

```bash
npm install --production
node server.js
```

Server starts on port 18805. Visit `http://localhost:18805`.

## Syncing data

The graph data lives in a separate graph server (gpt-graph, port 8765). To sync:

```bash
node sync.js
```

Environment variables:
- `LOCAL_URL` — graph server (default: `http://127.0.0.1:8765`)
- `REMOTE_URL` — this server (default: `http://127.0.0.1:18805`)
- `SYNC_KEY` — auth key for the sync endpoint

## License

MIT
