import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: false,
    dts: false,
    banner: {
        js: '#!/usr/bin/env node',
    },
    // Exclude native addons from bundling
    external: ['better-sqlite3'],
});
