export type AchievementMetricKey = 'plays' | 'likes' | 'downloads' | 'comments' | 'views';

export const ACHIEVEMENT_METRICS_META: Record<
  AchievementMetricKey,
  { label: string; icon: string }
> = {
  plays: { label: 'Reproducciones', icon: '▶️' },
  likes: { label: 'Me gusta', icon: '❤️' },
  downloads: { label: 'Descargas', icon: '📥' },
  comments: { label: 'Comentarios', icon: '💬' },
  views: { label: 'Visitas', icon: '👁️' },
};

export const DEFAULT_MILESTONE_THRESHOLDS: number[] = [
  50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000,
];

export type EnabledAlertMetricsMap = Record<AchievementMetricKey, boolean>;

export interface ChatAlertPreferences {
  milestonesEnabled: boolean;
  commentsEnabled: boolean;
  enabledMetrics: EnabledAlertMetricsMap;
  thresholds: number[];
}

export interface PublicationAlertSnapshot {
  pubId: number;
  title: string;
  plays: number;
  likes: number;
  downloads: number;
  comments: number;
  views: number;
  commentCount: number;
  notifiedMilestones: Record<string, number[]>;
}

export interface ChannelCommentInput {
  id: number;
  texto: string;
  usuario: string;
  usuarioId?: number;
  fecha: string;
  publicacionId: number;
  publicacionNombre: string;
}

export function getDefaultAlertPreferences(): ChatAlertPreferences {
  return {
    milestonesEnabled: true,
    commentsEnabled: true,
    enabledMetrics: {
      plays: true,
      likes: true,
      downloads: true,
      comments: true,
      views: false,
    },
    thresholds: [...DEFAULT_MILESTONE_THRESHOLDS],
  };
}

