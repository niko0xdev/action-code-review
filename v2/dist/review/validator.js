import { isChangedLine } from '../context/diff.js';
export function validateFinding(finding, changedFiles, minConfidence) {
    if (!finding.path || finding.line < 1) {
        return false;
    }
    const file = changedFiles.find((f) => f.filename === finding.path);
    if (!file) {
        return false;
    }
    if (typeof finding.confidence !== 'number' ||
        finding.confidence < minConfidence) {
        return false;
    }
    if (!file.patch) {
        return false;
    }
    return isChangedLine(file.patch, finding.line);
}
export function validateFindings(findings, changedFiles, minConfidence = 0.8) {
    return findings.filter((finding) => validateFinding(finding, changedFiles, minConfidence));
}
//# sourceMappingURL=validator.js.map