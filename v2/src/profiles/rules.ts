import type { ProfileId } from '../types/context.js';

/**
 * Profile-specific review rules (spec §10–§15), injected into the harness
 * prompt. Universal rules (spec §10) are always included; profile rules
 * add stack-specific concerns.
 */

export const UNIVERSAL_RULES = [
	'Review for: correctness, security, regression, error handling, data integrity, concurrency, performance, maintainability, testing impact, backward compatibility.',
	'Do NOT produce findings solely for formatting, personal style preference, naming preference, lint issues already enforced automatically, unchanged legacy code, or pure speculation.',
	'High signal is more important than comment count.',
].join('\n');

const PROFILE_RULES: Record<ProfileId, string> = {
	react: [
		'React correctness:',
		'- incorrect hook dependencies',
		'- state synchronization bugs, stale closures',
		'- unnecessary effects, incorrect memoization',
		'- render loops, incorrect key usage',
		'- controlled/uncontrolled input switches',
		'- race conditions in requests',
		'Frontend performance:',
		'- unnecessary rerenders, large client bundles',
		'- duplicate network requests, blocking operations',
		'- expensive computation during render',
		'Accessibility:',
		'- semantic HTML, keyboard navigation, form labels',
		'- focus behavior, ARIA misuse',
		'Avoid subjective visual design comments unless a functional UX problem is clear.',
	].join('\n'),

	nextjs: [
		'NextJS specifics:',
		'- Server vs Client Component boundaries; "use client" misuse',
		'- server-only secret exposure into client bundles',
		'- SSR/hydration problems',
		'- routing, middleware, server actions, route handlers',
		'- cache semantics, dynamic vs static rendering',
		'- metadata, image optimization',
	].join('\n'),

	nestjs: [
		'NestJS/NodeJS backend specifics:',
		'- controller and DTO validation',
		'- authentication, authorization, tenant isolation',
		'- guards, interceptors, exception handling',
		'- dependency injection misuse',
		'- transaction boundaries, database query behavior, N+1 queries',
		'- pagination, input sanitization, API compatibility',
		'Pay particular attention to:',
		'- missing await, Promise.all misuse, unhandled rejection',
		'- race conditions, incorrect transaction scope',
		'- authorization performed after data access',
		'- missing tenant conditions in queries',
	].join('\n'),

	nodejs: [
		'NodeJS backend specifics:',
		'- async handling: missing await, floating promises, unhandled rejections',
		'- resource leaks (streams, handles, timers)',
		'- error propagation through callbacks and event emitters',
		'- API compatibility for exported modules',
		'- concurrency issues in shared mutable state',
	].join('\n'),

	python: [
		'Python/uv specifics:',
		'- typing correctness, async/await misuse',
		'- exception handling breadth and correctness',
		'- resource management and context managers',
		'- mutable default arguments',
		'- dependency changes must review both pyproject.toml and uv.lock when applicable',
		'- Pydantic model contracts; FastAPI behavior if detected',
		'Do not complain about style handled by Ruff/formatters unless it causes an actual correctness issue.',
	].join('\n'),

	swift: [
		'Swift/iOS specifics:',
		'- Swift concurrency: async/await, Actors, MainActor usage, Sendable',
		'- retain cycles, weak/unowned references',
		'- optionals and error handling',
		'- UI thread safety, SwiftUI state management, UIKit lifecycle',
		'- networking and persistence correctness, API compatibility',
		'Particularly inspect Task/TaskGroup lifecycles, actor boundaries, Observable/ObservableObject/State/StateObject/Binding usage.',
		'Focus on functional problems rather than Swift style preferences.',
	].join('\n'),

	kotlin: [
		'Kotlin/Android specifics:',
		'- coroutines and structured concurrency',
		'- Flow/StateFlow collection lifecycle awareness',
		'- ViewModel/Lifecycle integration',
		'- Compose state and recomposition problems',
		'- memory leaks, context leaks, null safety',
		'- Room transactions, networking, permissions',
		'Pay particular attention to GlobalScope usage, incorrect Dispatchers, lifecycle-unaware collection, unbounded coroutine creation, incorrect remember usage.',
	].join('\n'),

	typescript: [
		'TypeScript specifics:',
		'- type-level regressions: any-escapes that weaken public contracts',
		'- strict-mode violations the compiler would catch later',
		'- generic constraints too loose or too tight for callers',
		'- tsconfig changes and their project-wide impact',
	].join('\n'),

	javascript: [
		'JavaScript specifics:',
		'- implicit type coercions and == vs === pitfalls',
		'- var/let/const scoping issues',
		'- missing error handling in async flows',
	].join('\n'),
};

/** Universal + profile rules as one prompt fragment. */
export function profileRules(profileId: ProfileId): string {
	const specific = PROFILE_RULES[profileId];
	if (!specific) {
		return UNIVERSAL_RULES;
	}
	return `${UNIVERSAL_RULES}\n${specific}`;
}

/** Merge rule sets for multiple detected profiles without duplication. */
export function combinedRules(profileIds: ProfileId[]): string {
	if (profileIds.length === 0) {
		return UNIVERSAL_RULES;
	}
	const sections = profileIds.map((id) => PROFILE_RULES[id]).filter(Boolean);
	return [UNIVERSAL_RULES, ...sections].join('\n');
}
