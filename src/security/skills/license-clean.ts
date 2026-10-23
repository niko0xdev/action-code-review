/**
 * Licence-clean defensive review skills.
 *
 * All prompt guidance below is original prose written for this project.
 * It is informed by ideas from permissively licensed and public references:
 * - github/codeql JS/TS security queries (MIT License)
 * - gitleaks/gitleaks secret-detection rules (MIT License)
 * - nodejs/security-wg guidance (MIT License)
 * - ossf/scorecard checks (Apache License 2.0)
 * - OWASP Cheat Sheet Series and ASVS (CC-BY-SA-4.0), used as
 *   normative references only: no verbatim text is reproduced, and each
 *   skill links to the relevant sheet instead of copying it.
 *
 * Spec reference: §7, §14, §32.
 */

import type { SecuritySkill } from './registry.js';

export const LICENSE_CLEAN_SKILLS: SecuritySkill[] = [
	{
		id: 'payments-race-idempotency',
		domain: 'payments',
		title: 'Payment Safety: Race Conditions & Idempotency',
		summary:
			'Defensive review of money-movement code for double-charge races, missing idempotency keys, and check-then-act gaps.',
		promptInstructions: `
### Domain Skill: Payment Safety
- Verify that every charge, refund, payout, and credit path carries an idempotency key end to end (API request, queue message, ledger write), and that retries reuse the same key.
- Check for check-then-act races: balance reads followed by separate debits must run inside a single transaction with row-level locking or a conditional write (e.g. UPDATE ... WHERE balance >= amount).
- Ensure webhook handlers (payment succeeded, refunded, disputed) are idempotent and verify the provider HMAC signature before mutating state.
- Look for amount handling in floating point; monetary values must use integer minor units or decimal types, never float.
- Confirm state-machine transitions (pending -> captured -> refunded) reject out-of-order or repeated events.
Reference: OWASP ASVS sections on business-logic and transaction integrity.
`,
		cweList: ['CWE-367', 'CWE-841', 'CWE-682'],
		owaspList: ['A04:2021-Insecure Design'],
	},
	{
		id: 'client-xss-encoding',
		domain: 'client-xss',
		title: 'Client-Side XSS: Contextual Output Encoding',
		summary:
			'Defensive review of DOM sinks, template rendering, and sanitiser use for reflected, stored, and DOM-based XSS.',
		promptInstructions: `
### Domain Skill: Client-Side XSS Prevention
- Flag unencoded flows into dangerous sinks: innerHTML, outerHTML, insertAdjacentHTML, document.write, v-html, [innerHTML], and bypassSecurityTrust* APIs.
- Verify that server data rendered into HTML uses contextual encoding (HTML body, attribute, JS string, URL each have distinct rules); a single generic escape function is not sufficient.
- Check that any HTML sanitiser is applied on the way out with an explicit allowlist, and that sanitised output is never passed through a second decoding step.
- Ensure URLs built from user input reject javascript:, data:, and vbscript: schemes before assignment to href, src, or location.
- Confirm frameworks run with auto-escaping enabled and that explicit unescaped-output markers are each justified.
Reference: OWASP XSS Prevention Cheat Sheet (rules 0-6).
`,
		cweList: ['CWE-79', 'CWE-116', 'CWE-20'],
		owaspList: ['A03:2021-Injection'],
	},
	{
		id: 'secrets-entropy-hygiene',
		domain: 'secrets',
		title: 'Secret Hygiene: Entropy Scan & Allowlisting',
		summary:
			'Defensive review for leaked credentials, high-entropy tokens, and private keys in diffs, with allowlist discipline.',
		promptInstructions: `
### Domain Skill: Secret Hygiene
- Flag added lines matching credential shapes: cloud access keys, provider tokens (ghp_, gho_, xox*, sk-live-*), generic api_key/secret assignments, and PEM/OpenSSH private-key blocks.
- Treat any high-entropy string (long base64/hex token) in source, tests, fixtures, or docs as a leak until proven to be a documented placeholder.
- Verify test fixtures use obviously fake values (EXAMPLE, test_, deadbeef runs) and that allowlists pin exact file paths, never broad directory excludes.
- Check that new ignore rules (.gitignore, gitleaks allowlist) do not silently suppress real findings, and that rotation is requested for any key that ever reached the remote.
- Confirm no secret travels in URLs, logs, error messages, or client-side bundles.
Reference: gitleaks default rule taxonomy; OWASP Secrets Management Cheat Sheet.
`,
		cweList: ['CWE-798', 'CWE-312', 'CWE-532'],
		owaspList: ['A07:2021-Identification and Authentication Failures'],
	},
	{
		id: 'crypto-hygiene-randomness',
		domain: 'cryptography',
		title: 'Cryptographic Hygiene & Randomness',
		summary:
			'Defensive review of algorithm choice, key derivation, randomness sources, and certificate validation.',
		promptInstructions: `
### Domain Skill: Cryptographic Hygiene
- Reject broken primitives: MD5, SHA1, DES/3DES, RC4, and ECB mode for any security purpose; require AES-GCM or ChaCha20-Poly1305, SHA-256 or better.
- Verify password storage uses a memory-hard or adaptive KDF (Argon2id, scrypt, bcrypt, PBKDF2 with high iteration counts), each with a unique random salt.
- Check that tokens, nonces, and IVs come from a cryptographic RNG (crypto.randomBytes, getRandomValues) and are never reused across messages; Math.random is not acceptable.
- Ensure TLS certificate validation is enabled and hostname verification is not disabled for convenience in any environment.
- Flag hard-coded keys, IVs, or salts, and keys loaded from checked-in files instead of a secret manager or environment.
Reference: OWASP Cryptographic Storage Cheat Sheet; Node.js security working group guidance.
`,
		cweList: ['CWE-327', 'CWE-338', 'CWE-798', 'CWE-295'],
		owaspList: ['A02:2021-Cryptographic Failures'],
	},
];

/**
 * Validation gate appended to every non-empty skill render.
 * Original logic: each finding must carry file, line, data flow, and impact.
 */
export const REVIEW_VALIDATION_GATE = `#### Review Validation Gate
Every reported finding must answer all seven questions; otherwise drop it:
1. Which exact file and line contains the vulnerable sink?
2. Where does the untrusted input originate (request, webhook, file, env)?
3. What is the data flow from source to sink (name each hop)?
4. What breaks if exploited (confidentiality, integrity, availability, money)?
5. What is the minimal defensive fix (parameterise, encode, allowlist, sign)?
6. Is there a safe pattern already in this codebase to mirror?
7. Could this be a false positive, and what evidence rules that out?
`;
