export interface ParsedTelegramMessageLink {
  rawUrl: string;
  kind: 'public' | 'private_channel';
  username?: string;
  internalChannelId?: string;
  mtprotoPeer: string;
  messageId: number;
}

const VIDEO_EXT_REGEX = /\.(mp4|mkv|mov|avi|webm|m4v|ts|flv)$/i;

export function parseTelegramMessageLink(rawText: string): ParsedTelegramMessageLink | null {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // Private supergroup/channel links: https://t.me/c/1234567890/456
  const privMatch = text.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/c\/(\d{5,})\/(\d+)(?:[/?#][^\s]*)?/i
  );
  if (privMatch) {
    const internalId = privMatch[1];
    const msgId = Number(privMatch[2]);
    if (internalId && Number.isFinite(msgId) && msgId > 0) {
      return {
        rawUrl: privMatch[0],
        kind: 'private_channel',
        internalChannelId: internalId,
        mtprotoPeer: `-100${internalId}`,
        messageId: msgId,
      };
    }
  }

  // Public channel/group links: https://t.me/username/456 or https://t.me/s/username/456
  const pubMatch = text.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,})\/(\d+)(?:[/?#][^\s]*)?/i
  );
  if (pubMatch) {
    const username = pubMatch[1];
    const msgId = Number(pubMatch[2]);
    if (username && !['c', 's', 'joinchat', 'addstickers', 'boost', 'proxy'].includes(username.toLowerCase()) && Number.isFinite(msgId) && msgId > 0) {
      return {
        rawUrl: pubMatch[0],
        kind: 'public',
        username,
        mtprotoPeer: username,
        messageId: msgId,
      };
    }
  }

  return null;
}

export function extractDirectVideoUrl(rawText: string): {
  url: string;
  inferredFileName: string;
  hasExplicitVideoExt: boolean;
} | null {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // Never treat Telegram links as plain HTTP video URLs
  if (parseTelegramMessageLink(text)) return null;

  const urlMatch = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!urlMatch) return null;

  let candidate = urlMatch[0].replace(/[),.;!?]+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  // Ignore known web pages (Picta, Telegram, YouTube, TMDB, IMDb) that are not direct video files
  if (
    host.includes('t.me') ||
    host.includes('telegram.') ||
    host.includes('picta.cu') ||
    host.includes('youtube.com') ||
    host.includes('youtu.be') ||
    host.includes('themoviedb.org') ||
    host.includes('imdb.com')
  ) {
    return null;
  }

  const rawPathName = decodeURIComponent(parsed.pathname.split('/').pop() || '').trim();
  const queryFileName =
    parsed.searchParams.get('filename') ||
    parsed.searchParams.get('file') ||
    parsed.searchParams.get('name') ||
    '';
  const cleanName = (queryFileName || rawPathName || `video_${Date.now()}.mp4`).replace(
    /[^\w.\- ()[\]]+/g,
    '_'
  );

  const hasExplicitVideoExt = VIDEO_EXT_REGEX.test(cleanName) || VIDEO_EXT_REGEX.test(parsed.pathname);

  return {
    url: candidate,
    inferredFileName: VIDEO_EXT_REGEX.test(cleanName) ? cleanName : `${cleanName}.mp4`,
    hasExplicitVideoExt,
  };
}

export function parseFilenameFromContentDisposition(headerVal: string | null | undefined): string {
  const raw = String(headerVal || '').trim();
  if (!raw) return '';
  const utf8Match = raw.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      return utf8Match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  const plainMatch = raw.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

export function isProbableVideoHttpResponse(params: {
  url: string;
  contentType?: string | null;
  contentDisposition?: string | null;
}): { ok: boolean; fileName: string; mimeType: string; reason?: string } {
  const ct = String(params.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const cdName = parseFilenameFromContentDisposition(params.contentDisposition);
  const extracted = extractDirectVideoUrl(params.url);
  const baseName = cdName || extracted?.inferredFileName || `video_url_${Date.now()}.mp4`;
  const hasVideoExt = VIDEO_EXT_REGEX.test(baseName);

  if (ct.startsWith('text/html') || ct.includes('application/json') || ct.includes('application/xml')) {
    return {
      ok: false,
      fileName: baseName,
      mimeType: ct,
      reason: `El enlace devolvió una página o datos (${ct}) y no un archivo de video directo.`,
    };
  }

  if (ct.startsWith('video/') || ct === 'application/mp4' || ct === 'application/x-matroska') {
    return {
      ok: true,
      fileName: hasVideoExt ? baseName : `${baseName}.mp4`,
      mimeType: ct || 'video/mp4',
    };
  }

  if ((!ct || ct === 'application/octet-stream' || ct === 'binary/octet-stream') && hasVideoExt) {
    return {
      ok: true,
      fileName: baseName,
      mimeType: 'video/mp4',
    };
  }

  if (hasVideoExt && !ct.startsWith('image/') && !ct.startsWith('audio/')) {
    return {
      ok: true,
      fileName: baseName,
      mimeType: ct || 'video/mp4',
    };
  }

  return {
    ok: false,
    fileName: baseName,
    mimeType: ct || 'unknown',
    reason: `Tipo de contenido no compatible para subida directa (${ct || 'sin tipo'}). Debe apuntar a un archivo .mp4, .mkv, .mov o .webm.`,
  };
}
