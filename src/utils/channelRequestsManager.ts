export interface PictaRequestMatchHit {
  id: number;
  kind: 'publicacion' | 'serie';
  title: string;
  categoryName: string;
  channelName: string;
  sizeBytes: number;
  resolutions: string[];
  maxResolutionLabel: string;
  webUrl: string;
}

export type RequestsMonitorMode = 'off' | 'prefix' | 'all';

export type RequestSourceType = 'manual' | 'telegram_group' | 'picta_comment';

export interface ChannelMediaRequest {
  id: string;
  ownerChatId: string;
  requestedTitle: string;
  normalizedTitle: string;
  requestedByName: string;
  requestedByUsername?: string;
  sourceType?: RequestSourceType;
  sourceChatId?: string;
  sourceMessageId?: number;
  commentId?: number;
  commentPublicationId?: number;
  commentPublicationTitle?: string;
  status: 'pending' | 'fulfilled' | 'already_in_picta' | 'dismissed';
  matchedPictaPubId?: number;
  matchedPictaUrl?: string;
  createdAt: string;
  fulfilledAt?: string;
}

const REQUEST_STOPWORDS = new Set([
  'la',
  'el',
  'los',
  'las',
  'de',
  'del',
  'en',
  'un',
  'una',
  'y',
  'por',
  'para',
  'con',
  'the',
  'of',
  'and',
  'in',
  'a',
  'an',
  'pelicula',
  'peliculas',
  'serie',
  'series',
  'subir',
  'sube',
  'suban',
  'porfa',
  'favor',
  'hola',
  'buenas',
  'alguien',
  'tiene',
  'tienen',
  'pueden',
  'puede',
  'quiero',
  'busco',
  'solicito',
  'pedido',
]);

