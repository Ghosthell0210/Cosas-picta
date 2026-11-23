export type PictaDashboardPeriod = 'today' | '7d' | '30d' | 'all';

export interface PictaResumenSummary {
  publicadas: number;
  views: number;
  plays: number;
  likes: number;
  downloads: number;
  comments: number;
}

export interface PictaDashboardGlobalStats {
  totalVideos: number;
  fetchedVideos: number;
  isPartialCatalog: boolean;
  publishedCount: number;
  hiddenOrPendingCount: number;
  publishedToday: number;
  dailyCapacity: number;
  quotaUsedToday: number;
  channelSubscribers: number;
  totalViews: number;
  totalPlays: number;
  totalLikes: number;
  totalDownloads: number;
  totalComments: number;
  topViewed?: any;
  topLiked?: any;
  webAdminAllTime?: PictaResumenSummary | null;
  webAdminLast30d?: PictaResumenSummary | null;
  webAdminLast7d?: PictaResumenSummary | null;
  webAdminToday?: PictaResumenSummary | null;
}

export function getCubaTodayStr(now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Havana',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value || '2026';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    return `${y}-${m}-${d}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function toCubaDateStr(isoDate?: string | number | Date | null): string {
  if (!isoDate) return '';
  try {
    const dt = new Date(isoDate);
    if (isNaN(dt.getTime())) return '';
    return getCubaTodayStr(dt);
  } catch {
    return '';
  }
}

export function getPictaDateRangeForPeriod(
  period: PictaDashboardPeriod,
  cubaTodayStr: string
): { dateGte?: string; dateLte?: string } {
  if (period === 'all') return {};
  if (period === 'today') {
    return { dateGte: cubaTodayStr, dateLte: cubaTodayStr };
  }
  const base = new Date(`${cubaTodayStr}T12:00:00Z`);
  if (isNaN(base.getTime())) return {};
  const daysBack = period === '7d' ? 6 : 29;
  const start = new Date(base.getTime() - daysBack * 86_400_000);
  return {
    dateGte: start.toISOString().slice(0, 10),
    dateLte: cubaTodayStr,
  };
}

export function parsePictaNextPageUrl(
  baseUrl: string,
  nextVal: unknown,
  currentPage: number
): string | null {
  if (!nextVal) return null;
  if (typeof nextVal === 'string') {
    const trimmed = nextVal.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^\d+$/.test(trimmed)) {
      const u = new URL(baseUrl);
      u.searchParams.set('page', trimmed);
      return u.toString();
    }
    try {
      return new URL(trimmed, baseUrl).toString();
    } catch {
      return null;
    }
  }
  if (typeof nextVal === 'number' && Number.isFinite(nextVal) && nextVal > currentPage) {
    const u = new URL(baseUrl);
    u.searchParams.set('page', String(Math.trunc(nextVal)));
    return u.toString();
  }
  return null;
}

export function extractPictaResumenMetrics(raw: any): PictaResumenSummary {
  const src = Array.isArray(raw) ? raw[0] || {} : raw?.results?.[0] || raw || {};
  return {
    publicadas:
      Number(src.publicadas ?? src.cantidad_publicaciones ?? src.total ?? src.count ?? 0) || 0,
    views: Number(src.visitas ?? src.cantidad_visitas ?? src.views ?? 0) || 0,
    plays: Number(src.reproducciones ?? src.cantidad_reproducciones ?? src.plays ?? 0) || 0,
    likes: Number(src.me_gusta ?? src.cantidad_me_gusta ?? src.likes ?? 0) || 0,
    downloads: Number(src.descargas ?? src.cantidad_descargas ?? src.downloads ?? 0) || 0,
    comments: Number(src.comentarios ?? src.cantidad_comentarios ?? src.comments ?? 0) || 0,
  };
}

export function mergeAndDedupeChannelPublications(
  batches: any[][],
  channelId: string | number
): any[] {
  const targetChan = Number(channelId || 0);
  const byId = new Map<number, any>();

  for (const list of batches || []) {
    for (const item of list || []) {
      if (!item || typeof item !== 'object') continue;
      const id = Number(item.id || 0);
      if (!id) continue;
      const itemChan = Number(
        typeof item.canal === 'object' ? item.canal?.id : item.canal_id ?? item.canal ?? 0
      );
      if (targetChan > 0 && itemChan > 0 && itemChan !== targetChan) continue;

      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, item);
      } else {
        byId.set(id, { ...prev, ...item });
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
}

export function computeGlobalChannelStats(
  publications: any[],
  opts: {
    reportedApiTotalCount: number;
    cubaTodayStr: string;
    dailyQuotaCapacity: number;
    quotaUsedToday: number;
    channelSubscribers: number;
    webAdminAllTime?: PictaResumenSummary | null;
    webAdminLast30d?: PictaResumenSummary | null;
    webAdminLast7d?: PictaResumenSummary | null;
    webAdminToday?: PictaResumenSummary | null;
  }
): PictaDashboardGlobalStats {
  let totalViews = 0;
  let totalPlays = 0;
  let totalLikes = 0;
  let totalDownloads = 0;
  let totalComments = 0;
  let publishedToday = 0;
  let publishedCount = 0;
  let hiddenOrPendingCount = 0;
  let topViewed: any = undefined;
  let topLiked: any = undefined;

  for (const p of publications || []) {
    const views = Number(p?.cantidad_visitas || 0);
    const plays = Number(p?.cantidad_reproducciones || 0);
    const likes = Number(p?.cantidad_me_gusta || 0);
    const downloads = Number(p?.cantidad_descargas || 0);
    const comments = Number(p?.cantidad_comentarios || 0);

    totalViews += views;
    totalPlays += plays;
    totalLikes += likes;
    totalDownloads += downloads;
    totalComments += comments;

    if (p?.publicado === false) {
      hiddenOrPendingCount++;
    } else {
      publishedCount++;
    }

    if (!topViewed || views > Number(topViewed.cantidad_visitas || 0)) {
      topViewed = p;
    }
    if (!topLiked || likes > Number(topLiked.cantidad_me_gusta || 0)) {
      topLiked = p;
    }

    const pubDate = toCubaDateStr(
      p?.fecha_publicado || p?.fecha_publicacion || p?.fecha_creacion || p?.created_at || p?.fecha
    );
    if (pubDate && pubDate === opts.cubaTodayStr) {
      publishedToday++;
    }
  }

  const fetchedVideos = publications.length;
  const reportedTotal = Number(opts.reportedApiTotalCount || 0);
  const totalVideos = Math.max(fetchedVideos, reportedTotal);

  return {
    totalVideos,
    fetchedVideos,
    isPartialCatalog: reportedTotal > fetchedVideos,
    publishedCount,
    hiddenOrPendingCount,
    publishedToday,
    dailyCapacity: Number(opts.dailyQuotaCapacity || 10),
    quotaUsedToday: Number(opts.quotaUsedToday || 0),
    channelSubscribers: Number(opts.channelSubscribers || 0),
    totalViews,
    totalPlays,
    totalLikes,
    totalDownloads,
    totalComments,
    topViewed,
    topLiked,
    webAdminAllTime: opts.webAdminAllTime || null,
    webAdminLast30d: opts.webAdminLast30d || null,
    webAdminLast7d: opts.webAdminLast7d || null,
    webAdminToday: opts.webAdminToday || null,
  };
}
