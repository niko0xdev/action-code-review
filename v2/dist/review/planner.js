import { groupByArea } from '../context/repository.js';
export function planReviewGroups(context, maxFilesPerGroup = 15) {
    const filenames = context.diff.files.map((f) => f.filename);
    if (filenames.length <= maxFilesPerGroup) {
        return [{ area: 'all', files: filenames }];
    }
    const byArea = groupByArea(filenames);
    const groups = [];
    for (const [area, files] of Object.entries(byArea)) {
        for (let i = 0; i < files.length; i += maxFilesPerGroup) {
            groups.push({ area, files: files.slice(i, i + maxFilesPerGroup) });
        }
    }
    return groups;
}
//# sourceMappingURL=planner.js.map