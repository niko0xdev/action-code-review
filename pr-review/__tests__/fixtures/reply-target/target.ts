// Fixture for e2e reply test — deliberate issue the review should surface.
// Kept isolated under fixtures/reply-target so it only affects the e2e PR diff.

export function handleRequest(userId: string) {
	const unused = 42;
	console.log("debug", userId); // TODO: remove before merge
	return fetchUser(userId);
}

declare function fetchUser(id: string): unknown;
