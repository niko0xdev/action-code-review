/**
 * Normalized finding model used across the V2 review pipeline.
 *
 * Every harness (Pi, future alternatives) must map its output into this
 * format before validation and publishing. See docs/v2-design-spec.md §17.
 */
export const SEVERITY_ORDER = {
    critical: 3,
    high: 2,
    medium: 1,
    low: 0,
};
/** Per-severity publish caps plus the overall cap (spec §19). */
export const FINDING_LIMITS = {
    critical: 10,
    high: 10,
    medium: 10,
    low: 5,
    overall: 20,
};
//# sourceMappingURL=finding.js.map