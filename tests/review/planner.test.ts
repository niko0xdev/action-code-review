import { describe, expect, it } from 'vitest';
import { planReviewGroups } from '../../src/review/planner.js';
import type { ReviewContext } from '../../src/types/context.js';

function makeContext(files: string[]): ReviewContext {
	return {
		repository: { owner: 'acme', repo: 'widget' },
		pullRequest: {
			number: 3,
			title: 'T',
			body: '',
			author: 'a',
			headRef: 'h',
			baseRef: 'main',
			headSha: 's1',
			baseSha: 's0',
			draft: false,
		},
		diff: {
			files: files.map((filename) => ({
				filename,
				status: 'modified' as const,
				additions: 1,
				deletions: 0,
				changes: 1,
				patch: '@@ -1 +1,2 @@\n a\n+b',
			})),
			totalAdditions: files.length,
			totalDeletions: 0,
		},
		profiles: [{ id: 'nodejs', evidence: ['package.json'] }],
		repositoryPath: '/repo',
	};
}

describe('planReviewGroups', () => {
	it('returns a single group for small PRs', () => {
		const groups = planReviewGroups(makeContext(['a.ts', 'b.ts']), 10);
		expect(groups).toHaveLength(1);
		expect(groups[0].files).toEqual(['a.ts', 'b.ts']);
	});

	it('partitions large PRs into area-based groups', () => {
		const files = Array.from({ length: 30 }, (_, i) => `src/api/r${i}.ts`);
		files.push('src/components/Widget.tsx', 'tests/app.test.ts');
		const groups = planReviewGroups(makeContext(files), 10);
		expect(groups.length).toBeGreaterThan(1);
		const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
		expect(totalFiles).toBe(32);
	});
});
