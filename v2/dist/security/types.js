/**
 * Core security domain types and schemas for action-code-review.
 * Spec reference: §8, §10, §26.
 */
export const SEVERITY_RANKS = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
};
export const CONFIDENCE_RANKS = {
    confirmed: 3,
    high: 2,
    medium: 1,
    low: 0,
};
export const RISK_LEVEL_ORDER = {
    critical_surface: 3,
    high: 2,
    medium: 1,
    low: 0,
};
//# sourceMappingURL=types.js.map