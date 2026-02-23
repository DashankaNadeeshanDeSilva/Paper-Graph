import { PaperGraphDatabase } from '../storage/database.js';
import type { Paper, Edge, Cluster, Entity } from '../types/index.js';
import { writeFileSync } from 'node:fs';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

// ─── Types ───────────────────────────────────────────────

export type ExportFormat = 'json' | 'graphml' | 'gexf' | 'csv' | 'mermaid';

interface ExportData {
    papers: Paper[];
    edges: Edge[];
    clusters: Cluster[];
    entities: Entity[];
}

// ─── Main Export Function ────────────────────────────────

/**
 * Export graph data from a PaperGraph database to a specified format.
 */
export function exportGraph(
    dbPath: string,
    outputPath: string,
    format: ExportFormat
): void {
    const db = new PaperGraphDatabase(dbPath);

    try {
        const data: ExportData = {
            papers: db.getAllPapers(),
            edges: db.getAllEdges(),
            clusters: db.getAllClusters(),
            entities: db.getAllEntities(),
        };

        let content: string;
        switch (format) {
            case 'json':
                content = exportJson(data);
                break;
            case 'graphml':
                content = exportGraphML(data);
                break;
            case 'gexf':
                content = exportGEXF(data);
                break;
            case 'csv':
                content = exportCSV(data);
                break;
            case 'mermaid':
                content = exportMermaid(data);
                break;
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }

        writeFileSync(outputPath, content, 'utf-8');
        logger.info({ format, outputPath, papers: data.papers.length, edges: data.edges.length }, 'Graph exported');
    } finally {
        db.close();
    }
}

// ─── Format Implementations ─────────────────────────────

function exportJson(data: ExportData): string {
    return JSON.stringify({
        papergraph: {
            version: '1.0.0',
            exported_at: new Date().toISOString(),
        },
        papers: data.papers.map((p) => ({
            id: p.paper_id,
            source: p.source,
            source_id: p.source_id,
            doi: p.doi,
            title: p.title,
            abstract: p.abstract?.slice(0, 500),
            year: p.year,
            venue: p.venue,
            url: p.url,
            citation_count: p.citation_count,
            influence_score: p.influence_score,
        })),
        edges: data.edges.map((e) => ({
            source: e.src_paper_id,
            target: e.dst_paper_id,
            type: e.type,
            weight: e.weight,
            confidence: e.confidence,
        })),
        clusters: data.clusters.map((c) => ({
            id: c.cluster_id,
            name: c.name,
            method: c.method,
        })),
        entities: data.entities.map((e) => ({
            id: e.entity_id,
            type: e.type,
            name: e.name,
        })),
    }, null, 2);
}

