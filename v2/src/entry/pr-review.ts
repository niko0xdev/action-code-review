import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../cli.js';

const entryPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;

/**
 * Entry bundle for the pr-review compatibility adapter. The adapter's
 * dist imports this file when the V2 engine is present in the checkout.
 */
export { main };
export default main;

if (invokedPath === entryPath) {
	main(['pr-review']).catch((error) => {
		// eslint-disable-next-line no-console
		console.error(error);
		process.exitCode = 1;
	});
}
