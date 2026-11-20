/**
 * Review ledger: the state carried from one review run to the next.
 *
 * The ledger records which findings were open at a given head commit, so a
 * later run can say what is new, what is still open, what was fixed, and what
 * came back. It is stored in the sticky summary comment as a base64 payload,
 * which keeps it inert inside an HTML comment and free of any character that
 * could close it early.
 *
 * A finding is identified by its path, category, and rule (or the first words
 * of its title), never by its text: rewording a finding must not make it look
 * new, and moving it to another line must not either.
 */

import { createHash } from 'node:crypto';
import type { Finding, Severity } from '../types/finding.js';
import { normalizeTitle } from './dedupe.js';

export const LEDGER_VERSION = 1;

export type LedgerStatus = 'open' | 'fixed';

export interface LedgerFinding {
	/** Stable identity of the finding (see `findingIdentity`). */
	id: string;
	category: string;
	severity: Severity;
	title: string;
	path: string;
	line: number;
	status: LedgerStatus;
}

export interface ReviewLedger {
	v: number;
	/** Head commit the ledger was produced from. */
	head: string;
	findings: LedgerFinding[];
}

export interface LedgerDelta {
	/** Findings the previous run did not know about. */
	new: LedgerFinding[];
	/** Findings that are still open. */
	stillOpen: LedgerFinding[];
	/** Findings that the previous run had open and this run no longer has. */
	fixed: LedgerFinding[];
	/** Findings that had been fixed and are open again. */
	regressed: LedgerFinding[];
}

/** Words of the normalised title that identify the kind of issue. */
const TITLE_KEY_WORDS = 2;

/**
 * The rule key of a finding: the rule identifier when the model supplied one,
 * otherwise the first words of the normalised title. Two words survive a
 * rewording of the tail ("Missing tenant check" and "Missing tenant check on
 * export") and still separate different kinds of issue.
 */
export function ruleKey(finding: Finding): string {
	return (
		finding.ruleId?.trim() ||
		normalizeTitle(finding.title).split(' ').slice(0, TITLE_KEY_WORDS).join(' ')
	);
}

/**
 * Identity of a finding across runs: its path, its category, and its rule
 * key. The line is not part of it, so a finding that moved down the file is
 * still the same finding.
 */
export function findingIdentity(finding: Finding): string {
	return [finding.path, finding.category, ruleKey(finding)].join('|');
}

/**
 * True when two rule keys describe the same rule: equal, or one is the other
 * followed by more words.
 */
function sameRule(a: string, b: string): boolean {
	if (a === b) return true;
	const shorter = a.length <= b.length ? a : b;
	const longer = a.length <= b.length ? b : a;
	return (
		longer.startsWith(shorter) &&
		/^[\s|]/.test(longer.slice(shorter.length, shorter.length + 1))
	);
}

/**
 * True when a stored ledger entry describes the same finding as a finding of
 * the current run.
 */
export function sameFinding(entry: LedgerFinding, finding: Finding): boolean {
	return (
		entry.path === finding.path &&
		entry.category === finding.category &&
		sameRule(entry.id.split('|').slice(2).join('|'), ruleKey(finding))
	);
}

/**
 * Identity of the inline comment that carries a finding. It adds the line,
 * because a comment is anchored to a line, but not the wording, so a reworded
 * finding keeps its comment and is not posted twice.
 */
export function commentIdentity(finding: Finding): string {
	return [findingIdentity(finding), finding.line].join('|');
}

/** The short marker written into an inline comment. */
export function stableCommentId(finding: Finding): string {
	return createHash('sha256')
		.update(commentIdentity(finding))
		.digest('hex')
		.slice(0, 12);
}

/** Encode a ledger for storage in an HTML comment. */
export function encodeLedger(ledger: ReviewLedger): string {
	return Buffer.from(JSON.stringify(ledger), 'utf8').toString('base64');
}

/**
 * Decode a ledger from a stored payload. Anything that is not a readable
 * ledger of this version is ignored, so a truncated or hand-edited comment
 * cannot make the review misread its own state.
 */
