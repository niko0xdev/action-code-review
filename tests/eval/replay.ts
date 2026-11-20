import { runReview } from '../../src/review/reviewer.js';
import { makeContext, stubHarness } from './helpers/replay.js';
import { labelByAnchor, scoreCases } from './scoring.js';

export async function replay(input: unknown) {
	const manifest = input as {
		version?: unknown;
		revision?: unknown;
		cases?: unknown[];
	} | null;
	if (
		manifest?.version !== 1 ||
		typeof manifest.revision !== 'string' ||
		!manifest.revision ||
		!Array.isArray(manifest.cases) ||
		!manifest.cases.length
	)
		throw new Error('Invalid replay manifest');
	const ids = new Set<string>();
	const scored = [];
	const path = 'src/example.ts';
	for (const raw of manifest.cases) {
		const c = raw as {
			id: string;
			patch: string;
			reply: string;
			expected: number[];
		} | null;
		if (
			!c ||
			typeof c.id !== 'string' ||
			!c.id ||
			ids.has(c.id) ||
			typeof c.patch !== 'string' ||
			!c.patch ||
			typeof c.reply !== 'string' ||
			!c.reply ||
			!Array.isArray(c.expected) ||
			!c.expected.every((line) => Number.isSafeInteger(line) && line > 0) ||
			new Set(c.expected).size !== c.expected.length
		)
			throw new Error('Invalid case in replay manifest');
		ids.add(c.id);
		const result = await runReview(
			makeContext([{ filename: path, status: 'modified', patch: c.patch }]),
			stubHarness(c.reply)
		);
		if (result.reviewStatus !== 'complete')
			throw new Error(`Incomplete replay for ${c.id}`);
		scored.push({
			id: c.id,
			cleanPr: c.expected.length === 0,
			...labelByAnchor(
				result.findings,
				c.expected.map((line) => ({ path, line }))
			),
		});
	}
	return { version: 1, revision: manifest.revision, score: scoreCases(scored) };
}
