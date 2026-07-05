#!/usr/bin/env node
// Creates a commit via the GitHub GraphQL API (createCommitOnBranch) instead
// of a local `git commit`. API-created commits are automatically shown as
// Verified by GitHub with no signing key to manage — required because main's
// ruleset enforces signed commits. Used by .github/workflows/release-prepare.yml.
import { readFileSync } from 'node:fs';

const [, , repo, branch, expectedHeadOid, message, ...filePaths] = process.argv;
if (!repo || !branch || !expectedHeadOid || !message || filePaths.length === 0) {
  console.error(
    'Usage: create-verified-commit.mjs <owner/repo> <branch> <expectedHeadOid> <message> <file...>',
  );
  process.exit(1);
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GH_TOKEN or GITHUB_TOKEN must be set.');
  process.exit(1);
}

const additions = filePaths.map((path) => ({
  path,
  contents: readFileSync(path).toString('base64'),
}));

const query = `
  mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid url }
    }
  }
`;

const variables = {
  input: {
    branch: { repositoryNameWithOwner: repo, branchName: branch },
    message: { headline: message },
    expectedHeadOid,
    fileChanges: { additions },
  },
};

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query, variables }),
});

const result = await response.json();
if (!response.ok || result.errors) {
  console.error('GraphQL createCommitOnBranch failed:', JSON.stringify(result, null, 2));
  process.exit(1);
}

const commit = result.data.createCommitOnBranch.commit;
console.log(`Created verified commit ${commit.oid}: ${commit.url}`);
