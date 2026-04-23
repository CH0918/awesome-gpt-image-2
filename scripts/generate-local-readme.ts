import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import { readApprovedPrompts, type LocalPromptEntry } from './utils/local-prompt.js';

function cleanPromptContent(content: string): string {
  return content
    .replace(/^```[\w-]*\s*\n?/im, '')
    .replace(/\n?```\s*$/im, '')
    .trim();
}

function renderPrompt(entry: LocalPromptEntry, index: number): string {
  const prompt = cleanPromptContent(entry.prompt);
  const authorLink = entry.authorLink || '#';
  const sourceLink = entry.sourceLink || '#';
  const published = new Date(entry.cleanedAt).toLocaleDateString('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const language = entry.language || 'en';
  const hasArguments = prompt.includes('{argument');
  const images = entry.imageUrls
    .map((imageUrl, imageIndex) => {
      return [
        `##### Image ${imageIndex + 1}`,
        '',
        '<div align="center">',
        `<img src="${imageUrl}" width="${entry.isFeatured ? '700' : '600'}" alt="${entry.title} - Image ${imageIndex + 1}">`,
        '</div>',
      ].join('\n');
    })
    .join('\n\n');

  return [
    `### No. ${index + 1}: ${entry.title}`,
    '',
    `![Language-${language.toUpperCase()}](https://img.shields.io/badge/Language-${language.toUpperCase()}-blue)`,
    entry.isFeatured
      ? '![Featured](https://img.shields.io/badge/⭐-Featured-gold)'
      : '',
    hasArguments
      ? '![Raycast](https://img.shields.io/badge/🚀-Raycast_Friendly-purple)'
      : '',
    '',
    '#### 📖 Description',
    '',
    entry.description,
    '',
    '#### 📝 Prompt',
    '',
    '```',
    prompt,
    '```',
    '',
    images ? '#### 🖼️ Generated Images' : '',
    images ? '' : '',
    images,
    images ? '' : '',
    '#### 📌 Details',
    '',
    `- **Author:** [${entry.authorName}](${authorLink})`,
    `- **Source:** [Original Post](${sourceLink})`,
    `- **Published:** ${published}`,
    `- **Languages:** ${language}`,
    `- **Categories:** ${entry.categories.join(', ') || 'uncategorized'}`,
    `- **Tags:** ${entry.tags.join(', ') || 'gpt-image-2'}`,
    '',
    `**[👉 Try it now →](https://img2ai.local/gpt-image-2-prompts?id=${entry.id})**`,
    '',
    '---',
    '',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

async function fetchUpstreamReadme(): Promise<string> {
  const url = process.env.UPSTREAM_README_URL;
  if (!url) return '';

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch upstream README: ${response.status}`);
  }
  return response.text();
}

async function main() {
  const output = process.env.LOCAL_README_OUTPUT || 'README.md';
  const entries = readApprovedPrompts();
  const featured = entries.filter((entry) => entry.isFeatured);
  const regular = entries.filter((entry) => !entry.isFeatured);
  const upstream = await fetchUpstreamReadme();

  const localSections = [
    '',
    '<!-- img2ai-local-prompts:start -->',
    '',
    '## 🌱 Img2AI Curated Prompts',
    '',
    '> This section is generated from `data/my/approved/*.json`.',
    '',
    featured.length > 0 ? '## 🔥 Featured Prompts' : '',
    '',
    featured.map(renderPrompt).join('\n'),
    regular.length > 0 ? '## 📋 All Prompts' : '',
    '',
    regular.map((entry, index) => renderPrompt(entry, index + featured.length)).join('\n'),
    '<!-- img2ai-local-prompts:end -->',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const markdown = upstream
    ? `${upstream.trim()}\n\n${localSections}`
    : [
        '# Awesome GPT Image 2 Prompts',
        '',
        '> Auto-generated from local approved prompt JSON files.',
        '',
        localSections,
      ].join('\n');

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, markdown, 'utf8');
  console.log(`Wrote ${output} with ${entries.length} local prompts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
