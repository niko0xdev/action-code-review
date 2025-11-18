'use client';

import { useState } from 'react';

export default function HomePage(): JSX.Element {
  const [repository, setRepository] = useState('niko0xdev/action-code-review');

  return (
    <main className="container">
      <section>
        <h1>Next.js + AI Code Review</h1>
        <p>
          This mini app exists purely as a playground for the{' '}
          <code>niko0xdev/action-code-review</code> GitHub Action. Submit pull requests against
          this example to watch the AI bot annotate diffs automatically.
        </p>
      </section>

      <section className="card">
        <h2>Repository under review</h2>
        <label className="label">
          <span>owner/repo</span>
          <input value={repository} onChange={event => setRepository(event.target.value)} />
        </label>
        <p className="muted">
          Update the repository slug above and push a PR – the workflow configured in{' '}
          <code>.github/workflows/pr-review.yml</code> will call into the action bundled in this
          monorepo (see README).
        </p>
      </section>

      <section className="card">
        <h2>Why this matters</h2>
        <ul>
          <li>Instant feedback on pull requests with inline comments.</li>
          <li>Tailored to web apps thanks to the Next.js sample.</li>
          <li>No need to leave GitHub – the review bot posts everything there.</li>
        </ul>
      </section>
    </main>
  );
}
