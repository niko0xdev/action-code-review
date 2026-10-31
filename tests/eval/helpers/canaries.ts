/**
 * Synthetic secrets for redaction tests.
 *
 * Every value is assembled at runtime from fragments so the repository never
 * contains a string that a secret scanner (or push protection) would flag.
 * Fixtures refer to them with `{{canary:<name>}}` placeholders.
 */

const join = (...parts: string[]): string => parts.join('');

export interface Canary {
	/** Text planted in the hostile input. */
	value: string;
	/** The part that must never appear in any output sink. */
	core: string;
}

export const CANARIES = {
	githubToken: canary(join('gh', 'p_'), 'Zq8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'),
	openaiKey: canary(join('sk', '-proj-'), 'Qe7Ty2Ui9Op4As6Df1Gh3Jk8Lz5Xc0Vb'),
	awsAccessKey: canary(join('AK', 'IA'), 'QZ7XM2LK9PT4WV8N'),
	slackToken: canary(
		join('xo', 'xb-'),
		'1234567890123-1234567890123-AbCdEfGhIjKl'
	),
	jwt: canary(
		'',
		join(
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
			'eyJzdWIiOiJldmFsLWNhbmFyeSIsIm5hbWUiOiJ0ZXN0In0.',
			'c2lnbmF0dXJlLWNhbmFyeS1ub3QtcmVhbA'
		)
	),
	privateKey: {
		value: join(
			'-----BEGIN ',
			'PRIVATE KEY-----\n',
			'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n',
			'Zm9vYmFyYmF6Y2FuYXJ5\n',
			'-----END ',
			'PRIVATE KEY-----'
		),
		core: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
	},
	bearer: {
		value: join('Bear', 'er abcDEF123456789xyzCanaryTokenValue'),
		core: 'abcDEF123456789xyzCanaryTokenValue',
	},
	passwordAssignment: {
		value: join('pass', 'word = "Hunter2Correct-Horse"'),
		core: 'Hunter2Correct-Horse',
	},
} as const satisfies Record<string, Canary>;

export type CanaryName = keyof typeof CANARIES;

function canary(prefix: string, body: string): Canary {
	return { value: `${prefix}${body}`, core: `${prefix}${body}` };
}

/**
 * Classes the prompt-side scrubber (`scrubSecrets`) is documented to cover.
 * `redactSecrets` (publication sinks) covers all of `CANARIES`.
 */
export const PROMPT_SCRUBBED: readonly CanaryName[] = [
	'githubToken',
	'openaiKey',
	'slackToken',
	'jwt',
	'bearer',
];

const PLACEHOLDER = /\{\{canary(-zw)?:([A-Za-z]+)\}\}/g;

/** Replace every `{{canary:name}}` in a string. Unknown names throw. */
export function expandCanaries(text: string): string {
	return text.replace(PLACEHOLDER, (_match, zw: string | undefined, name) => {
		const found = CANARIES[name as CanaryName];
		if (!found) throw new Error(`Unknown canary placeholder: ${name}`);
		// `canary-zw` splits the value with zero-width spaces every 4 characters.
		return zw ? found.value.replace(/(.{4})/g, '$1\u200b') : found.value;
	});
}

/** Canary names referenced anywhere in a raw (unexpanded) value. */
export function referencedCanaries(raw: unknown): CanaryName[] {
	const names = new Set<CanaryName>();
	for (const match of JSON.stringify(raw ?? '').matchAll(PLACEHOLDER))
		names.add(match[2] as CanaryName);
	return [...names];
}

/** Recursively expand placeholders in every string of a JSON-like value. */
export function expandDeep<T>(value: T): T {
	if (typeof value === 'string') return expandCanaries(value) as T;
	if (Array.isArray(value)) return value.map(expandDeep) as T;
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value))
			out[key] = expandDeep(item);
		return out as T;
	}
	return value;
}
