import { groupByArea } from '../context/repository.js';
import type { ReviewContext } from '../types/context.js';

/**
 * Review planning (spec §31): small PRs go through in one pass; large PRs
 * are partitioned into logical areas and reviewed sequentially.
 */

export interface ReviewGroup {
	area: string;
	files: string[];
}

export function planReviewGroups(
	context: ReviewContext,
	maxFilesPerGroup = 15
): ReviewGroup[] {
	const filenames = context.diff.files.map((f) => f.filename);
	if (filenames.length <= maxFilesPerGroup) {
		return [{ area: 'all', files: filenames }];
	}

	const byArea = groupByArea(filenames);
	const groups: ReviewGroup[] = [];
	for (const [area, files] of Object.entries(byArea)) {
		for (let i = 0; i < files.length; i += maxFilesPerGroup) {
			groups.push({ area, files: files.slice(i, i + maxFilesPerGroup) });
		}
	}
	return groups;
}
