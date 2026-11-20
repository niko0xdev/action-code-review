import { expect, it } from 'vitest';
import { replay } from './replay.js';

it('rejects missing captures', async () => {
	await expect(
		replay({ version: 1, revision: 'smoke', cases: [{ id: 'one' }] })
	).rejects.toThrow('Invalid case');
});

it('scores a clean captured reply deterministically', async () => {
	const manifest = {
		version: 1,
		revision: 'smoke',
		cases: [
			{
				id: 'one',
				patch: '@@ -0,0 +1 @@\n+export const size = 1;',
				reply: JSON.stringify({ findings: [], summary: 'Clean', risk: 'none' }),
				expected: [],
			},
		],
	};
	expect(await replay(manifest)).toEqual(await replay(manifest));
	expect((await replay(manifest)).score.falseBlockRate.value).toBe(0);
});
