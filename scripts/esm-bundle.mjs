import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
// Bundled CommonJS modules expect these bindings even in an ESM entry point.
writeFileSync(path, `import { fileURLToPath as bundleFileURLToPath } from 'node:url';
import { dirname as bundleDirname } from 'node:path';
const __filename = bundleFileURLToPath(import.meta.url);
const __dirname = bundleDirname(__filename);
${readFileSync(path, 'utf8')}`);
