/**
 * Pi runtime provisioning (spec §22/§29 follow-up).
 *
 * The composite action installs the Pi coding agent itself, so consumer
 * repositories never see it: no workflow changes, no extra setup steps.
 * The version is pinned for reproducible installs; the install step in
 * pr-review/action.yml skips work when the pinned binary already resolves on
 * PATH (warm caches).
 */

export const PI_PACKAGE = '@earendil-works/pi-coding-agent';
/**
 * Pinned upstream release; bump deliberately and document in docs/architecture.md.
 * Mirrored in pr-review/pi-runtime/package.json and its package-lock.json.
 */
export const PI_PACKAGE_PIN = '1.5.2';
