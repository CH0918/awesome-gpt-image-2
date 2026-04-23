import { AwsClient } from 'aws4fetch';

import { hashText, type LocalPromptEntry } from './local-prompt.js';

type ImageMirrorConfigs = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicDomain?: string;
  uploadPath: string;
  region: string;
  strict: boolean;
};

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function getImageMirrorConfigs(): ImageMirrorConfigs | null {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.IMG2AI_R2_ACCOUNT_ID;
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID || process.env.IMG2AI_R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY || process.env.IMG2AI_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || process.env.IMG2AI_R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  const endpoint =
    process.env.R2_ENDPOINT ||
    process.env.IMG2AI_R2_ENDPOINT ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  const publicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.IMG2AI_R2_PUBLIC_DOMAIN;
  const uploadPath = trimSlashes(
    process.env.R2_UPLOAD_PATH || process.env.IMG2AI_R2_UPLOAD_PATH || 'img2ai-prompts'
  );
  const region = process.env.R2_REGION || process.env.IMG2AI_R2_REGION || 'auto';
  const strict = process.env.IMAGE_MIRROR_STRICT !== 'false';

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicDomain,
    uploadPath,
    region,
    strict,
  };
}

function getExtensionFromContentType(contentType: string | null): string {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/avif') return 'avif';
  return 'jpg';
}

function buildPublicUrl(configs: ImageMirrorConfigs, key: string): string {
  if (configs.publicDomain) {
    const domain = /^https?:\/\//i.test(configs.publicDomain)
      ? configs.publicDomain
      : `https://${configs.publicDomain}`;
    return `${domain.replace(/\/+$/g, '')}/${key}`;
  }

  return `${configs.endpoint.replace(/\/+$/g, '')}/${configs.bucket}/${key}`;
}

function buildReferer(sourceLink?: string): string | undefined {
  if (!sourceLink) return undefined;

  try {
    const url = new URL(sourceLink);
    return `${url.origin}/`;
  } catch {
    return undefined;
  }
}

async function fetchImage(url: string, sourceLink?: string) {
  const headers: Record<string, string> = {
    Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  };
  const referer = buildReferer(sourceLink);
  if (referer) {
    headers.Referer = referer;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const body = new Uint8Array(await response.arrayBuffer());
  return { body, contentType };
}

async function uploadImage(args: {
  configs: ImageMirrorConfigs;
  sourceUrl: string;
  sourceLink?: string;
}): Promise<string> {
  const { body, contentType } = await fetchImage(args.sourceUrl, args.sourceLink);
  const extension = getExtensionFromContentType(contentType);
  const key = `${args.configs.uploadPath}/${hashText(args.sourceUrl)}.${extension}`;
  const uploadUrl = `${args.configs.endpoint.replace(/\/+$/g, '')}/${args.configs.bucket}/${key}`;

  const client = new AwsClient({
    accessKeyId: args.configs.accessKeyId,
    secretAccessKey: args.configs.secretAccessKey,
    region: args.configs.region,
  });

  const response = await client.fetch(
    new Request(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Content-Length': body.length.toString(),
      },
      body,
    })
  );

  if (!response.ok) {
    throw new Error(`upload failed: ${response.status} ${response.statusText}`);
  }

  return buildPublicUrl(args.configs, key);
}

export async function mirrorEntryImages(
  entries: LocalPromptEntry[]
): Promise<LocalPromptEntry[]> {
  const configs = getImageMirrorConfigs();
  if (!configs) return entries;

  const cache = new Map<string, string>();

  for (const entry of entries) {
    const mirroredUrls: string[] = [];
    for (const imageUrl of entry.imageUrls) {
      try {
        const cached = cache.get(imageUrl);
        if (cached) {
          mirroredUrls.push(cached);
          continue;
        }

        const mirroredUrl = await uploadImage({
          configs,
          sourceUrl: imageUrl,
          sourceLink: entry.sourceLink,
        });
        cache.set(imageUrl, mirroredUrl);
        mirroredUrls.push(mirroredUrl);
        console.log(`Mirrored image: ${imageUrl} -> ${mirroredUrl}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (configs.strict) {
          throw new Error(`Failed to mirror image ${imageUrl}: ${message}`);
        }
        console.warn(`Failed to mirror image ${imageUrl}: ${message}`);
        mirroredUrls.push(imageUrl);
      }
    }

    entry.imageUrls = mirroredUrls;
  }

  return entries;
}
