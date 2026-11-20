import type { Finding } from '../types/finding.js';
import { findingCommentCategory } from './comments.js';
import { strictHumanWritePermission } from './permissions.js';
import {
	type PublisherOctokit,
	isTrustedAuthor,
	resolveSelfLogin,
} from './review.js';
import type { GraphqlClient } from './threads.js';

const query = `query ReviewFeedback($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 11, states: [MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number reviewThreads(first: 30) {
        pageInfo { hasNextPage }
        nodes { isResolved comments(first: 1) { nodes {
          body author { login __typename }
          reactions(first: 20, orderBy: {field: CREATED_AT, direction: ASC}) {
            pageInfo { hasNextPage }
            nodes { content user { login __typename } }
          }
        } } }
      } }
    }
  }
}`;

type Category = Finding['category'];
export interface FeedbackCategory {
	category: Category;
	findings: number;
	resolvedThreads: number;
	samples: number;
	positive: number;
	negative: number;
}
export interface ReviewFeedback {
	complete: boolean;
	pullRequests: number;
	categories: FeedbackCategory[];
}

type Actor = { login: string; __typename: string };
type Connection<T> = {
	nodes?: (T | null)[];
	pageInfo?: { hasNextPage: boolean };
};
type Reaction = { content: string; user: Actor | null };
type Thread = {
	isResolved?: boolean;
	comments?: Connection<{
		body: string;
		author: Actor | null;
		reactions?: Connection<Reaction>;
	}>;
};
type Response = {
	repository?: {
		pullRequests?: Connection<{
			number: number;
			reviewThreads?: Connection<Thread>;
		}>;
	};
};

export async function sampleReviewFeedback(
	octokit: PublisherOctokit,
	graphql: GraphqlClient,
	{ owner, repo, prNumber }: { owner: string; repo: string; prNumber: number }
): Promise<ReviewFeedback> {
	const result: ReviewFeedback = {
		complete: true,
		pullRequests: 0,
		categories: [],
	};
	const categories = new Map<Category, FeedbackCategory>();
	const permissions = new Map<string, boolean | null>();
	const permissionLimit = 30;
	try {
		const self = await resolveSelfLogin(octokit);
		const response = (await graphql(query, { owner, repo })) as Response;
		const pulls = response.repository?.pullRequests?.nodes;
		if (!Array.isArray(pulls)) throw new Error('Missing pull requests');
		for (const pr of pulls
			.filter((pr) => pr?.number !== prNumber)
			.slice(0, 10)) {
			if (!pr || !Number.isSafeInteger(pr.number)) {
				result.complete = false;
				continue;
			}
			result.pullRequests++;
			const threads = pr.reviewThreads;
			if (
				threads?.pageInfo?.hasNextPage !== false ||
				!Array.isArray(threads.nodes)
			)
				result.complete = false;
			const findings = new Map<
				string,
				{ category: Category; votes: Map<string, number> }
			>();
			for (const thread of threads?.nodes?.slice(0, 30) ?? []) {
				const root = thread?.comments?.nodes?.[0];
				if (
					!root ||
					typeof thread?.isResolved !== 'boolean' ||
					!root.author?.login ||
					!root.author.__typename ||
					typeof root.body !== 'string'
				) {
					result.complete = false;
					continue;
				}
				const { login, __typename } = root.author;
				const publisher =
					__typename === 'Bot' && !login.endsWith('[bot]')
						? `${login}[bot]`
						: login;
				if (
					(!self && __typename !== 'Bot') ||
					!isTrustedAuthor(publisher, self)
				)
					continue;
				const identity = findingCommentCategory(root.body);
				if (!identity) continue;
				const { id, category } = identity;
				const row = categories.get(category) ?? {
					category,
					findings: 0,
					resolvedThreads: 0,
					samples: 0,
					positive: 0,
					negative: 0,
				};
				categories.set(category, row);
				if (thread.isResolved) row.resolvedThreads++;
				const entry = findings.get(id) ?? {
					category,
					votes: new Map<string, number>(),
				};
				if (!findings.has(id)) row.findings++;
				if (entry.category !== category) {
					result.complete = false;
					continue;
				}
				findings.set(id, entry);
				const reactions = root.reactions;
				if (
					reactions?.pageInfo?.hasNextPage !== false ||
					!Array.isArray(reactions.nodes)
				)
					result.complete = false;
				for (const reaction of reactions?.nodes?.slice(0, 20) ?? []) {
					if (!reaction || typeof reaction.content !== 'string') {
						result.complete = false;
						continue;
					}
					const vote =
						reaction.content === 'THUMBS_UP'
							? 1
							: reaction.content === 'THUMBS_DOWN'
								? 2
								: 0;
					if (!vote) continue;
					const user = reaction.user;
					if (!user?.login || !user.__typename) {
						result.complete = false;
						continue;
					}
					if (
						user.__typename !== 'User' ||
						user.login.toLowerCase() === self?.toLowerCase()
					)
						continue;
					const key = user.login.toLowerCase();
					if (!permissions.has(key) && permissions.size < permissionLimit)
						permissions.set(
							key,
							await strictHumanWritePermission(octokit, owner, repo, user)
						);
					const permitted = permissions.get(key);
					if (permitted == null) result.complete = false;
					if (permitted)
						entry.votes.set(key, (entry.votes.get(key) ?? 0) | vote);
				}
			}
			for (const { category, votes } of findings.values()) {
				const row = categories.get(category);
				if (!row) continue;
				let voted = false;
				for (const vote of votes.values()) {
					if (vote === 1) row.positive++;
					else if (vote === 2) row.negative++;
					else continue;
					voted = true;
				}
				if (voted) row.samples++;
			}
		}
	} catch {
		result.complete = false;
	}
	result.categories = [...categories.values()].sort((a, b) =>
		a.category.localeCompare(b.category, 'en-GB')
	);
	return result;
}

export function suppressInlineFinding(
	finding: Finding,
	feedback: ReviewFeedback
): boolean {
	if (
		!feedback.complete ||
		finding.severity !== 'low' ||
		finding.category !== 'maintainability'
	)
		return false;
	const row = feedback.categories.find(
		({ category }) => category === finding.category
	);
	return (
		!!row &&
		row.samples >= 5 &&
		row.negative * 5 >= (row.positive + row.negative) * 4
	);
}

export function renderReviewFeedback(feedback: ReviewFeedback): string {
	return [
		'### Repository review feedback',
		'',
		`Sampled pull requests: ${feedback.pullRequests}. Evidence: ${feedback.complete ? 'complete within the sample' : 'incomplete (inline suppression disabled)'}.`,
		'',
		'| Category | Findings | Resolved threads | Voted findings | Positive votes | Negative votes |',
		'| --- | ---: | ---: | ---: | ---: | ---: |',
		...feedback.categories.map(
			(row) =>
				`| ${row.category} | ${row.findings} | ${row.resolvedThreads} | ${row.samples} | ${row.positive} | ${row.negative} |`
		),
	].join('\n');
}
