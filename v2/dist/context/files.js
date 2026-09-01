/**
 * Default ignore rules (spec §32). Generated artifacts, snapshots,
 * lockfiles and vendor code never consume review context. Dependency
 * manifests stay reviewable even though lockfiles do not.
 */
export const DEFAULT_IGNORE_PATTERNS = [
    /node_modules\//,
    /(^|\/)dist\//,
    /(^|\/)build\//,
    /(^|\/)coverage\//,
    /(^|\/)\.next\//,
    /(^|\/)vendor\//,
    /(^|\/)generated\//,
    /\.min\.js$/,
    /\.map$/,
    /\.snap$/,
    /(^|\/)__snapshots__\//,
];
const LOCKFILES = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'uv.lock',
    'poetry.lock',
    'Cargo.lock',
    'composer.lock',
    'Gemfile.lock',
]);
/** Dependency manifests are always reviewable (spec §32). */
const MANIFESTS = new Set([
    'package.json',
    'pyproject.toml',
    'Podfile',
    'Package.swift',
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
]);
export function isLockfile(path) {
    const base = path.split('/').pop() ?? path;
    return LOCKFILES.has(base);
}
export function isReviewable(file) {
    if (MANIFESTS.has(file.filename)) {
        return true;
    }
    if (isLockfile(file.filename)) {
        return false;
    }
    return !DEFAULT_IGNORE_PATTERNS.some((pattern) => pattern.test(file.filename));
}
/**
 * Filter to reviewable files, then keep the highest-impact ones when the
 * count exceeds the cap (spec §31: prioritize source over generated).
 */
export function prioritizeFiles(files, maxFiles) {
    return files
        .filter(isReviewable)
        .sort((a, b) => b.changes - a.changes)
        .slice(0, maxFiles);
}
//# sourceMappingURL=files.js.map