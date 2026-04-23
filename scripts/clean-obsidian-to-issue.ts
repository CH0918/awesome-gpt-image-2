import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';

import {
  entryFileName,
  normalizePromptEntry,
  type LocalPromptEntry,
} from './utils/local-prompt.js';

const EVOLINK_API_URL =
  process.env.EVOLINK_API_URL ||
  'https://api.evolink.ai/v1beta/models/gemini-2.5-flash-lite:generateContent';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getVaultDir(): string {
  return requireEnv('OBSIDIAN_VAULT_DIR');
}

function findMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const result: string[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      result.push(...findMarkdownFiles(fullPath));
      continue;
    }
    if (item.isFile() && item.name.endsWith('.md')) {
      result.push(fullPath);
    }
  }
  return result.sort();
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response does not contain a JSON object');
  }

  return JSON.parse(raw.slice(start, end + 1));
}

function buildCleanerPrompt(args: { filePath: string; content: string }): string {
  return `你是 Img2AI 的 Prompt 资料整理助手。请把下面这篇来源不统一的生图教程、攻略、推文、公众号摘录或个人笔记，清洗成一个严格 JSON 对象。

要求：
- 只输出 JSON，不要输出解释。
- 如果原文缺少字段，请合理推断；不能确定版权时 licenseStatus 用 "needs-review"。
- prompt 字段必须保留可直接用于生图模型的完整提示词。
- description 用英文，简洁说明这个 prompt 适合生成什么。
- categories/tags 用英文 slug 或英文短词。
- language 用 BCP-47 简码，例如 en、zh、ja。
- imageUrls 只保留 http/https 图片链接，没有则为空数组。
- sourceLink、authorName、authorLink 尽量从原文或 frontmatter 中提取。
- sourceExternalId 可留空，脚本会自动生成。

JSON schema:
{
  "title": "string",
  "prompt": "string",
  "description": "string",
  "imageUrls": ["https://..."],
  "categories": ["poster", "product"],
  "tags": ["gpt-image-2", "3d-render"],
  "style": "string",
  "aspectRatio": "1:1 | 3:4 | 4:3 | 16:9 | 9:16",
  "language": "en",
  "authorName": "string",
  "authorLink": "https://...",
  "sourceLink": "https://...",
  "sourcePlatform": "twitter | wechat | blog | youtube | other",
  "sourceExternalId": "",
  "needReferenceImages": false,
  "isFeatured": false,
  "qualityScore": 1,
  "licenseStatus": "unknown | allowed | needs-review | blocked"
}

文件路径：${args.filePath}

原文：
${args.content}`;
}

async function cleanWithLlm(filePath: string): Promise<LocalPromptEntry> {
  const token = requireEnv('EVOLINK_API_KEY');
  const content = fs.readFileSync(filePath, 'utf8');
  const prompt = buildCleanerPrompt({ filePath, content });

  const response = await fetch(EVOLINK_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Evolink API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJson(text);

  return normalizePromptEntry({
    ...(parsed as Partial<LocalPromptEntry>),
    rawNotePath: filePath,
  });
}

function buildIssueBody(entry: LocalPromptEntry): string {
  return [
    '### Prompt Title',
    entry.title,
    '',
    '### Prompt',
    entry.prompt,
    '',
    '### Description',
    entry.description,
    '',
    '### Need Reference Images',
    String(entry.needReferenceImages),
    '',
    '### Generated Image URLs',
    entry.imageUrls.join('\n') || '_No response_',
    '',
    '### Original Author',
    entry.authorName,
    '',
    '### Author Profile Link',
    entry.authorLink || '_No response_',
    '',
    '### Source Link',
    entry.sourceLink || '_No response_',
    '',
    '### Prompt Language',
    entry.language,
    '',
    '### Categories',
    entry.categories.join(', '),
    '',
    '### Tags',
    entry.tags.join(', '),
    '',
    '### Style',
    entry.style || '_No response_',
    '',
    '### Aspect Ratio',
    entry.aspectRatio || '1:1',
    '',
    '### Source Platform',
    entry.sourcePlatform || '_No response_',
    '',
    '### Source External ID',
    entry.sourceExternalId,
    '',
    '### License Status',
    entry.licenseStatus || 'needs-review',
    '',
    '### Raw Note Path',
    entry.rawNotePath || '_No response_',
  ].join('\n');
}

async function createIssue(entry: LocalPromptEntry): Promise<void> {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const token = requireEnv('GITHUB_TOKEN');
  const [owner, repo] = repository.split('/');
  const octokit = new Octokit({ auth: token });

  await octokit.issues.create({
    owner,
    repo,
    title: `[Prompt] ${entry.title}`,
    body: buildIssueBody(entry),
    labels: ['prompt-submission', 'needs-review'],
  });
}

function writeCleanedJson(entry: LocalPromptEntry): void {
  const outDir = process.env.CLEANED_OUTPUT_DIR || 'data/my/cleaned';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, entryFileName(entry)),
    JSON.stringify(entry, null, 2),
    'utf8'
  );
}

function archiveRawNote(filePath: string): void {
  const processedDir = process.env.OBSIDIAN_PROCESSED_DIR;
  if (!processedDir) return;

  const vaultDir = getVaultDir();
  const targetDir = path.resolve(vaultDir, processedDir);
  const targetPath = path.join(targetDir, path.basename(filePath));

  fs.mkdirSync(targetDir, { recursive: true });
  fs.renameSync(filePath, targetPath);
  console.log(`Archived raw note to ${targetPath}`);
}

async function main() {
  const vaultDir = getVaultDir();
  const inboxDir = process.env.OBSIDIAN_INBOX_DIR || '00-inbox';
  const rawDir = path.resolve(vaultDir, inboxDir);
  const files = findMarkdownFiles(rawDir);
  const limit = Number(process.env.CLEAN_LIMIT || '5');
  const dryRun = process.argv.includes('--dry-run');
  const selected = files.slice(0, limit);

  console.log(`Found ${files.length} markdown files, processing ${selected.length}`);

  for (const filePath of selected) {
    console.log(`Cleaning ${filePath}`);
    const entry = await cleanWithLlm(filePath);
    writeCleanedJson(entry);

    if (dryRun) {
      console.log(`Dry run: skipped issue creation for ${entry.title}`);
      continue;
    }

    await createIssue(entry);
    console.log(`Created issue for ${entry.title}`);
    archiveRawNote(filePath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
