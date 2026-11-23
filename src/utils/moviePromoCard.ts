export interface UserPromoChannelConfig {
  chatId: string;
  targetChannelId: string;
  targetChannelLabel: string;
  customPictaChannelUrl?: string;
  autoSendToRequests?: boolean;
  requestsGroupChatId?: string;
  requestsGroupLabel?: string;
  requestsMonitorMode?: 'off' | 'prefix' | 'all';
  disabled?: boolean;
  updatedAt?: string;
}

export interface PendingMoviePromoRecord {
  promoId: string;
  jobId?: string;
  ownerChatId: string;
  title: string;
  year?: string;
  rating?: string;
  genre?: string;
  synopsis: string;
  pictaPublicationId?: number;
  pictaVideoUrl: string;
  pictaChannelUrl: string;
  pictaChannelName: string;
  posterUrl?: string;
  backdropUrl?: string;
  posterBase64?: string;
  publishedToChannelId?: string;
  publishedAt?: string;
  createdAt: string;
}

export function resolveRequestsChannelForChat(
  chatId: string,
  masterAdminChatId: string,
  userPromoChannels: Map<string, UserPromoChannelConfig>,
  masterDefaultConfig: {
    targetChannelId: string;
    targetChannelLabel: string;
    pictaChannelUrl: string;
  }
): {
  configured: boolean;
  isPrivateMasterDefault: boolean;
  targetChannelId: string;
  targetChannelLabel: string;
  customPictaChannelUrl?: string;
  autoSendToRequests: boolean;
} {
  const cleanChat = String(chatId || '').trim();
  const custom = userPromoChannels.get(cleanChat);
  if (custom) {
    if (custom.disabled) {
      return {
        configured: false,
        isPrivateMasterDefault: false,
        targetChannelId: '',
        targetChannelLabel: '',
        autoSendToRequests: false,
      };
    }
    if (custom.targetChannelId) {
      return {
        configured: true,
        isPrivateMasterDefault: false,
        targetChannelId: custom.targetChannelId,
        targetChannelLabel: custom.targetChannelLabel || custom.targetChannelId,
        customPictaChannelUrl: custom.customPictaChannelUrl,
        autoSendToRequests: Boolean(custom.autoSendToRequests),
      };
    }
  }
  if (cleanChat === String(masterAdminChatId)) {
    return {
      configured: true,
      isPrivateMasterDefault: true,
      targetChannelId: masterDefaultConfig.targetChannelId,
      targetChannelLabel: masterDefaultConfig.targetChannelLabel,
      customPictaChannelUrl: masterDefaultConfig.pictaChannelUrl,
      autoSendToRequests: false,
    };
  }
  return {
    configured: false,
    isPrivateMasterDefault: false,
    targetChannelId: '',
    targetChannelLabel: '',
    autoSendToRequests: false,
  };
}

export function parseTelegramChannelInput(raw: string): {
  valid: boolean;
  targetChannelId?: string;
  displayLabel?: string;
  error?: string;
} {
  const clean = String(raw || '').trim();
  if (!clean) {
    return { valid: false, error: 'Ingresa un @canal, enlace t.me/canal o ID numérico -100...' };
  }
  if (/^-100\d{5,}$/.test(clean) || /^-\d{6,}$/.test(clean)) {
    return { valid: true, targetChannelId: clean, displayLabel: clean };
  }
  const linkMatch = clean.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,})/i);
  if (linkMatch) {
    const uname = `@${linkMatch[1]}`;
    return { valid: true, targetChannelId: uname, displayLabel: uname };
  }
  if (/^@[A-Za-z0-9_]{4,}$/.test(clean)) {
    return { valid: true, targetChannelId: clean, displayLabel: clean };
  }
  if (/^[A-Za-z0-9_]{5,}$/.test(clean)) {
    const uname = `@${clean}`;
    return { valid: true, targetChannelId: uname, displayLabel: uname };
  }
  return {
    valid: false,
    error: 'Formato inválido. Usa @tu_canal, https://t.me/tu_canal o ID numérico -100...',
  };
}

export function resolveCanonicalPictaChannelUrl(params: {
  channelId: string;
  slugUrl?: string;
  customUrl?: string;
}): string {
  const custom = String(params.customUrl || '').trim();
  if (custom && /^https?:\/\//i.test(custom)) return custom;
  const slug = String(params.slugUrl || '').trim().replace(/^\/+/, '');
  if (slug) return `https://www.picta.cu/canal/${slug}`;
  return `https://www.picta.cu/canal/${params.channelId}`;
}

export function normalizeMovieRatingLabel(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return s.slice(0, 16);
  const val = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(val) || val <= 0) return '';
  if (val <= 10) return `${val.toFixed(1)}/10`;
  return `${Math.round(val)}`;
}

function escapePromoHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildMoviePromoCardPayload(params: {
  title: string;
  year?: string;
  rating?: string;
  genre?: string;
  synopsis?: string;
  pictaVideoUrl: string;
  pictaChannelUrl: string;
  pictaChannelName: string;
  posterUrl?: string;
  backdropUrl?: string;
}): {
  captionHtml: string;
  photoCaptionHtml: string;
  textMessageHtml: string;
  imageUrl?: string;
  preferredImageUrl?: string;
  inlineKeyboard: Array<Array<{ text: string; url: string }>>;
} {
  const titleLine = `🎬 ${escapePromoHtml(params.title)}`;
  const metaParts: string[] = [];
  if (params.year) metaParts.push(`📅 Año: ${escapePromoHtml(params.year)}`);
  if (params.rating) metaParts.push(`⭐ Calificación: ${escapePromoHtml(params.rating)}/10`);
  const metaLine = metaParts.join(' · ');

  const genreLine = params.genre ? `🎭 Género: ${escapePromoHtml(params.genre)}` : '';
  const syn = String(params.synopsis || '').trim();

  const lines: string[] = [titleLine, ''];
  if (metaLine) lines.push(metaLine);
  if (genreLine) lines.push(genreLine);
  if (metaLine || genreLine) lines.push('');

  if (syn) {
    lines.push(`📝 Sinopsis:\n${escapePromoHtml(syn)}`);
    lines.push('');
  }
  lines.push('▶️ Toca los botones de abajo para verla al instante en Picta:');

  const textMessageHtml = lines.join('\n');
  const photoCaptionHtml =
    textMessageHtml.length > 1024 ? `${textMessageHtml.slice(0, 1015)}...` : textMessageHtml;
  const preferredImageUrl = params.posterUrl || params.backdropUrl;

  return {
    captionHtml: photoCaptionHtml,
    photoCaptionHtml,
    textMessageHtml,
    imageUrl: preferredImageUrl,
    preferredImageUrl,
    inlineKeyboard: [
      [{ text: '▶️ Ver Película en Picta', url: params.pictaVideoUrl }],
      [{ text: `📺 Canal ${params.pictaChannelName}`, url: params.pictaChannelUrl }],
    ],
  };
}
