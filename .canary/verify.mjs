import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const repository = process.env.GITHUB_REPOSITORY;
const number = event.pull_request.number;
const head = event.pull_request.head.sha;
const release = JSON.parse(readFileSync('.canary/release.json', 'utf8'));
async function api(path, body) {
	const response = await fetch(`https://api.github.com${path}`, {
		method: body ? 'POST' : 'GET',
		headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
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
if (mode === 'distribution') {
	const refs = process.env.RELEASE_REFS.split(',');
	for (const ref of refs) {
		assert(['v3.0.0', 'v3.0', 'v3'].includes(ref));
		assert.equal((await api(`/repos/${repository}/commits/${ref}`)).sha, release.commit);
		const root = resolve(process.env.RUNNER_WORKSPACE, '..', '_actions', 'niko0xdev', 'action-code-review', ref);
		assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version, '3.0.0');
		for (const [path, expected] of Object.entries(release.bundles)) {
			const data = readFileSync(resolve(root, path));
			const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
			assert.equal(blob, expected.blob, `${ref}: ${path}`);
			assert.equal(createHash('sha256').update(data).digest('hex'), expected.sha256);
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
		assert(pr.body.includes('ACR_RELEASE_V3_E2E_20261118'));
		assert(pr.body.includes("Literal substitution probe: $& $$ $` $'"));
		assert(!pr.body.includes('<!-- AI will fill this section with a description of what changed -->'));
		assert(!`${pr.title}${pr.body}`.includes('\u2014'));
		record({ actual_content_update_verified: true, literal_probe_preserved: true });
	} else {
		const assessment = JSON.parse(process.env.REVIEW_REPORT);
		const reviews = await pages(`/repos/${repository}/pulls/${number}/reviews`);
		const current = reviews.filter(r => r.commit_id === head && r.user.login === 'github-actions[bot]');
		const approved = current.filter(r => r.state === 'APPROVED');
		const [owner, name] = repository.split('/');
		const query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved comments(first:100){nodes{body author{login}}}}}}}}';
		const graph = await api('/graphql', { query, variables: { owner, name, number } });
		assert(!graph.errors, 'Thread inspection failed.');
		const connection = graph.data.repository.pullRequest.reviewThreads;
		assert(!connection.pageInfo.hasNextPage, 'Thread inspection is incomplete.');
		const threads = connection.nodes.filter(t => t.comments.nodes.some(c => ['github-actions', 'github-actions[bot]'].includes(c.author?.login) && c.body.includes('ai-review-id:')));
		assert(threads.length > 0, 'No actual bot finding thread exists.');
		if (process.env.CANARY_PHASE === 'negative') {
			assert(['complete', 'incomplete'].includes(assessment.status));
			assert(assessment.counts.critical + assessment.counts.high > 0, 'The live assessment did not retain a blocking fixture finding.');
			assert(current.some(r => r.state === 'CHANGES_REQUESTED'), 'GitHub has no current blocking review.');
			assert.equal(approved.length, 0);
			record({ phase: 'live-negative', status: assessment.status, counts: assessment.counts, blocking_review_ids: current.filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.id), threads: threads.map(t => t.id) });
		} else {
			assert.equal(assessment.status, 'complete');
			assert(Object.values(assessment.counts).every(n => n === 0));
			const resolved = threads.every(t => t.isResolved);
			if (resolved) assert(approved.length > 0, 'GitHub has no actual current approval.');
			else assert.equal(approved.length, 0, 'Approval preceded thread resolution.');
			record({ phase: 'controlled-publication', all_threads_resolved: resolved, approval_ids: approved.map(r => r.id), ref: process.env.TESTED_REF });
		}
	}
}