export function normalizeAlertPreferences(
  partial?: Partial<ChatAlertPreferences> | null
): ChatAlertPreferences {
  const def = getDefaultAlertPreferences();
  if (!partial || typeof partial !== 'object') return def;

  const rawMetrics = partial.enabledMetrics as unknown;
  const enabledMetrics: EnabledAlertMetricsMap = { ...def.enabledMetrics };

  if (Array.isArray(rawMetrics)) {
    enabledMetrics.plays = rawMetrics.includes('plays');
    enabledMetrics.likes = rawMetrics.includes('likes');
    enabledMetrics.downloads = rawMetrics.includes('downloads');
    enabledMetrics.comments = rawMetrics.includes('comments');
    enabledMetrics.views = false;
  } else if (rawMetrics && typeof rawMetrics === 'object') {
    const obj = rawMetrics as Partial<Record<AchievementMetricKey, unknown>>;
    enabledMetrics.plays = obj.plays !== undefined ? Boolean(obj.plays) : def.enabledMetrics.plays;
    enabledMetrics.likes = obj.likes !== undefined ? Boolean(obj.likes) : def.enabledMetrics.likes;
    enabledMetrics.downloads =
      obj.downloads !== undefined ? Boolean(obj.downloads) : def.enabledMetrics.downloads;
    enabledMetrics.comments =
      obj.comments !== undefined ? Boolean(obj.comments) : def.enabledMetrics.comments;
    enabledMetrics.views = false;
  }

  const thresholds = Array.isArray(partial.thresholds)
    ? Array.from(
        new Set(
          partial.thresholds
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      ).sort((a, b) => a - b)
    : def.thresholds;

  return {
    milestonesEnabled:
      partial.milestonesEnabled !== undefined ? Boolean(partial.milestonesEnabled) : true,
    commentsEnabled:
      partial.commentsEnabled !== undefined ? Boolean(partial.commentsEnabled) : true,
    enabledMetrics,
    thresholds: thresholds.length > 0 ? thresholds : def.thresholds,
  };
}

export function parseCustomMilestoneThresholds(input: string): {
  valid: boolean;
  thresholds: number[];
  error?: string;
} {
  const parts = String(input || '')
    .split(/[,;\s]+/)
    .map((s) => Number(s.replace(/[^0-9]/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 1);
  const unique = Array.from(new Set(parts)).sort((a, b) => a - b);
  if (unique.length === 0) {
    return {
      valid: false,
      thresholds: [],
      error: 'Ingresa números separados por coma (ej: 50, 100, 500, 1000).',
    };
  }
  return { valid: true, thresholds: unique.slice(0, 20) };
}

export function formatMilestoneNumber(num: number): string {
  const n = Number(num || 0);
  return n.toLocaleString('es-CU');
}

export function evaluatePublicationMilestones(params: {
  pub: {
    id: number;
    nombre: string;
    cantidad_reproducciones: number;
    cantidad_me_gusta: number;
    cantidad_descargas: number;
    cantidad_comentarios: number;
    cantidad_visitas: number;
  };
  prefs: ChatAlertPreferences;
  prevSnapshot?: PublicationAlertSnapshot;
  baselineInitialized: boolean;
}): {
  nextSnapshot: PublicationAlertSnapshot;
  events: Array<{
    pubId: number;
    pubTitle: string;
    metricKey: AchievementMetricKey;
    metricLabel: string;
    metricIcon: string;
    threshold: number;
    crossedThresholds: number[];
    currentValue: number;
    statsSummary: {
      plays: number;
      likes: number;
      downloads: number;
      comments: number;
      views: number;
    };
  }>;
} {
  const { pub, prefs, prevSnapshot, baselineInitialized } = params;
  const currentMetrics: Record<AchievementMetricKey, number> = {
    plays: Number(pub.cantidad_reproducciones || 0),
    likes: Number(pub.cantidad_me_gusta || 0),
    downloads: Number(pub.cantidad_descargas || 0),
    comments: Number(pub.cantidad_comentarios || 0),
    views: Number(pub.cantidad_visitas || 0),
  };

  const notifiedMilestones: Record<string, number[]> = prevSnapshot?.notifiedMilestones
    ? JSON.parse(JSON.stringify(prevSnapshot.notifiedMilestones))
    : {};

  const events: Array<{
    pubId: number;
    pubTitle: string;
    metricKey: AchievementMetricKey;
    metricLabel: string;
    metricIcon: string;
    threshold: number;
    crossedThresholds: number[];
    currentValue: number;
    statsSummary: {
      plays: number;
      likes: number;
      downloads: number;
      comments: number;
      views: number;
    };
  }> = [];

  const activeMetricKeys = (
    ['plays', 'likes', 'downloads', 'comments'] as AchievementMetricKey[]
  ).filter((k) => Boolean(prefs.enabledMetrics?.[k]));

  for (const metricKey of activeMetricKeys) {
    const val = currentMetrics[metricKey];
    const already = new Set<number>(notifiedMilestones[metricKey] || []);
    const newlyCrossed = prefs.thresholds.filter((th) => val >= th && !already.has(th));

    if (newlyCrossed.length > 0) {
      for (const th of newlyCrossed) already.add(th);
      notifiedMilestones[metricKey] = Array.from(already).sort((a, b) => a - b);

      if (baselineInitialized && prefs.milestonesEnabled && prevSnapshot) {
        const meta = ACHIEVEMENT_METRICS_META[metricKey];
        events.push({
          pubId: pub.id,
          pubTitle: pub.nombre,
          metricKey,
          metricLabel: meta.label,
          metricIcon: meta.icon,
          threshold: newlyCrossed[newlyCrossed.length - 1],
          crossedThresholds: newlyCrossed,
          currentValue: val,
          statsSummary: currentMetrics,
        });
      }
    }
  }

  return {
    nextSnapshot: {
      pubId: pub.id,
      title: pub.nombre,
      plays: currentMetrics.plays,
      likes: currentMetrics.likes,
      downloads: currentMetrics.downloads,
      comments: currentMetrics.comments,
      views: currentMetrics.views,
      commentCount: currentMetrics.comments,
      notifiedMilestones,
    },
    events,
  };
}

export function detectNewChannelComments(params: {
  comments: ChannelCommentInput[];
  seenCommentIds: number[];
  baselineInitialized: boolean;
  ownUserId?: number;
  ownUsername?: string;
}): {
  newComments: ChannelCommentInput[];
  nextSeenCommentIds: number[];
} {
  const seen = new Set<number>((params.seenCommentIds || []).map((n) => Number(n)));
  const newComments: ChannelCommentInput[] = [];
  const ownNameLow = String(params.ownUsername || '').trim().toLowerCase();

  for (const c of params.comments || []) {
    const cid = Number(c.id || 0);
    if (!cid) continue;
    const isNew = !seen.has(cid);
    seen.add(cid);
    if (!params.baselineInitialized || !isNew) continue;

    if (params.ownUserId && c.usuarioId && Number(c.usuarioId) === Number(params.ownUserId)) {
      continue;
    }
    if (ownNameLow && c.usuario.toLowerCase() === ownNameLow) {
      continue;
    }
    newComments.push(c);
  }

  const nextSeenCommentIds = Array.from(seen).slice(-500);
  return { newComments, nextSeenCommentIds };
}
