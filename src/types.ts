export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_APP_ID: string;
  GITHUB_APP_CLIENT_ID: string;
  /** PKCS#8 PEM-encoded RSA private key for the GitHub App */
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  /** Cloudflare Access application AUD tag */
  CF_ACCESS_AUD: string;
  /** e.g. myteam.cloudflareaccess.com */
  CF_ACCESS_TEAM_DOMAIN: string;
  /** Set to "development" in the wrangler.json env.dev vars block to bypass Access JWT verification locally. */
  ENVIRONMENT?: string;
}

export interface Variables {
  oidcClaims: GitHubOidcClaims;
  /** Set by requireWebhookHmac() after signature verification so handlers don't re-read the stream */
  rawBody: string;
}

/** Claims present in a GitHub Actions OIDC token */
export interface GitHubOidcClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  /** e.g. "owner/repo" */
  repository: string;
  /** Full ref, e.g. "refs/heads/main" or "refs/tags/v1.0" */
  ref: string;
  /** "branch" or "tag" */
  ref_type: string;
  /** Commit SHA */
  sha: string;
  repository_owner: string;
  repository_id: string;
  actor: string;
  event_name: string;
  iat: number;
  exp: number;
}

export interface MetricPayload {
  name: string;
  value: number;
  unit: string;
}

// DB row types

export interface Owner {
  id: number;
  github_id: number;
  login: string;
  type: 'User' | 'Organization';
  avatar_url: string | null;
  created_at: string;
}

export interface Project {
  id: number;
  owner_id: number;
  github_repo_id: number;
  repo_name: string;
  full_slug: string;
  installation_id: number;
  default_branch: string;
  badge_enabled: number;
  created_at: string;
}

export interface Metric {
  id: number;
  project_id: number;
  branch: string;
  commit_sha: string;
  metric_name: string;
  value: number;
  unit: string;
  recorded_at: string;
}

export interface CoverageRun {
  id: number;
  project_id: number;
  commit_sha: string;
  branch: string;
  ran_at: number;
  line_coverage: number;
  branch_coverage: number | null;
  cyclomatic: number | null;
  cognitive: number | null;
  duplication_pct: number | null;
  maintainability: number | null;
}

export interface CoverageDaily {
  project_id: number;
  day: string;
  line_coverage: number;
  branch_coverage: number | null;
  cyclomatic: number | null;
  cognitive: number | null;
  duplication_pct: number | null;
  maintainability: number | null;
  run_count: number;
}
