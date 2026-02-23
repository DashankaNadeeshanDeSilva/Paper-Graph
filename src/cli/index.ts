

import { Command } from 'commander';
import { resolveConfig } from '../utils/config.js';
import { initLogger, getLogger } from '../utils/logger.js';
import { getHttpClient } from '../utils/http-client.js';
import { buildGraph } from '../builder/graph-builder.js';
import { exportGraph, type ExportFormat } from '../exporters/export.js';
import { generateViewer } from '../viewer/html-viewer.js';
import { PaperGraphDatabase } from '../storage/database.js';
import type { PaperGraphConfig, SpineType, LogLevel } from '../types/index.js';

const VERSION = '1.0.0';

const program = new Command();

program
    .name('papergraph')
    .description('Build research-paper connectivity graphs from topics, keywords, or paper titles.')
    .version(VERSION);

// ─── BUILD command ────────────────────────────────────────

program
    .command('build')
    .description('Build a graph database from papers')
    .requiredOption('-t, --topic <topic>', 'Search topic')
    .option('-p, --paper <titles...>', 'Paper titles to seed')
    .option('--doi <dois...>', 'DOIs to seed')
    .option('-s, --source <source>', 'Data source: openalex | s2', 'openalex')
    .option('--spine <spine>', 'Graph spine: citation | similarity | co-citation | coupling | hybrid', 'citation')
    .option('-d, --depth <n>', 'Citation traversal depth', '2')
    .option('-m, --max-papers <n>', 'Maximum papers to collect', '200')
    .option('-o, --out <path>', 'Output database path', './papergraph.db')
    .option('--max-refs <n>', 'Max references per paper', '20')
    .option('--max-cites <n>', 'Max citations per paper', '20')
    .option('--year-from <year>', 'Filter papers from year')
    .option('--year-to <year>', 'Filter papers to year')
    .option('--log-level <level>', 'Log level: debug | info | warn | error', 'info')
    .option('--json-logs', 'Output JSON logs', false)
    .option('--no-cache', 'Disable response caching')
    .action(async (opts) => {
        const cliConfig: Partial<PaperGraphConfig> = {
            topic: opts.topic,
            paper: opts.paper,
            doi: opts.doi,
            source: opts.source as PaperGraphConfig['source'],
            spine: opts.spine as SpineType,
            depth: parseInt(opts.depth, 10),
            maxPapers: parseInt(opts.maxPapers, 10),
            maxRefsPerPaper: parseInt(opts.maxRefs, 10),
            maxCitesPerPaper: parseInt(opts.maxCites, 10),
            out: opts.out,
            yearFrom: opts.yearFrom ? parseInt(opts.yearFrom, 10) : undefined,
            yearTo: opts.yearTo ? parseInt(opts.yearTo, 10) : undefined,
            logLevel: opts.logLevel as LogLevel,
            jsonLogs: opts.jsonLogs,
            noCache: !opts.cache,
        };

        const config = await resolveConfig(cliConfig);
        initLogger({ level: config.logLevel, jsonLogs: config.jsonLogs });
        getHttpClient({ timeout: 30000 });

        const logger = getLogger();
        logger.info({ topic: config.topic, source: config.source, spine: config.spine }, 'Starting build');

        try {
            const dbPath = await buildGraph(config);
            logger.info({ dbPath }, 'Build complete!');
        } catch (error) {
            logger.error({ error }, 'Build failed');
            process.exit(1);
        }
    });

// ─── EXPORT command ───────────────────────────────────────

program
    .command('export')
    .description('Export graph to JSON, GraphML, GEXF, CSV, or Mermaid')
    .requiredOption('-i, --input <dbPath>', 'Input database path')
    .requiredOption('-f, --format <format>', 'Export format: json | graphml | gexf | csv | mermaid')
    .option('-o, --out <path>', 'Output file path')
    .action((opts) => {
        const format = opts.format.toLowerCase() as ExportFormat;
        const validFormats = ['json', 'graphml', 'gexf', 'csv', 'mermaid'];

        if (!validFormats.includes(format)) {
            console.error(`Invalid format: ${format}. Valid: ${validFormats.join(', ')}`);
            process.exit(1);
        }

        const extensions: Record<string, string> = {
            json: '.json', graphml: '.graphml', gexf: '.gexf',
            csv: '.csv', mermaid: '.md',
        };

        const outputPath = opts.out ?? opts.input.replace('.db', extensions[format] ?? '.out');

        try {
            exportGraph(opts.input, outputPath, format);
            console.log(`Exported to ${outputPath}`);
        } catch (error) {
            console.error('Export failed:', error);
            process.exit(1);
        }
    });

// ─── VIEW command ─────────────────────────────────────────

program
    .command('view')
    .description('Generate a self-contained HTML viewer')
    .requiredOption('-i, --input <dbPath>', 'Input database path')
    .option('-o, --out <path>', 'Output HTML file path')
    .action((opts) => {
        const outputPath = opts.out ?? opts.input.replace('.db', '.html');

        try {
            generateViewer(opts.input, outputPath);
            console.log(`Viewer generated: ${outputPath}`);
        } catch (error) {
            console.error('View generation failed:', error);
            process.exit(1);
        }
    });

// ─── INSPECT command ──────────────────────────────────────

program
    .command('inspect')
    .description('Show database statistics')
    .requiredOption('-i, --input <dbPath>', 'Input database path')
    .action((opts) => {
        try {
            const db = new PaperGraphDatabase(opts.input);
            const stats = db.getStats();
            db.close();

            console.log('\n📊 PaperGraph Database Statistics\n');
            console.log(`  Papers:   ${stats.papers}`);
            console.log(`  Edges:    ${stats.edges}`);
            console.log(`  Clusters: ${stats.clusters}`);
            console.log(`  Entities: ${stats.entities}`);
            console.log(`  Runs:     ${stats.runs}`);

            if (Object.keys(stats.edgesByType).length > 0) {
                console.log('\n  Edge Types:');
                for (const [type, count] of Object.entries(stats.edgesByType)) {
                    console.log(`    ${type}: ${count}`);
                }
            }

            console.log('');
        } catch (error) {
            console.error('Inspect failed:', error);
            process.exit(1);
        }
    });

// ─── CACHE command ────────────────────────────────────────

program
    .command('cache')
    .description('Manage the response cache')
    .argument('<action>', 'Action: clear | stats')
    .action((action) => {
        switch (action) {
            case 'clear':
                try {
                    const { rmSync } = require('node:fs');
                    rmSync('.papergraph-cache', { recursive: true, force: true });
                    console.log('Cache cleared.');
                } catch {
                    console.log('No cache to clear.');
                }
                break;
            case 'stats':
                try {
                    const { readdirSync, statSync } = require('node:fs');
                    const { join } = require('node:path');
                    const files = readdirSync('.papergraph-cache');
                    let totalSize = 0;
                    for (const f of files) {
                        totalSize += statSync(join('.papergraph-cache', f)).size;
                    }
                    console.log(`Cache: ${files.length} entries, ${(totalSize / 1024).toFixed(1)} KB`);
                } catch {
                    console.log('No cache found.');
                }
                break;
            default:
                console.error(`Unknown action: ${action}. Valid: clear, stats`);
                process.exit(1);
        }
    });

program.parse();
