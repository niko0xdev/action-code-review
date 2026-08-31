import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../cli.js';

const entryPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;

export { main };
export default main;

if (invokedPath === entryPath) {
	main(['pr-content']).catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
