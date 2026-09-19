export interface ReviewThreadRecord {
	resolved: boolean;
	comments: Array<{ user?: { login?: string } | null; body?: string | null }>;
}

interface ReviewThreadsResponse {
	repository?: {
		pullRequest?: {
			reviewThreads?: {
				nodes?: Array<{
					isResolved?: boolean;
					comments?: {
						nodes?: Array<{
							author?: { login?: string | null } | null;
							body?: string | null;
						} | null> | null;
					} | null;
				} | null> | null;
				pageInfo?: {
					hasNextPage?: boolean;
					endCursor?: string | null;
				} | null;
			} | null;
		} | null;
	} | null;
}

export type GraphqlClient = (
	query: string,
	variables: Record<string, unknown>
) => Promise<unknown>;

const REVIEW_THREADS_QUERY = `
query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        nodes {
          isResolved
          comments(first: 1) {
            nodes {
              author {
                login
              }
              body
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`.trim();

export async function listReviewThreads(
	graphql: GraphqlClient,
	args: { owner: string; repo: string; pullNumber: number }
): Promise<ReviewThreadRecord[]> {
	const threads: ReviewThreadRecord[] = [];
	let after: string | null = null;

	do {
		const raw = (await graphql(REVIEW_THREADS_QUERY, {
			owner: args.owner,
			repo: args.repo,
			number: args.pullNumber,
			after,
		})) as ReviewThreadsResponse;
		const connection = raw.repository?.pullRequest?.reviewThreads;
		if (!connection?.pageInfo || !Array.isArray(connection.nodes)) {
			throw new Error('GitHub GraphQL reviewThreads response is incomplete');
		}

		for (const node of connection.nodes) {
			if (!node || typeof node.isResolved !== 'boolean') {
				throw new Error('GitHub GraphQL review thread is incomplete');
			}
			const root = node.comments?.nodes?.[0];
			const author = root?.author?.login ?? undefined;
			if (!author) {
				throw new Error('GitHub GraphQL review thread is incomplete');
			}
			threads.push({
				resolved: node.isResolved,
				comments: [{ user: { login: author }, body: root?.body ?? null }],
			});
		}

		if (connection.pageInfo.hasNextPage !== true) break;
		after = connection.pageInfo.endCursor ?? null;
		if (!after) {
			throw new Error(
				'GitHub GraphQL reviewThreads pagination cursor is missing'
			);
		}
	} while (after);

	return threads;
}
