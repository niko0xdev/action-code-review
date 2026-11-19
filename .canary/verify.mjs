import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const repository = process.env.GITHUB_REPOSITORY;
const number = event.pull_request.number;
const head = event.pull_request.head.sha;
const release = JSON.parse(readFileSync('.canary/release.json', 'utf8'));
const BOT = 'github-actions[bot]';
const RELEASE_REFS = ['v3.1.0', 'v3.1', 'v3'];

async function api(path, body) {
	const response = await fetch(`https://api.github.com${path}`, {
		method: body ? 'POST' : 'GET',
		headers: {
			Authorization: `Bearer ${process.env.GH_TOKEN}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	assert(response.ok, `GitHub ${path}: HTTP ${response.status}`);
	return response.json();
}
async function pages(path) {
	const result = [];
	for (let page = 1; page <= 20; page++) {
		const batch = await api(`${path}?per_page=100&page=${page}`);
		assert(Array.isArray(batch));
		result.push(...batch);
		if (batch.length < 100) return result;
	}
	throw new Error('Pagination did not complete.');
}
function record(result) {
	const output = JSON.stringify({ mode, head, release: release.commit, ...result });
	console.log(output);
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\n\`\`\`json\n${output}\n\`\`\`\n`);
}
async function botReviews() {
	return (await pages(`/repos/${repository}/pulls/${number}/reviews`)).filter(
		(review) => review.user?.login === BOT
	);
}
async function botThreads() {
	const [owner, name] = repository.split('/');
	const query =
		'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved comments(first:100){nodes{body author{login}}}}}}}}';
	const graph = await api('/graphql', { query, variables: { owner, name, number } });
	assert(!graph.errors, 'Thread inspection failed.');
	const connection = graph.data.repository.pullRequest.reviewThreads;
	assert(!connection.pageInfo.hasNextPage, 'Thread inspection is incomplete.');
	return connection.nodes.filter((thread) =>
		thread.comments.nodes.some(
			(comment) =>
				['github-actions', BOT].includes(comment.author?.login) &&
				comment.body.includes('ai-review-id:')
		)
	);
}
const snapshotPath = (label) =>
	resolve(process.env.RUNNER_TEMP, `canary-reviews-${label}.json`);

if (mode === 'distribution') {
	const refs = process.env.RELEASE_REFS.split(',');
	for (const ref of refs) {
		assert(RELEASE_REFS.includes(ref));
		assert.equal((await api(`/repos/${repository}/commits/${ref}`)).sha, release.commit);
		const root = resolve(process.env.RUNNER_WORKSPACE, '..', '_actions', 'niko0xdev', 'action-code-review', ref);
		assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version, release.version);
		for (const [path, expected] of Object.entries(release.bundles)) {
			const data = readFileSync(resolve(root, path));
			const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
			assert.equal(blob, expected.blob, `${ref}: ${path}`);
			assert.equal(createHash('sha256').update(data).digest('hex'), expected.sha256);
			assert.equal(data.length, expected.bytes);
		}
	}
	record({ refs, downloaded_distribution_verified: true });
} else {
	const pr = await api(`/repos/${repository}/pulls/${number}`);
	assert.equal(pr.head.sha, head, 'The PR head changed during verification.');
	assert.equal(pr.merged, false, 'The canary must remain unmerged.');
	if (mode === 'content') {
		assert(pr.title.startsWith('test:'));
		assert(pr.body.includes('Do not merge'));
		assert(pr.body.includes('ACR_RELEASE_V3_1_E2E_20261120'));
		assert(pr.body.includes("Literal substitution probe: $& $$ $` $'"));
		assert(!pr.body.includes('<!-- AI will fill this section with a description of what changed -->'));
		assert(!`${pr.title}${pr.body}`.includes('—'));
		record({ actual_content_update_verified: true, literal_probe_preserved: true });
	} else if (mode === 'snapshot') {
		const reviews = await botReviews();
		writeFileSync(snapshotPath(process.env.SNAPSHOT_LABEL), JSON.stringify(reviews.map((r) => r.id)));
		record({ label: process.env.SNAPSHOT_LABEL, bot_reviews: reviews.length });
	} else if (mode === 'repeat') {
		// A repeated controlled blocking run on the same head must keep the block
		// without adding review entries beyond MAX_NEW_REVIEWS.
		const assessment = JSON.parse(process.env.REVIEW_REPORT);
		assert(assessment.counts.critical > 0, 'The controlled blocking finding is missing.');
		const label = process.env.SNAPSHOT_LABEL;
		assert(existsSync(snapshotPath(label)), `No snapshot ${label}.`);
		const before = new Set(JSON.parse(readFileSync(snapshotPath(label), 'utf8')));
		const reviews = await botReviews();
		const added = reviews.filter((r) => !before.has(r.id));
		const maxNew = Number(process.env.MAX_NEW_REVIEWS);
		assert(added.length <= maxNew, `Repeat run added ${added.length} review(s); allowed ${maxNew}.`);
		const blocking = reviews.filter((r) => r.commit_id === head && r.state === 'CHANGES_REQUESTED');
		assert(blocking.length > 0, 'GitHub has no current blocking review on this head.');
		assert.equal(reviews.filter((r) => r.state === 'APPROVED').length, 0);
		record({
			phase: 'controlled-repeat',
			label,
			added_review_ids: added.map((r) => ({ id: r.id, state: r.state, body_empty: !r.body })),
			blocking_review_ids: blocking.map((r) => r.id),
		});
	} else {
		const assessment = JSON.parse(process.env.REVIEW_REPORT);
		const reviews = await botReviews();
		const current = reviews.filter((r) => r.commit_id === head);
		const approved = current.filter((r) => r.state === 'APPROVED');
		const threads = await botThreads();
		assert(threads.length > 0, 'No actual bot finding thread exists.');
		if (process.env.CANARY_PHASE === 'negative') {
			assert(['complete', 'incomplete'].includes(assessment.status));
			assert(assessment.counts.critical + assessment.counts.high > 0, 'The live assessment did not retain a blocking fixture finding.');
			assert(current.some((r) => r.state === 'CHANGES_REQUESTED'), 'GitHub has no current blocking review.');
			assert.equal(approved.length, 0);
			record({
				phase: 'live-negative',
				status: assessment.status,
				counts: assessment.counts,
				blocking_review_ids: current.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.id),
				threads: threads.map((t) => t.id),
			});
		} else {
			assert.equal(assessment.status, 'complete');
			assert(Object.values(assessment.counts).every((n) => n === 0));
			// v3.1.0: a complete clean run lifts every earlier block by this action.
			const stillBlocking = reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
			assert.equal(stillBlocking.length, 0, `Blocking reviews remain: ${stillBlocking.map((r) => r.id)}`);
			const dismissed = reviews.filter((r) => r.state === 'DISMISSED');
			assert(dismissed.length > 0, 'No earlier blocking review was dismissed.');
			const resolved = threads.every((t) => t.isResolved);
			if (resolved) assert(approved.length > 0, 'GitHub has no actual current approval.');
			else assert.equal(approved.length, 0, 'Approval preceded thread resolution.');
			record({
				phase: 'controlled-publication',
				ref: process.env.TESTED_REF,
				dismissed_review_ids: dismissed.map((r) => r.id),
				all_threads_resolved: resolved,
				approval_ids: approved.map((r) => r.id),
			});
		}
	}
}
