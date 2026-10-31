/**
 * Secret redaction utility for security logs, summaries, SARIF, and comments.
 * Spec reference: §21.
 *
 * Every detector is linear in the input size: regexes use bounded or
 * non-overlapping quantifiers, and the JWT and private-key detectors scan by
 * hand so that a hostile input cannot trigger quadratic backtracking.
 */

interface Span {
	start: number;
	end: number;
	label: string;
}

interface Detector {
	name: string;
	find(text: string): Span[];
}

/**
 * Regex detector. With a capture group only the capture is redacted, by its
 * own offsets (`d` flag), so a key that equals its value is not mistaken for
 * the value.
 */
function regexDetector(name: string, pattern: RegExp): Detector {
	const label = `[REDACTED_${name.toUpperCase()}]`;
	return {
		name,
		find(text) {
			const spans: Span[] = [];
			pattern.lastIndex = 0;
			for (const m of text.matchAll(pattern)) {
				const group = m.indices?.slice(1).find(Boolean) ?? m.indices?.[0];
				const [start, end] = group ?? [0, 0];
				if (end > start) spans.push({ start, end, label });
			}
			return spans;
		},
	};
}

const isBase64Url = (code: number): boolean =>
	(code >= 48 && code <= 57) ||
	(code >= 65 && code <= 90) ||
	(code >= 97 && code <= 122) ||
	code === 45 ||
	code === 95;

function runEnd(text: string, from: number): number {
	let i = from;
	while (i < text.length && isBase64Url(text.charCodeAt(i))) i++;
	return i;
}

/** `eyJ<10+>.eyJ<10+>.<10+>`, scanned by hand; each segment is read at most three times. */
const jwtDetector: Detector = {
	name: 'jwt_token',
	find(text) {
		const spans: Span[] = [];
		let from = 0;
		for (;;) {
			const i = text.indexOf('eyJ', from);
			if (i < 0) break;
			const r1 = runEnd(text, i + 3);
			let matched = -1;
			if (
				r1 - (i + 3) >= 10 &&
				text[r1] === '.' &&
				text.startsWith('eyJ', r1 + 1)
			) {
				const r2 = runEnd(text, r1 + 4);
				if (r2 - (r1 + 4) >= 10 && text[r2] === '.') {
					const r3 = runEnd(text, r2 + 1);
					if (r3 - (r2 + 1) >= 10) matched = r3;
				}
			}
			if (matched >= 0) {
				spans.push({ start: i, end: matched, label: '[REDACTED_JWT_TOKEN]' });
				from = matched;
			} else {
				// Every later start inside this run ends at r1 and fails the same way.
				from = Math.max(i + 1, r1);
			}
		}
		return spans;
	},
};

const PEM_BEGIN =
	/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/y;
const PEM_END = /-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/y;

/**
 * BEGIN marker, then the nearest END marker, however far. The next END position
 * is cached and only moves forward, so a run of BEGIN markers costs linear time overall.
 */
const privateKeyDetector: Detector = {
	name: 'private_key',
	find(text) {
		const spans: Span[] = [];
		let cursor = 0;
		let nextEnd = -1;
		let noMoreEnds = false;
		for (;;) {
			const begin = text.indexOf('-----BEGIN ', cursor);
			if (begin < 0) break;
			PEM_BEGIN.lastIndex = begin;
			const header = PEM_BEGIN.exec(text);
			if (!header) {
				cursor = begin + 1;
				continue;
			}
			const bodyStart = begin + header[0].length;
			if (nextEnd >= 0 && nextEnd < bodyStart) nextEnd = -1;
			let found = -1;
			for (;;) {
				if (nextEnd < 0 && !noMoreEnds) {
					nextEnd = text.indexOf('-----END ', bodyStart);
					noMoreEnds = nextEnd < 0;
				}
				if (nextEnd < 0) break;
				PEM_END.lastIndex = nextEnd;
				const tail = PEM_END.exec(text);
				if (tail) {
					found = nextEnd + tail[0].length;
					break;
				}
				nextEnd = text.indexOf('-----END ', nextEnd + 1);
				noMoreEnds = nextEnd < 0;
			}
			if (found < 0) {
				cursor = bodyStart;
				continue;
			}
			spans.push({
				start: begin,
				end: found,
				label: '[REDACTED_PRIVATE_KEY]',
			});
			cursor = found;
		}
		return spans;
	},
};

