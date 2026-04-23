import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface LocalPromptEntry {
  id: string;
  title: string;
  prompt: string;
  description: string;
  imageUrls: string[];
  categories: string[];
  tags: string[];
  style?: string;
  aspectRatio?: string;
  language: string;
  authorName: string;
  authorLink?: string;
  sourceLink?: string;
  sourcePlatform?: string;
  sourceExternalId: string;
  needReferenceImages: boolean;
  isFeatured: boolean;
  qualityScore?: number;
  licenseStatus?: 'unknown' | 'allowed' | 'needs-review' | 'blocked';
  rawNotePath?: string;
  cleanedAt: string;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function hashText(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

export function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractUrls(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const urls = new Set<string>();
  const pattern = /https?:\/\/[^\s)>\]]+/g;

  for (const item of values) {
    if (!item) continue;
    for (const match of String(item).matchAll(pattern)) {
      urls.add(match[0].trim());
    }
  }

  return [...urls];
}

export function createSourceExternalId(args: {
  sourceLink?: string;
  title: string;
  prompt: string;
  rawNotePath?: string;
}): string {
  if (args.sourceLink) {
    return hashText(args.sourceLink).slice(0, 24);
  }
  if (args.rawNotePath) {
    return hashText(args.rawNotePath).slice(0, 24);
  }
  return hashText(`${args.title}\n${args.prompt}`).slice(0, 24);
}

export function normalizePromptEntry(raw: Partial<LocalPromptEntry>): LocalPromptEntry {
  const title = String(raw.title || '').trim();
  const prompt = String(raw.prompt || '').trim();

  if (!title) {
    throw new Error('Prompt entry is missing title');
  }
  if (!prompt) {
    throw new Error(`Prompt entry "${title}" is missing prompt`);
  }

  const imageUrls = extractUrls(raw.imageUrls);
  const categories = normalizeStringArray(raw.categories);
  const tags = normalizeStringArray(raw.tags);
  const sourceLink = raw.sourceLink?.trim() || undefined;
  const rawNotePath = raw.rawNotePath?.trim() || undefined;
  const sourceExternalId =
    raw.sourceExternalId?.trim() ||
    createSourceExternalId({ sourceLink, title, prompt, rawNotePath });

  return {
    id: raw.id?.trim() || `my-${sourceExternalId}`,
    title,
    prompt,
    description: String(raw.description || '').trim() || title,
    imageUrls,
    categories,
    tags,
    style: raw.style?.trim() || undefined,
    aspectRatio: raw.aspectRatio?.trim() || '1:1',
    language: raw.language?.trim() || 'en',
    authorName: raw.authorName?.trim() || 'Unknown',
    authorLink: raw.authorLink?.trim() || undefined,
    sourceLink,
    sourcePlatform: raw.sourcePlatform?.trim() || undefined,
    sourceExternalId,
    needReferenceImages: Boolean(raw.needReferenceImages),
    isFeatured: Boolean(raw.isFeatured),
    qualityScore:
      typeof raw.qualityScore === 'number' ? raw.qualityScore : undefined,
    licenseStatus: raw.licenseStatus || 'needs-review',
    rawNotePath,
    cleanedAt: raw.cleanedAt || new Date().toISOString(),
  };
}

export function readApprovedPrompts(dir = 'data/my/approved'): LocalPromptEntry[] {
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  return files.map((file) => {
    const filePath = path.join(dir, file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizePromptEntry(raw);
  });
}

export function entryFileName(entry: LocalPromptEntry): string {
  return `${slugify(entry.title).slice(0, 64) || entry.sourceExternalId}.json`;
}