function exportGraphML(data: ExportData): string {
    const esc = (s: string | null | undefined) =>
        (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphstudio.org/xmlns/graphml"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <key id="title" for="node" attr.name="title" attr.type="string"/>
  <key id="year" for="node" attr.name="year" attr.type="int"/>
  <key id="venue" for="node" attr.name="venue" attr.type="string"/>
  <key id="citation_count" for="node" attr.name="citation_count" attr.type="int"/>
  <key id="doi" for="node" attr.name="doi" attr.type="string"/>
  <key id="influence" for="node" attr.name="influence" attr.type="double"/>
  <key id="type" for="edge" attr.name="type" attr.type="string"/>
  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>
  <graph id="papergraph" edgedefault="directed">
`;

    for (const paper of data.papers) {
        xml += `    <node id="n${paper.paper_id}">
      <data key="title">${esc(paper.title)}</data>
      <data key="year">${paper.year ?? ''}</data>
      <data key="venue">${esc(paper.venue)}</data>
      <data key="citation_count">${paper.citation_count}</data>
      <data key="doi">${esc(paper.doi)}</data>
      <data key="influence">${paper.influence_score ?? 0}</data>
    </node>
`;
    }

    for (const edge of data.edges) {
        xml += `    <edge source="n${edge.src_paper_id}" target="n${edge.dst_paper_id}">
      <data key="type">${edge.type}</data>
      <data key="weight">${edge.weight}</data>
    </edge>
`;
    }

    xml += `  </graph>
</graphml>`;

    return xml;
}

function exportGEXF(data: ExportData): string {
    const esc = (s: string | null | undefined) =>
        (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gexf xmlns="http://www.gexf.net/1.3"
      version="1.3">
  <meta>
    <creator>PaperGraph</creator>
    <description>Research paper connectivity graph</description>
  </meta>
  <graph defaultedgetype="directed">
    <attributes class="node">
      <attribute id="0" title="title" type="string"/>
      <attribute id="1" title="year" type="integer"/>
      <attribute id="2" title="venue" type="string"/>
      <attribute id="3" title="citations" type="integer"/>
      <attribute id="4" title="influence" type="float"/>
    </attributes>
    <attributes class="edge">
      <attribute id="0" title="type" type="string"/>
    </attributes>
    <nodes>
`;

    for (const paper of data.papers) {
        xml += `      <node id="${paper.paper_id}" label="${esc(paper.title?.slice(0, 60))}">
        <attvalues>
          <attvalue for="0" value="${esc(paper.title)}"/>
          <attvalue for="1" value="${paper.year ?? 0}"/>
          <attvalue for="2" value="${esc(paper.venue)}"/>
          <attvalue for="3" value="${paper.citation_count}"/>
          <attvalue for="4" value="${paper.influence_score ?? 0}"/>
        </attvalues>
      </node>
`;
    }

    xml += `    </nodes>
    <edges>
`;

    let edgeIdx = 0;
    for (const edge of data.edges) {
        xml += `      <edge id="${edgeIdx++}" source="${edge.src_paper_id}" target="${edge.dst_paper_id}" weight="${edge.weight}">
        <attvalues>
          <attvalue for="0" value="${edge.type}"/>
        </attvalues>
      </edge>
`;
    }

    xml += `    </edges>
  </graph>
</gexf>`;

    return xml;
}

function exportCSV(data: ExportData): string {
    // Export nodes
    let csv = 'paper_id,source,source_id,doi,title,year,venue,citation_count,influence_score\n';
    for (const paper of data.papers) {
        csv += [
            paper.paper_id,
            paper.source,
            paper.source_id,
            `"${(paper.doi ?? '').replace(/"/g, '""')}"`,
            `"${(paper.title ?? '').replace(/"/g, '""')}"`,
            paper.year ?? '',
            `"${(paper.venue ?? '').replace(/"/g, '""')}"`,
            paper.citation_count,
            paper.influence_score ?? '',
        ].join(',') + '\n';
    }

    csv += '\n# EDGES\nsrc_paper_id,dst_paper_id,type,weight,confidence\n';
    for (const edge of data.edges) {
        csv += `${edge.src_paper_id},${edge.dst_paper_id},${edge.type},${edge.weight},${edge.confidence}\n`;
    }

    return csv;
}

function exportMermaid(data: ExportData): string {
    let diagram = 'graph TD\n';

    // Add node definitions (truncated labels)
    for (const paper of data.papers) {
        const label = (paper.title ?? 'Untitled').slice(0, 40).replace(/"/g, "'");
        diagram += `  P${paper.paper_id}["${label}"]\n`;
    }

    diagram += '\n';

    // Add edges (limit to avoid overly complex diagrams)
    const maxEdges = 100;
    const edgesToRender = data.edges.slice(0, maxEdges);

    for (const edge of edgesToRender) {
        const style = edge.type === 'CITES' ? '-->' : '-.->';
        diagram += `  P${edge.src_paper_id} ${style} P${edge.dst_paper_id}\n`;
    }

    if (data.edges.length > maxEdges) {
        diagram += `\n  %% Note: ${data.edges.length - maxEdges} additional edges omitted\n`;
    }

    return diagram;
}
