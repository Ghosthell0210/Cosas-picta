export interface AdminUserSessionSummary {
  chatId?: string;
  username: string;
  userFullName?: string;
  channelId?: string;
  channelName?: string;
  hasAuthToken?: boolean;
  hasPassword?: boolean;
  tokenExpiresAt?: number;
  availableChannelsCount?: number;
  updatedAt?: string;
}

export interface AdminUserPromoSummary {
  telegramChannelDisplay: string;
  pictaChannelUrl?: string;
}

export interface AdminUserPinnedSerieSummary {
  serieName: string;
  seasonNum: string;
}

export interface AdminUserRecentJobView {
  id: string;
  title: string;
  category: string;
  stage: string;
  bytes: number;
  speedMBps: number;
  pictaPublicationId?: number;
  updatedAt: string;
  isToday: boolean;
}

export interface AdminUserComputedEntry {
  chatId: string;
  displayName: string;
  username?: string;
  isMasterAdmin: boolean;
  pictaLinked: boolean;
  authorizedAt: string;
  pictaChannelLabel: string;
  pictaAccountLabel: string;
  availableChannelsCount: number;
  sessionStatusLabel: string;
  dailyQuotaLimit: number;
  uploadedTodayCount: number;
  remainingTodayCount: number;
  quotaPercent: number;
  moviesUploadedTodayCount: number;
  seriesUploadedTodayCount: number;
  bytesUploadedToday: number;
  failedTodayCount: number;
  totalCompletedCount: number;
  totalBytesUploaded: number;
  totalFailedCount: number;
  avgSpeedMBps: number;
  activeJobsCount: number;
  queuedJobsCount: number;
  activeJobTitle?: string;
  pinnedSerie?: AdminUserPinnedSerieSummary;
  promoChannel?: AdminUserPromoSummary;
  lastUploadTitle?: string;
  lastUploadAt?: string;
  recentJobs: AdminUserRecentJobView[];
}

