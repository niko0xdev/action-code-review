import { main } from '../cli.js';

/**
 * Entry bundle for the pr-review compatibility adapter. The adapter's
 * dist imports this file when the V2 engine is present in the checkout.
 */
export { main };
export default main;

// Execute when run as the action entry process.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
	main(['pr-review']).catch((error) => {
		// eslint-disable-next-line no-console
		console.error(error);
		process.exitCode = 1;
	});
}
