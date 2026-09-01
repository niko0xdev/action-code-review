import * as core from '@actions/core';
const SUPPORTED_EVENTS = new Set([
    'pull_request',
    'pull_request_target',
    'workflow_dispatch',
    'schedule',
]);
const SUPPORTED_ACTIONS = new Set([
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
]);
export function resolveReviewMode(raw) {
    if (!raw || raw === 'review')
        return 'review';
    if (raw === 'auto' || raw === 'security' || raw === 'agent')
        return raw;
    core.warning(`Unknown mode "${raw}" — falling back to "review" (only "auto", "review", "security", "agent" are supported).`);
    return 'review';
}
export function isSupportedReviewEvent(eventName, action) {
    if (!eventName)
        return false;
    if (!SUPPORTED_EVENTS.has(eventName))
        return false;
    if (!action)
        return true;
    return SUPPORTED_ACTIONS.has(action);
}
export function validateReviewEvent(eventName, action) {
    if (!eventName)
        return { supported: true };
    if (!SUPPORTED_EVENTS.has(eventName)) {
        return {
            supported: false,
            reason: `event "${eventName}" is not pull_request/pull_request_target`,
        };
    }
    if (action && !SUPPORTED_ACTIONS.has(action)) {
        return {
            supported: false,
            reason: `action "${action}" is not one of ${[...SUPPORTED_ACTIONS].join(', ')}`,
        };
    }
    return { supported: true };
}
//# sourceMappingURL=detector.js.map