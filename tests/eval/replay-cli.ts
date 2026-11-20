import { readFile } from 'node:fs/promises';
import { replay } from './replay.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: pnpm benchmark:replay <manifest.json>');
const input: unknown = JSON.parse(await readFile(path, 'utf8'));
process.stdout.write(`${JSON.stringify(await replay(input), null, 2)}\n`);
