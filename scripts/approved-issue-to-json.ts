import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import {
  entryFileName,
  extractUrls,
  normalizePromptEntry,
  normalizeStringArray,
  type LocalPromptEntry,
} from './utils/local-prompt.js';

function cleanValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '_No response_') return undefined;
  return trimmed;
}

function parseIssueBody(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = body.split('\n');
  let currentField: string | null = null;
  let currentValue: string[] = [];

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (currentField) {
        fields[currentField] = currentValue.join('\n').trim();
      }
      currentField = line
        .replace('### ', '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      currentValue = [];
      continue;
    }

    if (currentField) {
      currentValue.push(line);
    }
  }

  if (currentField) {
    fields[currentField] = currentValue.join('\n').trim();
  }

  return fields;
}

function issueToEntry(fields: Record<string, string>): LocalPromptEntry {
  return normalizePromptEntry({
    title: cleanValue(fields.prompt_title) || cleanValue(fields.title),
    prompt: cleanValue(fields.prompt),
    description: cleanValue(fields.description),
    imageUrls: extractUrls(fields.generated_image_urls || fields.image_urls),
    categories: normalizeStringArray(cleanValue(fields.categories)),
    tags: normalizeStringArray(cleanValue(fields.tags)),
    style: cleanValue(fields.style),
    aspectRatio: cleanValue(fields.aspect_ratio),
    language:
      cleanValue(fields.prompt_language) || cleanValue(fields.language) || 'en',
    authorName:
      cleanValue(fields.original_author) || cleanValue(fields.author_name),
    authorLink:
      cleanValue(fields.author_profile_link) || cleanValue(fields.author_link),
    sourceLink: cleanValue(fields.source_link),
    sourcePlatform: cleanValue(fields.source_platform),
    sourceExternalId: cleanValue(fields.source_external_id),
    needReferenceImages:
      cleanValue(fields.need_reference_images)?.toLowerCase() === 'true',
    isFeatured: cleanValue(fields.featured)?.toLowerCase() === 'true',
    licenseStatus:
      (cleanValue(fields.license_status) as LocalPromptEntry['licenseStatus']) ||
      'needs-review',
    rawNotePath: cleanValue(fields.raw_note_path),
  });
}

async function main() {
  const issueBody = process.env.ISSUE_BODY || '';
  if (!issueBody) {
    throw new Error('ISSUE_BODY is required');
  }

  const fields = parseIssueBody(issueBody);
  const entry = issueToEntry(fields);
  const outDir = process.env.APPROVED_OUTPUT_DIR || 'data/my/approved';

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, entryFileName(entry));
  fs.writeFileSync(outPath, JSON.stringify(entry, null, 2), 'utf8');

  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