export function computeEnrichedAdminUsersSummary(params: {
  currentDateCuba: string;
  masterAdminChatId: string;
  masterAdminPictaUsername: string;
  masterAdminChannelId: string;
  masterAdminChannelName: string;
  masterAdminDailyCapacity: number;
  masterAdminSeriesToday: number;
  masterAdminOtherToday: number;
  authorizedUsers: Array<{
    chatId: string;
    username?: string;
    firstName?: string;
    authorizedAt?: string;
  }>;
  sessionsByChatId: Map<string, AdminUserSessionSummary>;
  pinnedByChatId: Map<string, AdminUserPinnedSerieSummary>;
  promoByChatId: Map<string, AdminUserPromoSummary>;
  jobs: Array<{
    id: string;
    telegramChatId: string;
    title: string;
    category: string;
    tipologiaId: number;
    stage: string;
    expectedBytes?: number;
    diskVerifiedBytes?: number;
    speedMBps?: number;
    pictaPublicationId?: number;
    createdAt: string;
    updatedAt?: string;
  }>;
  toCubaDateStr: (iso?: string | null) => string;
}): {
  currentDateCuba: string;
  totalAuthorizedUsers: number;
  linkedPictaUsers: number;
  unlinkedPictaUsers: number;
  totalUploadedTodayAllUsers: number;
  totalMoviesTodayAllUsers: number;
  totalSeriesTodayAllUsers: number;
  totalBytesTodayAllUsers: number;
  totalCompletedHistoricalAllUsers: number;
  totalBytesHistoricalAllUsers: number;
  totalActiveOrQueuedAllUsers: number;
  users: AdminUserComputedEntry[];
} {
  const {
    currentDateCuba,
    masterAdminChatId,
    masterAdminPictaUsername,
    masterAdminChannelId,
    masterAdminChannelName,
    masterAdminDailyCapacity,
    masterAdminSeriesToday,
    masterAdminOtherToday,
    authorizedUsers,
    sessionsByChatId,
    pinnedByChatId,
    promoByChatId,
    jobs,
    toCubaDateStr,
  } = params;

  const userMap = new Map<
    string,
    { chatId: string; username?: string; firstName?: string; authorizedAt: string }
  >();
  userMap.set(masterAdminChatId, {
    chatId: masterAdminChatId,
    username: 'admin_bot',
    firstName: 'Admin Principal',
    authorizedAt: new Date(0).toISOString(),
  });
  for (const au of authorizedUsers || []) {
    if (!au?.chatId) continue;
    userMap.set(String(au.chatId), {
      chatId: String(au.chatId),
      username: au.username,
      firstName: au.firstName,
      authorizedAt: au.authorizedAt || new Date().toISOString(),
    });
  }

  let linkedPictaUsers = 0;
  let unlinkedPictaUsers = 0;
  let totalUploadedTodayAllUsers = 0;
  let totalMoviesTodayAllUsers = 0;
  let totalSeriesTodayAllUsers = 0;
  let totalBytesTodayAllUsers = 0;
  let totalCompletedHistoricalAllUsers = 0;
  let totalBytesHistoricalAllUsers = 0;
  let totalActiveOrQueuedAllUsers = 0;

  const entries: AdminUserComputedEntry[] = [];

  for (const u of userMap.values()) {
    const isMasterAdmin = String(u.chatId) === String(masterAdminChatId);
    const sess = sessionsByChatId.get(u.chatId);
    const pictaLinked = isMasterAdmin ? true : Boolean(sess && sess.channelId);
    if (pictaLinked) linkedPictaUsers++;
    else unlinkedPictaUsers++;

    const userJobs = (jobs || [])
      .filter((j) => String(j.telegramChatId) === String(u.chatId))
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime()
      );

    let completedCount = 0;
    let totalBytesUploaded = 0;
    let failedCount = 0;
    let speedSum = 0;
    let speedCount = 0;
    let moviesToday = 0;
    let seriesToday = 0;
    let bytesToday = 0;
    let failedTodayCount = 0;
    let activeJobsCount = 0;
    let queuedJobsCount = 0;
    let activeJobTitle: string | undefined;
    let lastUploadTitle: string | undefined;
    let lastUploadAt: string | undefined;

    for (const j of userJobs) {
      const dateStr = toCubaDateStr(j.updatedAt || j.createdAt);
      const isToday = dateStr === currentDateCuba;
      const bytes = Number(j.diskVerifiedBytes || j.expectedBytes || 0);

      if (j.stage === 'completed') {
        completedCount++;
        totalBytesUploaded += bytes;
        if (!lastUploadTitle) {
          lastUploadTitle = j.title;
          lastUploadAt = j.updatedAt || j.createdAt;
        }
        if (Number(j.speedMBps || 0) > 0) {
          speedSum += Number(j.speedMBps);
          speedCount++;
        }
        if (isToday) {
          bytesToday += bytes;
          if (Number(j.tipologiaId) === 5) seriesToday++;
          else moviesToday++;
        }
      } else if (j.stage === 'failed') {
        failedCount++;
        if (isToday) failedTodayCount++;
      } else if (j.stage === 'queued') {
        queuedJobsCount++;
      } else if (j.stage !== 'cancelled') {
        activeJobsCount++;
        if (!activeJobTitle) activeJobTitle = j.title;
      }
    }

    const effectiveSeriesToday = isMasterAdmin
      ? Math.max(seriesToday, Number(masterAdminSeriesToday || 0))
      : seriesToday;
    const effectiveMoviesToday = isMasterAdmin
      ? Math.max(moviesToday, Number(masterAdminOtherToday || 0))
      : moviesToday;
    const uploadedTodayCount = effectiveSeriesToday + effectiveMoviesToday;
    const dailyQuotaLimit = isMasterAdmin ? Math.max(10, masterAdminDailyCapacity) : 10;
    const remainingTodayCount = Math.max(0, dailyQuotaLimit - uploadedTodayCount);
    const quotaPercent = Math.min(100, Math.round((uploadedTodayCount / dailyQuotaLimit) * 100));

    totalUploadedTodayAllUsers += uploadedTodayCount;
    totalMoviesTodayAllUsers += effectiveMoviesToday;
    totalSeriesTodayAllUsers += effectiveSeriesToday;
    totalBytesTodayAllUsers += bytesToday;
    totalCompletedHistoricalAllUsers += completedCount;
    totalBytesHistoricalAllUsers += totalBytesUploaded;
    totalActiveOrQueuedAllUsers += activeJobsCount + queuedJobsCount;

    const pictaChannelLabel = isMasterAdmin
      ? `${masterAdminChannelName} (#${masterAdminChannelId})`
      : sess?.channelId
        ? `${sess.channelName || 'Canal'} (#${sess.channelId})`
        : 'Sin canal vinculado';

    const pictaAccountLabel = isMasterAdmin
      ? masterAdminPictaUsername
      : sess?.username || 'Sin cuenta Picta';

    const sessionStatusLabel = isMasterAdmin
      ? '🟢 Activa (Principal)'
      : !sess
        ? '⚪ No iniciada'
        : sess.tokenExpiresAt && sess.tokenExpiresAt > Date.now()
          ? '🟢 Token OAuth vigente'
          : '🟡 Renovación automática al subir';

    const recentJobs: AdminUserRecentJobView[] = userJobs.slice(0, 6).map((j) => ({
      id: j.id,
      title: j.title,
      category: j.category,
      stage: j.stage,
      bytes: Number(j.diskVerifiedBytes || j.expectedBytes || 0),
      speedMBps: Number(j.speedMBps || 0),
      pictaPublicationId: j.pictaPublicationId,
      updatedAt: j.updatedAt || j.createdAt,
      isToday: toCubaDateStr(j.updatedAt || j.createdAt) === currentDateCuba,
    }));

    entries.push({
      chatId: u.chatId,
      displayName: isMasterAdmin
        ? 'Admin Principal'
        : u.firstName || (u.username ? `@${u.username}` : `Usuario ${u.chatId}`),
      username: u.username,
      isMasterAdmin,
      pictaLinked,
      authorizedAt: u.authorizedAt,
      pictaChannelLabel,
      pictaAccountLabel,
      availableChannelsCount: sess?.availableChannelsCount || (pictaLinked ? 1 : 0),
      sessionStatusLabel,
      dailyQuotaLimit,
      uploadedTodayCount,
      remainingTodayCount,
      quotaPercent,
      moviesUploadedTodayCount: effectiveMoviesToday,
      seriesUploadedTodayCount: effectiveSeriesToday,
      bytesUploadedToday: bytesToday,
      failedTodayCount,
      totalCompletedCount: completedCount,
      totalBytesUploaded,
      totalFailedCount: failedCount,
      avgSpeedMBps: speedCount > 0 ? Number((speedSum / speedCount).toFixed(2)) : 0,
      activeJobsCount,
      queuedJobsCount,
      activeJobTitle,
      pinnedSerie: pinnedByChatId.get(u.chatId),
      promoChannel: promoByChatId.get(u.chatId),
      lastUploadTitle,
      lastUploadAt,
      recentJobs,
    });
  }

  entries.sort((a, b) => {
    if (a.isMasterAdmin !== b.isMasterAdmin) return a.isMasterAdmin ? -1 : 1;
    return b.uploadedTodayCount - a.uploadedTodayCount || b.totalCompletedCount - a.totalCompletedCount;
  });

  return {
    currentDateCuba,
    totalAuthorizedUsers: entries.length,
    linkedPictaUsers,
    unlinkedPictaUsers,
    totalUploadedTodayAllUsers,
    totalMoviesTodayAllUsers,
    totalSeriesTodayAllUsers,
    totalBytesTodayAllUsers,
    totalCompletedHistoricalAllUsers,
    totalBytesHistoricalAllUsers,
    totalActiveOrQueuedAllUsers,
    users: entries,
  };
}