export function decodeLedger(payload: string): ReviewLedger | undefined {
	try {
		const parsed = JSON.parse(
			Buffer.from(payload, 'base64').toString('utf8')
		) as ReviewLedger;
		if (
			!parsed ||
			parsed.v !== LEDGER_VERSION ||
			typeof parsed.head !== 'string' ||
			!Array.isArray(parsed.findings)
		)
			return undefined;
		const findings = parsed.findings.filter(
			(finding): finding is LedgerFinding =>
				!!finding &&
				typeof finding.id === 'string' &&
				typeof finding.category === 'string' &&
				typeof finding.path === 'string' &&
				typeof finding.line === 'number' &&
				(finding.status === 'open' || finding.status === 'fixed')
		);
		return { v: parsed.v, head: parsed.head, findings };
	} catch {
		return undefined;
	}
}

/** Build the ledger entries for the findings of the current run. */
export function ledgerEntry(finding: Finding): LedgerFinding {
	return {
		id: findingIdentity(finding),
		category: finding.category,
		severity: finding.severity,
		title: finding.title,
		path: finding.path,
		line: finding.line,
		status: 'open',
	};
}

export function ledgerEntries(findings: Finding[]): LedgerFinding[] {
	return findings.map(ledgerEntry);
}

/**
 * Compare the previous ledger with the findings of this run.
 *
 * A finding that was open before and is not in the current findings is only
 * reported as fixed when its file was reviewed again; otherwise it stays
 * open, because the run never looked at it.
 */
export function diffLedger(
	previous: ReviewLedger | undefined,
	current: Finding[],
	reviewedPaths: ReadonlySet<string>
): LedgerDelta {
	const previousEntries = previous?.findings ?? [];
	const previousOpen = previousEntries.filter(
		(finding) => finding.status === 'open'
	);
	const currentIds = new Set(current.map(findingIdentity));
	const delta: LedgerDelta = {
		new: [],
		stillOpen: [],
		fixed: [],
		regressed: [],
	};
	const matched = new Set<string>();
	for (const finding of current) {
		const wasOpen = previousOpen.find(
			(entry) => !matched.has(entry.id) && sameFinding(entry, finding)
		);
		if (wasOpen) {
			matched.add(wasOpen.id);
			delta.stillOpen.push({
				...ledgerEntry(finding),
				id: wasOpen.id,
			});
			continue;
		}
		const wasFixed = previousEntries.find(
			(entry) => entry.status === 'fixed' && sameFinding(entry, finding)
		);
		if (wasFixed) {
			matched.add(wasFixed.id);
			delta.regressed.push({ ...ledgerEntry(finding), id: wasFixed.id });
			continue;
		}
		delta.new.push(ledgerEntry(finding));
	}
	for (const finding of previousEntries) {
		if (finding.status !== 'open') continue;
		if (matched.has(finding.id)) continue;
		if (currentIds.has(finding.id)) continue;
		if (!reviewedPaths.has(finding.path)) {
			// The file was not reviewed again, so the finding is carried over.
			delta.stillOpen.push(finding);
			continue;
		}
		delta.fixed.push(finding);
	}
	return delta;
}

/**
 * The ledger for the next run: the findings that are open now, plus the ones
 * that were fixed, so a later run can recognise them coming back.
 */
export function nextLedger(
	previous: ReviewLedger | undefined,
	delta: LedgerDelta,
	head: string
): ReviewLedger {
	const reopened = new Set(delta.regressed.map((finding) => finding.id));
	const fixed = (previous?.findings ?? []).filter(
		(finding) => finding.status === 'fixed' && !reopened.has(finding.id)
	);
	return {
		v: LEDGER_VERSION,
		head,
		findings: [
			...delta.new,
			...delta.stillOpen,
			...delta.regressed,
			...fixed,
			...delta.fixed.map((f) => ({ ...f, status: 'fixed' as const })),
		],
	};
}