const DETECTORS: Detector[] = [
	// GitHub Tokens (PAT, OAuth, fine-grained, app)
	regexDetector(
		'github_token',
		/(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{16,255}/dg
	),
	// OpenAI API Key
	regexDetector(
		'openai_key',
		/sk-(?:proj-|svcacct-|admin-)?[a-zA-Z0-9_-]{20,80}/dg
	),
	// AWS Access Key ID
	regexDetector(
		'aws_access_key',
		/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/dg
	),
	// AWS Secret Access Key (heuristic assignment); the quote may be JSON-escaped.
	regexDetector(
		'aws_secret_key',
		/(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*(?:\\?["'])?([a-zA-Z0-9/+=]{40})(?:\\?["'])?/dgi
	),
	// Private Keys (RSA, EC, OpenSSH, PGP)
	privateKeyDetector,
	// Slack Tokens
	regexDetector(
		'slack_token',
		/xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/dg
	),
	// JWT Tokens
	jwtDetector,
	// Generic API keys and Bearer tokens
	regexDetector('bearer_token', /Bearer\s+([a-zA-Z0-9\-._~+/]+=*)/dgi),
	// Generic passwords in URLs or assignments, with raw or JSON-escaped quotes.
	// Raw: escape pairs belong to the value. Escaped (`\"`, as in serialised
	// JSON): the value stops at the first escaped quote that is followed by a
	// JSON separator, so neighbouring fields survive, and it never ends in a
	// lone backslash, so the JSON stays valid after redaction.
	regexDetector(
		'password_assignment',
		/(?:password|passwd|secret)\s*[:=]\s*(?:\\["']((?:[^"'\s\\]|\\\\|\\[^"'\\]|\\["'](?=[^,}\]:\s])){8,})\\["']|["']((?:[^"'\s\\]|\\.){8,})["'])/dgi
	),
];

/**
 * Characters that render as nothing (or only alter the glyph before them) and
 * so can hide a token from a pattern: format characters (soft hyphen, zero
 * width, bidi controls, invisible operators, tag characters), the combining
 * grapheme joiner, Mongolian and general variation selectors, and Hangul
 * fillers. Ordinary spaces (U+00A0, U+3000, U+2028) are deliberately kept.
 */
const INVISIBLE_SOURCE =
	'[\\p{Cf}\\u034f\\u115f\\u1160\\u180b-\\u180d\\u3164\\uffa0\\ufe00-\\ufe0f\\u{e0100}-\\u{e01ef}]';
const INVISIBLE = new RegExp(INVISIBLE_SOURCE, 'u');
const INVISIBLE_ALL = new RegExp(INVISIBLE_SOURCE, 'gu');

/** Spans in `visible` coordinates, sorted, with overlaps merged (first label wins). */
function collectSpans(visible: string): Span[] {
	const all: Array<Span & { order: number }> = [];
	DETECTORS.forEach((detector, order) => {
		for (const span of detector.find(visible)) all.push({ ...span, order });
	});
	all.sort((a, b) => a.start - b.start || a.order - b.order);
	const merged: Span[] = [];
	for (const span of all) {
		const last = merged[merged.length - 1];
		if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
		else merged.push({ start: span.start, end: span.end, label: span.label });
	}
	return merged;
}

/**
 * Redact sensitive secrets from raw text.
 *
 * Matching runs on a copy without invisible characters; the matching spans of
 * the original are replaced. Text without a match is returned unchanged, and
 * invisible characters inside a redacted span go with it.
 */
export function redactSecrets(text: string): string {
	if (!text) return text;
	if (!INVISIBLE.test(text)) return applySpans(text, collectSpans(text));
	// removedAt[k]: visible characters before the k-th invisible one;
	// removedTotal[k]: code units removed up to and including it.
	const removedAt: number[] = [];
	const removedTotal: number[] = [];
	let removed = 0;
	const chunks: string[] = [];
	let last = 0;
	let visibleLength = 0;
	for (const m of text.matchAll(INVISIBLE_ALL)) {
		const at = m.index ?? 0;
		chunks.push(text.slice(last, at));
		visibleLength += at - last;
		removedAt.push(visibleLength);
		removed += m[0].length;
		removedTotal.push(removed);
		last = at + m[0].length;
	}
	chunks.push(text.slice(last));
	const spans = collectSpans(chunks.join(''));
	if (spans.length === 0) return text;
	// Original index of the visible character at `index`.
	const original = (index: number): number => {
		let lo = 0;
		let hi = removedAt.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (removedAt[mid] <= index) lo = mid + 1;
			else hi = mid;
		}
		return index + (lo > 0 ? removedTotal[lo - 1] : 0);
	};
	return applySpans(
		text,
		spans.map((s) => ({
			...s,
			start: original(s.start),
			end: original(s.end - 1) + 1,
		}))
	);
}

function applySpans(text: string, spans: Span[]): string {
	if (spans.length === 0) return text;
	let out = '';
	let cursor = 0;
	for (const span of spans) {
		out += text.slice(cursor, span.start) + span.label;
		cursor = span.end;
	}
	return out + text.slice(cursor);
}

/**
 * Check if a string contains known secret patterns.
 */
export function containsSecret(text: string): boolean {
	if (!text) return false;
	return collectSpans(text.replace(INVISIBLE_ALL, '')).length > 0;
}
