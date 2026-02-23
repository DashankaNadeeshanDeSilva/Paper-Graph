import { PaperGraphDatabase } from '../storage/database.js';
import type { Paper, Edge, Cluster } from '../types/index.js';
import { writeFileSync } from 'node:fs';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

/**
 * Generate a self-contained HTML viewer using Cytoscape.js.
 *
 * Features:
 * - ELK.js hierarchical layout
 * - Dark mode with glassmorphism panels
 * - Edge type coloring
 * - Node sizing by PageRank / citation count
 * - Cluster coloring
 * - Search / filter
 * - Click-to-show paper details
 */
export function generateViewer(dbPath: string, outputPath: string): void {
    const db = new PaperGraphDatabase(dbPath);

    try {
        const papers = db.getAllPapers();
        const edges = db.getAllEdges();
        const clusters = db.getAllClusters();

        // Get paper-cluster mappings
        const rawDb = db.getRawDb();
        const pcRows = rawDb.prepare('SELECT paper_id, cluster_id FROM paper_clusters').all() as Array<{ paper_id: number; cluster_id: number }>;
        const paperCluster = new Map<number, number>();
        for (const row of pcRows) {
            paperCluster.set(row.paper_id, row.cluster_id);
        }

        const graphData = buildCytoscapeData(papers, edges, clusters, paperCluster);
        const html = buildHtml(graphData, papers.length, edges.length);

        writeFileSync(outputPath, html, 'utf-8');
        logger.info({ outputPath, papers: papers.length, edges: edges.length }, 'HTML viewer generated');
    } finally {
        db.close();
    }
}

function buildCytoscapeData(
    papers: Paper[],
    edges: Edge[],
    clusters: Cluster[],
    paperCluster: Map<number, number>
): string {
    // Cluster colors
    const colors = [
        '#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6',
        '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444', '#06b6d4',
        '#84cc16', '#a855f7', '#f97316', '#22d3ee', '#e879f9',
    ];

    const clusterColor = new Map<number, string>();
    let colorIdx = 0;
    for (const c of clusters) {
        if (c.cluster_id !== undefined) {
            clusterColor.set(c.cluster_id, colors[colorIdx % colors.length]!);
            colorIdx++;
        }
    }

    const nodes = papers.map((p) => {
        const clusterId = paperCluster.get(p.paper_id!);
        const color = clusterId !== undefined ? clusterColor.get(clusterId) ?? '#6366f1' : '#6366f1';
        const size = Math.max(20, Math.min(60, 20 + (p.influence_score ?? 0) * 1000));

        return {
            data: {
                id: `p${p.paper_id}`,
                label: (p.title ?? 'Untitled').slice(0, 50),
                title: p.title,
                year: p.year,
                venue: p.venue,
                doi: p.doi,
                url: p.url,
                citations: p.citation_count,
                influence: p.influence_score,
                cluster: clusterId,
                color,
                size,
            },
        };
    });

    const edgeTypeColors: Record<string, string> = {
        CITES: '#64748b',
        SIMILAR_TEXT: '#6366f1',
        CO_CITED: '#10b981',
        BIB_COUPLED: '#f59e0b',
        EXTENDS: '#3b82f6',
        CONTRADICTS: '#ef4444',
        REVIEWS: '#8b5cf6',
        REPLICATES: '#ec4899',
        USES_DATA: '#14b8a6',
        SHARES_METHOD: '#f97316',
        SAME_VENUE: '#84cc16',
        SAME_AUTHOR: '#a855f7',
        LLM_SEMANTIC: '#22d3ee',
        LLM_METHODOLOGICAL: '#e879f9',
        LLM_BUILDS_ON: '#06b6d4',
        LLM_DISAGREES_WITH: '#f43f5e',
    };

    const cyEdges = edges.map((e, i) => ({
        data: {
            id: `e${i}`,
            source: `p${e.src_paper_id}`,
            target: `p${e.dst_paper_id}`,
            type: e.type,
            weight: e.weight,
            color: edgeTypeColors[e.type] ?? '#64748b',
        },
    }));

    return JSON.stringify([...nodes, ...cyEdges]);
}

