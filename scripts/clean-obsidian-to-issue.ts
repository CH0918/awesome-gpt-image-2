import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';

import { mirrorEntryImages } from './utils/image-mirror.js';
import {
  entryFileName,
  hashText,
  normalizePromptEntry,
  PROMPT_CATEGORY_SLUGS,
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

function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  const objectStart = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  const startsWithArray =
    arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);
  const start = startsWithArray ? arrayStart : objectStart;
  const end = startsWithArray ? raw.lastIndexOf(']') : raw.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response does not contain a JSON object or array');
  }

  return JSON.parse(raw.slice(start, end + 1));
}

function buildCleanerPrompt(args: { filePath: string; content: string }): string {
  const categoryList = PROMPT_CATEGORY_SLUGS.map((item) => `  - ${item}`).join('\n');

  return `你是 Img2AI 的 Prompt 资料整理助手。请把下面这篇来源不统一的生图教程、攻略、推文、公众号摘录或个人笔记，清洗成一个严格 JSON 数组。

要求：
- 只输出 JSON 数组，不要输出解释，不要输出 Markdown。
- 一篇文章里如果包含多个独立生图案例、提示词、教程示例或可复用场景，请拆成多个数组元素。
- 不要把整篇文章压缩成一条总览；每个数组元素必须对应一个独立可复用的生图 prompt 案例。
- 只提取同时具备“明确生图提示词/指令”和“对应生成效果图”的案例。
- 如果某段只有能力介绍、技巧讲解、价格信息、评测信息，或者只有 prompt 但没有效果图，不要输出为案例。
- 不要从文章讲解中发散创造不存在的案例；不要把能力描述改写成 prompt。
- prompt 字段尽量保留原文的提示词/指令本身，可以做轻微清理，但不要泛化改写。
- 如果文章只有一个符合条件的可用案例，数组里只放 1 个对象。
- imageUrls 必须放和该案例对应的效果图；无法判断图片归属时不要输出该案例。
- 如果原文缺少字段，请合理推断；不能确定版权时 licenseStatus 用 "needs-review"。
- prompt 字段必须保留可直接用于生图模型的完整提示词。
- description 用英文，简洁说明这个 prompt 适合生成什么。
- categories 必须从下面枚举中选择 1-3 个，不能创造新分类；无法判断时只能填写 ["other"]。
- tags 用英文 slug 或英文短词，可自由提炼 2-6 个。
- language 用 BCP-47 简码，例如 en、zh、ja。
- imageUrls 只保留 http/https 图片链接，没有则为空数组。
- sourceLink、authorName、authorLink 尽量从原文或 frontmatter 中提取。
- sourceExternalId 可留空，脚本会自动生成；如果填写，请确保每个案例不同。

categories 枚举：
${categoryList}

JSON schema:
[
  {
    "title": "string",
    "prompt": "string",
    "description": "string",
    "imageUrls": ["https://..."],
    "categories": ["poster-flyer", "product"],
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
]

文件路径：${args.filePath}

原文：
${args.content}`;
}

function normalizeCleanedEntries(args: {
  parsed: unknown;
  filePath: string;
}): LocalPromptEntry[] {
  const items = Array.isArray(args.parsed) ? args.parsed : [args.parsed];
  const normalized = items.map((item, index) => {
    const raw = item as Partial<LocalPromptEntry>;
    return normalizePromptEntry({
      ...raw,
      rawNotePath: args.filePath,
      sourceExternalId:
        raw.sourceExternalId ||
        hashText(`${args.filePath}:${index}:${raw.title || ''}:${raw.prompt || ''}`).slice(
          0,
          24
        ),
    });
  });

  return normalized.filter((entry) => entry.prompt.trim().length > 0);
}

function filterQualifiedEntries(entries: LocalPromptEntry[]): LocalPromptEntry[] {
  const requireImage = process.env.CLEAN_REQUIRE_IMAGE !== 'false';
  return entries.filter((entry) => {
    const hasPrompt = entry.prompt.trim().length >= 10;
    const hasImage = entry.imageUrls.length > 0;
    return hasPrompt && (!requireImage || hasImage);
  });
}

async function cleanWithLlm(filePath: string): Promise<LocalPromptEntry[]> {
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

  const entries = filterQualifiedEntries(
    normalizeCleanedEntries({ parsed, filePath })
  );

  return mirrorEntryImages(entries);
}

function readExistingCleanedEntries(filePath: string): LocalPromptEntry[] {
  const outDir = process.env.CLEANED_OUTPUT_DIR || 'data/my/cleaned';
  if (!fs.existsSync(outDir)) return [];

  const result: LocalPromptEntry[] = [];
  for (const file of fs.readdirSync(outDir)) {
    if (!file.endsWith('.json')) continue;

    const fullPath = path.join(outDir, file);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const entry = normalizePromptEntry(raw);
      if (entry.rawNotePath === filePath) {
        result.push(entry);
      }
    } catch (error) {
      console.warn(`Skipped invalid cleaned entry ${fullPath}:`, error);
    }
  }

  return filterQualifiedEntries(result).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
}

function deleteExistingCleanedEntries(filePath: string): number {
  const outDir = process.env.CLEANED_OUTPUT_DIR || 'data/my/cleaned';
  if (!fs.existsSync(outDir)) return 0;

  let deleted = 0;
  for (const file of fs.readdirSync(outDir)) {
    if (!file.endsWith('.json')) continue;

    const fullPath = path.join(outDir, file);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (raw?.rawNotePath === filePath) {
        fs.unlinkSync(fullPath);
        deleted += 1;
      }
    } catch {
      continue;
    }
  }

  return deleted;
}

function buildIssueBody(entry: LocalPromptEntry): string {
  const imagePreviewMarkdown =
    entry.imageUrls
      .map((url, index) => `![Generated image ${index + 1}](${url})\n\n${url}`)
      .join('\n\n') || '_No response_';

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
    imagePreviewMarkdown,
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

function writeCleanedJson(entries: LocalPromptEntry[]): void {
  const outDir = process.env.CLEANED_OUTPUT_DIR || 'data/my/cleaned';
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of entries) {
    fs.writeFileSync(
      path.join(outDir, entryFileName(entry)),
      JSON.stringify(entry, null, 2),
      'utf8'
    );
  }
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
    if (dryRun) {
      const entries = await cleanWithLlm(filePath);
      const deleted = deleteExistingCleanedEntries(filePath);
      if (deleted > 0) {
        console.log(`Deleted ${deleted} previous cleaned entries`);
      }
      writeCleanedJson(entries);
      console.log(`Cleaned ${entries.length} prompt entries`);
      console.log(`Dry run: skipped issue creation for ${entries.length} entries`);
      continue;
    }

    let entries = readExistingCleanedEntries(filePath);
    if (entries.length > 0) {
      console.log(`Using ${entries.length} existing cleaned prompt entries`);
    } else {
      entries = await cleanWithLlm(filePath);
      const deleted = deleteExistingCleanedEntries(filePath);
      if (deleted > 0) {
        console.log(`Deleted ${deleted} previous cleaned entries`);
      }
      writeCleanedJson(entries);
      console.log(`Cleaned ${entries.length} prompt entries`);
    }

    for (const entry of entries) {
      await createIssue(entry);
      console.log(`Created issue for ${entry.title}`);
    }
    archiveRawNote(filePath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
