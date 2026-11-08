/**
 * Chronicle — Real GitHub PR ingestion.
 *
 * Given a `https://github.com/{owner}/{repo}/pull/{n}` URL, fetches the real PR
 * title and body from the GitHub public REST API:
 *   GET https://api.github.com/repos/{owner}/{repo}/pulls/{number}
 *
 * Unauthenticated calls are limited to 60 req/hr per IP. If a GITHUB_TOKEN
 * env var exists it is attached (5000 req/hr) — otherwise the request
 * degrades gracefully to the pasted local text.
 */

const GITHUB_PR_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export interface GithubPrEnrichment {
  fetched: boolean;
  reason?: string;
  title?: string;
  body?: string;
  htmlUrl?: string;
  state?: string;
  author?: string;
  owner?: string;
  repo?: string;
  prNumber?: string;
}

export function isGithubPrUrl(value: string): boolean {
  return GITHUB_PR_RE.test(value.trim());
}

export async function enrichGithubPr(inputUrl: string): Promise<GithubPrEnrichment> {
  const match = GITHUB_PR_RE.exec(inputUrl.trim());
  if (!match) return { fetched: false, reason: "not-a-github-pr-url" };

  const [, owner, repo, prNumber] = match;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(prNumber)}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "chronicle-handover-hackathon",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(apiUrl, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { fetched: false, reason: `github-api-http-${res.status}`, owner, repo, prNumber };
    }

    const data = (await res.json()) as {
      title?: string;
      body?: string | null;
      html_url?: string;
      state?: string;
      user?: { login?: string };
    };

    return {
      fetched: true,
      title: (data.title ?? "").trim(),
      body: (data.body ?? "").trim().slice(0, 20000),
      htmlUrl: data.html_url,
      state: data.state,
      author: data.user?.login ? `@${data.user.login}` : undefined,
      owner,
      repo,
      prNumber,
    };
  } catch {
    return { fetched: false, reason: "github-api-unreachable", owner, repo, prNumber };
  }
}