export function normalizeRequestTitle(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\((?:19|20)\d{2}\)|\[(?:19|20)\d{2}\]/g, ' ')
    .replace(/\b(?:1080p|720p|480p|4k|hd|latino|espanol|subtitulada|dual|mp4|mkv)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNumbers(str: string): string[] {
  return (str.match(/\d+/g) || []).map((n) => String(Number(n)));
}

export function parseSubscriberRequestMessage(
  rawText: string,
  mode: RequestsMonitorMode
): { matched: boolean; query: string; triggerType: 'command' | 'prefix' | 'open' } {
  const text = String(rawText || '').trim();
  if (!text || text.length > 220) {
    return { matched: false, query: '', triggerType: 'prefix' };
  }

  // Explicit bot/group triggers always work when monitor !== 'off'
  const cmdMatch = text.match(/^\/(?:buscar|pedir|solicitar|pedido)(?:@[A-Za-z0-9_]+)?\s+(.+)/is);
  if (cmdMatch?.[1]) {
    return {
      matched: true,
      query: cmdMatch[1].trim().slice(0, 120),
      triggerType: 'command',
    };
  }

  const prefixMatch = text.match(
    /^(?:#?(?:pedido|pedir|solicitud|solicito|busco)\s*[:\-]?\s+|por\s+favor\s+(?:suban|sube)\s+|pueden\s+subir\s+|quiero\s+ver\s+)(.+)/is
  );
  if (prefixMatch?.[1]) {
    const cleaned = prefixMatch[1].trim().slice(0, 120);
    if (cleaned.length >= 2) {
      return { matched: true, query: cleaned, triggerType: 'prefix' };
    }
  }

  if (mode === 'all' && !text.startsWith('/') && !/https?:\/\//i.test(text)) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length >= 3 && clean.length <= 90) {
      return { matched: true, query: clean, triggerType: 'open' };
    }
  }

  return { matched: false, query: '', triggerType: 'prefix' };
}

export function findMatchingPendingRequests(
  requests: ChannelMediaRequest[],
  ownerChatId: string,
  uploadedTitle: string
): ChannelMediaRequest[] {
  const normUpload = normalizeRequestTitle(uploadedTitle);
  if (!normUpload || normUpload.length < 2) return [];

  const uploadTokens = normUpload
    .split(' ')
    .filter((t) => t.length >= 2 && !REQUEST_STOPWORDS.has(t));
  const uploadNums = extractNumbers(normUpload);

  const matched: ChannelMediaRequest[] = [];
  for (const req of requests) {
    if (req.ownerChatId !== ownerChatId || req.status !== 'pending') continue;
    const normReq = req.normalizedTitle || normalizeRequestTitle(req.requestedTitle);
    if (!normReq || normReq.length < 2) continue;

    // Sequel-number safety: if request has a sequel number (e.g. 2, 3), uploaded title must share it
    const reqNums = extractNumbers(normReq);
    if (reqNums.length > 0 && uploadNums.length > 0) {
      const sharesNum = reqNums.some((n) => uploadNums.includes(n));
      if (!sharesNum) continue;
    } else if (reqNums.length > 0 && uploadNums.length === 0) {
      continue;
    }

    if (normUpload === normReq || normUpload.includes(normReq) || normReq.includes(normUpload)) {
      matched.push(req);
      continue;
    }

    const reqTokens = normReq
      .split(' ')
      .filter((t) => t.length >= 2 && !REQUEST_STOPWORDS.has(t));
    if (reqTokens.length === 0 || uploadTokens.length === 0) continue;

    const hits = reqTokens.filter((t) => uploadTokens.includes(t)).length;
    const overlap = hits / Math.max(reqTokens.length, uploadTokens.length);
    if (overlap >= 0.72 || (reqTokens.length >= 2 && hits === reqTokens.length)) {
      matched.push(req);
    }
  }
  return matched;
}

function escapeHtmlBasic(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatSizeBasic(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'N/D';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSubscriberPictaReplyHtml(
  query: string,
  matches: PictaRequestMatchHit[]
): {
  html: string;
  keyboard: Array<Array<{ text: string; url: string }>>;
} {
  const top = matches.slice(0, 3);
  const lines = top.map((m, idx) => {
    const resStr = m.maxResolutionLabel
      ? m.maxResolutionLabel
      : Array.isArray(m.resolutions) && m.resolutions.length > 0
        ? m.resolutions.join(', ')
        : m.kind === 'serie'
          ? 'Catálogo Serie'
          : 'Estándar';
    const sizeStr = formatSizeBasic(m.sizeBytes);
    const channelPart = m.channelName ? `📺 ${escapeHtmlBasic(m.channelName)}` : '📺 Picta';
    return (
      `<b>${idx + 1}. ${escapeHtmlBasic(m.title)}</b>\n` +
      `   ${channelPart} · 📦 ${sizeStr} · 🎞️ ${escapeHtmlBasic(resStr)}\n` +
      `   🔗 ${escapeHtmlBasic(m.webUrl)}`
    );
  });

  const html =
    `✅ <b>¡"<i>${escapeHtmlBasic(query)}</i>" ya está disponible en Picta!</b>\n` +
    `Antes de pedirlo o volverlo a subir, puedes verlo aquí:\n\n` +
    `${lines.join('\n\n')}`;

  const keyboard = top.map((m, idx) => [
    {
      text: `▶️ Ver Opción ${idx + 1} en Picta`,
      url: m.webUrl,
    },
  ]);

  return { html, keyboard };
}

const NON_REQUEST_COMMENT_REGEX =
  /^(?:gracias+|muchas gracias+|excelente+|buen[ao]\s+(?:peli|pelicula|serie|canal|calidad)|me\s+encant[oa]|genial+|bravo+|saludos+|hola+|no\s+(?:carga|abre|se\s+ve|tiene\s+audio|funciona|reproduce)|se\s+(?:traba|corta)|sin\s+audio|subtitulos?\s+desincronizados?)[\s!.,?]*$/i;

const GENERIC_VAGUE_TAIL = new Set([
  'mas',
  'otra',
  'otro',
  'esto',
  'eso',
  'esa',
  'ese',
  'algo',
  'algo mas',
  'por favor',
  'porfa',
  'gracias',
  'sube mas',
  'el resto',
  'lo demas',
  'todos',
  'todas',
  'completo',
  'completa',
  'videos',
  'mas videos',
  'contenido',
  'mas contenido',
  'peliculas',
  'series',
  'cosas',
  'cosas nuevas',
]);

const FALSE_POSITIVE_PRAISE_OR_GENERIC_REGEX =
  /(?:\bla\s+cabra\b|\bel\s+mejor\b|\bcrack\b|\bsigue\s+as[ií]\b|\bbuen\s+canal\b|\bexcelente\s+canal\b|\bvideos?\s+(?:a|en|de)\s+picta\b|\bcosas\s+en\s+el\s+apartado\b|\bcontenido\s+(?:a|en)\s+picta\b|\bm[aá]s\s+videos?\b|\bm[aá]s\s+contenido\b)/i;

function cleanExtractedCommentTitle(raw: string): string {
  let s = String(raw || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[@#]\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip polite prefixes / media nouns / leading personal 'a '
  s = s.replace(
    /^(?:por\s+favor|porfa+|xfa|de\s+favor|si\s+pueden|si\s+es\s+posible|hola|buenas|saludos|que\s+)[\s,:\-]*/i,
    ''
  );
  s = s.replace(
    /^(?:la\s+pel[ií]cula\s+(?:de\s+)?|pel[ií]cula\s+(?:de\s+)?|la\s+serie\s+(?:de\s+)?|serie\s+(?:de\s+)?|el\s+anime\s+(?:de\s+)?|anime\s+(?:de\s+)?|la\s+novela\s+(?:de\s+)?|el\s+dorama\s+(?:de\s+)?|el\s+documental\s+(?:de\s+)?|la\s+saga\s+(?:de\s+)?|el\s+|la\s+|los\s+|las\s+|a\s+)/i,
    ''
  );

  // Strip polite/language suffixes at the end
  s = s.replace(
    /[\s,.\-!]*(?:por\s+favor+|porfa+|xfa|de\s+favor|si\s+pueden|si\s+pudieran|si\s+se\s+puede|cuando\s+puedan|se\s+los\s+agradeceria|muchas\s+gracias|gracias+|en\s+espa[ñn]ol|en\s+latino|audio\s+latino|subtitulad[ao]s?|doblada|por\s+fis)[\s!?.]*$/gi,
    ''
  );
  s = s.replace(
    /[\s,.\-!]*(?:por\s+favor+|porfa+|xfa|muchas\s+gracias|gracias+)[\s!?.]*$/gi,
    ''
  );

  s = s.replace(/^["'«“(]+|["'»”?!.,:;]+$/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 100);
}

function isInvalidExtractedCandidate(candidate: string, norm: string): boolean {
  if (!candidate || candidate.length < 2 || norm.length < 2) return true;
  if (GENERIC_VAGUE_TAIL.has(norm)) return true;
  if (/^(?:aqui|aca|picta|telegram|canal|este\s+canal|tu\s+canal)$/i.test(norm)) return true;
  if (FALSE_POSITIVE_PRAISE_OR_GENERIC_REGEX.test(candidate)) return true;
  if (/^(?:cosas|algo|todo|videos?|pelis|pel[ií]culas?|series?)\s+(?:de|en|para|sobre|como)\b/i.test(norm) && norm.split(' ').length <= 5) {
    return true;
  }
  return false;
}

export function extractMediaRequestFromPictaComment(
  rawText: string,
  publicationTitle?: string
): { matched: boolean; title: string; reason: string } {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 5 || text.length > 320) {
    return { matched: false, title: '', reason: '' };
  }
  if (NON_REQUEST_COMMENT_REGEX.test(text)) {
    return { matched: false, title: '', reason: '' };
  }

  // 1. Explicit #pedido / pedido: / solicitud:
  const explicitMatch = text.match(
    /(?:^|\s)(?:#?pedido|#?solicitud|petici[oó]n)\s*[:\-]\s*([^.!?\n]{2,110})/i
  );
  if (explicitMatch?.[1]) {
    const title = cleanExtractedCommentTitle(explicitMatch[1]);
    const norm = normalizeRequestTitle(title);
    if (!isInvalidExtractedCandidate(title, norm)) {
      return { matched: true, title, reason: 'Etiqueta explícita de pedido' };
    }
  }

  // 2. Follow-up chapter / season request tied to the commented video (e.g. "cuando suben el capítulo 8", "falta la temporada 2")
  const followupMatch = text.match(
    /(?:cuando\s+(?:suben|sube|salen?|sale)|para\s+cuando|falta[n]?|suban|sube|podr[ií]an\s+subir|pueden\s+subir)\s+(?:el\s+|los\s+|la\s+|las\s+)?((?:cap[ií]tulo|episodio|ep\.?|temporada|parte|part)\s*#?\d+(?:\s*(?:al|a|-)\s*\d+)?)/i
  );
  if (followupMatch?.[1]) {
    const unit = followupMatch[1].trim();
    const base = String(publicationTitle || '')
      .replace(/\b(?:s\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3}|cap[ií]tulo\s*#?\d+|episodio\s*#?\d+)\b.*$/i, '')
      .replace(/[\-|–]+$/g, '')
      .trim();
    const combined = base && !/^Video #\d+$/i.test(base) ? `${base.slice(0, 70)} (${unit})` : unit;
    return { matched: true, title: combined, reason: 'Continuación de serie/temporada' };
  }

  // 3. Natural Spanish request phrases (clause-anchored or explicitly polite/interrogative so descriptive praise like "el que sube videos..." never matches)
  const phrasePatterns: Array<{ regex: RegExp; reason: string }> = [
    {
      regex:
        /(?:^|[.!?,;:\n¿]\s*|(?:por\s+favor|porfa+|xfa|de\s+favor|ojal[aá]|si\s+pueden|te\s+pido\s+que|les\s+pido\s+que|ser[ií]a\s+bueno\s+que|me\s+encantar[ií]a\s+que|puedes|pueden|podr[ií]an|pudieran)\s+)(?:podr[ií]an\s+subir|pudieran\s+subir|pueden\s+subir|puedes\s+subir|subanme|subeme|suban|sube|ser[ií]a\s+posible\s+subir|recomiendo\s+subir|pido\s+que\s+suban)\s+([^.!?\n]{2,115})/i,
      reason: 'Solicitud directa de subida',
    },
    {
      regex:
        /(?:^|[.!?,;:\n¿]\s*|\s)(?:quisiera\s+ver|me\s+gustar[ií]a\s+ver|quiero\s+ver|estoy\s+buscando|alguien\s+tiene|tienen\s+la\s+pel[ií]cula|tienen\s+la\s+serie|solicito\s+|para\s+cuando\s+|cuando\s+suben\s+)([^.!?\n]{2,115})/i,
      reason: 'Búsqueda o petición de título',
    },
  ];

  for (const { regex, reason } of phrasePatterns) {
    const m = text.match(regex);
    if (m?.[1]) {
      // Avoid descriptive relative praise like "que sube videos..."
      const fullMatch = m[0] || '';
      if (/\b(?:que|quien|el\s+que|la\s+que|como|cuando)\s+sube\b/i.test(fullMatch)) {
        continue;
      }
      const candidate = cleanExtractedCommentTitle(m[1]);
      const norm = normalizeRequestTitle(candidate);
      if (!isInvalidExtractedCandidate(candidate, norm)) {
        return { matched: true, title: candidate, reason };
      }
    }
  }

  return { matched: false, title: '', reason: '' };
}
