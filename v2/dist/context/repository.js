/**
 * Repository inspection helpers for the local checkout on the runner.
 * The harness works directly in the repository; these utilities support
 * the engine-side grouping and validation decisions.
 */
/** Group changed files into logical areas for sequential review (spec §31). */
export function groupByArea(files) {
    const groups = {};
    for (const file of files) {
        const area = detectArea(file);
        if (!groups[area]) {
            groups[area] = [];
        }
        groups[area].push(file);
    }
    return groups;
}
function detectArea(path) {
    const normalized = path.toLowerCase();
    if (/(^|\/)(tests?|__tests__|spec)\//.test(normalized) ||
        /\.test\.|\.spec\./.test(normalized)) {
        return 'tests';
    }
    if (/(^|\/)(auth|login|session|permission|oauth)/.test(normalized)) {
        return 'auth';
    }
    if (/(^|\/)(api|controller|route|handler|endpoint)/.test(normalized)) {
        return 'api';
    }
    if (/(database|migration|entity|repository|model)/.test(normalized)) {
        return 'database';
    }
    if (/\.(tsx|jsx)$/.test(normalized) || /components?\//.test(normalized)) {
        return 'frontend';
    }
    if (/(^|\/)\.github\//.test(normalized) ||
        /\.(ya?ml|toml)$/.test(normalized)) {
        return 'config';
    }
    return 'general';
}
//# sourceMappingURL=repository.js.map