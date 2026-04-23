import 'dotenv/config';

import { writeIssueBodyToApprovedJson } from './utils/issue-to-local-prompt.js';

async function main() {
  const issueBody = process.env.ISSUE_BODY || '';
  if (!issueBody) {
    throw new Error('ISSUE_BODY is required');
  }

  const outDir = process.env.APPROVED_OUTPUT_DIR || 'data/my/approved';
  const outPath = writeIssueBodyToApprovedJson(issueBody, outDir);

  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
