# Live review fixture

This directory holds an intentionally buggy module used to verify the action's
end-to-end behaviour on a real pull request: inline comments, severity
escalation, and the decision banner.

`account-service.ts` contains deliberate defects and must never be imported by
production code or by the test suite.

Delete this directory once the live verification is recorded.