function buildHtml(graphData: string, paperCount: number, edgeCount: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PaperGraph Viewer</title>
<script src="https://unpkg.com/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/elkjs@0.9.3/lib/elk.bundled.js"></script>
<script src="https://unpkg.com/cytoscape-elk@2.2.0/dist/cytoscape-elk.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    height: 100vh;
    overflow: hidden;
  }
  #cy {
    width: 100%;
    height: 100vh;
    position: absolute;
    top: 0;
    left: 0;
  }
  .panel {
    position: absolute;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(100, 116, 139, 0.3);
    border-radius: 12px;
    padding: 16px;
    z-index: 10;
  }
  .header {
    top: 16px;
    left: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 700;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .stats {
    font-size: 12px;
    color: #94a3b8;
  }
  .search-panel {
    top: 16px;
    right: 16px;
    width: 300px;
  }
  .search-panel input {
    width: 100%;
    padding: 8px 12px;
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(100, 116, 139, 0.3);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
  }
  .search-panel input:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }
  .detail-panel {
    bottom: 16px;
    right: 16px;
    width: 360px;
    max-height: 50vh;
    overflow-y: auto;
    display: none;
  }
  .detail-panel.active { display: block; }
  .detail-panel h3 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 8px;
    line-height: 1.3;
  }
  .detail-field {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(100, 116, 139, 0.15);
  }
  .detail-field .label { color: #94a3b8; }
  .detail-field .value { color: #e2e8f0; font-weight: 500; }
  .detail-field a { color: #6366f1; text-decoration: none; }
  .detail-field a:hover { text-decoration: underline; }
  .legend {
    bottom: 16px;
    left: 16px;
    font-size: 11px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .controls {
    top: 80px;
    right: 16px;
    display: flex;
    gap: 6px;
  }
  .btn {
    padding: 6px 12px;
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(100, 116, 139, 0.3);
    border-radius: 6px;
    color: #e2e8f0;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn:hover {
    background: rgba(99, 102, 241, 0.2);
    border-color: #6366f1;
  }
</style>
</head>
<body>
  <div id="cy"></div>

  <div class="panel header">
    <h1>PaperGraph</h1>
    <span class="stats">${paperCount} papers · ${edgeCount} edges</span>
  </div>

  <div class="panel search-panel">
    <input type="text" id="search" placeholder="Search papers..." autocomplete="off" />
  </div>

  <div class="panel controls">
    <button class="btn" id="fitBtn">Fit</button>
    <button class="btn" id="layoutBtn">Re-layout</button>
    <button class="btn" id="resetBtn">Reset</button>
  </div>

  <div class="panel detail-panel" id="detail">
    <h3 id="detail-title"></h3>
    <div id="detail-fields"></div>
  </div>

  <div class="panel legend">
    <div class="legend-item"><div class="legend-dot" style="background:#64748b"></div> Cites</div>
    <div class="legend-item"><div class="legend-dot" style="background:#6366f1"></div> Similar</div>
    <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div> Co-cited</div>
    <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> Coupled</div>
  </div>

<script>
const graphData = ${graphData};

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: graphData,
  style: [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'background-color': 'data(color)',
        'width': 'data(size)',
        'height': 'data(size)',
        'font-size': '8px',
        'color': '#e2e8f0',
        'text-outline-color': '#0f172a',
        'text-outline-width': 2,
        'text-valign': 'bottom',
        'text-margin-y': 5,
        'text-max-width': '100px',
        'text-wrap': 'ellipsis',
        'border-width': 2,
        'border-color': 'data(color)',
        'border-opacity': 0.6,
      },
    },
    {
      selector: 'edge',
      style: {
        'width': function(e) { return Math.max(1, e.data('weight') * 3); },
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.5,
        'arrow-scale': 0.8,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': '#f59e0b',
        'border-opacity': 1,
      },
    },
    {
      selector: '.highlighted',
      style: {
        'opacity': 1,
        'border-width': 3,
        'border-color': '#f59e0b',
      },
    },
    {
      selector: '.faded',
      style: { 'opacity': 0.15 },
    },
  ],
  layout: {
    name: 'cose',
    animate: false,
    nodeRepulsion: 8000,
    idealEdgeLength: 120,
    nodeOverlap: 20,
  },
  wheelSensitivity: 0.3,
});

// Detail panel
cy.on('tap', 'node', function(evt) {
  const d = evt.target.data();
  const panel = document.getElementById('detail');
  panel.classList.add('active');
  document.getElementById('detail-title').textContent = d.title;

  const fields = [
    ['Year', d.year],
    ['Venue', d.venue],
    ['Citations', d.citations],
    ['Influence', d.influence?.toFixed(6)],
    ['DOI', d.doi ? '<a href="https://doi.org/' + d.doi + '" target="_blank">' + d.doi + '</a>' : '—'],
    ['URL', d.url ? '<a href="' + d.url + '" target="_blank">Open</a>' : '—'],
  ];

  document.getElementById('detail-fields').innerHTML = fields
    .map(([l, v]) => '<div class="detail-field"><span class="label">' + l + '</span><span class="value">' + (v ?? '—') + '</span></div>')
    .join('');
});

cy.on('tap', function(evt) {
  if (evt.target === cy) {
    document.getElementById('detail').classList.remove('active');
    cy.elements().removeClass('highlighted faded');
  }
});

// Highlight neighbors on node click
cy.on('select', 'node', function(evt) {
  const node = evt.target;
  const neighborhood = node.closedNeighborhood();
  cy.elements().addClass('faded');
  neighborhood.removeClass('faded').addClass('highlighted');
});

cy.on('unselect', 'node', function() {
  cy.elements().removeClass('highlighted faded');
});

// Search
document.getElementById('search').addEventListener('input', function(e) {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    cy.elements().removeClass('highlighted faded');
    return;
  }
  cy.elements().addClass('faded');
  cy.nodes().filter(n => {
    const d = n.data();
    return (d.title || '').toLowerCase().includes(q) ||
           (d.venue || '').toLowerCase().includes(q) ||
           (d.doi || '').toLowerCase().includes(q);
  }).removeClass('faded').addClass('highlighted');
});

// Buttons
document.getElementById('fitBtn').addEventListener('click', () => cy.fit(50));
document.getElementById('layoutBtn').addEventListener('click', () => {
  cy.layout({ name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: 8000 }).run();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  cy.elements().removeClass('highlighted faded');
  document.getElementById('search').value = '';
  document.getElementById('detail').classList.remove('active');
  cy.fit(50);
});
</script>
</body>
</html>`;
}
