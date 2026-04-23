import 'dotenv/config';

import fs from 'node:fs';

import { Octokit } from '@octokit/rest';

import { writeIssueBodyToApprovedJson } from './utils/issue-to-local-prompt.js';

function getRepoParts(): { owner: string; repo: string } {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required');
  }

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  }

  return { owner, repo };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const { owner, repo } = getRepoParts();
  const outDir = process.env.APPROVED_OUTPUT_DIR || 'data/my/approved';
  const processedIssuesOutput =
    process.env.PROCESSED_ISSUES_OUTPUT || '.approved-issues.json';
  const octokit = new Octokit({ auth: token });

  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    labels: 'approved,prompt-submission',
    per_page: 100,
  });

  const promptIssues = issues
    .filter((issue) => !issue.pull_request)
    .sort((a, b) => a.number - b.number);

  const processedIssues: Array<{ number: number; title: string; path: string }> =
    [];

  for (const issue of promptIssues) {
    if (!issue.body) {
      throw new Error(`Issue #${issue.number} is missing body`);
    }

    const outPath = writeIssueBodyToApprovedJson(issue.body, outDir);
    processedIssues.push({
      number: issue.number,
      title: issue.title,
      path: outPath,
    });
    console.log(`Wrote ${outPath} from issue #${issue.number}`);
  }

  fs.writeFileSync(
    processedIssuesOutput,
    JSON.stringify(processedIssues, null, 2),
    'utf8',
  );
  console.log(`Processed ${processedIssues.length} approved issue(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
