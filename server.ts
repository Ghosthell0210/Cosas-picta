import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';
import { URL } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import {
  PICTA_TIPOLOGIAS,
  type BotConfig,
  type LiveEventLog,
  type MtprotoDiagLogEntry,
  type LiveSystemState,
  type PictaAuthenticatedUser,
  type PictaChannelOption,
  type PictaFieldMapping,
  type PictaTipologia,
  type VideoTransferJob,
} from './src/types.ts';
import {
  isMasterAdminChat,
  resolveGuestOrAdminChannelMeta,
  normalizePictaChannelDetails,
  isGenericAutoSynopsis,
  extractChannelsFromPictaRecords,
  extractScalarChannelIdsFromRecord,
  extractPictaEntityId,
  isChannelOwnedOrAssociatedByUser,
  filterMatchingOwnedChannels,
  sanitizeLeakedUserSession,
  filterSeriesForChannel,
  PICTA_CHANNEL_CLASIFICACIONES,
  type PictaChannelDetails,
  type PictaUserOwnershipIdentity,
} from './src/utils/pictaChannelIsolation.ts';
import {
  resolveScratchUploadDir,
  getScratchDiskStats,
  ensureScratchSpaceForFile,
  cleanupOrphanedScratchFiles,
  getMemoryTelemetry,
} from './src/utils/scratchDiskManager.ts';
import {
  MAX_PREFETCH_LOOKAHEAD,
  selectNextUploadJob,
  selectNextDownloadJob,
  filterJobsForUser,
  isJobReadyForUpload,
  type PipelineJobDescriptor,
} from './src/utils/transferPipelinePlanner.ts';
import {
  isTitleMatchStrict,
  isLikelyEnglishText,
  cleanMediaTitleForSearch,
  scoreCandidateMatch,
  decideBestOrTop3Candidates,
  type MediaMatchCandidate,
  type CandidateDisambiguationResult,
} from './src/utils/mediaMetadataMatcher.ts';
import {
  filterChannelPlaylists,
  filterChannelComments,
  computeUpdatedChannelCollaborators,
  extractPictaPublicationLinks,
  normalizeDenunciaCounts,
  type PictaPlaylistRecord,
  type PictaCommentRecord,
  type PictaDenunciaSummary,
  type CommentPublicationMeta,
} from './src/utils/pictaApiToolkit.ts';
import {
  buildTmdbImageUrls,
  selectOnlineImageForSlot,
  cleanTitleForTmdbPosterSearch,
  selectUploadPairBuffers,
  buildPublicationImagePatchFiles,
  buildSerieImagePatchFiles,
  type PictaImageSlot,
} from './src/utils/posterMediaResolver.ts';
import {
  cleanGeneralVideoTitle,
  isGenericOrInvalidSerieName,
  isRandomOrCrypticFilename,
  parseSingleSeriesCandidate,
  formatSerieEpisodeTitle,
  extractSeriesInfoFromText,
  analyzeVideoTitleAndSynopsis,
  splitCaptionIntoTitleAndSynopsis,
  buildSerieTitleOptions,
  isStaleOrGenericSerieSynopsis,
  detectDominantSeriesTitleStyle,
  formatEpisodeWithSeriesStyle,
  type DetectedSeriesTitleStyle,
} from './src/utils/seriesEpisodeParser.ts';
import {
  MAX_ENCODER_AUTO_RETRIES,
  isPictaEncoderOrTransientServerError,
  extractShortEncoderErrorReason,
  computeNextEncoderRetryState,
  isEncoderJobPausedInQueue,
  isEncoderJobDueForRetry,
} from './src/utils/pictaEncoderRetry.ts';
import {
  extractPictaGroupSummary,
  isPictaForbiddenResponse,
  buildPictaRoleDiagnosticLines,
} from './src/utils/pictaAccountDiagnostics.ts';
import {
  ACHIEVEMENT_METRICS_META,
  DEFAULT_MILESTONE_THRESHOLDS,
  getDefaultAlertPreferences,
  normalizeAlertPreferences,
  parseCustomMilestoneThresholds,
  formatMilestoneNumber,
  evaluatePublicationMilestones,
  detectNewChannelComments,
  type AchievementMetricKey,
  type ChatAlertPreferences,
  type PublicationAlertSnapshot,
  type ChannelCommentInput,
} from './src/utils/pictaAlertsAndMilestones.ts';
import {
  hudBox,
  hudHeader,
  hudSection,
  hudSegmentedBar,
  hudWizardStep,
} from './src/utils/telegramHud.ts';
import {
  getCubaTodayStr,
  toCubaDateStr,
  getPictaDateRangeForPeriod,
  parsePictaNextPageUrl,
  extractPictaResumenMetrics,
  mergeAndDedupeChannelPublications,
  computeGlobalChannelStats,
  type PictaDashboardPeriod,
  type PictaResumenSummary,
  type PictaDashboardGlobalStats,
} from './src/utils/pictaDashboardStats.ts';
import {
  resolveRequestsChannelForChat,
  parseTelegramChannelInput,
  resolveCanonicalPictaChannelUrl,
  buildMoviePromoCardPayload,
  normalizeMovieRatingLabel,
  type UserPromoChannelConfig,
  type PendingMoviePromoRecord,
} from './src/utils/moviePromoCard.ts';
import {
  decodeTelegramBotFileId,
  buildDirectDownloadChunks,
  splitChunkInto512KbParts,
  classifyMtprotoDownloadError,
  shouldUseMainClientSenderForPrimarySlot,
  selectLeastBusySenderSlot,
  computePoolWarmupCount,
  formatMtprotoDownloadHudLine,
  MTPROTO_TURBO_CHUNK_BYTES,
  MTPROTO_FALLBACK_CHUNK_BYTES,
  MTPROTO_SAFE_PARALLEL_WORKERS,
  MTPROTO_TCP_POOL_SIZE,
  MTPROTO_SLEEP_THRESHOLD_SECONDS,
  S3_UPLOAD_HIGH_WATER_MARK_BYTES,
  TELEGRAM_MTPROTO_MAX_FILE_MB,
  PICTA_S3_MAX_OBJECT_BYTES,
  type DownloadChunkDescriptor,
} from './src/utils/mtprotoFastDownload.ts';
import { FastPromisedNetSockets } from './src/utils/fastNetSocket.ts';
import {
  computeEnrichedAdminUsersSummary,
  type AdminUserSessionSummary,
  type AdminUserPromoSummary,
  type AdminUserPinnedSerieSummary,
} from './src/utils/adminUsersDashboard.ts';
import {
  assembleMultiPartFilesOnDisk,
  type MultiPartSourceDescriptor,
} from './src/utils/multiPartDiskAssembler.ts';
import {
  parseTelegramMessageLink,
  extractDirectVideoUrl,
  isProbableVideoHttpResponse,
} from './src/utils/linkVideoIngestion.ts';
import {
  buildChannelAuditReport,
  type ChannelAuditReport,
} from './src/utils/channelAudit.ts';
import {
  parseSubscriberRequestMessage,
  findMatchingPendingRequests,
  formatSubscriberPictaReplyHtml,
  normalizeRequestTitle,
  extractMediaRequestFromPictaComment,
  type ChannelMediaRequest,
  type RequestsMonitorMode,
  type PictaRequestMatchHit,
} from './src/utils/channelRequestsManager.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const START_TIME = Date.now();
const K_SERVICE_NAME = String(process.env.K_SERVICE || '');
const IS_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === 'production' ||
  (Boolean(K_SERVICE_NAME) && !K_SERVICE_NAME.startsWith('ais-dev-'));
const IS_AI_STUDIO_DEV_PREVIEW =
  K_SERVICE_NAME.startsWith('ais-dev-') || !IS_PRODUCTION_RUNTIME;
const IS_CLOUD_RUN_SERVICE =
  !IS_AI_STUDIO_DEV_PREVIEW &&
  Boolean(
    K_SERVICE_NAME ||
    process.env.K_REVISION ||
    process.env.CLOUDRUN_CONTAINER_SERVICE ||
    process.env.PORT
  );
const IS_PREVIEW_INSTANCE = !IS_CLOUD_RUN_SERVICE;

// Store mutable runtime state in /tmp/picta_bot_state and heavy scratch videos on Cloud Run Ephemeral Disk (or /tmp fallback)
const TMP_UPLOAD_DIR = resolveScratchUploadDir();
const STATE_DIR = '/tmp/picta_bot_state';
const LEGACY_DATA_DIR = path.resolve(process.cwd(), '.data');

const JOBS_FILE = path.join(STATE_DIR, 'jobs.json');
const PROCESSED_UPDATES_FILE = path.join(STATE_DIR, 'processed_updates.json');
const MTPROTO_SESSION_FILE = path.join(STATE_DIR, 'mtproto_session.json');
const AUTHORIZED_USERS_FILE = path.join(STATE_DIR, 'authorized_users.json');
const USER_SESSIONS_FILE = path.join(STATE_DIR, 'user_sessions.json');
const QUOTA_SETTINGS_FILE = path.join(STATE_DIR, 'quota_settings.json');
const ALERTS_STATE_FILE = path.join(STATE_DIR, 'picta_alerts_state.json');
const PROMO_CHANNELS_FILE = path.join(STATE_DIR, 'promo_channels.json');
const PENDING_PROMOS_FILE = path.join(STATE_DIR, 'pending_promos.json');
const CHANNEL_REQUESTS_FILE = path.join(STATE_DIR, 'channel_requests.json');
const IGNORED_REQUEST_COMMENTS_FILE = path.join(STATE_DIR, 'ignored_comment_requests.json');
const MASTER_ADMIN_CHAT_ID = '1981484200'; // Admin (Administrador Principal)

// Private requests channel default exclusive to Master Admin ONLY (never exposed or shared with guests)
const MASTER_PRIVATE_REQUESTS_CHANNEL = {
  targetChannelId: '-1004395450472',
  targetChannelLabel: 'Pedidos Canal Oficial (@multiversovisual)',
  pictaChannelUrl: 'https://www.picta.cu/canal/multiverso-visual-440cjfir6jyg4pb7',
};

// Official Picta Admin constants (https://admin.picta.cu/)
const PICTA_OFFICIAL_CLIENT_ID = 'lBNcdmsTc5Om3N9MTP4Dy9Rnzc6eooPU4QVHVvS5';
const PICTA_AES_KEY = '8A@bIUzA9Yukz!0G';

// Valid 1x1 dark blue JPEG fallback if Telegram video has no thumbnail
const FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

for (const dir of [TMP_UPLOAD_DIR, STATE_DIR]) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Ignore read-only fs errors in production if any
  }
}

function mirrorFileToLegacyDataDir(_stateFilePath: string, _legacyFileName?: string): void {
  // Mutable runtime state lives strictly in /tmp/picta_bot_state + Telegram Cloud Vault.
  // Do not write runtime tokens, sessions, or job files back into workspace .data/.
}

// One-time migration from .data/ to /tmp/picta_bot_state/ so authorized MTProto session, users, sessions & quota are preserved
function migrateLegacyStateOnce(): void {
  try {
    const pairs: Array<[string, string]> = [
      [MTPROTO_SESSION_FILE, 'mtproto_session_v2.json'],
      [PROCESSED_UPDATES_FILE, 'processed_updates.json'],
      [JOBS_FILE, 'runtime_jobs_v2.json'],
      [AUTHORIZED_USERS_FILE, 'authorized_users.json'],
      [USER_SESSIONS_FILE, 'user_sessions.json'],
      [QUOTA_SETTINGS_FILE, 'quota_settings.json'],
      [ALERTS_STATE_FILE, 'picta_alerts_state.json'],
      [PROMO_CHANNELS_FILE, 'promo_channels.json'],
      [PENDING_PROMOS_FILE, 'pending_promos.json'],
      [path.join(STATE_DIR, 'pinned_series.json'), 'pinned_series.json'],
      [path.join(STATE_DIR, 'channel_series.json'), 'channel_series.json'],
    ];
    for (const [stateFile, legacyName] of pairs) {
      const legacyPath = path.join(LEGACY_DATA_DIR, legacyName);
      if (!fs.existsSync(stateFile) && fs.existsSync(legacyPath)) {
        fs.copyFileSync(legacyPath, stateFile);
      }
    }
  } catch {
    // Ignore migration errors
  }
}

migrateLegacyStateOnce();

const DEFAULT_FIELD_MAPPING: PictaFieldMapping = {
  videoField: 'file',
  titleField: 'nombre',
  synopsisField: 'descripcion',
  categoryField: 'tipologia',
  channelField: 'canal',
  publishedField: 'publicado',
  extraFieldsJson: '{}',
};

let dynamicDetectedPublicUrl = '';

function detectCloudRunUrl(): string {
  if (dynamicDetectedPublicUrl && dynamicDetectedPublicUrl.startsWith('http')) {
    return dynamicDetectedPublicUrl;
  }
  const envUrl = (process.env.APP_URL || process.env.WEBHOOK_DOMAIN || '').trim();
  if (envUrl && envUrl !== 'MY_APP_URL' && envUrl.startsWith('http') && !envUrl.includes('ais-dev-')) {
    return envUrl.replace(/\/+$/, '');
  }
  return 'https://untitled-3150.ai.studio';
}

const botConfig: BotConfig = {
  telegramBotToken:
    process.env.TELEGRAM_BOT_TOKEN || '9195788111:AAGbZxDK5IxhoGm2THlYiAdzMbvXe8nxDAk',
  telegramApiId: process.env.TELEGRAM_API_ID || '23067663',
  telegramApiHash: process.env.TELEGRAM_API_HASH || '8b2aa6c8a7372df2f1a344b541a2aadb',
  telegramLocalApiUrl: process.env.TELEGRAM_LOCAL_API_URL || '',
  webhookUrl: `${detectCloudRunUrl()}/api/telegram/webhook`,
  useWebhook: true,
  allowedChatIds: '',
  pictaUsername: process.env.PICTA_USERNAME || '50000000',
  pictaPassword: process.env.PICTA_PASSWORD || 'Ghost.0210',
  pictaClientId: PICTA_OFFICIAL_CLIENT_ID,
  pictaBaseUrl: 'https://admin.picta.cu',
  pictaUploadEndpoint: 'https://api.picta.cu/v1/publicacion/',
  pictaAuthType: 'oauth_password',
  pictaAuthToken: '',
  pictaCookie: '',
  pictaChannelId: '36319', // Canal Oficial (#36319)
  pictaTipologiaId: '8', // Audiovisual
  pictaDefaultCategory: 'Audiovisual',
  pictaClasificacion: '18+',
  pictaPalabraClaveId: '5476', // picta
  channelThemeDescription:
    'Canal Canal Oficial — El Rincón Visual: películas, series, videojuegos, tecnología y entretenimiento en Picta Cuba',
  fieldMapping: { ...DEFAULT_FIELD_MAPPING },
};

function cleanSerieDisplayName(rawName: string | undefined): string {
  return String(rawName || '')
    .replace(/\s+\b(?:temp(?:orada)?\.?\s*\d+)\s*$/i, '')
    .trim();
}

function sanitizePublicPictaText(rawText: string | undefined): string {
  return String(rawText || '')
    .replace(/\s*\(\s*#?\d{3,8}\s*\)/g, '')
    .replace(/\s*\(\s*ID\s*:\s*#?\d+\s*\)/gi, '')
    .replace(/\s*#36319\b/g, '')
    .replace(/\bcanal\s+36319\b/gi, 'canal')
    .replace(/\bEl Mentalista\s+Temp(?:orada)?\.?\s*\d+\b/gi, 'El Mentalista')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function loadJobsFromDisk(): VideoTransferJob[] {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return [];
}

function pruneTransferJobsMemory(): void {
  const active: VideoTransferJob[] = [];
  const terminal: VideoTransferJob[] = [];
  for (const job of transferJobs) {
    if (!job) continue;
    if (job.stage === 'completed' || job.stage === 'failed' || job.stage === 'cancelled') {
      terminal.push(job);
    } else {
      active.push(job);
    }
  }
  if (terminal.length > 100) {
    transferJobs = [...active, ...terminal.slice(0, 100)];
  }
}

function saveJobsToDisk(): void {
  try {
    pruneTransferJobsMemory();
    const active = transferJobs.filter(
      (j) => j.stage !== 'completed' && j.stage !== 'failed' && j.stage !== 'cancelled'
    );
    const terminal = transferJobs.filter(
      (j) => j.stage === 'completed' || j.stage === 'failed' || j.stage === 'cancelled'
    );
    const toPersist = [...active, ...terminal].slice(0, 60);
    fs.writeFileSync(JOBS_FILE, JSON.stringify(toPersist, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(JOBS_FILE, 'runtime_jobs_v2.json');
  } catch {
    // Ignore
  }
}

function loadMtprotoSessionFromDisk(): string {
  try {
    if (fs.existsSync(MTPROTO_SESSION_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MTPROTO_SESSION_FILE, 'utf-8'));
      if (parsed && typeof parsed.session === 'string' && parsed.session.trim()) {
        return parsed.session.trim();
      }
    }
  } catch {
    // Ignore
  }
  return '';
}

function saveMtprotoSessionToDisk(sessionStr: string): void {
  try {
    if (!sessionStr || !sessionStr.trim()) return;
    fs.writeFileSync(
      MTPROTO_SESSION_FILE,
      JSON.stringify({ session: sessionStr.trim(), savedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    mirrorFileToLegacyDataDir(MTPROTO_SESSION_FILE, 'mtproto_session_v2.json');
  } catch {
    // Ignore
  }
}

let transferJobs: VideoTransferJob[] = loadJobsFromDisk();
let liveLogs: LiveEventLog[] = [];
let mtprotoDiagLogs: MtprotoDiagLogEntry[] = [];

// Runtime state
let webhookRegistered = false;
let webhookPendingUpdates = 0;
let lastWebhookError: string | null = null;
let lastWakeUpAt: string | null = null;
let botProfile: { id: number; username: string; firstName: string } | null = null;
let mtprotoConnected = false;
let mtprotoClient: TelegramClient | null = null;
let mtprotoSessionString = loadMtprotoSessionFromDisk();
let mtprotoFloodWaitUntilMs = 0;
let pictaUser: PictaAuthenticatedUser | null = null;
let pictaTokenExpiresAt = 0;
const pictaChannels: PictaChannelOption[] = [
  {
    id: 36319,
    nombre: 'Canal Oficial',
    alias: 'El Rincón Visual – tu espacio para ver y descubrir',
  },
];
let currentActivity =
  'En línea (@Picta2bot · MTProto 2GB activo · Canal Picta: Canal Oficial #36319)';
let activeJobId: string | null = null;
let activeDownloadJobId: string | null = null;
let activeUploadJobId: string | null = null;
let externalCloudRunWebhookActive = false;

function syncActiveJobId(): void {
  activeJobId = activeUploadJobId || activeDownloadJobId || null;
}

const pendingManualTitleByChat = new Map<string, string>();
const pendingOnlineCandidatesByJob = new Map<
  string,
  {
    candidates: MediaMatchCandidate[];
    nextStep: 2 | 3;
    seasonNum?: number;
    epNum?: number;
    query: string;
  }
>();
const runningJobIds = new Set<string>();
const cancelledJobIds = new Set<string>();
const uploadQueue: string[] = [];
const processedUpdateIds = new Set<number>();
const processedCallbackIds = new Set<string>();
const processedMessageKeys = new Set<string>();
let lastUpdateOffset = 0;

function addBoundedSetEntry<T>(set: Set<T>, value: T, maxSize = 1200): void {
  set.add(value);
  if (set.size > maxSize) {
    const excess = set.size - maxSize;
    let removed = 0;
    for (const item of set) {
      set.delete(item);
      removed++;
      if (removed >= excess) break;
    }
  }
}

const PINNED_SERIES_FILE = path.join(STATE_DIR, 'pinned_series.json');

interface PinnedBatchSerieState {
  pelserId: number;
  serieName: string;
  seasonNum: string;
  seasonId?: number;
  coverUrl?: string;
  customCoverFileId?: string;
  pinnedAt: string;
}

const pinnedBatchSerieByChat = new Map<string, PinnedBatchSerieState>();

function loadPinnedSeriesFromDisk(): void {
  try {
    if (fs.existsSync(PINNED_SERIES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PINNED_SERIES_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v === 'object') {
            pinnedBatchSerieByChat.set(String(k), v as PinnedBatchSerieState);
          }
        }
      }
    }
  } catch {
    // Ignore
  }
}

function savePinnedSeriesToDisk(): void {
  try {
    const obj: Record<string, PinnedBatchSerieState> = {};
    for (const [k, v] of pinnedBatchSerieByChat.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(PINNED_SERIES_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(PINNED_SERIES_FILE);
    scheduleSaveCloudStateToTelegram();
  } catch {
    // Ignore
  }
}

loadPinnedSeriesFromDisk();

interface AuthorizedUserRecord {
  chatId: string;
  username?: string;
  name?: string;
  authorizedAt: string;
  authorizedBy: string;
}

const authorizedUsers = new Map<string, AuthorizedUserRecord>();

function loadAuthorizedUsersFromDisk(): void {
  try {
    if (fs.existsSync(AUTHORIZED_USERS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUTHORIZED_USERS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.chatId) {
            authorizedUsers.set(String(item.chatId), item);
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  // Master Admin is ALWAYS authorized and cannot be deleted
  if (!authorizedUsers.has(MASTER_ADMIN_CHAT_ID)) {
    authorizedUsers.set(MASTER_ADMIN_CHAT_ID, {
      chatId: MASTER_ADMIN_CHAT_ID,
      username: 'admin_bot',
      name: 'Admin (Admin)',
      authorizedAt: new Date().toISOString(),
      authorizedBy: 'SYSTEM',
    });
  }
}

function saveAuthorizedUsersToDisk(): void {
  try {
    const list = Array.from(authorizedUsers.values());
    fs.writeFileSync(AUTHORIZED_USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(AUTHORIZED_USERS_FILE);
    scheduleSaveCloudStateToTelegram();
  } catch {
    // Ignore
  }
}

loadAuthorizedUsersFromDisk();

function isUserAuthorized(chatId: string, username?: string): boolean {
  if (chatId === MASTER_ADMIN_CHAT_ID) return true;
  if (authorizedUsers.has(chatId)) return true;
  if (username) {
    const cleanU = username.toLowerCase().replace(/^@/, '').trim();
    for (const rec of authorizedUsers.values()) {
      if (rec.username && rec.username.toLowerCase().replace(/^@/, '').trim() === cleanU) {
        if (chatId && rec.chatId !== chatId) {
          authorizedUsers.delete(rec.chatId);
          rec.chatId = chatId;
          authorizedUsers.set(chatId, rec);
          saveAuthorizedUsersToDisk();
        }
        return true;
      }
    }
  }
  return false;
}

function authorizeUser(
  target: string,
  adminChatId: string,
  targetName?: string
): { success: boolean; record?: AuthorizedUserRecord; message: string } {
  const clean = target.trim().replace(/^@/, '');
  if (!clean) {
    return { success: false, message: 'ID o nombre de usuario inválido.' };
  }
  const isNumeric = /^\d{5,15}$/.test(clean);

  let foundKey = '';
  for (const [k, v] of authorizedUsers.entries()) {
    if (isNumeric && k === clean) {
      foundKey = k;
      break;
    }
    if (!isNumeric && v.username && v.username.toLowerCase().replace(/^@/, '') === clean.toLowerCase()) {
      foundKey = k;
      break;
    }
  }

  const newRecord: AuthorizedUserRecord = {
    chatId: isNumeric ? clean : foundKey || `user_${clean}`,
    username: !isNumeric ? clean : foundKey ? authorizedUsers.get(foundKey)?.username : undefined,
    name: targetName || (!isNumeric ? `@${clean}` : `Usuario ${clean}`),
    authorizedAt: new Date().toISOString(),
    authorizedBy: adminChatId,
  };

  authorizedUsers.set(newRecord.chatId, newRecord);
  saveAuthorizedUsersToDisk();
  return { success: true, record: newRecord, message: `Usuario @${clean} autorizado correctamente.` };
}

function revokeUser(
  target: string
): { success: boolean; message: string } {
  const clean = target.trim().replace(/^@/, '');
  if (!clean) {
    return { success: false, message: 'ID o usuario no especificado.' };
  }
  if (
    clean === MASTER_ADMIN_CHAT_ID ||
    clean.toLowerCase() === 'admin' ||
    clean.toLowerCase() === 'admin_bot'
  ) {
    return { success: false, message: 'No se puede revocar al Administrador Principal.' };
  }

  let deleted = false;
  for (const [k, v] of authorizedUsers.entries()) {
    if (k === clean || (v.username && v.username.toLowerCase().replace(/^@/, '') === clean.toLowerCase())) {
      authorizedUsers.delete(k);
      userSessions.delete(k);
      deleted = true;
      break;
    }
  }

  if (deleted) {
    saveAuthorizedUsersToDisk();
    saveUserSessionsToDisk();
    return { success: true, message: `Usuario ${clean} retirado de la lista blanca y sesión de Picta cerrada.` };
  }
  return { success: false, message: `Usuario ${clean} no se encontraba en la lista autorizada.` };
}

interface UserPictaSession {
  chatId: string;
  username: string; // phone or user
  password?: string;
  authToken: string;
  tokenExpiresAt: number;
  userId?: number;
  userFullName?: string;
  channelId: string;
  channelName: string;
  availableChannels: Array<{ id: number; nombre: string; alias?: string }>;
  verifiedChannelOwnership?: boolean;
  pictaGroups?: string[];
  hasChannelAdminRole?: boolean;
  poolAccounts?: QuotaPoolAccount[];
  updatedAt: string;
}

const userSessions = new Map<string, UserPictaSession>();

function loadUserSessionsFromDisk(): void {
  try {
    if (fs.existsSync(USER_SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_SESSIONS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        let sanitizedAny = false;
        for (const item of parsed) {
          if (item?.chatId) {
            const { session: cleanSess, changed } = sanitizeLeakedUserSession(
              item as UserPictaSession,
              botConfig.pictaChannelId || '36319'
            );
            if (isMasterAdminChat(cleanSess.chatId) && (!cleanSess.channelId || cleanSess.channelId === '0')) {
              const masterChId = String(botConfig.pictaChannelId || '36319');
              cleanSess.channelId = masterChId;
              cleanSess.channelName = cleanSess.channelName || 'Canal Oficial';
              cleanSess.verifiedChannelOwnership = true;
              if (!Array.isArray(cleanSess.availableChannels)) cleanSess.availableChannels = [];
              if (!cleanSess.availableChannels.some((c) => String(c.id) === masterChId)) {
                cleanSess.availableChannels.unshift({
                  id: Number(masterChId),
                  nombre: cleanSess.channelName,
                });
              }
              sanitizedAny = true;
            }
            if (changed) sanitizedAny = true;
            userSessions.set(String(cleanSess.chatId), cleanSess);
          }
        }
        if (sanitizedAny) {
          fs.writeFileSync(
            USER_SESSIONS_FILE,
            JSON.stringify(Array.from(userSessions.values()), null, 2),
            'utf-8'
          );
          mirrorFileToLegacyDataDir(USER_SESSIONS_FILE);
        }
      }
    }
  } catch {
    // Ignore
  }
}

function saveUserSessionsToDisk(): void {
  try {
    const list = Array.from(userSessions.values());
    fs.writeFileSync(USER_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(USER_SESSIONS_FILE);
    scheduleSaveCloudStateToTelegram();
  } catch {
    // Ignore
  }
}

loadUserSessionsFromDisk();

// Private per-user requests channel preferences (strictly isolated per chatId)
const userPromoChannels = new Map<string, UserPromoChannelConfig>();
const pendingMoviePromos = new Map<string, PendingMoviePromoRecord>();

function loadUserPromoChannelsFromDisk(): void {
  try {
    if (fs.existsSync(PROMO_CHANNELS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PROMO_CHANNELS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.chatId) {
            userPromoChannels.set(String(item.chatId), item as UserPromoChannelConfig);
          }
        }
      }
    }
  } catch {
    // Ignore
  }
}

function saveUserPromoChannelsToDisk(): void {
  try {
    const list = Array.from(userPromoChannels.values());
    fs.writeFileSync(PROMO_CHANNELS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(PROMO_CHANNELS_FILE);
    scheduleSaveCloudStateToTelegram();
  } catch {
    // Ignore
  }
}

function loadPendingPromosFromDisk(): void {
  try {
    if (fs.existsSync(PENDING_PROMOS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PENDING_PROMOS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(-80)) {
          if (item?.promoId) {
            pendingMoviePromos.set(String(item.promoId), item as PendingMoviePromoRecord);
          }
        }
      }
    }
  } catch {
    // Ignore
  }
}

function savePendingPromosToDisk(): void {
  try {
    const list = Array.from(pendingMoviePromos.values()).slice(-80);
    if (pendingMoviePromos.size > 80) {
      pendingMoviePromos.clear();
      for (const item of list) {
        pendingMoviePromos.set(item.promoId, item);
      }
    }
    fs.writeFileSync(PENDING_PROMOS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(PENDING_PROMOS_FILE);
  } catch {
    // Ignore
  }
}

loadUserPromoChannelsFromDisk();
loadPendingPromosFromDisk();

let channelMediaRequests: ChannelMediaRequest[] = [];
let ignoredRequestCommentIds = new Set<number>();

function loadChannelMediaRequestsFromDisk(): void {
  try {
    if (fs.existsSync(CHANNEL_REQUESTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CHANNEL_REQUESTS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        channelMediaRequests = parsed.slice(0, 250);
      }
    }
    if (fs.existsSync(IGNORED_REQUEST_COMMENTS_FILE)) {
      const parsedIgnored = JSON.parse(
        fs.readFileSync(IGNORED_REQUEST_COMMENTS_FILE, 'utf-8')
      );
      if (Array.isArray(parsedIgnored)) {
        ignoredRequestCommentIds = new Set(
          parsedIgnored.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
        );
      }
    }
  } catch {
    // Ignore
  }
}

function saveChannelMediaRequestsToDisk(): void {
  try {
    if (channelMediaRequests.length > 250) {
      channelMediaRequests = channelMediaRequests.slice(0, 250);
    }
    fs.writeFileSync(
      CHANNEL_REQUESTS_FILE,
      JSON.stringify(channelMediaRequests, null, 2),
      'utf-8'
    );
    mirrorFileToLegacyDataDir(CHANNEL_REQUESTS_FILE);
    fs.writeFileSync(
      IGNORED_REQUEST_COMMENTS_FILE,
      JSON.stringify(Array.from(ignoredRequestCommentIds).slice(-600), null, 2),
      'utf-8'
    );
    mirrorFileToLegacyDataDir(IGNORED_REQUEST_COMMENTS_FILE);
    scheduleSaveCloudStateToTelegram();
  } catch {
    // Ignore
  }
}

loadChannelMediaRequestsFromDisk();

function syncPictaCommentsToChannelRequests(
  ownerChatId: string,
  comments: PictaCommentRecord[],
  ownerUsernames: string[] = []
): { added: number; pruned: number; requests: ChannelMediaRequest[] } {
  const ownerSet = new Set(
    ownerUsernames.map((u) => String(u || '').trim().toLowerCase()).filter(Boolean)
  );
  let added = 0;
  let pruned = 0;
  const commentById = new Map<number, PictaCommentRecord>();
  for (const c of comments || []) {
    if (c?.id) commentById.set(c.id, c);
  }

  // Re-validate previously auto-detected comment requests (rq_cm_*) against hardened parser
  if (commentById.size > 0) {
    const nextList: ChannelMediaRequest[] = [];
    for (const req of channelMediaRequests) {
      if (
        req.ownerChatId === ownerChatId &&
        req.status === 'pending' &&
        req.id.startsWith('rq_cm_') &&
        req.commentId &&
        commentById.has(req.commentId)
      ) {
        const cm = commentById.get(req.commentId)!;
        const recheck = extractMediaRequestFromPictaComment(cm.texto, cm.publicacionNombre);
        if (!recheck.matched || !recheck.title) {
          pruned++;
          continue;
        }
        const newNorm = normalizeRequestTitle(recheck.title);
        if (req.requestedTitle !== recheck.title) {
          req.requestedTitle = recheck.title;
          req.normalizedTitle = newNorm;
          pruned++;
        }
      }
      nextList.push(req);
    }
    if (pruned > 0) {
      channelMediaRequests = nextList;
    }
  }

  for (const c of comments || []) {
    if (!c || !c.id || !c.texto) continue;
    if (ignoredRequestCommentIds.has(c.id)) continue;
    const authorLower = String(c.usuario || '').trim().toLowerCase();
    if (authorLower && ownerSet.has(authorLower)) continue;

    const existingByComment = channelMediaRequests.find(
      (r) => r.ownerChatId === ownerChatId && r.commentId === c.id
    );
    if (existingByComment) continue;

    const detection = extractMediaRequestFromPictaComment(c.texto, c.publicacionNombre);
    if (!detection.matched || !detection.title) continue;

    const norm = normalizeRequestTitle(detection.title);
    if (!norm || norm.length < 2) continue;

    const dupPending = channelMediaRequests.find(
      (r) =>
        r.ownerChatId === ownerChatId &&
        r.status === 'pending' &&
        r.normalizedTitle === norm
    );
    if (dupPending) {
      if (!dupPending.commentId && c.id) {
        dupPending.commentId = c.id;
        dupPending.commentPublicationId = c.publicacionId;
        dupPending.commentPublicationTitle = c.publicacionNombre;
      }
      continue;
    }

    const reqId = `rq_cm_${c.id}`;
    channelMediaRequests.unshift({
      id: reqId,
      ownerChatId,
      requestedTitle: detection.title,
      normalizedTitle: norm,
      requestedByName: c.usuario ? `@${c.usuario}` : 'Suscriptor Picta',
      ...(c.usuario ? { requestedByUsername: c.usuario } : {}),
      sourceType: 'picta_comment',
      commentId: c.id,
      commentPublicationId: c.publicacionId,
      commentPublicationTitle: c.publicacionNombre,
      status: 'pending',
      createdAt:
        c.fecha && !isNaN(new Date(c.fecha).getTime())
          ? new Date(c.fecha).toISOString()
          : new Date().toISOString(),
    });
    added++;
  }

  if (added > 0 || pruned > 0) {
    saveChannelMediaRequestsToDisk();
  }
  return {
    added,
    pruned,
    requests: channelMediaRequests.filter((r) => r.ownerChatId === ownerChatId),
  };
}

// ============================================================================
// MULTI-ACCOUNT QUOTA POOL & DAILY QUOTA SPLITTER (BYPASS 10 VIDEOS/DAY LIMIT)
// ============================================================================
interface QuotaPoolAccount {
  username: string;
  password: string;
  authToken?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  userId?: number;
  fullName?: string;
  displayName?: string;
  roles?: string[];
  canPublishDirectly?: boolean;
  usedToday?: number;
  uploadedToday?: number;
  lastResetDate?: string;
  exhaustedDate?: string; // YYYY-MM-DD when Picta returned "Límite diario de 10 publicaciones alcanzado"
  associatedChannelIds?: string[];
}

interface QuotaSettings {
  maxSeriesPerDay: number; // 0 = sin división (usa toda la cuota), >0 = cupos reservados para series (ej: 5, 7, 8)
  seriesUploadedToday: number;
  otherUploadedToday: number;
  lastResetDate: string;
  currentDateCuba: string;
  primaryExhaustedDate?: string;
  poolAccounts: QuotaPoolAccount[];
}

function getTodayCubaDateStr(): string {
  return getCubaTodayStr();
}

function loadQuotaSettingsFromDisk(): QuotaSettings {
  const today = getTodayCubaDateStr();
  try {
    if (fs.existsSync(QUOTA_SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(QUOTA_SETTINGS_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        const lastDate = String(parsed.lastResetDate || parsed.currentDateCuba || today);
        return {
          maxSeriesPerDay: typeof parsed.maxSeriesPerDay === 'number' ? parsed.maxSeriesPerDay : 7,
          seriesUploadedToday: Number(parsed.seriesUploadedToday || 0),
          otherUploadedToday: Number(parsed.otherUploadedToday || 0),
          lastResetDate: lastDate,
          currentDateCuba: lastDate,
          primaryExhaustedDate: parsed.primaryExhaustedDate ? String(parsed.primaryExhaustedDate) : undefined,
          poolAccounts: Array.isArray(parsed.poolAccounts) ? parsed.poolAccounts : [],
        };
      }
    }
  } catch {
    // Ignore
  }
  return {
    maxSeriesPerDay: 7, // Por defecto 7 capítulos de serie + 3 películas/otros por cada bloque de 10
    seriesUploadedToday: 0,
    otherUploadedToday: 0,
    lastResetDate: today,
    currentDateCuba: today,
    poolAccounts: [],
  };
}

let quotaSettings: QuotaSettings = loadQuotaSettingsFromDisk();

function saveQuotaSettingsToDisk(): void {
  try {
    fs.writeFileSync(QUOTA_SETTINGS_FILE, JSON.stringify(quotaSettings, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(QUOTA_SETTINGS_FILE);
    scheduleSaveCloudStateToTelegram();
  } catch {
    // Ignore
  }
}

function ensureDailyQuotaReset(): void {
  const today = getTodayCubaDateStr();
  let changed = false;
  if (quotaSettings.lastResetDate !== today || quotaSettings.currentDateCuba !== today) {
    quotaSettings.lastResetDate = today;
    quotaSettings.currentDateCuba = today;
    quotaSettings.seriesUploadedToday = 0;
    quotaSettings.otherUploadedToday = 0;
    quotaSettings.primaryExhaustedDate = undefined;
    changed = true;
  }
  for (const acc of quotaSettings.poolAccounts) {
    if (acc.lastResetDate !== today) {
      acc.lastResetDate = today;
      acc.usedToday = 0;
      acc.uploadedToday = 0;
      acc.exhaustedDate = undefined;
      changed = true;
    }
  }
  let userPoolChanged = false;
  for (const sess of userSessions.values()) {
    if (Array.isArray(sess.poolAccounts)) {
      for (const acc of sess.poolAccounts) {
        if (acc.lastResetDate !== today) {
          acc.lastResetDate = today;
          acc.usedToday = 0;
          acc.uploadedToday = 0;
          acc.exhaustedDate = undefined;
          userPoolChanged = true;
        }
      }
    }
  }
  if (changed) {
    saveQuotaSettingsToDisk();
  }
  if (userPoolChanged) {
    saveUserSessionsToDisk();
  }
}

interface PendingPoolAccountState {
  step: 'awaiting_username' | 'awaiting_password';
  username?: string;
  messageId: number | null;
  returnToJobId?: string;
}

const pendingPoolAccountByChat = new Map<string, PendingPoolAccountState>();
const pendingPictaSearchByChat = new Map<string, { messageId: number | null }>();
const lastPictaSearchResultsByChat = new Map<
  string,
  { query: string; hits: PictaGlobalSearchHit[]; fetchedAt: number }
>();

function getPoolAccountsForChat(chatId: string): QuotaPoolAccount[] {
  if (isMasterAdminChat(chatId)) {
    return quotaSettings.poolAccounts;
  }
  const sess = userSessions.get(chatId);
  return Array.isArray(sess?.poolAccounts) ? sess.poolAccounts : [];
}

function savePoolAccountsForChat(chatId: string): void {
  if (isMasterAdminChat(chatId)) {
    saveQuotaSettingsToDisk();
  } else {
    saveUserSessionsToDisk();
  }
}

function getPrimaryAccountLabelForChat(chatId: string): string {
  const sess = userSessions.get(chatId);
  if (isMasterAdminChat(chatId)) {
    return sess?.userFullName || sess?.username || pictaUser?.username || botConfig.pictaUsername || 'Cuenta Principal';
  }
  return sess?.userFullName || sess?.username || 'Tu Cuenta Picta';
}

// ============================================================================
// TELEGRAM CLOUD ENCRYPTED STATE VAULT (SURVIVES CLOUD RUN SCALE-TO-ZERO SLEEP)
// ============================================================================
let cloudVaultSaveTimer: NodeJS.Timeout | null = null;
let cloudVaultLoadedOnce = false;

function encryptCloudVaultPayload(plainJson: string): string {
  const compressed = zlib.deflateRawSync(Buffer.from(plainJson, 'utf-8'));
  const key = crypto.createHash('sha256').update(PICTA_AES_KEY + MASTER_ADMIN_CHAT_ID).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptCloudVaultPayload(b64: string): string | null {
  try {
    const raw = Buffer.from(b64, 'base64');
    if (raw.byteLength < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const key = crypto.createHash('sha256').update(PICTA_AES_KEY + MASTER_ADMIN_CHAT_ID).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(enc), decipher.final()]);
    return zlib.inflateRawSync(compressed).toString('utf-8');
  } catch {
    return null;
  }
}

async function saveCloudStateToTelegramNow(): Promise<void> {
  try {
    const token = botConfig.telegramBotToken.trim();
    if (!token) return;
    const vaultObj = {
      v: 1,
      u: Array.from(authorizedUsers.values()),
      s: Array.from(userSessions.values()),
      p: Object.fromEntries(pinnedBatchSerieByChat.entries()),
      q: quotaSettings,
      pr: Array.from(userPromoChannels.values()),
      rq: channelMediaRequests.slice(0, 60),
      ir: Array.from(ignoredRequestCommentIds).slice(-150),
    };
    const encryptedB64 = encryptCloudVaultPayload(JSON.stringify(vaultObj));
    const chunks: string[] = [];
    for (let i = 0; i < encryptedB64.length; i += 240) {
      chunks.push(encryptedB64.slice(i, i + 240));
    }
    if (chunks.length === 0 || chunks.length > 95) return;
    const commands = chunks.map((chunk, idx) => ({
      command: `v_${idx}`,
      description: chunk,
    }));
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands,
        scope: { type: 'chat', chat_id: Number(MASTER_ADMIN_CHAT_ID) },
        language_code: 'eo',
      }),
    });
  } catch {
    // Non-fatal
  }
}

function scheduleSaveCloudStateToTelegram(): void {
  if (!cloudVaultLoadedOnce || IS_PREVIEW_INSTANCE) return;
  if (cloudVaultSaveTimer) {
    clearTimeout(cloudVaultSaveTimer);
  }
  cloudVaultSaveTimer = setTimeout(() => {
    void saveCloudStateToTelegramNow();
  }, 800);
}

let cloudVaultLoadPromise: Promise<void> | null = null;

function ensureCloudStateLoadedOnce(): Promise<void> {
  if (!cloudVaultLoadPromise) {
    cloudVaultLoadPromise = loadCloudStateFromTelegram();
  }
  return cloudVaultLoadPromise;
}

async function loadCloudStateFromTelegram(): Promise<void> {
  try {
    const token = botConfig.telegramBotToken.trim();
    if (!token) {
      cloudVaultLoadedOnce = true;
      return;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/getMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: { type: 'chat', chat_id: Number(MASTER_ADMIN_CHAT_ID) },
        language_code: 'eo',
      }),
    });
    const data = (await res.json()) as any;
    if (data?.ok && Array.isArray(data.result) && data.result.length > 0) {
      const sorted = [...data.result]
        .filter((c: any) => typeof c?.command === 'string' && c.command.startsWith('v_'))
        .sort(
          (a: any, b: any) =>
            Number(String(a.command).replace('v_', '')) -
            Number(String(b.command).replace('v_', ''))
        );
      if (sorted.length > 0) {
        const joinedB64 = sorted.map((c: any) => String(c.description || '')).join('');
        const jsonStr = decryptCloudVaultPayload(joinedB64);
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          let restoredUsers = 0;
          if (Array.isArray(parsed.u)) {
            for (const item of parsed.u) {
              if (item?.chatId && !authorizedUsers.has(String(item.chatId))) {
                authorizedUsers.set(String(item.chatId), item);
                restoredUsers++;
              }
            }
          }
          if (Array.isArray(parsed.s)) {
            for (const sess of parsed.s) {
              if (sess?.chatId && !userSessions.has(String(sess.chatId))) {
                const { session: cleanSess } = sanitizeLeakedUserSession(
                  sess as UserPictaSession,
                  botConfig.pictaChannelId || '36319'
                );
                if (isMasterAdminChat(cleanSess.chatId) && (!cleanSess.channelId || cleanSess.channelId === '0')) {
                  const masterChId = String(botConfig.pictaChannelId || '36319');
                  cleanSess.channelId = masterChId;
                  cleanSess.channelName = cleanSess.channelName || 'Canal Oficial';
                  cleanSess.verifiedChannelOwnership = true;
                  if (!Array.isArray(cleanSess.availableChannels)) cleanSess.availableChannels = [];
                  if (!cleanSess.availableChannels.some((c) => String(c.id) === masterChId)) {
                    cleanSess.availableChannels.unshift({
                      id: Number(masterChId),
                      nombre: cleanSess.channelName,
                    });
                  }
                }
                userSessions.set(String(cleanSess.chatId), cleanSess);
              }
            }
          }
          if (parsed.p && typeof parsed.p === 'object') {
            for (const [k, v] of Object.entries(parsed.p)) {
              if (v && typeof v === 'object' && !pinnedBatchSerieByChat.has(String(k))) {
                pinnedBatchSerieByChat.set(String(k), v as PinnedBatchSerieState);
              }
            }
          }
          if (parsed.q && typeof parsed.q === 'object') {
            const remotePool = Array.isArray(parsed.q.poolAccounts) ? parsed.q.poolAccounts : [];
            if (quotaSettings.poolAccounts.length === 0 && remotePool.length > 0) {
              quotaSettings.poolAccounts = remotePool;
            }
            if (typeof parsed.q.maxSeriesPerDay === 'number') {
              quotaSettings.maxSeriesPerDay = parsed.q.maxSeriesPerDay;
            }
            if (parsed.q.lastResetDate === getTodayCubaDateStr()) {
              quotaSettings.seriesUploadedToday = Math.max(
                quotaSettings.seriesUploadedToday,
                Number(parsed.q.seriesUploadedToday || 0)
              );
              quotaSettings.otherUploadedToday = Math.max(
                quotaSettings.otherUploadedToday,
                Number(parsed.q.otherUploadedToday || 0)
              );
            }
          }
          if (Array.isArray(parsed.pr)) {
            for (const cfg of parsed.pr) {
              if (cfg?.chatId && !userPromoChannels.has(String(cfg.chatId))) {
                userPromoChannels.set(String(cfg.chatId), cfg as UserPromoChannelConfig);
              }
            }
          }
          if (Array.isArray(parsed.rq) && channelMediaRequests.length === 0) {
            channelMediaRequests = parsed.rq.slice(0, 250);
          }
          if (Array.isArray(parsed.ir) && ignoredRequestCommentIds.size === 0) {
            for (const cid of parsed.ir) {
              const num = Number(cid);
              if (Number.isFinite(num) && num > 0) ignoredRequestCommentIds.add(num);
            }
          }
          cloudVaultLoadedOnce = true;
          saveAuthorizedUsersToDisk();
          saveUserSessionsToDisk();
          saveUserPromoChannelsToDisk();
          saveChannelMediaRequestsToDisk();
          savePinnedSeriesToDisk();
          saveQuotaSettingsToDisk();
          if (restoredUsers > 0) {
            addLiveLog(
              'system',
              'success',
              `Bóveda Cloud restaurada tras reinicio: ${authorizedUsers.size} usuarios autorizados, ${userSessions.size} sesiones y ${quotaSettings.poolAccounts.length + 1} cuenta(s) en Pool.`
            );
          }
          return;
        }
      }
    }
    cloudVaultLoadedOnce = true;
    scheduleSaveCloudStateToTelegram();
    return;
  } catch {
    // Ignore transient network errors without overwriting Cloud Vault
  }
  cloudVaultLoadedOnce = true;
}

// ============================================================================
// MTPROTO SESSION VAULT (language_code: 'ia' — survives Cloud Run redeploys without FLOOD_WAIT)
// ============================================================================
let mtprotoVaultSaveTimer: NodeJS.Timeout | null = null;
let mtprotoVaultLoadedOnce = false;

async function saveMtprotoVaultToTelegramNow(): Promise<void> {
  if (IS_PREVIEW_INSTANCE) return;
  try {
    const token = botConfig.telegramBotToken.trim();
    if (!token) return;
    const auxSessions = loadAuxiliaryBotSessionsFromDisk();
    if (!mtprotoSessionString && auxSessions.every((s) => !s)) return;
    const payloadObj = {
      v: 1,
      m: mtprotoSessionString || '',
      a: auxSessions,
    };
    const encryptedB64 = encryptCloudVaultPayload(JSON.stringify(payloadObj));
    const chunks: string[] = [];
    for (let i = 0; i < encryptedB64.length; i += 240) {
      chunks.push(encryptedB64.slice(i, i + 240));
    }
    if (chunks.length === 0 || chunks.length > 95) return;
    const commands = chunks.map((chunk, idx) => ({
      command: `m_${idx}`,
      description: chunk,
    }));
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands,
        scope: { type: 'chat', chat_id: Number(MASTER_ADMIN_CHAT_ID) },
        language_code: 'ia',
      }),
    });
  } catch {
    // Non-fatal
  }
}

function scheduleSaveMtprotoVaultToTelegram(): void {
  if (!mtprotoVaultLoadedOnce || IS_PREVIEW_INSTANCE) return;
  if (mtprotoVaultSaveTimer) clearTimeout(mtprotoVaultSaveTimer);
  mtprotoVaultSaveTimer = setTimeout(() => {
    void saveMtprotoVaultToTelegramNow();
  }, 1000);
}

async function ensureMtprotoVaultLoadedOnce(): Promise<void> {
  if (mtprotoVaultLoadedOnce || IS_PREVIEW_INSTANCE) {
    mtprotoVaultLoadedOnce = true;
    return;
  }
  try {
    const token = botConfig.telegramBotToken.trim();
    if (!token) {
      mtprotoVaultLoadedOnce = true;
      return;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/getMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: { type: 'chat', chat_id: Number(MASTER_ADMIN_CHAT_ID) },
        language_code: 'ia',
      }),
    });
    const data = (await res.json()) as any;
    if (data?.ok && Array.isArray(data.result) && data.result.length > 0) {
      const sorted = [...data.result]
        .filter((c: any) => typeof c?.command === 'string' && c.command.startsWith('m_'))
        .sort(
          (a: any, b: any) =>
            Number(String(a.command).replace('m_', '')) -
            Number(String(b.command).replace('m_', ''))
        );
      if (sorted.length > 0) {
        const joinedB64 = sorted.map((c: any) => String(c.description || '')).join('');
        const jsonStr = decryptCloudVaultPayload(joinedB64);
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          if (typeof parsed?.m === 'string' && parsed.m.trim() && !mtprotoSessionString.trim()) {
            mtprotoSessionString = parsed.m.trim();
            saveMtprotoSessionToDisk(mtprotoSessionString);
          }
          if (Array.isArray(parsed?.a)) {
            const cleanedAux: string[] = parsed.a.map((s: any) => String(s || '').trim());
            if (cleanedAux.some(Boolean)) {
              auxiliaryBotSessionsCache = cleanedAux;
              try {
                fs.writeFileSync(
                  MTPROTO_AUX_SESSIONS_FILE,
                  JSON.stringify({ sessions: cleanedAux, savedAt: new Date().toISOString() }),
                  'utf-8'
                );
              } catch {
                // Ignore
              }
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }
  mtprotoVaultLoadedOnce = true;
}

async function refreshUserPictaSession(chatId: string): Promise<string> {
  const session = userSessions.get(chatId);
  if (!session) {
    if (!chatId || chatId === MASTER_ADMIN_CHAT_ID) {
      return authenticateWithPicta(false);
    }
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login para iniciar sesión.');
  }
  if (!session.password) {
    return session.authToken;
  }
  const form = new FormData();
  form.append('username', session.username);
  form.append('password', session.password);
  form.append('grant_type', 'password');
  form.append('client_id', botConfig.pictaClientId || PICTA_OFFICIAL_CLIENT_ID);
  try {
    const tokenRes = await fetchPictaWithRetry('https://api.picta.cu/o/token/', {
      method: 'POST',
      headers: {
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: form,
    });
    if (tokenRes.ok) {
      const data = (await tokenRes.json()) as any;
      if (data?.access_token) {
        session.authToken = data.access_token;
        session.tokenExpiresAt = Date.now() + (Number(data.expires_in) || 14400) * 1000;
        session.updatedAt = new Date().toISOString();
        saveUserSessionsToDisk();
        return session.authToken;
      }
    }
  } catch {
    // Ignore
  }
  return session.authToken;
}

function getEffectivePictaContext(chatId: string): {
  accessTokenPromise: Promise<string>;
  channelId: string;
  channelName: string;
  isLinked: boolean;
} {
  const session = userSessions.get(chatId);
  const resolved = resolveGuestOrAdminChannelMeta(
    chatId,
    session,
    botConfig.pictaChannelId || '36319',
    'Canal Oficial'
  );

  if (session && session.authToken) {
    if (session.tokenExpiresAt > Date.now() + 60_000) {
      return {
        accessTokenPromise: Promise.resolve(session.authToken),
        channelId: resolved.channelId,
        channelName: resolved.channelName,
        isLinked: resolved.isLinked,
      };
    }
    return {
      accessTokenPromise: refreshUserPictaSession(chatId),
      channelId: resolved.channelId,
      channelName: resolved.channelName,
      isLinked: resolved.isLinked,
    };
  }

  if (resolved.isMaster) {
    return {
      accessTokenPromise: authenticateWithPicta(false),
      channelId: resolved.channelId,
      channelName: resolved.channelName,
      isLinked: true,
    };
  }

  // Strict guest isolation: unlinked guests never receive Master Admin token or channel #36319
  const unlinkedPromise = Promise.reject(
    new Error('No has vinculado tu cuenta de Picta. Usa /login primero.')
  );
  unlinkedPromise.catch(() => {});
  return {
    accessTokenPromise: unlinkedPromise,
    channelId: '',
    channelName: 'Sin vincular',
    isLinked: false,
  };
}

interface PendingUserLoginState {
  step: 'awaiting_username' | 'awaiting_password';
  username?: string;
  messageId?: number | null;
}

const pendingUserLoginByChat = new Map<string, PendingUserLoginState>();

const lastAutoDiscoveryAttemptByChat = new Map<string, number>();

async function fetchDecryptedPictaMe2(accessToken: string): Promise<any | null> {
  try {
    const meRes = await fetchPictaWithRetry('https://api.picta.cu/v2/usuario/me2/', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    });
    if (!meRes.ok) return null;
    const encryptedText = (await meRes.text()).trim().replace(/^"|"$/g, '');
    const decipher = crypto.createDecipheriv(
      'aes-128-ecb',
      Buffer.from(PICTA_AES_KEY, 'utf8'),
      null
    );
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

async function verifyChannelOwnershipByDetail(
  channelId: number,
  accessToken: string,
  ownerIdentity: number | PictaUserOwnershipIdentity | undefined,
  excludeIds: Set<string>,
  allowMissingOwnerIfParentVerified = false
): Promise<{ id: number; nombre: string; alias?: string; slug_url?: string } | null> {
  if (!channelId || channelId <= 0 || excludeIds.has(String(channelId))) return null;
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Origin: 'https://admin.picta.cu',
    Referer: 'https://admin.picta.cu/',
  };
  let fallbackDetail: { id: number; nombre: string; alias?: string; slug_url?: string } | null = null;
  for (const url of [
    `https://api.picta.cu/v3/channel/${channelId}/`,
    `https://api.picta.cu/v2/canal/${channelId}/`,
    `https://api.picta.cu/v1/canal/${channelId}/`,
  ]) {
    try {
      const res = await fetchPictaWithRetry(url, { headers: authHeaders }, 2);
      if (!res.ok) continue;
      const detail = (await res.json().catch(() => null)) as any;
      if (!detail || typeof detail !== 'object') continue;
      const normalized = {
        id: Number(detail.id || channelId),
        nombre: String(detail.nombre || detail.name || `Canal #${channelId}`).trim(),
        ...(detail.alias ? { alias: String(detail.alias) } : {}),
        ...(detail.slug_url ? { slug_url: String(detail.slug_url) } : {}),
      };
      const owned = isChannelOwnedOrAssociatedByUser(detail, ownerIdentity);
      if (owned === false) return null;
      if (owned === true) {
        return normalized;
      }
      if (!fallbackDetail) {
        fallbackDetail = normalized;
      }
    } catch {
      // Try next URL
    }
  }
  if (allowMissingOwnerIfParentVerified && fallbackDetail) {
    return fallbackDetail;
  }
  return null;
}

async function discoverUserPictaChannels(
  accessToken: string,
  formattedUsername: string,
  userFullName: string,
  userId: number | undefined,
  isMaster: boolean,
  profileObj?: any
): Promise<Array<{ id: number; nombre: string; alias?: string; slug_url?: string }>> {
  const masterDefaultChanId = String(botConfig.pictaChannelId || '36319');
  const excludeIds = isMaster ? new Set<string>() : new Set<string>([masterDefaultChanId]);
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Origin: 'https://admin.picta.cu',
    Referer: 'https://admin.picta.cu/',
  };

  const ownerIdentity: PictaUserOwnershipIdentity = {
    ...(userId && userId > 0 ? { userId } : {}),
    username: String(profileObj?.username || formattedUsername || '').trim(),
    phone: String(profileObj?.phone_number || profileObj?.telefono || formattedUsername || '').trim(),
    fullName: String(userFullName || '').trim(),
    ...(profileObj?.email ? { email: String(profileObj.email).trim() } : {}),
  };

  const verifiedChannelsById = new Map<
    number,
    { id: number; nombre: string; alias?: string; slug_url?: string }
  >();
  const addVerified = (ch: { id: number; nombre: string; alias?: string; slug_url?: string }) => {
    if (!ch.id || ch.id <= 0 || excludeIds.has(String(ch.id))) return;
    if (!verifiedChannelsById.has(ch.id)) {
      verifiedChannelsById.set(ch.id, ch);
    }
  };

  // 1. Check profile object (/v2/usuario/me2/) and user profile endpoints for embedded or scalar channels
  const profilePayloads: any[] = [];
  if (profileObj && typeof profileObj === 'object') {
    profilePayloads.push(profileObj);
  }
  const extraProfileUrls = [
    'https://api.picta.cu/v2/usuario/me/',
    'https://api.picta.cu/v1/usuario/me/',
    ...(userId && userId > 0
      ? [
          `https://api.picta.cu/v2/usuario/${encodeURIComponent(String(userId))}/`,
          `https://api.picta.cu/v1/usuario/${encodeURIComponent(String(userId))}/`,
        ]
      : []),
  ];
  const extraProfileRes = await Promise.all(
    extraProfileUrls.map(async (url) => {
      try {
        const r = await fetchPictaWithRetry(url, { headers: authHeaders }, 1);
        if (!r.ok) return null;
        return await r.json().catch(() => null);
      } catch {
        return null;
      }
    })
  );
  for (const p of extraProfileRes) {
    if (p && typeof p === 'object') profilePayloads.push(p);
  }

  for (const pObj of profilePayloads) {
    for (const ch of extractChannelsFromPictaRecords([pObj], excludeIds, ownerIdentity)) {
      addVerified(ch);
    }
    for (const scalarChanId of extractScalarChannelIdsFromRecord(pObj, excludeIds)) {
      if (!verifiedChannelsById.has(scalarChanId)) {
        const verified = await verifyChannelOwnershipByDetail(
          scalarChanId,
          accessToken,
          ownerIdentity,
          excludeIds,
          true
        );
        if (verified) addVerified(verified);
      }
    }
  }

  // 2. Query admin & user-scoped Picta endpoints directly (/v3/channel/, /v1/canal/, /v2/canal/, publications/series)
  if ((userId && userId > 0) || ownerIdentity.username || ownerIdentity.fullName) {
    const uid = userId && userId > 0 ? encodeURIComponent(String(userId)) : '';
    const directUrls: string[] = [
      'https://api.picta.cu/v3/channel/mine/',
      'https://api.picta.cu/v3/channel/?mine=true&page_size=50',
      'https://api.picta.cu/v1/canal/mis_canales/',
      'https://api.picta.cu/v2/canal/mis_canales/',
    ];

    if (uid) {
      directUrls.push(
        `https://api.picta.cu/v3/channel/?propietario=${uid}&page_size=50`,
        `https://api.picta.cu/v3/channel/?propietario_id=${uid}&page_size=50`,
        `https://api.picta.cu/v3/channel/?usuario=${uid}&page_size=50`,
        `https://api.picta.cu/v3/channel/?usuarios_asociados=${uid}&page_size=50`,
        `https://api.picta.cu/v1/canal/?propietario=${uid}&page_size=100`,
        `https://api.picta.cu/v1/canal/?propietario_id=${uid}&page_size=100`,
        `https://api.picta.cu/v1/canal/?usuario=${uid}&page_size=50`,
        `https://api.picta.cu/v1/canal/?usuarios_asociados=${uid}&page_size=50`,
        `https://api.picta.cu/v2/canal/?propietario=${uid}&page_size=100`,
        `https://api.picta.cu/v2/canal/?usuario_id=${uid}&page_size=50`,
        `https://api.picta.cu/v2/canal/?usuarios_asociados=${uid}&page_size=50`,
        `https://api.picta.cu/v2/publicacion/?usuario=${uid}&page_size=25`,
        `https://api.picta.cu/v2/publicacion/?usuario_id=${uid}&page_size=25`,
        `https://api.picta.cu/v1/publicacion/?usuario=${uid}&page_size=25`,
        `https://api.picta.cu/v2/serie/?usuario=${uid}&page_size=25`,
        `https://api.picta.cu/v2/lista_reproduccion_canal/?usuario=${uid}&page_size=25`
      );
    }

    const searchTerms = Array.from(
      new Set(
        [userFullName, ownerIdentity.username, formattedUsername]
          .map((s) => String(s || '').trim())
          .filter((s) => s.length >= 3 && !/^\+?\d+$/.test(s))
      )
    ).slice(0, 2);
    for (const term of searchTerms) {
      const qTerm = encodeURIComponent(term);
      directUrls.push(
        `https://api.picta.cu/v3/channel/?search=${qTerm}&page_size=20`,
        `https://api.picta.cu/v1/canal/?search=${qTerm}&page_size=20`
      );
    }

    const parentVerifiedIds = new Set<number>();
    const unverifiedNestedIds = new Set<number>();

    const responses = await Promise.all(
      directUrls.map(async (url) => {
        try {
          const res = await fetchPictaWithRetry(url, { headers: authHeaders }, 2);
          if (!res.ok) return { url, payload: null };
          return { url, payload: (await res.json().catch(() => null)) as any };
        } catch {
          return { url, payload: null };
        }
      })
    );

    for (const { url, payload } of responses) {
      if (!payload) continue;
      const list = Array.isArray(payload) ? payload : payload.results || [payload];
      const isMineEndpoint = /\/(?:mine|mis_canales)\/|\?mine=true/i.test(url);
      const isChannelEndpoint = /\/(?:canal|channel)\//.test(url);

      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        if (isChannelEndpoint) {
          const owned = isChannelOwnedOrAssociatedByUser(item, ownerIdentity);
          if (owned === true) {
            for (const ch of extractChannelsFromPictaRecords([item], excludeIds, ownerIdentity)) {
              addVerified(ch);
            }
          } else if (owned === false) {
            continue;
          } else {
            const itemId = Number(item.id || item.pk || 0);
            if (itemId > 0 && !excludeIds.has(String(itemId))) {
              if (isMineEndpoint) {
                parentVerifiedIds.add(itemId);
              } else {
                unverifiedNestedIds.add(itemId);
              }
            }
          }
        } else {
          // From /publicacion/, /serie/, /lista_reproduccion_canal/ — extract both nested objects and scalar IDs
          const itemOwner = isChannelOwnedOrAssociatedByUser(item, ownerIdentity);
          if (itemOwner === false) continue;

          const nestedCandidates = extractChannelsFromPictaRecords([item], excludeIds, ownerIdentity);
          for (const cand of nestedCandidates) {
            const nestedOwned = isChannelOwnedOrAssociatedByUser(item.canal || cand, ownerIdentity);
            if (nestedOwned === true || (nestedOwned === null && itemOwner === true)) {
              addVerified(cand);
            } else if (nestedOwned === null) {
              unverifiedNestedIds.add(cand.id);
            }
          }

          for (const scalarChanId of extractScalarChannelIdsFromRecord(item, excludeIds)) {
            if (verifiedChannelsById.has(scalarChanId)) continue;
            if (itemOwner === true) {
              parentVerifiedIds.add(scalarChanId);
            } else {
              unverifiedNestedIds.add(scalarChanId);
            }
          }
        }
      }
    }

    // Prioritize parent-verified channel IDs (e.g. from user's own publications/series or /mine) first
    const priorityCandidates = [
      ...Array.from(parentVerifiedIds).map((id) => ({ id, allowParent: true })),
      ...Array.from(unverifiedNestedIds)
        .filter((id) => !parentVerifiedIds.has(id))
        .slice(0, 12)
        .map((id) => ({ id, allowParent: false })),
    ];

    for (let i = 0; i < priorityCandidates.length; i += 5) {
      const batch = priorityCandidates.slice(i, i + 5);
      await Promise.all(
        batch.map(async (cand) => {
          if (verifiedChannelsById.has(cand.id)) return;
          const verified = await verifyChannelOwnershipByDetail(
            cand.id,
            accessToken,
            ownerIdentity,
            excludeIds,
            cand.allowParent
          );
          if (verified) addVerified(verified);
        })
      );
    }

    // 3. Scan /v3/channel/ and /v1/canal/ pages strictly by ownership (handles integer data.next pages 2..N)
    if (verifiedChannelsById.size === 0) {
      for (const baseEndpoint of [
        'https://api.picta.cu/v3/channel/',
        'https://api.picta.cu/v1/canal/',
      ]) {
        const firstRes = await fetchPictaWithRetry(
          `${baseEndpoint}?page=1&page_size=100`,
          { headers: authHeaders },
          2
        ).catch(() => null);
        if (!firstRes || !firstRes.ok) continue;
        const firstData = (await firstRes.json().catch(() => null)) as any;
        if (!firstData) continue;

        const firstList = Array.isArray(firstData) ? firstData : firstData.results || [];
        let sawOwnershipMetadata = false;
        const processPageList = (list: any[]) => {
          for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const owned = isChannelOwnedOrAssociatedByUser(item, ownerIdentity);
            if (owned !== null) sawOwnershipMetadata = true;
            if (owned === true) {
              for (const ch of extractChannelsFromPictaRecords([item], excludeIds, ownerIdentity)) {
                addVerified(ch);
              }
            }
          }
        };

        if (Array.isArray(firstList)) {
          processPageList(firstList);
        }
        if (verifiedChannelsById.size > 0) break;

        const totalCount = Number(firstData.count || 0);
        const totalPages = totalCount > 100 ? Math.min(15, Math.ceil(totalCount / 100)) : firstData.next ? 10 : 1;
        if (totalPages > 1 && sawOwnershipMetadata) {
          const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          for (let i = 0; i < remainingPages.length; i += 4) {
            const batchPages = remainingPages.slice(i, i + 4);
            const batchPayloads = await Promise.all(
              batchPages.map(async (p) => {
                try {
                  const r = await fetchPictaWithRetry(
                    `${baseEndpoint}?page=${p}&page_size=100`,
                    { headers: authHeaders },
                    2
                  );
                  if (!r.ok) return null;
                  return await r.json().catch(() => null);
                } catch {
                  return null;
                }
              })
            );
            let hitEnd = false;
            for (const pData of batchPayloads) {
              if (!pData) continue;
              const pList = Array.isArray(pData) ? pData : pData.results || [];
              if (!Array.isArray(pList) || pList.length === 0) {
                hitEnd = true;
                continue;
              }
              processPageList(pList);
            }
            if (verifiedChannelsById.size > 0 || hitEnd) break;
          }
        }
        if (verifiedChannelsById.size > 0) break;
      }
    }
  }

  return Array.from(verifiedChannelsById.values());
}

async function ensureGuestSessionChannelDiscovered(
  chatId: string,
  forceRefresh = false
): Promise<UserPictaSession | undefined> {
  const session = userSessions.get(chatId);
  if (!session || isMasterAdminChat(chatId)) return session;
  if (
    !forceRefresh &&
    session.channelId &&
    session.verifiedChannelOwnership &&
    session.hasChannelAdminRole !== undefined
  ) {
    return session;
  }

  const lastTry = lastAutoDiscoveryAttemptByChat.get(chatId) || 0;
  if (!forceRefresh && Date.now() - lastTry < 60_000) {
    return session;
  }
  lastAutoDiscoveryAttemptByChat.set(chatId, Date.now());

  try {
    const token =
      session.tokenExpiresAt > Date.now() + 60_000
        ? session.authToken
        : await refreshUserPictaSession(chatId);
    if (!token) return session;

    let profileObj: any = null;
    if (!session.userId || forceRefresh || session.hasChannelAdminRole === undefined) {
      profileObj = await fetchDecryptedPictaMe2(token);
      if (profileObj?.id) {
        session.userId = Number(profileObj.id);
        const fullName = `${profileObj.first_name || ''} ${profileObj.last_name || ''}`.trim();
        if (fullName) session.userFullName = fullName;
        const grp = extractPictaGroupSummary(profileObj);
        session.pictaGroups = grp.groupNames;
        session.hasChannelAdminRole = grp.hasChannelAdminRole;
      }
    }

    const discovered = await discoverUserPictaChannels(
      token,
      session.username,
      session.userFullName || session.username,
      session.userId,
      false,
      profileObj
    );
    if (discovered.length > 0) {
      session.availableChannels = discovered;
      if (!session.channelId || !discovered.some((d) => String(d.id) === String(session.channelId))) {
        session.channelId = String(discovered[0].id);
        session.channelName = discovered[0].nombre;
      }
      session.verifiedChannelOwnership = true;
    }
    session.updatedAt = new Date().toISOString();
    saveUserSessionsToDisk();
  } catch {
    // Non-fatal
  }
  return session;
}

async function performUserPictaLogin(
  chatId: string,
  rawUsername: string,
  rawPassword: string
): Promise<{ success: boolean; message: string; session?: UserPictaSession }> {
  const formattedUsername =
    rawUsername.replace(/\D/g, '').length === 8
      ? `+53${rawUsername.replace(/\D/g, '')}`
      : rawUsername.trim();

  const form = new FormData();
  form.append('username', formattedUsername);
  form.append('password', rawPassword.trim());
  form.append('grant_type', 'password');
  form.append('client_id', botConfig.pictaClientId || PICTA_OFFICIAL_CLIENT_ID);

  try {
    const tokenRes = await fetchPictaWithRetry('https://api.picta.cu/o/token/', {
      method: 'POST',
      headers: {
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: form,
    });

    if (!tokenRes.ok) {
      return {
        success: false,
        message:
          'No se pudo autenticar en Picta. Por favor verifica que tu usuario (o teléfono +53...) y contraseña sean correctos.',
      };
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return { success: false, message: 'Picta no devolvió un token de acceso válido.' };
    }

    const userProfileObj = await fetchDecryptedPictaMe2(accessToken);
    const userId: number | undefined = userProfileObj?.id ? Number(userProfileObj.id) : undefined;
    const groupSummary = extractPictaGroupSummary(userProfileObj);
    const userFullName =
      (userProfileObj &&
        `${userProfileObj.first_name || ''} ${userProfileObj.last_name || ''}`.trim()) ||
      userProfileObj?.username ||
      formattedUsername;

    const isMaster = isMasterAdminChat(chatId);
    const masterDefaultChanId = botConfig.pictaChannelId || '36319';

    // Discover ONLY the authenticated user's own channels; NEVER query #36319 for non-master users
    const channels: Array<{ id: number; nombre: string; alias?: string }> =
      await discoverUserPictaChannels(
        accessToken,
        formattedUsername,
        userFullName,
        userId,
        isMaster,
        userProfileObj
      );

    if (isMaster && !channels.some((x) => String(x.id) === String(masterDefaultChanId))) {
      try {
        const chkRes = await fetchPictaWithRetry(
          `https://api.picta.cu/v1/canal/${masterDefaultChanId}/`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Origin: 'https://admin.picta.cu',
              Referer: 'https://admin.picta.cu/',
            },
          }
        );
        if (chkRes.ok) {
          const chanData = (await chkRes.json()) as any;
          channels.unshift({
            id: Number(masterDefaultChanId),
            nombre: String(chanData?.nombre || 'Canal Oficial'),
            alias: chanData?.alias ? String(chanData.alias) : undefined,
          });
        }
      } catch {
        // Ignore
      }
    }

    const selectedChannel =
      channels.length > 0
        ? channels[0]
        : isMaster
          ? { id: Number(masterDefaultChanId), nombre: 'Canal Oficial' }
          : { id: 0, nombre: 'Sin canal asignado' };

    if (selectedChannel.id > 0 && !channels.some((x) => x.id === selectedChannel.id)) {
      channels.unshift(selectedChannel);
    }

    const hasChan = selectedChannel.id > 0;
    addLiveLog(
      'picta',
      hasChan ? 'success' : 'warn',
      `Login Picta chat ${chatId} (userId=${userId || 'N/A'}, grupos=[${groupSummary.groupNames.join(', ')}]): ${channels.length} canal(es) propio(s) detectado(s).`
    );

    const newSession: UserPictaSession = {
      chatId,
      username: formattedUsername,
      password: rawPassword.trim(),
      authToken: accessToken,
      tokenExpiresAt: Date.now() + (Number(tokenData.expires_in) || 14400) * 1000,
      userId,
      userFullName,
      channelId: hasChan ? String(selectedChannel.id) : '',
      channelName: selectedChannel.nombre,
      availableChannels: channels,
      verifiedChannelOwnership: hasChan,
      pictaGroups: groupSummary.groupNames,
      hasChannelAdminRole: groupSummary.hasChannelAdminRole,
      updatedAt: new Date().toISOString(),
    };

    userSessions.set(chatId, newSession);
    saveUserSessionsToDisk();

    const roleWarn = !groupSummary.hasChannelAdminRole && groupSummary.groupNames.length > 0
      ? `\n\n${buildPictaRoleDiagnosticLines({
          username: String(userProfileObj?.username || formattedUsername),
          groupNames: groupSummary.groupNames,
          hasChannelAdminRole: groupSummary.hasChannelAdminRole,
          channelName: hasChan ? selectedChannel.nombre : undefined,
          channelId: hasChan ? String(selectedChannel.id) : undefined,
        })}`
      : '';

    return {
      success: true,
      message:
        (hasChan
          ? `¡Sesión iniciada con éxito en Picta!\n📺 Canal propio detectado automáticamente: <b>${escapeHtml(selectedChannel.nombre)}</b> (<code>#${selectedChannel.id}</code>)` +
            (channels.length > 1
              ? `\n\n<i>También tienes ${channels.length - 1} canal(es) propio(s) adicional(es). Usa /canales si quieres cambiar entre los tuyos.</i>`
              : '')
          : `¡Sesión iniciada con éxito en Picta!\n\n⚠️ Tu cuenta aún no reportó ningún canal aprobado o asignado en <code>admin.picta.cu</code>.\nSi ya tienes un canal aprobado y conoces su enlace, puedes vincularlo directo con:\n<code>/canal https://www.picta.cu/canal/tu-canal</code>`) +
        roleWarn,
      session: newSession,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Error de conexión con Picta: ${err?.message || 'Error de red'}`,
    };
  }
}

async function findPictaChannel(
  rawQuery: string,
  authToken: string,
  chatId?: string
): Promise<Array<{ id: number; nombre: string; alias?: string; slug_url?: string }>> {
  const query = rawQuery.trim();
  if (!query) return [];

  const isMaster = isMasterAdminChat(chatId);
  const masterChanId = String(botConfig.pictaChannelId || '36319');
  const excludeIds = isMaster ? new Set<string>() : new Set<string>([masterChanId]);
  const session = chatId ? userSessions.get(chatId) : undefined;
  let userId = session?.userId;
  let meObj: any = null;
  if (!isMaster && (!userId || !session?.username)) {
    meObj = await fetchDecryptedPictaMe2(authToken);
    if (meObj?.id) {
      userId = Number(meObj.id);
      if (session) {
        session.userId = userId;
        saveUserSessionsToDisk();
      }
    }
  }

  const ownerIdentity: PictaUserOwnershipIdentity = {
    ...(userId && userId > 0 ? { userId } : {}),
    ...(session?.username ? { username: session.username, phone: session.username } : {}),
    ...(meObj?.username ? { username: String(meObj.username) } : {}),
    ...(meObj?.phone_number ? { phone: String(meObj.phone_number) } : {}),
    ...(meObj?.email ? { email: String(meObj.email) } : {}),
  };

  // 1. Extract slug or numeric ID if user pasted a full picta.cu or admin.picta.cu URL
  const cleanedUrlQuery = query.split(/[?#]/)[0];
  const urlMatch = cleanedUrlQuery.match(
    /(?:canal|canales|channel|channels)\/(?:edit\/)?([a-zA-Z0-9_\-]+)/i
  );
  const effectiveQuery = (urlMatch ? urlMatch[1] : query).trim();

  // 2. If exact numeric ID: verify via /v3/channel/{id}/, /v2/canal/{id}/, /v1/canal/{id}/ with strict ownership check
  if (/^\d+$/.test(effectiveQuery)) {
    if (!isMaster && effectiveQuery === masterChanId) {
      return [];
    }
    if (isMaster) {
      try {
        const res = await fetchPictaWithRetry(`https://api.picta.cu/v1/canal/${effectiveQuery}/`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          return [
            {
              id: Number(effectiveQuery),
              nombre: String(data?.nombre || `Canal #${effectiveQuery}`),
              alias: data?.alias ? String(data.alias) : undefined,
              slug_url: data?.slug_url ? String(data.slug_url) : undefined,
            },
          ];
        }
      } catch {
        // Continue
      }
    } else {
      const verified = await verifyChannelOwnershipByDetail(
        Number(effectiveQuery),
        authToken,
        ownerIdentity,
        excludeIds
      );
      return verified ? [verified] : [];
    }
  }

  // 3. Search within the authenticated user's own discovered channels first (never exposes public catalog)
  let ownedChannels = session?.availableChannels || [];
  if (!isMaster && ownedChannels.length === 0 && session) {
    ownedChannels = await discoverUserPictaChannels(
      authToken,
      session.username,
      session.userFullName || session.username,
      userId,
      false,
      meObj
    );
    if (ownedChannels.length > 0) {
      session.availableChannels = ownedChannels;
      if (!session.channelId) {
        session.channelId = String(ownedChannels[0].id);
        session.channelName = ownedChannels[0].nombre;
        session.verifiedChannelOwnership = true;
      }
      saveUserSessionsToDisk();
    }
  }

  const ownedMatches = filterMatchingOwnedChannels(
    ownedChannels,
    effectiveQuery,
    ownerIdentity,
    excludeIds,
    true
  );
  if (ownedMatches.length > 0) {
    return ownedMatches;
  }

  // 4. Slug & search lookup across v1/v2/v3 (filtered strictly by match & verified ownership)
  const searchEndpoints = [
    `https://api.picta.cu/v1/canal/?slug_url=${encodeURIComponent(effectiveQuery)}`,
    `https://api.picta.cu/v3/channel/?slug_url=${encodeURIComponent(effectiveQuery)}`,
    `https://api.picta.cu/v1/canal/?search=${encodeURIComponent(effectiveQuery)}&page_size=20`,
    `https://api.picta.cu/v3/channel/?search=${encodeURIComponent(effectiveQuery)}&page_size=20`,
    `https://api.picta.cu/v2/canal/?search=${encodeURIComponent(effectiveQuery)}&page_size=20`,
  ];

  const verifiedMatchesById = new Map<number, { id: number; nombre: string; alias?: string; slug_url?: string }>();
  const rawCandidates: Array<{ id: number; nombre: string; alias?: string; slug_url?: string }> = [];

  await Promise.all(
    searchEndpoints.map(async (ep) => {
      try {
        const res = await fetchPictaWithRetry(ep, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as any;
        if (!data) return;
        const list = data.results || (Array.isArray(data) ? data : []);
        const matches = filterMatchingOwnedChannels(
          list,
          effectiveQuery,
          isMaster ? undefined : ownerIdentity,
          excludeIds,
          true
        );
        for (const m of matches) {
          rawCandidates.push(m);
        }
      } catch {
        // Ignore single endpoint error
      }
    })
  );

  const uniqueIds = Array.from(new Set(rawCandidates.map((c) => c.id))).slice(0, 6);
  for (const candId of uniqueIds) {
    const cand = rawCandidates.find((c) => c.id === candId)!;
    if (isMaster) {
      verifiedMatchesById.set(candId, cand);
    } else {
      const verified = await verifyChannelOwnershipByDetail(
        candId,
        authToken,
        ownerIdentity,
        excludeIds
      );
      if (verified) verifiedMatchesById.set(candId, verified);
    }
  }

  return Array.from(verifiedMatchesById.values());
}

interface OnlineMediaInfo {
  title: string;
  originalTitle?: string;
  year?: string;
  rating?: string;
  director?: string;
  guion?: string;
  productora?: string;
  reparto?: string;
  pais?: string;
  genero?: string;
  musica?: string;
  fotografia?: string;
  synopsis?: string;
  episodeSynopsis?: string;
  episodeTitle?: string;
  imageUrl?: string;
  posterUrl?: string;
  backdropUrl?: string;
  found: boolean;
}

const PICTA_TMDB_API_KEY = '02b60a5f22f7a8f94cd9500a494f98e8';

async function translateTextToSpanishIfNeeded(rawText: string | undefined | null): Promise<string> {
  const clean = String(rawText || '').trim();
  if (!clean) return '';
  if (!isLikelyEnglishText(clean)) return clean;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(
      clean
    )}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as any;
      if (Array.isArray(data?.[0])) {
        const translated = data[0]
          .map((seg: any) => (Array.isArray(seg) ? String(seg[0] || '') : ''))
          .join('')
          .trim();
        if (translated && !isLikelyEnglishText(translated)) {
          return translated;
        }
      }
    }
  } catch {
    // Fallback below
  }
  // Never allow untranslated English synopses to leak into Picta
  return '';
}

interface OnlineSearchDiscoveryResult {
  disambiguation: CandidateDisambiguationResult;
  cleanQuery: string;
  releaseYear?: string;
  effectiveSeason: number;
  effectiveEp: number;
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit, timeoutMs = 5500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTmdbDetailsForId(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  fallbackTitle: string,
  effectiveSeason = 0,
  effectiveEp = 0
): Promise<Partial<OnlineMediaInfo>> {
  const d = await fetchJsonWithTimeout(
    `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${PICTA_TMDB_API_KEY}&language=es-MX&append_to_response=credits,external_ids`
  );
  if (!d) return {};

  let overviewEs = String(d.overview || '').trim();
  if (!overviewEs || isLikelyEnglishText(overviewEs)) {
    const dEs = await fetchJsonWithTimeout(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${PICTA_TMDB_API_KEY}&language=es-ES`
    );
    if (dEs?.overview && !isLikelyEnglishText(String(dEs.overview))) {
      overviewEs = String(dEs.overview).trim();
    } else if (!overviewEs && dEs?.overview) {
      overviewEs = String(dEs.overview).trim();
    }
  }
  if (!overviewEs) {
    const dEn = await fetchJsonWithTimeout(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${PICTA_TMDB_API_KEY}&language=en-US`
    );
    if (dEn?.overview) overviewEs = String(dEn.overview).trim();
  }
  overviewEs = await translateTextToSpanishIfNeeded(overviewEs);

  const yr = String(d.first_air_date || d.release_date || '').slice(0, 4);
  const genres = Array.isArray(d.genres)
    ? d.genres.map((g: any) => g.name).filter(Boolean).join(', ')
    : '';
  const country =
    Array.isArray(d.production_countries) && d.production_countries[0]?.name
      ? String(d.production_countries[0].name)
      : Array.isArray(d.origin_country) && d.origin_country[0]
        ? String(d.origin_country[0])
        : '';
  const studio =
    Array.isArray(d.production_companies) && d.production_companies[0]?.name
      ? String(d.production_companies[0].name)
      : Array.isArray(d.networks) && d.networks[0]?.name
        ? String(d.networks[0].name)
        : '';
  const tmdbImgs = buildTmdbImageUrls(d.poster_path, d.backdrop_path);
  const posterUrl = tmdbImgs.imageUrl;

  const crew = Array.isArray(d.credits?.crew) ? d.credits.crew : [];
  const cast = Array.isArray(d.credits?.cast) ? d.credits.cast : [];
  const directors = crew
    .filter((c: any) => c.job === 'Director' || c.department === 'Directing')
    .slice(0, 2)
    .map((c: any) => c.name);
  const creators = Array.isArray(d.created_by)
    ? d.created_by.slice(0, 2).map((c: any) => c.name)
    : [];
  const writers = crew
    .filter((c: any) => c.department === 'Writing')
    .slice(0, 2)
    .map((c: any) => c.name);
  const composers = crew
    .filter((c: any) => c.job?.includes('Music') || c.department === 'Sound')
    .slice(0, 1)
    .map((c: any) => c.name);
  const dop = crew
    .filter((c: any) => c.job?.includes('Photography') || c.department === 'Camera')
    .slice(0, 1)
    .map((c: any) => c.name);
  const topCast = cast.slice(0, 4).map((c: any) => c.name);

  let epTitleEs = '';
  let epSynopsisEs = '';
  if (mediaType === 'tv' && effectiveSeason > 0 && effectiveEp > 0) {
    for (const lang of ['es-MX', 'es-ES', 'en-US']) {
      const epData = await fetchJsonWithTimeout(
        `https://api.themoviedb.org/3/tv/${tmdbId}/season/${effectiveSeason}/episode/${effectiveEp}?api_key=${PICTA_TMDB_API_KEY}&language=${lang}`
      );
      if (epData) {
        if (!epTitleEs && epData?.name && !/^(?:Episodio|Episode)\s+\d+$/i.test(String(epData.name))) {
          epTitleEs = String(epData.name).trim();
        }
        if (!epSynopsisEs && epData?.overview) {
          const candSyn = await translateTextToSpanishIfNeeded(String(epData.overview));
          if (candSyn) {
            epSynopsisEs = candSyn;
            break;
          }
        }
      }
    }
  }

  const tmdbRating = Number(d.vote_average) > 0 ? Number(d.vote_average).toFixed(1) : '';

  return {
    title: String(d.name || d.title || fallbackTitle),
    originalTitle: String(d.original_name || d.original_title || d.name || d.title || fallbackTitle),
    ...(yr ? { year: yr } : {}),
    ...(tmdbRating ? { rating: tmdbRating } : {}),
    ...(directors.length > 0 || creators.length > 0
      ? { director: (directors.length > 0 ? directors : creators).join(', ') }
      : {}),
    ...(writers.length > 0 ? { guion: writers.join(', ') } : {}),
    ...(studio ? { productora: studio } : {}),
    ...(topCast.length > 0 ? { reparto: topCast.join(', ') } : {}),
    ...(country ? { pais: country } : {}),
    ...(genres ? { genero: genres } : {}),
    ...(composers.length > 0 ? { musica: composers.join(', ') } : {}),
    ...(dop.length > 0 ? { fotografia: dop.join(', ') } : {}),
    ...(overviewEs ? { synopsis: overviewEs } : {}),
    ...(epSynopsisEs ? { episodeSynopsis: epSynopsisEs } : {}),
    ...(epTitleEs ? { episodeTitle: epTitleEs } : {}),
    ...(posterUrl ? { imageUrl: posterUrl } : {}),
    ...(tmdbImgs.posterUrl ? { posterUrl: tmdbImgs.posterUrl } : {}),
    ...(tmdbImgs.backdropUrl ? { backdropUrl: tmdbImgs.backdropUrl } : {}),
    found: true,
  };
}

async function searchMediaCandidatesOnline(
  rawQuery: string,
  tipId: number,
  seasonNum?: number | string,
  epNum?: number | string
): Promise<OnlineSearchDiscoveryResult> {
  const seExtract = parseSingleSeriesCandidate(rawQuery);
  const effectiveSeason = Number(seasonNum || (seExtract.hasExplicitNumbers ? seExtract.temporada : 0));
  const effectiveEp = Number(epNum || (seExtract.hasExplicitNumbers ? seExtract.numero : 0));

  const titleAnalysis = cleanMediaTitleForSearch(rawQuery);
  const cleanQuery = titleAnalysis.cleanQuery;
  const releaseYear = titleAnalysis.year;
  const simplified = titleAnalysis.simplifiedTitle;

  if (!cleanQuery || cleanQuery.length < 1 || isRandomOrCrypticFilename(cleanQuery)) {
    return {
      disambiguation: { confidentWinner: null, topCandidates: [], needsDisambiguation: false },
      cleanQuery,
      releaseYear,
      effectiveSeason,
      effectiveEp,
    };
  }

  const isExplicitSerie = tipId === 5 || seExtract.hasExplicitNumbers;
  const isExplicitMovie = tipId === 1 && !seExtract.hasExplicitNumbers;
  const primaryEndpoint: 'tv' | 'movie' | 'multi' = isExplicitSerie
    ? 'tv'
    : isExplicitMovie
      ? 'movie'
      : 'multi';

  const queryVariants: Array<{ q: string; year?: string }> = [];
  const seenQueries = new Set<string>();
  const pushQuery = (q: string | undefined, yr?: string) => {
    const t = String(q || '').trim();
    if (!t || t.length < 1) return;
    const key = `${t.toLowerCase()}::${yr || ''}`;
    if (seenQueries.has(key)) return;
    seenQueries.add(key);
    queryVariants.push({ q: t, year: yr });
  };

  if (
    titleAnalysis.subtitleQuery &&
    titleAnalysis.subtitleQuery.length >= 3 &&
    !/^\s*episodio\s*[ivx0-9]+\s*$/i.test(titleAnalysis.subtitleQuery)
  ) {
    if (titleAnalysis.franchise && titleAnalysis.franchise.length >= 3) {
      pushQuery(`${titleAnalysis.franchise} ${titleAnalysis.subtitleQuery}`, isExplicitSerie ? undefined : releaseYear);
    }
    pushQuery(titleAnalysis.subtitleQuery, isExplicitSerie ? undefined : releaseYear);
  }
  pushQuery(cleanQuery, isExplicitSerie ? undefined : releaseYear);
  if (releaseYear) pushQuery(cleanQuery, undefined);

  const deAccented = cleanQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (deAccented.toLowerCase() !== cleanQuery.toLowerCase()) {
    pushQuery(deAccented, undefined);
  }
  if (
    simplified &&
    simplified.length >= 4 &&
    !/^(star|guerra|movie|film|el|la|los|the)$/i.test(simplified) &&
    simplified.toLowerCase() !== cleanQuery.toLowerCase()
  ) {
    pushQuery(simplified, isExplicitSerie ? undefined : releaseYear);
  }

  const collected: MediaMatchCandidate[] = [];
  const collectTmdbItems = (items: any[], defaultType: 'movie' | 'tv') => {
    for (const item of items) {
      const mType: 'movie' | 'tv' =
        item.media_type === 'tv' || item.media_type === 'movie' ? item.media_type : defaultType;
      if (item.media_type === 'person') continue;
      const candTitle = String(item.name || item.title || '').trim();
      const candOriginal = String(item.original_name || item.original_title || candTitle).trim();
      const candYear = String(item.first_air_date || item.release_date || '').slice(0, 4);
      if (!candTitle) continue;

      let score = scoreCandidateMatch(
        cleanQuery,
        candTitle,
        candOriginal,
        candYear,
        releaseYear,
        titleAnalysis.subtitleQuery,
        Number(item.popularity || 0)
      );
      if (isExplicitSerie && mType === 'tv') score += 8;
      if (isExplicitMovie && mType === 'movie') score += 8;

      const imgs = buildTmdbImageUrls(item.poster_path, item.backdrop_path);
      collected.push({
        id: `tmdb:${mType}:${item.id}`,
        source: 'tmdb',
        mediaType: mType,
        tmdbId: Number(item.id),
        title: candTitle,
        originalTitle: candOriginal,
        year: candYear || undefined,
        overview: String(item.overview || '').trim() || undefined,
        posterUrl: imgs.posterUrl || undefined,
        backdropUrl: imgs.backdropUrl || undefined,
        popularity: Number(item.popularity || 0),
        score,
      });
    }
  };

  // 1. Run TMDB bilingual searches (es-MX + en-US) and real IMDb Suggestion API in parallel
  const primaryAttempt = queryVariants[0] || { q: cleanQuery, year: releaseYear };
  const tmdbUrls: Array<{ url: string; defType: 'movie' | 'tv' }> = [
    {
      url:
        `https://api.themoviedb.org/3/search/${primaryEndpoint}?api_key=${PICTA_TMDB_API_KEY}&language=es-MX&query=${encodeURIComponent(primaryAttempt.q)}&page=1` +
        (primaryAttempt.year && primaryEndpoint === 'movie' ? `&primary_release_year=${encodeURIComponent(primaryAttempt.year)}` : ''),
      defType: primaryEndpoint === 'tv' ? 'tv' : 'movie',
    },
    {
      url: `https://api.themoviedb.org/3/search/${primaryEndpoint}?api_key=${PICTA_TMDB_API_KEY}&language=en-US&query=${encodeURIComponent(cleanQuery)}&page=1`,
      defType: primaryEndpoint === 'tv' ? 'tv' : 'movie',
    },
  ];
  if (primaryAttempt.year && primaryEndpoint === 'movie') {
    tmdbUrls.push({
      url: `https://api.themoviedb.org/3/search/movie?api_key=${PICTA_TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(cleanQuery)}&page=1`,
      defType: 'movie',
    });
  }

  const imdbQueryClean = cleanQuery
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(imdbQueryClean || cleanQuery)}.json`;

  const [tmdbResList, imdbData] = await Promise.all([
    Promise.all(
      tmdbUrls.map(async (entry) => ({
        defType: entry.defType,
        data: await fetchJsonWithTimeout(entry.url, undefined, 5000),
      }))
    ),
    fetchJsonWithTimeout(
      imdbUrl,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PictaBot/2.0)' } },
      5000
    ),
  ]);

  for (const r of tmdbResList) {
    if (Array.isArray(r.data?.results)) {
      collectTmdbItems(r.data.results, r.defType);
    }
  }

  // Try secondary query variants on TMDB if top score so far is low (< 45)
  const currentMaxScore = collected.reduce((m, c) => Math.max(m, c.score), -999);
  if (currentMaxScore < 45 && queryVariants.length > 1) {
    for (const attempt of queryVariants.slice(1, 4)) {
      const url = `https://api.themoviedb.org/3/search/${primaryEndpoint}?api_key=${PICTA_TMDB_API_KEY}&language=es-MX&query=${encodeURIComponent(attempt.q)}&page=1`;
      const extraData = await fetchJsonWithTimeout(url, undefined, 4500);
      if (Array.isArray(extraData?.results)) {
        collectTmdbItems(extraData.results, primaryEndpoint === 'tv' ? 'tv' : 'movie');
      }
    }
  }

  // If user chose Película/Serie specifically but found zero plausible candidates in that endpoint, check /search/multi
  if (collected.filter((c) => c.score >= 25).length === 0 && primaryEndpoint !== 'multi') {
    const multiData = await fetchJsonWithTimeout(
      `https://api.themoviedb.org/3/search/multi?api_key=${PICTA_TMDB_API_KEY}&language=es-MX&query=${encodeURIComponent(cleanQuery)}&page=1`,
      undefined,
      4500
    );
    if (Array.isArray(multiData?.results)) {
      collectTmdbItems(multiData.results, 'movie');
    }
  }

  // 2. Process Real IMDb Suggestion results and bridge IMDb IDs -> TMDB /find
  const rawImdbItems: any[] = Array.isArray(imdbData?.d) ? imdbData.d : [];
  const validImdbItems = rawImdbItems
    .filter(
      (it) =>
        it &&
        typeof it.id === 'string' &&
        it.id.startsWith('tt') &&
        ['movie', 'tvSeries', 'tvMiniSeries', 'tvMovie', 'feature'].includes(String(it.qid || ''))
    )
    .slice(0, 6);

  if (validImdbItems.length > 0) {
    const scoredImdb = validImdbItems
      .map((it) => {
        const mType: 'movie' | 'tv' =
          it.qid === 'tvSeries' || it.qid === 'tvMiniSeries' ? 'tv' : 'movie';
        const yr = it.y ? String(it.y) : undefined;
        let sc = scoreCandidateMatch(
          cleanQuery,
          String(it.l || ''),
          String(it.l || ''),
          yr,
          releaseYear,
          titleAnalysis.subtitleQuery,
          it.rank ? Math.max(5, 80 / Math.log10(Number(it.rank) + 10)) : 12
        );
        if (isExplicitSerie && mType === 'tv') sc += 8;
        if (isExplicitMovie && mType === 'movie') sc += 8;
        return { it, mType, yr, sc };
      })
      .filter((x) => x.sc >= 15)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 3);

    await Promise.all(
      scoredImdb.map(async ({ it, mType, yr, sc }) => {
        const imdbId = String(it.id);
        const findData = await fetchJsonWithTimeout(
          `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${PICTA_TMDB_API_KEY}&external_source=imdb_id&language=es-MX`,
          undefined,
          4500
        );
        const movieMatch = Array.isArray(findData?.movie_results) ? findData.movie_results[0] : null;
        const tvMatch = Array.isArray(findData?.tv_results) ? findData.tv_results[0] : null;
        const resolved = mType === 'tv' ? tvMatch || movieMatch : movieMatch || tvMatch;
        if (resolved && resolved.id) {
          const resolvedType: 'movie' | 'tv' = tvMatch && resolved === tvMatch ? 'tv' : 'movie';
          const candTitle = String(resolved.name || resolved.title || it.l || '').trim();
          const candOrig = String(resolved.original_name || resolved.original_title || it.l || candTitle).trim();
          const candYr = String(resolved.first_air_date || resolved.release_date || yr || '').slice(0, 4);
          const imgs = buildTmdbImageUrls(resolved.poster_path, resolved.backdrop_path);
          let bridgeScore = scoreCandidateMatch(
            cleanQuery,
            candTitle,
            candOrig,
            candYr,
            releaseYear,
            titleAnalysis.subtitleQuery,
            Number(resolved.popularity || 15)
          );
          if (isExplicitSerie && resolvedType === 'tv') bridgeScore += 8;
          if (isExplicitMovie && resolvedType === 'movie') bridgeScore += 8;

          collected.push({
            id: `tmdb:${resolvedType}:${resolved.id}`,
            source: 'tmdb',
            mediaType: resolvedType,
            tmdbId: Number(resolved.id),
            imdbId,
            title: candTitle,
            originalTitle: candOrig,
            year: candYr || undefined,
            overview: String(resolved.overview || '').trim() || undefined,
            posterUrl: imgs.posterUrl || it.i?.imageUrl || undefined,
            backdropUrl: imgs.backdropUrl || undefined,
            popularity: Number(resolved.popularity || 15),
            score: Math.max(bridgeScore, sc) + 4,
          });
        } else {
          // Keep native IMDb hit if TMDB /find had no entry
          collected.push({
            id: `imdb:${mType}:${imdbId}`,
            source: 'imdb',
            mediaType: mType,
            imdbId,
            title: String(it.l || '').trim(),
            originalTitle: String(it.l || '').trim(),
            year: yr,
            posterUrl: typeof it.i?.imageUrl === 'string' ? it.i.imageUrl : undefined,
            popularity: 10,
            score: sc,
          });
        }
      })
    );
  }

  const disambiguation = decideBestOrTop3Candidates(cleanQuery, collected, releaseYear);
  return {
    disambiguation,
    cleanQuery,
    releaseYear,
    effectiveSeason,
    effectiveEp,
  };
}

async function fetchOnlineMediaDetailsByCandidate(
  cand: MediaMatchCandidate,
  effectiveSeason = 0,
  effectiveEp = 0
): Promise<OnlineMediaInfo | null> {
  if (cand.tmdbId) {
    const details = await fetchTmdbDetailsForId(
      cand.mediaType,
      cand.tmdbId,
      cand.title,
      effectiveSeason,
      effectiveEp
    );
    if (details.found) {
      return {
        title: details.title || cand.title,
        originalTitle: details.originalTitle || cand.originalTitle || cand.title,
        year: details.year || cand.year,
        rating: details.rating,
        director: details.director,
        guion: details.guion,
        productora: details.productora,
        reparto: details.reparto,
        pais: details.pais,
        genero: details.genero,
        musica: details.musica,
        fotografia: details.fotografia,
        synopsis: details.synopsis || '',
        episodeSynopsis: details.episodeSynopsis,
        episodeTitle: details.episodeTitle,
        imageUrl: details.imageUrl || cand.posterUrl,
        posterUrl: details.posterUrl || cand.posterUrl,
        backdropUrl: details.backdropUrl || cand.backdropUrl,
        found: true,
      };
    }
  }

  // Fallback for direct IMDb-only result (without TMDB record)
  return {
    title: cand.title,
    originalTitle: cand.originalTitle || cand.title,
    ...(cand.year ? { year: cand.year } : {}),
    ...(cand.overview ? { synopsis: await translateTextToSpanishIfNeeded(cand.overview) } : {}),
    ...(cand.posterUrl ? { imageUrl: cand.posterUrl, posterUrl: cand.posterUrl } : {}),
    found: true,
  };
}

async function searchMovieOrSeriesInfoOnline(
  rawQuery: string,
  tipId: number,
  seasonNum?: number | string,
  epNum?: number | string
): Promise<OnlineMediaInfo | null> {
  try {
    const discovery = await searchMediaCandidatesOnline(rawQuery, tipId, seasonNum, epNum);
    const { disambiguation, cleanQuery, effectiveSeason, effectiveEp } = discovery;
    if (!cleanQuery || cleanQuery.length < 1 || isRandomOrCrypticFilename(cleanQuery)) return null;

    let primaryInfo: Partial<OnlineMediaInfo> = {};
    const bestCand = disambiguation.confidentWinner || disambiguation.topCandidates[0] || null;
    if (bestCand) {
      const fetched = await fetchOnlineMediaDetailsByCandidate(bestCand, effectiveSeason, effectiveEp);
      if (fetched && fetched.found) {
        primaryInfo = fetched;
      }
    }

    // Secondary Source for Series: TVMaze ONLY if strict title match passes
    let tvMazeInfo: Partial<OnlineMediaInfo> = {};
    if (!primaryInfo.found && (tipId === 5 || effectiveEp > 0)) {
      const tvm = await fetchJsonWithTimeout(
        `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanQuery)}&embed=episodes`,
        { headers: { 'User-Agent': 'PictaBotCataloger/2.0 (multiversovisual.cuba@gmail.com)' } },
        4500
      );
      if (tvm && tvm.name && isTitleMatchStrict(cleanQuery, String(tvm.name), String(tvm.name))) {
        const rawSum = await translateTextToSpanishIfNeeded(
          String(tvm.summary || '').replace(/<[^>]+>/g, '').trim()
        );
        const yr = String(tvm.premiered || '').slice(0, 4);
        const genres = Array.isArray(tvm.genres) ? tvm.genres.join(', ') : '';
        const country = tvm.network?.country?.name || tvm.webChannel?.country?.name || '';
        const studio = tvm.network?.name || tvm.webChannel?.name || '';
        const img = String(tvm.image?.original || tvm.image?.medium || '').trim();

        let epSynopsis = '';
        let epTitle = '';
        const epList = tvm._embedded?.episodes;
        if (Array.isArray(epList) && effectiveSeason > 0 && effectiveEp > 0) {
          const epMatch = epList.find(
            (e: any) => Number(e.season) === effectiveSeason && Number(e.number) === effectiveEp
          );
          if (epMatch) {
            epTitle = String(epMatch.name || '').trim();
            epSynopsis = await translateTextToSpanishIfNeeded(
              String(epMatch.summary || '').replace(/<[^>]+>/g, '').trim()
            );
          }
        }

        const tvmRating = Number(tvm.rating?.average) > 0 ? Number(tvm.rating.average).toFixed(1) : '';

        tvMazeInfo = {
          title: String(tvm.name),
          originalTitle: String(tvm.name),
          ...(yr ? { year: yr } : {}),
          ...(tvmRating ? { rating: tvmRating } : {}),
          ...(genres ? { genero: genres } : {}),
          ...(country ? { pais: country } : {}),
          ...(studio ? { productora: studio } : {}),
          ...(rawSum ? { synopsis: rawSum } : {}),
          ...(epSynopsis ? { episodeSynopsis: epSynopsis } : {}),
          ...(epTitle ? { episodeTitle: epTitle } : {}),
          ...(img ? { imageUrl: img, posterUrl: img } : {}),
          found: true,
        };
      }
    }

    const queryWikipedia = async (lang: 'es' | 'en'): Promise<Partial<OnlineMediaInfo> | null> => {
      try {
        const suffix =
          lang === 'es'
            ? tipId === 1 && !/\b(pelicula|película|film|movie)\b/i.test(cleanQuery)
              ? ' película'
              : tipId === 5 && !/\b(serie|show|tv)\b/i.test(cleanQuery)
                ? ' serie de televisión'
                : ''
            : tipId === 1
              ? ' film'
              : tipId === 5
                ? ' TV series'
                : '';

        const searchQ = `${cleanQuery}${suffix}`.trim();
        const data = await fetchJsonWithTimeout(
          `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQ)}&utf8=&format=json`,
          { headers: { 'User-Agent': 'PictaBotCataloger/2.0 (multiversovisual.cuba@gmail.com; film scraper)' } },
          4500
        );
        if (!data) return null;
        const hits = data.query?.search || [];
        const stripWikiTitle = (t: string) =>
          String(t || '')
            .replace(/\s*\(película.*?\)\s*$/i, '')
            .replace(/\s*\(serie.*?\)\s*$/i, '')
            .replace(/\s*\(.*?film.*?\)\s*$/i, '')
            .replace(/\s*\(.*?series.*?\)\s*$/i, '')
            .replace(/\s*\(.*?\)\s*$/, '')
            .trim();

        const strictHits = hits.filter((h: any) =>
          isTitleMatchStrict(cleanQuery, stripWikiTitle(h.title))
        );
        const hit =
          strictHits.find((h: any) =>
            tipId === 1
              ? /película|pelicula|film/i.test(h.title)
              : tipId === 5
                ? /serie|series|television|televisión/i.test(h.title)
                : false
          ) || strictHits[0];
        if (!hit || !hit.pageid) return null;

        const pageId = hit.pageid;
        const dData = await fetchJsonWithTimeout(
          `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|revisions|pageimages&exintro&explaintext&rvprop=content&rvsection=0&pithumbsize=1000&pageids=${pageId}&format=json`,
          { headers: { 'User-Agent': 'PictaBotCataloger/2.0 (multiversovisual.cuba@gmail.com; film scraper)' } },
          4500
        );
        const page = dData?.query?.pages?.[pageId];
        if (!page) return null;

        const extract = String(page.extract || '').trim();
        const wikitext = String(page.revisions?.[0]?.['*'] || '');
        const thumbUrl = String(page.thumbnail?.source || '').trim();

        const matchProp = (...names: string[]): string => {
          for (const name of names) {
            const regex = new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|]+)`, 'i');
            const m = wikitext.match(regex);
            if (m && m[1]) {
              const cleaned = m[1]
                .replace(/\{\{[^|]+\|/g, '')
                .replace(/\}\}/g, '')
                .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&[a-z]+;/gi, ' ')
                .replace(/\|/g, ', ')
                .replace(/\s{2,}/g, ' ')
                .trim();
              if (cleaned) return cleaned;
            }
          }
          return '';
        };

        const cleanTitle = stripWikiTitle(hit.title);
        const origTitle = matchProp('título original', 'native_name') || cleanTitle;
        if (!isTitleMatchStrict(cleanQuery, cleanTitle, origTitle)) {
          return null;
        }

        const yearMatch =
          wikitext.match(/\b(19\d\d|20\d\d)\b/) || extract.match(/\b(19\d\d|20\d\d)\b/);
        const year = yearMatch ? yearMatch[1] : undefined;

        const director = matchProp('dirección', 'director', 'creador', 'creator', 'created_by');
        const guion = matchProp('guion', 'guión', 'screenplay', 'writer');
        const productora = matchProp('productora', 'estudio', 'distribución', 'studio', 'network', 'company');
        const protagonistas = matchProp('protagonistas', 'reparto', 'actores', 'starring');
        const pais = matchProp('país', 'pais', 'country');
        const genero = matchProp('género', 'genero', 'genre');
        const musica = matchProp('música', 'musica', 'music', 'composer');
        const fotografia = matchProp('fotografía', 'fotografia', 'cinematography');

        const rawParagraph = extract.split('\n\n')[0]?.slice(0, 500) || '';
        const spanishSynopsis =
          lang === 'es' ? rawParagraph : await translateTextToSpanishIfNeeded(rawParagraph);

        return {
          title: cleanTitle,
          originalTitle: origTitle,
          year,
          director,
          guion,
          productora,
          reparto: protagonistas,
          pais,
          genero,
          musica,
          fotografia,
          synopsis: spanishSynopsis,
          ...(thumbUrl ? { imageUrl: thumbUrl } : {}),
          found: true,
        };
      } catch {
        return null;
      }
    };

    const wikiEs = !primaryInfo.found || !primaryInfo.synopsis ? await queryWikipedia('es') : null;
    const wikiEn =
      !primaryInfo.found && (!wikiEs || !wikiEs.synopsis) ? await queryWikipedia('en') : null;
    const wiki = wikiEs || wikiEn;

    if (!primaryInfo.found && !wiki && !tvMazeInfo.found) return null;

    return {
      title: primaryInfo.title || wikiEs?.title || tvMazeInfo.title || wikiEn?.title || cleanQuery,
      originalTitle:
        primaryInfo.originalTitle || tvMazeInfo.originalTitle || wiki?.originalTitle || cleanQuery,
      year: primaryInfo.year || wiki?.year || tvMazeInfo.year,
      rating: primaryInfo.rating || tvMazeInfo.rating,
      director: primaryInfo.director || wiki?.director || wikiEn?.director,
      guion: primaryInfo.guion || wiki?.guion || wikiEn?.guion,
      productora:
        primaryInfo.productora || wiki?.productora || tvMazeInfo.productora || wikiEn?.productora,
      reparto: primaryInfo.reparto || wiki?.reparto || wikiEn?.reparto,
      pais: primaryInfo.pais || wiki?.pais || tvMazeInfo.pais || wikiEn?.pais,
      genero: primaryInfo.genero || wiki?.genero || tvMazeInfo.genero || wikiEn?.genero,
      musica: primaryInfo.musica || wiki?.musica || wikiEn?.musica,
      fotografia: primaryInfo.fotografia || wiki?.fotografia || wikiEn?.fotografia,
      synopsis:
        primaryInfo.synopsis || wikiEs?.synopsis || tvMazeInfo.synopsis || wikiEn?.synopsis || '',
      episodeSynopsis: primaryInfo.episodeSynopsis || tvMazeInfo.episodeSynopsis,
      episodeTitle: primaryInfo.episodeTitle || tvMazeInfo.episodeTitle,
      imageUrl:
        primaryInfo.imageUrl || tvMazeInfo.imageUrl || wikiEs?.imageUrl || wikiEn?.imageUrl,
      ...(primaryInfo.posterUrl || tvMazeInfo.posterUrl
        ? { posterUrl: primaryInfo.posterUrl || tvMazeInfo.posterUrl }
        : {}),
      ...(primaryInfo.backdropUrl ? { backdropUrl: primaryInfo.backdropUrl } : {}),
      found: true,
    };
  } catch {
    return null;
  }
}

function loadProcessedUpdatesFromDisk(): void {
  try {
    if (fs.existsSync(PROCESSED_UPDATES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PROCESSED_UPDATES_FILE, 'utf-8'));
      if (Array.isArray(parsed.updateIds)) {
        for (const id of parsed.updateIds) processedUpdateIds.add(Number(id));
      }
      if (Array.isArray(parsed.callbackIds)) {
        for (const id of parsed.callbackIds) processedCallbackIds.add(String(id));
      }
      if (Array.isArray(parsed.messageKeys)) {
        for (const k of parsed.messageKeys) processedMessageKeys.add(String(k));
      }
      if (typeof parsed.lastOffset === 'number' && parsed.lastOffset > 0) {
        lastUpdateOffset = parsed.lastOffset;
      }
    }
  } catch {
    // Ignore
  }
}

let processedUpdatesSaveTimer: NodeJS.Timeout | null = null;

function flushProcessedUpdatesToDiskNow(): void {
  if (processedUpdatesSaveTimer) {
    clearTimeout(processedUpdatesSaveTimer);
    processedUpdatesSaveTimer = null;
  }
  try {
    const payload = {
      lastOffset: lastUpdateOffset,
      updateIds: Array.from(processedUpdateIds).slice(-500),
      callbackIds: Array.from(processedCallbackIds).slice(-500),
      messageKeys: Array.from(processedMessageKeys).slice(-500),
    };
    fs.writeFileSync(PROCESSED_UPDATES_FILE, JSON.stringify(payload), 'utf-8');
    mirrorFileToLegacyDataDir(PROCESSED_UPDATES_FILE);
  } catch {
    // Ignore
  }
}

function saveProcessedUpdatesToDisk(): void {
  if (processedUpdatesSaveTimer) return;
  processedUpdatesSaveTimer = setTimeout(() => {
    flushProcessedUpdatesToDiskNow();
  }, 1500);
  if (typeof processedUpdatesSaveTimer.unref === 'function') {
    processedUpdatesSaveTimer.unref();
  }
}

loadProcessedUpdatesFromDisk();

function addLiveLog(
  source: LiveEventLog['source'],
  level: LiveEventLog['level'],
  message: string
): void {
  const entry: LiveEventLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    source,
    level,
    message,
  };
  liveLogs.unshift(entry);
  if (liveLogs.length > 300) {
    liveLogs = liveLogs.slice(0, 300);
  }
}

function addMtprotoDiagLog(
  input: Omit<MtprotoDiagLogEntry, 'id' | 'timestamp'> & { skipLiveLog?: boolean }
): void {
  const { skipLiveLog, ...rest } = input;
  const entry: MtprotoDiagLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...rest,
  };
  mtprotoDiagLogs.unshift(entry);
  if (mtprotoDiagLogs.length > 150) {
    mtprotoDiagLogs = mtprotoDiagLogs.slice(0, 150);
  }
  if (!skipLiveLog) {
    addLiveLog('mtproto', input.level, input.message);
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(2)} MB`;
}

async function fetchPictaWithRetry(
  url: string,
  init?: RequestInit,
  maxAttempts = 3
): Promise<globalThis.Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Official Picta OAuth2 Login (https://api.picta.cu/o/token/)
 */
async function authenticateWithPicta(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    botConfig.pictaAuthToken &&
    pictaTokenExpiresAt > Date.now() + 60_000
  ) {
    return botConfig.pictaAuthToken;
  }

  const rawUser = botConfig.pictaUsername.trim();
  const rawPass = botConfig.pictaPassword.trim();
  const formattedUsername = /^\d{8}$/.test(rawUser)
    ? `+53${rawUser}`
    : /^53\d{8}$/.test(rawUser)
      ? `+${rawUser}`
      : rawUser;

  const form = new FormData();
  form.append('username', formattedUsername);
  form.append('password', rawPass);
  form.append('grant_type', 'password');
  form.append('client_id', botConfig.pictaClientId || PICTA_OFFICIAL_CLIENT_ID);

  const tokenRes = await fetchPictaWithRetry('https://api.picta.cu/o/token/', {
    method: 'POST',
    headers: {
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: form,
  });

  const tokenData = (await tokenRes.json()) as any;
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description ||
        tokenData.error ||
        `Error HTTP ${tokenRes.status} al iniciar sesión en Picta`
    );
  }

  const accessToken: string = tokenData.access_token;
  botConfig.pictaAuthToken = accessToken;
  pictaTokenExpiresAt = Date.now() + (Number(tokenData.expires_in) || 14400) * 1000;

  if (!pictaUser) {
    void (async () => {
      try {
        const meRes = await fetchPictaWithRetry('https://api.picta.cu/v2/usuario/me2/', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
        });
        if (meRes.ok) {
          const encryptedText = (await meRes.text()).trim().replace(/^"|"$/g, '');
          const decipher = crypto.createDecipheriv(
            'aes-128-ecb',
            Buffer.from(PICTA_AES_KEY, 'utf8'),
            null
          );
          let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
          decrypted += decipher.final('utf8');
          const userObj = JSON.parse(decrypted);

          pictaUser = {
            id: userObj.id,
            username: userObj.username,
            firstName: userObj.first_name || '',
            lastName: userObj.last_name || '',
            phoneNumber: userObj.phone_number || formattedUsername,
            roles: (userObj.groups || []).map((g: any) => g.name),
          };

          addLiveLog(
            'picta',
            'success',
            `Sesión activa en admin.picta.cu: @${pictaUser.username} (${pictaUser.firstName} ${pictaUser.lastName}) · Canal: Canal Oficial (ID: 36319)`
          );
        }
      } catch {
        // Ignore background profile decode error
      }
    })();
  }

  return accessToken;
}

const PICTA_OFFICIAL_GENRES: Array<{ id: number; nombre: string; keywords: string[] }> = [
  { id: 5, nombre: 'Acción', keywords: ['accion', 'acción', 'action'] },
  { id: 17, nombre: 'Ciencia ficción', keywords: ['ciencia ficcion', 'ciencia ficción', 'sci-fi', 'scifi', 'ficcion'] },
  { id: 6, nombre: 'Aventura', keywords: ['aventura', 'adventure'] },
  { id: 12, nombre: 'Drama', keywords: ['drama', 'dramático', 'dramatico'] },
  { id: 11, nombre: 'Comedia', keywords: ['comedia', 'comedy', 'humor'] },
  { id: 42, nombre: 'Terror', keywords: ['terror', 'horror', 'miedo'] },
  { id: 19, nombre: 'Animación', keywords: ['animacion', 'animación', 'animation', 'dibujos', 'animada'] },
  { id: 23, nombre: 'Suspenso', keywords: ['suspenso', 'thriller', 'misterio'] },
  { id: 92, nombre: 'Anime', keywords: ['anime', 'manga', 'otaku'] },
  { id: 26, nombre: 'Fantasía', keywords: ['fantasia', 'fantasía', 'fantasy'] },
  { id: 14, nombre: 'Crimen / Policial', keywords: ['crimen', 'policial', 'policiaco', 'mafia'] },
  { id: 24, nombre: 'Romance', keywords: ['romance', 'romantica', 'romántica', 'amor'] },
  { id: 18, nombre: 'Familiar', keywords: ['familiar', 'infantil', 'niños', 'kids'] },
  { id: 15, nombre: 'Bélico', keywords: ['belico', 'bélico', 'guerra', 'war'] },
  { id: 10, nombre: 'Documental', keywords: ['documental', 'documentary'] },
  { id: 22, nombre: 'Musical', keywords: ['musical', 'musica', 'música'] },
  { id: 20, nombre: 'Histórico', keywords: ['historico', 'histórico', 'historia'] },
  { id: 28, nombre: 'Western', keywords: ['western', 'vaqueros'] },
];

function resolveGenreIds(input: unknown): number[] {
  if (Array.isArray(input)) {
    const valid = input.map(Number).filter((n) => !isNaN(n) && n > 0);
    if (valid.length > 0) return valid;
  }
  if (typeof input === 'number' && input > 0) {
    return [input];
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      return [Number(trimmed)];
    }
    const lower = trimmed.toLowerCase();
    for (const g of PICTA_OFFICIAL_GENRES) {
      if (g.keywords.some((kw) => lower.includes(kw))) {
        return [g.id];
      }
    }
  }
  return [5]; // Default Acción
}

async function resolvePersonaIds(
  token: string,
  names: string[],
  defaultId: number = 1022
): Promise<number[]> {
  const ids: number[] = [];
  for (const rawName of names) {
    const clean = rawName.trim();
    if (!clean || clean.length < 2) continue;
    try {
      const res = await fetch(`https://api.picta.cu/v2/persona/?search=${encodeURIComponent(clean)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ id: number; nombre: string }> };
        if (data.results && data.results.length > 0) {
          const exact = data.results.find((r) => r.nombre.trim().toLowerCase() === clean.toLowerCase());
          if (exact) {
            ids.push(exact.id);
            continue;
          }
          const partial = data.results.find((r) => r.nombre.toLowerCase().includes(clean.toLowerCase()));
          if (partial) {
            ids.push(partial.id);
            continue;
          }
          ids.push(data.results[0].id);
        }
      }
    } catch {
      // ignore network errors
    }
  }
  if (ids.length === 0) {
    ids.push(defaultId);
  }
  return ids;
}

async function resolveProductoraId(token: string, name: string): Promise<number> {
  const clean = name.trim();
  if (clean && clean.length > 2) {
    try {
      const res = await fetch(`https://api.picta.cu/v2/extra/?tipo=productora&search=${encodeURIComponent(clean)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ id: number; nombre: string }> };
        if (data.results && data.results.length > 0) {
          const exact = data.results.find((r) => r.nombre.trim().toLowerCase() === clean.toLowerCase());
          if (exact) return exact.id;
          return data.results[0].id;
        }
      }
    } catch {
      // ignore
    }
  }
  return 679; // 679 is 'desconocido' in Picta extra table
}

async function resolvePremioId(token: string, name?: string): Promise<number> {
  const clean = (name || '').trim();
  if (clean && clean.length > 2 && !/^(ninguno|sin|no|none)$/i.test(clean)) {
    try {
      const res = await fetch(`https://api.picta.cu/v2/extra/?tipo=premio&search=${encodeURIComponent(clean)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ id: number; nombre: string }> };
        if (data.results && data.results.length > 0) {
          return data.results[0].id;
        }
      }
    } catch {
      // ignore
    }
  }
  return 469; // 469 is 'Ninguno' in Picta extra table
}

function formatPictaError(status: number, rawResponseText: string): string {
  try {
    const json = JSON.parse(rawResponseText);
    if (Array.isArray(json?.error) && json.error.length > 0) {
      return `Error HTTP ${status} en Picta: ${json.error.join(', ')}`;
    }
    const detailsObj =
      json?.error?.details ||
      json?.details ||
      (typeof json === 'object' && !json.detail && !json.message && !json.error ? json : null);
    if (detailsObj && typeof detailsObj === 'object') {
      const lines: string[] = [];
      const summary = json?.error?.message || json?.message || 'Error de validación en Picta';
      lines.push(`Error HTTP ${status} (${summary}):`);
      for (const [field, messages] of Object.entries(detailsObj)) {
        if (field === 'error' || field === 'code' || field === 'message') continue;
        const msgText = Array.isArray(messages) ? messages.join(', ') : String(messages);
        lines.push(`• ${field}: ${msgText}`);
      }
      if (lines.length > 1) {
        return lines.join('\n');
      }
    }
    if (json?.detail) {
      return `Error HTTP ${status}: ${json.detail}`;
    }
    if (json?.error?.message) {
      return `Error HTTP ${status}: ${json.error.message}`;
    }
  } catch {
    // not JSON
  }
  return `Error HTTP ${status}: ${rawResponseText}`;
}
// Series title & caption parsing helpers moved to ./src/utils/seriesEpisodeParser.ts

const CHANNEL_SERIES_FILE = path.join(STATE_DIR, 'channel_series.json');

interface ChannelSeasonRecord {
  id: number;
  numero: number;
  nombre: string;
}

interface ChannelChapterRecord {
  pubId: number;
  numero: number;
  temporada: number;
  temporadaId?: number;
  nombre: string;
  descripcion?: string;
  minioKey?: string;
  publicado?: boolean;
  convertido?: boolean;
  updatedAt: string;
}

interface ChannelSerieRecord {
  pelser_id: number;
  nombre: string;
  canal_id: number;
  seasons: ChannelSeasonRecord[];
  chapters?: ChannelChapterRecord[];
  coverUrl?: string;
  customCoverFileId?: string;
  updatedAt: string;
}

function loadChannelSeriesFromDisk(): ChannelSerieRecord[] {
  try {
    if (fs.existsSync(CHANNEL_SERIES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CHANNEL_SERIES_FILE, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return [];
}

function saveChannelSeriesToDisk(list: ChannelSerieRecord[]): void {
  try {
    fs.writeFileSync(CHANNEL_SERIES_FILE, JSON.stringify(list.slice(0, 100), null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(CHANNEL_SERIES_FILE);
  } catch {
    // Ignore
  }
}

let channelSeriesCache: ChannelSerieRecord[] = loadChannelSeriesFromDisk();

function upsertChannelSerieRecord(
  pelserId: number,
  nombre: string,
  season?: { id: number; numero: number; nombre?: string },
  extra?: { coverUrl?: string; customCoverFileId?: string; canalId?: number },
  chapter?: ChannelChapterRecord
): ChannelSerieRecord {
  const cleanName = cleanSerieDisplayName(nombre) || nombre.trim() || `Serie #${pelserId}`;
  const effectiveCanalId = Number(extra?.canalId || botConfig.pictaChannelId || 36319);
  let record = channelSeriesCache.find(
    (s) =>
      Number(s.canal_id || 0) === effectiveCanalId &&
      ((pelserId > 0 && Number(s.pelser_id) === Number(pelserId)) ||
        cleanSerieDisplayName(s.nombre).toLowerCase() === cleanName.toLowerCase())
  );

  if (!record) {
    record = {
      pelser_id: Number(pelserId),
      nombre: cleanName,
      canal_id: effectiveCanalId,
      seasons: [],
      chapters: [],
      ...(extra?.coverUrl ? { coverUrl: extra.coverUrl } : {}),
      ...(extra?.customCoverFileId ? { customCoverFileId: extra.customCoverFileId } : {}),
      updatedAt: new Date().toISOString(),
    };
    channelSeriesCache.unshift(record);
  } else {
    if (pelserId > 0) record.pelser_id = Number(pelserId);
    record.canal_id = effectiveCanalId;
    if (cleanName && !isGenericOrInvalidSerieName(cleanName)) {
      record.nombre = cleanName;
    }
    if (!Array.isArray(record.chapters)) {
      record.chapters = [];
    }
    if (extra?.coverUrl) record.coverUrl = extra.coverUrl;
    if (extra?.customCoverFileId) record.customCoverFileId = extra.customCoverFileId;
    record.updatedAt = new Date().toISOString();
  }

  if (season && season.id > 0) {
    const existingSeason = record.seasons.find(
      (st) => Number(st.id) === Number(season.id) || Number(st.numero) === Number(season.numero)
    );
    if (existingSeason) {
      existingSeason.id = Number(season.id);
      existingSeason.numero = Number(season.numero);
      existingSeason.nombre = season.nombre || `Temporada ${season.numero}`;
    } else {
      record.seasons.push({
        id: Number(season.id),
        numero: Number(season.numero),
        nombre: season.nombre || `Temporada ${season.numero}`,
      });
      record.seasons.sort((a, b) => a.numero - b.numero);
    }
  }

  if (chapter && chapter.pubId > 0) {
    if (!Array.isArray(record.chapters)) {
      record.chapters = [];
    }
    const existingCap = record.chapters.find(
      (c) =>
        Number(c.pubId) === Number(chapter.pubId) ||
        (Number(c.temporada) === Number(chapter.temporada) &&
          Number(c.numero) === Number(chapter.numero))
    );
    if (existingCap) {
      existingCap.pubId = Number(chapter.pubId);
      existingCap.numero = Number(chapter.numero || existingCap.numero || 1);
      existingCap.temporada = Number(chapter.temporada || existingCap.temporada || 1);
      if (chapter.temporadaId) existingCap.temporadaId = Number(chapter.temporadaId);
      if (chapter.nombre) existingCap.nombre = chapter.nombre;
      if (chapter.descripcion) existingCap.descripcion = sanitizePublicPictaText(chapter.descripcion);
      if (chapter.minioKey) existingCap.minioKey = chapter.minioKey;
      if (typeof chapter.publicado === 'boolean') existingCap.publicado = chapter.publicado;
      if (typeof chapter.convertido === 'boolean') existingCap.convertido = chapter.convertido;
      existingCap.updatedAt = new Date().toISOString();
    } else {
      record.chapters.push({
        ...chapter,
        descripcion: chapter.descripcion
          ? sanitizePublicPictaText(chapter.descripcion)
          : undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    record.chapters.sort((a, b) =>
      a.temporada !== b.temporada ? a.temporada - b.temporada : a.numero - b.numero
    );
  }

  saveChannelSeriesToDisk(channelSeriesCache);
  return record;
}

function findUserChannelSerie(pelserId: number, chatId?: string): ChannelSerieRecord | undefined {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) return undefined;
  const scoped = filterSeriesForChannel(
    channelSeriesCache,
    ctx.channelId,
    isMasterAdminChat(effectiveChatId),
    botConfig.pictaChannelId || '36319'
  );
  return scoped.find((s) => Number(s.pelser_id) === Number(pelserId));
}

function findUserChannelChapter(
  pubId: number,
  chatId?: string
): { serie: ChannelSerieRecord; chapter: ChannelChapterRecord } | undefined {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) return undefined;
  const scoped = filterSeriesForChannel(
    channelSeriesCache,
    ctx.channelId,
    isMasterAdminChat(effectiveChatId),
    botConfig.pictaChannelId || '36319'
  );
  for (const s of scoped) {
    const ch = (s.chapters || []).find((c) => Number(c.pubId) === Number(pubId));
    if (ch) return { serie: s, chapter: ch };
  }
  return undefined;
}

function resolveSeriesStyleForChannel(
  chatId: string,
  pelserId?: number,
  serieName?: string
): DetectedSeriesTitleStyle | null {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const targetChId = ctx.channelId || '';
  const isMaster = isMasterAdminChat(effectiveChatId);
  const masterChanId = botConfig.pictaChannelId || '36319';

  const scoped = filterSeriesForChannel(channelSeriesCache, targetChId, isMaster, masterChanId);
  const normSerie = String(serieName || '').trim().toLowerCase();

  const matchedSerie =
    (pelserId && pelserId > 0
      ? scoped.find((s) => Number(s.pelser_id) === Number(pelserId))
      : undefined) ||
    (normSerie
      ? scoped.find((s) => s.nombre.toLowerCase().trim() === normSerie)
      : undefined);

  const chapterTitles: string[] = [];
  if (matchedSerie && Array.isArray(matchedSerie.chapters)) {
    for (const ch of matchedSerie.chapters) {
      if (ch?.nombre && String(ch.nombre).trim()) {
        chapterTitles.push(String(ch.nombre).trim());
      }
    }
  }

  // Also check completed transferJobs in the same channel & series (covers freshly uploaded episodes before catalog refresh)
  for (const j of transferJobs) {
    if (j.tipologiaId !== 5 || j.stage !== 'completed') continue;
    if (!isMaster && j.telegramChatId !== effectiveChatId) continue;
    if (targetChId && j.targetChannelId && String(j.targetChannelId) !== String(targetChId)) continue;
    const jPelser = Number(j.modelMetadata?.serie_pelser_id || 0);
    const jSerieName = String(j.modelMetadata?.serie || '').toLowerCase().trim();
    const sameSerie =
      (pelserId && pelserId > 0 && jPelser === Number(pelserId)) ||
      (normSerie && jSerieName === normSerie);
    if (sameSerie && j.title && !chapterTitles.includes(j.title.trim())) {
      chapterTitles.push(j.title.trim());
    }
  }

  return detectDominantSeriesTitleStyle(
    chapterTitles,
    matchedSerie?.nombre || serieName
  );
}



async function syncAndGetChannelSeries(chatId?: string): Promise<ChannelSerieRecord[]> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const isMaster = isMasterAdminChat(effectiveChatId);
  const ctx = getEffectivePictaContext(effectiveChatId);
  const masterChanId = botConfig.pictaChannelId || '36319';
  if (!ctx.isLinked || !ctx.channelId) {
    return [];
  }
  const channelId = ctx.channelId;
  const channelNum = Number(channelId);

  try {
    const token = await ctx.accessTokenPromise;
    const headers = {
      Authorization: `Bearer ${token}`,
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    };

    const [serieRes, tempRes, pubRes] = await Promise.all([
      fetchPictaWithRetry(
        `https://api.picta.cu/v2/serie/?canal_id=${encodeURIComponent(channelId)}&page_size=50`,
        { headers },
        2
      ).catch(() => null),
      fetchPictaWithRetry(
        `https://api.picta.cu/v2/temporada/?canal_id=${encodeURIComponent(channelId)}&page_size=100`,
        { headers },
        2
      ).catch(() => null),
      fetchPictaWithRetry(
        `https://api.picta.cu/v2/publicacion/?canal_id=${encodeURIComponent(channelId)}&page_size=100`,
        { headers },
        2
      ).catch(() => null),
    ]);

    if (serieRes && serieRes.ok) {
      const sData = (await serieRes.json()) as any;
      const sList = Array.isArray(sData) ? sData : sData.results || [];
      for (const s of sList) {
        const pid = Number(s.pelser_id || s.id || 0);
        if (pid > 0 && s.nombre) {
          const sCover = String(s.url_imagen || s.imagen_secundaria || '').trim();
          upsertChannelSerieRecord(pid, String(s.nombre), undefined, {
            ...(sCover ? { coverUrl: sCover } : {}),
            canalId: channelNum,
          });
        }
      }
    }

    if (tempRes && tempRes.ok) {
      const tData = (await tempRes.json()) as any;
      const tList = Array.isArray(tData) ? tData : tData.results || [];
      for (const t of tList) {
        const sObj = typeof t.serie === 'object' && t.serie ? t.serie : null;
        const pid = Number(sObj?.pelser_id || sObj?.id || (typeof t.serie === 'number' ? t.serie : 0));
        const sName = String(sObj?.nombre || '');
        const sCover = String(sObj?.url_imagen || sObj?.imagen_secundaria || '').trim();
        if (pid > 0 && sName && t.id) {
          upsertChannelSerieRecord(
            pid,
            sName,
            {
              id: Number(t.id),
              numero: Number(t.numero || 1),
              nombre: String(t.nombre || `Temporada ${t.numero || 1}`),
            },
            { ...(sCover ? { coverUrl: sCover } : {}), canalId: channelNum }
          );
        }
      }
    }

    // Also inspect completed transferJobs belonging ONLY to this user and channel
    for (const j of transferJobs) {
      if (!isMaster && j.telegramChatId !== effectiveChatId) continue;
      if (j.targetChannelId && String(j.targetChannelId) !== String(channelId)) continue;
      if (!j.targetChannelId && !isMaster) continue;
      if (j.tipologiaId === 5 && j.stage === 'completed') {
        let jPubId = Number(j.pictaPublicationId || 0);
        if (!jPubId && j.pictaResponseText) {
          try {
            const parsedResp = JSON.parse(j.pictaResponseText);
            if (parsedResp?.id) jPubId = Number(parsedResp.id);
          } catch {
            // Ignore
          }
        }
        if (jPubId > 0) {
          j.pictaPublicationId = jPubId;
          const sPelser = Number(j.modelMetadata?.serie_pelser_id || 0);
          const sName = cleanSerieDisplayName(
            String(
              j.modelMetadata?.serie ||
                extractSeriesInfoFromText(j.fileName, j.caption).serieName ||
                (isMaster ? 'El Mentalista' : 'Serie')
            )
          );
          const sTemp = Number(j.modelMetadata?.temporada || 1) || 1;
          const sTempId = Number(j.modelMetadata?.temporada_id || 0);
          const sEp = Number(j.modelMetadata?.numero || extractSeriesInfoFromText(j.title).numero || 1) || 1;
          upsertChannelSerieRecord(
            sPelser,
            sName,
            sTempId > 0 ? { id: sTempId, numero: sTemp, nombre: `Temporada ${sTemp}` } : undefined,
            { canalId: channelNum },
            {
              pubId: jPubId,
              numero: sEp,
              temporada: sTemp,
              ...(sTempId > 0 ? { temporadaId: sTempId } : {}),
              nombre: j.title,
              descripcion: sanitizePublicPictaText(j.synopsis),
              minioKey: j.minioKey,
              publicado: true,
              updatedAt: j.updatedAt || new Date().toISOString(),
            }
          );
        }
      }
    }

    // Inspect published episodes in channel (strictly scoped to channelId)
    if (pubRes && pubRes.ok) {
      const pData = (await pubRes.json()) as any;
      const pList = Array.isArray(pData) ? pData : pData.results || [];
      const candidateSerieNames = new Set<string>();
      for (const p of pList) {
        const capObj = p?.categoria?.capitulo;
        const capTemp = capObj?.temporada;
        const capSerie = capTemp?.serie;
        const rawTitle = String(p.nombre || '');
        const titleMatch = rawTitle.match(/^(.+?)\s*[-–]\s*T(\d{1,2})\s*:\s*E(\d{1,3})/i);

        if (capSerie && (capSerie.pelser_id || capSerie.id) && capSerie.nombre) {
          const pid = Number(capSerie.pelser_id || capSerie.id);
          const sName = cleanSerieDisplayName(String(capSerie.nombre));
          const tId = Number(capTemp?.id || 0);
          const tNumMatch = String(capTemp?.nombre || '').match(/(\d+)/);
          const tNum = Number(
            capTemp?.numero || (titleMatch ? titleMatch[2] : tNumMatch ? tNumMatch[1] : 1)
          );
          const epNum = Number(capObj?.numero || (titleMatch ? titleMatch[3] : 1));
          const sCover = String(
            capSerie.url_imagen || capSerie.imagen_secundaria || p.url_imagen || ''
          ).trim();
          upsertChannelSerieRecord(
            pid,
            sName,
            tId > 0
              ? {
                  id: tId,
                  numero: tNum,
                  nombre: String(capTemp?.nombre || `Temporada ${tNum}`),
                }
              : undefined,
            { ...(sCover ? { coverUrl: sCover } : {}), canalId: channelNum },
            p.id
              ? {
                  pubId: Number(p.id),
                  numero: epNum,
                  temporada: tNum,
                  ...(tId > 0 ? { temporadaId: tId } : {}),
                  nombre: rawTitle || `${sName} - T${tNum}:E${String(epNum).padStart(2, '0')}`,
                  descripcion: sanitizePublicPictaText(p.descripcion),
                  publicado: p.publicado !== false,
                  convertido: Boolean(p.convertido),
                  updatedAt: new Date().toISOString(),
                }
              : undefined
          );
        }

        if (titleMatch && titleMatch[1] && !isGenericOrInvalidSerieName(titleMatch[1])) {
          candidateSerieNames.add(cleanSerieDisplayName(titleMatch[1]));
        }
      }
      const currentScoped = filterSeriesForChannel(
        channelSeriesCache,
        channelId,
        isMaster,
        masterChanId
      );
      for (const candName of candidateSerieNames) {
        const alreadyKnown = currentScoped.some((c) =>
          cleanSerieDisplayName(c.nombre).toLowerCase().includes(candName.toLowerCase())
        );
        if (!alreadyKnown) {
          const searchRes = await fetchPictaWithRetry(
            `https://api.picta.cu/v2/temporada/?canal_id=${encodeURIComponent(channelId)}&search=${encodeURIComponent(candName)}`,
            { headers },
            2
          ).catch(() => null);
          if (searchRes && searchRes.ok) {
            const stData = (await searchRes.json()) as any;
            const stList = Array.isArray(stData) ? stData : stData.results || [];
            for (const t of stList) {
              const sObj = typeof t.serie === 'object' && t.serie ? t.serie : null;
              const sName = cleanSerieDisplayName(String(sObj?.nombre || candName));
              const pid = Number(
                sObj?.pelser_id || sObj?.id || (typeof t.serie === 'number' ? t.serie : 0)
              );
              if (
                sName.toLowerCase().includes(candName.toLowerCase()) &&
                t.id
              ) {
                upsertChannelSerieRecord(
                  pid || Number(t.id),
                  sName,
                  {
                    id: Number(t.id),
                    numero: Number(t.numero || 1),
                    nombre: String(t.nombre || `Temporada ${t.numero || 1}`),
                  },
                  { canalId: channelNum }
                );
              }
            }
          }
        }
      }
    }
  } catch {
    // Return channel-scoped cached list on network error
  }
  return filterSeriesForChannel(channelSeriesCache, channelId, isMaster, masterChanId);
}

async function ensureSerieAndTemporadaId(
  token: string,
  serieName: string,
  temporadaRaw: string | number | undefined,
  meta: Record<string, any> = {},
  coverBuffer: Buffer,
  targetChannelId?: string,
  targetChannelName?: string,
  isMaster = true
): Promise<number> {
  const effectiveChanId = String(targetChannelId || '').trim();
  if (!effectiveChanId) {
    throw new Error('No hay un canal vinculado para registrar la serie en Picta.');
  }
  const effectiveChanNum = Number(effectiveChanId);
  const effectiveChanLabel = (targetChannelName && targetChannelName.trim()) || `Canal #${effectiveChanId}`;
  const numStr = String(temporadaRaw || '1').replace(/\D/g, '') || '1';
  const targetNum = Number(numStr) || 1;
  const cleanSerieName = serieName.trim() || `Serie ${effectiveChanLabel}`;

  // 0. If user already picked or created a specific temporada_id in Telegram
  if (meta.temporada_id && Number(meta.temporada_id) > 0) {
    return Number(meta.temporada_id);
  }

  // 1. Direct season ID passed
  if (typeof temporadaRaw === 'number' && temporadaRaw > 50) {
    return temporadaRaw;
  }
  if (typeof temporadaRaw === 'string' && /^\d{3,6}$/.test(temporadaRaw.trim())) {
    return Number(temporadaRaw.trim());
  }

  // Check local channel series cache scoped ONLY to this channel
  const scopedSeries = filterSeriesForChannel(
    channelSeriesCache,
    effectiveChanId,
    isMaster,
    botConfig.pictaChannelId || '36319'
  );
  const cachedSerie = scopedSeries.find(
    (s) =>
      (meta.serie_pelser_id && Number(s.pelser_id) === Number(meta.serie_pelser_id)) ||
      s.nombre.toLowerCase().trim() === cleanSerieName.toLowerCase()
  );
  if (cachedSerie) {
    const cachedSeason = cachedSerie.seasons.find((st) => Number(st.numero) === targetNum);
    if (cachedSeason && cachedSeason.id > 0) {
      return cachedSeason.id;
    }
  }

  // 2. Search existing season in Picta scoped to effectiveChanId
  try {
    const searchUrl = `https://api.picta.cu/v2/temporada/?canal_id=${encodeURIComponent(effectiveChanId)}&search=${encodeURIComponent(cleanSerieName)}`;
    const res = await fetchPictaWithRetry(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const list = Array.isArray(data) ? data : data.results || [];
      if (list.length > 0) {
        const exactSeasonMatch = list.find(
          (t: any) =>
            t.serie?.nombre &&
            t.serie.nombre.toLowerCase().trim() === cleanSerieName.toLowerCase() &&
            Number(t.numero) === targetNum
        );
        const match =
          exactSeasonMatch ||
          list.find(
            (t: any) =>
              t.serie?.nombre &&
              t.serie.nombre.toLowerCase().includes(cleanSerieName.toLowerCase()) &&
              Number(t.numero) === targetNum
          );
        if (match?.id) {
          const pid = Number(match.serie?.pelser_id || match.serie?.id || meta.serie_pelser_id || match.id);
          upsertChannelSerieRecord(
            pid,
            match.serie?.nombre || cleanSerieName,
            {
              id: Number(match.id),
              numero: Number(match.numero || targetNum),
              nombre: String(match.nombre || `Temporada ${targetNum}`),
            },
            { canalId: effectiveChanNum }
          );
          addLiveLog(
            'picta',
            'info',
            `Temporada vinculada para serie "${cleanSerieName}": Temporada ${match.numero || targetNum} (ID: ${match.id})`
          );
          return Number(match.id);
        }
      }
    }
  } catch {
    // Continue to auto-creation
  }

  // 3. Search if Serie exists in this channel's catalog or use selected pelser_id
  let pelserId: number | null =
    meta.serie_pelser_id && Number(meta.serie_pelser_id) > 0
      ? Number(meta.serie_pelser_id)
      : cachedSerie?.pelser_id || null;

  if (!pelserId) {
    try {
      const sRes = await fetchPictaWithRetry(
        `https://api.picta.cu/v2/serie/?canal_id=${encodeURIComponent(effectiveChanId)}&search=${encodeURIComponent(cleanSerieName)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: 'https://admin.picta.cu',
          },
        }
      );
      if (sRes.ok) {
        const sData = (await sRes.json()) as any;
        const sList = Array.isArray(sData) ? sData : sData.results || [];
        const sMatch = sList.find(
          (s: any) => s.nombre && s.nombre.toLowerCase().trim() === cleanSerieName.toLowerCase().trim()
        );
        if (sMatch?.pelser_id) {
          pelserId = Number(sMatch.pelser_id);
        }
      }
    } catch {
      // Continue
    }
  }

  // 4. If Serie does not exist, create it in the target channel
  if (!pelserId) {
    addLiveLog(
      'picta',
      'info',
      `Creando Serie "${cleanSerieName}" en canal ${effectiveChanLabel} (#${effectiveChanId})...`
    );

    const onlineSerie = await searchMovieOrSeriesInfoOnline(cleanSerieName, 5).catch(() => null);
    let finalSerieCoverBuf = coverBuffer;
    let finalSeriePosterBuf = coverBuffer;
    let finalSerieCoverUrl = '';
    const hasCustomSerieBuf = Boolean(coverBuffer && coverBuffer.byteLength > 200);
    const seriePortadaUrl = selectOnlineImageForSlot(onlineSerie, 'portada');
    const seriePosterUrl = selectOnlineImageForSlot(onlineSerie, 'poster');

    if (!hasCustomSerieBuf && seriePortadaUrl) {
      try {
        const imgRes = await fetch(seriePortadaUrl);
        if (imgRes.ok) {
          const arr = await imgRes.arrayBuffer();
          if (arr.byteLength > 200) {
            finalSerieCoverBuf = Buffer.from(arr);
            finalSerieCoverUrl = seriePortadaUrl;
          }
        }
      } catch {
        // Fallback to provided coverBuffer
      }
    }
    if (!hasCustomSerieBuf && seriePosterUrl) {
      if (seriePosterUrl === seriePortadaUrl && finalSerieCoverBuf.byteLength > 200) {
        finalSeriePosterBuf = finalSerieCoverBuf;
      } else {
        try {
          const pRes = await fetch(seriePosterUrl);
          if (pRes.ok) {
            const pArr = await pRes.arrayBuffer();
            if (pArr.byteLength > 200) {
              finalSeriePosterBuf = Buffer.from(pArr);
              if (!finalSerieCoverUrl) finalSerieCoverUrl = seriePosterUrl;
            }
          }
        } catch {
          finalSeriePosterBuf = finalSerieCoverBuf;
        }
      }
    }
    if (!finalSeriePosterBuf || finalSeriePosterBuf.byteLength < 200) {
      finalSeriePosterBuf = finalSerieCoverBuf;
    }

    const genreIds = resolveGenreIds(
      meta.genero_ids || meta.genero_id || meta.genero || onlineSerie?.genero
    );
    const primaryGenre = genreIds[0] || 5;

    const serieSynopsis = sanitizePublicPictaText(
      String(
        (meta.sinopsis && !isGenericAutoSynopsis(String(meta.sinopsis)))
          ? meta.sinopsis
          : onlineSerie?.synopsis ||
            `Serie ${cleanSerieDisplayName(cleanSerieName)} disponible en ${effectiveChanLabel}.`
      )
    );

    const sForm = new FormData();
    sForm.append('nombre', cleanSerieName);
    sForm.append('canal', effectiveChanId);
    sForm.append('sinopsis', serieSynopsis);
    sForm.append('clasificacion', botConfig.pictaClasificacion || '18+');
    sForm.append('ano', String(meta.ano || onlineSerie?.year || new Date().getFullYear()));
    sForm.append('pais', String(meta.pais || onlineSerie?.pais || 'Estados Unidos'));
    sForm.append('genero', String(primaryGenre));
    sForm.append('director', '1022');
    sForm.append('reparto', '646');
    sForm.append('productora', '679');
    sForm.append('cantidad_temporadas', String(Math.max(1, targetNum)));
    sForm.append('cantidad_capitulos', '10');
    sForm.append(
      'url_imagen',
      new Blob([new Uint8Array(finalSerieCoverBuf)], { type: 'image/jpeg' }),
      `cover_serie_${Date.now()}.jpg`
    );
    sForm.append(
      'imagen_secundaria',
      new Blob([new Uint8Array(finalSeriePosterBuf)], { type: 'image/jpeg' }),
      `poster_serie_${Date.now()}.jpg`
    );

    const createSerieRes = await fetchPictaWithRetry('https://api.picta.cu/v1/serie/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: sForm,
    });

    if (!createSerieRes.ok) {
      const errText = await createSerieRes.text();
      throw new Error(
        `Fallo al registrar la serie "${cleanSerieName}" en Picta: ${formatPictaError(
          createSerieRes.status,
          errText
        )}`
      );
    }

    const createdSerieData = (await createSerieRes.json()) as any;
    pelserId = Number(createdSerieData.pelser_id || createdSerieData.id);
    const createdCoverUrl = String(
      createdSerieData.url_imagen || createdSerieData.imagen_secundaria || finalSerieCoverUrl || ''
    ).trim();
    upsertChannelSerieRecord(pelserId, cleanSerieName, undefined, {
      ...(createdCoverUrl ? { coverUrl: createdCoverUrl } : {}),
      canalId: effectiveChanNum,
    });
    addLiveLog(
      'picta',
      'success',
      `Serie "${cleanSerieName}" creada exitosamente en canal #${effectiveChanId} (ID: ${pelserId}).`
    );
  }

  // 5. Create Temporada for this Serie
  addLiveLog(
    'picta',
    'info',
    `Creando Temporada ${targetNum} para serie "${cleanSerieName}" (pelser_id: ${pelserId})...`
  );

  const tForm = new FormData();
  tForm.append('nombre', `Temporada ${targetNum}`);
  tForm.append('numero', String(targetNum));
  tForm.append('serie', String(pelserId));
  tForm.append('canal', effectiveChanId);
  tForm.append('cantidad_capitulos', '10');

  const createTempRes = await fetchPictaWithRetry('https://api.picta.cu/v1/temporada/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: tForm,
  });

  if (!createTempRes.ok) {
    const errText = await createTempRes.text();
    throw new Error(
      `Fallo al crear la Temporada ${targetNum} en Picta: ${formatPictaError(
        createTempRes.status,
        errText
      )}`
    );
  }

  const createdTempData = (await createTempRes.json()) as any;
  const newTempId = Number(createdTempData.id);
  upsertChannelSerieRecord(
    pelserId,
    cleanSerieName,
    {
      id: newTempId,
      numero: targetNum,
      nombre: `Temporada ${targetNum}`,
    },
    { canalId: effectiveChanNum }
  );
  addLiveLog(
    'picta',
    'success',
    `Temporada ${targetNum} creada exitosamente (ID: ${newTempId}) para la serie "${cleanSerieName}".`
  );
  return newTempId;
}

function parseUserManualMetadata(
  text: string,
  tipId: number
): { title: string; synopsis?: string; meta: Record<string, string> } {
  const meta: Record<string, string> = {};
  let title = '';
  let synopsis = '';

  const norm = (s: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const kvLines = lines.filter((l) => /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+:\s*.+$/.test(l));

  if (kvLines.length >= 2 || (lines.length === 1 && /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+:\s*.+$/.test(lines[0]))) {
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const rawKey = norm(line.slice(0, idx));
      const val = line.slice(idx + 1).trim();
      if (!val) continue;

      if (rawKey === 'titulo' || rawKey === 'title' || rawKey === 'nombre') title = val;
      else if (rawKey === 'sinopsis' || rawKey === 'descripcion') synopsis = val;
      else if (rawKey === 'ano' || rawKey === 'year' || rawKey === 'estreno') meta.ano = val;
      else if (rawKey === 'genero' || rawKey === 'genre') meta.genero = val;
      else if (rawKey === 'director' || rawKey === 'direccion') meta.director = val;
      else if (rawKey === 'pais' || rawKey === 'country') meta.pais = val;
      else if (rawKey === 'guion') meta.guion = val;
      else if (rawKey === 'reparto' || rawKey === 'actores') meta.reparto = val;
      else if (rawKey === 'musica') meta.musica = val;
      else if (rawKey === 'fotografia') meta.fotografia = val;
      else if (rawKey === 'productora' || rawKey === 'estudio') meta.productora = val;
      else if (rawKey === 'premio' || rawKey === 'premios') meta.premio = val;
      else if (rawKey === 'serie') meta.serie = val;
      else if (rawKey === 'temporada') meta.temporada = val;
      else if (rawKey === 'capitulo' || rawKey === 'numero' || rawKey === 'episodio') meta.numero = val;
      else if (rawKey === 'interprete' || rawKey === 'artista') meta.interprete = val;
      else if (rawKey === 'productor') meta.productor = val;
      else if (rawKey === 'sello') meta.sello = val;
      else if (rawKey === 'autor') meta.autor = val;
      else meta[rawKey] = val;
    }
    if (tipId === 5 && (meta.serie || title)) {
      title = formatSerieEpisodeTitle(meta.serie || title, meta.temporada, meta.numero);
    }
    return { title, synopsis: synopsis || undefined, meta };
  }

  if (text.includes('|')) {
    const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
    if (tipId === 5) {
      // Only treat '|' as Serie | Temporada | Capitulo if parts[1] is a pure number (e.g. "The Mentalist | 1 | 2")
      // Do NOT split bilingual titles like "S01E01: Pilot | Piloto"!
      if (parts.length >= 2 && /^\d{1,2}$/.test(parts[1])) {
        title = parts[0] || text;
        meta.temporada = parts[1];
        if (parts[2] && /^\d{1,3}$/.test(parts[2])) {
          meta.numero = parts[2];
        }
        meta.serie = title;
        title = formatSerieEpisodeTitle(meta.serie, meta.temporada, meta.numero);
        return { title, synopsis: undefined, meta };
      }
      return { title: text.trim(), synopsis: undefined, meta };
    } else {
      title = parts[0] || text;
      // Película o general
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        const np = norm(p);
        if (/^\d{4}$/.test(p)) {
          meta.ano = p;
        } else if (
          /^(accion|aventura|ciencia ficcion|sci-fi|drama|comedia|terror|animacion|suspenso|fantasia|documental|crimen|romance|belico|musical)$/.test(
            np
          )
        ) {
          meta.genero = p;
        } else if (
          /^(cuba|estados unidos|ee\.uu\.|eeuu|espana|mexico|japon|francia|reino unido|italia|alemania|canada|internacional)$/.test(
            np
          )
        ) {
          meta.pais = p;
        } else if (!meta.director) {
          meta.director = p;
        } else if (!meta.pais) {
          meta.pais = p;
        } else if (!meta.reparto) {
          meta.reparto = p;
        }
      }
    }
    return { title, synopsis: undefined, meta };
  }

  return { title: text.trim(), synopsis: undefined, meta };
}

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

async function generateVideoMetadataWithAI(
  fileName: string,
  caption: string,
  customTitle?: string,
  categoryName?: string,
  tipologiaId?: number,
  channelName?: string,
  knownSerieContext?: {
    serieName?: string;
    temporada?: string | number;
    numero?: string | number;
    episodeSubtitle?: string;
    inheritedStyle?: DetectedSeriesTitleStyle | null;
    preResolvedOnlineInfo?: OnlineMediaInfo | null;
  }
): Promise<{
  title: string;
  synopsis: string;
  tags: string[];
  modelMetadata?: Record<string, string | number | number[]>;
}> {
  const analyzedNaming = analyzeVideoTitleAndSynopsis(fileName, caption);
  const cleanName =
    analyzedNaming.initialTitle ||
    (!analyzedNaming.filenameIsRandom
      ? cleanGeneralVideoTitle(fileName)
      : '');
  const cat = categoryName || 'Audiovisual';
  const tipId = Number(tipologiaId || 8);
  const effectiveChannelName = (channelName && channelName.trim()) || 'tu canal de Picta';

  // Extract potential release year from file name or title
  const yearMatch = (customTitle || cleanName || caption).match(/\b(19\d\d|20\d\d)\b/);
  const fallbackYear = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

  const parsedFromText = analyzedNaming.seriesInfo;
  const overrideSerie = String(knownSerieContext?.serieName || '').trim();
  const mergedSerieName = !isGenericOrInvalidSerieName(overrideSerie)
    ? overrideSerie
    : parsedFromText.serieName;
  const mergedTemp = String(knownSerieContext?.temporada || parsedFromText.temporada || '1').replace(/\D/g, '') || '1';
  const mergedEp = String(knownSerieContext?.numero || parsedFromText.numero || '1').replace(/\D/g, '') || '1';
  const mergedSub = String(knownSerieContext?.episodeSubtitle || parsedFromText.episodeSubtitle || '').trim() || undefined;
  const inheritedStyle = knownSerieContext?.inheritedStyle || null;
  const extractedSerie = {
    serieName: mergedSerieName,
    temporada: mergedTemp,
    numero: mergedEp,
    episodeSubtitle: mergedSub,
    missingSerieName: isGenericOrInvalidSerieName(mergedSerieName),
    formattedTitle: inheritedStyle
      ? formatEpisodeWithSeriesStyle(inheritedStyle, {
          serieName: mergedSerieName,
          temporada: mergedTemp,
          numero: mergedEp,
          episodeSubtitle: mergedSub,
        })
      : formatSerieEpisodeTitle(mergedSerieName, mergedTemp, mergedEp, mergedSub),
  };

  const queryBase =
    tipId === 5 && !extractedSerie.missingSerieName
      ? extractedSerie.serieName
      : customTitle || cleanName;

  const onlineInfo = knownSerieContext?.preResolvedOnlineInfo
    ? knownSerieContext.preResolvedOnlineInfo
    : queryBase && !isRandomOrCrypticFilename(queryBase)
      ? await searchMovieOrSeriesInfoOnline(
          queryBase,
          tipId,
          extractedSerie.temporada,
          extractedSerie.numero
        ).catch(() => null)
      : null;

  try {
    const ai = getGeminiClient();

    let extraPrompt = '';
    if (onlineInfo && onlineInfo.found) {
      extraPrompt += `
INFORMACIÓN REAL VERIFICADA EN INTERNET:
- Título Oficial: ${onlineInfo.title}
${onlineInfo.originalTitle ? `- Título Original: ${onlineInfo.originalTitle}` : ''}
${onlineInfo.year ? `- Año: ${onlineInfo.year}` : ''}
${onlineInfo.director ? `- Director / Realizador: ${onlineInfo.director}` : ''}
${onlineInfo.guion ? `- Guión / Escritor: ${onlineInfo.guion}` : ''}
${onlineInfo.productora ? `- Productora / Estudio: ${onlineInfo.productora}` : ''}
${onlineInfo.reparto ? `- Reparto / Actores: ${onlineInfo.reparto}` : ''}
${onlineInfo.pais ? `- País: ${onlineInfo.pais}` : ''}
${onlineInfo.genero ? `- Género: ${onlineInfo.genero}` : ''}
${onlineInfo.musica ? `- Música: ${onlineInfo.musica}` : ''}
${onlineInfo.fotografia ? `- Fotografía: ${onlineInfo.fotografia}` : ''}
${onlineInfo.episodeTitle ? `- Título del episodio (T${extractedSerie.temporada}:E${extractedSerie.numero}): ${onlineInfo.episodeTitle}` : ''}
${onlineInfo.episodeSynopsis ? `- Sinopsis real del episodio: ${onlineInfo.episodeSynopsis}` : ''}
${onlineInfo.synopsis ? `- Sinopsis general de la obra: ${onlineInfo.synopsis}` : ''}
IMPORTANTE: Usa obligatoriamente estos datos canónicos verificados en internet para redactar una sinopsis en español fiel y completar la ficha técnica con exactitud.`;
    }
    let responseSchemaProperties: Record<string, any> = {
      title: { type: Type.STRING },
      synopsis: { type: Type.STRING },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    };
    let requiredFields = ['title', 'synopsis', 'tags'];

    if (tipId === 1) {
      // Película: Picta strictly requires these 10 fields + imagen_secundaria
      extraPrompt += `
IMPORTANTE - FICHA CINEMATOGRÁFICA OBLIGATORIA (Picta exige estos 10 campos estrictos):
1. ano: año de estreno de la película (ej: "${onlineInfo?.year || fallbackYear}").
2. pais: país de origen (ej: "Estados Unidos", "Japón", "España", "Cuba").
3. genero: géneros principales separados por coma (ej: "Aventura, Acción, Fantasía").
4. productora: estudio productor o distribuidor (ej: "Warner Bros", "Marvel Studios").
5. director: realizador o director principal.
6. guion: guionista o autor de la historia.
7. musica: compositor o banda sonora.
8. fotografia: cinematografía / dirección de fotografía.
9. reparto: actores principales destacados.
10. premio: premios notables o "Ninguno".`;

      responseSchemaProperties = {
        ...responseSchemaProperties,
        ano: { type: Type.STRING },
        pais: { type: Type.STRING },
        genero: { type: Type.STRING },
        productora: { type: Type.STRING },
        director: { type: Type.STRING },
        guion: { type: Type.STRING },
        musica: { type: Type.STRING },
        fotografia: { type: Type.STRING },
        reparto: { type: Type.STRING },
        premio: { type: Type.STRING },
      };
      requiredFields = [
        ...requiredFields,
        'ano',
        'pais',
        'genero',
        'productora',
        'director',
        'guion',
        'musica',
        'fotografia',
        'reparto',
        'premio',
      ];
    } else if (tipId === 2) {
      // Documental: pais y productora
      extraPrompt += `
IMPORTANTE - FICHA DOCUMENTAL (Picta exige estos campos):
1. pais: país de origen del documental.
2. productora: productora del documental o institución realizadora.`;

      responseSchemaProperties = {
        ...responseSchemaProperties,
        pais: { type: Type.STRING },
        productora: { type: Type.STRING },
      };
      requiredFields = [...requiredFields, 'pais', 'productora'];
    } else if (tipId === 5) {
      // Serie: serie, temporada, numero
      extraPrompt += `
IMPORTANTE - FICHA DE SERIE (Picta exige estos campos):
1. serie: nombre de la serie general (sin número de capítulo).
2. temporada: número de temporada como número entero en texto (ej: "${extractedSerie.temporada || '1'}").
3. numero: número de capítulo o episodio como número entero en texto (ej: "${extractedSerie.numero || '1'}").
4. synopsis: redacta en español la sinopsis real de este episodio o de la serie (NUNCA escribas solo "Capítulo X de la Temporada Y disponible en ${effectiveChannelName}", escribe de qué trata realmente la trama).`;

      responseSchemaProperties = {
        ...responseSchemaProperties,
        serie: { type: Type.STRING },
        temporada: { type: Type.STRING },
        numero: { type: Type.STRING },
      };
      requiredFields = [...requiredFields, 'serie', 'temporada', 'numero'];
    } else if (tipId === 3 || tipId === 14) {
      // Video Musical / Deporte (modelo: video, schema: gr)
      extraPrompt += `
IMPORTANTE - FICHA DE ${tipId === 14 ? 'DEPORTE' : 'VIDEO MUSICAL'} (Picta exige estos campos):
1. ano: año del video o evento deportivo (ej: "${fallbackYear}").
2. genero: género musical o disciplina deportiva (ej: "${tipId === 14 ? 'Fútbol, Deporte' : 'Pop, Música'}").
3. interprete: intérprete principal, banda o deportistas/equipos destacados.
4. director: realizador o director audiovisual.
5. productor: productor o canal productor.`;

      responseSchemaProperties = {
        ...responseSchemaProperties,
        ano: { type: Type.STRING },
        genero: { type: Type.STRING },
        interprete: { type: Type.STRING },
        director: { type: Type.STRING },
        productor: { type: Type.STRING },
      };
      requiredFields = [...requiredFields, 'ano', 'genero', 'interprete', 'director', 'productor'];
    } else if (tipId === 11) {
      // Videoclip (modelo: videoclip, schema: Gd)
      const todayYmd = new Date().toISOString().split('T')[0];
      extraPrompt += `
IMPORTANTE - FICHA DE VIDEOCLIP (Picta exige estos campos):
1. ano: año de lanzamiento (ej: "${fallbackYear}").
2. genero: género musical del tema.
3. interprete: cantante, grupo o artista musical principal.
4. director: realizador o director del videoclip.
5. release_date: fecha de estreno en formato YYYY-MM-DD (ej: "${todayYmd}").
6. sale_start_date: fecha de venta en formato YYYY-MM-DD (ej: "${todayYmd}").
7. sello: sello discográfico o "Independiente".`;

      responseSchemaProperties = {
        ...responseSchemaProperties,
        ano: { type: Type.STRING },
        genero: { type: Type.STRING },
        interprete: { type: Type.STRING },
        director: { type: Type.STRING },
        release_date: { type: Type.STRING },
        sale_start_date: { type: Type.STRING },
        sello: { type: Type.STRING },
      };
      requiredFields = [
        ...requiredFields,
        'ano',
        'genero',
        'interprete',
        'director',
        'release_date',
        'sale_start_date',
        'sello',
      ];
    } else if (tipId === 6) {
      // Curso (modelo: curso, schema: Ud)
      extraPrompt += `
IMPORTANTE - FICHA DE CURSO (Picta exige estos campos):
1. temporada: número de módulo, nivel o temporada del curso como número en texto (ej: "1").`;

      responseSchemaProperties = {
        ...responseSchemaProperties,
        temporada: { type: Type.STRING },
      };
      requiredFields = [...requiredFields, 'temporada'];
    }

    const prompt = customTitle
      ? `El usuario va a subir un video a su canal ${effectiveChannelName} en Picta con el título: "${customTitle}".
Categoría seleccionada: "${cat}" (Tipología ID: ${tipId}).
Archivo: "${fileName}". Notas adicionales: "${caption || 'Ninguna'}".
Busca tu conocimiento sobre esta película/serie/video y usa la información verificada en línea para generar una sinopsis real y atractiva en español (entre 160 y 480 caracteres) y de 3 a 5 etiquetas relevantes.${extraPrompt}`
      : `El usuario envió un video por Telegram para su canal ${effectiveChannelName} en Picta y pidió autorrellenar sus datos.
Categoría seleccionada: "${cat}" (Tipología ID: ${tipId}).
Archivo: "${fileName}" (${cleanName}). Notas adicionales: "${caption || 'Sin descripción'}".
Usa tu conocimiento y la información verificada en internet para generar el título oficial en español, una sinopsis real y atractiva en español (entre 160 y 480 caracteres) y de 3 a 5 etiquetas.${extraPrompt}`;

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            `Eres un asistente editorial y catalogador experto en cine, series y televisión para el canal ${effectiveChannelName} en Picta (Cuba). Conoces a fondo las películas, series, actores, directores y argumentos reales, así como las reglas de metadatos de Picta. Responde siempre con JSON estricto 100% en español (jamás en inglés) completando todos los campos requeridos con datos verídicos.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: responseSchemaProperties,
            required: requiredFields,
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout IA 12s')), 12000)
      ),
    ]);

    const parsed = JSON.parse((response.text ?? '{}').trim());
    let resultTitle = customTitle || parsed.title || onlineInfo?.title || cleanName || `Video en ${effectiveChannelName} (${cat})`;
    if (tipId === 5 && !customTitle) {
      const sName = String(
        !extractedSerie.missingSerieName
          ? extractedSerie.serieName
          : !isGenericOrInvalidSerieName(parsed.serie)
            ? parsed.serie
            : onlineInfo?.title || 'Serie'
      );
      const sSeason = String(extractedSerie.temporada || parsed.temporada || '1');
      const sEp = String(extractedSerie.numero || parsed.numero || '1');
      const sSub = extractedSerie.episodeSubtitle || onlineInfo?.episodeTitle;
      resultTitle = inheritedStyle
        ? formatEpisodeWithSeriesStyle(inheritedStyle, {
            serieName: sName,
            temporada: sSeason,
            numero: sEp,
            episodeSubtitle: sSub,
          })
        : formatSerieEpisodeTitle(sName, sSeason, sEp, sSub);
    }
    const aiSpanishSynopsis = parsed.synopsis
      ? await translateTextToSpanishIfNeeded(String(parsed.synopsis))
      : '';
    const resultSynopsis = sanitizePublicPictaText(
      aiSpanishSynopsis ||
        onlineInfo?.episodeSynopsis ||
        onlineInfo?.synopsis ||
        (tipId === 5
          ? `Capítulo ${extractedSerie.numero} de la Temporada ${extractedSerie.temporada} de la serie ${cleanSerieDisplayName(extractedSerie.serieName) || 'la serie'}${extractedSerie.episodeSubtitle ? ` ("${extractedSerie.episodeSubtitle}")` : ''}, disponible en el canal ${effectiveChannelName}.`
          : `${resultTitle}. Publicado en la categoría ${cat} del canal ${effectiveChannelName} en Picta.`)
    ).slice(0, 580);
    const resultTags = Array.isArray(parsed.tags) && parsed.tags.length > 0
      ? parsed.tags.slice(0, 5)
      : ['Picta', cat, effectiveChannelName];

    const modelMetadata: Record<string, string | number | number[]> = {};
    if (tipId === 1) {
      modelMetadata.ano = String(parsed.ano || onlineInfo?.year || fallbackYear);
      if (onlineInfo?.rating) {
        modelMetadata.calificacion = String(onlineInfo.rating);
      }
      modelMetadata.pais = String(parsed.pais || onlineInfo?.pais || 'Internacional');
      const rawGenreStr = String(parsed.genero || onlineInfo?.genero || 'Acción, Aventura');
      modelMetadata.genero_ids = resolveGenreIds(rawGenreStr);
      modelMetadata.genero = rawGenreStr;
      modelMetadata.productora = String(parsed.productora || onlineInfo?.productora || 'Producción Audiovisual');
      modelMetadata.director = String(parsed.director || onlineInfo?.director || 'Dirección General');
      modelMetadata.guion = String(parsed.guion || onlineInfo?.guion || parsed.director || 'Guión Original');
      modelMetadata.musica = String(parsed.musica || onlineInfo?.musica || 'Banda Sonora Original');
      modelMetadata.fotografia = String(parsed.fotografia || onlineInfo?.fotografia || 'Cinematografía Digital');
      modelMetadata.reparto = String(parsed.reparto || onlineInfo?.reparto || 'Elenco Principal');
    } else if (tipId === 2) {
      modelMetadata.pais = String(parsed.pais || onlineInfo?.pais || 'Cuba / Internacional');
      modelMetadata.productora = String(parsed.productora || onlineInfo?.productora || effectiveChannelName);
    } else if (tipId === 5) {
      modelMetadata.serie = String(
        !extractedSerie.missingSerieName
          ? extractedSerie.serieName
          : !isGenericOrInvalidSerieName(parsed.serie)
            ? parsed.serie
            : onlineInfo?.title || 'Serie'
      );
      modelMetadata.temporada = String(extractedSerie.temporada || parsed.temporada || '1');
      modelMetadata.numero = String(extractedSerie.numero || parsed.numero || '1');
      if (extractedSerie.episodeSubtitle || onlineInfo?.episodeTitle) {
        modelMetadata.episodeSubtitle = String(extractedSerie.episodeSubtitle || onlineInfo?.episodeTitle);
      }
    } else if (tipId === 3 || tipId === 14) {
      modelMetadata.ano = String(parsed.ano || onlineInfo?.year || fallbackYear);
      modelMetadata.genero = String(parsed.genero || onlineInfo?.genero || (tipId === 14 ? 'Deporte' : 'Música'));
      modelMetadata.interprete = String(parsed.interprete || onlineInfo?.reparto || (tipId === 14 ? 'Deportistas' : 'Artista Principal'));
      modelMetadata.director = String(parsed.director || onlineInfo?.director || 'Dirección Audiovisual');
      modelMetadata.productor = String(parsed.productor || onlineInfo?.productora || `Producción ${effectiveChannelName}`);
    } else if (tipId === 11) {
      const todayYmd = new Date().toISOString().split('T')[0];
      modelMetadata.ano = String(parsed.ano || onlineInfo?.year || fallbackYear);
      modelMetadata.genero = String(parsed.genero || onlineInfo?.genero || 'Música, Videoclip');
      modelMetadata.interprete = String(parsed.interprete || onlineInfo?.reparto || 'Artista');
      modelMetadata.director = String(parsed.director || onlineInfo?.director || 'Dirección de Videoclip');
      modelMetadata.release_date = String(parsed.release_date || todayYmd);
      modelMetadata.sale_start_date = String(parsed.sale_start_date || todayYmd);
      modelMetadata.sello = String(parsed.sello || onlineInfo?.productora || 'Independiente');
    } else if (tipId === 6) {
      modelMetadata.temporada = String(parsed.temporada || '1');
    }
    if (onlineInfo?.imageUrl) {
      modelMetadata.onlineCoverUrl = onlineInfo.imageUrl;
    }
    if (onlineInfo?.posterUrl) {
      modelMetadata.onlinePosterUrl = onlineInfo.posterUrl;
    }
    if (onlineInfo?.backdropUrl) {
      modelMetadata.onlineBackdropUrl = onlineInfo.backdropUrl;
    }

    return {
      title: resultTitle,
      synopsis: resultSynopsis,
      tags: resultTags,
      modelMetadata: Object.keys(modelMetadata).length > 0 ? modelMetadata : undefined,
    };
  } catch {
    let fallbackTitle =
      customTitle ||
      (cleanName && !/^(VID|MOV|DOC|video)[_\-\d]*$/i.test(cleanName)
        ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1)
        : `Estreno en ${effectiveChannelName} (${cat}) — ${new Date().toLocaleDateString('es-CU')}`);

    if (tipId === 5 && !customTitle) {
      const cleanSerie = !extractedSerie.missingSerieName
        ? extractedSerie.serieName
        : onlineInfo?.title || 'Serie';
      const sSub = extractedSerie.episodeSubtitle || onlineInfo?.episodeTitle;
      fallbackTitle = inheritedStyle
        ? formatEpisodeWithSeriesStyle(inheritedStyle, {
            serieName: cleanSerie,
            temporada: extractedSerie.temporada,
            numero: extractedSerie.numero,
            episodeSubtitle: sSub,
          })
        : formatSerieEpisodeTitle(
            cleanSerie,
            extractedSerie.temporada,
            extractedSerie.numero,
            sSub
          );
    }

    const fallbackMeta: Record<string, string | number | number[]> = {};
    const todayYmd = new Date().toISOString().split('T')[0];

    if (tipId === 1) {
      fallbackMeta.ano = (onlineInfo && onlineInfo.year) || fallbackYear;
      if (onlineInfo?.rating) {
        fallbackMeta.calificacion = String(onlineInfo.rating);
      }
      fallbackMeta.pais = (onlineInfo && onlineInfo.pais) || 'Internacional';
      const rawGen = (onlineInfo && onlineInfo.genero) || 'Acción, Aventura, Fantasía';
      fallbackMeta.genero = rawGen;
      fallbackMeta.genero_ids = resolveGenreIds(rawGen);
      fallbackMeta.productora = (onlineInfo && onlineInfo.productora) || 'Producción Audiovisual';
      fallbackMeta.director = (onlineInfo && onlineInfo.director) || 'Dirección General';
      fallbackMeta.guion = (onlineInfo && (onlineInfo.guion || onlineInfo.director)) || 'Guión Original';
      fallbackMeta.musica = (onlineInfo && onlineInfo.musica) || 'Banda Sonora Original';
      fallbackMeta.fotografia = (onlineInfo && onlineInfo.fotografia) || 'Cinematografía Digital';
      fallbackMeta.reparto = (onlineInfo && onlineInfo.reparto) || 'Elenco Principal / Doblaje';
    } else if (tipId === 2) {
      fallbackMeta.pais = (onlineInfo && onlineInfo.pais) || 'Internacional';
      fallbackMeta.productora = (onlineInfo && onlineInfo.productora) || `${effectiveChannelName} Producciones`;
    } else if (tipId === 5) {
      fallbackMeta.serie = !extractedSerie.missingSerieName ? extractedSerie.serieName : (onlineInfo?.title || 'Serie');
      fallbackMeta.temporada = extractedSerie.temporada || '1';
      fallbackMeta.numero = extractedSerie.numero || '1';
      if (extractedSerie.episodeSubtitle || onlineInfo?.episodeTitle) {
        fallbackMeta.episodeSubtitle = String(extractedSerie.episodeSubtitle || onlineInfo?.episodeTitle);
      }
    } else if (tipId === 3 || tipId === 14) {
      fallbackMeta.ano = (onlineInfo && onlineInfo.year) || fallbackYear;
      fallbackMeta.genero = (onlineInfo && onlineInfo.genero) || (tipId === 14 ? 'Deporte' : 'Música');
      fallbackMeta.interprete = (onlineInfo && onlineInfo.reparto) || (tipId === 14 ? 'Deportistas' : 'Artista Principal');
      fallbackMeta.director = (onlineInfo && onlineInfo.director) || 'Dirección Audiovisual';
      fallbackMeta.productor = (onlineInfo && onlineInfo.productora) || `Producción ${effectiveChannelName}`;
    } else if (tipId === 11) {
      fallbackMeta.ano = (onlineInfo && onlineInfo.year) || fallbackYear;
      fallbackMeta.genero = (onlineInfo && onlineInfo.genero) || 'Música, Videoclip';
      fallbackMeta.interprete = (onlineInfo && onlineInfo.reparto) || 'Artista';
      fallbackMeta.director = (onlineInfo && onlineInfo.director) || 'Dirección de Videoclip';
      fallbackMeta.release_date = todayYmd;
      fallbackMeta.sale_start_date = todayYmd;
      fallbackMeta.sello = (onlineInfo && onlineInfo.productora) || 'Independiente';
    } else if (tipId === 6) {
      fallbackMeta.temporada = '1';
    }
    if (onlineInfo?.imageUrl) {
      fallbackMeta.onlineCoverUrl = onlineInfo.imageUrl;
    }
    if (onlineInfo?.posterUrl) {
      fallbackMeta.onlinePosterUrl = onlineInfo.posterUrl;
    }
    if (onlineInfo?.backdropUrl) {
      fallbackMeta.onlineBackdropUrl = onlineInfo.backdropUrl;
    }

    const fallbackSynopsis = sanitizePublicPictaText(
      onlineInfo?.episodeSynopsis
        ? onlineInfo.episodeSynopsis
        : onlineInfo?.synopsis
          ? onlineInfo.synopsis
          : tipId === 5
            ? `Capítulo ${extractedSerie.numero || '1'} de la Temporada ${extractedSerie.temporada || '1'} de la serie ${!extractedSerie.missingSerieName ? cleanSerieDisplayName(extractedSerie.serieName) : 'en emisión'}${extractedSerie.episodeSubtitle ? ` titulado "${extractedSerie.episodeSubtitle}"` : ''}, disponible completo en el canal ${effectiveChannelName}.`
            : `${fallbackTitle}. Contenido de ${cat} completo publicado en el canal ${effectiveChannelName} de Picta.`
    );

    return {
      title: (onlineInfo && onlineInfo.title && !customTitle && tipId !== 5) ? onlineInfo.title : fallbackTitle,
      synopsis: fallbackSynopsis.slice(0, 580),
      tags: ['Picta', effectiveChannelName, cat],
      modelMetadata: Object.keys(fallbackMeta).length > 0 ? fallbackMeta : undefined,
    };
  }
}

async function callTelegramBotApi(
  method: string,
  payload: Record<string, unknown> = {}
): Promise<any> {
  const token = botConfig.telegramBotToken.trim();
  const timeoutMs = method === 'getUpdates' ? 25_000 : 15_000;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json()) as any;
  if (!data.ok) {
    throw new Error(data.description || `Error en Telegram API (${method})`);
  }
  return data.result;
}

function stripTelegramHtmlForFallback(htmlText: string): string {
  return String(htmlText || '')
    .replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|a|tg-spoiler)(?:\s+[^>]*)?>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .slice(0, 3950);
}

async function sendTelegramStatusMessage(
  chatId: string,
  text: string,
  replyToMessageId?: number,
  inlineKeyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>
): Promise<number | null> {
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text.length > 4090 ? `${text.slice(0, 4050)}...` : text,
      parse_mode: 'HTML',
    };
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }
    if (inlineKeyboard) {
      payload.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    const sent = await callTelegramBotApi('sendMessage', payload);
    return sent?.message_id || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLiveLog('telegram', 'warn', `Aviso enviando mensaje a Telegram: ${msg}`);
    if (/can't parse entities|parse_mode|too long/i.test(msg)) {
      try {
        const fallbackPayload: Record<string, unknown> = {
          chat_id: chatId,
          text: stripTelegramHtmlForFallback(text),
        };
        if (replyToMessageId) fallbackPayload.reply_to_message_id = replyToMessageId;
        if (inlineKeyboard) fallbackPayload.reply_markup = { inline_keyboard: inlineKeyboard };
        const sentFallback = await callTelegramBotApi('sendMessage', fallbackPayload);
        return sentFallback?.message_id || null;
      } catch {
        // Ignore fallback failure
      }
    }
    return null;
  }
}

let lastTelegramEditTime = 0;

async function editTelegramStatusMessage(
  chatId: string,
  messageId: number | null | undefined,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>,
  force = false
): Promise<void> {
  if (!messageId) return;
  const now = Date.now();
  if (!force && now - lastTelegramEditTime < 2500) {
    return;
  }
  lastTelegramEditTime = now;
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: text.length > 4090 ? `${text.slice(0, 4050)}...` : text,
      parse_mode: 'HTML',
    };
    if (inlineKeyboard) {
      payload.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    await callTelegramBotApi('editMessageText', payload);
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (!msg.includes('message is not modified')) {
      addLiveLog('telegram', 'warn', `Aviso editando mensaje #${messageId}: ${msg}`);
      if (/can't parse entities|parse_mode|too long/i.test(msg)) {
        try {
          const fallbackPayload: Record<string, unknown> = {
            chat_id: chatId,
            message_id: messageId,
            text: stripTelegramHtmlForFallback(text),
          };
          if (inlineKeyboard) fallbackPayload.reply_markup = { inline_keyboard: inlineKeyboard };
          await callTelegramBotApi('editMessageText', fallbackPayload);
        } catch {
          // Ignore fallback failure
        }
      }
    }
  }
}

async function sendTelegramPhotoWithKeyboard(params: {
  targetChatId: string;
  captionHtml: string;
  fallbackTextHtml: string;
  inlineKeyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
  photoUrl?: string;
  photoBuffer?: Buffer | null;
}): Promise<{ ok: boolean; messageId: number | null; viaFallbackText?: boolean; error?: string }> {
  const token = botConfig.telegramBotToken.trim();
  if (!token) return { ok: false, messageId: null, error: 'Bot token vacío' };

  const replyMarkup = params.inlineKeyboard ? { inline_keyboard: params.inlineKeyboard } : undefined;
  const safeCaption =
    params.captionHtml.length > 1024 ? params.captionHtml.slice(0, 1020) : params.captionHtml;

  // 1. Try sending directly by HTTPS URL if provided
  if (params.photoUrl && /^https?:\/\//i.test(params.photoUrl)) {
    try {
      const payload: Record<string, unknown> = {
        chat_id: params.targetChatId,
        photo: params.photoUrl,
        caption: safeCaption,
        parse_mode: 'HTML',
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      const sent = await callTelegramBotApi('sendPhoto', payload);
      return { ok: true, messageId: sent?.message_id || null };
    } catch {
      // Fallback to downloading or multipart buffer below
    }
  }

  // 2. Try multipart FormData with Buffer (either pre-provided or downloaded from photoUrl)
  let buf = params.photoBuffer || null;
  if (!buf && params.photoUrl && /^https?:\/\//i.test(params.photoUrl)) {
    try {
      const r = await fetch(params.photoUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const arr = await r.arrayBuffer();
        if (arr.byteLength > 200) buf = Buffer.from(arr);
      }
    } catch {
      // Fallback to text message
    }
  }

  if (buf && buf.byteLength > 200) {
    try {
      const form = new FormData();
      form.append('chat_id', params.targetChatId);
      form.append('photo', new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }), 'poster.jpg');
      form.append('caption', safeCaption);
      form.append('parse_mode', 'HTML');
      if (replyMarkup) {
        form.append('reply_markup', JSON.stringify(replyMarkup));
      }
      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json()) as any;
      if (json?.ok) {
        return { ok: true, messageId: json.result?.message_id || null };
      }
    } catch {
      // Fallback to text message
    }
  }

  // 3. Last safe fallback: sendMessage HTML (or plain text if parse_mode fails)
  try {
    const msgId = await sendTelegramStatusMessage(
      params.targetChatId,
      params.fallbackTextHtml,
      undefined,
      params.inlineKeyboard
    );
    if (msgId) {
      return { ok: true, messageId: msgId, viaFallbackText: true };
    }
    return { ok: false, messageId: null, error: 'Telegram no permitió enviar el mensaje al canal.' };
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let mtprotoConnectingPromise: Promise<TelegramClient | null> | null = null;

async function ensureMtprotoClient(): Promise<TelegramClient | null> {
  const token = botConfig.telegramBotToken.trim();
  const apiId = Number(botConfig.telegramApiId.trim());
  const apiHash = botConfig.telegramApiHash.trim();

  if (!token || !apiId || !apiHash || Number.isNaN(apiId)) {
    mtprotoConnected = false;
    return null;
  }

  if (mtprotoClient && mtprotoConnected) {
    return mtprotoClient;
  }

  if (mtprotoFloodWaitUntilMs > Date.now()) {
    return null;
  }

  if (mtprotoConnectingPromise) {
    return mtprotoConnectingPromise;
  }

  mtprotoConnectingPromise = (async () => {
    try {
      await ensureMtprotoVaultLoadedOnce();
      if (!mtprotoSessionString) {
        mtprotoSessionString = loadMtprotoSessionFromDisk();
      }
      let client: TelegramClient | null = null;
      let connectedSuccessfully = false;

      const hasSavedSession = Boolean(mtprotoSessionString.trim());
      if (hasSavedSession) {
        try {
          const session = new StringSession(mtprotoSessionString);
          const savedClient = new TelegramClient(session, apiId, apiHash, {
            connectionRetries: 5,
            networkSocket: FastPromisedNetSockets as any,
          });
          await savedClient.connect();
          const authorized = await savedClient.isUserAuthorized();
          if (!authorized) {
            await savedClient.start({ botAuthToken: token });
          }
          client = savedClient;
          connectedSuccessfully = true;
        } catch (savedErr) {
          addLiveLog(
            'mtproto',
            'warn',
            `Sesión MTProto previa no válida (${
              savedErr instanceof Error ? savedErr.message : String(savedErr)
            }). Creando sesión limpia con botAuthToken...`
          );
          mtprotoSessionString = '';
          try {
            const sPath = path.join(STATE_DIR, 'mtproto_session.txt');
            if (fs.existsSync(sPath)) fs.unlinkSync(sPath);
          } catch {
            // Ignore
          }
        }
      }

      if (!connectedSuccessfully || !client) {
        const freshSession = new StringSession('');
        const freshClient = new TelegramClient(freshSession, apiId, apiHash, {
          connectionRetries: 5,
          networkSocket: FastPromisedNetSockets as any,
        });
        await freshClient.start({ botAuthToken: token });
        client = freshClient;
      }

      const savedStr = (client.session.save() as unknown as string) || '';
      if (savedStr) {
        mtprotoSessionString = savedStr;
        saveMtprotoSessionToDisk(savedStr);
        scheduleSaveMtprotoVaultToTelegram();
      }

      mtprotoClient = client;
      mtprotoConnected = true;
      mtprotoFloodWaitUntilMs = 0;
      addMtprotoDiagLog({
        level: 'success',
        dcId: Number((client.session as any)?.dcId) || undefined,
        message: 'Cliente MTProto 4 GB conectado y listo para transferencias a máxima velocidad.',
      });
      if (!IS_PREVIEW_INSTANCE) {
        void prewarmAuxiliaryBotClientsInBackground();
      }
      return client;
    } catch (err) {
      mtprotoConnected = false;
      const msg = err instanceof Error ? err.message : String(err);
      const waitMatch = msg.match(/wait of (\d+) seconds/i);
      if (waitMatch) {
        const waitSec = Number(waitMatch[1]) || 60;
        mtprotoFloodWaitUntilMs = Date.now() + (waitSec + 2) * 1000;
        addLiveLog(
          'mtproto',
          'warn',
          `Telegram DC solicitó esperar ${waitSec}s antes de abrir sesión MTProto.`
        );
      } else {
        addLiveLog('mtproto', 'error', `Error conectando MTProto 2 GB: ${msg}`);
      }
      return null;
    } finally {
      mtprotoConnectingPromise = null;
    }
  })();

  return mtprotoConnectingPromise;
}

const MTPROTO_AUX_SESSIONS_FILE = path.join(STATE_DIR, 'mtproto_aux_sessions.json');
const auxiliaryBotClients = new Map<number, TelegramClient>();
const auxiliaryBotConnecting = new Map<number, Promise<TelegramClient | null>>();
let auxiliaryBotSessionsCache: string[] | null = null;
let mtprotoAuxFloodWaitUntilMs = 0;

function loadAuxiliaryBotSessionsFromDisk(): string[] {
  if (auxiliaryBotSessionsCache) return auxiliaryBotSessionsCache;
  try {
    if (fs.existsSync(MTPROTO_AUX_SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MTPROTO_AUX_SESSIONS_FILE, 'utf-8'));
      if (Array.isArray(parsed?.sessions)) {
        const loaded: string[] = parsed.sessions.map((s: any) => String(s || '').trim());
        auxiliaryBotSessionsCache = loaded;
        return loaded;
      }
    }
  } catch {
    // Ignore
  }
  const empty: string[] = [];
  auxiliaryBotSessionsCache = empty;
  return empty;
}

function saveAuxiliaryBotSessionToDisk(slotIndex: number, sessionStr: string): void {
  if (!sessionStr || !sessionStr.trim() || slotIndex < 1) return;
  try {
    const arr = [...loadAuxiliaryBotSessionsFromDisk()];
    const changed = arr[slotIndex - 1] !== sessionStr.trim();
    arr[slotIndex - 1] = sessionStr.trim();
    auxiliaryBotSessionsCache = arr;
    fs.writeFileSync(
      MTPROTO_AUX_SESSIONS_FILE,
      JSON.stringify({ sessions: arr, savedAt: new Date().toISOString() }),
      'utf-8'
    );
    if (changed) {
      scheduleSaveMtprotoVaultToTelegram();
    }
  } catch {
    // Ignore
  }
}

async function disconnectAuxiliaryBotClients(clearSaved = false): Promise<void> {
  const entries = Array.from(auxiliaryBotClients.entries());
  auxiliaryBotClients.clear();
  for (const [, auxClient] of entries) {
    await auxClient.disconnect().catch(() => {});
  }
  if (clearSaved) {
    auxiliaryBotSessionsCache = [];
    try {
      if (fs.existsSync(MTPROTO_AUX_SESSIONS_FILE)) {
        fs.unlinkSync(MTPROTO_AUX_SESSIONS_FILE);
      }
    } catch {
      // Ignore
    }
    scheduleSaveMtprotoVaultToTelegram();
  }
}

/**
 * Obtains or creates an independent auxiliary TelegramClient bot session (isolated AuthKey & Memory/StringSession).
 * Reused across all subsequent transfers and persisted in Cloud Vault so cold restarts never repeat logins.
 */
async function getOrCreateAuxiliaryBotClient(slotIndex: number): Promise<TelegramClient | null> {
  if (slotIndex < 1 || slotIndex >= MTPROTO_TCP_POOL_SIZE) return null;

  const existing = auxiliaryBotClients.get(slotIndex);
  if (existing && existing.connected) {
    return existing;
  }

  const inflight = auxiliaryBotConnecting.get(slotIndex);
  if (inflight) return inflight;

  const token = botConfig.telegramBotToken.trim();
  const apiId = Number(botConfig.telegramApiId.trim());
  const apiHash = botConfig.telegramApiHash.trim();
  if (!token || !apiId || !apiHash || Number.isNaN(apiId)) return null;

  const connectPromise = (async () => {
    try {
      await ensureMtprotoVaultLoadedOnce();
      if (existing) {
        await existing.disconnect().catch(() => {});
        auxiliaryBotClients.delete(slotIndex);
      }

      const savedList = loadAuxiliaryBotSessionsFromDisk();
      const savedStr = String(savedList[slotIndex - 1] || '').trim();
      let auxClient: TelegramClient | null = null;

      if (savedStr) {
        try {
          const candidate = new TelegramClient(new StringSession(savedStr), apiId, apiHash, {
            connectionRetries: 3,
            networkSocket: FastPromisedNetSockets as any,
          });
          await candidate.connect();
          const authorized = await candidate.isUserAuthorized();
          if (authorized) {
            auxClient = candidate;
          } else {
            await candidate.disconnect().catch(() => {});
          }
        } catch {
          // Saved auxiliary session expired or invalid; create fresh session below
        }
      }

      if (!auxClient) {
        if (mtprotoAuxFloodWaitUntilMs > Date.now()) {
          return null;
        }
        // Stagger new bot authorizations so parallel slots avoid simultaneous importBotAuthorization hits
        await new Promise((r) => setTimeout(r, (slotIndex - 1) * 350));
        if (mtprotoAuxFloodWaitUntilMs > Date.now()) {
          return null;
        }

        const freshClient = new TelegramClient(new StringSession(''), apiId, apiHash, {
          connectionRetries: 3,
          networkSocket: FastPromisedNetSockets as any,
        });
        await freshClient.start({ botAuthToken: token });
        auxClient = freshClient;
      }

      const persisted = (auxClient.session.save() as unknown as string) || '';
      if (persisted) {
        saveAuxiliaryBotSessionToDisk(slotIndex, persisted);
      }
      auxiliaryBotClients.set(slotIndex, auxClient);
      return auxClient;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const waitMatch = msg.match(/(?:FLOOD_WAIT_|wait of )(\d+)/i);
      if (waitMatch) {
        const waitSec = Math.max(5, Number(waitMatch[1]) || 30);
        mtprotoAuxFloodWaitUntilMs = Date.now() + (waitSec + 2) * 1000;
        addMtprotoDiagLog({
          level: 'warn',
          message: `Sesión auxiliar #${slotIndex} en enfriamiento Telegram (${waitSec}s); el resto de sockets continúan descargando.`,
        });
      } else {
        addMtprotoDiagLog({
          level: 'warn',
          message: `No se pudo abrir sesión auxiliar #${slotIndex}: ${msg.slice(0, 140)}`,
        });
      }
      return null;
    } finally {
      auxiliaryBotConnecting.delete(slotIndex);
    }
  })();

  auxiliaryBotConnecting.set(slotIndex, connectPromise);
  return connectPromise;
}

let auxPrewarmPromise: Promise<void> | null = null;
async function prewarmAuxiliaryBotClientsInBackground(): Promise<void> {
  if (auxPrewarmPromise) return auxPrewarmPromise;
  auxPrewarmPromise = (async () => {
    try {
      const auxCount = Math.max(0, MTPROTO_TCP_POOL_SIZE - 1);
      if (auxCount <= 0) return;
      await Promise.all(
        Array.from({ length: auxCount }, (_, idx) =>
          getOrCreateAuxiliaryBotClient(idx + 1).catch(() => null)
        )
      );
    } finally {
      auxPrewarmPromise = null;
    }
  })();
  return auxPrewarmPromise;
}

async function resetAndReconnectMtprotoClient(reason: string): Promise<TelegramClient | null> {
  addLiveLog(
    'mtproto',
    'warn',
    `Regenerando sesión MTProto 2 GB automáticamente (${reason})...`
  );
  await disconnectAuxiliaryBotClients(true);
  try {
    if (mtprotoClient) {
      await mtprotoClient.disconnect().catch(() => {});
    }
  } catch {
    // Ignore
  }
  mtprotoClient = null;
  mtprotoConnected = false;
  mtprotoSessionString = '';
  try {
    if (fs.existsSync(MTPROTO_SESSION_FILE)) {
      fs.unlinkSync(MTPROTO_SESSION_FILE);
    }
    const legacyFile = path.join(LEGACY_DATA_DIR, 'mtproto_session_v2.json');
    if (fs.existsSync(legacyFile)) {
      fs.unlinkSync(legacyFile);
    }
  } catch {
    // Ignore
  }
  return ensureMtprotoClient();
}

/**
 * High-speed parallel Direct-DC chunk downloader:
 * - Slot #0 uses the main TelegramClient (`client._sender` on Home DC or exported DC sender)
 * - Slots #1..#5 use independent auxiliary TelegramClient bot sessions (brand-new AuthKeys in memory,
 *   never sharing `client.session` and never colliding with `406: AUTH_KEY_DUPLICATED`)
 * - Requests 1 MB (`1024 * 1024`) aligned chunks across up to 12 parallel workers balanced via `selectLeastBusySenderSlot`
 * - Pre-allocates disk file (`ftruncate`) and writes each chunk positionally (`pwrite` at exact `offset`)
 * - Reports live DC #, active TCP sockets (X/Y), and real MB/s speed
 */
async function downloadDocumentFast(
  client: TelegramClient,
  doc: {
    dcId: number;
    id: any;
    accessHash: any;
    fileReference: Buffer;
    isPhoto?: boolean;
    thumbSize?: string;
  },
  outputFilePath: string,
  totalBytes: number,
  onProgress: (
    downloaded: number,
    total: number,
    telemetry?: { dcId: number; activeSockets: number; maxSockets: number }
  ) => void,
  jobId?: string,
  peerId?: number | string,
  messageId?: number
): Promise<void> {
  const CHUNK_TIMEOUT_MS = 22_000;
  const fileHandle = await fs.promises.open(outputFilePath, 'w+');
  if (totalBytes > 0) {
    await fileHandle.truncate(totalBytes).catch(() => {});
  }

  let currentDcId = Number(doc.dcId) || 1;
  let currentFileReference: Buffer = Buffer.isBuffer(doc.fileReference)
    ? doc.fileReference
    : Buffer.from(doc.fileReference || []);
  let force512KbMode = false;

  const pendingQueue: DownloadChunkDescriptor[] = buildDirectDownloadChunks(
    totalBytes,
    MTPROTO_TURBO_CHUNK_BYTES
  );
  const initialQueueLen = pendingQueue.length;

  let downloadedBytes = 0;
  let fatalError: Error | null = null;
  let reconnectingPromise: Promise<any> | null = null;
  let refreshingFileRefPromise: Promise<void> | null = null;

  const cancelAbort = new AbortController();
  const cancelMonitor = jobId
    ? setInterval(() => {
        if (cancelledJobIds.has(jobId)) {
          fatalError = new Error('SUBIDA_CANCELADA_POR_USUARIO');
          cancelAbort.abort();
        }
      }, 350)
    : null;

  const desiredTotalSockets = computePoolWarmupCount(totalBytes, MTPROTO_TCP_POOL_SIZE);
  const slotClients: TelegramClient[] = [client];
  const senderSlots: any[] = [null];
  const inFlightCounts: number[] = [0];
  const healthyFlags: boolean[] = [true];
  const slotDisabled: boolean[] = [false];
  const slotConsecutiveErrors: number[] = [0];
  const slotChunkCounts: number[] = [0];
  const slotLoggedFirstError: boolean[] = [false];
  let roundRobinCounter = 0;
  let completedChunks = 0;
  let totalChunkLatencyMs = 0;
  let lastReturnedChunkBytes = 0;
  let chunkErrorsCount = 0;
  let leaseKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let telemetryTimer: ReturnType<typeof setInterval> | null = null;
  const downloadStartTimeMs = Date.now();
  let lastWindowTimeMs = downloadStartTimeMs;
  let lastWindowBytes = 0;
  let lastCpuUsage = process.cpuUsage();

  const getActiveSocketCount = () => {
    let active = 0;
    for (let i = 0; i < senderSlots.length; i++) {
      if (!slotDisabled[i] && healthyFlags[i] && senderSlots[i]) active++;
    }
    return Math.max(1, active);
  };

  const emitTelemetrySnapshot = (label: string) => {
    const now = Date.now();
    const dtSec = Math.max(0.25, (now - lastWindowTimeMs) / 1000);
    const dBytes = Math.max(0, downloadedBytes - lastWindowBytes);
    const windowMBpsNum = Number((dBytes / (1024 * 1024) / dtSec).toFixed(2));
    const totalSec = Math.max(0.25, (now - downloadStartTimeMs) / 1000);
    const avgTotalMBpsNum = Number((downloadedBytes / (1024 * 1024) / totalSec).toFixed(2));

    const cpuDelta = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    const cpuPct = Math.round(((cpuDelta.user + cpuDelta.system) / 1000 / (dtSec * 1000)) * 100);

    lastWindowTimeMs = now;
    lastWindowBytes = downloadedBytes;

    const avgMs = completedChunks > 0 ? Math.round(totalChunkLatencyMs / completedChunks) : 0;
    const activeSocketsNow = getActiveSocketCount();
    const distStr = slotChunkCounts
      .map((c, idx) => (slotDisabled[idx] ? `s${idx}:${c}(off)` : `s${idx}:${c}`))
      .join(' ');
    addMtprotoDiagLog({
      level: chunkErrorsCount > 25 && activeSocketsNow <= 1 ? 'warn' : 'info',
      dcId: currentDcId,
      activeSockets: activeSocketsNow,
      maxSockets: desiredTotalSockets,
      windowMBps: windowMBpsNum,
      avgMBps: avgTotalMBpsNum,
      cpuPct,
      avgLatencyMs: avgMs,
      errorCount: chunkErrorsCount,
      reparto: distStr,
      message: `${label} DC #${currentDcId}: ${activeSocketsNow}/${desiredTotalSockets} sockets · ventana=${windowMBpsNum.toFixed(2)} MB/s (total ${avgTotalMBpsNum.toFixed(2)} MB/s) · CPU=${cpuPct}% · bloque=${Math.round(lastReturnedChunkBytes / 1024)} KB · latencia=${avgMs} ms/chunk · errores=${chunkErrorsCount} · reparto=[${distStr}]`,
    });
  };

  const clearExportedSenderReleaseTimer = (targetClient: TelegramClient, dcId: number) => {
    const timers: Map<number, ReturnType<typeof setTimeout>> | undefined = (targetClient as any)
      ?._exportedSenderReleaseTimeouts;
    if (timers && typeof timers.get === 'function') {
      const existingTimer = timers.get(dcId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        timers.delete(dcId);
      }
    }
  };

  try {
    const resolveClientSenderForDc = async (targetClient: TelegramClient, targetDcId: number) => {
      const homeDcId = Number((targetClient.session as any)?.dcId) || undefined;
      if (shouldUseMainClientSenderForPrimarySlot(targetDcId, homeDcId)) {
        return (targetClient as any)._sender || (await targetClient.getSender(undefined as any));
      }
      const exported = await targetClient.getSender(targetDcId);
      clearExportedSenderReleaseTimer(targetClient, targetDcId);
      return exported;
    };

    senderSlots[0] = await resolveClientSenderForDc(client, currentDcId);
    healthyFlags[0] = Boolean(senderSlots[0]);

    // Prevent GramJS's 30s EXPORTED_SENDER_RELEASE_TIMEOUT from resetting/disconnecting active download sockets
    leaseKeepaliveTimer = setInterval(() => {
      for (let i = 0; i < slotClients.length; i++) {
        if (slotClients[i] && !slotDisabled[i]) {
          clearExportedSenderReleaseTimer(slotClients[i], currentDcId);
        }
      }
    }, 10_000);

    telemetryTimer = setInterval(() => {
      if (!cancelAbort.signal.aborted && !fatalError && completedChunks > 0) {
        emitTelemetrySnapshot('Telemetría');
      }
    }, 10_000);

    const warmAuxiliarySlots = async () => {
      if (desiredTotalSockets <= 1) return;
      const poolDcSnapshot = currentDcId;
      await Promise.all(
        Array.from({ length: desiredTotalSockets - 1 }, async (_, idx) => {
          const slotNum = idx + 1;
          if (cancelAbort.signal.aborted || fatalError || currentDcId !== poolDcSnapshot) return;
          try {
            const auxClient = await getOrCreateAuxiliaryBotClient(slotNum);
            if (!auxClient) return;
            if (cancelAbort.signal.aborted || fatalError || currentDcId !== poolDcSnapshot) return;
            const auxSender = await resolveClientSenderForDc(auxClient, poolDcSnapshot);
            if (!auxSender) return;
            if (cancelAbort.signal.aborted || fatalError || currentDcId !== poolDcSnapshot) return;
            slotClients.push(auxClient);
            senderSlots.push(auxSender);
            inFlightCounts.push(0);
            healthyFlags.push(true);
            slotDisabled.push(false);
            slotConsecutiveErrors.push(0);
            slotChunkCounts.push(0);
            slotLoggedFirstError.push(false);
          } catch (auxErr) {
            addMtprotoDiagLog({
              level: 'warn',
              dcId: poolDcSnapshot,
              message: `Socket auxiliar #${slotNum} no pudo conectarse a DC #${poolDcSnapshot}: ${
                auxErr instanceof Error ? auxErr.message.slice(0, 120) : String(auxErr)
              }`,
            });
          }
        })
      );
      if (!cancelAbort.signal.aborted && !fatalError) {
        const activeNow = getActiveSocketCount();
        addMtprotoDiagLog({
          level: activeNow > 1 ? 'success' : 'warn',
          dcId: currentDcId,
          activeSockets: activeNow,
          maxSockets: desiredTotalSockets,
          message: `Pool MTProto DC #${currentDcId}: ${activeNow}/${desiredTotalSockets} sesiones TCP independientes activas (${Math.min(MTPROTO_SAFE_PARALLEL_WORKERS, Math.max(1, initialQueueLen))} hilos x 1 MB · FastSocket).`,
        });
      }
    };

    // Wait briefly (up to 1.5s) if aux sessions are cold so workers start immediately across multiple sockets,
    // while cached sessions resolve in <5ms
    await Promise.race([
      warmAuxiliarySlots(),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);

    const renewPrimaryDcSender = async (forceReconnect = false) => {
      const homeDcId = Number((client.session as any)?.dcId) || undefined;
      const isHomeDc = shouldUseMainClientSenderForPrimarySlot(currentDcId, homeDcId);
      const primary = senderSlots[0];
      if (!forceReconnect && primary && primary.isConnected?.()) {
        if (isHomeDc) {
          return primary;
        }
        try {
          senderSlots[0] = await client.getSender(currentDcId);
          healthyFlags[0] = true;
          return senderSlots[0];
        } catch {
          // Fall through to synchronized reconnect
        }
      }
      if (reconnectingPromise) {
        return reconnectingPromise;
      }
      reconnectingPromise = (async () => {
        try {
          senderSlots[0] = await resolveClientSenderForDc(client, currentDcId);
          healthyFlags[0] = Boolean(senderSlots[0]);
          return senderSlots[0];
        } catch {
          return senderSlots[0];
        } finally {
          reconnectingPromise = null;
        }
      })();
      return reconnectingPromise;
    };

    const refreshFileReferenceSafe = async () => {
      if (!peerId || !messageId) return;
      if (refreshingFileRefPromise) {
        return refreshingFileRefPromise;
      }
      refreshingFileRefPromise = (async () => {
        try {
          const freshMsgs = await client.getMessages(peerId, { ids: [messageId] });
          const freshMedia: any = freshMsgs?.[0]?.media;
          const freshDoc = freshMedia?.document || freshMedia?.photo;
          if (freshDoc?.fileReference) {
            currentFileReference = Buffer.isBuffer(freshDoc.fileReference)
              ? freshDoc.fileReference
              : Buffer.from(freshDoc.fileReference);
          }
        } catch {
          // Ignore if message history is unavailable
        } finally {
          refreshingFileRefPromise = null;
        }
      })();
      return refreshingFileRefPromise;
    };

    const buildInputLocation = () => {
      if (doc.isPhoto) {
        return new Api.InputPhotoFileLocation({
          id: typeof doc.id === 'bigint' || typeof doc.id === 'string' || typeof doc.id === 'number' ? bigInt(String(doc.id)) : doc.id,
          accessHash:
            typeof doc.accessHash === 'bigint' || typeof doc.accessHash === 'string' || typeof doc.accessHash === 'number'
              ? bigInt(String(doc.accessHash))
              : doc.accessHash,
          fileReference: currentFileReference,
          thumbSize: doc.thumbSize || '',
        });
      }
      return new Api.InputDocumentFileLocation({
        id: typeof doc.id === 'bigint' || typeof doc.id === 'string' || typeof doc.id === 'number' ? bigInt(String(doc.id)) : doc.id,
        accessHash:
          typeof doc.accessHash === 'bigint' || typeof doc.accessHash === 'string' || typeof doc.accessHash === 'number'
            ? bigInt(String(doc.accessHash))
            : doc.accessHash,
        fileReference: currentFileReference,
        thumbSize: doc.thumbSize || '',
      });
    };

    const worker = async () => {
      while (true) {
        if (fatalError || cancelAbort.signal.aborted) break;
        if (jobId && cancelledJobIds.has(jobId)) {
          fatalError = new Error('SUBIDA_CANCELADA_POR_USUARIO');
          cancelAbort.abort();
          break;
        }

        const rawChunk = pendingQueue.shift();
        if (!rawChunk) break;

        // If a previous chunk triggered 512 KB mode on a legacy DC, split 1 MB chunks before requesting
        if (force512KbMode && rawChunk.requestLimit > MTPROTO_FALLBACK_CHUNK_BYTES) {
          const splitParts = splitChunkInto512KbParts(rawChunk, totalBytes);
          pendingQueue.unshift(...splitParts);
          continue;
        }

        const chunk = rawChunk;
        if (chunk.expectedBytes <= 0) continue;

        let attempt = 0;
        let success = false;
        while (attempt < 10 && !success && !fatalError && !cancelAbort.signal.aborted) {
          if (jobId && cancelledJobIds.has(jobId)) {
            fatalError = new Error('SUBIDA_CANCELADA_POR_USUARIO');
            cancelAbort.abort();
            break;
          }
          attempt++;
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          let onAbortHandler: (() => void) | null = null;
          let chosenSlotIdx = 0;
          try {
            // Update health flags for auxiliary slots (never re-enable quarantined slots)
            for (let sIdx = 1; sIdx < senderSlots.length; sIdx++) {
              if (slotDisabled[sIdx]) {
                healthyFlags[sIdx] = false;
                continue;
              }
              const sObj = senderSlots[sIdx];
              const sClient = slotClients[sIdx];
              const transportUp = sObj?._connection ? sObj._connection.isConnected?.() !== false : true;
              healthyFlags[sIdx] = Boolean(
                sObj && sClient && sObj.isConnected?.() && !sObj.isReconnecting && transportUp
              );
            }
            chosenSlotIdx = selectLeastBusySenderSlot(
              inFlightCounts,
              healthyFlags,
              roundRobinCounter++
            );

            let slotClient = slotClients[chosenSlotIdx] || client;
            let sender = senderSlots[chosenSlotIdx];
            if (
              chosenSlotIdx === 0 ||
              slotDisabled[chosenSlotIdx] ||
              !sender ||
              !sender.isConnected?.()
            ) {
              chosenSlotIdx = 0;
              slotClient = client;
              sender = await renewPrimaryDcSender(false);
            }

            inFlightCounts[chosenSlotIdx] = (inFlightCounts[chosenSlotIdx] || 0) + 1;

            const req = new Api.upload.GetFile({
              location: buildInputLocation(),
              offset: bigInt(chunk.offset),
              limit: chunk.requestLimit,
            });

            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new Error(`CHUNK_TIMEOUT_${CHUNK_TIMEOUT_MS}MS`));
              }, CHUNK_TIMEOUT_MS);
            });

            const abortPromise = new Promise<never>((_, reject) => {
              if (cancelAbort.signal.aborted) {
                reject(new Error('SUBIDA_CANCELADA_POR_USUARIO'));
                return;
              }
              onAbortHandler = () => reject(new Error('SUBIDA_CANCELADA_POR_USUARIO'));
              cancelAbort.signal.addEventListener('abort', onAbortHandler, { once: true });
            });

            const chunkStartMs = Date.now();
            const res = (await Promise.race([
              slotClient.invokeWithSender(req, sender),
              timeoutPromise,
              abortPromise,
            ])) as any;

            if (res && res.bytes) {
              const buf = Buffer.isBuffer(res.bytes) ? res.bytes : Buffer.from(res.bytes);
              if (buf.length === 0) {
                throw new Error('Respuesta de bytes vacía de Telegram');
              }
              // Positional write (os.pwrite equivalent) at exact chunk offset
              await fileHandle.write(buf, 0, buf.length, chunk.offset);
              downloadedBytes += buf.length;
              slotChunkCounts[chosenSlotIdx] = (slotChunkCounts[chosenSlotIdx] || 0) + 1;
              slotConsecutiveErrors[chosenSlotIdx] = 0;
              completedChunks++;
              totalChunkLatencyMs += Math.max(1, Date.now() - chunkStartMs);
              lastReturnedChunkBytes = buf.length;

              onProgress(Math.min(downloadedBytes, totalBytes), totalBytes, {
                dcId: currentDcId,
                activeSockets: getActiveSocketCount(),
                maxSockets: desiredTotalSockets,
              });

              // If DC returned partial bytes (e.g. 512 KB instead of 1 MB), enqueue the remainder seamlessly
              if (buf.length < chunk.expectedBytes && buf.length % 4096 === 0) {
                const remOffset = chunk.offset + buf.length;
                const remExpected = chunk.expectedBytes - buf.length;
                if (remExpected > 0) {
                  pendingQueue.unshift({
                    index: chunk.index,
                    offset: remOffset,
                    requestLimit: MTPROTO_FALLBACK_CHUNK_BYTES,
                    expectedBytes: remExpected,
                  });
                }
              }
              success = true;
            } else {
              throw new Error('Respuesta de bytes vacía de Telegram');
            }
          } catch (err: any) {
            chunkErrorsCount++;
            slotConsecutiveErrors[chosenSlotIdx] = (slotConsecutiveErrors[chosenSlotIdx] || 0) + 1;
            const rawErrMsg = String(err?.errorMessage || err?.message || err || 'Error desconocido').slice(0, 160);
            const classified = classifyMtprotoDownloadError(err);

            if (classified.kind === 'cancelled' || (jobId && cancelledJobIds.has(jobId))) {
              fatalError = new Error('SUBIDA_CANCELADA_POR_USUARIO');
              cancelAbort.abort();
              break;
            }

            if (!slotLoggedFirstError[chosenSlotIdx]) {
              slotLoggedFirstError[chosenSlotIdx] = true;
              addMtprotoDiagLog({
                level: 'warn',
                dcId: currentDcId,
                activeSockets: getActiveSocketCount(),
                maxSockets: desiredTotalSockets,
                message: `Socket s${chosenSlotIdx} error en DC #${currentDcId} (${classified.kind}): ${rawErrMsg}`,
              });
            }

            // Retire broken auxiliary slots immediately on fatal_auth or after 3 consecutive failures so workers never spin in error loops
            if (
              chosenSlotIdx > 0 &&
              (classified.kind === 'fatal_auth' || slotConsecutiveErrors[chosenSlotIdx] >= 3)
            ) {
              if (!slotDisabled[chosenSlotIdx]) {
                slotDisabled[chosenSlotIdx] = true;
                healthyFlags[chosenSlotIdx] = false;
                const badClient = slotClients[chosenSlotIdx];
                if (classified.kind === 'fatal_auth') {
                  auxiliaryBotClients.delete(chosenSlotIdx);
                  if (badClient) {
                    void badClient.disconnect().catch(() => {});
                  }
                }
                addMtprotoDiagLog({
                  level: 'warn',
                  dcId: currentDcId,
                  activeSockets: getActiveSocketCount(),
                  maxSockets: desiredTotalSockets,
                  message: `Socket s${chosenSlotIdx} aislado tras ${slotConsecutiveErrors[chosenSlotIdx]} fallos (${rawErrMsg}); los restantes ${getActiveSocketCount()} socket(s) continúan.`,
                });
                onProgress(Math.min(downloadedBytes, totalBytes), totalBytes, {
                  dcId: currentDcId,
                  activeSockets: getActiveSocketCount(),
                  maxSockets: desiredTotalSockets,
                });
              }
              attempt = Math.max(0, attempt - 1);
              continue;
            }

            if (classified.kind === 'fatal_auth') {
              fatalError = new Error(classified.message);
              break;
            }

            // Native Pyrogram-style sleep_threshold=60 for FLOOD_WAIT without wasting retry attempts
            if (classified.kind === 'flood_wait') {
              if (classified.waitSeconds <= MTPROTO_SLEEP_THRESHOLD_SECONDS) {
                attempt = Math.max(0, attempt - 1);
                await new Promise((r) => setTimeout(r, (classified.waitSeconds + 1) * 1000));
                continue;
              }
              fatalError = new Error(classified.message);
              break;
            }

            // Dynamic DC migration if file moved to another Data Center
            if (classified.kind === 'file_migrate') {
              currentDcId = classified.newDcId;
              for (let sIdx = 1; sIdx < senderSlots.length; sIdx++) {
                if (slotDisabled[sIdx]) continue;
                try {
                  const auxC = slotClients[sIdx];
                  if (auxC && auxC.connected) {
                    senderSlots[sIdx] = await resolveClientSenderForDc(auxC, currentDcId);
                    healthyFlags[sIdx] = Boolean(senderSlots[sIdx]);
                  } else {
                    healthyFlags[sIdx] = false;
                  }
                } catch {
                  healthyFlags[sIdx] = false;
                }
              }
              attempt = Math.max(0, attempt - 1);
              await renewPrimaryDcSender(true);
              continue;
            }

            // Automatic 1 MB -> 2x512 KB fallback if a DC rejects 1 MB limit
            if (classified.kind === 'limit_invalid' && chunk.requestLimit > MTPROTO_FALLBACK_CHUNK_BYTES) {
              force512KbMode = true;
              const splitParts = splitChunkInto512KbParts(chunk, totalBytes);
              pendingQueue.unshift(...splitParts);
              success = true;
              break;
            }

            // Refresh file_reference on the fly via getMessages if expired
            if (classified.kind === 'file_reference_expired') {
              await refreshFileReferenceSafe();
            }

            if (classified.kind === 'transient_network') {
              if (chosenSlotIdx > 0) {
                healthyFlags[chosenSlotIdx] = false;
              } else {
                await renewPrimaryDcSender(true);
              }
            }

            if (attempt >= 10) {
              fatalError = err instanceof Error ? err : new Error(classified.message);
              break;
            }
            await new Promise((r) => setTimeout(r, Math.min(3000, 500 * attempt)));
          } finally {
            inFlightCounts[chosenSlotIdx] = Math.max(0, (inFlightCounts[chosenSlotIdx] || 1) - 1);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (onAbortHandler) {
              cancelAbort.signal.removeEventListener('abort', onAbortHandler);
            }
          }
        }
      }
    };

    const workerCount = Math.min(MTPROTO_SAFE_PARALLEL_WORKERS, Math.max(1, initialQueueLen));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (fatalError) {
      throw fatalError;
    }
  } finally {
    if (completedChunks > 0) {
      emitTelemetrySnapshot(fatalError ? 'Resumen (interrumpido)' : 'Resumen');
    }
    if (telemetryTimer) clearInterval(telemetryTimer);
    if (leaseKeepaliveTimer) clearInterval(leaseKeepaliveTimer);
    if (cancelMonitor) clearInterval(cancelMonitor);
    await fileHandle.close().catch(() => {});
  }
}

/**
 * PHASE 1: Download 100% of the video up to 2 GB into Cloud Run Ephemeral Scratch Disk (TMP_UPLOAD_DIR)
 */
async function downloadFullVideoFromTelegram(
  job: VideoTransferJob,
  statusMsgId: number | null
): Promise<string> {
  const safeExt = path.extname(job.fileName) || '.mp4';
  const targetFilePath = path.join(TMP_UPLOAD_DIR, `${job.id}${safeExt}`);
  job.tempFilePath = targetFilePath;

  // Reuse cached 100% verified file on disk if already downloaded
  if (
    job.expectedBytes > 0 &&
    fs.existsSync(targetFilePath) &&
    fs.statSync(targetFilePath).size === job.expectedBytes
  ) {
    job.downloadedBytes = job.expectedBytes;
    job.diskVerifiedBytes = job.expectedBytes;
    job.integrityVerified = true;
    job.updatedAt = new Date().toISOString();
    saveJobsToDisk();
    addLiveLog(
      'system',
      'info',
      `Archivo "${job.fileName}" (${formatBytes(job.expectedBytes)}) ya verificado al 100% en disco scratch (${TMP_UPLOAD_DIR}). Pasando directo a S3 MinIO.`
    );
    return targetFilePath;
  }

  // Enforce Ephemeral Scratch Disk space check + LRU eviction before starting MTProto download
  const spaceCheck = ensureScratchSpaceForFile(
    TMP_UPLOAD_DIR,
    job.expectedBytes,
    getProtectedScratchPaths(job.id)
  );
  if (spaceCheck.deletedFiles.length > 0) {
    addLiveLog(
      'system',
      'info',
      `Limpieza LRU en disco scratch (${TMP_UPLOAD_DIR}): liberados ${formatBytes(spaceCheck.freedBytes)} (${spaceCheck.deletedFiles.length} archivo(s) antiguo(s)).`
    );
  }
  if (!spaceCheck.ok) {
    throw new Error(
      `Espacio insuficiente en el disco temporal (${TMP_UPLOAD_DIR}): se requieren ${formatBytes(job.expectedBytes)} y hay ${formatBytes(spaceCheck.freeBytesAfter)} disponibles.`
    );
  }

  job.stage = 'downloading_mtproto';
  job.downloadedBytes = 0;
  job.updatedAt = new Date().toISOString();
  let lastTelegramEdit = 0;

  if (job.sourceType === 'http_url' && job.sourceUrl) {
    const startTimeHttp = Date.now();
    const controller = new AbortController();
    const cancelWatch = setInterval(() => {
      if (cancelledJobIds.has(job.id)) {
        controller.abort();
      }
    }, 350);
    const outStream = fs.createWriteStream(targetFilePath);
    try {
      const res = await fetch(job.sourceUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok || !res.body) {
        throw new Error(`El enlace devolvió HTTP ${res.status}`);
      }
      const headerLen = Number(res.headers.get('content-length') || 0);
      if (headerLen > 0) {
        job.expectedBytes = headerLen;
        if (headerLen > PICTA_S3_MAX_OBJECT_BYTES) {
          throw new Error(
            `El archivo (${formatBytes(headerLen)}) supera el límite máximo de 5 GB de Picta.`
          );
        }
      }

      const reader = res.body.getReader();
      let downloaded = 0;
      while (true) {
        if (cancelledJobIds.has(job.id)) {
          throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          downloaded += value.byteLength;
          if (downloaded > PICTA_S3_MAX_OBJECT_BYTES) {
            throw new Error('La descarga superó el límite máximo de 5 GB de Picta.');
          }
          if (!outStream.write(value)) {
            await new Promise<void>((resolve) => outStream.once('drain', resolve));
          }
          job.downloadedBytes = downloaded;
          const elapsed = Math.max(0.5, (Date.now() - startTimeHttp) / 1000);
          job.speedMBps = Number((downloaded / (1024 * 1024) / elapsed).toFixed(2));
          const totalNum = job.expectedBytes || downloaded;
          const pct = totalNum > 0 ? Math.min(100, Math.round((downloaded / totalNum) * 100)) : 0;
          currentActivity = `Descargando desde enlace HTTP (${job.speedMBps} MB/s): ${job.fileName} — ${formatBytes(downloaded)}`;
          const now = Date.now();
          if (now - lastTelegramEdit > 3000) {
            lastTelegramEdit = now;
            void editTelegramStatusMessage(
              job.telegramChatId,
              statusMsgId,
              `${hudHeader('FASE 1/4 · DESCARGA DESDE URL DIRECTA')}\n` +
                hudBox([
                  `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
                  `📊 <b>Progreso:</b> <code>${renderVisualBar(pct)}</code>`,
                  `📦 <b>Transferido:</b> ${formatBytes(downloaded)}${job.expectedBytes > 0 ? ` / ${formatBytes(job.expectedBytes)}` : ''}`,
                  `⚡ <b>Velocidad:</b> ${job.speedMBps} MB/s`,
                ]),
              [[{ text: '🛑 Cancelar subida', callback_data: `cancel_job:${job.id}` }]]
            );
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        outStream.end(() => resolve());
        outStream.on('error', reject);
      });

      const finalStat = fs.statSync(targetFilePath);
      if (job.expectedBytes <= 0) {
        job.expectedBytes = finalStat.size;
      }
      job.downloadedBytes = finalStat.size;
      job.diskVerifiedBytes = finalStat.size;
      const totalDur = Math.max(0.5, (Date.now() - startTimeHttp) / 1000);
      job.speedMBps = Number((finalStat.size / (1024 * 1024) / totalDur).toFixed(2));
      await editTelegramStatusMessage(
        job.telegramChatId,
        statusMsgId,
        `${hudHeader('FASE 1/4 · DESCARGA HTTP COMPLETADA')}\n` +
          hudBox([
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
            `📊 <b>Progreso:</b> <code>${renderVisualBar(100)}</code>`,
            `📦 <b>Descargado:</b> ${formatBytes(job.downloadedBytes)}`,
            `⚡ <b>Velocidad media:</b> ${job.speedMBps} MB/s`,
          ]) +
          `\n⏳ <i>Verificando integridad en disco antes de transmitir a Picta...</i>`,
        undefined,
        true
      );
      return targetFilePath;
    } catch (err) {
      outStream.destroy();
      try {
        if (fs.existsSync(targetFilePath)) fs.unlinkSync(targetFilePath);
      } catch {
        // Ignore
      }
      if (cancelledJobIds.has(job.id) || (err instanceof Error && err.name === 'AbortError')) {
        throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
      }
      throw err;
    } finally {
      clearInterval(cancelWatch);
    }
  }

  let client = await ensureMtprotoClient();
  for (let retry = 0; !client && retry < 3; retry++) {
    addLiveLog(
      'mtproto',
      'warn',
      `Reintentando conectar MTProto 2 GB (intento ${retry + 1}/3)...`
    );
    await new Promise((r) => setTimeout(r, 2000));
    client = await ensureMtprotoClient();
  }

  while (!client && mtprotoFloodWaitUntilMs > Date.now()) {
    const remainingSec = Math.max(
      1,
      Math.ceil((mtprotoFloodWaitUntilMs - Date.now()) / 1000)
    );
    currentActivity = `Esperando ${remainingSec}s de enfriamiento en Telegram MTProto para descargar "${job.title}"...`;
    await new Promise((r) => setTimeout(r, Math.min(5000, remainingSec * 1000)));
    if (Date.now() >= mtprotoFloodWaitUntilMs) {
      client = await ensureMtprotoClient();
    }
  }

  if (!client) {
    if (job.expectedBytes > 0 && job.expectedBytes <= 20 * 1024 * 1024 && job.fileId) {
      addLiveLog(
        'telegram',
        'info',
        `MTProto temporalmente no disponible; usando Bot API estándar para archivo de ${formatBytes(job.expectedBytes)}...`
      );
      const buf = await downloadTelegramThumbnailBuffer(job.fileId);
      if (buf && buf.byteLength > 0) {
        fs.writeFileSync(targetFilePath, buf);
        job.downloadedBytes = buf.byteLength;
        job.diskVerifiedBytes = buf.byteLength;
        job.integrityVerified = true;
        job.updatedAt = new Date().toISOString();
        saveJobsToDisk();
        return targetFilePath;
      }
    }
    throw new Error(
      'No se pudo conectar el cliente MTProto 2 GB con Telegram tras 3 intentos. Por favor pulsa Reintentar abajo.'
    );
  }

  const isTelegramLinkSource =
    job.sourceType === 'telegram_link' &&
    Boolean(job.sourcePeerRef) &&
    Number(job.sourceMessageId || 0) > 0;
  const resolvedLinkPeer: any = isTelegramLinkSource
    ? /^-?\d+$/.test(String(job.sourcePeerRef))
      ? Number(job.sourcePeerRef)
      : String(job.sourcePeerRef)
    : Number(job.telegramChatId);
  const resolvedMsgIdForMtproto = isTelegramLinkSource
    ? Number(job.sourceMessageId)
    : job.telegramMessageId;
  const peerId = Number(job.telegramChatId);
  const startTime = Date.now();
  let lastNetTelemetry: { dcId: number; activeSockets: number; maxSockets: number } = {
    dcId: 1,
    activeSockets: 1,
    maxSockets: computePoolWarmupCount(job.expectedBytes, MTPROTO_TCP_POOL_SIZE),
  };

  const onProgress = (
    downNum: number,
    totalNum: number,
    telemetry?: { dcId: number; activeSockets: number; maxSockets: number }
  ) => {
    if (telemetry) {
      lastNetTelemetry = telemetry;
    }
    job.downloadedBytes = downNum;
    const elapsedSec = Math.max(0.5, (Date.now() - startTime) / 1000);
    job.speedMBps = Number((downNum / (1024 * 1024) / elapsedSec).toFixed(2));
    const pct = totalNum > 0 ? Math.min(100, Math.round((downNum / totalNum) * 100)) : 0;
    const netHud = formatMtprotoDownloadHudLine({
      dcId: lastNetTelemetry.dcId,
      activeSockets: lastNetTelemetry.activeSockets,
      maxSockets: lastNetTelemetry.maxSockets,
      speedMBps: job.speedMBps,
    });

    currentActivity = `Descargando de Telegram (${netHud}): ${job.fileName} — ${formatBytes(downNum)} / ${formatBytes(totalNum)} (${pct}%)`;

    const now = Date.now();
    if (now - lastTelegramEdit > 3000) {
      lastTelegramEdit = now;
      const qCount = uploadQueue.length;
      const remainingBytes = Math.max(0, totalNum - downNum);
      const etaSec =
        job.speedMBps > 0.1
          ? Math.round(remainingBytes / (job.speedMBps * 1024 * 1024))
          : 0;
      const etaLabel =
        etaSec > 0
          ? etaSec >= 60
            ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`
            : `${etaSec}s`
          : 'calculando...';

      void editTelegramStatusMessage(
        job.telegramChatId,
        statusMsgId,
        `${hudHeader('FASE 1/4 · DESCARGA MTPROTO 4 GB')}\n` +
          hudBox([
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
            `📊 <b>Progreso:</b> <code>${renderVisualBar(pct)}</code>`,
            `📦 <b>Transferido:</b> ${formatBytes(downNum)} / ${formatBytes(totalNum)}`,
            `🌐 <b>Red MTProto:</b> ${escapeHtml(`DC #${lastNetTelemetry.dcId} · ${lastNetTelemetry.activeSockets}/${lastNetTelemetry.maxSockets} sockets TCP`)}`,
            `⚡ <b>Velocidad:</b> ${job.speedMBps} MB/s · ⏱️ ETA ~${etaLabel}`,
            qCount > 0 ? `⏳ <b>En cola después:</b> ${qCount} video(s)` : null,
          ]),
        [[{ text: '🛑 Cancelar subida', callback_data: `cancel_job:${job.id}` }]]
      );
    }
  };

  // 1. Try 0-ms Direct FileId Decoding first (Pyrogram FileId.decode pattern — no RPC getMessages needed!)
  const decodedFid = job.fileId ? decodeTelegramBotFileId(job.fileId) : null;
  let fastDownloadDone = false;

  if (decodedFid && decodedFid.valid && job.expectedBytes > 0) {
    lastNetTelemetry.dcId = decodedFid.dcId;
    try {
      addLiveLog(
        'mtproto',
        'info',
        `Iniciando descarga directa DC #${decodedFid.dcId} (${lastNetTelemetry.maxSockets} sesiones TCP · ${MTPROTO_SAFE_PARALLEL_WORKERS} hilos x 1 MB desde file_id): "${job.fileName}" (${formatBytes(job.expectedBytes)})`
      );
      await downloadDocumentFast(
        client,
        {
          dcId: decodedFid.dcId,
          id: bigInt(decodedFid.mediaId),
          accessHash: bigInt(decodedFid.accessHash),
          fileReference: decodedFid.fileReference,
          isPhoto: decodedFid.isPhoto,
          thumbSize: '',
        },
        targetFilePath,
        job.expectedBytes,
        onProgress,
        job.id,
        peerId,
        job.telegramMessageId
      );
      fastDownloadDone = true;
    } catch (directFidErr) {
      const fidErrMsg = directFidErr instanceof Error ? directFidErr.message : String(directFidErr);
      if (fidErrMsg.includes('SUBIDA_CANCELADA_POR_USUARIO') || cancelledJobIds.has(job.id)) {
        throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
      }
      addLiveLog(
        'mtproto',
        'warn',
        `Aviso en descarga directa por file_id (${fidErrMsg}). Resolviendo mensaje #${job.telegramMessageId} para refrescar referencia...`
      );
      if (/AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED/i.test(fidErrMsg)) {
        const freshClient = await resetAndReconnectMtprotoClient(fidErrMsg);
        if (freshClient) {
          client = freshClient;
        }
      }
    }
  }

  // 2. Fallback or t.me link source: Fetch message via getMessages
  if (!fastDownloadDone) {
    let messages: any;
    try {
      messages = await client.getMessages(resolvedLinkPeer, { ids: [resolvedMsgIdForMtproto] });
    } catch (getMsgErr) {
      const gmErrStr = getMsgErr instanceof Error ? getMsgErr.message : String(getMsgErr);
      if (/AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/i.test(gmErrStr)) {
        const freshClient = await resetAndReconnectMtprotoClient(gmErrStr);
        if (!freshClient) {
          throw new Error('No se pudo reconectar la sesión MTProto 2 GB tras regenerar la clave.');
        }
        client = freshClient;
        messages = await client.getMessages(resolvedLinkPeer, { ids: [resolvedMsgIdForMtproto] });
      } else {
        throw getMsgErr;
      }
    }
    let msg: any = messages?.[0];

    if (!msg || !msg.media) {
      if (!isTelegramLinkSource) {
        try {
          const recentMsgs = await client.getMessages(peerId, { limit: 15 });
          msg = recentMsgs.find((m: any) => m?.media);
        } catch {
          // Ignore if bot doesn't have messages.GetHistory permission
        }
      }
    }

    if (!msg || !msg.media) {
      throw new Error(`No se encontró el archivo multimedia en el mensaje #${resolvedMsgIdForMtproto}.`);
    }

    const doc = msg.media?.document || (msg.media instanceof Api.Document ? msg.media : null);
    const rawDocSize =
      doc?.size !== undefined && doc?.size !== null ? Number(String(doc.size)) : 0;
    const docSize = rawDocSize > 0 ? rawDocSize : job.expectedBytes;
    if (docSize > 0 && job.expectedBytes !== docSize) {
      job.expectedBytes = docSize;
    }

    if (doc && doc.id && doc.accessHash && docSize > 0) {
      lastNetTelemetry.dcId = Number(doc.dcId) || lastNetTelemetry.dcId;
      try {
        addLiveLog(
          'mtproto',
          'info',
          `Iniciando descarga turbo MTProto 4 GB (${lastNetTelemetry.maxSockets} sesiones TCP · ${MTPROTO_SAFE_PARALLEL_WORKERS} hilos x 1 MB en DC #${doc.dcId}): "${job.fileName}" (${formatBytes(docSize)})`
        );
        await downloadDocumentFast(
          client,
          doc,
          targetFilePath,
          docSize,
          onProgress,
          job.id,
          resolvedLinkPeer,
          resolvedMsgIdForMtproto
        );
      } catch (turboErr) {
        const errMsg = turboErr instanceof Error ? turboErr.message : String(turboErr);
        if (errMsg.includes('SUBIDA_CANCELADA_POR_USUARIO') || cancelledJobIds.has(job.id)) {
          throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
        }
        addLiveLog(
          'mtproto',
          'warn',
          `Aviso en descarga turbo MTProto: ${errMsg}. Reintentando con método GramJS estándar...`
        );
        if (/AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED/i.test(errMsg)) {
          const freshClient = await resetAndReconnectMtprotoClient(errMsg);
          if (freshClient) {
            client = freshClient;
            const freshMessages = await client.getMessages(resolvedLinkPeer, {
              ids: [resolvedMsgIdForMtproto],
            });
            if (freshMessages?.[0]?.media) {
              msg = freshMessages[0];
            }
          }
        }
        await client.downloadMedia(msg.media, {
          outputFile: targetFilePath,
          progressCallback: (downloaded: any, total: any) => {
            if (cancelledJobIds.has(job.id)) {
              throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
            }
            onProgress(Number(downloaded), Number(total) || job.expectedBytes);
          },
        });
      }
    } else {
      await client.downloadMedia(msg.media, {
        outputFile: targetFilePath,
        progressCallback: (downloaded: any, total: any) => {
          onProgress(Number(downloaded), Number(total) || job.expectedBytes);
        },
      });
    }
  }

  if (fs.existsSync(targetFilePath)) {
    const finalSize = fs.statSync(targetFilePath).size;
    job.downloadedBytes = finalSize;
    job.diskVerifiedBytes = finalSize;
  }
  const totalDurationSec = Math.max(0.5, (Date.now() - startTime) / 1000);
  const avgSpeed = Number((job.downloadedBytes / (1024 * 1024) / totalDurationSec).toFixed(2));
  job.speedMBps = avgSpeed;

  await editTelegramStatusMessage(
    job.telegramChatId,
    statusMsgId,
    `${hudHeader('FASE 1/4 · DESCARGA COMPLETADA')}\n` +
      hudBox([
        `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
        `📊 <b>Progreso:</b> <code>${renderVisualBar(100)}</code>`,
        `📦 <b>Descargado:</b> ${formatBytes(job.downloadedBytes)}`,
        `🌐 <b>Red MTProto:</b> ${escapeHtml(`DC #${lastNetTelemetry.dcId} · ${lastNetTelemetry.activeSockets}/${lastNetTelemetry.maxSockets} sockets TCP`)}`,
        `⚡ <b>Velocidad media:</b> ${avgSpeed} MB/s`,
      ]) +
      `\n⏳ <i>Verificando integridad en disco antes de transmitir a Picta...</i>`,
    undefined,
    true
  );

  return targetFilePath;
}

/**
 * PHASE 2: Strict 100% Full-File Integrity Check on Disk
 */
function verifyCompleteFileOnDisk(job: VideoTransferJob, filePath: string): void {
  job.stage = 'verifying_integrity';
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo descargado no existe en el disco scratch (${TMP_UPLOAD_DIR}).`);
  }

  const stat = fs.statSync(filePath);
  job.diskVerifiedBytes = stat.size;
  job.downloadedBytes = stat.size;

  if (stat.size === 0 || (job.expectedBytes > 0 && stat.size !== job.expectedBytes)) {
    throw new Error(
      `Verificación de integridad fallida: se esperaban ${job.expectedBytes} bytes y en disco hay ${stat.size} bytes.`
    );
  }

  job.integrityVerified = true;
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();
}

function isDailyLimitErrorText(errText: string): boolean {
  const txt = String(errText || '');
  return (
    /l[ií]mite diario de \d+ publicaciones alcanzado/i.test(txt) ||
    /QUOTA_DAILY_LIMIT_REACHED/i.test(txt)
  );
}

async function authenticatePoolPictaAccount(
  acc: QuotaPoolAccount,
  forceRefresh = false
): Promise<{ token: string; userId?: number }> {
  if (
    !forceRefresh &&
    acc.accessToken &&
    acc.tokenExpiresAt &&
    acc.tokenExpiresAt > Date.now() + 60_000
  ) {
    return { token: acc.accessToken, userId: acc.userId };
  }

  const rawUser = acc.username.trim();
  const formattedUsername = /^\d{8}$/.test(rawUser)
    ? `+53${rawUser}`
    : /^53\d{8}$/.test(rawUser)
      ? `+${rawUser}`
      : rawUser;

  const form = new FormData();
  form.append('username', formattedUsername);
  form.append('password', acc.password.trim());
  form.append('grant_type', 'password');
  form.append('client_id', botConfig.pictaClientId || PICTA_OFFICIAL_CLIENT_ID);

  const tokenRes = await fetchPictaWithRetry('https://api.picta.cu/o/token/', {
    method: 'POST',
    headers: {
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: form,
  });

  const tokenData = (await tokenRes.json()) as any;
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description ||
        tokenData.error ||
        `Error HTTP ${tokenRes.status} al autenticar cuenta secundaria (${formattedUsername})`
    );
  }

  acc.accessToken = String(tokenData.access_token);
  acc.tokenExpiresAt = Date.now() + (Number(tokenData.expires_in) || 14400) * 1000;

  try {
    const meRes = await fetchPictaWithRetry('https://api.picta.cu/v2/usuario/me2/', {
      headers: {
        Authorization: `Bearer ${acc.accessToken}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    });
    if (meRes.ok) {
      const encryptedText = (await meRes.text()).trim().replace(/^"|"$/g, '');
      const decipher = crypto.createDecipheriv(
        'aes-128-ecb',
        Buffer.from(PICTA_AES_KEY, 'utf8'),
        null
      );
      let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      const userObj = JSON.parse(decrypted);
      if (userObj?.id) {
        acc.userId = Number(userObj.id);
      }
      if (userObj?.username || userObj?.first_name) {
        acc.displayName = String(userObj.username || userObj.first_name).trim();
      }
      const roles: string[] = Array.isArray(userObj?.groups)
        ? userObj.groups.map((g: any) => String(g?.name || '')).filter(Boolean)
        : [];
      acc.roles = roles;
      acc.canPublishDirectly = roles.some((r: string) => /jefe|editor|admin|productor/i.test(r));
    }
  } catch {
    // Non-fatal
  }

  saveQuotaSettingsToDisk();
  return { token: acc.accessToken, userId: acc.userId };
}

async function ensurePoolAccountAssociatedWithChannel(
  primaryToken: string,
  channelId: string,
  secondaryUserId?: number
): Promise<void> {
  if (!secondaryUserId || secondaryUserId <= 0 || !primaryToken || !channelId) return;
  try {
    let activeToken = primaryToken;
    let endpointBase = `https://api.picta.cu/v3/channel/${encodeURIComponent(channelId)}/`;
    let chRes = await fetchPictaWithRetry(endpointBase, {
      headers: {
        Authorization: `Bearer ${activeToken}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    });
    if (chRes.status === 401) {
      activeToken = await authenticateWithPicta(true);
      chRes = await fetchPictaWithRetry(endpointBase, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      });
    }
    if (chRes.status === 404 || chRes.status === 405) {
      endpointBase = `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`;
      chRes = await fetchPictaWithRetry(endpointBase, {
        headers: {
          Authorization: `Bearer ${activeToken}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      });
    }
    if (!chRes.ok) return;
    const chData = (await chRes.json()) as any;
    const rawAssoc = Array.isArray(chData?.usuarios_asociados) ? chData.usuarios_asociados : [];
    const existingIds = new Set<number>(
      rawAssoc
        .map((u: any) => Number(typeof u === 'object' ? u?.id : u))
        .filter((n: number) => Number.isFinite(n) && n > 0)
    );
    const ownerId = Number(
      typeof chData?.propietario === 'object'
        ? chData.propietario?.id
        : chData?.propietario || 212033
    );
    if (Number.isFinite(ownerId) && ownerId > 0) {
      existingIds.add(ownerId);
    }
    if (existingIds.has(secondaryUserId)) return;

    existingIds.add(secondaryUserId);
    let patchRes = await fetchPictaWithRetry(endpointBase, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: JSON.stringify({ usuarios_asociados: Array.from(existingIds) }),
    });
    if (patchRes.status === 401) {
      activeToken = await authenticateWithPicta(true);
      patchRes = await fetchPictaWithRetry(endpointBase, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
        body: JSON.stringify({ usuarios_asociados: Array.from(existingIds) }),
      });
    }
    if ((patchRes.status === 404 || patchRes.status === 405) && endpointBase.includes('/v3/channel/')) {
      patchRes = await fetchPictaWithRetry(
        `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
          body: JSON.stringify({ usuarios_asociados: Array.from(existingIds) }),
        }
      );
    }
    if (patchRes.ok) {
      addLiveLog(
        'picta',
        'success',
        `Cuenta secundaria (ID #${secondaryUserId}) asociada automáticamente como gestor en el canal #${channelId}.`
      );
    }
  } catch {
    // Non-fatal
  }
}

async function resolveUploadTokenWithQuotaPool(
  chatId: string,
  tipId: number,
  targetChannelId: string,
  excludedTokens: Set<string>,
  preferredAccountKey?: string
): Promise<{
  token: string;
  accountLabel: string;
  poolAccount?: QuotaPoolAccount;
}> {
  ensureDailyQuotaReset();
  const isMaster = isMasterAdminChat(chatId);
  const userContext = getEffectivePictaContext(chatId);
  const chatPoolAccounts = getPoolAccountsForChat(chatId);
  const todayCuba = getTodayCubaDateStr();
  const primaryLabel = getPrimaryAccountLabelForChat(chatId);

  // 1. Explicit manual choice of a Pool collaborator account:
  //    Do NOT use or fall back to the primary account (which may be suspended/limited).
  if (preferredAccountKey && preferredAccountKey.startsWith('pool:')) {
    const targetKey = preferredAccountKey.toLowerCase();
    const chosenAcc = chatPoolAccounts.find(
      (a) => `pool:${String(a.username || '').trim().toLowerCase()}` === targetKey
    );
    if (!chosenAcc) {
      throw new Error(
        'La cuenta colaboradora elegida ya no se encuentra en tu Pool (/cuota). Selecciona otra cuenta para reintentar.'
      );
    }
    const { token: poolToken, userId } = await authenticatePoolPictaAccount(chosenAcc, false);
    if (excludedTokens.has(poolToken)) {
      throw new Error(
        `La cuenta colaboradora ${chosenAcc.displayName || chosenAcc.username} alcanzó su límite o fue rechazada por Picta. Cambia de cuenta manualmente para reintentar.`
      );
    }
    const chanStr = String(targetChannelId || '');
    if (chanStr && (!Array.isArray(chosenAcc.associatedChannelIds) || !chosenAcc.associatedChannelIds.includes(chanStr))) {
      const primaryTokenOpt = await userContext.accessTokenPromise.catch(() => '');
      if (primaryTokenOpt) {
        await ensurePoolAccountAssociatedWithChannel(primaryTokenOpt, chanStr, userId).catch(() => {});
      }
      chosenAcc.associatedChannelIds = Array.from(
        new Set([...(chosenAcc.associatedChannelIds || []), chanStr])
      );
      savePoolAccountsForChat(chatId);
    }
    return {
      token: poolToken,
      accountLabel: chosenAcc.displayName || chosenAcc.username,
      poolAccount: chosenAcc,
    };
  }

  const primaryToken = await userContext.accessTokenPromise;

  // 2. Explicit manual choice of Primary account (no automatic fallback to collaborators):
  if (preferredAccountKey === 'primary') {
    if (excludedTokens.has(primaryToken)) {
      throw new Error(
        `La cuenta principal (${primaryLabel}) fue rechazada o alcanzó su límite en Picta. Cambia manualmente a una cuenta colaboradora para subir en el canal #${targetChannelId}.`
      );
    }
    return {
      token: primaryToken,
      accountLabel: primaryLabel,
    };
  }

  if (!isMaster) {
    if (!excludedTokens.has(primaryToken)) {
      return {
        token: primaryToken,
        accountLabel: primaryLabel,
      };
    }
    throw new Error(
      `QUOTA_DAILY_LIMIT_REACHED: Se alcanzó el límite diario de 10 publicaciones por cuenta en Picta para tu usuario en el canal #${targetChannelId}. El video queda guardado en tu cola para reanudarse mañana con 1 clic.`
    );
  }

  const publishablePoolAccounts = chatPoolAccounts.filter(
    (a) => a.canPublishDirectly !== false
  );
  const totalAccounts = 1 + publishablePoolAccounts.length;
  const effectiveSeriesCap =
    quotaSettings.maxSeriesPerDay > 0
      ? quotaSettings.maxSeriesPerDay + publishablePoolAccounts.length * 10
      : totalAccounts * 10;

  if (
    tipId === 5 &&
    quotaSettings.maxSeriesPerDay > 0 &&
    quotaSettings.seriesUploadedToday >= effectiveSeriesCap
  ) {
    throw new Error(
      `QUOTA_SERIE_RESERVED_REACHED: Se alcanzó el cupo diario asignado a capítulos de Series (${quotaSettings.seriesUploadedToday}/${effectiveSeriesCap} hoy). Los cupos restantes del día están reservados para películas u otros videos. Puedes liberar la reserva con 1 clic o añadir otra cuenta al Pool Multi-Cuenta en /cuota.`
    );
  }

  if (quotaSettings.primaryExhaustedDate !== todayCuba && !excludedTokens.has(primaryToken)) {
    return {
      token: primaryToken,
      accountLabel: primaryLabel,
    };
  }

  for (const acc of publishablePoolAccounts) {
    if ((acc.uploadedToday || 0) >= 10 || acc.exhaustedDate === todayCuba) continue;
    try {
      const { token: poolToken, userId } = await authenticatePoolPictaAccount(acc, false);
      if (acc.canPublishDirectly === false) {
        savePoolAccountsForChat(chatId);
        addLiveLog(
          'picta',
          'warn',
          `Omitiendo cuenta secundaria ${acc.username} porque tiene rol "Usuario común" (requiere "Jefe de canal" para publicar directamente).`
        );
        continue;
      }
      if (excludedTokens.has(poolToken)) continue;
      await ensurePoolAccountAssociatedWithChannel(primaryToken, targetChannelId, userId);
      return {
        token: poolToken,
        accountLabel: acc.displayName || acc.username,
        poolAccount: acc,
      };
    } catch (poolErr) {
      addLiveLog(
        'picta',
        'warn',
        `No se pudo usar la cuenta secundaria ${acc.username} del Pool: ${poolErr instanceof Error ? poolErr.message : String(poolErr)}`
      );
    }
  }

  const commonOnlyCount = chatPoolAccounts.filter(
    (a) => a.canPublishDirectly === false
  ).length;
  const roleHint =
    commonOnlyCount > 0
      ? ` (${commonOnlyCount} cuenta(s) secundaria(s) omitida(s) por rol "Usuario común" sin permiso "Jefe de canal")`
      : '';

  throw new Error(
    `QUOTA_DAILY_LIMIT_REACHED: Se alcanzó el límite diario de 10 publicaciones por cuenta en Picta (${totalAccounts} cuenta(s) con rol Jefe de canal agotadas hoy${roleHint}). Añade otra cuenta con rol Jefe de canal en /cuota (+10 subidas diarias reales al canal #${targetChannelId}) o reanuda la cola mañana con 1 clic.`
  );
}

/**
 * Uploads an external subtitle file (.srt / .vtt) to S3 MinIO and returns its public URL.
 * Never send raw Blob to url_subtitulo in /v1/publicacion/ because Django REST expects a URL string!
 */
async function uploadSubtitleBufferToMinioS3(
  token: string,
  subBuf: Buffer,
  fileName: string
): Promise<string | null> {
  try {
    const credRes = await fetchPictaWithRetry(
      'https://api.picta.cu/v2/publicacion/devolver_url_minio/',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      }
    );
    if (!credRes.ok) return null;
    const credData = (await credRes.json()) as any;
    const s3Endpoint: string = credData?.url_minio?.[0];
    const s3Fields: Record<string, string> = credData?.url_minio?.[1];
    if (!s3Endpoint || !s3Fields?.key) return null;

    const s3Form = new FormData();
    for (const [k, v] of Object.entries(s3Fields)) {
      s3Form.append(k, v);
    }
    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'subtitulo.srt';
    s3Form.append(
      'file',
      new Blob([new Uint8Array(subBuf)], { type: 'text/plain' }),
      cleanName
    );

    const s3Res = await fetch(s3Endpoint, {
      method: 'POST',
      body: s3Form,
    });
    if (!s3Res.ok && s3Res.status !== 204) {
      return null;
    }
    const cleanEndpoint = s3Endpoint.replace(/\/+$/, '');
    return `${cleanEndpoint}/${s3Fields.key}`;
  } catch (err) {
    addLiveLog(
      'picta',
      'warn',
      `Error al subir archivo de subtítulos a MinIO S3: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * PHASE 3 & 4: Upload 100% of verified file to S3 MinIO using native Node.js stream.pipe()
 * (no manual pause/drain deadlock), then create publication on /v1/publicacion/ and trigger proxy_nomad
 */
async function uploadFullVerifiedFileToPicta(
  job: VideoTransferJob,
  filePath: string,
  statusMsgId: number | null
): Promise<void> {
  const isMaster = isMasterAdminChat(job.telegramChatId);
  const userContext = getEffectivePictaContext(job.telegramChatId);
  if (!userContext.isLinked || !userContext.channelId) {
    throw new Error(
      'Tu cuenta de Picta no tiene un canal vinculado. Usa /login para iniciar sesión y conectar tu propio canal.'
    );
  }
  const masterChanId = botConfig.pictaChannelId || '36319';
  const targetChannelId =
    job.targetChannelId && (isMaster || job.targetChannelId !== masterChanId)
      ? job.targetChannelId
      : userContext.channelId;
  const targetChannelName = job.targetChannelName || userContext.channelName || 'Mi Canal';
  const tipId = Number(job.tipologiaId || botConfig.pictaTipologiaId || 8);
  const excludedTokens = new Set<string>();

  let activeAuth = await resolveUploadTokenWithQuotaPool(
    job.telegramChatId,
    tipId,
    targetChannelId,
    excludedTokens,
    job.preferredUploadAccountKey
  );
  let accessToken = activeAuth.token;
  job.preferredUploadAccountLabel = activeAuth.accountLabel;
  saveJobsToDisk();

  const fileSize =
    filePath && fs.existsSync(filePath)
      ? fs.statSync(filePath).size
      : job.diskVerifiedBytes || job.expectedBytes;
  const maxS3Attempts = 8;
  let finalMinioKey = job.minioKey || '';

  // If the file was ALREADY successfully sent to MinIO S3 in a previous step/retry, skip re-uploading
  if (finalMinioKey) {
    addLiveLog(
      'picta',
      'info',
      `El video "${job.fileName}" ya se encuentra 100% alojado en S3 MinIO (key=${finalMinioKey}). Reutilizando archivo y pasando directo a creación de publicación.`
    );
  } else {
    for (let attempt = 1; attempt <= maxS3Attempts; attempt++) {
      try {
        const minioCredRes = await fetchPictaWithRetry(
          'https://api.picta.cu/v2/publicacion/devolver_url_minio/',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Origin: 'https://admin.picta.cu',
              Referer: 'https://admin.picta.cu/',
            },
          }
        );

        if (!minioCredRes.ok) {
          const errTxt = await minioCredRes.text();
          if (!job.preferredUploadAccountKey && isDailyLimitErrorText(errTxt)) {
            excludedTokens.add(accessToken);
            if (isMaster) {
              const todayCuba = getTodayCubaDateStr();
              if (activeAuth.poolAccount) {
                activeAuth.poolAccount.uploadedToday = 10;
                activeAuth.poolAccount.exhaustedDate = todayCuba;
              } else {
                quotaSettings.primaryExhaustedDate = todayCuba;
              }
              saveQuotaSettingsToDisk();
            }
            activeAuth = await resolveUploadTokenWithQuotaPool(
              job.telegramChatId,
              tipId,
              targetChannelId,
              excludedTokens,
              job.preferredUploadAccountKey
            );
            accessToken = activeAuth.token;
            addLiveLog(
              'picta',
              'info',
              `🔄 Límite diario de 10 videos alcanzado en cuenta anterior. Rotando automáticamente a cuenta del Pool: ${activeAuth.accountLabel}`
            );
            attempt--;
            continue;
          }
          throw new Error(
            `Error HTTP ${minioCredRes.status} en devolver_url_minio (${activeAuth.accountLabel}): ${errTxt.slice(0, 180)}`
          );
        }

        const minioData = (await minioCredRes.json()) as any;
        const s3Endpoint: string = minioData?.url_minio?.[0];
        const s3Fields: Record<string, string> = minioData?.url_minio?.[1];

        if (!s3Endpoint || !s3Fields || !s3Fields.key) {
          throw new Error('Respuesta inválida de devolver_url_minio.');
        }

        finalMinioKey = s3Fields.key;
        job.minioKey = s3Fields.key;
        job.stage = 'uploading_full_file_to_picta';
        job.uploadedBytes = 0;
        job.updatedAt = new Date().toISOString();
        saveJobsToDisk();

        await editTelegramStatusMessage(
          job.telegramChatId,
          statusMsgId,
          `${hudHeader('FASE 3/4 · CONECTANDO CON S3 PICTA')}\n` +
            hudBox([
              `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
              `🔑 <b>Manifiesto MinIO:</b> <code>${finalMinioKey}</code>`,
              `📤 <b>Tamaño a enviar:</b> ${formatBytes(fileSize)}`,
            ]) +
            `\n⏳ <i>Iniciando transmisión directa hacia videos.picta.cu...</i>`,
          undefined,
          true
        );

        addLiveLog(
          'picta',
          'info',
          `Subiendo archivo 100% entero (${formatBytes(fileSize)}) a S3 MinIO (${s3Endpoint}, key: ${s3Fields.key}, intento ${attempt}/${maxS3Attempts})...`
        );

        const boundary = `----PictaMinioS3Boundary${Date.now().toString(16)}`;
        const crlf = '\r\n';
        const orderedS3Keys = [
          'bucket',
          'key',
          'Content-Type',
          'policy',
          'x-amz-algorithm',
          'x-amz-credential',
          'x-amz-date',
          'x-amz-signature',
        ];

        let prologueStr = '';
        for (const k of orderedS3Keys) {
          if (s3Fields[k] !== undefined) {
            prologueStr += `--${boundary}${crlf}`;
            prologueStr += `Content-Disposition: form-data; name="${k}"${crlf}${crlf}`;
            prologueStr += `${s3Fields[k]}${crlf}`;
          }
        }

        const safeFileName = path.basename(job.fileName).replace(/"/g, '');
        prologueStr += `--${boundary}${crlf}`;
        prologueStr += `Content-Disposition: form-data; name="file"; filename="${safeFileName}"${crlf}`;
        prologueStr += `Content-Type: ${job.mimeType || 'video/mp4'}${crlf}${crlf}`;

        const epilogueStr = `${crlf}--${boundary}--${crlf}`;
        const prologueBuf = Buffer.from(prologueStr, 'utf-8');
        const epilogueBuf = Buffer.from(epilogueStr, 'utf-8');
        const totalContentLength =
          prologueBuf.byteLength + fileSize + epilogueBuf.byteLength;

        const parsedS3Url = new URL(s3Endpoint);
        const isHttps = parsedS3Url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const startTime = Date.now();
        let lastTelegramEdit = 0;

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const failOnce = (err: Error) => {
            if (settled) return;
            settled = true;
            reject(err);
          };

          const req = transport.request(
            {
              protocol: parsedS3Url.protocol,
              hostname: parsedS3Url.hostname,
              port: parsedS3Url.port || (isHttps ? 443 : 80),
              path: parsedS3Url.pathname + parsedS3Url.search,
              method: 'POST',
              headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': totalContentLength,
                Origin: 'https://admin.picta.cu',
                Referer: 'https://admin.picta.cu/',
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (d) => chunks.push(Buffer.from(d)));
              res.on('end', () => {
                if (settled) return;
                settled = true;
                const bodyText = Buffer.concat(chunks).toString('utf-8');
                job.pictaResponseCode = res.statusCode || 0;
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                  job.uploadedBytes = fileSize;
                  resolve();
                } else {
                  reject(
                    new Error(
                      `Error S3 MinIO HTTP ${res.statusCode}: ${bodyText.slice(0, 220) || res.statusMessage}`
                    )
                  );
                }
              });
            }
          );

          req.on('socket', (sock) => {
            sock.setNoDelay?.(true);
            sock.setKeepAlive?.(true, 10_000);
          });

          req.setTimeout(600_000, () => {
            req.destroy(new Error('Timeout de red (10 minutos sin respuesta de videos.picta.cu)'));
          });

          const readStream = fs.createReadStream(filePath, {
            highWaterMark: S3_UPLOAD_HIGH_WATER_MARK_BYTES, // 256 KB strict lean RAM profile on Ephemeral Disk
          });

          req.on('error', (err: any) => {
            readStream.destroy();
            const detail =
              err?.message ||
              err?.code ||
              (Array.isArray(err?.errors)
                ? err.errors.map((e: any) => e?.message || e?.code).join(', ')
                : 'Conexión reiniciada por videos.picta.cu');
            failOnce(new Error(`Error de red en S3 Picta: ${detail}`));
          });

          readStream.on('error', (err) => {
            req.destroy(err);
            failOnce(err);
          });

          void (async () => {
            try {
              if (!req.write(prologueBuf)) {
                await new Promise<void>((r) => req.once('drain', r));
              }
              for await (const chunk of readStream) {
                if (settled) break;
                if (cancelledJobIds.has(job.id)) {
                  req.destroy(new Error('SUBIDA_CANCELADA_POR_USUARIO'));
                  failOnce(new Error('SUBIDA_CANCELADA_POR_USUARIO'));
                  break;
                }
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                if (!req.write(buf)) {
                  await new Promise<void>((r) => req.once('drain', r));
                }
                job.uploadedBytes += buf.byteLength;
                const elapsedSec = Math.max(0.5, (Date.now() - startTime) / 1000);
                job.speedMBps = Number(
                  (job.uploadedBytes / (1024 * 1024) / elapsedSec).toFixed(2)
                );
                const pct = Math.min(100, Math.round((job.uploadedBytes / fileSize) * 100));

                currentActivity = `Subiendo archivo entero a S3 Picta (${s3Fields.key}): ${formatBytes(job.uploadedBytes)} / ${formatBytes(fileSize)} (${pct}%) a ${job.speedMBps} MB/s`;

                const now = Date.now();
                if (now - lastTelegramEdit > 4000) {
                  lastTelegramEdit = now;
                  const qCount = uploadQueue.length;
                  void editTelegramStatusMessage(
                    job.telegramChatId,
                    statusMsgId,
                    `${hudHeader('FASE 3/4 · TRANSMITIENDO A S3 PICTA')}\n` +
                      hudBox([
                        `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
                        `🔑 <b>Manifiesto:</b> <code>${s3Fields.key}</code>`,
                        `📊 <b>Progreso:</b> <code>${renderVisualBar(pct)}</code>`,
                        `📤 <b>Enviado:</b> ${formatBytes(job.uploadedBytes)} / ${formatBytes(fileSize)}`,
                        `⚡ <b>Velocidad:</b> ${job.speedMBps} MB/s`,
                        qCount > 0 ? `⏳ <b>En cola después:</b> ${qCount} video(s)` : null,
                      ]) +
                      `\n<i>Esperando confirmación 100% antes de crear la ficha en Picta.</i>`,
                    [[{ text: '🛑 Cancelar subida', callback_data: `cancel_job:${job.id}` }]]
                  );
                }
              }
              if (!settled) {
                req.end(epilogueBuf);
              }
            } catch (streamErr: any) {
              if (!settled) {
                failOnce(
                  streamErr instanceof Error ? streamErr : new Error(String(streamErr))
                );
              }
            }
          })();
        });

        break;
      } catch (s3Err) {
        const errMsg = s3Err instanceof Error ? s3Err.message : String(s3Err);
        if (
          errMsg.includes('SUBIDA_CANCELADA_POR_USUARIO') ||
          errMsg.includes('QUOTA_') ||
          cancelledJobIds.has(job.id)
        ) {
          throw s3Err instanceof Error ? s3Err : new Error(errMsg);
        }
        if (attempt < maxS3Attempts) {
          const backoffSec = Math.min(20, attempt * 4);
          addLiveLog(
            'picta',
            'warn',
            `Reintentando subida S3 MinIO (${attempt}/${maxS3Attempts}) en ${backoffSec}s tras: ${errMsg.slice(0, 110)}`
          );
          await new Promise((r) => setTimeout(r, backoffSec * 1000));
        } else {
          throw s3Err;
        }
      }
    }
  }

  if (cancelledJobIds.has(job.id)) {
    throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
  }

  addLiveLog(
    'picta',
    'success',
    `Archivo 100% verificado en S3 MinIO (key=${finalMinioKey}, ${fileSize.toLocaleString()} bytes). Creando publicación en ${targetChannelName} (#${targetChannelId})...`
  );

  // STEP C: Create publication on https://api.picta.cu/v1/publicacion/
  job.stage = 'creating_picta_publication';
  currentActivity = `Creando publicación "${job.title}" (${job.category || 'Audiovisual'}) en ${targetChannelName}...`;
  saveJobsToDisk();

  await editTelegramStatusMessage(
    job.telegramChatId,
    statusMsgId,
    `${hudHeader(`FASE 4/4 · PUBLICANDO EN ${targetChannelName}`)}\n` +
      hudBox([
        `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
        `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
        `🔑 <b>Manifiesto:</b> <code>${finalMinioKey}</code>`,
      ]) +
      `\n⏳ <i>Registrando ficha técnica, portada y reparto en Picta...</i>`
  );

  const meta = job.modelMetadata || {};
  const parsedSerieInfo = extractSeriesInfoFromText(job.fileName, job.caption);

  const fallbackBuf = Buffer.from(FALLBACK_JPEG_BASE64, 'base64');
  let customCoverBuf: Buffer | null = null;
  let customPosterBuf: Buffer | null = null;
  let onlineBackdropBuf: Buffer | null = null;
  let onlinePosterBuf: Buffer | null = null;
  let videoFrameBuf: Buffer | null = null;

  // 1. User's explicit custom cover & custom poster for this video ALWAYS win first
  if (job.customCoverFileId) {
    const downloadedCustom = await downloadTelegramThumbnailBuffer(job.customCoverFileId);
    if (downloadedCustom && downloadedCustom.byteLength > 100) {
      customCoverBuf = downloadedCustom;
    }
  }
  if (job.customPosterFileId) {
    const downloadedPoster = await downloadTelegramThumbnailBuffer(job.customPosterFileId);
    if (downloadedPoster && downloadedPoster.byteLength > 100) {
      customPosterBuf = downloadedPoster;
    }
  }

  // 2. For Series (tipId === 5): BEFORE falling back to Telegram's random video frame thumbnail,
  // ALWAYS prioritize the Serie's official cover (pinned batch cover, channelSeriesCache, Picta /v1/serie/, or TVMaze/Wikipedia poster)!
  if (!customCoverBuf && tipId === 5) {
    const pinnedForChat = pinnedBatchSerieByChat.get(job.telegramChatId);
    const sPelserId = Number(meta.serie_pelser_id || pinnedForChat?.pelserId || 0);
    const sNameLookup = String(
      meta.serie || pinnedForChat?.serieName || parsedSerieInfo.serieName || ''
    ).trim();
    const serieRec = findUserChannelSerie(sPelserId, job.telegramChatId) ||
      filterSeriesForChannel(channelSeriesCache, targetChannelId, isMaster).find(
        (s) =>
          sNameLookup &&
          cleanSerieDisplayName(s.nombre).toLowerCase() ===
            cleanSerieDisplayName(sNameLookup).toLowerCase()
      );

    const customSerieCoverFileId =
      pinnedForChat?.customCoverFileId || serieRec?.customCoverFileId;
    if (customSerieCoverFileId) {
      const tgSerieCover = await downloadTelegramThumbnailBuffer(customSerieCoverFileId);
      if (tgSerieCover && tgSerieCover.byteLength > 100) {
        customCoverBuf = tgSerieCover;
        addLiveLog(
          'picta',
          'info',
          `Portada personalizada de la serie "${sNameLookup || serieRec?.nombre || 'Serie'}" aplicada automáticamente a "${job.title}".`
        );
      }
    }

    let officialSerieCoverUrl =
      pinnedForChat?.coverUrl ||
      serieRec?.coverUrl ||
      (isMaster && (sPelserId === 4054 || /mentalista/i.test(sNameLookup))
        ? 'https://www.picta.cu/imagen/poster_L6utIgf.jpeg'
        : '') ||
      String(meta.onlineBackdropUrl || meta.onlineCoverUrl || '');

    // If we don't have the official cover URL cached yet, query Picta API /v1/serie/{pelser_id}/ live
    if (!officialSerieCoverUrl && sPelserId > 0) {
      try {
        const sDetailRes = await fetchPictaWithRetry(
          `https://api.picta.cu/v1/serie/${sPelserId}/`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Origin: 'https://admin.picta.cu',
              Referer: 'https://admin.picta.cu/',
            },
          }
        );
        if (sDetailRes.ok) {
          const sDetail = (await sDetailRes.json()) as any;
          const fetchedUrl = String(sDetail?.url_imagen || sDetail?.imagen_secundaria || '').trim();
          if (fetchedUrl) {
            officialSerieCoverUrl = fetchedUrl;
            upsertChannelSerieRecord(sPelserId, sDetail?.nombre || sNameLookup, undefined, {
              canalId: Number(targetChannelId),
              coverUrl: fetchedUrl,
            });
          }
        }
      } catch {
        // Ignore
      }
    }

    if (!customCoverBuf && officialSerieCoverUrl) {
      try {
        const imgRes = await fetch(officialSerieCoverUrl);
        if (imgRes.ok) {
          const arr = await imgRes.arrayBuffer();
          if (arr.byteLength > 100) {
            onlineBackdropBuf = Buffer.from(arr);
            addLiveLog(
              'picta',
              'info',
              `Portada oficial de la serie "${serieRec?.nombre || sNameLookup || 'Serie'}" (${officialSerieCoverUrl}) reutilizada automáticamente para "${job.title}".`
            );
          }
        }
      } catch {
        // Fallback below
      }
    }
  }

  // 3. For Movies/Other categories without custom cover: fetch official horizontal backdrop & vertical poster separately from TMDB/IMDb
  if (meta.preferVideoFrameCover !== 'true') {
    const backdropUrl = String(meta.onlineBackdropUrl || '').trim();
    const posterUrl = String(meta.onlinePosterUrl || meta.onlineCoverUrl || '').trim();
    if (!customCoverBuf && !onlineBackdropBuf && backdropUrl) {
      try {
        const bRes = await fetch(backdropUrl);
        if (bRes.ok) {
          const arr = await bRes.arrayBuffer();
          if (arr.byteLength > 200) {
            onlineBackdropBuf = Buffer.from(arr);
          }
        }
      } catch {
        // Fallback below
      }
    }
    if (!customPosterBuf && posterUrl) {
      if (posterUrl === backdropUrl && onlineBackdropBuf) {
        onlinePosterBuf = onlineBackdropBuf;
      } else {
        try {
          const pRes = await fetch(posterUrl);
          if (pRes.ok) {
            const arr = await pRes.arrayBuffer();
            if (arr.byteLength > 200) {
              onlinePosterBuf = Buffer.from(arr);
              if (!customCoverBuf && !onlineBackdropBuf) {
                addLiveLog(
                  'picta',
                  'info',
                  `Carátula oficial HD (TMDB/IMDb) aplicada automáticamente para "${job.title}".`
                );
              }
            }
          }
        } catch {
          // Fallback below
        }
      }
    }
  }

  // 4. Last fallback before default JPEG: Telegram's embedded video frame thumbnail
  if (!customCoverBuf && !onlineBackdropBuf && !onlinePosterBuf && job.thumbnailFileId) {
    const downloadedThumb = await downloadTelegramThumbnailBuffer(job.thumbnailFileId);
    if (downloadedThumb && downloadedThumb.byteLength > 100) {
      videoFrameBuf = downloadedThumb;
    }
  }

  const { urlImagenBuf: coverBuffer, imagenSecundariaBuf: posterBuffer } = selectUploadPairBuffers({
    customCoverBuf,
    customPosterBuf,
    onlineBackdropBuf,
    onlinePosterBuf,
    videoFrameBuf,
    preferVideoFrameCover: meta.preferVideoFrameCover === 'true',
    fallbackBuf,
  });

  // If user uploaded a custom cover for a Serie chapter, remember it on the Serie record for future chapters
  if (tipId === 5 && job.customCoverFileId) {
    const sPelserId = Number(meta.serie_pelser_id || 0);
    const sNameLookup = String(meta.serie || parsedSerieInfo.serieName || '').trim();
    if (sPelserId > 0 || sNameLookup) {
      upsertChannelSerieRecord(sPelserId, sNameLookup, undefined, {
        canalId: Number(targetChannelId),
        customCoverFileId: job.customCoverFileId,
      });
    }
  }
  if (tipId === 5) {
    const metaSerieStr = String(meta.serie || '');
    const sName = String(
      (!isGenericOrInvalidSerieName(metaSerieStr) ? metaSerieStr : '') ||
        parsedSerieInfo.serieName ||
        `Serie ${targetChannelName}`
    );
    const sSeason = String(
      (Array.isArray(meta.temporada) ? meta.temporada[0] : meta.temporada) ||
        parsedSerieInfo.temporada ||
        '1'
    );
    const metaEp = Array.isArray(meta.numero) ? meta.numero[0] : meta.numero;
    const sEp = String(
      metaEp && !(String(metaEp) === '1' && Number(parsedSerieInfo.numero) > 1)
        ? metaEp
        : parsedSerieInfo.numero || '1'
    );
    const epSub = String(meta.episodeSubtitle || parsedSerieInfo.episodeSubtitle || '').trim();

    if (
      !job.title ||
      /^Serie\s*-\s*T\d+:E\d+$/i.test(job.title.trim()) ||
      job.titleMode !== 'manual'
    ) {
      job.title = formatSerieEpisodeTitle(sName, sSeason, sEp, epSub);
    }

    // Never leave the raw episode title line (e.g. "S01E01: Pilot | Piloto"), stale "video telegram...", or English synopsis
    const cleanSName = cleanSerieDisplayName(sName) || sName;
    if (isLikelyEnglishText(job.synopsis)) {
      job.synopsis = await translateTextToSpanishIfNeeded(job.synopsis);
    }
    if (
      isStaleOrGenericSerieSynopsis(job.synopsis, job.caption, sEp) ||
      isLikelyEnglishText(job.synopsis)
    ) {
      const candidateEpSyn = String(meta.episodeSynopsis || '').trim();
      const spanishEpSyn = candidateEpSyn
        ? await translateTextToSpanishIfNeeded(candidateEpSyn)
        : '';
      job.synopsis =
        spanishEpSyn ||
        `Capítulo ${sEp} de la Temporada ${sSeason} de la serie ${cleanSName}${epSub ? ` titulado "${epSub}"` : ''}, disponible en el canal ${targetChannelName}.`;
    }
    job.synopsis = sanitizePublicPictaText(job.synopsis);
  } else {
    if (isLikelyEnglishText(job.synopsis)) {
      const translated = await translateTextToSpanishIfNeeded(job.synopsis);
      job.synopsis =
        translated ||
        `${job.title}. Publicado en la categoría ${job.category || 'Audiovisual'} del canal ${targetChannelName} en Picta.`;
    }
    job.synopsis = sanitizePublicPictaText(job.synopsis || job.title);
  }

  // When a collaborator is active, prefer their own token for catalog lookups & serie/season creation so a restricted primary account never blocks the upload
  const catalogAdminToken = activeAuth.poolAccount
    ? accessToken
    : (await userContext.accessTokenPromise.catch(() => '')) || accessToken;

  const pubForm = new FormData();
  pubForm.append('tipo', 'publicacion');
  pubForm.append('tipologia', String(tipId));
  pubForm.append('nombre', sanitizePublicPictaText(job.title));
  pubForm.append('descripcion', sanitizePublicPictaText(job.synopsis || job.title));
  pubForm.append('canal', targetChannelId);
  pubForm.append('url_manifiesto', finalMinioKey);
  pubForm.append('publicado', 'true');
  pubForm.append('descargable', 'true');
  pubForm.append('mostrar_comentarios', 'true');
  pubForm.append('mostrar_chat', 'false');
  pubForm.append('internacional', 'false');
  pubForm.append('es_exclusivo', 'false');
  pubForm.append('clasificacion', botConfig.pictaClasificacion || '18+');
  pubForm.append('palabraClave', botConfig.pictaPalabraClaveId || '5476');

  // Specific model fields per Picta category requirements (100% auto-filled behind the scenes)
  if (tipId === 1) {
    // Película: ALL relational fields are PrimaryKeyRelatedField in Django REST and require integer IDs
    const releaseYear = String(meta.ano || (job.title.match(/\b(19\d\d|20\d\d)\b/) || [])[1] || '2024');
    pubForm.append('ano', releaseYear);
    pubForm.append('pais', String(meta.pais || 'Internacional'));

    // Genero IDs (from /v2/genero/)
    const genreIds = resolveGenreIds(meta.genero_ids || meta.genero_id || meta.genero);
    for (const gid of genreIds) {
      pubForm.append('genero', String(gid));
    }

    // Productora ID (from /v2/extra/?tipo=productora)
    const prodId = await resolveProductoraId(catalogAdminToken, String(meta.productora || ''));
    pubForm.append('productora', String(prodId));

    // Personas: Director, Guion, Reparto, Fotografia, Musica (must be numeric IDs)
    const directorNames = String(meta.director || 'Dirección General').split(/[,/|]/);
    const directorIds = await resolvePersonaIds(catalogAdminToken, directorNames, 1022);
    for (const did of directorIds) {
      pubForm.append('director', String(did));
    }

    const guionNames = String(meta.guion || meta.director || 'Guión Original').split(/[,/|]/);
    const guionIds = await resolvePersonaIds(catalogAdminToken, guionNames, 1022);
    for (const gid of guionIds) {
      pubForm.append('guion', String(gid));
    }

    const repartoNames = String(meta.reparto || 'Elenco Principal').split(/[,/|]/);
    const repartoIds = await resolvePersonaIds(catalogAdminToken, repartoNames, 646);
    for (const rid of repartoIds) {
      pubForm.append('reparto', String(rid));
    }

    const fotoNames = String(meta.fotografia || 'Cinematografía').split(/[,/|]/);
    const fotoIds = await resolvePersonaIds(catalogAdminToken, fotoNames, 1022);
    for (const fid of fotoIds) {
      pubForm.append('fotografia', String(fid));
    }

    const musicaNames = String(meta.musica || 'Banda Sonora').split(/[,/|]/);
    const musicaIds = await resolvePersonaIds(catalogAdminToken, musicaNames, 1022);
    for (const mid of musicaIds) {
      pubForm.append('musica', String(mid));
    }

    // Premio: MANDATORY in Picta Película (ID 469 = 'Ninguno')
    const premioVal = meta.premio_id ? String(meta.premio_id) : meta.premio ? String(meta.premio) : undefined;
    const premioId = await resolvePremioId(catalogAdminToken, premioVal);
    pubForm.append('premio', String(premioId || 469));
  } else if (tipId === 2) {
    // Documental: pais y productora (ID 679 = 'desconocido')
    pubForm.append('pais', String(meta.pais || 'Cuba / Internacional'));
    const prodId = await resolveProductoraId(catalogAdminToken, String(meta.productora || ''));
    pubForm.append('productora', String(prodId || 679));
  } else if (tipId === 5) {
    // Serie: automatically ensure Serie & Temporada exist in user's own channel
    const metaSerieStr = String(meta.serie || '');
    const cleanSerie = String(
      (!isGenericOrInvalidSerieName(metaSerieStr) ? metaSerieStr : '') ||
        parsedSerieInfo.serieName ||
        `Serie ${targetChannelName}`
    );
    const seasonInput = Array.isArray(meta.temporada)
      ? meta.temporada[0]
      : meta.temporada || parsedSerieInfo.temporada;
    const metaEp = Array.isArray(meta.numero) ? meta.numero[0] : meta.numero;
    const epInput =
      metaEp && !(String(metaEp) === '1' && Number(parsedSerieInfo.numero) > 1)
        ? metaEp
        : parsedSerieInfo.numero;
    const resolvedTempId = await ensureSerieAndTemporadaId(
      catalogAdminToken,
      cleanSerie,
      seasonInput,
      meta,
      coverBuffer,
      targetChannelId,
      targetChannelName,
      isMaster
    );
    pubForm.append('temporada', String(resolvedTempId));
    pubForm.append('numero', String(epInput || '1'));
  } else if (tipId === 3 || tipId === 14) {
    // Video Musical / Deporte (modelo: video, schema: gr)
    const releaseYear = String(meta.ano || (job.title.match(/\b(19\d\d|20\d\d)\b/) || [])[1] || '2024');
    pubForm.append('ano', releaseYear);
    const genreIds = resolveGenreIds(meta.genero_ids || meta.genero_id || meta.genero);
    for (const gid of genreIds) {
      pubForm.append('genero', String(gid));
    }
    const interpreteIds = await resolvePersonaIds(catalogAdminToken, String(meta.interprete || 'Artista Principal').split(/[,/|]/), 1022);
    for (const iid of interpreteIds) pubForm.append('interprete', String(iid));
    const directorIds = await resolvePersonaIds(catalogAdminToken, String(meta.director || 'Dirección Audiovisual').split(/[,/|]/), 1022);
    for (const did of directorIds) pubForm.append('director', String(did));
    const productorIds = await resolvePersonaIds(catalogAdminToken, String(meta.productor || 'Producción Audiovisual').split(/[,/|]/), 1022);
    for (const pid of productorIds) pubForm.append('productor', String(pid));
  } else if (tipId === 11) {
    // Videoclip (modelo: videoclip, schema: Gd)
    const releaseYear = String(meta.ano || (job.title.match(/\b(19\d\d|20\d\d)\b/) || [])[1] || '2024');
    const nowIso = new Date().toISOString();
    pubForm.append('ano', releaseYear);
    const genreIds = resolveGenreIds(meta.genero_ids || meta.genero_id || meta.genero);
    for (const gid of genreIds) {
      pubForm.append('genero', String(gid));
    }
    const interpreteIds = await resolvePersonaIds(catalogAdminToken, String(meta.interprete || 'Artista').split(/[,/|]/), 1022);
    for (const iid of interpreteIds) pubForm.append('interprete', String(iid));
    const directorIds = await resolvePersonaIds(catalogAdminToken, String(meta.director || 'Dirección de Videoclip').split(/[,/|]/), 1022);
    for (const did of directorIds) pubForm.append('director', String(did));
    const fotoIds = await resolvePersonaIds(catalogAdminToken, String(meta.director_fotografico || meta.fotografia || 'Cinematografía').split(/[,/|]/), 1022);
    for (const fid of fotoIds) pubForm.append('director_fotografico', String(fid));
    const guionIds = await resolvePersonaIds(catalogAdminToken, String(meta.guionista || meta.guion || 'Guion').split(/[,/|]/), 1022);
    for (const gid of guionIds) pubForm.append('guionista', String(gid));
    pubForm.append('release_date', String(meta.release_date || nowIso));
    pubForm.append('sale_start_date', String(meta.sale_start_date || nowIso));
    pubForm.append('sello', String(meta.sello || 'Independiente'));
  } else if (tipId === 6) {
    // Curso (modelo: curso, schema: Ud)
    const autorIds = await resolvePersonaIds(catalogAdminToken, String(meta.autor || 'Profesor').split(/[,/|]/), 1022);
    for (const aid of autorIds) pubForm.append('autor', String(aid));
    pubForm.append('temporada', String(meta.temporada || '1'));
  }

  // Horizontal cover (16:9)
  pubForm.append(
    'url_imagen',
    new Blob([new Uint8Array(coverBuffer)], { type: 'image/jpeg' }),
    `portada_${Date.now()}.jpg`
  );

  // Vertical poster (required for Película, or whenever customPosterFileId was explicitly provided)
  if (tipId === 1 || job.customPosterFileId) {
    pubForm.append(
      'imagen_secundaria',
      new Blob([new Uint8Array(posterBuffer)], { type: 'image/jpeg' }),
      `poster_secundario_${Date.now()}.jpg`
    );
  }

  // External subtitles (.srt / .vtt) if provided by the user in Paso 4
  if (job.subtitleFileId) {
    try {
      const subBuf = await downloadTelegramThumbnailBuffer(job.subtitleFileId);
      if (subBuf && subBuf.byteLength > 0) {
        const subName = job.subtitleFileName || `subtitulos_${Date.now()}.srt`;
        const subUrl = await uploadSubtitleBufferToMinioS3(accessToken, subBuf, subName);
        if (subUrl) {
          pubForm.append('url_subtitulo', subUrl);
          addLiveLog(
            'picta',
            'info',
            `Subtítulos subidos a MinIO S3 y adjuntados a la publicación: "${subName}" (${subUrl})`
          );
        } else {
          addLiveLog(
            'picta',
            'warn',
            `No se pudo subir subtítulo a MinIO S3. Continuando publicación sin subtítulos para no bloquear la subida.`
          );
        }
      }
    } catch (subErr) {
      addLiveLog(
        'picta',
        'warn',
        `No se pudo descargar el archivo de subtítulos opcional: ${subErr instanceof Error ? subErr.message : String(subErr)}`
      );
    }
  }

  // STEP C.1 & C.2: Pre-validate and create publication on https://api.picta.cu/v1/publicacion/
  // Supports automatic rotation across secondary accounts in the Quota Pool if the 10-video daily limit is hit!
  let createText = '';
  let sawPoolForbidden = false;
  let lastPoolForbiddenLabel = '';
  const maxPubAttempts =
    !job.preferredUploadAccountKey && isMaster ? getPoolAccountsForChat(job.telegramChatId).length + 1 : 0;
  for (let pubAttempt = 0; pubAttempt <= maxPubAttempts; pubAttempt++) {
    try {
      const valRes = await fetchPictaWithRetry(
        'https://api.picta.cu/v1/publicacion/validar_campos/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
          body: pubForm,
        }
      );
      if (!valRes.ok) {
        const valText = await valRes.text();
        const isForbiddenPool =
          isMaster &&
          valRes.status === 403 &&
          Boolean(activeAuth.poolAccount) &&
          /permiso|forbidden/i.test(valText);
        if (!job.preferredUploadAccountKey && (isDailyLimitErrorText(valText) || isForbiddenPool)) {
          excludedTokens.add(accessToken);
          if (isForbiddenPool && activeAuth.poolAccount) {
            sawPoolForbidden = true;
            lastPoolForbiddenLabel = activeAuth.accountLabel;
            activeAuth.poolAccount.canPublishDirectly = false;
            saveQuotaSettingsToDisk();
            addLiveLog(
              'picta',
              'warn',
              `La cuenta secundaria ${activeAuth.accountLabel} subió el archivo 100% a S3 MinIO (${finalMinioKey}), pero tiene rol "Usuario común" (sin permiso directo de publicación). Probando con otra cuenta...`
            );
          } else if (isMaster) {
            const todayCuba = getTodayCubaDateStr();
            if (activeAuth.poolAccount) {
              activeAuth.poolAccount.uploadedToday = 10;
              activeAuth.poolAccount.exhaustedDate = todayCuba;
            } else {
              quotaSettings.primaryExhaustedDate = todayCuba;
            }
            saveQuotaSettingsToDisk();
          }
          try {
            activeAuth = await resolveUploadTokenWithQuotaPool(
              job.telegramChatId,
              tipId,
              targetChannelId,
              excludedTokens
            );
            accessToken = activeAuth.token;
          } catch (rotErr) {
            if (sawPoolForbidden && isMaster) {
              throw new Error(
                `QUOTA_S3_PREUPLOADED_WAITING_SLOT: ¡El archivo de video (${formatBytes(fileSize)}) YA quedó 100% subido y asegurado en el servidor S3 de Picta (ID MinIO: ${finalMinioKey}) gracias a tu cuenta secundaria ${lastPoolForbiddenLabel}! Sin embargo, esa cuenta secundaria es de tipo "Usuario común" (sin rol de Jefe de canal en Picta) y tu cuenta principal ya cumplió sus 10 publicaciones de hoy. El capítulo queda guardado en cola con su video ya subido al 100% para publicarse en 1 segundo (sin volver a subir los megas) apenas se reinicie la cuota o pulses Reintentar.`
              );
            }
            throw rotErr;
          }
          continue;
        }
        if (valRes.status === 400 && valText.includes('Ya existe Contenido con este nombre')) {
          const curName = sanitizePublicPictaText(job.title);
          const yearSuffix =
            meta.ano || (job.title.match(/\b(19\d\d|20\d\d)\b/) || [])[1] || 'HD';
          const resolvedName = curName.includes('(')
            ? `${curName} · v2`
            : `${curName} (${yearSuffix})`;
          addLiveLog(
            'picta',
            'warn',
            `Picta validar_campos detectó título repetido ("${curName}"). Auto-resolviendo a "${resolvedName}" con archivo S3 ya subido...`
          );
          pubForm.set('nombre', resolvedName);
          job.title = resolvedName;
        } else {
          const formattedErr = formatPictaError(valRes.status, valText);
          job.pictaResponseCode = valRes.status;
          job.pictaResponseText = valText;
          addLiveLog('picta', 'error', `Fallo de validación en Picta:\n${formattedErr}`);
          throw new Error(formattedErr);
        }
      }
    } catch (valErr) {
      if (
        valErr instanceof Error &&
        (valErr.message.includes('Error HTTP') || valErr.message.includes('QUOTA_'))
      ) {
        throw valErr;
      }
    }

    const createRes = await fetchPictaWithRetry('https://api.picta.cu/v1/publicacion/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: pubForm,
    });

    createText = await createRes.text();
    job.pictaResponseCode = createRes.status;
    job.pictaResponseText = createText;

    if (!createRes.ok) {
      const isForbiddenPool =
        isMaster &&
        createRes.status === 403 &&
        Boolean(activeAuth.poolAccount) &&
        /permiso|forbidden/i.test(createText);
      if (!job.preferredUploadAccountKey && (isDailyLimitErrorText(createText) || isForbiddenPool)) {
        excludedTokens.add(accessToken);
        if (isForbiddenPool && activeAuth.poolAccount) {
          sawPoolForbidden = true;
          lastPoolForbiddenLabel = activeAuth.accountLabel;
          activeAuth.poolAccount.canPublishDirectly = false;
          saveQuotaSettingsToDisk();
        } else if (isMaster) {
          const todayCuba = getTodayCubaDateStr();
          if (activeAuth.poolAccount) {
            activeAuth.poolAccount.uploadedToday = 10;
            activeAuth.poolAccount.exhaustedDate = todayCuba;
          } else {
            quotaSettings.primaryExhaustedDate = todayCuba;
          }
          saveQuotaSettingsToDisk();
        }
        try {
          activeAuth = await resolveUploadTokenWithQuotaPool(
            job.telegramChatId,
            tipId,
            targetChannelId,
            excludedTokens
          );
          accessToken = activeAuth.token;
        } catch (rotErr) {
          if (sawPoolForbidden && isMaster) {
            throw new Error(
              `QUOTA_S3_PREUPLOADED_WAITING_SLOT: ¡El archivo de video (${formatBytes(fileSize)}) YA quedó 100% subido y asegurado en el servidor S3 de Picta (ID MinIO: ${finalMinioKey}) gracias a tu cuenta secundaria ${lastPoolForbiddenLabel}! Sin embargo, esa cuenta secundaria es de tipo "Usuario común" (sin rol de Jefe de canal en Picta) y tu cuenta principal ya cumplió sus 10 publicaciones de hoy. El capítulo queda guardado en cola con su video ya subido al 100% para publicarse en 1 segundo (sin volver a subir los megas) apenas se reinicie la cuota o pulses Reintentar.`
            );
          }
          throw rotErr;
        }
        continue;
      }

      if (createRes.status === 400 && createText.includes('Ya existe Contenido con este nombre')) {
        const curName = sanitizePublicPictaText(job.title);
        const resolvedName = curName.includes('(')
          ? `${curName} (v2)`
          : `${curName} (${meta.ano || (job.title.match(/\b(19\d\d|20\d\d)\b/) || [])[1] || '2024'})`;
        addLiveLog(
          'picta',
          'warn',
          `Picta detectó título repetido ("${curName}"). Auto-resolviendo a "${resolvedName}" y registrando con archivo S3 ya subido...`
        );
        pubForm.set('nombre', resolvedName);
        const retryRes = await fetchPictaWithRetry('https://api.picta.cu/v1/publicacion/', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
          body: pubForm,
        });
        if (retryRes.ok) {
          createText = await retryRes.text();
          job.pictaResponseCode = retryRes.status;
          job.pictaResponseText = createText;
          break;
        }
      }

      const formattedErr = formatPictaError(createRes.status, createText);
      addLiveLog('picta', 'error', `Fallo al registrar publicación en Picta:\n${formattedErr}`);
      throw new Error(formattedErr);
    }

    break;
  }

  // Record daily quota usage (Master pool stats and per-user pool stats)
  ensureDailyQuotaReset();
  if (activeAuth.poolAccount) {
    activeAuth.poolAccount.uploadedToday = (activeAuth.poolAccount.uploadedToday || 0) + 1;
    savePoolAccountsForChat(job.telegramChatId);
  }
  if (isMaster) {
    if (tipId === 5) {
      quotaSettings.seriesUploadedToday = (quotaSettings.seriesUploadedToday || 0) + 1;
    } else {
      quotaSettings.otherUploadedToday = (quotaSettings.otherUploadedToday || 0) + 1;
    }
    saveQuotaSettingsToDisk();
  }
  invalidateChannelCatalogSnapshotCache(targetChannelId);

  try {
    const createdObj = JSON.parse(createText);
    if (createdObj && createdObj.id) {
      job.pictaPublicationId = Number(createdObj.id);
      if (createdObj.slug_url) {
        job.modelMetadata = {
          ...(job.modelMetadata || {}),
          pictaSlugUrl: String(createdObj.slug_url).trim(),
        };
      }
      if (tipId === 5) {
        const sPelser = Number(meta.serie_pelser_id || 0);
        const sName = cleanSerieDisplayName(
          String(meta.serie || parsedSerieInfo.serieName || 'Serie')
        );
        const sTemp = Number(meta.temporada || parsedSerieInfo.temporada || 1) || 1;
        const sTempId = Number(meta.temporada_id || 0);
        const sEp = Number(meta.numero || parsedSerieInfo.numero || 1) || 1;
        upsertChannelSerieRecord(
          sPelser,
          sName,
          sTempId > 0 ? { id: sTempId, numero: sTemp, nombre: `Temporada ${sTemp}` } : undefined,
          {
            canalId: Number(targetChannelId),
          },
          {
            pubId: job.pictaPublicationId,
            numero: sEp,
            temporada: sTemp,
            ...(sTempId > 0 ? { temporadaId: sTempId } : {}),
            nombre: sanitizePublicPictaText(job.title),
            descripcion: sanitizePublicPictaText(job.synopsis),
            minioKey: finalMinioKey,
            publicado: true,
            convertido: false,
            updatedAt: new Date().toISOString(),
          }
        );
      }
    }
  } catch {
    // Non-fatal
  }

  // Trigger Nomad conversion AFTER 100% S3 upload + publication creation
  try {
    const convForm = new FormData();
    convForm.append('action', 'convert');
    convForm.append('minio_id', finalMinioKey);
    convForm.append('descargable', 'true');
    await fetchPictaWithRetry('https://api.picta.cu/v2/publicacion/proxy_nomad/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: convForm,
    });
    addLiveLog(
      'picta',
      'success',
      `Conversión Nomad iniciada en ${targetChannelName} (#${targetChannelId}, minio_id: ${finalMinioKey}).`
    );
  } catch {
    // Non-fatal
  }
}

let keepAliveActive = false;

function getProtectedScratchPaths(excludeJobId?: string): Set<string> {
  const protectedSet = new Set<string>();
  const protectedIds = new Set<string>();
  if (activeDownloadJobId && activeDownloadJobId !== excludeJobId) protectedIds.add(activeDownloadJobId);
  if (activeUploadJobId && activeUploadJobId !== excludeJobId) protectedIds.add(activeUploadJobId);
  if (activeJobId && activeJobId !== excludeJobId) protectedIds.add(activeJobId);
  for (const id of runningJobIds) {
    if (id !== excludeJobId) protectedIds.add(id);
  }
  for (const j of transferJobs) {
    if (!j || !j.tempFilePath || j.id === excludeJobId) continue;
    const isStagedQueued =
      j.stage === 'queued' &&
      !j.minioKey &&
      Boolean(j.integrityVerified) &&
      (j.expectedBytes === 0 || j.diskVerifiedBytes === j.expectedBytes);
    if (protectedIds.has(j.id) || isStagedQueued) {
      protectedSet.add(j.tempFilePath);
    }
  }
  return protectedSet;
}

function buildPipelineJobsMap(): Map<string, PipelineJobDescriptor> {
  const map = new Map<string, PipelineJobDescriptor>();
  for (const j of transferJobs) {
    if (!j) continue;
    const fileExistsOnDisk = Boolean(j.tempFilePath && fs.existsSync(j.tempFilePath));
    const isQuotaPaused =
      j.stage === 'queued' &&
      Boolean(
        j.errorDetails &&
          (j.errorDetails.includes('QUOTA_') || isDailyLimitErrorText(j.errorDetails))
      );
    const isEncoderPaused = isEncoderJobPausedInQueue(j);
    map.set(j.id, {
      id: j.id,
      telegramChatId: j.telegramChatId,
      stage: isQuotaPaused ? 'quota_paused' : isEncoderPaused ? 'encoder_paused' : j.stage,
      expectedBytes: j.expectedBytes,
      diskVerifiedBytes: j.diskVerifiedBytes,
      integrityVerified: j.integrityVerified,
      minioKey: j.minioKey,
      tempFilePath: j.tempFilePath,
      fileExistsOnDisk,
    });
  }
  return map;
}

function removeJobFromUploadQueue(jobId: string): void {
  let idx = uploadQueue.indexOf(jobId);
  while (idx !== -1) {
    uploadQueue.splice(idx, 1);
    idx = uploadQueue.indexOf(jobId);
  }
}

function startCloudRunCpuKeepAlive(): void {
  if (keepAliveActive) return;
  const targetUrl = detectCloudRunUrl();
  if (!targetUrl || !targetUrl.startsWith('http')) return;
  keepAliveActive = true;

  const hasActiveWork = () =>
    Boolean(activeDownloadJobId || activeUploadJobId || activeJobId || uploadQueue.length > 0 || runningJobIds.size > 0);

  const holdLoop = async (workerIdx: number) => {
    while (keepAliveActive && hasActiveWork()) {
      try {
        await fetch(`${targetUrl}/api/cloudrun-keepalive?hold=1&w=${workerIdx}&t=${Date.now()}`, {
          headers: { 'User-Agent': `CloudRun-CPU-Lease-${workerIdx}` },
        });
      } catch {
        // Ignore transient network errors
      }
      if (keepAliveActive && hasActiveWork()) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  };

  void holdLoop(1);
  setTimeout(() => {
    if (keepAliveActive && hasActiveWork()) {
      void holdLoop(2);
    }
  }, 1500);
}

function stopCloudRunCpuKeepAlive(): void {
  if (!activeDownloadJobId && !activeUploadJobId && uploadQueue.length === 0 && runningJobIds.size === 0) {
    keepAliveActive = false;
  }
}

function resolveJobTargetChannelInfo(job: VideoTransferJob): {
  channelId: string;
  channelName: string;
  isMaster: boolean;
} {
  const isMaster = isMasterAdminChat(job.telegramChatId);
  const ctx = getEffectivePictaContext(job.telegramChatId);
  const masterDefaultId = botConfig.pictaChannelId || '36319';
  const channelId =
    job.targetChannelId && (isMaster || job.targetChannelId !== masterDefaultId)
      ? job.targetChannelId
      : ctx.channelId;
  const channelName = job.targetChannelName || ctx.channelName || 'Mi Canal';
  if (channelId && !job.targetChannelId) job.targetChannelId = channelId;
  if (channelName && !job.targetChannelName) job.targetChannelName = channelName;
  return { channelId, channelName, isMaster };
}

async function prepareJobMetadataBeforeTransfer(
  job: VideoTransferJob,
  customTitle?: string
): Promise<void> {
  const { channelName } = resolveJobTargetChannelInfo(job);
  const ctx = getEffectivePictaContext(job.telegramChatId);
  const prevMeta = job.modelMetadata || {};
  const analyzedFromJob = analyzeVideoTitleAndSynopsis(job.fileName, job.caption);
  const parsedFromJob = analyzedFromJob.seriesInfo;
  const knownSerieName = !isGenericOrInvalidSerieName(String(prevMeta.serie || ''))
    ? String(prevMeta.serie)
    : parsedFromJob.serieName;
  const knownTemp = String(prevMeta.temporada || parsedFromJob.temporada || '1');
  const knownEp = String(prevMeta.numero || parsedFromJob.numero || '1');
  const knownSub = String(prevMeta.episodeSubtitle || parsedFromJob.episodeSubtitle || '').trim();
  const knownPelser = Number(prevMeta.serie_pelser_id || 0);
  const inheritedStyle =
    job.tipologiaId === 5
      ? resolveSeriesStyleForChannel(job.telegramChatId, knownPelser, knownSerieName)
      : null;

  const [generated] = await Promise.all([
    generateVideoMetadataWithAI(
      job.fileName,
      job.caption,
      customTitle ? String(customTitle) : job.titleMode === 'manual' ? job.title : undefined,
      job.category,
      job.tipologiaId,
      channelName,
      job.tipologiaId === 5
        ? {
            serieName: knownSerieName,
            temporada: knownTemp,
            numero: knownEp,
            episodeSubtitle: knownSub,
            inheritedStyle,
          }
        : undefined
    ),
    ctx.accessTokenPromise.catch(() => ''),
    ensureMtprotoClient().catch(() => null),
  ]);

  if (generated.modelMetadata) {
    job.modelMetadata = { ...generated.modelMetadata, ...(job.modelMetadata || {}) };
    if (job.tipologiaId === 5) {
      if (knownSerieName && !isGenericOrInvalidSerieName(knownSerieName)) {
        job.modelMetadata.serie = knownSerieName;
      }
      if (knownTemp) job.modelMetadata.temporada = knownTemp;
      if (knownEp) job.modelMetadata.numero = knownEp;
      if (knownSub) job.modelMetadata.episodeSubtitle = knownSub;
    }
  }
  if (customTitle && customTitle.trim()) {
    job.title = customTitle.trim();
  } else if (job.titleMode === 'manual' && job.title) {
    // Keep existing manual title
  } else if (
    job.tipologiaId === 5 &&
    job.modelMetadata?.serie &&
    !isGenericOrInvalidSerieName(String(job.modelMetadata.serie))
  ) {
    const fSerie = String(job.modelMetadata.serie);
    const fTemp = String(job.modelMetadata.temporada || knownTemp || '1');
    const fEp = String(job.modelMetadata.numero || knownEp || '1');
    const fSub = String(job.modelMetadata.episodeSubtitle || knownSub || '');
    job.title = inheritedStyle
      ? formatEpisodeWithSeriesStyle(inheritedStyle, {
          serieName: fSerie,
          temporada: fTemp,
          numero: fEp,
          episodeSubtitle: fSub,
        })
      : formatSerieEpisodeTitle(fSerie, fTemp, fEp, fSub);
  } else {
    job.title = generated.title;
  }
  const shouldReplaceSynopsis =
    job.tipologiaId === 5
      ? isStaleOrGenericSerieSynopsis(
          job.synopsis,
          job.caption,
          String(job.modelMetadata?.numero || knownEp || '')
        ) || isLikelyEnglishText(job.synopsis)
      : isGenericAutoSynopsis(job.synopsis, job.caption) || isLikelyEnglishText(job.synopsis);
  if (shouldReplaceSynopsis) {
    job.synopsis = generated.synopsis;
  }
  if (!job.tags || job.tags.length === 0) {
    job.tags = generated.tags;
  }
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();
}

async function handleJobPipelineFailure(
  job: VideoTransferJob,
  statusMsgId: number | null,
  err: unknown
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  if (errMsg.includes('SUBIDA_CANCELADA_POR_USUARIO') || cancelledJobIds.has(job.id)) {
    removeJobFromUploadQueue(job.id);
    job.stage = 'cancelled';
    job.errorDetails = 'Subida cancelada por el usuario desde Telegram.';
    job.updatedAt = new Date().toISOString();
    currentActivity = `Subida cancelada por usuario: "${job.title}"`;
    saveJobsToDisk();

    if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
      try {
        fs.unlinkSync(job.tempFilePath);
      } catch {
        // Ignore
      }
    }

    addLiveLog('system', 'warn', `Subida cancelada por usuario: "${job.title}"`);

    if (statusMsgId) {
      const cancelKb: Array<Array<{ text: string; callback_data: string }>> = [
        [
          {
            text: '🔄 Reanudar / Reintentar Subida',
            callback_data: `retry:${job.id}`,
          },
        ],
      ];
      if (getPoolAccountsForChat(job.telegramChatId).length > 0) {
        cancelKb.push([
          {
            text: '🤝 Elegir Cuenta y Reintentar',
            callback_data: `retry_acct:${job.id}`,
          },
        ]);
      }
      await editTelegramStatusMessage(
        job.telegramChatId,
        statusMsgId,
        `🛑 <b>SUBIDA CANCELADA POR EL USUARIO</b>\n` +
          `<blockquote>` +
          `🎬 <b>Título:</b> ${escapeHtml(job.title)}\n` +
          `📄 <b>Archivo:</b> <code>${escapeHtml(job.fileName)}</code>` +
          `</blockquote>\n` +
          `<i>La transferencia se ha detenido y el espacio temporal en servidor fue liberado.</i>`,
        cancelKb,
        true
      );
    }
    return;
  }

  if (
    errMsg.includes('QUOTA_SERIE_RESERVED_REACHED') ||
    errMsg.includes('QUOTA_DAILY_LIMIT_REACHED') ||
    errMsg.includes('QUOTA_S3_PREUPLOADED_WAITING_SLOT') ||
    isDailyLimitErrorText(errMsg)
  ) {
    const isMaster = isMasterAdminChat(job.telegramChatId);
    job.stage = 'queued';
    job.errorDetails = errMsg;
    job.updatedAt = new Date().toISOString();
    if (!uploadQueue.includes(job.id)) {
      uploadQueue.push(job.id);
    }
    saveJobsToDisk();

    if (job.minioKey && job.tempFilePath && fs.existsSync(job.tempFilePath)) {
      try {
        fs.unlinkSync(job.tempFilePath);
      } catch {
        // Ignore
      }
    }

    const isReservePause = errMsg.includes('QUOTA_SERIE_RESERVED_REACHED');
    const isS3Preuploaded = Boolean(job.minioKey);
    const userQueueCount = filterJobsForUser(
      uploadQueue.map((id) => transferJobs.find((j) => j.id === id)).filter((j): j is VideoTransferJob => Boolean(j)),
      job.telegramChatId,
      MASTER_ADMIN_CHAT_ID
    ).length;

    addLiveLog(
      'picta',
      'warn',
      `Cola en pausa inteligente por gestión de cuota diaria: "${job.title}" (${errMsg})`
    );

    if (statusMsgId) {
      const quotaKb: Array<Array<{ text: string; callback_data: string }>> = [];
      if (isMaster && isReservePause) {
        quotaKb.push([
          {
            text: '🔓 Usar cupos restantes para esta serie ahora',
            callback_data: `quota_unlock_and_retry:${job.id}`,
          },
        ]);
      }
      if (isMaster) {
        quotaKb.push([
          {
            text: '➕ Añadir Cuenta Secundaria al Pool (+10 videos/día)',
            callback_data: 'quota_add_account',
          },
        ]);
      }
      quotaKb.push([
        {
          text: '⚖️ Ver Cuota Diaria (/cuota)',
          callback_data: 'quota_menu',
        },
        {
          text: isS3Preuploaded ? '⚡ Publicar Ficha (Ya en S3)' : '🔄 Reintentar Subida',
          callback_data: `retry:${job.id}`,
        },
      ]);
      if (getPoolAccountsForChat(job.telegramChatId).length > 0) {
        quotaKb.push([
          {
            text: '🤝 Cambiar Cuenta y Reintentar',
            callback_data: `retry_acct:${job.id}`,
          },
        ]);
      }

      await editTelegramStatusMessage(
        job.telegramChatId,
        statusMsgId,
        (isS3Preuploaded
          ? `✅ <b>VIDEO 100% SUBIDO A S3 PICTA · EN ESPERA DE CUPO DE PUBLICACIÓN</b>\n`
          : `⏸️ <b>SUBIDA EN PAUSA POR GESTIÓN DE CUOTA DIARIA</b>\n`) +
          `<blockquote>` +
          `🎬 <b>Video en espera:</b> ${escapeHtml(job.title)}\n` +
          `📝 <b>Sinopsis (Español):</b> ${escapeHtml(job.synopsis)}\n` +
          (job.minioKey
            ? `🔑 <b>Manifiesto S3 Listo:</b> <code>${escapeHtml(job.minioKey)}</code> (100% en servidor Picta)\n`
            : '') +
          `📦 <b>Tu cola protegida:</b> ${userQueueCount} video(s) guardado(s)` +
          `</blockquote>\n` +
          `💡 <b>Detalle:</b> ${escapeHtml(errMsg.replace(/^QUOTA_[A-Z0-9_]+:\s*/, ''))}`,
        quotaKb,
        true
      );
    }
    return;
  }

  const isEncoderServerErr = isPictaEncoderOrTransientServerError(
    errMsg,
    job.pictaResponseCode
  );
  const safeErrBlock = `<pre>${errMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;

  if (isEncoderServerErr && job.minioKey) {
    const shouldAutoRetryInQueue = Boolean(
      job.encoderRetryActive || job.encoderManualRetryTriggered
    );
    if (shouldAutoRetryInQueue) {
      const decision = computeNextEncoderRetryState(job.encoderRetryCount || 0, Date.now());
      if (decision.shouldContinue) {
        job.stage = 'queued';
        job.encoderRetryActive = true;
        job.encoderRetryCount = decision.nextAttemptCount;
        job.encoderRetryNextAt = decision.nextRetryAtMs;
        job.encoderRetryLastError = errMsg;
        job.encoderManualRetryTriggered = false;
        job.errorDetails = errMsg;
        job.updatedAt = new Date().toISOString();
        if (!uploadQueue.includes(job.id)) {
          uploadQueue.push(job.id);
        }
        currentActivity = `Esperando codificador de Picta para "${job.title}" (reintento ${decision.nextAttemptCount}/${MAX_ENCODER_AUTO_RETRIES} en ${decision.waitMinutes} min)...`;
        saveJobsToDisk();
        startCloudRunCpuKeepAlive();

        addLiveLog(
          'picta',
          'warn',
          `Codificador de Picta aún detenido para "${job.title}". Reintento automático ${decision.nextAttemptCount}/${MAX_ENCODER_AUTO_RETRIES} programado en ${decision.waitMinutes} min (Manifiesto S3: ${job.minioKey}).`
        );

        if (statusMsgId) {
          await editTelegramStatusMessage(
            job.telegramChatId,
            statusMsgId,
            `${hudHeader('CODIFICADOR OCUPADO · AUTO-REINTENTO')}\n` +
              hudBox([
                `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
                `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
                `🔑 <b>Manifiesto S3:</b> <code>${escapeHtml(job.minioKey)}</code> · 100% seguro`,
                `⏱️ <b>Próximo intento:</b> en ${decision.waitMinutes} min (${decision.nextAttemptCount}/${MAX_ENCODER_AUTO_RETRIES})`,
              ]) +
              `\n💡 <b>Motivo:</b> ${escapeHtml(extractShortEncoderErrorReason(errMsg))}\n` +
              `<i>Tus demás videos siguen subiendo normalmente; te avisaré al publicarse.</i>`,
            [
              [{ text: '🔄 Reintentar Ahora', callback_data: `retry:${job.id}` }],
              [{ text: '🛑 Detener Auto-Reintento', callback_data: `encoder_stop_retry:${job.id}` }],
            ],
            true
          );
        }
        return;
      }
    }

    removeJobFromUploadQueue(job.id);
    const exhaustedAutoRetries = Boolean(
      job.encoderRetryActive && (job.encoderRetryCount || 0) >= MAX_ENCODER_AUTO_RETRIES
    );
    job.stage = 'failed';
    job.encoderRetryActive = false;
    job.encoderRetryNextAt = undefined;
    job.encoderManualRetryTriggered = false;
    job.encoderRetryLastError = errMsg;
    job.errorDetails = errMsg;
    job.updatedAt = new Date().toISOString();
    currentActivity = `Codificador Picta detenido en "${job.title}": ${errMsg.slice(0, 90)}`;
    saveJobsToDisk();

    addLiveLog(
      'picta',
      'error',
      `Fallo temporal del codificador de Picta en "${job.fileName}" (S3 key intacto: ${job.minioKey}): ${errMsg}`
    );

    if (statusMsgId) {
      const encoderKeyboard = [
        [
          {
            text: '🔄 Reintentar Publicación Ahora',
            callback_data: `retry:${job.id}`,
          },
        ],
        [
          {
            text: exhaustedAutoRetries
              ? '⏱️ Reactivar Auto-Reintento (cada 2 min)'
              : '⏱️ Auto-Reintentar en Cola (cada 2 min)',
            callback_data: `encoder_auto_queue:${job.id}`,
          },
        ],
        [
          {
            text: '✍️ Editar Título / Datos',
            callback_data: `retry_manual:${job.id}`,
          },
        ],
      ];

      await editTelegramStatusMessage(
        job.telegramChatId,
        statusMsgId,
        `${hudHeader(
          exhaustedAutoRetries
            ? `CODIFICADOR DETENIDO (${MAX_ENCODER_AUTO_RETRIES} INTENTOS)`
            : 'CODIFICADOR TEMPORALMENTE DETENIDO'
        )}\n` +
          hudBox([
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
            `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
            `🔑 <b>Manifiesto S3:</b> <code>${escapeHtml(job.minioKey)}</code> · 100% subido`,
          ]) +
          `\n💡 <b>Estado:</b> ${escapeHtml(extractShortEncoderErrorReason(errMsg))} <i>(0 MB por re-subir)</i>\n\n` +
          `${hudSection('Respuesta técnica de Picta')}\n${safeErrBlock}\n\n` +
          `<i>Elige cómo continuar:</i>`,
        encoderKeyboard,
        true
      );
    }
    return;
  }

  const isForbiddenErr = isPictaForbiddenResponse(job.pictaResponseCode, errMsg);
  let roleDiagnosticNote = '';
  if (isForbiddenErr) {
    try {
      const ctx = getEffectivePictaContext(job.telegramChatId);
      const tok = await ctx.accessTokenPromise;
      const meObj = await fetchDecryptedPictaMe2(tok);
      const grp = extractPictaGroupSummary(meObj);
      const sess = userSessions.get(job.telegramChatId);
      if (sess && grp.groupNames.length > 0) {
        sess.pictaGroups = grp.groupNames;
        sess.hasChannelAdminRole = grp.hasChannelAdminRole;
        saveUserSessionsToDisk();
      }
      if (!grp.hasChannelAdminRole && grp.groupNames.length > 0) {
        roleDiagnosticNote = buildPictaRoleDiagnosticLines({
          username: String(meObj?.username || sess?.username || 'tu cuenta'),
          groupNames: grp.groupNames,
          hasChannelAdminRole: grp.hasChannelAdminRole,
          channelName: ctx.channelName,
          channelId: ctx.channelId,
        });
      }
    } catch {
      // Ignore diagnostic lookup failure
    }
  }

  removeJobFromUploadQueue(job.id);
  job.stage = 'failed';
  job.encoderRetryActive = false;
  job.encoderRetryNextAt = undefined;
  job.encoderManualRetryTriggered = false;
  job.errorDetails = errMsg;
  job.updatedAt = new Date().toISOString();
  currentActivity = `Error en "${job.fileName}": ${errMsg.slice(0, 90)}`;
  saveJobsToDisk();

  addLiveLog('picta', 'error', `Fallo en "${job.fileName}": ${errMsg}`);

  if (statusMsgId) {
    const hasChatPool = getPoolAccountsForChat(job.telegramChatId).length > 0;
    const retryKeyboard: Array<Array<{ text: string; callback_data: string }>> =
      isForbiddenErr && roleDiagnosticNote
        ? [
            [{ text: '🛡️ Verificar Cuenta (/cuenta)', callback_data: 'cmd_cuenta' }],
            [{ text: '🔄 Reintentar cuando soporte reactive el rol', callback_data: `retry:${job.id}` }],
          ]
        : [
            [
              {
                text: '🔄 Reintentar Publicación Directa',
                callback_data: `retry:${job.id}`,
              },
            ],
            [
              {
                text: '✍️ Rellenar / Corregir Datos en Telegram',
                callback_data: `retry_manual:${job.id}`,
              },
            ],
          ];
    if (hasChatPool) {
      retryKeyboard.unshift([
        {
          text: '🤝 Cambiar Cuenta y Reintentar',
          callback_data: `retry_acct:${job.id}`,
        },
      ]);
    }

    await editTelegramStatusMessage(
      job.telegramChatId,
      statusMsgId,
      `${hudHeader('PUBLICACIÓN INTERRUMPIDA')}\n` +
        hudBox([
          `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
          `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
          job.preferredUploadAccountLabel
            ? `👤 <b>Cuenta usada:</b> ${escapeHtml(job.preferredUploadAccountLabel)}`
            : undefined,
          `🔑 <b>Manifiesto S3:</b> <code>${escapeHtml(job.minioKey || 'Pendiente')}</code>`,
        ]) +
        `\n` +
        (roleDiagnosticNote
          ? `${roleDiagnosticNote}\n\n`
          : isEncoderServerErr
            ? `💡 <b>Nota:</b> ${escapeHtml(extractShortEncoderErrorReason(errMsg))}\n\n`
            : '') +
        `${hudSection('Detalle del error')}\n${safeErrBlock}\n\n` +
        (roleDiagnosticNote
          ? `💡 <i>Tu video quedó guardado en S3 MinIO. Apenas soporte reactive el rol <b>Jefe de canal</b>, pulsa Reintentar.</i>`
          : job.minioKey
            ? `💡 <i>El video ya está subido al 100% en S3 MinIO. Usa "Reintentar" o "Rellenar / Corregir Datos".</i>`
            : `💡 <i>Puedes reintentar el proceso con los botones inferiores.</i>`),
      retryKeyboard,
      true
    );
  }
}

async function runDownloadStage(job: VideoTransferJob): Promise<void> {
  if (activeDownloadJobId || runningJobIds.has(job.id)) return;
  activeDownloadJobId = job.id;
  syncActiveJobId();
  runningJobIds.add(job.id);
  startCloudRunCpuKeepAlive();

  const { channelId, channelName } = resolveJobTargetChannelInfo(job);
  let statusMsgId: number | null = job.statusMessageId || null;

  try {
    await prepareJobMetadataBeforeTransfer(job);

    if (cancelledJobIds.has(job.id)) {
      throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
    }

    const chLabel = channelId ? `${escapeHtml(channelName)} (#${escapeHtml(channelId)})` : escapeHtml(channelName);
    const initialStatusText =
      `${hudHeader('INICIANDO TRANSFERENCIA')}\n` +
      hudBox([
        `📺 <b>Destino:</b> ${chLabel}`,
        `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
        `📦 <b>Tamaño:</b> ${formatBytes(job.expectedBytes)}`,
        `📝 <b>Sinopsis:</b> ${escapeHtml(job.synopsis.slice(0, 110))}`,
      ]) +
      `\n⏳ <i>Descargando vía MTProto 2 GB Turbo al disco scratch...</i>`;

    if (statusMsgId) {
      await editTelegramStatusMessage(job.telegramChatId, statusMsgId, initialStatusText);
    } else {
      statusMsgId = await sendTelegramStatusMessage(
        job.telegramChatId,
        initialStatusText,
        job.telegramMessageId
      );
      if (statusMsgId) {
        job.statusMessageId = statusMsgId;
        saveJobsToDisk();
      }
    }

    if (!job.minioKey) {
      const localFilePath = await downloadFullVideoFromTelegram(job, statusMsgId);
      verifyCompleteFileOnDisk(job, localFilePath);

      await editTelegramStatusMessage(
        job.telegramChatId,
        statusMsgId,
        `${hudHeader('FASE 2/4 · INTEGRIDAD VERIFICADA 100%')}\n` +
          hudBox([
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
            `📊 <b>Estado:</b> <code>${renderVisualBar(100)}</code>`,
            `📦 <b>Archivo íntegro:</b> ${formatBytes(job.diskVerifiedBytes)}`,
          ]) +
          `\n⏳ <i>Listo para transmitir a Picta${activeUploadJobId ? ' (esperando turno S3)' : ''}...</i>`,
        undefined,
        true
      );
    }

    // Re-queue as disk-verified so selectNextUploadJob picks it up immediately
    if (!cancelledJobIds.has(job.id)) {
      job.stage = 'queued';
      job.errorDetails = undefined;
      if (!uploadQueue.includes(job.id)) {
        uploadQueue.push(job.id);
      }
      job.updatedAt = new Date().toISOString();
      saveJobsToDisk();
    }
  } catch (err) {
    await handleJobPipelineFailure(job, statusMsgId, err);
  } finally {
    runningJobIds.delete(job.id);
    if (activeDownloadJobId === job.id) {
      activeDownloadJobId = null;
    }
    syncActiveJobId();
    stopCloudRunCpuKeepAlive();
    setTimeout(() => {
      void scheduleTransferPipeline();
    }, 50);
  }
}

async function runUploadStage(job: VideoTransferJob): Promise<void> {
  if (activeUploadJobId || runningJobIds.has(job.id)) return;
  activeUploadJobId = job.id;
  syncActiveJobId();
  runningJobIds.add(job.id);
  startCloudRunCpuKeepAlive();

  const { channelId, channelName } = resolveJobTargetChannelInfo(job);
  const chLabel = channelId ? `${escapeHtml(channelName)} (#${escapeHtml(channelId)})` : escapeHtml(channelName);
  let statusMsgId: number | null = job.statusMessageId || null;

  try {
    if (!job.tags || job.tags.length === 0 || isGenericAutoSynopsis(job.synopsis, job.caption)) {
      await prepareJobMetadataBeforeTransfer(job);
    }

    if (cancelledJobIds.has(job.id)) {
      throw new Error('SUBIDA_CANCELADA_POR_USUARIO');
    }

    let localFilePath = job.tempFilePath || '';
    if (job.minioKey) {
      const autoRetryBadge = job.encoderRetryActive
        ? ` (Auto-reintento #${Math.max(1, job.encoderRetryCount || 1)}/${MAX_ENCODER_AUTO_RETRIES})`
        : '';
      const s3ReadyMsg =
        `${hudHeader('RETOMANDO DESDE S3 MINIO')}\n` +
        hudBox([
          `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
          `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Película')}`,
          `🔑 <b>Manifiesto:</b> <code>${escapeHtml(job.minioKey)}</code>`,
        ]) +
        `\n⏳ <i>Publicando ficha técnica en ${chLabel}${autoRetryBadge}...</i>`;
      if (statusMsgId) {
        await editTelegramStatusMessage(job.telegramChatId, statusMsgId, s3ReadyMsg, undefined, true);
      } else {
        statusMsgId = await sendTelegramStatusMessage(job.telegramChatId, s3ReadyMsg, job.telegramMessageId);
        if (statusMsgId) {
          job.statusMessageId = statusMsgId;
          saveJobsToDisk();
        }
      }
    } else if (!localFilePath || !fs.existsSync(localFilePath) || (job.expectedBytes > 0 && fs.statSync(localFilePath).size !== job.expectedBytes)) {
      // Defensive fallback if staged file vanished from scratch disk
      localFilePath = await downloadFullVideoFromTelegram(job, statusMsgId);
      verifyCompleteFileOnDisk(job, localFilePath);
    }

    await uploadFullVerifiedFileToPicta(job, localFilePath, statusMsgId);

    removeJobFromUploadQueue(job.id);
    job.stage = 'completed';
    job.errorDetails = undefined;
    job.encoderRetryActive = false;
    job.encoderRetryCount = undefined;
    job.encoderRetryNextAt = undefined;
    job.encoderRetryLastError = undefined;
    job.encoderManualRetryTriggered = false;
    job.updatedAt = new Date().toISOString();
    currentActivity = `Última subida completada en ${channelName} (#${channelId}): "${job.title}" (${formatBytes(job.diskVerifiedBytes || job.expectedBytes)})`;
    saveJobsToDisk();
    pruneTransferJobsMemory();

    addLiveLog(
      'picta',
      'success',
      `¡Completado! "${job.title}" (${formatBytes(job.diskVerifiedBytes || job.expectedBytes)}) publicado en ${channelName} (#${channelId}).`
    );

    const remainingUserQueue = filterJobsForUser(
      uploadQueue
        .map((id) => transferJobs.find((j) => j.id === id))
        .filter((j): j is VideoTransferJob => Boolean(j && j.id !== job.id)),
      job.telegramChatId,
      MASTER_ADMIN_CHAT_ID
    ).length;

    const compKeyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
    if (job.pictaPublicationId) {
      const slug = String(job.modelMetadata?.pictaSlugUrl || '').trim();
      compKeyboard.push([
        {
          text: '🚪 Enlace Directo',
          callback_data: `pub_direct_dl:${job.pictaPublicationId}`,
        },
        {
          text: '🌐 Ver en Picta Web',
          url: slug
            ? `https://www.picta.cu/medias/${encodeURIComponent(slug)}`
            : `https://www.picta.cu/medias/${job.pictaPublicationId}`,
        },
      ]);
    }

    await editTelegramStatusMessage(
      job.telegramChatId,
      statusMsgId,
      `${hudHeader('PUBLICACIÓN COMPLETADA 100%')}\n` +
        hudBox([
          `📺 <b>Canal:</b> ${chLabel}`,
          job.preferredUploadAccountLabel
            ? `👤 <b>Publicado por:</b> ${escapeHtml(job.preferredUploadAccountLabel)}`
            : undefined,
          `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
          `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
          `📦 <b>Tamaño íntegro:</b> ${formatBytes(job.diskVerifiedBytes || job.expectedBytes)}`,
          `🔑 <b>Manifiesto S3:</b> <code>${escapeHtml(job.minioKey || 'OK')}</code>`,
        ]) +
        `\n📝 <i>${escapeHtml(job.synopsis.slice(0, 220))}</i>` +
        (remainingUserQueue > 0
          ? `\n\n⏭️ <i>Iniciando siguiente video en cola (${remainingUserQueue} restante(s))...</i>`
          : ''),
      compKeyboard as any,
      true
    );

    // Prepare promo card record BEFORE cleaning up temporary files, isolated from upload pipeline
    try {
      await handlePostUploadRequestFulfillment(job);
    } catch {
      // Request fulfillment check must never block upload completion
    }
    try {
      await handlePostUploadMoviePromoConfirmation(job);
    } catch {
      // Promo failure must never disturb completed Picta upload or temp cleanup
    }

    if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
      try {
        fs.unlinkSync(job.tempFilePath);
      } catch {
        // Ignore
      }
    }
  } catch (err) {
    await handleJobPipelineFailure(job, statusMsgId, err);
  } finally {
    runningJobIds.delete(job.id);
    if (activeUploadJobId === job.id) {
      activeUploadJobId = null;
    }
    syncActiveJobId();
    stopCloudRunCpuKeepAlive();
    setTimeout(() => {
      void scheduleTransferPipeline();
    }, 50);
  }
}

let schedulerRunning = false;

async function scheduleTransferPipeline(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    // Drop invalid, cancelled, or completed items from uploadQueue
    for (let i = uploadQueue.length - 1; i >= 0; i--) {
      const qId = uploadQueue[i];
      const qJob = transferJobs.find((j) => j.id === qId);
      if (!qJob || cancelledJobIds.has(qId) || qJob.stage === 'cancelled' || qJob.stage === 'completed') {
        uploadQueue.splice(i, 1);
      }
    }

    const jobsMap = buildPipelineJobsMap();

    // 1. Start upload stage if idle and a disk-verified or S3-ready job is waiting
    if (!activeUploadJobId) {
      const nextUpload = selectNextUploadJob(
        uploadQueue,
        jobsMap,
        activeUploadJobId,
        activeDownloadJobId
      );
      if (nextUpload) {
        const jobObj = transferJobs.find((j) => j.id === nextUpload.id);
        if (jobObj && !runningJobIds.has(jobObj.id)) {
          void runUploadStage(jobObj);
        }
      }
    }

    // 2. Start download stage in parallel if idle and lookahead < MAX_PREFETCH_LOOKAHEAD
    if (!activeDownloadJobId) {
      const freshMap = buildPipelineJobsMap();
      const nextDownload = selectNextDownloadJob(
        uploadQueue,
        freshMap,
        activeDownloadJobId,
        activeUploadJobId,
        MAX_PREFETCH_LOOKAHEAD
      );
      if (nextDownload) {
        const jobObj = transferJobs.find((j) => j.id === nextDownload.id);
        if (jobObj && !runningJobIds.has(jobObj.id)) {
          void runDownloadStage(jobObj);
        }
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

async function executeFullTransferPipeline(job: VideoTransferJob): Promise<void> {
  activeDownloadJobId = job.id;
  activeUploadJobId = job.id;
  syncActiveJobId();
  startCloudRunCpuKeepAlive();
  const { channelId, channelName } = resolveJobTargetChannelInfo(job);
  const chLabel = channelId ? `${escapeHtml(channelName)} (#${escapeHtml(channelId)})` : escapeHtml(channelName);
  let statusMsgId: number | null = job.statusMessageId || null;

  try {
    const initialStatusText =
      `${hudHeader('PROCESANDO VIDEO')}\n` +
      hudBox([
        `📺 <b>Canal:</b> ${chLabel}`,
        `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
        `📦 <b>Tamaño:</b> ${formatBytes(job.expectedBytes)}`,
        `📝 <b>Sinopsis:</b> ${escapeHtml(job.synopsis.slice(0, 110))}`,
      ]) +
      `\n⏳ <i>Verificando caché y preparando descarga MTProto 2 GB...</i>`;

    if (statusMsgId) {
      await editTelegramStatusMessage(job.telegramChatId, statusMsgId, initialStatusText);
    } else {
      statusMsgId = await sendTelegramStatusMessage(
        job.telegramChatId,
        initialStatusText,
        job.telegramMessageId
      );
      if (statusMsgId) {
        job.statusMessageId = statusMsgId;
        saveJobsToDisk();
      }
    }

    let localFilePath = job.tempFilePath || '';
    if (!job.minioKey) {
      localFilePath = await downloadFullVideoFromTelegram(job, statusMsgId);
      verifyCompleteFileOnDisk(job, localFilePath);
    }
    if (activeDownloadJobId === job.id) {
      activeDownloadJobId = null;
      syncActiveJobId();
    }

    await uploadFullVerifiedFileToPicta(job, localFilePath, statusMsgId);

    removeJobFromUploadQueue(job.id);
    job.stage = 'completed';
    job.errorDetails = undefined;
    job.updatedAt = new Date().toISOString();
    currentActivity = `Última subida completada en ${channelName} (#${channelId}): "${job.title}" (${formatBytes(job.diskVerifiedBytes || job.expectedBytes)})`;
    saveJobsToDisk();

    await editTelegramStatusMessage(
      job.telegramChatId,
      statusMsgId,
      `${hudHeader('PUBLICACIÓN COMPLETADA 100%')}\n` +
        hudBox([
          `📺 <b>Canal:</b> ${chLabel}`,
          job.preferredUploadAccountLabel
            ? `👤 <b>Publicado por:</b> ${escapeHtml(job.preferredUploadAccountLabel)}`
            : undefined,
          `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
          `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
          `🔑 <b>Manifiesto S3:</b> <code>${escapeHtml(job.minioKey || 'OK')}</code>`,
        ]),
      undefined,
      true
    );

    try {
      await handlePostUploadRequestFulfillment(job);
    } catch {
      // Request fulfillment check must never block upload completion
    }
    try {
      await handlePostUploadMoviePromoConfirmation(job);
    } catch {
      // Promo failure must never disturb completed Picta upload or temp cleanup
    }

    if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
      try {
        fs.unlinkSync(job.tempFilePath);
      } catch {
        // Ignore
      }
    }
  } catch (err) {
    await handleJobPipelineFailure(job, statusMsgId, err);
  } finally {
    if (activeDownloadJobId === job.id) activeDownloadJobId = null;
    if (activeUploadJobId === job.id) activeUploadJobId = null;
    syncActiveJobId();
    stopCloudRunCpuKeepAlive();
  }
}

async function cancelTransferJob(
  jobId: string,
  chatId: string,
  messageId?: number | null
): Promise<boolean> {
  cancelledJobIds.add(jobId);
  removeJobFromUploadQueue(jobId);
  const job = transferJobs.find((j) => j.id === jobId);
  if (!job) return false;

  const wasQueued = job.stage === 'queued' || !runningJobIds.has(jobId);
  if (activeDownloadJobId === jobId) activeDownloadJobId = null;
  if (activeUploadJobId === jobId) activeUploadJobId = null;
  syncActiveJobId();
  runningJobIds.delete(jobId);

  job.stage = 'cancelled';
  job.errorDetails = 'Cancelado por el usuario desde Telegram.';
  job.encoderRetryActive = false;
  job.encoderRetryNextAt = undefined;
  job.encoderManualRetryTriggered = false;
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  if (job.tempFilePath && fs.existsSync(job.tempFilePath)) {
    try {
      fs.unlinkSync(job.tempFilePath);
    } catch {
      // Ignore
    }
  }

  const targetMsgId = messageId || job.statusMessageId;
  if (targetMsgId) {
    await editTelegramStatusMessage(
      chatId || job.telegramChatId,
      targetMsgId,
      `${hudHeader(wasQueued ? 'RETIRADO DE LA COLA' : 'TRANSFERENCIA DETENIDA')}\n` +
        hudBox([
          `🎬 <b>Título:</b> ${escapeHtml(job.title)}`,
          `📄 <b>Archivo:</b> <code>${escapeHtml(job.fileName)}</code>`,
        ]) +
        `\n<i>Transferencia detenida. Puedes reanudarla cuando quieras con 1 clic.</i>`,
      [
        [
          {
            text: '🔄 Reanudar Subida',
            callback_data: `retry:${job.id}`,
          },
        ],
      ],
      true
    );
  }
  void scheduleTransferPipeline();
  return true;
}

async function sendOrEditQueueManagerInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  const isMaster = isMasterAdminChat(chatId);
  const session = userSessions.get(chatId);
  if (!isMaster && !session?.channelId) {
    const text =
      `${hudHeader('COLA DE SUBIDA · ACCESO REQUERIDO')}\n` +
      hudBox([
        `🔒 <b>Estado:</b> Cuenta de Picta sin vincular`,
        `👉 Inicia sesión con /login para gestionar tu cola personal.`,
      ]);
    const keyboard = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }

  const activeUploadJob = activeUploadJobId
    ? transferJobs.find((j) => Boolean(j) && j.id === activeUploadJobId && (isMaster || j.telegramChatId === chatId))
    : null;
  const activeDownloadJob =
    activeDownloadJobId && activeDownloadJobId !== activeUploadJobId
      ? transferJobs.find((j) => Boolean(j) && j.id === activeDownloadJobId && (isMaster || j.telegramChatId === chatId))
      : null;
  const activeJob = activeUploadJob || activeDownloadJob;

  const queuedJobs = uploadQueue
    .filter((id) => id !== activeUploadJobId && id !== activeDownloadJobId)
    .map((id) => transferJobs.find((j) => Boolean(j) && j.id === id))
    .filter((j): j is VideoTransferJob => Boolean(j))
    .filter((j) => isMaster || j.telegramChatId === chatId);
  const encoderWaitingJobs = queuedJobs.filter((j) => Boolean(j.encoderRetryActive));
  const normalQueuedJobs = queuedJobs.filter((j) => !j.encoderRetryActive);
  const pinned = pinnedBatchSerieByChat.get(chatId);
  const channelTag = isMaster ? 'MULTIVERSO VISUAL (#36319)' : escapeHtml((session?.channelName || 'MI CANAL').toUpperCase());

  let activeBlock = '';
  if (activeUploadJob) {
    activeBlock +=
      `${hudSection('Subiendo a S3 Picta')}\n` +
      hudBox([
        `🎬 <b>${escapeHtml(activeUploadJob.title)}</b>`,
        `📂 ${escapeHtml(activeUploadJob.category)} · 📦 ${formatBytes(activeUploadJob.expectedBytes)}`,
        `⚡ <b>Velocidad:</b> ${activeUploadJob.speedMBps || 0} MB/s`,
      ]) +
      `\n`;
  }
  if (activeDownloadJob) {
    activeBlock +=
      `${hudSection('Pre-descargando (Scratch)')}\n` +
      hudBox([
        `🎬 <b>${escapeHtml(activeDownloadJob.title)}</b>`,
        `📂 ${escapeHtml(activeDownloadJob.category)} · 📦 ${formatBytes(activeDownloadJob.expectedBytes)}`,
        `⚡ <b>Velocidad:</b> ${activeDownloadJob.speedMBps || 0} MB/s`,
      ]) +
      `\n`;
  }
  if (!activeBlock) {
    activeBlock = `🟢 <b>Estado del motor:</b> <i>En reposo (listo para recibir videos).</i>\n\n`;
  }

  const encoderBlock =
    encoderWaitingJobs.length > 0
      ? `${hudSection(`Esperando codificador (${encoderWaitingJobs.length})`)}\n` +
        encoderWaitingJobs
          .slice(0, 6)
          .map((j, idx) => {
            const remMin = Math.max(
              0,
              Math.ceil((Number(j.encoderRetryNextAt || 0) - Date.now()) / 60_000)
            );
            return `<b>${idx + 1}.</b> ⏱️ ${escapeHtml(j.title)} · <code>${j.encoderRetryCount || 1}/${MAX_ENCODER_AUTO_RETRIES}</code>${remMin > 0 ? ` (~${remMin}m)` : ' (pronto)'}`;
          })
          .join('\n') +
        `\n\n`
      : '';

  const queueBlock =
    normalQueuedJobs.length > 0
      ? `${hudSection(`En cola de espera (${normalQueuedJobs.length})`)}\n` +
        normalQueuedJobs
          .slice(0, 10)
          .map(
            (j, idx) =>
              `<b>${idx + 1}.</b> 🎬 ${escapeHtml(j.title)} · <code>${formatBytes(j.expectedBytes)}</code>`
          )
          .join('\n') +
        `\n\n`
      : encoderWaitingJobs.length === 0
        ? `📭 <b>Cola de espera:</b> <i>Vacía (0 videos pendientes).</i>\n\n`
        : '';

  const pinnedBlock = pinned
    ? `${hudSection('Modo Serie Fija (Ráfaga)')} · 🟢 <b>ACTIVO</b>\n` +
      hudBox([
        `📺 <b>Serie:</b> ${escapeHtml(pinned.serieName)} · <b>T${escapeHtml(pinned.seasonNum)}</b>`,
        `🖼️ <b>Portada:</b> Automática de la serie en cada capítulo`,
        `⚡ <i>Todo video reenviado entra directo a cola sin preguntas.</i>`,
      ])
    : `${hudSection('Modo Serie Fija (Ráfaga)')} · ⚪ <i>Inactivo</i>\n` +
      `<i>(Actívalo desde /series para subir ráfagas de capítulos en automático)</i>`;

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`COLA Y MODO RÁFAGA · ${channelTag}`)}\n\n` +
    `${activeBlock}` +
    `${encoderBlock}` +
    `${queueBlock}` +
    `${pinnedBlock}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (activeUploadJob) {
    keyboard.push([
      {
        text: `🛑 Cancelar subida: "${activeUploadJob.title.slice(0, 22)}"`,
        callback_data: `cancel_job:${activeUploadJob.id}`,
      },
    ]);
  }
  if (activeDownloadJob) {
    keyboard.push([
      {
        text: `🛑 Cancelar descarga: "${activeDownloadJob.title.slice(0, 20)}"`,
        callback_data: `cancel_job:${activeDownloadJob.id}`,
      },
    ]);
  }

  for (const eJob of encoderWaitingJobs.slice(0, 4)) {
    keyboard.push([
      {
        text: `🔄 Reintentar Ya: "${eJob.title.slice(0, 16)}"`,
        callback_data: `retry:${eJob.id}`,
      },
      {
        text: `🛑 Parar`,
        callback_data: `encoder_stop_retry:${eJob.id}`,
      },
    ]);
  }

  for (const qJob of normalQueuedJobs.slice(0, 5)) {
    keyboard.push([
      {
        text: `❌ Quitar: "${qJob.title.slice(0, 24)}"`,
        callback_data: `cancel_job:${qJob.id}`,
      },
    ]);
  }

  if (pinned) {
    keyboard.push([
      {
        text: `🔓 Desactivar Serie Fija (${pinned.serieName.slice(0, 18)})`,
        callback_data: 'unpin_serie',
      },
    ]);
  } else {
    keyboard.push([
      {
        text: '📌 Elegir Serie para Modo Ráfaga',
        callback_data: 'my_series:0',
      },
    ]);
  }

  keyboard.push([
    { text: '🧩 Unir Partes (/unir)', callback_data: 'multipart_join:open' },
    { text: '⚡ Cuota Diaria', callback_data: 'quota_menu' },
  ]);

  keyboard.push([
    { text: '🔄 Actualizar Cola', callback_data: 'queue_view' },
    { text: '📊 Videos (/stats)', callback_data: 'dash_refresh:views:0' },
  ]);
  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function sendOrEditQuotaMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  ensureDailyQuotaReset();
  const isMaster = isMasterAdminChat(chatId);
  const session = userSessions.get(chatId);

  if (!isMaster) {
    if (!session?.channelId) {
      const text =
        `${hudHeader('CUOTA DIARIA · ACCESO REQUERIDO')}\n` +
        hudBox([
          `🔒 <b>Estado:</b> Cuenta de Picta sin vincular`,
          `👉 Usa /login para ver el cupo diario de tu canal.`,
        ]);
      const keyboard = [
        [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
        [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
      ];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
      } else {
        await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
      }
      return;
    }

    const userPool = getPoolAccountsForChat(chatId);
    const publishableUserPool = userPool.filter((acc) => acc.canPublishDirectly !== false);
    const myUploaded = transferJobs.filter(
      (j) =>
        j.telegramChatId === chatId &&
        j.stage === 'completed' &&
        toCubaDateStr(j.updatedAt || j.createdAt) === quotaSettings.currentDateCuba
    ).length;
    const totalDailyCapacity = (1 + publishableUserPool.length) * 10;
    const myRemaining = Math.max(0, totalDailyCapacity - myUploaded);
    const quotaPct = totalDailyCapacity > 0 ? Math.round((myUploaded / totalDailyCapacity) * 100) : 0;
    const userPoolLines =
      userPool.length > 0
        ? userPool
            .map((acc, i) => {
              const roleTag =
                acc.canPublishDirectly === false
                  ? ' <i>(Usuario común)</i>'
                  : acc.canPublishDirectly === true
                    ? ' <i>(Jefe de canal · Colaborador)</i>'
                    : '';
              return `<b>${i + 1}.</b> 🤝 <code>${escapeHtml(acc.displayName || acc.username)}</code> · <b>${acc.uploadedToday || 0}/10</b>${roleTag}`;
            })
            .join('\n')
        : `<i>Ningún colaborador añadido (capacidad base: 10 videos/día).</i>`;

    const text =
      (notice ? `${notice}\n\n` : '') +
      `${hudHeader(`CUOTA DIARIA · ${session.channelName}`)}\n` +
      hudBox([
        `👤 <b>Principal:</b> <code>@${escapeHtml(session.userFullName || session.username)}</code>`,
        `📺 <b>Canal:</b> ${escapeHtml(session.channelName)} · <code>#${escapeHtml(session.channelId)}</code>`,
        `⚡ <b>Uso hoy:</b> <code>${hudSegmentedBar(quotaPct, 10)}</code> (<b>${myUploaded}/${totalDailyCapacity}</b> · ${myRemaining} libres)`,
        `📅 <b>Fecha (Cuba):</b> ${escapeHtml(quotaSettings.currentDateCuba)}`,
      ]) +
      `\n${hudSection(`Cuentas Colaboradoras en Pool (${userPool.length})`)}\n` +
      `${userPoolLines}\n\n` +
      `💡 <i>Si tienes colaboradores en el Pool, te preguntaré con qué cuenta subir antes de cada video.</i>`;
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [{ text: '➕ Añadir Colaborador al Pool (+10/día)', callback_data: 'quota_add_account' }],
    ];
    for (let i = 0; i < Math.min(4, userPool.length); i++) {
      const acc = userPool[i];
      keyboard.push([
        {
          text: `🗑️ Quitar Pool: ${acc.displayName || acc.username}`,
          callback_data: `quota_del_account:${i}`,
        },
      ]);
    }
    keyboard.push([{ text: '🔄 Actualizar Cuota', callback_data: 'cmd_cuota' }]);
    keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }

  const publishablePoolAccounts = quotaSettings.poolAccounts.filter(
    (acc) => acc.canPublishDirectly !== false
  );
  const totalAccounts = 1 + publishablePoolAccounts.length;
  const totalDailyCapacity = totalAccounts * 10;
  const usedToday = (quotaSettings.seriesUploadedToday || 0) + (quotaSettings.otherUploadedToday || 0);
  const remainingToday = Math.max(0, totalDailyCapacity - usedToday);
  const totalPct = totalDailyCapacity > 0 ? Math.round((usedToday / totalDailyCapacity) * 100) : 0;

  const splitDesc =
    quotaSettings.maxSeriesPerDay > 0
      ? `<b>${quotaSettings.maxSeriesPerDay} Series</b> · <b>${Math.max(0, 10 - quotaSettings.maxSeriesPerDay)} Películas/Otros</b>`
      : `<b>Sin restricción (100% libre)</b>`;

  const poolLines =
    quotaSettings.poolAccounts.length > 0
      ? quotaSettings.poolAccounts
          .map((acc, i) => {
            const roleTag =
              acc.canPublishDirectly === false
                ? ' <i>(Acelerador S3 · Usuario común)</i>'
                : acc.canPublishDirectly === true
                  ? ' <i>(Jefe de canal · Publicación directa)</i>'
                  : '';
            return `<b>${i + 1}.</b> 👤 <code>${escapeHtml(acc.displayName || acc.username)}</code> · <b>${acc.uploadedToday || 0}/10</b>${roleTag}`;
          })
          .join('\n')
      : `<i>Ninguna cuenta secundaria añadida (capacidad base: 10 videos/día).</i>`;

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader('CUOTA DIARIA Y POOL MULTI-CUENTA')}\n` +
    hudBox([
      `📅 <b>Fecha (Cuba):</b> ${escapeHtml(quotaSettings.currentDateCuba)}`,
      `⚡ <b>Capacidad hoy:</b> <code>${hudSegmentedBar(totalPct, 10)}</code> (<b>${usedToday}/${totalDailyCapacity}</b> · ${remainingToday} libres)`,
      `📺 <b>Series:</b> ${quotaSettings.seriesUploadedToday || 0} · 🎬 <b>Películas/Otros:</b> ${quotaSettings.otherUploadedToday || 0}`,
      `⚖️ <b>División:</b> ${splitDesc}`,
    ]) +
    `\n${hudSection('Pool de Aceleración S3 / Cuota')}\n` +
    `<i>Cada cuenta añadida suma +10 cupos diarios al canal <b>Canal Oficial (#36319)</b> o pre-sube archivos pesados a S3.</i>\n\n` +
    `${hudSection(`Cuentas secundarias (${quotaSettings.poolAccounts.length})`)}\n` +
    `${poolLines}`;

  const curMax = quotaSettings.maxSeriesPerDay;
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: `${curMax === 5 ? '✅ ' : ''}5 Series / 5 Películas`,
        callback_data: 'quota_split:5',
      },
      {
        text: `${curMax === 7 ? '✅ ' : ''}7 Series / 3 Películas`,
        callback_data: 'quota_split:7',
      },
    ],
    [
      {
        text: `${curMax === 8 ? '✅ ' : ''}8 Series / 2 Películas`,
        callback_data: 'quota_split:8',
      },
      {
        text: `${curMax === 0 ? '✅ ' : ''}10/10 Sin Reserva`,
        callback_data: 'quota_split:0',
      },
    ],
    [
      {
        text: '➕ Añadir Cuenta al Pool (+10/día)',
        callback_data: 'quota_add_account',
      },
    ],
  ];

  for (let i = 0; i < Math.min(4, quotaSettings.poolAccounts.length); i++) {
    const acc = quotaSettings.poolAccounts[i];
    keyboard.push([
      {
        text: `🗑️ Quitar Pool: ${acc.displayName || acc.username}`,
        callback_data: `quota_del_account:${i}`,
      },
    ]);
  }

  if (uploadQueue.length > 0 && !isTransferJobRunningOrProcessing()) {
    keyboard.push([
      {
        text: `▶️ Reanudar Cola (${uploadQueue.length} en espera)`,
        callback_data: 'quota_resume_queue',
      },
    ]);
  }

  keyboard.push([
    { text: '📋 Cola (/cola)', callback_data: 'queue_view' },
    { text: '📊 Videos (/stats)', callback_data: 'dash_refresh:views:0' },
  ]);
  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

function buildAdminUsersSummaryData() {
  ensureDailyQuotaReset();
  const sessionsMap = new Map<string, AdminUserSessionSummary>();
  for (const [cid, s] of userSessions.entries()) {
    sessionsMap.set(String(cid), {
      chatId: String(cid),
      username: s.username,
      userFullName: s.userFullName,
      channelId: s.channelId,
      channelName: s.channelName,
      availableChannelsCount: Array.isArray(s.availableChannels) ? s.availableChannels.length : 0,
      hasAuthToken: Boolean(s.authToken),
      hasPassword: Boolean(s.password),
      tokenExpiresAt: s.tokenExpiresAt,
      updatedAt: s.updatedAt,
    });
  }

  const pinnedMap = new Map<string, AdminUserPinnedSerieSummary>();
  for (const [cid, p] of pinnedBatchSerieByChat.entries()) {
    pinnedMap.set(String(cid), {
      serieName: p.serieName,
      seasonNum: p.seasonNum,
    });
  }

  const promoMap = new Map<string, AdminUserPromoSummary>();
  for (const [cid, pr] of userPromoChannels.entries()) {
    if (!pr.disabled && pr.targetChannelLabel) {
      promoMap.set(String(cid), {
        telegramChannelDisplay: pr.targetChannelLabel,
        pictaChannelUrl: pr.customPictaChannelUrl,
      });
    }
  }
  if (!promoMap.has(MASTER_ADMIN_CHAT_ID)) {
    const masterPromo = resolveRequestsChannelForChat(
      MASTER_ADMIN_CHAT_ID,
      MASTER_ADMIN_CHAT_ID,
      userPromoChannels,
      MASTER_PRIVATE_REQUESTS_CHANNEL
    );
    if (masterPromo.configured) {
      promoMap.set(MASTER_ADMIN_CHAT_ID, {
        telegramChannelDisplay: masterPromo.targetChannelLabel,
        pictaChannelUrl: masterPromo.customPictaChannelUrl,
      });
    }
  }

  const masterDailyCap =
    (1 + quotaSettings.poolAccounts.filter((a) => a.canPublishDirectly !== false).length) * 10;
  const masterSeriesToday = Number(quotaSettings.seriesUploadedToday || 0);
  const masterOtherToday = Number(quotaSettings.otherUploadedToday || 0);

  return computeEnrichedAdminUsersSummary({
    currentDateCuba: quotaSettings.currentDateCuba,
    masterAdminChatId: MASTER_ADMIN_CHAT_ID,
    masterAdminPictaUsername: pictaUser?.username || 'Admin',
    masterAdminChannelId: botConfig.pictaChannelId || '36319',
    masterAdminChannelName: 'Canal Oficial',
    masterAdminDailyCapacity: masterDailyCap,
    masterAdminSeriesToday: masterSeriesToday,
    masterAdminOtherToday: masterOtherToday,
    authorizedUsers: Array.from(authorizedUsers.values()),
    sessionsByChatId: sessionsMap,
    pinnedByChatId: pinnedMap,
    promoByChatId: promoMap,
    jobs: transferJobs,
    toCubaDateStr,
  });
}

function formatCubaShortDateTime(iso?: string): string {
  if (!iso) return 'Sin registros';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Sin registros';
    return d.toLocaleString('es-CU', {
      timeZone: 'America/Havana',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso.slice(0, 16);
  }
}

async function sendOrEditAdminUsersDashboardInTelegram(
  chatId: string,
  messageId: number | null,
  page = 0,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  if (!isMasterAdminChat(chatId)) {
    await sendTelegramStatusMessage(
      chatId,
      `⛔ <i>Solo el Administrador Principal (@admin_bot) puede consultar el panel de usuarios.</i>`,
      replyToMessageId
    );
    return;
  }

  const summary = buildAdminUsersSummaryData();
  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(summary.users.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(totalPages - 1, page));
  const pageUsers = summary.users.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const globalHeaderLines = [
    `📅 <b>Fecha (Cuba):</b> ${escapeHtml(summary.currentDateCuba)} · 👥 <b>Usuarios:</b> ${summary.totalAuthorizedUsers} (🟢 ${summary.linkedPictaUsers} vinculados · ⚪ ${summary.unlinkedPictaUsers} sin vincular)`,
    `⚡ <b>Subidos Hoy (Global):</b> <b>${summary.totalUploadedTodayAllUsers} video(s)</b> (🎬 ${summary.totalMoviesTodayAllUsers} Pelis/Otros · 📺 ${summary.totalSeriesTodayAllUsers} Series)${summary.totalBytesTodayAllUsers > 0 ? ` · <code>${formatBytes(summary.totalBytesTodayAllUsers)}</code>` : ''}`,
    `📊 <b>Histórico Total:</b> <b>${summary.totalCompletedHistoricalAllUsers}</b> publicados · <code>${formatBytes(summary.totalBytesHistoricalAllUsers)}</code>${summary.totalActiveOrQueuedAllUsers > 0 ? ` · ⏳ <b>${summary.totalActiveOrQueuedAllUsers} en cola/activos</b>` : ''}`,
  ];

  const userBlocks = pageUsers
    .map((u, idx) => {
      const globalNum = safePage * PAGE_SIZE + idx + 1;
      const roleIcon = u.isMasterAdmin ? '👑' : u.pictaLinked ? '🟢' : '⚪';
      const roleBadge = u.isMasterAdmin ? ' <b>(Admin Principal)</b>' : '';
      const quotaStatusIcon =
        u.uploadedTodayCount >= u.dailyQuotaLimit
          ? '🔴 Límite alcanzado'
          : u.uploadedTodayCount > 0
            ? '⚡ Activo hoy'
            : '🟢 Cupo intacto';

      const splitTodayStr =
        u.uploadedTodayCount > 0
          ? ` · (🎬 ${u.moviesUploadedTodayCount} · 📺 ${u.seriesUploadedTodayCount})`
          : '';

      const queueLine =
        u.activeJobsCount > 0 || u.queuedJobsCount > 0
          ? `\n├ ⏳ <b>Cola ahora:</b> ${u.activeJobsCount} subiendo · ${u.queuedJobsCount} en espera${u.activeJobTitle ? ` (<i>"${escapeHtml(u.activeJobTitle.slice(0, 26))}"</i>)` : ''}`
          : '';

      const pinnedLine = u.pinnedSerie
        ? `\n├ 📌 <b>Modo Ráfaga:</b> ${escapeHtml(u.pinnedSerie.serieName)} (T${escapeHtml(u.pinnedSerie.seasonNum)})`
        : '';

      const promoLine = u.promoChannel?.telegramChannelDisplay
        ? `\n├ 📢 <b>Canal Pedidos:</b> ${escapeHtml(u.promoChannel.telegramChannelDisplay)}`
        : '';

      const lastUploadLine = u.lastUploadTitle
        ? `\n└ 🕒 <b>Último:</b> <i>"${escapeHtml(u.lastUploadTitle.slice(0, 32))}"</i> (${escapeHtml(formatCubaShortDateTime(u.lastUploadAt))})`
        : `\n└ 🕒 <b>Último:</b> <i>Sin subidas registradas en el bot</i>`;

      return (
        `<b>${globalNum}. ${roleIcon} ${escapeHtml(u.displayName)}</b>${roleBadge}\n` +
        `├ 🆔 <code>${escapeHtml(u.chatId)}</code>${u.username ? ` · @${escapeHtml(u.username)}` : ''} · 📅 Alta: ${new Date(u.authorizedAt).toLocaleDateString('es-CU')}\n` +
        `├ 📺 <b>Picta:</b> ${escapeHtml(u.pictaChannelLabel)} · <code>${escapeHtml(u.pictaAccountLabel)}</code>\n` +
        `├ 🔐 <b>Sesión:</b> ${u.sessionStatusLabel}\n` +
        `├ ⚡ <b>Cuota Hoy:</b> <code>${hudSegmentedBar(u.quotaPercent, 10)}</code> <b>${u.uploadedTodayCount}/${u.dailyQuotaLimit}</b> (${u.remainingTodayCount} libres · ${quotaStatusIcon})${splitTodayStr}\n` +
        `├ 📊 <b>Histórico:</b> <b>${u.totalCompletedCount}</b> subidos (${formatBytes(u.totalBytesUploaded)})${u.totalFailedCount > 0 ? ` · ❌ ${u.totalFailedCount} fallidos` : ''}${u.avgSpeedMBps > 0 ? ` · 🚀 ${u.avgSpeedMBps} MB/s` : ''}` +
        `${queueLine}${pinnedLine}${promoLine}${lastUploadLine}`
      );
    })
    .join('\n\n');

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`PANEL DE USUARIOS Y CUOTAS (${summary.totalAuthorizedUsers})`)}\n` +
    hudBox(globalHeaderLines) +
    `\n${hudSection(`Actividad y Cupo Diario por Usuario (Pág. ${safePage + 1}/${totalPages})`)}\n` +
    `${userBlocks}\n\n` +
    `💡 <i>Toca el nombre de cualquier usuario debajo para inspeccionar su historial de videos subidos hoy, velocidades y opciones de acceso, o usa <code>/autorizar &lt;ID o @user&gt;</code> y <code>/quitar &lt;ID o @user&gt;</code>.</i>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  // Interactive user inspection buttons (2 per row)
  for (let i = 0; i < pageUsers.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    for (const u of pageUsers.slice(i, i + 2)) {
      const shortName = (u.username ? `@${u.username}` : u.displayName).slice(0, 14);
      row.push({
        text: `🔍 ${shortName} (${u.uploadedTodayCount}/${u.dailyQuotaLimit})`,
        callback_data: `admin_user_detail:${u.chatId}:${safePage}`,
      });
    }
    keyboard.push(row);
  }

  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      navRow.push({
        text: '⬅️ Anterior',
        callback_data: `admin_users_list:${safePage - 1}`,
      });
    }
    navRow.push({
      text: `📄 ${safePage + 1}/${totalPages}`,
      callback_data: `admin_users_list:${safePage}`,
    });
    if (safePage < totalPages - 1) {
      navRow.push({
        text: 'Siguiente ➡️',
        callback_data: `admin_users_list:${safePage + 1}`,
      });
    }
    keyboard.push(navRow);
  }

  keyboard.push([
    { text: '🔄 Actualizar (/usuarios)', callback_data: `admin_users_list:${safePage}` },
    { text: '⚡ Pool y Cuota', callback_data: 'quota_menu' },
  ]);
  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function sendOrEditAdminUserDetailInTelegram(
  chatId: string,
  messageId: number | null,
  targetUserChatId: string,
  returnPage = 0,
  notice?: string
): Promise<void> {
  if (!isMasterAdminChat(chatId)) return;

  const summary = buildAdminUsersSummaryData();
  const u = summary.users.find((item) => String(item.chatId) === String(targetUserChatId));
  if (!u) {
    await sendOrEditAdminUsersDashboardInTelegram(
      chatId,
      messageId,
      returnPage,
      undefined,
      `⚠️ <b>El usuario <code>${escapeHtml(targetUserChatId)}</code> ya no se encuentra en la lista.</b>`
    );
    return;
  }

  const stageLabel = (st: string) => {
    if (st === 'completed') return '✅ Publicado';
    if (st === 'failed') return '❌ Fallido';
    if (st === 'cancelled') return '🛑 Cancelado';
    if (st === 'queued') return '⏳ En cola';
    return '🚀 Subiendo';
  };

  const recentJobsBlock =
    u.recentJobs.length > 0
      ? u.recentJobs
          .map((j, idx) => {
            const dayTag = j.isToday ? '🟢 <b>HOY</b>' : escapeHtml(formatCubaShortDateTime(j.updatedAt));
            const pubTag = j.pictaPublicationId ? ` · <code>#${j.pictaPublicationId}</code>` : '';
            const speedTag = j.speedMBps > 0 ? ` · ${j.speedMBps} MB/s` : '';
            return (
              `<b>${idx + 1}.</b> ${stageLabel(j.stage)} · <b>${escapeHtml(j.title.slice(0, 34))}</b>\n` +
              `   └ ${dayTag} · ${escapeHtml(j.category)} · <code>${formatBytes(j.bytes)}</code>${speedTag}${pubTag}`
            );
          })
          .join('\n')
      : `<i>Este usuario aún no registra transferencias en el historial del bot.</i>`;

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`FICHA DE USUARIO · ${u.displayName}`)}\n` +
    hudBox([
      `👤 <b>Usuario:</b> ${escapeHtml(u.displayName)}${u.username ? ` (@${escapeHtml(u.username)})` : ''} · <code>${escapeHtml(u.chatId)}</code>`,
      `📅 <b>Autorizado:</b> ${new Date(u.authorizedAt).toLocaleString('es-CU')}`,
      `📺 <b>Canal Picta:</b> ${escapeHtml(u.pictaChannelLabel)}${u.availableChannelsCount > 1 ? ` (+${u.availableChannelsCount - 1} canales más)` : ''}`,
      `🔑 <b>Cuenta Picta:</b> <code>${escapeHtml(u.pictaAccountLabel)}</code> · ${u.sessionStatusLabel}`,
      u.promoChannel?.telegramChannelDisplay
        ? `📢 <b>Canal de Pedidos:</b> ${escapeHtml(u.promoChannel.telegramChannelDisplay)}`
        : null,
      u.pinnedSerie
        ? `📌 <b>Modo Ráfaga Activo:</b> ${escapeHtml(u.pinnedSerie.serieName)} (Temporada ${escapeHtml(u.pinnedSerie.seasonNum)})`
        : null,
    ]) +
    `\n${hudSection(`Uso de Cuota Diaria (${summary.currentDateCuba})`)}\n` +
    hudBox([
      `⚡ <b>Subidos Hoy:</b> <code>${hudSegmentedBar(u.quotaPercent, 10)}</code> <b>${u.uploadedTodayCount}/${u.dailyQuotaLimit}</b> (${u.remainingTodayCount} cupos libres)`,
      `🎬 <b>Películas / Otros Hoy:</b> <b>${u.moviesUploadedTodayCount}</b> · 📺 <b>Capítulos de Serie Hoy:</b> <b>${u.seriesUploadedTodayCount}</b>`,
      `📦 <b>Tráfico Hoy:</b> <code>${formatBytes(u.bytesUploadedToday)}</code>${u.failedTodayCount > 0 ? ` · ⚠️ ${u.failedTodayCount} intento(s) fallido(s) hoy` : ''}`,
      `📊 <b>Acumulado Histórico:</b> <b>${u.totalCompletedCount}</b> publicados (<code>${formatBytes(u.totalBytesUploaded)}</code>)${u.avgSpeedMBps > 0 ? ` · Velocidad media: <b>${u.avgSpeedMBps} MB/s</b>` : ''}`,
    ]) +
    `\n${hudSection(`Últimos Videos del Usuario (${u.recentJobs.length})`)}\n` +
    `${recentJobsBlock}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: '🔄 Actualizar Ficha',
        callback_data: `admin_user_detail:${u.chatId}:${returnPage}`,
      },
    ],
  ];

  if (!u.isMasterAdmin) {
    keyboard.push([
      {
        text: `🚫 Revocar Acceso a ${u.displayName.slice(0, 18)}`,
        callback_data: `admin_user_revoke_prompt:${u.chatId}:${returnPage}`,
      },
    ]);
  }

  keyboard.push([
    {
      text: '⬅️ Volver a Lista de Usuarios (/usuarios)',
      callback_data: `admin_users_list:${returnPage}`,
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, undefined, keyboard);
  }
}

interface PendingMultiPartItem {
  telegramMessageId: number;
  fileId: string;
  fileUniqueId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string;
  thumbnailFileId?: string;
}

interface PendingMultiPartSession {
  chatId: string;
  statusMessageId: number | null;
  parts: PendingMultiPartItem[];
  assembling?: boolean;
}

const pendingMultiPartByChat = new Map<string, PendingMultiPartSession>();

async function sendOrEditMultiPartMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  let session = pendingMultiPartByChat.get(chatId);
  if (!session) {
    session = {
      chatId,
      statusMessageId: messageId,
      parts: [],
    };
    pendingMultiPartByChat.set(chatId, session);
  } else if (messageId) {
    session.statusMessageId = messageId;
  }

  const totalBytes = session.parts.reduce((acc, p) => acc + Math.max(0, p.sizeBytes), 0);
  const partsListHtml =
    session.parts.length > 0
      ? session.parts
          .map(
            (p, idx) =>
              `<b>Parte ${idx + 1}:</b> <code>${escapeHtml(p.fileName)}</code> · <b>${formatBytes(p.sizeBytes)}</b>`
          )
          .join('\n')
      : `<i>Aún no has enviado partes. Reenvía o sube ahora la Parte 1, Parte 2, etc.</i>`;

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader('UNIÓN Y DESCOMPRESIÓN EN DISCO EFÍMERO (/unir)')}\n` +
    hudBox([
      `💿 <b>Almacenamiento:</b> Disco Efímero (<code>${escapeHtml(TMP_UPLOAD_DIR)}</code>)`,
      `🧠 <b>Perfil de RAM:</b> Ultra-Bajo (<code>256 KB</code> buffer · 0 sobrecarga)`,
      `📦 <b>Partes en lista:</b> <b>${session.parts.length}</b> · <b>Total:</b> <code>${formatBytes(totalBytes)}</code> (Máx. 5.00 GB S3)`,
    ]) +
    `\n${hudSection('Partes Recibidas en Orden')}\n` +
    `${partsListHtml}\n\n` +
    `💡 <i>Soporta partes cortadas (<code>.001/.002</code>, <code>.part1</code>), archivos comprimidos (<code>.zip</code>, <code>.tar</code>) o partes de video (<code>Parte1.mp4 + Parte2.mp4</code>). Cuando hayas enviado todas las partes, pulsa <b>Unir / Descomprimir en Disco y Subir</b>.</i>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (session.parts.length >= 1 && !session.assembling) {
    keyboard.push([
      {
        text: `🚀 Unir / Descomprimir en Disco y Subir (${session.parts.length} parte${session.parts.length === 1 ? '' : 's'})`,
        callback_data: 'multipart_join:confirm',
      },
    ]);
    keyboard.push([
      {
        text: '🧹 Vaciar Lista de Partes',
        callback_data: 'multipart_join:clear',
      },
    ]);
  }
  keyboard.push([
    {
      text: '❌ Salir del Modo /unir',
      callback_data: 'multipart_join:cancel',
    },
    {
      text: '◈ Menú Principal',
      callback_data: 'cmd_start',
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    if (sentId) {
      session.statusMessageId = sentId;
    }
  }
}

async function executeMultiPartJoinAndCreateJobInTelegram(
  chatId: string,
  messageId: number | null
): Promise<void> {
  const session = pendingMultiPartByChat.get(chatId);
  if (!session || session.parts.length === 0) {
    await sendOrEditMultiPartMenuInTelegram(
      chatId,
      messageId,
      undefined,
      `⚠️ <b>Primero envía al menos una parte o archivo comprimido al chat.</b>`
    );
    return;
  }
  if (session.assembling) return;

  const totalExpected = session.parts.reduce((acc, p) => acc + Math.max(0, p.sizeBytes), 0);
  if (totalExpected > PICTA_S3_MAX_OBJECT_BYTES) {
    await sendOrEditMultiPartMenuInTelegram(
      chatId,
      messageId,
      undefined,
      `⛔ <b>El peso combinado (${formatBytes(totalExpected)}) supera el tope de 5.00 GB de MinIO S3 en Picta.</b>`
    );
    return;
  }

  session.assembling = true;
  const userChannelCtx = getEffectivePictaContext(chatId);
  const masterJobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const downloadedDescriptors: MultiPartSourceDescriptor[] = [];

  try {
    for (let i = 0; i < session.parts.length; i++) {
      const p = session.parts[i];
      await editTelegramStatusMessage(
        chatId,
        messageId || session.statusMessageId,
        `${hudHeader(`DESCARGANDO PARTE ${i + 1}/${session.parts.length} AL DISCO EFÍMERO`)}\n` +
          hudBox([
            `📄 <b>Archivo:</b> <code>${escapeHtml(p.fileName)}</code>`,
            `📦 <b>Tamaño:</b> ${formatBytes(p.sizeBytes)}`,
            `💿 <b>Destino:</b> <code>${escapeHtml(TMP_UPLOAD_DIR)}</code>`,
          ]) +
          `\n⏳ <i>Descargando vía Pool MTProto 4 GB...</i>`,
        undefined,
        true
      );

      const partTempJob: VideoTransferJob = {
        id: `${masterJobId}_part${i + 1}`,
        telegramMessageId: p.telegramMessageId,
        statusMessageId: messageId || session.statusMessageId,
        telegramChatId: chatId,
        senderName: 'MultiPart',
        fileId: p.fileId,
        fileUniqueId: p.fileUniqueId,
        fileName: p.fileName,
        mimeType: p.mimeType || 'application/octet-stream',
        caption: p.caption || '',
        expectedBytes: p.sizeBytes,
        downloadedBytes: 0,
        integrityVerified: false,
        diskVerifiedBytes: 0,
        uploadedBytes: 0,
        stage: 'downloading_mtproto',
        title: `Parte ${i + 1}/${session.parts.length} · ${p.fileName}`,
        titleMode: 'manual',
        synopsis: '',
        category: 'Película',
        tipologiaId: 1,
        tags: [],
        speedMBps: 0,
        targetChannelId: userChannelCtx.channelId,
        targetChannelName: userChannelCtx.channelName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const partFilePath = await downloadFullVideoFromTelegram(
        partTempJob,
        messageId || session.statusMessageId
      );
      const actualSize = fs.existsSync(partFilePath) ? fs.statSync(partFilePath).size : p.sizeBytes;
      downloadedDescriptors.push({
        fileName: p.fileName,
        filePath: partFilePath,
        sizeBytes: actualSize,
      });
    }

    await editTelegramStatusMessage(
      chatId,
      messageId || session.statusMessageId,
      `${hudHeader('UNIENDO / DESCOMPRIMIENDO EN DISCO EFÍMERO')}\n` +
        hudBox([
          `🧩 <b>Partes descargadas:</b> ${downloadedDescriptors.length}`,
          `🧠 <b>Buffer RAM:</b> <code>256 KB</code> (sin sobrecarga de memoria)`,
          `💿 <b>Disco Efímero:</b> <code>${escapeHtml(TMP_UPLOAD_DIR)}</code>`,
        ]) +
        `\n⏳ <i>Ensamblando archivo único y limpiando fragmentos temporales...</i>`,
      undefined,
      true
    );

    const assembled = await assembleMultiPartFilesOnDisk(
      downloadedDescriptors,
      TMP_UPLOAD_DIR,
      masterJobId
    );

    const firstPart = session.parts[0];
    pendingMultiPartByChat.delete(chatId);

    const safeExt = path.extname(assembled.finalFileName) || '.mp4';
    const canonicalJobPath = path.join(TMP_UPLOAD_DIR, `${masterJobId}${safeExt}`);
    if (assembled.finalFilePath !== canonicalJobPath) {
      fs.renameSync(assembled.finalFilePath, canonicalJobPath);
    }

    const combinedCaption = session.parts
      .map((pt) => pt.caption)
      .filter(Boolean)
      .join('\n')
      .trim();
    const analyzedIntake = analyzeVideoTitleAndSynopsis(assembled.finalFileName, combinedCaption);

    const unifiedJob: VideoTransferJob = {
      id: masterJobId,
      telegramMessageId: firstPart.telegramMessageId,
      statusMessageId: messageId || session.statusMessageId,
      telegramChatId: chatId,
      senderName: 'MultiPart',
      fileId: firstPart.fileId,
      fileUniqueId: firstPart.fileUniqueId,
      thumbnailFileId: firstPart.thumbnailFileId,
      fileName: assembled.finalFileName,
      mimeType: 'video/mp4',
      caption: combinedCaption,
      expectedBytes: assembled.finalSizeBytes,
      downloadedBytes: assembled.finalSizeBytes,
      integrityVerified: true,
      diskVerifiedBytes: assembled.finalSizeBytes,
      uploadedBytes: 0,
      tempFilePath: canonicalJobPath,
      stage: 'awaiting_category',
      title: analyzedIntake.initialTitle,
      titleMode: 'pending',
      synopsis: analyzedIntake.initialSynopsis,
      category: 'Audiovisual',
      tipologiaId: 8,
      tags: [],
      speedMBps: 0,
      targetChannelId: userChannelCtx.channelId,
      targetChannelName: userChannelCtx.channelName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    transferJobs.unshift(unifiedJob);
    saveJobsToDisk();

    await editTelegramStatusMessage(
      chatId,
      messageId || session.statusMessageId,
      `${hudHeader('ARCHIVO UNIDO AL 100% EN DISCO EFÍMERO')}\n` +
        hudBox([
          `📄 <b>Archivo resultante:</b> <code>${escapeHtml(assembled.finalFileName)}</code>`,
          `📦 <b>Tamaño íntegro:</b> <b>${formatBytes(assembled.finalSizeBytes)}</b>`,
          `⚙️ <b>Modo aplicado:</b> <code>${escapeHtml(assembled.modeUsed)}</code>`,
          `📺 <b>Canal destino:</b> ${escapeHtml(userChannelCtx.channelName)} (#${escapeHtml(userChannelCtx.channelId)})`,
        ]) +
        `\n📂 <b>Selecciona ahora la categoría de Picta para subirlo de inmediato:</b>`,
      buildCategorySelectionKeyboard(unifiedJob.id),
      true
    );
  } catch (err) {
    session.assembling = false;
    for (const d of downloadedDescriptors) {
      if (fs.existsSync(d.filePath)) {
        try {
          fs.unlinkSync(d.filePath);
        } catch {
          // Ignore
        }
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    await sendOrEditMultiPartMenuInTelegram(
      chatId,
      messageId || session.statusMessageId,
      undefined,
      `❌ <b>Error al unir/descomprimir en el disco efímero:</b> <code>${escapeHtml(errMsg.slice(0, 180))}</code>`
    );
  }
}

function isTransferJobRunningOrProcessing(excludeJobId?: string): boolean {
  if (activeDownloadJobId && activeDownloadJobId !== excludeJobId) return true;
  if (activeUploadJobId && activeUploadJobId !== excludeJobId) return true;
  if (activeJobId && activeJobId !== excludeJobId) return true;
  for (const id of runningJobIds) {
    if (id !== excludeJobId) return true;
  }
  return false;
}

async function triggerCloudRunKeepAliveTransfer(
  jobId: string,
  customTitle?: string,
  callbackMessageId?: number | null
): Promise<void> {
  const job = transferJobs.find((j) => j.id === jobId);
  if (!job) return;

  cancelledJobIds.delete(job.id);

  if (callbackMessageId) {
    job.statusMessageId = Number(callbackMessageId);
  }
  if (customTitle && customTitle.trim()) {
    job.title = customTitle.trim();
    job.titleMode = 'manual';
  }
  resolveJobTargetChannelInfo(job);

  if (runningJobIds.has(job.id)) {
    return;
  }

  job.stage = 'queued';
  job.errorDetails = undefined;
  job.encoderRetryNextAt = undefined;
  if (!uploadQueue.includes(job.id)) {
    uploadQueue.push(job.id);
  }
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  const userQueued = uploadQueue.filter((id) => {
    const qj = transferJobs.find((j) => j.id === id);
    return qj && (isMasterAdminChat(job.telegramChatId) || qj.telegramChatId === job.telegramChatId);
  });
  const qPos = Math.max(1, userQueued.indexOf(job.id) + 1);

  if (isTransferJobRunningOrProcessing(job.id)) {
    addLiveLog(
      'system',
      'info',
      `Video "${job.title}" puesto en cola (posición #${qPos}). El pipeline dual descargará/subirá automáticamente.`
    );

    const queueCard =
      `⏳ <b>EN COLA DE SUBIDA · POSICIÓN #${qPos}</b>\n` +
      `<blockquote>` +
      `🎬 <b>Título:</b> ${escapeHtml(job.title)}\n` +
      `📂 <b>Categoría:</b> ${escapeHtml(job.category)}\n` +
      `📦 <b>Tamaño:</b> ${formatBytes(job.expectedBytes)}` +
      `</blockquote>\n` +
      `<i>Se pre-descargará y publicará automáticamente sin esperas innecesarias.</i>`;

    const qKb = [
      [{ text: '🛑 Cancelar esta subida', callback_data: `cancel_job:${job.id}` }],
      [{ text: '📋 Ver Cola de Espera', callback_data: 'queue_view' }],
    ];

    if (job.statusMessageId) {
      await editTelegramStatusMessage(job.telegramChatId, job.statusMessageId, queueCard, qKb, true);
    } else {
      const sentId = await sendTelegramStatusMessage(
        job.telegramChatId,
        queueCard,
        job.telegramMessageId,
        qKb
      );
      if (sentId) {
        job.statusMessageId = sentId;
        saveJobsToDisk();
      }
    }
  }

  void scheduleTransferPipeline();

  // Hold webhook HTTP request briefly while active so Cloud Run keeps 100% CPU
  const deadline = Date.now() + 45_000;
  while (
    Date.now() < deadline &&
    (activeDownloadJobId === job.id || activeUploadJobId === job.id || runningJobIds.has(job.id))
  ) {
    await new Promise((r) => setTimeout(r, 800));
  }
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderVisualBar(pct: number, size = 10): string {
  return hudSegmentedBar(pct, size);
}

function renderWizardStepBar(step: 1 | 2 | 3 | 4): string {
  return hudWizardStep(step);
}

interface PendingPubEditState {
  pubId: number;
  pubTitle: string;
  mode: 'title' | 'desc' | 'cover' | 'poster' | 'both' | 'subs' | 'epnum' | 'tags';
  messageId: number | null;
  returnSort: string;
  returnPage: number;
}

interface PendingStandaloneSerieState {
  mode:
    | 'new_serie_name'
    | 'new_season_num'
    | 'edit_serie_name'
    | 'edit_serie_synopsis'
    | 'edit_serie_cover'
    | 'edit_serie_portada'
    | 'edit_serie_poster'
    | 'edit_serie_both';
  pelserId?: number;
  serieName?: string;
  messageId: number | null;
}

interface PendingChannelEditState {
  mode: 'nombre' | 'alias' | 'descripcion' | 'clasificacion' | 'avatar' | 'portada';
  messageId: number | null;
}

interface PendingToolkitInputState {
  mode:
    | 'new_playlist_name'
    | 'add_collaborator_id'
    | 'reply_comment_text'
    | 'new_persona_name'
    | 'new_keyword_name'
    | 'switch_channel_query'
    | 'edit_milestone_thresholds'
    | 'set_promo_requests_channel'
    | 'set_requests_group_chat'
    | 'add_or_check_request';
  targetId?: number;
  secondaryId?: number;
  promoId?: string;
  messageId: number | null;
}

const pendingPubEditByChat = new Map<string, PendingPubEditState>();
const pendingStandaloneSerieByChat = new Map<string, PendingStandaloneSerieState>();
const pendingChannelEditByChat = new Map<string, PendingChannelEditState>();
const pendingToolkitInputByChat = new Map<string, PendingToolkitInputState>();
const localChannelPlaylistsCache = new Map<number, PictaPlaylistRecord>();

async function downloadTelegramThumbnailBuffer(fileId: string): Promise<Buffer | null> {
  if (!fileId || !fileId.trim()) return null;
  try {
    const fileInfo = await callTelegramBotApi('getFile', { file_id: fileId.trim() });
    if (fileInfo?.file_path) {
      const fileUrl = `https://api.telegram.org/file/bot${botConfig.telegramBotToken.trim()}/${fileInfo.file_path}`;
      const res = await fetch(fileUrl);
      if (res.ok) {
        const arrBuf = await res.arrayBuffer();
        if (arrBuf.byteLength > 0) {
          return Buffer.from(arrBuf);
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

async function fetchPictaChannelDetails(chatId?: string): Promise<PictaChannelDetails> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const context = getEffectivePictaContext(effectiveChatId);
  if (!context.isLinked || !context.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await context.accessTokenPromise;
  const channelId = context.channelId;

  // Query /v1/canal/{id}/ first because it returns HTTP 200 with accurate cantidad_suscripciones (271) and donar fields
  let res = await fetchPictaWithRetry(
    `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    }
  );

  if (!res.ok) {
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v2/canal/${encodeURIComponent(channelId)}/`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      }
    );
  }

  if (!res.ok) {
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v2/canal/?id=${encodeURIComponent(channelId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      }
    );
  }

  if (!res.ok) {
    throw new Error(`Error HTTP ${res.status} al obtener detalles del canal #${channelId}`);
  }

  const rawText = (await res.text()).trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    try {
      const cleanEncrypted = rawText.replace(/^"|"$/g, '');
      const decipher = crypto.createDecipheriv(
        'aes-128-ecb',
        Buffer.from(PICTA_AES_KEY, 'utf8'),
        null
      );
      let decrypted = decipher.update(cleanEncrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      parsed = JSON.parse(decrypted);
    } catch {
      parsed = {};
    }
  }

  const details = normalizePictaChannelDetails(
    parsed,
    channelId,
    context.channelName,
    botConfig.pictaClasificacion || '18+'
  );

  // Sync updated name/alias back into local session or master channel list
  const session = userSessions.get(effectiveChatId);
  if (session && details.nombre) {
    session.channelName = details.nombre;
    const foundChan = (session.availableChannels || []).find(
      (c) => String(c.id) === String(details.id)
    );
    if (foundChan) {
      foundChan.nombre = details.nombre;
      if (details.alias) foundChan.alias = details.alias;
    }
    saveUserSessionsToDisk();
  } else if (effectiveChatId === MASTER_ADMIN_CHAT_ID && pictaChannels[0]) {
    if (details.nombre) pictaChannels[0].nombre = details.nombre;
    if (details.alias) pictaChannels[0].alias = details.alias;
  }

  return details;
}

async function patchPictaChannelDetails(
  chatId: string,
  fields: Record<string, string>,
  files?: {
    avatarBuffer?: Buffer;
    coverBuffer?: Buffer;
  }
): Promise<PictaChannelDetails> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const context = getEffectivePictaContext(effectiveChatId);
  if (!context.isLinked || !context.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await context.accessTokenPromise;
  const channelId = context.channelId;

  const buildForm = () => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      form.append(k, v);
    }
    if (files?.avatarBuffer) {
      form.append(
        'url_avatar',
        new Blob([new Uint8Array(files.avatarBuffer)], { type: 'image/jpeg' }),
        `avatar_${channelId}_${Date.now()}.jpg`
      );
    }
    if (files?.coverBuffer) {
      form.append(
        'url_imagen',
        new Blob([new Uint8Array(files.coverBuffer)], { type: 'image/jpeg' }),
        `portada_${channelId}_${Date.now()}.jpg`
      );
    }
    return form;
  };

  let res = await fetchPictaWithRetry(
    `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: buildForm(),
    }
  );

  if (res.status === 404 || res.status === 405) {
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v2/canal/${encodeURIComponent(channelId)}/`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
        body: buildForm(),
      }
    );
  }

  if (res.status === 401 || res.status === 403) {
    const freshToken =
      effectiveChatId === MASTER_ADMIN_CHAT_ID && !userSessions.has(effectiveChatId)
        ? await authenticateWithPicta(true)
        : await refreshUserPictaSession(effectiveChatId);
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${freshToken}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
        body: buildForm(),
      }
    );
  }

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }

  if (fields.nombre) {
    const session = userSessions.get(effectiveChatId);
    if (session) {
      session.channelName = fields.nombre.trim();
      const foundChan = (session.availableChannels || []).find(
        (c) => String(c.id) === String(channelId)
      );
      if (foundChan) foundChan.nombre = fields.nombre.trim();
      saveUserSessionsToDisk();
    } else if (effectiveChatId === MASTER_ADMIN_CHAT_ID && pictaChannels[0]) {
      pictaChannels[0].nombre = fields.nombre.trim();
    }
  }
  if (fields.alias && effectiveChatId === MASTER_ADMIN_CHAT_ID && pictaChannels[0]) {
    pictaChannels[0].alias = fields.alias.trim();
  }
  if (fields.clasificacion && effectiveChatId === MASTER_ADMIN_CHAT_ID) {
    botConfig.pictaClasificacion = fields.clasificacion.trim();
  }

  try {
    return await fetchPictaChannelDetails(effectiveChatId);
  } catch {
    const rawText = await res.text().catch(() => '{}');
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {};
    }
    return normalizePictaChannelDetails(
      { ...parsed, ...fields },
      channelId,
      fields.nombre || context.channelName,
      fields.clasificacion || botConfig.pictaClasificacion || '18+'
    );
  }
}

async function sendOrEditChannelEditorMenu(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  bannerNotice?: string
): Promise<void> {
  pendingChannelEditByChat.delete(chatId);
  const ctx = getEffectivePictaContext(chatId);

  if (!ctx.isLinked || !ctx.channelId) {
    const session = userSessions.get(chatId);
    if (session && session.authToken) {
      const needChanText =
        `${hudHeader(`ESTUDIO DE CANAL · ${session.userFullName || session.username}`)}\n` +
        hudBox([
          `🔑 <b>Sesión:</b> 🟢 Activa`,
          `📺 <b>Canal:</b> ⚪ Pendiente de vincular`,
        ]) +
        `\nEscribe el <b>enlace</b>, <b>slug</b> o <b>ID numérico</b> de tu canal:\n` +
        `<code>/canal https://www.picta.cu/canal/mi-canal</code>`;
      const needChanKb = [
        [{ text: '🔍 Escribir Enlace o ID', callback_data: 'chan_switch:prompt' }],
        [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
      ];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, needChanText, needChanKb, true);
      } else {
        await sendTelegramStatusMessage(chatId, needChanText, replyToMessageId, needChanKb);
      }
      return;
    }

    const unlinkedText =
      `${hudHeader('ESTUDIO DE CANAL · SIN VINCULAR')}\n` +
      hudBox([`⚪ Vincula tu cuenta de Picta con /login para administrar tu canal.`]);
    const unlinkedKb = [
      [{ text: '🔑 Vincular Cuenta (/login)', callback_data: 'user_picta_login_start' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, unlinkedText, unlinkedKb, true);
    } else {
      await sendTelegramStatusMessage(chatId, unlinkedText, replyToMessageId, unlinkedKb);
    }
    return;
  }

  let details: PictaChannelDetails;
  let fetchWarning = '';
  try {
    details = await fetchPictaChannelDetails(chatId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fetchWarning = `⚠️ <i>Aviso al sincronizar: ${escapeHtml(msg.slice(0, 100))}</i>\n\n`;
    const isMaster = chatId === MASTER_ADMIN_CHAT_ID;
    details = normalizePictaChannelDetails(
      {
        id: Number(ctx.channelId),
        nombre: ctx.channelName,
        alias: isMaster ? pictaChannels[0]?.alias || '' : '',
        descripcion: isMaster ? botConfig.channelThemeDescription || '' : '',
        clasificacion: botConfig.pictaClasificacion || '18+',
        publicado: true,
        donacion: false,
      },
      ctx.channelId,
      ctx.channelName,
      botConfig.pictaClasificacion || '18+'
    );
  }

  const editorText =
    (bannerNotice ? `${bannerNotice}\n\n` : '') +
    fetchWarning +
    `${hudHeader(`ESTUDIO DE CANAL · ${details.nombre}`)}\n` +
    hudBox([
      `📺 <b>Canal:</b> ${escapeHtml(details.nombre)} · <code>#${details.id}</code>`,
      `🏷️ <b>Alias:</b> ${escapeHtml(details.alias || 'Sin lema definido')}`,
      `🔞 <b>Edad:</b> <b>${escapeHtml(details.clasificacion || '18+')}</b> · ${details.publicado ? '🟢 Público' : '🙈 Oculto'}`,
      `💳 <b>Donaciones:</b> ${details.donacion ? '🟢 Activas' : '⚪ Pausadas'} · 👥 <b>${Number(details.cantidad_suscriptores || 0).toLocaleString()}</b> suscrip.`,
      `🖼️ <b>Avatar:</b> ${details.url_avatar ? '✅' : '⚪'} · <b>Portada:</b> ${details.url_imagen ? '✅' : '⚪'}`,
    ]) +
    `\n${hudSection('Biografía')}\n` +
    hudBox([`<i>${escapeHtml((details.descripcion || 'Sin descripción configurada.').slice(0, 340))}</i>`]) +
    `\n<i>Selecciona un parámetro para actualizarlo en tiempo real:</i>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: '✏️ Nombre', callback_data: 'chan_edit:nombre' },
      { text: '🏷️ Lema / Alias', callback_data: 'chan_edit:alias' },
    ],
    [
      { text: '📝 Biografía', callback_data: 'chan_edit:descripcion' },
      {
        text: `🔞 Edad (${details.clasificacion || '18+'})`,
        callback_data: 'chan_edit:clasificacion',
      },
    ],
    [
      { text: '👤 Avatar', callback_data: 'chan_edit:avatar' },
      { text: '🖼️ Portada', callback_data: 'chan_edit:portada' },
    ],
    [
      {
        text: details.publicado ? '🙈 Ocultar Canal' : '🟢 Hacer Público',
        callback_data: 'chan_toggle:publicado',
      },
      {
        text: details.donacion ? '💳 Pausar Donaciones' : '💳 Activar Donaciones',
        callback_data: 'chan_toggle:donacion',
      },
    ],
    [
      { text: '💬 Comentarios', callback_data: 'comments_menu:0' },
      { text: '📂 Listas (/listas)', callback_data: 'playlists_menu:0' },
    ],
    [
      { text: '👥 Colaboradores', callback_data: 'chan_collabs:open' },
      { text: '🎭 Actores y Tags', callback_data: 'personas_menu' },
    ],
    [
      { text: '🔄 Cambiar Canal', callback_data: 'chan_switch:prompt' },
      { text: '🩺 Auditoría (/auditoria)', callback_data: 'audit:dups:0' },
    ],
    [
      { text: '📊 Videos (/stats)', callback_data: 'dash_refresh:views:0' },
      { text: '🔄 Sincronizar', callback_data: 'chan_editor:refresh' },
    ],
    [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
  ];

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, editorText, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, editorText, replyToMessageId, keyboard);
  }
}

async function sendOrEditMainMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number
): Promise<void> {
  const isMaster = chatId === MASTER_ADMIN_CHAT_ID;
  let session = userSessions.get(chatId);
  if (!isMaster && session && !session.channelId) {
    await ensureGuestSessionChannelDiscovered(chatId).catch(() => null);
    session = userSessions.get(chatId);
  }
  const pinned = pinnedBatchSerieByChat.get(chatId);
  const ctx = getEffectivePictaContext(chatId);
  ensureDailyQuotaReset();

  const publishablePoolCount = getPoolAccountsForChat(chatId).filter(
    (acc) => acc.canPublishDirectly !== false
  ).length;
  const totalDailyCap = (1 + publishablePoolCount) * 10;
  const usedToday = isMaster
    ? (quotaSettings.seriesUploadedToday || 0) + (quotaSettings.otherUploadedToday || 0)
    : transferJobs.filter(
        (j) =>
          j.telegramChatId === chatId &&
          j.stage === 'completed' &&
          toCubaDateStr(j.updatedAt || j.createdAt) === quotaSettings.currentDateCuba
      ).length;

  const userQueueCount = filterJobsForUser(
    uploadQueue
      .map((id) => transferJobs.find((j) => j.id === id))
      .filter((j): j is VideoTransferJob => Boolean(j)),
    chatId,
    MASTER_ADMIN_CHAT_ID
  ).length;

  const startKeyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: '🏛️ Estudio de Canal (/canal)',
        callback_data: 'chan_editor:open',
      },
      {
        text: '📊 Videos y Stats (/stats)',
        callback_data: 'dash_refresh:views:0',
      },
    ],
    [
      {
        text: '📺 Mis Series y Ráfaga (/series)',
        callback_data: 'my_series:0',
      },
      {
        text: '🔎 Buscar en Picta (/buscar)',
        callback_data: 'picta_search:prompt',
      },
    ],
    [
      {
        text: '💬 Comentarios (/comentarios)',
        callback_data: 'comments_menu:0',
      },
      {
        text: '🏆 Logros y Alertas (/logros)',
        callback_data: 'alerts_menu',
      },
    ],
    [
      {
        text: '📂 Listas (/listas)',
        callback_data: 'playlists_menu:0',
      },
      {
        text: '🛡️ Cuenta Picta (/cuenta)',
        callback_data: 'cmd_cuenta',
      },
    ],
    [
      {
        text: '👥 Colaboradores (/colaboradores)',
        callback_data: 'chan_collabs:open',
      },
      {
        text: '🎭 Actores y Tags (/personas)',
        callback_data: 'personas_menu',
      },
    ],
    [
      {
        text: '📢 Canal de Pedidos (/canalpedidos)',
        callback_data: 'promo_cfg:open',
      },
      {
        text: `📥 Pedidos (${channelMediaRequests.filter((r) => r.ownerChatId === chatId && r.status === 'pending').length})`,
        callback_data: 'req:list:pending:0',
      },
    ],
    [
      {
        text: '🩺 Auditoría Canal (/auditoria)',
        callback_data: 'audit:dups:0',
      },
      ...(isMaster
        ? [
            {
              text: `👥 Usuarios (${authorizedUsers.size})`,
              callback_data: 'admin_users_list:0',
            },
          ]
        : [
            {
              text: '🔑 Mi Sesión (/login)',
              callback_data: 'user_picta_login_start',
            },
          ]),
    ],
    [
      {
        text: `📋 Cola (${userQueueCount})${pinned ? ` · 📌 ${pinned.serieName.slice(0, 10)}` : ''}`,
        callback_data: 'queue_view',
      },
      {
        text: `⚡ Cuota (${usedToday}/${totalDailyCap})`,
        callback_data: 'quota_menu',
      },
    ],
  ];

  if (!isMaster && !session) {
    startKeyboard.unshift([
      {
        text: '🔑 Vincular Cuenta Picta (/login)',
        callback_data: 'user_picta_login_start',
      },
    ]);
  } else if (!isMaster && session && (session.availableChannels || []).length > 1) {
    startKeyboard.unshift([
      {
        text: `📺 Cambiar Canal (${session.channelName.slice(0, 16)})`,
        callback_data: 'user_channel_pick:' + session.channelId,
      },
    ]);
  }

  const userDisplayHtml = isMaster
    ? `@${pictaUser?.username || 'Admin'} · +5350000000`
    : session
      ? `@${escapeHtml(session.userFullName || session.username)}`
      : '<i>Sin vincular (usa /login)</i>';

  const channelDisplayHtml =
    isMaster || (session && ctx.channelId)
      ? `<b>${escapeHtml(ctx.channelName)}</b> · <code>#${escapeHtml(ctx.channelId)}</code>`
      : '<i>Sin canal activo</i>';

  const quotaPct = totalDailyCap > 0 ? Math.round((usedToday / totalDailyCap) * 100) : 0;

  const text =
    `${hudHeader('PANEL DE CONTROL')}\n` +
    hudBox([
      `👤 <b>Cuenta:</b> ${userDisplayHtml}`,
      `📺 <b>Canal:</b> ${channelDisplayHtml}`,
      `🚀 <b>Motor:</b> MTProto 4 GB · Disco Efímero + S3 Directo`,
      `⚡ <b>Cuota Hoy:</b> <code>${hudSegmentedBar(quotaPct, 8)}</code> (${usedToday}/${totalDailyCap})`,
      pinned
        ? `📌 <b>Serie Fija:</b> 🟢 ${escapeHtml(pinned.serieName)} · T${escapeHtml(pinned.seasonNum)}`
        : null,
    ]) +
    `\n${hudSection('Módulos Operativos')}\n` +
    `• 🎬 <b>Subida Directa:</b> Envía cualquier video MP4/MKV y el bot completa ficha, portada HD y reparto.\n` +
    `• 💬 <b>Comunidad y Logros:</b> Alertas en tiempo real con respuesta directa y metas por video.\n` +
    `• 🛠️ <b>Estudio API:</b> Control total de series, listas, colaboradores y permisos sin web externa.`;

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, startKeyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, startKeyboard);
  }
}

// ============================================================================
// MOVIE PROMO CARDS & PRIVATE PER-USER REQUESTS CHANNEL AUTOMATION
// ============================================================================

async function resolveOwnerPictaChannelLinkAndName(chatId: string): Promise<{
  channelId: string;
  channelName: string;
  channelUrl: string;
}> {
  const ctx = getEffectivePictaContext(chatId);
  const channelId = String(ctx.channelId || '').trim();
  const channelName = String(ctx.channelName || 'Mi Canal en Picta').trim();
  const resolvedReq = resolveRequestsChannelForChat(
    chatId,
    MASTER_ADMIN_CHAT_ID,
    userPromoChannels,
    MASTER_PRIVATE_REQUESTS_CHANNEL
  );

  // Strict privacy: Master Admin's private Canal Oficial URL ONLY applies to Master Admin
  if (resolvedReq.isPrivateMasterDefault && isMasterAdminChat(chatId)) {
    return {
      channelId,
      channelName,
      channelUrl: MASTER_PRIVATE_REQUESTS_CHANNEL.pictaChannelUrl,
    };
  }

  let slugUrl = '';
  if (channelId) {
    const cacheKey = `${channelId}:${isMasterAdminChat(chatId) ? 'master' : chatId}`;
    const snap = channelCatalogSnapshotCache.get(cacheKey);
    if (snap?.channelSlugUrl) {
      slugUrl = snap.channelSlugUrl;
    } else if (ctx.isLinked) {
      const details = await Promise.race([
        fetchPictaChannelDetails(chatId).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
      ]);
      if (details?.slug_url) {
        slugUrl = details.slug_url;
      }
    }
  }

  const channelUrl = resolveCanonicalPictaChannelUrl({
    channelId,
    slugUrl,
    customUrl: resolvedReq.customPictaChannelUrl,
  });

  return {
    channelId,
    channelName,
    channelUrl,
  };
}

function buildMoviePromoConfirmationPrompt(
  promo: PendingMoviePromoRecord,
  chatId: string
): {
  textHtml: string;
  keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
} {
  const resolvedReq = resolveRequestsChannelForChat(
    chatId,
    MASTER_ADMIN_CHAT_ID,
    userPromoChannels,
    MASTER_PRIVATE_REQUESTS_CHANNEL
  );
  const ratingBadge = promo.rating ? `⭐ ${promo.rating}` : '⭐ N/D';
  const yearBadge = promo.year ? ` (${promo.year})` : '';
  const hasPhoto = Boolean(promo.posterUrl || promo.backdropUrl || promo.posterBase64);

  const boxLines: Array<string | undefined> = [
    `🎬 <b>Película:</b> ${escapeHtml(promo.title)}${escapeHtml(yearBadge)}`,
    `🎭 <b>Género:</b> ${escapeHtml(promo.genre || 'Película')} · ${escapeHtml(ratingBadge)}`,
    `🖼️ <b>Portada:</b> ${hasPhoto ? '✅ Lista para tarjeta visual' : '📝 Modo ficha HTML'}`,
    `📺 <b>Botón Canal Picta:</b> ${escapeHtml(promo.pictaChannelName)}`,
    resolvedReq.configured
      ? `📢 <b>Canal de Pedidos:</b> ${escapeHtml(resolvedReq.targetChannelLabel)} (<code>${escapeHtml(resolvedReq.targetChannelId)}</code>)`
      : `📢 <b>Canal de Pedidos:</b> ⚪ Sin configurar (solo privado para tu cuenta)`,
  ];

  const textHtml =
    `${hudHeader('FICHA PROMOCIONAL LISTA')}\n` +
    hudBox(boxLines) +
    `\n<blockquote>${escapeHtml((promo.synopsis || '').slice(0, 260))}${promo.synopsis.length > 260 ? '...' : ''}</blockquote>\n` +
    (resolvedReq.configured
      ? `¿Deseas publicar esta ficha visual en tu <b>Canal de Pedidos</b> ahora?`
      : `Configura primero tu propio <b>Canal de Pedidos</b> (el bot debe ser administrador) para publicar esta ficha con un toque:`);

  const keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];
  if (resolvedReq.configured) {
    keyboard.push([
      {
        text: '📢 Publicar Ficha en Canal de Pedidos',
        callback_data: `promo_send:${promo.promoId}`,
      },
    ]);
    keyboard.push([
      { text: '👁️ Vista Previa aquí', callback_data: `promo_preview:${promo.promoId}` },
      { text: '⚙️ Cambiar Canal', callback_data: `promo_cfg:prompt_for:${promo.promoId}` },
    ]);
    keyboard.push([
      { text: '⏭️ Omitir publicación', callback_data: `promo_skip:${promo.promoId}` },
    ]);
  } else {
    keyboard.push([
      { text: '⚙️ Configurar Canal de Pedidos', callback_data: `promo_cfg:prompt_for:${promo.promoId}` },
    ]);
    keyboard.push([
      { text: '👁️ Vista Previa aquí', callback_data: `promo_preview:${promo.promoId}` },
      { text: '⏭️ Omitir', callback_data: `promo_skip:${promo.promoId}` },
    ]);
  }

  return { textHtml, keyboard };
}

async function publishPromoRecordToTargetChat(
  promo: PendingMoviePromoRecord,
  targetChatId: string
): Promise<{ ok: boolean; messageId: number | null; viaFallbackText?: boolean; error?: string }> {
  try {
    const payload = buildMoviePromoCardPayload({
      title: promo.title,
      year: promo.year,
      rating: promo.rating,
      genre: promo.genre,
      synopsis: promo.synopsis,
      pictaVideoUrl: promo.pictaVideoUrl,
      pictaChannelUrl: promo.pictaChannelUrl,
      pictaChannelName: promo.pictaChannelName,
      posterUrl: promo.posterUrl,
      backdropUrl: promo.backdropUrl,
    });

    let photoBuffer: Buffer | null = null;
    if (promo.posterBase64) {
      try {
        photoBuffer = Buffer.from(promo.posterBase64, 'base64');
      } catch {
        photoBuffer = null;
      }
    }

    return await sendTelegramPhotoWithKeyboard({
      targetChatId,
      captionHtml: payload.photoCaptionHtml,
      fallbackTextHtml: payload.textMessageHtml,
      inlineKeyboard: payload.inlineKeyboard,
      photoUrl: payload.preferredImageUrl,
      photoBuffer,
    });
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handlePostUploadMoviePromoConfirmation(job: VideoTransferJob): Promise<void> {
  // Only offer movie promo cards for Movies (tipologiaId === 1) with an active Picta publication ID
  if (Number(job.tipologiaId) !== 1 || !job.pictaPublicationId) {
    return;
  }

  const chatId = String(job.telegramChatId || '').trim();
  if (!chatId) return;

  try {
    const meta = job.modelMetadata || {};
    const rawTitle = String(job.title || 'Película en Picta').trim();
    const yearFromTitle = rawTitle.match(/\((\d{4})\)/)?.[1] || '';
    const cleanTitleNoYear = rawTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    let year = String(meta.estreno || yearFromTitle || '').match(/\b(19\d\d|20\d\d)\b/)?.[1] || '';
    let rating = normalizeMovieRatingLabel(meta.calificacion || meta.rating || '');
    let genre = String(meta.genero || job.category || '').trim();
    if (!genre || genre.toLowerCase() === 'película' || genre.toLowerCase() === 'pelicula') {
      const cleanTags = (job.tags || [])
        .map((t) => String(t || '').trim())
        .filter((t) => t && !/^(hd|1080p|720p|4k|pelicula|película|espanol|español|latino)$/i.test(t));
      genre = cleanTags.slice(0, 3).join(', ') || 'Película';
    }

    let posterUrl = String(meta.onlinePosterUrl || meta.onlineCoverUrl || '').trim();
    let backdropUrl = String(meta.onlineBackdropUrl || '').trim();
    let synopsis = sanitizePublicPictaText(String(job.synopsis || '')).trim();

    // Quick online lookup only if poster OR rating is missing, bounded by 4s so cleanup is never stalled
    if ((!posterUrl || !rating) && cleanTitleNoYear && !isRandomOrCrypticFilename(cleanTitleNoYear)) {
      try {
        const quickOnline = await Promise.race([
          searchMovieOrSeriesInfoOnline(cleanTitleNoYear, 1),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (quickOnline) {
          if (!posterUrl && (quickOnline.posterUrl || quickOnline.imageUrl)) {
            posterUrl = String(quickOnline.posterUrl || quickOnline.imageUrl || '').trim();
          }
          if (!backdropUrl && (quickOnline.backdropUrl || quickOnline.imageUrl)) {
            backdropUrl = String(quickOnline.backdropUrl || quickOnline.imageUrl || '').trim();
          }
          if (!rating && quickOnline.rating) {
            rating = normalizeMovieRatingLabel(quickOnline.rating);
          }
          if (!year && quickOnline.year) {
            year = String(quickOnline.year).match(/\b(19\d\d|20\d\d)\b/)?.[1] || '';
          }
          if ((!synopsis || isGenericAutoSynopsis(synopsis, job.caption)) && quickOnline.synopsis) {
            synopsis = sanitizePublicPictaText(quickOnline.synopsis);
          }
          if (genre === 'Película' && quickOnline.genero) {
            genre = String(quickOnline.genero).split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean).slice(0, 3).join(', ') || 'Película';
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // If no external HTTPS image is available, preserve the Telegram poster/cover/thumb BEFORE cleanup
    let posterBase64: string | undefined;
    if (!posterUrl && !backdropUrl) {
      const fileIdCandidate = String(
        job.customPosterFileId || job.customCoverFileId || job.thumbnailFileId || ''
      ).trim();
      if (fileIdCandidate) {
        try {
          const buf = await downloadTelegramThumbnailBuffer(fileIdCandidate);
          if (buf && buf.byteLength > 200 && buf.byteLength < 1.5 * 1024 * 1024) {
            posterBase64 = buf.toString('base64');
          }
        } catch {
          // Non-fatal
        }
      }
    }

    const slug = String(meta.pictaSlugUrl || '').trim();
    const pictaVideoUrl = slug
      ? `https://www.picta.cu/medias/${encodeURIComponent(slug)}`
      : `https://www.picta.cu/medias/${job.pictaPublicationId}`;

    const ownerChannel = await resolveOwnerPictaChannelLinkAndName(chatId);
    const promoId = `prm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const record: PendingMoviePromoRecord = {
      promoId,
      jobId: job.id,
      ownerChatId: chatId,
      title: cleanTitleNoYear || rawTitle,
      ...(year ? { year } : {}),
      ...(rating ? { rating } : {}),
      ...(genre ? { genre } : {}),
      synopsis: synopsis || 'Película completa disponible para ver o descargar en Picta.',
      pictaPublicationId: job.pictaPublicationId,
      pictaVideoUrl,
      pictaChannelName: ownerChannel.channelName,
      pictaChannelUrl: ownerChannel.channelUrl,
      ...(posterUrl ? { posterUrl } : {}),
      ...(backdropUrl ? { backdropUrl } : {}),
      ...(posterBase64 ? { posterBase64 } : {}),
      createdAt: new Date().toISOString(),
    };

    pendingMoviePromos.set(promoId, record);
    savePendingPromosToDisk();

    const prompt = buildMoviePromoConfirmationPrompt(record, chatId);
    await sendTelegramStatusMessage(chatId, prompt.textHtml, job.telegramMessageId, prompt.keyboard);
  } catch (err) {
    addLiveLog(
      'telegram',
      'warn',
      `Aviso: no se pudo preparar la confirmación promocional de "${job.title}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function sendOrEditPromoChannelMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  noticeText?: string,
  returnPromoId?: string
): Promise<void> {
  const resolvedReq = resolveRequestsChannelForChat(
    chatId,
    MASTER_ADMIN_CHAT_ID,
    userPromoChannels,
    MASTER_PRIVATE_REQUESTS_CHANNEL
  );
  const ownerChan = await resolveOwnerPictaChannelLinkAndName(chatId);

  const rawCfg = userPromoChannels.get(chatId);
  const monitorMode: RequestsMonitorMode = rawCfg?.requestsMonitorMode || 'off';
  const groupLabel = rawCfg?.requestsGroupLabel || rawCfg?.requestsGroupChatId || 'Sin grupo vinculado';
  const monitorLabels: Record<RequestsMonitorMode, string> = {
    off: '⚪ Desactivado',
    prefix: '🟡 Solo #pedido / /buscar',
    all: '🟢 Todo mensaje en grupo',
  };
  const pendingReqCount = channelMediaRequests.filter(
    (r) => r.ownerChatId === chatId && r.status === 'pending'
  ).length;

  const lines: Array<string | undefined> = [
    resolvedReq.configured
      ? `📢 <b>Canal de Pedidos:</b> ${escapeHtml(resolvedReq.targetChannelLabel)}`
      : `📢 <b>Canal de Pedidos:</b> ⚪ Sin configurar`,
    resolvedReq.configured
      ? `🆔 <b>ID / Destino:</b> <code>${escapeHtml(resolvedReq.targetChannelId)}</code>`
      : undefined,
    `👥 <b>Grupo de Pedidos:</b> ${escapeHtml(groupLabel)}`,
    `🤖 <b>Auto-Verificador en Grupo:</b> ${monitorLabels[monitorMode]}`,
    `📥 <b>Pedidos Pendientes:</b> <b>${pendingReqCount}</b> (/pedidos)`,
    `📺 <b>Botón Canal Picta:</b> ${escapeHtml(ownerChan.channelName)}`,
    `🔗 <b>Enlace Picta:</b> <code>${escapeHtml(ownerChan.channelUrl)}</code>`,
    `🔐 <b>Privacidad:</b> Configuración 100% privada solo para tu cuenta`,
  ];

  const text =
    (noticeText ? `${noticeText}\n\n` : '') +
    `${hudHeader('CANAL DE PEDIDOS Y PROMOCIÓN')}\n` +
    hudBox(lines) +
    `\n<i>Al subir una película te preguntaré si deseas publicar su ficha en tu canal. También puedes vincular tu grupo donde piden contenido para que el bot verifique al instante si ya existe en Picta.</i>\n\n` +
    `📌 <b>Requisito:</b> Añade este bot como <b>Administrador</b> con permiso de publicar/responder mensajes.`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: resolvedReq.configured
          ? '✏️ Cambiar Canal de Pedidos'
          : '⚙️ Configurar mi Canal de Pedidos',
        callback_data: returnPromoId ? `promo_cfg:prompt_for:${returnPromoId}` : 'promo_cfg:set',
      },
    ],
    [
      {
        text: rawCfg?.requestsGroupChatId
          ? '✏️ Cambiar Grupo de Pedidos'
          : '👥 Vincular Grupo de Pedidos',
        callback_data: 'promo_cfg:group',
      },
      {
        text: `📥 Ver Pedidos (${pendingReqCount})`,
        callback_data: 'req:list:pending:0',
      },
    ],
    [
      {
        text: `${monitorMode === 'off' ? '✅ ' : ''}⚪ Auto: OFF`,
        callback_data: 'promo_cfg:mode:off',
      },
      {
        text: `${monitorMode === 'prefix' ? '✅ ' : ''}🟡 #pedido`,
        callback_data: 'promo_cfg:mode:prefix',
      },
      {
        text: `${monitorMode === 'all' ? '✅ ' : ''}🟢 Todo`,
        callback_data: 'promo_cfg:mode:all',
      },
    ],
  ];

  if (resolvedReq.configured) {
    keyboard.push([
      { text: '🧪 Verificar Permisos del Bot', callback_data: 'promo_cfg:test' },
      { text: '🚫 Desactivar Canal', callback_data: 'promo_cfg:disable' },
    ]);
  }

  if (returnPromoId && pendingMoviePromos.has(returnPromoId)) {
    keyboard.push([
      { text: '⬅️ Volver a Ficha de Película', callback_data: `promo_back:${returnPromoId}` },
    ]);
  }

  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

// ============================================================================
// AUDITORÍA DEL CANAL, GESTOR DE PEDIDOS E INGESTA POR ENLACES (t.me / HTTP)
// ============================================================================

const lastAuditReportCache = new Map<string, { report: ChannelAuditReport; fetchedAt: number }>();
const pendingRequestSaveByChat = new Map<
  string,
  { query: string; requesterName: string; requesterUsername?: string; sourceChatId?: string; sourceMessageId?: number }
>();

async function handlePostUploadRequestFulfillment(job: VideoTransferJob): Promise<void> {
  const ownerChatId = String(job.telegramChatId || '').trim();
  if (!ownerChatId) return;

  const matchedById = job.linkedRequestId
    ? channelMediaRequests.filter(
        (r) => r.id === job.linkedRequestId && r.ownerChatId === ownerChatId && r.status === 'pending'
      )
    : [];
  const matchedByTitle = findMatchingPendingRequests(
    channelMediaRequests,
    ownerChatId,
    job.title || job.fileName
  );

  const uniqueMatched = new Map<string, ChannelMediaRequest>();
  for (const r of [...matchedById, ...matchedByTitle]) {
    uniqueMatched.set(r.id, r);
  }
  if (uniqueMatched.size === 0) return;

  const slug = String(job.modelMetadata?.pictaSlugUrl || '').trim();
  const pictaUrl = job.pictaPublicationId
    ? slug
      ? `https://www.picta.cu/medias/${encodeURIComponent(slug)}`
      : `https://www.picta.cu/medias/${job.pictaPublicationId}`
    : '';
  const nowIso = new Date().toISOString();

  for (const req of uniqueMatched.values()) {
    req.status = 'fulfilled';
    req.fulfilledAt = nowIso;
    if (job.pictaPublicationId) req.matchedPictaPubId = job.pictaPublicationId;
    if (pictaUrl) req.matchedPictaUrl = pictaUrl;
  }
  saveChannelMediaRequestsToDisk();

  const fulfilledList = Array.from(uniqueMatched.values());
  const summaryLines = fulfilledList
    .slice(0, 4)
    .map(
      (r) =>
        `• <b>${escapeHtml(r.requestedTitle)}</b> (pedido por ${escapeHtml(r.requestedByName)})`
    )
    .join('\n');

  const commentReplyReq = fulfilledList.find(
    (r) => r.sourceType === 'picta_comment' && r.commentPublicationId && r.commentId
  );
  const fulfillKb: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  if (pictaUrl) {
    fulfillKb.push([{ text: '🌐 Ver en Picta', url: pictaUrl }]);
  }
  if (commentReplyReq && pictaUrl) {
    fulfillKb.push([
      {
        text: '💬 Responder Comentario en Picta',
        callback_data: `req:reply_cm:${commentReplyReq.id}`,
      },
    ]);
  }

  await sendTelegramStatusMessage(
    ownerChatId,
    `🎯 <b>¡Pedido(s) cumplido(s) automáticamente!</b>\n\n` +
      `${summaryLines}\n\n` +
      (pictaUrl ? `🔗 <b>Enlace en Picta:</b> ${escapeHtml(pictaUrl)}` : ''),
    job.telegramMessageId,
    fulfillKb.length > 0 ? (fulfillKb as any) : undefined
  ).catch(() => {});

  // Notify requester in source group if available
  for (const r of fulfilledList) {
    if (r.sourceChatId && r.sourceChatId !== ownerChatId && pictaUrl) {
      await callTelegramBotApi('sendMessage', {
        chat_id: r.sourceChatId,
        ...(r.sourceMessageId ? { reply_to_message_id: r.sourceMessageId } : {}),
        text:
          `🎬 <b>¡Tu pedido ya está disponible en Picta!</b>\n\n` +
          `📌 <b>Título:</b> ${escapeHtml(job.title)}\n` +
          `🔗 <b>Ver aquí:</b> ${escapeHtml(pictaUrl)}`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '▶️ Ver ahora en Picta', url: pictaUrl }]],
        },
      }).catch(() => {});
    }
  }
}

type ChannelAuditTab = 'dups' | 'inc' | 'unpub' | 'series';

async function sendOrEditChannelAuditInTelegram(
  chatId: string,
  messageId: number | null,
  tab: ChannelAuditTab = 'dups',
  page = 0,
  replyToMessageId?: number,
  forceRefresh = false
): Promise<void> {
  const ctx = getEffectivePictaContext(chatId);
  if (!ctx.isLinked || !ctx.channelId) {
    const noAuthText =
      `${hudHeader('AUDITORÍA DE CANAL · PICTA')}\n` +
      hudBox([
        `🔒 <b>Estado:</b> Cuenta de Picta sin vincular`,
        `👉 Vincula tu cuenta con /login para escanear duplicados y salud de tu canal.`,
      ]);
    const kb = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, noAuthText, kb, true);
    } else {
      await sendTelegramStatusMessage(chatId, noAuthText, replyToMessageId, kb);
    }
    return;
  }

  let statusMsgId = messageId;
  const cacheKey = `${ctx.channelId}:${chatId}`;
  let cached = !forceRefresh ? lastAuditReportCache.get(cacheKey) : undefined;
  if (!cached || Date.now() - cached.fetchedAt > 90_000) {
    const loadingText =
      `${hudHeader(`AUDITORÍA DE CANAL · ${ctx.channelName}`)}\n` +
      `🔎 <i>Escaneando todo el catálogo de tu canal en Picta para detectar duplicados internos, fichas incompletas y videos ocultos...</i>`;
    if (statusMsgId) {
      await editTelegramStatusMessage(chatId, statusMsgId, loadingText, undefined, true);
    } else {
      statusMsgId = await sendTelegramStatusMessage(chatId, loadingText, replyToMessageId);
    }
    const snapshot = await fetchPictaChannelCatalogSnapshot(chatId, forceRefresh);
    const report = buildChannelAuditReport(snapshot.publications);
    cached = { report, fetchedAt: Date.now() };
    lastAuditReportCache.set(cacheKey, cached);
  }

  const report = cached.report;
  const PAGE_SIZE = 5;

  let bodyHtml = '';
  let totalItems = 0;
  let totalPages = 1;
  let safePage = 0;
  const itemButtons: Array<Array<{ text: string; callback_data: string }>> = [];

  if (tab === 'dups') {
    const groups = report.duplicateGroups;
    totalItems = groups.length;
    totalPages = Math.max(1, Math.ceil(totalItems / 3));
    safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = groups.slice(safePage * 3, (safePage + 1) * 3);
    if (slice.length === 0) {
      bodyHtml = `🟢 <b>¡Excelente!</b> No se detectaron videos duplicados dentro de tu propio canal.`;
    } else {
      bodyHtml = slice
        .map((g, gi) => {
          const lines = g.items
            .slice(0, 4)
            .map(
              (it) =>
                `   • <code>#${it.id}</code> <b>${escapeHtml(it.nombre.slice(0, 42))}</b> (${formatBytes(it.tamanio)} · 👁️ ${it.views})`
            )
            .join('\n');
          const firstDup = g.items[0];
          const extraDup = g.items[1];
          if (firstDup && extraDup) {
            itemButtons.push([
              {
                text: `🔎 Ver #${firstDup.id}`,
                callback_data: `dash_pub:${firstDup.id}:views:0`,
              },
              {
                text: `🔎 Ver copia #${extraDup.id}`,
                callback_data: `dash_pub:${extraDup.id}:views:0`,
              },
            ]);
          }
          return `<b>${safePage * 3 + gi + 1}. ${escapeHtml(g.reason)}</b>\n${lines}`;
        })
        .join('\n\n');
    }
  } else {
    const list =
      tab === 'inc'
        ? report.incompleteItems
        : tab === 'unpub'
          ? report.unpublishedItems
          : report.orphanEpisodeItems;
    totalItems = list.length;
    totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
    if (slice.length === 0) {
      const okMsg =
        tab === 'inc'
          ? 'Todas tus publicaciones tienen portada, sinopsis y etiquetas.'
          : tab === 'unpub'
            ? 'Todos los videos de tu canal están publicados y activos.'
            : 'No se detectaron capítulos sueltos sin asignar a su serie.';
      bodyHtml = `🟢 <b>¡Limpio!</b> ${okMsg}`;
    } else {
      bodyHtml = slice
        .map((it, idx) => {
          itemButtons.push([
            {
              text: `🛠️ Editar #${it.id} · ${it.nombre.slice(0, 22)}`,
              callback_data: `dash_pub:${it.id}:views:0`,
            },
          ]);
          return (
            `<b>${safePage * PAGE_SIZE + idx + 1}.</b> <code>#${it.id}</code> <b>${escapeHtml(it.nombre.slice(0, 48))}</b>\n` +
            `   ⚠️ <i>${escapeHtml(it.issueSummary)}</i> · 📂 ${escapeHtml(it.categoriaNombre)} · 👁️ ${it.views}`
          );
        })
        .join('\n\n');
    }
  }

  const tabTitles: Record<ChannelAuditTab, string> = {
    dups: '🔁 Posibles Duplicados',
    inc: '🖼️ Fichas Incompletas',
    unpub: '⏳ Sin Publicar / Moderación',
    series: '📺 Capítulos Sueltos',
  };

  const text =
    `${hudHeader(`AUDITORÍA DE CANAL · ${ctx.channelName}`)}\n` +
    hudBox([
      `📦 <b>Analizados:</b> <b>${report.totalScanned}</b> videos en <code>#${escapeHtml(ctx.channelId)}</code>`,
      `🔁 <b>Grupos duplicados:</b> ${report.duplicateGroups.length} · 🖼️ <b>Incompletos:</b> ${report.incompleteItems.length}`,
      `⏳ <b>Sin publicar/Moderación:</b> ${report.unpublishedItems.length} · 📺 <b>Capítulos sueltos:</b> ${report.orphanEpisodeItems.length}`,
    ]) +
    `\n${hudSection(`${tabTitles[tab]} · Pág. ${safePage + 1}/${totalPages}`)}\n\n` +
    (tab === 'unpub' && report.unpublishedItems.length > 0
      ? `<i>💡 Nota: Videos que nunca aprobó Picta o están esperando moderación aparecen aquí como "Sin publicar". Picta solo permite publicarlos tras aprobación de moderación, o puedes eliminarlos si ya no sirven.</i>\n\n`
      : '') +
    `${bodyHtml}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: `${tab === 'dups' ? '✅ ' : ''}🔁 Duplicados (${report.duplicateGroups.length})`,
        callback_data: `audit:dups:0`,
      },
      {
        text: `${tab === 'inc' ? '✅ ' : ''}🖼️ Incompletos (${report.incompleteItems.length})`,
        callback_data: `audit:inc:0`,
      },
    ],
    [
      {
        text: `${tab === 'unpub' ? '✅ ' : ''}⏳ Sin publicar (${report.unpublishedItems.length})`,
        callback_data: `audit:unpub:0`,
      },
      {
        text: `${tab === 'series' ? '✅ ' : ''}📺 Capítulos (${report.orphanEpisodeItems.length})`,
        callback_data: `audit:series:0`,
      },
    ],
    ...itemButtons,
  ];

  if (totalPages > 1) {
    const nav: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) nav.push({ text: '⬅️ Anterior', callback_data: `audit:${tab}:${safePage - 1}` });
    nav.push({ text: `📄 ${safePage + 1}/${totalPages}`, callback_data: `audit:refresh:${tab}:${safePage}` });
    if (safePage < totalPages - 1) nav.push({ text: 'Siguiente ➡️', callback_data: `audit:${tab}:${safePage + 1}` });
    keyboard.push(nav);
  }

  keyboard.push([
    { text: '🔄 Re-escanear Canal', callback_data: `audit:refresh:${tab}:${safePage}` },
    { text: '🏛️ Estudio /canal', callback_data: 'chan_editor:open' },
  ]);
  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (statusMsgId) {
    await editTelegramStatusMessage(chatId, statusMsgId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function sendOrEditRequestsManagerInTelegram(
  chatId: string,
  messageId: number | null,
  filter: 'pending' | 'fulfilled' | 'all' = 'pending',
  page = 0,
  replyToMessageId?: number,
  noticeText?: string,
  scanCommentsNow = false
): Promise<void> {
  pendingToolkitInputByChat.delete(chatId);
  let commentSyncNotice = '';
  if (scanCommentsNow || getEffectivePictaContext(chatId).isLinked) {
    try {
      const ctx = getEffectivePictaContext(chatId);
      if (ctx.isLinked && ctx.channelId) {
        const { comments } = await fetchChannelCommentsAndDenunciasInPicta(
          chatId,
          undefined,
          scanCommentsNow
        );
        const ownerUname = isMasterAdminChat(chatId)
          ? 'Admin'
          : userSessions.get(chatId)?.username || '';
        const syncRes = syncPictaCommentsToChannelRequests(
          chatId,
          comments,
          ownerUname ? [ownerUname] : []
        );
        if (syncRes.added > 0) {
          commentSyncNotice = `💬 <b>Se detectaron ${syncRes.added} nuevo(s) pedido(s) en comentarios de Picta.</b>`;
        } else if (scanCommentsNow) {
          commentSyncNotice = `💬 <b>Comentarios escaneados:</b> sin nuevos pedidos pendientes por añadir.`;
        }
      }
    } catch {
      // Non-fatal if comments endpoint temporarily fails
    }
  }

  const ownerRequests = channelMediaRequests.filter((r) => r.ownerChatId === chatId);
  const pendingCount = ownerRequests.filter((r) => r.status === 'pending').length;
  const fulfilledCount = ownerRequests.filter((r) => r.status === 'fulfilled').length;

  const filtered = ownerRequests.filter((r) => {
    if (filter === 'pending') return r.status === 'pending';
    if (filter === 'fulfilled') return r.status === 'fulfilled';
    return r.status !== 'dismissed';
  });

  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const listHtml =
    slice.length > 0
      ? slice
          .map((r, idx) => {
            const rank = safePage * PAGE_SIZE + idx + 1;
            const icon = r.status === 'fulfilled' ? '✅' : '⏳';
            const srcBadge =
              r.sourceType === 'picta_comment'
                ? `💬 Comentario${r.commentPublicationTitle ? ` en "${escapeHtml(r.commentPublicationTitle.slice(0, 28))}"` : ''}`
                : r.sourceType === 'telegram_group'
                  ? '👥 Grupo Telegram'
                  : '✍️ Manual';
            const dateStr = new Date(r.createdAt).toLocaleDateString('es-CU', {
              timeZone: 'America/Havana',
            });
            return (
              `<b>${rank}.</b> ${icon} <b>${escapeHtml(r.requestedTitle)}</b>\n` +
              `   👤 ${escapeHtml(r.requestedByName)} · ${srcBadge} · 📅 ${escapeHtml(dateStr)}` +
              (r.matchedPictaUrl ? `\n   🔗 ${escapeHtml(r.matchedPictaUrl)}` : '')
            );
          })
          .join('\n\n')
      : filter === 'pending'
        ? '<i>✨ No tienes pedidos pendientes por ahora.</i>'
        : '<i>✨ No hay pedidos registrados en esta vista.</i>';

  const combinedNotice = [noticeText, commentSyncNotice].filter(Boolean).join('\n');
  const text =
    (combinedNotice ? `${combinedNotice}\n\n` : '') +
    `${hudHeader('GESTOR DE PEDIDOS Y VERIFICADOR')}\n` +
    hudBox([
      `⏳ <b>Pendientes:</b> <b>${pendingCount}</b> · ✅ <b>Cumplidos:</b> <b>${fulfilledCount}</b>`,
      `💡 <i>Detecta pedidos en comentarios de Picta, grupo de suscriptores o consultas manuales.</i>`,
    ]) +
    `\n${hudSection(`Vista: ${filter === 'pending' ? '⏳ Pendientes' : filter === 'fulfilled' ? '✅ Cumplidos' : '📋 Todos'} (${filtered.length})`)}\n\n` +
    `${listHtml}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: '🔎 Verificar / Añadir Pedido', callback_data: 'req:add_prompt' },
      { text: '💬 Escanear Comentarios', callback_data: 'req:scan_comments' },
    ],
    [
      { text: `${filter === 'pending' ? '✅ ' : ''}⏳ Pendientes (${pendingCount})`, callback_data: 'req:list:pending:0' },
      { text: `${filter === 'fulfilled' ? '✅ ' : ''}✅ Cumplidos (${fulfilledCount})`, callback_data: 'req:list:fulfilled:0' },
    ],
    [{ text: '📢 Config. Grupo (/canalpedidos)', callback_data: 'promo_cfg:open' }],
  ];

  slice.forEach((r, idx) => {
    const rank = safePage * PAGE_SIZE + idx + 1;
    const row: Array<{ text: string; callback_data: string }> = [
      { text: `🔎 #${rank} Picta`, callback_data: `req:check:${r.id}` },
    ];
    if (r.status === 'pending') {
      row.push({ text: `✅ Cumplido`, callback_data: `req:done:${r.id}` });
    }
    row.push({ text: `🗑️`, callback_data: `req:del:${r.id}` });
    keyboard.push(row);
  });

  if (totalPages > 1) {
    const nav: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) nav.push({ text: '⬅️ Anterior', callback_data: `req:list:${filter}:${safePage - 1}` });
    nav.push({ text: `📄 ${safePage + 1}/${totalPages}`, callback_data: `req:list:${filter}:${safePage}` });
    if (safePage < totalPages - 1) nav.push({ text: 'Siguiente ➡️', callback_data: `req:list:${filter}:${safePage + 1}` });
    keyboard.push(nav);
  }

  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function processRequestQueryAndReplyOrSave(params: {
  ownerChatId: string;
  replyChatId: string;
  replyToMessageId?: number;
  query: string;
  requesterName: string;
  requesterUsername?: string;
  autoSaveIfMissing: boolean;
  notifyOwnerInPrivate?: boolean;
}): Promise<void> {
  const cleanQ = params.query.trim();
  if (!cleanQ) return;

  const loadingText =
    `🔎 <i>Verificando si "<b>${escapeHtml(cleanQ)}</b>" ya existe en Picta (peso y resoluciones)...</i>`;
  const tempMsgId =
    params.replyChatId === params.ownerChatId
      ? await sendTelegramStatusMessage(params.replyChatId, loadingText, params.replyToMessageId)
      : null;

  const searchRes = await searchGlobalPictaCatalog(cleanQ, {
    chatId: params.ownerChatId,
    maxEnrich: 3,
    minScore: 0.72,
  }).catch(() => ({ queryUsed: cleanQ, hits: [] as PictaGlobalSearchHit[] }));

  const hits = searchRes.hits.slice(0, 3);
  if (hits.length > 0) {
    const formatted = formatSubscriberPictaReplyHtml(
      cleanQ,
      hits.map(
        (h): PictaRequestMatchHit => ({
          id: h.id,
          kind: h.kind,
          title: h.title,
          categoryName: h.categoryName,
          channelName: h.channelName,
          sizeBytes: h.sizeBytes,
          resolutions: h.resolutions,
          maxResolutionLabel: h.maxResolutionLabel,
          webUrl: h.webUrl,
        })
      )
    );
    if (tempMsgId) {
      await editTelegramStatusMessage(
        params.replyChatId,
        tempMsgId,
        formatted.html,
        formatted.keyboard as any,
        true
      );
    } else {
      await callTelegramBotApi('sendMessage', {
        chat_id: params.replyChatId,
        ...(params.replyToMessageId ? { reply_to_message_id: params.replyToMessageId } : {}),
        text: formatted.html,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: { inline_keyboard: formatted.keyboard },
      }).catch(() => {});
    }
    return;
  }

  // Not found in Picta!
  const norm = normalizeRequestTitle(cleanQ);
  const alreadyPending = channelMediaRequests.find(
    (r) => r.ownerChatId === params.ownerChatId && r.status === 'pending' && r.normalizedTitle === norm
  );

  if (params.autoSaveIfMissing) {
    let savedReq = alreadyPending;
    if (!savedReq) {
      savedReq = {
        id: `rq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        ownerChatId: params.ownerChatId,
        requestedTitle: cleanQ,
        normalizedTitle: norm,
        requestedByName: params.requesterName,
        ...(params.requesterUsername ? { requestedByUsername: params.requesterUsername } : {}),
        sourceType: params.replyChatId !== params.ownerChatId ? 'telegram_group' : 'manual',
        ...(params.replyChatId !== params.ownerChatId ? { sourceChatId: params.replyChatId } : {}),
        ...(params.replyToMessageId ? { sourceMessageId: params.replyToMessageId } : {}),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      channelMediaRequests.unshift(savedReq);
      saveChannelMediaRequestsToDisk();
    }

    if (params.replyChatId !== params.ownerChatId) {
      await callTelegramBotApi('sendMessage', {
        chat_id: params.replyChatId,
        ...(params.replyToMessageId ? { reply_to_message_id: params.replyToMessageId } : {}),
        text:
          `📥 <b>Pedido anotado:</b> "<i>${escapeHtml(cleanQ)}</i>"\n` +
          `No aparece publicado todavía en Picta. Te avisaremos aquí en cuanto se suba.`,
        parse_mode: 'HTML',
      }).catch(() => {});

      if (params.notifyOwnerInPrivate && !alreadyPending) {
        await sendTelegramStatusMessage(
          params.ownerChatId,
          `📥 <b>Nuevo pedido desde tu grupo de suscriptores:</b>\n\n` +
            `🎬 <b>Título:</b> ${escapeHtml(cleanQ)}\n` +
            `👤 <b>Solicitado por:</b> ${escapeHtml(params.requesterName)}\n` +
            `🔎 <b>Estado en Picta:</b> Libre (no encontrado en el catálogo global)`,
          undefined,
          [[{ text: '📋 Abrir Gestor de Pedidos', callback_data: 'req:list:pending:0' }]]
        ).catch(() => {});
      }
      return;
    }

    const doneHtml =
      `🟢 <b>No existe en Picta todavía.</b>\n\n` +
      `📥 Pedido guardado en tu lista de pendientes: <b>${escapeHtml(cleanQ)}</b>`;
    const kb = [
      [{ text: '📋 Ver Lista de Pedidos', callback_data: 'req:list:pending:0' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (tempMsgId) {
      await editTelegramStatusMessage(params.replyChatId, tempMsgId, doneHtml, kb, true);
    } else {
      await sendTelegramStatusMessage(params.replyChatId, doneHtml, params.replyToMessageId, kb);
    }
    return;
  }

  pendingRequestSaveByChat.set(params.ownerChatId, {
    query: cleanQ,
    requesterName: params.requesterName,
    requesterUsername: params.requesterUsername,
    sourceChatId: params.replyChatId,
    sourceMessageId: params.replyToMessageId,
  });

  const offerHtml =
    `🟢 <b>¡Buenas noticias! "<i>${escapeHtml(cleanQ)}</i>" NO aparece publicado en Picta.</b>\n\n` +
    (alreadyPending
      ? `<i>Ya lo tienes anotado en tu lista de Pedidos Pendientes.</i>`
      : `¿Quieres guardarlo en tu lista de <b>Pedidos Pendientes</b> para que se marque cumplido al subirlo?`);
  const offerKb = [
    ...(alreadyPending
      ? []
      : [[{ text: '📥 Guardar en Pedidos Pendientes', callback_data: 'req:save_last' }]]),
    [{ text: '📋 Ver Pedidos (/pedidos)', callback_data: 'req:list:pending:0' }],
    [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
  ];
  if (tempMsgId) {
    await editTelegramStatusMessage(params.replyChatId, tempMsgId, offerHtml, offerKb, true);
  } else {
    await sendTelegramStatusMessage(params.replyChatId, offerHtml, params.replyToMessageId, offerKb);
  }
}

function findOwnerPromoConfigForGroupChat(
  chatIdStr: string,
  chatUsername?: string
): UserPromoChannelConfig | null {
  const cleanChat = String(chatIdStr || '').trim();
  const unameAt = chatUsername ? `@${chatUsername.replace(/^@/, '').toLowerCase()}` : '';
  for (const cfg of userPromoChannels.values()) {
    if (cfg.disabled) continue;
    const mode: RequestsMonitorMode = cfg.requestsMonitorMode || 'off';
    if (mode === 'off') continue;
    const grp = String(cfg.requestsGroupChatId || '').trim();
    const tgt = String(cfg.targetChannelId || '').trim();
    if (grp && (grp === cleanChat || (unameAt && grp.toLowerCase() === unameAt))) {
      return cfg;
    }
    if (!grp && tgt && (tgt === cleanChat || (unameAt && tgt.toLowerCase() === unameAt))) {
      return cfg;
    }
  }
  return null;
}

async function handleMonitoredRequestsGroupMessage(
  ownerCfg: UserPromoChannelConfig,
  incomingMsg: any
): Promise<void> {
  const text = String(incomingMsg?.text || incomingMsg?.caption || '').trim();
  if (!text) return;
  const mode: RequestsMonitorMode = ownerCfg.requestsMonitorMode || 'off';
  const parsed = parseSubscriberRequestMessage(text, mode);
  if (!parsed.matched || !parsed.query) return;

  const requesterName =
    [incomingMsg.from?.first_name, incomingMsg.from?.last_name].filter(Boolean).join(' ') ||
    incomingMsg.from?.username ||
    incomingMsg.chat?.title ||
    'Suscriptor';

  await processRequestQueryAndReplyOrSave({
    ownerChatId: ownerCfg.chatId,
    replyChatId: String(incomingMsg.chat?.id || ''),
    replyToMessageId: Number(incomingMsg.message_id || 0) || undefined,
    query: parsed.query,
    requesterName,
    requesterUsername: incomingMsg.from?.username,
    autoSaveIfMissing: true,
    notifyOwnerInPrivate: true,
  });
}

async function handleIncomingLinkOrUrlIngestion(
  chatId: string,
  replyToMessageId: number,
  senderName: string,
  rawText: string
): Promise<boolean> {
  const tgLink = parseTelegramMessageLink(rawText);
  const directUrlInfo = !tgLink ? extractDirectVideoUrl(rawText) : null;
  if (!tgLink && !directUrlInfo) return false;

  if (!isMasterAdminChat(chatId)) {
    await ensureGuestSessionChannelDiscovered(chatId);
  }
  const userChannelCtx = getEffectivePictaContext(chatId);
  if (!userChannelCtx.isLinked || !userChannelCtx.channelId) {
    await sendTelegramStatusMessage(
      chatId,
      `🔒 <b>Vincula primero tu cuenta de Picta</b> usando /login para poder subir videos desde enlaces.`,
      replyToMessageId,
      [[{ text: '🔑 Vincular Cuenta (/login)', callback_data: 'user_picta_login_start' }]]
    );
    return true;
  }

  let fileName = `video_enlace_${Date.now()}.mp4`;
  let mimeType = 'video/mp4';
  let fileSize = 0;
  let caption = '';
  let sourceType: 'telegram_link' | 'http_url' = 'http_url';
  let sourceUrl: string | undefined;
  let sourcePeerRef: string | undefined;
  let sourceMessageId: number | undefined;

  if (tgLink) {
    const probingMsgId = await sendTelegramStatusMessage(
      chatId,
      `🔗 <i>Consultando mensaje en Telegram vía MTProto (<code>${escapeHtml(tgLink.mtprotoPeer)}/${tgLink.messageId}</code>)...</i>`,
      replyToMessageId
    );
    const client = await ensureMtprotoClient();
    if (!client) {
      const errHtml = `⚠️ <b>MTProto no conectado aún.</b> Inicia sesión MTProto para leer enlaces <code>t.me/...</code>.`;
      if (probingMsgId) await editTelegramStatusMessage(chatId, probingMsgId, errHtml, undefined, true);
      else await sendTelegramStatusMessage(chatId, errHtml, replyToMessageId);
      return true;
    }

    try {
      const peerArg: any = /^-?\d+$/.test(tgLink.mtprotoPeer)
        ? Number(tgLink.mtprotoPeer)
        : tgLink.mtprotoPeer;
      const msgs = await client.getMessages(peerArg, { ids: [tgLink.messageId] });
      const targetMsg: any = msgs?.[0];
      const doc = targetMsg?.media?.document;
      if (!targetMsg || !doc) {
        const notFoundHtml =
          `⚠️ <b>No encontré un archivo de video en ese enlace.</b>\n` +
          `<i>Verifica que el canal sea público o que tu cuenta MTProto sea miembro del canal privado.</i>`;
        if (probingMsgId) await editTelegramStatusMessage(chatId, probingMsgId, notFoundHtml, undefined, true);
        else await sendTelegramStatusMessage(chatId, notFoundHtml, replyToMessageId);
        return true;
      }

      const attrFilename = Array.isArray(doc.attributes)
        ? doc.attributes.find((a: any) => typeof a?.fileName === 'string' && a.fileName)?.fileName
        : '';
      fileName = String(attrFilename || `telegram_${tgLink.messageId}.mp4`).trim();
      mimeType = String(doc.mimeType || 'video/mp4');
      fileSize = Number(String(doc.size || 0)) || 0;
      caption = String(targetMsg.message || '').trim();
      sourceType = 'telegram_link';
      sourcePeerRef = tgLink.mtprotoPeer;
      sourceMessageId = tgLink.messageId;

      if (probingMsgId) {
        await callTelegramBotApi('deleteMessage', {
          chat_id: chatId,
          message_id: probingMsgId,
        }).catch(() => {});
      }
    } catch (err) {
      const msgErr = err instanceof Error ? err.message : String(err);
      const errHtml = `⚠️ <b>No se pudo leer el enlace de Telegram:</b> <code>${escapeHtml(msgErr.slice(0, 140))}</code>`;
      if (probingMsgId) await editTelegramStatusMessage(chatId, probingMsgId, errHtml, undefined, true);
      else await sendTelegramStatusMessage(chatId, errHtml, replyToMessageId);
      return true;
    }
  } else if (directUrlInfo) {
    const probingMsgId = await sendTelegramStatusMessage(
      chatId,
      `🌐 <i>Inspeccionando enlace directo de video...</i>`,
      replyToMessageId
    );
    try {
      const headRes = await fetch(directUrlInfo.url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        },
      }).catch(() => null);

      const probeRes =
        headRes && headRes.ok
          ? headRes
          : await fetch(directUrlInfo.url, {
              method: 'GET',
              redirect: 'follow',
              headers: {
                Range: 'bytes=0-1023',
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
              },
            });

      if (!probeRes.ok) {
        throw new Error(`El servidor remoto respondió HTTP ${probeRes.status}`);
      }
      const check = isProbableVideoHttpResponse({
        url: probeRes.url || directUrlInfo.url,
        contentType: probeRes.headers.get('content-type'),
        contentDisposition: probeRes.headers.get('content-disposition'),
      });
      if (!check.ok) {
        throw new Error(check.reason || 'El enlace no apunta a un video directo.');
      }

      const contentRange = probeRes.headers.get('content-range');
      const totalFromRange = contentRange?.match(/\/(\d+)$/)?.[1];
      const len = Number(totalFromRange || probeRes.headers.get('content-length') || 0);
      if (len > PICTA_S3_MAX_OBJECT_BYTES) {
        throw new Error(`El archivo (${formatBytes(len)}) supera el máximo de 5 GB de Picta.`);
      }

      fileName = check.fileName;
      mimeType = check.mimeType;
      fileSize = Number.isFinite(len) && len > 0 ? len : 0;
      sourceType = 'http_url';
      sourceUrl = probeRes.url || directUrlInfo.url;

      if (probingMsgId) {
        await callTelegramBotApi('deleteMessage', {
          chat_id: chatId,
          message_id: probingMsgId,
        }).catch(() => {});
      }
    } catch (err) {
      const msgErr = err instanceof Error ? err.message : String(err);
      const errHtml = `⚠️ <b>Enlace no válido para subida directa:</b>\n<code>${escapeHtml(msgErr.slice(0, 160))}</code>`;
      if (probingMsgId) await editTelegramStatusMessage(chatId, probingMsgId, errHtml, undefined, true);
      else await sendTelegramStatusMessage(chatId, errHtml, replyToMessageId);
      return true;
    }
  }

  const analyzedIntake = analyzeVideoTitleAndSynopsis(fileName, caption);
  const newJob: VideoTransferJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    telegramMessageId: replyToMessageId,
    statusMessageId: null,
    telegramChatId: chatId,
    senderName,
    fileId: '',
    fileName,
    mimeType,
    caption,
    expectedBytes: fileSize,
    downloadedBytes: 0,
    integrityVerified: false,
    diskVerifiedBytes: 0,
    uploadedBytes: 0,
    stage: 'awaiting_category',
    title: analyzedIntake.initialTitle,
    titleMode: 'pending',
    synopsis: analyzedIntake.initialSynopsis,
    category: 'Audiovisual',
    tipologiaId: 8,
    tags: [],
    speedMBps: 0,
    targetChannelId: userChannelCtx.channelId,
    targetChannelName: userChannelCtx.channelName,
    sourceType,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourcePeerRef ? { sourcePeerRef } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...((analyzedIntake.episodeSubtitle || analyzedIntake.needsManualTitle || analyzedIntake.filenameIsRandom)
      ? {
          modelMetadata: {
            ...(analyzedIntake.episodeSubtitle ? { episodeSubtitle: analyzedIntake.episodeSubtitle } : {}),
            ...(analyzedIntake.needsManualTitle ? { needsManualTitle: 'true' } : {}),
            ...(analyzedIntake.filenameIsRandom ? { filenameIsRandom: 'true' } : {}),
          },
        }
      : {}),
  };

  transferJobs.unshift(newJob);
  pruneTransferJobsMemory();
  saveJobsToDisk();

  const sourceBadge =
    sourceType === 'telegram_link'
      ? `🔗 Enlace Telegram (${tgLink?.mtprotoPeer}/${tgLink?.messageId})`
      : `🌐 Enlace Directo HTTP`;

  const sentPromptId = await sendTelegramStatusMessage(
    chatId,
    `${hudHeader('NUEVO VIDEO DESDE ENLACE')}\n` +
      hudBox([
        `📡 <b>Origen:</b> ${escapeHtml(sourceBadge)}`,
        `📄 <b>Archivo:</b> <code>${escapeHtml(fileName)}</code>`,
        `📦 <b>Tamaño:</b> ${fileSize > 0 ? formatBytes(fileSize) : 'Se calculará al descargar'}`,
        `📺 <b>Canal:</b> ${escapeHtml(userChannelCtx.channelName)} · <code>#${escapeHtml(userChannelCtx.channelId)}</code>`,
        analyzedIntake.initialTitle
          ? `🎬 <b>Título detectado:</b> <code>${escapeHtml(analyzedIntake.initialTitle.slice(0, 64))}</code>`
          : undefined,
      ]) +
      `\n📂 <b>Selecciona la categoría de Picta:</b>`,
    replyToMessageId,
    buildCategorySelectionKeyboard(newJob.id)
  );
  if (sentPromptId) {
    newJob.statusMessageId = sentPromptId;
    saveJobsToDisk();
  }
  return true;
}

// ============================================================================
// PICTA API EXTENDED TOOLKIT: COLLABORATORS, PLAYLISTS, COMMENTS, SERIES & CATALOG
// ============================================================================

async function fetchChannelCollaboratorsInPicta(
  chatId?: string
): Promise<{
  channelId: string;
  channelName: string;
  ownerId: number;
  collaborators: Array<{ id: number; label: string; isOwner: boolean }>;
}> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const isMaster = isMasterAdminChat(effectiveChatId);
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  let token = await ctx.accessTokenPromise;
  const channelId = ctx.channelId;

  let res = await fetchPictaWithRetry(
    `https://api.picta.cu/v3/channel/${encodeURIComponent(channelId)}/`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    }
  );
  if (res.status === 401) {
    token =
      isMaster && !userSessions.has(effectiveChatId)
        ? await authenticateWithPicta(true)
        : await refreshUserPictaSession(effectiveChatId);
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v3/channel/${encodeURIComponent(channelId)}/`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      }
    );
  }
  if (res.status === 404 || res.status === 405) {
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      }
    );
  }

  const session = userSessions.get(effectiveChatId);
  let ownerId = isMaster ? 212033 : Number(session?.userId || 0);
  let assocRaw: any[] = ownerId > 0 ? [ownerId] : [];
  if (res.ok) {
    const chObj = (await res.json().catch(() => ({}))) as any;
    const fetchedOwner = Number(
      typeof chObj?.propietario === 'object' && chObj.propietario
        ? chObj.propietario?.id ?? chObj.propietario?.user_id
        : chObj?.propietario ||
          (typeof chObj?.usuario === 'object' && chObj.usuario
            ? chObj.usuario?.id ?? chObj.usuario?.user_id
            : chObj?.usuario) ||
          ownerId
    );
    if (Number.isFinite(fetchedOwner) && fetchedOwner > 0) {
      ownerId = fetchedOwner;
    }
    if (Array.isArray(chObj?.usuarios_asociados)) {
      assocRaw = chObj.usuarios_asociados;
    }
  }

  const knownLabels = new Map<number, string>();
  if (isMaster) {
    knownLabels.set(212033, '@Admin (+5350000000 · Propietario)');
    knownLabels.set(994913, '@Ghost0210Picta (+5354684486 · Pool)');
    for (const acc of quotaSettings.poolAccounts) {
      if (acc.userId) {
        knownLabels.set(
          Number(acc.userId),
          `${acc.displayName || acc.username} (Pool)`
        );
      }
    }
  } else if (session?.userId) {
    knownLabels.set(
      Number(session.userId),
      `@${session.userFullName || session.username} (Propietario)`
    );
  }
  for (const s of userSessions.values()) {
    if (s.userId && !knownLabels.has(Number(s.userId))) {
      knownLabels.set(
        Number(s.userId),
        `${s.userFullName || s.username}${s.channelName ? ` · ${s.channelName}` : ''}`
      );
    }
  }

  const ids = computeUpdatedChannelCollaborators(assocRaw, ownerId, 0, 'add');
  const collaborators = ids.map((id) => ({
    id,
    label: knownLabels.get(id) || `Usuario Picta #${id}`,
    isOwner: id === ownerId,
  }));

  return {
    channelId,
    channelName: ctx.channelName,
    ownerId,
    collaborators,
  };
}

async function resolveCollaboratorUserIdFromPicta(
  targetIdentifier: string | number,
  token: string,
  ownChannelId: string,
  isMaster: boolean
): Promise<{ userId: number; resolvedLabel?: string }> {
  const rawInput = String(targetIdentifier || '').trim();
  const cleanStr = rawInput.replace(/^@+/, '').trim();
  if (!cleanStr) {
    return { userId: 0 };
  }

  // 1. Direct URL to a Picta channel (extract owner user_id from channel)
  const cleanUrl = cleanStr.split(/[?#]/)[0];
  const chanUrlMatch = cleanUrl.match(
    /(?:picta\.cu\/)?(?:canal|canales|channel|channels)\/(?:edit\/)?([a-zA-Z0-9_\-]+)/i
  );
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Origin: 'https://admin.picta.cu',
    Referer: 'https://admin.picta.cu/',
  };

  const extractOwnerFromChannelObj = async (chObj: any): Promise<{ userId: number; label?: string }> => {
    if (!chObj || typeof chObj !== 'object') return { userId: 0 };
    let uid = Number(
      typeof chObj.propietario === 'object' && chObj.propietario
        ? chObj.propietario.id ?? chObj.propietario.user_id
        : chObj.propietario || 0
    );
    let uName =
      typeof chObj.propietario === 'object' && chObj.propietario
        ? String(chObj.propietario.user_name || chObj.propietario.username || '')
        : String(chObj.usuario || '');
    const chId = Number(chObj.id || 0);
    if ((!uid || Number.isNaN(uid)) && chId > 0) {
      for (const ep of [
        `https://api.picta.cu/v3/channel/${chId}/`,
        `https://api.picta.cu/v1/canal/${chId}/`,
      ]) {
        const dRes = await fetchPictaWithRetry(ep, { headers: authHeaders }, 1).catch(() => null);
        if (dRes && dRes.ok) {
          const d = (await dRes.json().catch(() => null)) as any;
          if (d) {
            uid = Number(
              typeof d.propietario === 'object' && d.propietario
                ? d.propietario.id ?? d.propietario.user_id
                : d.propietario || 0
            );
            if (!uName && typeof d.propietario === 'object' && d.propietario?.user_name) {
              uName = String(d.propietario.user_name);
            }
            if (uid > 0) break;
          }
        }
      }
    }
    if (uid > 0) {
      const chTitle = String(chObj.nombre || (chId ? `Canal #${chId}` : 'Canal')).trim();
      return {
        userId: uid,
        label: uName && !/^\d+$/.test(uName) ? `@${uName} (${chTitle})` : `${chTitle} (#${uid})`,
      };
    }
    return { userId: 0 };
  };

  if (chanUrlMatch) {
    const slugOrId = chanUrlMatch[1];
    if (/^\d+$/.test(slugOrId)) {
      for (const ep of [
        `https://api.picta.cu/v1/canal/${slugOrId}/`,
        `https://api.picta.cu/v3/channel/${slugOrId}/`,
      ]) {
        const r = await fetchPictaWithRetry(ep, { headers: authHeaders }, 2).catch(() => null);
        if (r && r.ok) {
          const d = (await r.json().catch(() => null)) as any;
          const extracted = await extractOwnerFromChannelObj(d);
          if (extracted.userId > 0) {
            return { userId: extracted.userId, resolvedLabel: extracted.label };
          }
        }
      }
    } else {
      const r = await fetchPictaWithRetry(
        `https://api.picta.cu/v1/canal/?slug_url=${encodeURIComponent(slugOrId)}`,
        { headers: authHeaders },
        2
      ).catch(() => null);
      if (r && r.ok) {
        const d = (await r.json().catch(() => null)) as any;
        const first = Array.isArray(d?.results) ? d.results[0] : Array.isArray(d) ? d[0] : null;
        const extracted = await extractOwnerFromChannelObj(first);
        if (extracted.userId > 0) {
          return { userId: extracted.userId, resolvedLabel: extracted.label };
        }
      }
    }
  }

  // 2. Pure numeric ID (1-7 digits -> Picta User ID; >=8 digits -> likely phone number)
  const digitsOnly = cleanStr.replace(/\D/g, '');
  const isPureNumeric = /^\d+$/.test(cleanStr);
  if (isPureNumeric && digitsOnly.length > 0 && digitsOnly.length <= 7) {
    return { userId: Number(digitsOnly) };
  }

  const lowerClean = cleanStr.toLowerCase();
  const phone8 = digitsOnly.length >= 8 ? digitsOnly.slice(-8) : '';

  // 3. Check local known accounts (Pool, active Telegram userSessions)
  if (isMaster) {
    if (lowerClean === 'ghost0210picta' || (phone8 && phone8 === '54684486')) {
      return { userId: 994913, resolvedLabel: '@Ghost0210Picta' };
    }
    if (lowerClean === 'admin' || (phone8 && phone8 === '50000000')) {
      return { userId: 212033, resolvedLabel: '@Admin' };
    }
    const matchedPool = quotaSettings.poolAccounts.find(
      (a) =>
        a.username.toLowerCase().replace(/^@/, '') === lowerClean ||
        (a.displayName && a.displayName.toLowerCase().includes(lowerClean)) ||
        (phone8 && a.username.replace(/\D/g, '').endsWith(phone8))
    );
    if (matchedPool?.userId) {
      return { userId: Number(matchedPool.userId), resolvedLabel: matchedPool.displayName || matchedPool.username };
    }
  }

  for (const s of userSessions.values()) {
    const sUser = String(s.username || '').trim().replace(/^@+/, '').toLowerCase();
    const sFull = String(s.userFullName || '').trim().toLowerCase();
    const sChatId = String(s.chatId || '').trim();
    const sDigits = String(s.username || '').replace(/\D/g, '');
    const hasChannelMatch = (s.availableChannels || []).some(
      (c) =>
        String(c.id) === digitsOnly ||
        String(c.id) === cleanStr ||
        (c.nombre && c.nombre.toLowerCase().includes(lowerClean))
    );
    if (
      s.userId &&
      (sChatId === cleanStr ||
        (sUser && (sUser === lowerClean || sUser.includes(lowerClean) || lowerClean.includes(sUser))) ||
        (sFull && (sFull === lowerClean || sFull.includes(lowerClean) || lowerClean.includes(sFull))) ||
        (phone8 && sDigits.length >= 8 && sDigits.slice(-8) === phone8) ||
        hasChannelMatch)
    ) {
      const activeChan = s.availableChannels?.[0]?.nombre ? ` (${s.availableChannels[0].nombre})` : '';
      return {
        userId: Number(s.userId),
        resolvedLabel: `@${s.userFullName || s.username || cleanStr}${activeChan}`,
      };
    }
  }

  // 4. Try /v2/usuario/?search= (works on elevated roles; gracefully falls back if 403)
  try {
    const uRes = await fetchPictaWithRetry(
      `https://api.picta.cu/v2/usuario/?search=${encodeURIComponent(cleanStr)}`,
      { headers: authHeaders },
      1
    );
    if (uRes.ok) {
      const uData = (await uRes.json().catch(() => ({}))) as any;
      const firstUser = Array.isArray(uData?.results) ? uData.results[0] : null;
      if (firstUser?.id) {
        return {
          userId: Number(firstUser.id),
          resolvedLabel: firstUser.username ? `@${firstUser.username}` : undefined,
        };
      }
    }
  } catch {
    // Expected 403 for standard channel admin tokens; continue to channel owner directory resolution
  }

  // 5. Direct slug lookup via /v1/canal/?slug_url=
  if (/^[a-z0-9\-_]{3,}$/i.test(cleanStr)) {
    try {
      const sRes = await fetchPictaWithRetry(
        `https://api.picta.cu/v1/canal/?slug_url=${encodeURIComponent(cleanStr)}`,
        { headers: authHeaders },
        1
      );
      if (sRes.ok) {
        const sData = (await sRes.json().catch(() => null)) as any;
        const first = Array.isArray(sData?.results) ? sData.results[0] : null;
        if (first && String(first.id) !== String(ownChannelId)) {
          const extracted = await extractOwnerFromChannelObj(first);
          if (extracted.userId > 0) {
            return { userId: extracted.userId, resolvedLabel: extracted.label };
          }
        }
      }
    } catch {
      // Continue
    }
  }

  const stripAccents = (s: string) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  const normalizedClean = stripAccents(cleanStr);
  const matchesPhoneOrUser = (rawCandidate: unknown): boolean => {
    const cand = stripAccents(String(rawCandidate || '').replace(/^@+/, ''));
    if (!cand) return false;
    if (cand === normalizedClean) return true;
    if (phone8) {
      const cDigits = cand.replace(/\D/g, '');
      if (cDigits.length >= 8 && cDigits.slice(-8) === phone8) return true;
    }
    return false;
  };

  // 6. Scan /v1/canal/ and /v3/channel/ directory (supports phone-as-username, @username, channel name, alias, slug_url)
  if (cleanStr.length >= 3) {
    let bestPartial: any = null;
    for (let startPage = 1; startPage <= 12; startPage += 4) {
      const pages = [startPage, startPage + 1, startPage + 2, startPage + 3];
      const pagePayloads = await Promise.all(
        pages.map(async (p) => {
          try {
            const r = await fetchPictaWithRetry(
              `https://api.picta.cu/v1/canal/?page=${p}&page_size=100`,
              { headers: authHeaders },
              1
            );
            if (!r.ok) return null;
            return await r.json().catch(() => null);
          } catch {
            return null;
          }
        })
      );
      let anyResults = false;
      for (const pData of pagePayloads) {
        const list = Array.isArray(pData?.results) ? pData.results : [];
        if (list.length > 0) anyResults = true;
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const itemUser = stripAccents(String(item.usuario || ''));
          const itemName = stripAccents(String(item.nombre || ''));
          const itemAlias = stripAccents(String(item.alias || ''));
          const itemSlug = stripAccents(String(item.slug_url || ''));
          if (
            matchesPhoneOrUser(item.usuario) ||
            (itemSlug && itemSlug === normalizedClean) ||
            (itemName && itemName === normalizedClean && String(item.id) !== String(ownChannelId))
          ) {
            const extracted = await extractOwnerFromChannelObj(item);
            if (extracted.userId > 0) {
              return { userId: extracted.userId, resolvedLabel: extracted.label };
            }
          }
          if (
            !bestPartial &&
            !isPureNumeric &&
            String(item.id) !== String(ownChannelId) &&
            (itemUser.includes(normalizedClean) ||
              itemName.includes(normalizedClean) ||
              itemAlias.includes(normalizedClean))
          ) {
            bestPartial = item;
          }
        }
      }
      if (!anyResults) break;
    }
    if (bestPartial) {
      const extracted = await extractOwnerFromChannelObj(bestPartial);
      if (extracted.userId > 0) {
        return { userId: extracted.userId, resolvedLabel: extracted.label };
      }
    }

    // Also scan /v3/channel/ for channels not present in /v1/canal/ (only non-pure-numeric name/slug matches)
    if (!isPureNumeric) {
      for (let startPage = 1; startPage <= 12; startPage += 4) {
        const pages = [startPage, startPage + 1, startPage + 2, startPage + 3];
        const pagePayloads = await Promise.all(
          pages.map(async (p) => {
            try {
              const r = await fetchPictaWithRetry(
                `https://api.picta.cu/v3/channel/?page=${p}&page_size=100`,
                { headers: authHeaders },
                1
              );
              if (!r.ok) return null;
              return await r.json().catch(() => null);
            } catch {
              return null;
            }
          })
        );
        let anyResults = false;
        for (const pData of pagePayloads) {
          const list = Array.isArray(pData?.results) ? pData.results : [];
          if (list.length > 0) anyResults = true;
          for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            if (String(item.id) === String(ownChannelId)) continue;
            const itemName = stripAccents(String(item.nombre || ''));
            const itemSlug = stripAccents(String(item.slug_url || ''));
            if (
              (itemSlug && itemSlug === normalizedClean) ||
              (itemName && itemName === normalizedClean)
            ) {
              const extracted = await extractOwnerFromChannelObj(item);
              if (extracted.userId > 0) {
                return { userId: extracted.userId, resolvedLabel: extracted.label };
              }
            }
          }
        }
        if (!anyResults) break;
      }
    }
  }

  // 7. Check subscribers of own channel (/v2/suscripcion/?canal=) by exact @username or phone-as-username
  if (ownChannelId && (!cleanStr.includes(' ') || Boolean(phone8))) {
    for (let startPage = 1; startPage <= 10; startPage += 4) {
      const pages = [startPage, startPage + 1, startPage + 2, startPage + 3];
      const subPayloads = await Promise.all(
        pages.map(async (p) => {
          try {
            const r = await fetchPictaWithRetry(
              `https://api.picta.cu/v2/suscripcion/?canal=${encodeURIComponent(ownChannelId)}&page=${p}&page_size=100`,
              { headers: authHeaders },
              1
            );
            if (!r.ok) return null;
            return await r.json().catch(() => null);
          } catch {
            return null;
          }
        })
      );
      let anySubs = false;
      for (const sData of subPayloads) {
        const list = Array.isArray(sData?.results) ? sData.results : [];
        if (list.length > 0) anySubs = true;
        for (const sub of list) {
          const u = sub?.usuario;
          if (u && typeof u === 'object' && u.id && matchesPhoneOrUser(u.username)) {
            return {
              userId: Number(u.id),
              resolvedLabel: u.username ? `@${u.username} (Suscriptor)` : undefined,
            };
          }
        }
      }
      if (!anySubs) break;
    }
  }

  return { userId: 0 };
}

async function modifyChannelCollaboratorInPicta(
  chatId: string,
  targetIdentifier: string | number,
  action: 'add' | 'remove'
): Promise<{
  collaborators: Array<{ id: number; label: string; isOwner: boolean }>;
  targetUserId: number;
  resolvedLabel?: string;
}> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const isMaster = isMasterAdminChat(effectiveChatId);
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;
  const channelId = ctx.channelId;
  const cleanStr = String(targetIdentifier).trim().replace(/^@+/, '');

  const resolved = await resolveCollaboratorUserIdFromPicta(
    targetIdentifier,
    token,
    channelId,
    isMaster
  );
  let targetUserId = resolved.userId;

  if (!targetUserId || isNaN(targetUserId)) {
    addLiveLog(
      'picta',
      'warn',
      `Colaborador no resuelto para "${cleanStr}" en canal #${channelId} (Picta bloquea /v2/usuario/?search= con 403).`
    );
    throw new Error(
      `No encontré el ID de "${cleanStr}" porque Picta bloquea la búsqueda por teléfono/nombre real (HTTP 403) a cuentas no-staff (tu otra cuenta funcionó por número porque ya estaba guardada en el bot). ` +
        `Envía el enlace o nombre del canal de tu socio (ej: https://www.picta.cu/canal/su-canal), su @usuario exacto de Picta, su ID numérico, o pídele que envíe /login al bot una vez.`
    );
  }

  const currentInfo = await fetchChannelCollaboratorsInPicta(effectiveChatId);
  if (action === 'add' && currentInfo.collaborators.some((c) => c.id === targetUserId)) {
    return {
      collaborators: currentInfo.collaborators,
      targetUserId,
      resolvedLabel: resolved.resolvedLabel,
    };
  }

  const sendPatchCollaborators = async (candidateIds: number[]) => {
    let activeToken = token;
    let patchRes = await fetchPictaWithRetry(
      `https://api.picta.cu/v3/channel/${encodeURIComponent(channelId)}/`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
        body: JSON.stringify({ usuarios_asociados: candidateIds }),
      }
    );
    if (patchRes.status === 401) {
      activeToken =
        isMaster && !userSessions.has(effectiveChatId)
          ? await authenticateWithPicta(true)
          : await refreshUserPictaSession(effectiveChatId);
      patchRes = await fetchPictaWithRetry(
        `https://api.picta.cu/v3/channel/${encodeURIComponent(channelId)}/`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
          body: JSON.stringify({ usuarios_asociados: candidateIds }),
        }
      );
    }
    if (patchRes.status === 404 || patchRes.status === 405) {
      patchRes = await fetchPictaWithRetry(
        `https://api.picta.cu/v1/canal/${encodeURIComponent(channelId)}/`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
          body: JSON.stringify({ usuarios_asociados: candidateIds }),
        }
      );
    }
    return patchRes;
  };

  let updatedIds = computeUpdatedChannelCollaborators(
    currentInfo.collaborators.map((c) => c.id),
    currentInfo.ownerId,
    targetUserId,
    action
  );
  let patchRes = await sendPatchCollaborators(updatedIds);

  // Smart fallback: if user typed a numeric Channel ID instead of User ID and Picta rejected the PK, extract its propietario User ID
  if (!patchRes.ok && action === 'add' && /^\d+$/.test(cleanStr)) {
    const errPreview = await patchRes.text().catch(() => '');
    const chProbe = await fetchPictaWithRetry(
      `https://api.picta.cu/v3/channel/${encodeURIComponent(cleanStr)}/`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
      },
      1
    ).catch(() => null);
    if (chProbe && chProbe.ok) {
      const chProbeData = (await chProbe.json().catch(() => null)) as any;
      const probeOwnerId = Number(
        typeof chProbeData?.propietario === 'object' && chProbeData.propietario
          ? chProbeData.propietario.id ?? chProbeData.propietario.user_id
          : chProbeData?.propietario || 0
      );
      if (probeOwnerId > 0 && probeOwnerId !== targetUserId) {
        targetUserId = probeOwnerId;
        resolved.resolvedLabel = chProbeData?.nombre
          ? `${chProbeData.nombre} (Propietario #${probeOwnerId})`
          : undefined;
        updatedIds = computeUpdatedChannelCollaborators(
          currentInfo.collaborators.map((c) => c.id),
          currentInfo.ownerId,
          targetUserId,
          action
        );
        patchRes = await sendPatchCollaborators(updatedIds);
      } else {
        throw new Error(formatPictaError(patchRes.status, errPreview));
      }
    } else {
      throw new Error(formatPictaError(patchRes.status, errPreview));
    }
  }

  if (!patchRes.ok) {
    const errTxt = await patchRes.text();
    addLiveLog(
      'picta',
      'error',
      `Error PATCH usuarios_asociados canal #${channelId} (target=${targetUserId}, HTTP ${patchRes.status}): ${errTxt.slice(0, 180)}`
    );
    throw new Error(formatPictaError(patchRes.status, errTxt));
  }

  const patchData = (await patchRes.json().catch(() => null)) as any;
  const returnedAssoc = Array.isArray(patchData?.usuarios_asociados)
    ? patchData.usuarios_asociados.map((x: any) => Number(typeof x === 'object' ? x?.id ?? x?.user_id : x))
    : null;
  if (action === 'add' && returnedAssoc && !returnedAssoc.includes(targetUserId)) {
    addLiveLog(
      'picta',
      'warn',
      `Picta respondió 200 al PATCH del canal #${channelId}, pero #${targetUserId} no quedó en usuarios_asociados (${JSON.stringify(returnedAssoc)}).`
    );
    throw new Error(
      `Picta no permitió asociar al usuario #${targetUserId}. Verifica que sea un usuario válido y habilitado en Picta.`
    );
  }

  addLiveLog(
    'picta',
    'success',
    `Colaborador #${targetUserId}${resolved.resolvedLabel ? ` (${resolved.resolvedLabel})` : ''} ${action === 'add' ? 'añadido a' : 'retirado de'} canal #${channelId}.`
  );

  const refreshed = await fetchChannelCollaboratorsInPicta(effectiveChatId);
  return {
    collaborators: refreshed.collaborators,
    targetUserId,
    resolvedLabel: resolved.resolvedLabel,
  };
}

async function sendOrEditChannelCollaboratorsMenu(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  pendingToolkitInputByChat.delete(chatId);
  const ctx = getEffectivePictaContext(chatId);
  if (!ctx.isLinked || !ctx.channelId) {
    const text =
      `${hudHeader('COLABORADORES · ACCESO REQUERIDO')}\n` +
      hudBox([`🔒 Inicia sesión con /login y vincula tu canal para gestionar colaboradores.`]);
    const keyboard = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'user_picta_login_start' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }
  try {
    const info = await fetchChannelCollaboratorsInPicta(chatId);
    const lines = info.collaborators
      .map(
        (c, idx) =>
          `<b>${idx + 1}.</b> <code>#${c.id}</code> · ${escapeHtml(c.label)} ${
            c.isOwner ? '👑' : '🤝'
          }`
      )
      .join('\n');

    const text =
      (notice ? `${notice}\n\n` : '') +
      `${hudHeader(`COLABORADORES · #${info.channelId}`)}\n` +
      hudBox([
        `📺 <b>Canal:</b> ${escapeHtml(info.channelName)} · <code>#${escapeHtml(info.channelId)}</code>`,
        `🤝 <b>Total asociados:</b> <b>${info.collaborators.length}</b> cuenta(s)`,
      ]) +
      `\n${hudSection('Equipo del Canal')}\n${lines}\n\n` +
      `<i>Gestiona los permisos de colaboradores directamente por API sin web externa.</i>`;

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [{ text: '➕ Añadir Colaborador (ID o Usuario)', callback_data: 'chan_collabs:add_prompt' }],
    ];

    for (const c of info.collaborators) {
      if (!c.isOwner) {
        keyboard.push([
          {
            text: `🗑️ Quitar #${c.id} (${c.label.slice(0, 22)})`,
            callback_data: `chan_collabs:del:${c.id}`,
          },
        ]);
      }
    }

    keyboard.push([
      { text: '🔄 Actualizar', callback_data: 'chan_collabs:open' },
      { text: '⬅️ Estudio /canal', callback_data: 'chan_editor:open' },
    ]);

    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendOrEditChannelEditorMenu(
      chatId,
      messageId,
      replyToMessageId,
      `⚠️ <b>Error al consultar colaboradores:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
    );
  }
}

async function fetchChannelPlaylistsInPicta(chatId?: string): Promise<PictaPlaylistRecord[]> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;
  const channelId = ctx.channelId;

  const res = await fetchPictaWithRetry(
    `https://api.picta.cu/v2/lista_reproduccion_canal/?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    }
  );

  let list: PictaPlaylistRecord[] = [];
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as any;
    const results = Array.isArray(data) ? data : data.results || [];
    list = filterChannelPlaylists(results, channelId);
  }

  for (const cached of localChannelPlaylistsCache.values()) {
    if (
      Number(cached.canalId) === Number(channelId) &&
      !list.some((item) => item.id === cached.id)
    ) {
      list.unshift(cached);
    }
  }

  return list;
}

async function createChannelPlaylistInPicta(
  chatId: string,
  nombre: string
): Promise<PictaPlaylistRecord> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;
  const channelId = Number(ctx.channelId);

  const cleanName = sanitizePublicPictaText(nombre).trim();
  if (!cleanName) {
    throw new Error('Debes indicar un nombre válido para la lista de reproducción.');
  }

  const form = new FormData();
  form.append('nombre', cleanName);
  form.append('canal', String(channelId));
  form.append('publicado', 'true');

  const res = await fetchPictaWithRetry(
    'https://api.picta.cu/v1/lista_reproduccion_canal/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: form,
    }
  );

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }

  const created = (await res.json().catch(() => ({}))) as any;
  const record: PictaPlaylistRecord = {
    id: Number(created.id || Date.now()),
    nombre: String(created.nombre || cleanName),
    publicado: created.publicado !== false,
    descarga: Boolean(created.descarga),
    fecha_creacion: new Date().toISOString(),
    canalId: channelId,
    canalNombre: ctx.channelName,
    publicacionesIds: [],
  };
  localChannelPlaylistsCache.set(record.id, record);
  return record;
}

async function addPublicationToPlaylistInPicta(
  chatId: string,
  playlistId: number,
  pubId: number
): Promise<void> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise;

  const res = await fetchPictaWithRetry('https://api.picta.cu/v1/li_re_ca_pub/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: JSON.stringify({
      li_rep_canal: Number(playlistId),
      publicacion: Number(pubId),
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }

  const cached = localChannelPlaylistsCache.get(Number(playlistId));
  if (cached && !cached.publicacionesIds.includes(Number(pubId))) {
    cached.publicacionesIds.push(Number(pubId));
  }
}

async function deleteChannelPlaylistInPicta(
  chatId: string,
  playlistId: number
): Promise<void> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise;

  const res = await fetchPictaWithRetry(
    `https://api.picta.cu/v1/lista_reproduccion_canal/${encodeURIComponent(String(playlistId))}/`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    }
  );

  if (!res.ok && res.status !== 204) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }
  localChannelPlaylistsCache.delete(Number(playlistId));
}

async function sendOrEditPlaylistsMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  pendingToolkitInputByChat.delete(chatId);
  const isMaster = isMasterAdminChat(chatId);
  const session = userSessions.get(chatId);
  if (!isMaster && !session?.channelId) {
    const text =
      `${hudHeader('LISTAS · ACCESO REQUERIDO')}\n` +
      hudBox([`🔒 Inicia sesión con /login para crear y gestionar listas de reproducción.`]);
    const keyboard = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }
  const ctx = getEffectivePictaContext(chatId);
  const playlists = await fetchChannelPlaylistsInPicta(chatId).catch(() => []);

  const listLines =
    playlists.length > 0
      ? playlists
          .slice(0, 10)
          .map(
            (pl, idx) =>
              `<b>${idx + 1}. 📂 ${escapeHtml(pl.nombre)}</b> · <code>#${pl.id}</code>\n` +
              `   └ 🎞️ <b>${pl.publicacionesIds.length}</b> videos · ${
                pl.publicado ? '🟢 Pública' : '🙈 Oculta'
              }`
          )
          .join('\n\n')
      : '<i>Sin listas creadas aún. Pulsa "Crear Lista" para organizar tus colecciones.</i>';

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`LISTAS DE REPRODUCCIÓN · #${ctx.channelId}`)}\n` +
    hudBox([
      `📺 <b>Canal:</b> ${escapeHtml(ctx.channelName)} · <code>${playlists.length}</code> lista(s)`,
      `📂 Colecciones temáticas sincronizadas vía API de Picta`,
    ]) +
    `\n${hudSection('Colecciones Activas')}\n${listLines}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '➕ Crear Nueva Lista', callback_data: 'playlist_create_prompt' }],
  ];

  for (const pl of playlists.slice(0, 6)) {
    keyboard.push([
      {
        text: `🗑️ Eliminar "${pl.nombre.slice(0, 22)}" (#${pl.id})`,
        callback_data: `playlist_del:${pl.id}`,
      },
    ]);
  }

  keyboard.push([
    { text: '🔄 Actualizar', callback_data: 'playlists_menu:0' },
    { text: '🏛️ Estudio /canal', callback_data: 'chan_editor:open' },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

interface CachedCommentsEntry {
  timestamp: number;
  data: {
    comments: PictaCommentRecord[];
    denuncias: PictaDenunciaSummary;
  };
}
const channelCommentsCacheMap = new Map<string, CachedCommentsEntry>();

function invalidateChannelCommentsCache(): void {
  channelCommentsCacheMap.clear();
}

async function fetchPaginatedPictaCommentPages(
  initialUrl: string,
  token: string,
  maxPages = 5
): Promise<any[]> {
  const collected: any[] = [];
  let nextUrl: string | null = initialUrl;
  for (let p = 0; p < maxPages && nextUrl; p++) {
    const res = await fetchPictaWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
      },
    }).catch(() => null);
    if (!res || !res.ok) break;
    const data = (await res.json().catch(() => null)) as any;
    if (!data) break;
    const batch = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : [];
    collected.push(...batch);
    nextUrl =
      !Array.isArray(data) && typeof data.next === 'string' && data.next.startsWith('http')
        ? data.next
        : null;
    if (batch.length === 0) break;
  }
  return collected;
}

async function fetchChannelCommentsAndDenunciasInPicta(
  chatId?: string,
  pubId?: number,
  forceRefresh = false
): Promise<{
  comments: PictaCommentRecord[];
  denuncias: PictaDenunciaSummary;
}> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;
  const channelId = ctx.channelId;
  const cacheKey = `${channelId}:${pubId || 0}`;

  if (!forceRefresh) {
    const cached = channelCommentsCacheMap.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 25_000) {
      return cached.data;
    }
  }

  let rawComments: any[] = [];
  const pubMetaMap = new Map<number, CommentPublicationMeta>();

  const denPromise = fetchPictaWithRetry('https://api.picta.cu/v1/denuncia/devolver_cantidades/', {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://admin.picta.cu',
    },
  })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));

  // Load full channel catalog (cached or refreshed) so we know every video's title & category
  const snapshot = await fetchPictaChannelCatalogSnapshot(effectiveChatId, forceRefresh).catch(
    () => null
  );
  const catalogPubs = snapshot?.publications || [];
  for (const p of catalogPubs) {
    const pid = Number(p?.id || 0);
    if (!pid) continue;
    const tipObj = p?.categoria?.tipologia || p?.tipologia;
    const catName = String(
      tipObj?.nombre || p?.categoria?.nombre || 'Otros'
    ).trim();
    pubMetaMap.set(pid, {
      nombre: String(p?.nombre || `Video #${pid}`).trim(),
      tipologiaId: Number(tipObj?.id || 0) || undefined,
      categoriaNombre: catName || 'Otros',
    });
  }

  if (pubId && pubId > 0) {
    const v2Pages = await fetchPaginatedPictaCommentPages(
      `https://api.picta.cu/v2/comentario/?publicacion_id=${pubId}&page_size=100`,
      token,
      6
    );
    if (v2Pages.length > 0) {
      rawComments = v2Pages;
    } else {
      rawComments = await fetchPaginatedPictaCommentPages(
        `https://api.picta.cu/v1/comentario/?publicacion_id=${pubId}&page_size=100`,
        token,
        4
      );
    }
  } else {
    try {
      // Prioritize ALL publications with comments (> 0) + top 15 most recent publications
      let pubsList = catalogPubs;
      if (pubsList.length === 0) {
        const pubsRes = await fetchPictaWithRetry(
          `https://api.picta.cu/v2/publicacion/?canal_id=${channelId}&page_size=100`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: 'https://admin.picta.cu',
            },
          }
        ).catch(() => null);
        if (pubsRes && pubsRes.ok) {
          const pubsData = (await pubsRes.json().catch(() => ({}))) as any;
          pubsList = Array.isArray(pubsData.results) ? pubsData.results : [];
          for (const p of pubsList) {
            const pid = Number(p?.id || 0);
            if (!pid) continue;
            const tipObj = p?.categoria?.tipologia || p?.tipologia;
            pubMetaMap.set(pid, {
              nombre: String(p?.nombre || `Video #${pid}`).trim(),
              tipologiaId: Number(tipObj?.id || 0) || undefined,
              categoriaNombre: String(tipObj?.nombre || p?.categoria?.nombre || 'Otros').trim(),
            });
          }
        }
      }

      const pubsWithComments = pubsList.filter((p: any) => Number(p?.cantidad_comentarios || 0) > 0);
      const recentFallbackPubs = pubsList.slice(0, 15);
      const targetPubsMap = new Map<number, any>();
      for (const p of [...pubsWithComments, ...recentFallbackPubs]) {
        const pid = Number(p?.id || 0);
        if (pid && !targetPubsMap.has(pid)) {
          targetPubsMap.set(pid, p);
        }
      }
      const targetPubs = Array.from(targetPubsMap.values());

      // Fetch paginated global + channel comment feeds in parallel with per-publication comment pages
      const [globalFeed, channelFeed] = await Promise.all([
        fetchPaginatedPictaCommentPages(
          `https://api.picta.cu/v2/comentario/?page_size=100`,
          token,
          3
        ),
        fetchPaginatedPictaCommentPages(
          `https://api.picta.cu/v2/comentario/?canal_id=${encodeURIComponent(channelId)}&page_size=100`,
          token,
          3
        ),
      ]);

      const fetchedRawList: any[] = [...channelFeed, ...globalFeed];

      // Fetch ALL pages of comments per video in batches of 6 so no video's comments are missed
      const BATCH_SIZE = 6;
      for (let i = 0; i < targetPubs.length; i += BATCH_SIZE) {
        const batch = targetPubs.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (p: any) => {
            const list = await fetchPaginatedPictaCommentPages(
              `https://api.picta.cu/v2/comentario/?publicacion_id=${p.id}&page_size=100`,
              token,
              4
            );
            return list.map((item: any) => ({
              ...item,
              publicacion:
                typeof item.publicacion === 'object' && item.publicacion
                  ? {
                      ...item.publicacion,
                      id: item.publicacion.id || p.id,
                      nombre: item.publicacion.nombre || p.nombre,
                      categoria: item.publicacion.categoria || p.categoria,
                      canal: item.publicacion.canal || { id: Number(channelId) },
                    }
                  : {
                      id: p.id,
                      nombre: p.nombre,
                      categoria: p.categoria,
                      canal: { id: Number(channelId) },
                    },
            }));
          })
        );
        fetchedRawList.push(...batchResults.flat());
      }

      rawComments = fetchedRawList;
    } catch {
      // Fallback
    }
  }

  const denRaw = await denPromise;
  const myChannelComments = filterChannelComments(rawComments, channelId, pubId, pubMetaMap);
  const result = {
    comments: myChannelComments,
    denuncias: normalizeDenunciaCounts(denRaw),
  };
  channelCommentsCacheMap.set(cacheKey, {
    timestamp: Date.now(),
    data: result,
  });
  return result;
}

async function postPictaCommentInChannel(
  chatId: string,
  pubId: number,
  texto: string,
  parentCommentId?: number
): Promise<any> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise;

  const cleanText = texto.trim();
  if (!cleanText) {
    throw new Error('Escribe un texto válido para el comentario.');
  }

  let effectivePubId = Number(pubId || 0);
  if (!effectivePubId && parentCommentId && parentCommentId > 0) {
    try {
      // v1 is required to resolve parent comment publication ID in Picta (v2 returns 500)
      let parentRes = await fetchPictaWithRetry(
        `https://api.picta.cu/v1/comentario/${parentCommentId}/`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: 'https://admin.picta.cu',
            Referer: 'https://admin.picta.cu/',
          },
        }
      );
      if (!parentRes.ok) {
        parentRes = await fetchPictaWithRetry(
          `https://api.picta.cu/v2/comentario/${parentCommentId}/`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: 'https://admin.picta.cu',
              Referer: 'https://admin.picta.cu/',
            },
          }
        );
      }
      if (parentRes.ok) {
        const parentData = (await parentRes.json()) as any;
        effectivePubId = Number(
          typeof parentData.publicacion === 'object'
            ? parentData.publicacion?.id
            : parentData.publicacion || 0
        );
      }
    } catch {
      // Ignore
    }
  }

  if (!effectivePubId) {
    throw new Error('No se pudo identificar la publicación a la que pertenece este comentario.');
  }

  // Picta /v1/comentario/ strictly requires multipart/form-data (FormData)
  const form = new FormData();
  form.append('texto', cleanText);
  form.append('publicacion', String(effectivePubId));
  if (parentCommentId && parentCommentId > 0) {
    form.append('comentario', String(parentCommentId));
  }

  const res = await fetchPictaWithRetry('https://api.picta.cu/v1/comentario/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: form,
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }
  invalidateChannelCommentsCache();
  return res.json().catch(() => ({ ok: true }));
}

async function fetchPictaPublicationDirectLinks(
  chatId: string,
  pubId: number
): Promise<{
  id: number;
  nombre: string;
  url_descarga?: string;
  url_manifiesto?: string;
  url_video?: string;
  tamanio: number;
  duracion: number;
}> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise.catch(() => '');

  const headers: Record<string, string> = {
    Origin: 'https://admin.picta.cu',
    Referer: 'https://admin.picta.cu/',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res = await fetchPictaWithRetry(
    `https://api.picta.cu/v2/publicacion/${encodeURIComponent(String(pubId))}/`,
    { headers }
  ).catch(() => null);

  if (!res || !res.ok) {
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v1/publicacion/${encodeURIComponent(String(pubId))}/`,
      { headers }
    );
  }

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(formatPictaError(res.status, errTxt));
  }

  const data = (await res.json()) as any;
  const pub = data?.results ? (data.results[0] || data) : data;

  const urlDescarga =
    pub.url_descarga ||
    pub.url_archivo ||
    (pub.url_video && !String(pub.url_video).endsWith('.m3u8') ? pub.url_video : undefined);

  let urlManifiesto =
    pub.url_manifiesto ||
    (pub.url_video && String(pub.url_video).endsWith('.m3u8') ? pub.url_video : undefined);
  if (urlManifiesto && !String(urlManifiesto).startsWith('http')) {
    urlManifiesto = `https://manifest.picta.cu/${String(urlManifiesto).replace(/^\/+/, '')}`;
  }

  return {
    id: Number(pub.id || pubId),
    nombre: String(pub.nombre || pub.titulo || `Video #${pubId}`),
    url_descarga: urlDescarga,
    url_manifiesto: urlManifiesto,
    url_video: pub.url_video,
    tamanio: Number(pub.tamanio || pub.size || 0),
    duracion: Number(pub.duracion || 0),
  };
}

interface PictaGlobalSearchHit {
  id: number;
  kind: 'publicacion' | 'serie';
  title: string;
  categoryName: string;
  tipologiaId?: number;
  channelId: string;
  channelName: string;
  sizeBytes: number;
  resolutions: string[];
  maxResolutionLabel: string;
  durationSeconds: number;
  views: number;
  createdAt: string;
  webUrl: string;
  manifestUrl?: string;
  downloadUrl?: string;
  matchScore: number;
  matchLevel: 'exact' | 'high' | 'partial';
}

const PICTA_SEARCH_STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'y',
  'e',
  'o',
  'en',
  'con',
  'por',
  'para',
  'the',
  'a',
  'an',
  'of',
  'and',
  'in',
  'on',
  'to',
  'by',
  'for',
  'pelicula',
  'movie',
  'film',
  'capitulo',
  'episodio',
  'temporada',
  'serie',
]);

function normalizePictaSearchText(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._|/\\:;\[\]()]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDuplicateTitleKey(raw: string): string {
  return normalizePictaSearchText(raw).replace(/\s+/g, ' ').trim();
}

function stripTechnicalMovieTags(raw: string): string {
  let q = String(raw || '').trim();
  q = q.replace(/\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|ts)$/i, '');
  q = q.replace(/\[[^\]]{1,40}\]/g, ' ');
  q = q.replace(
    /\b(2160p|1080p|720p|480p|360p|4k|uhd|fhd|hd|full\s*hd|web[-\s]?dl|webrip|bluray|blu[-\s]?ray|brrip|bdrip|dvdrip|hdtv|hdcam|camrip|x264|x265|h\.?264|h\.?265|hevc|av1|aac|ac3|dts|eac3|ddp5\.?1|10bit|dual|latino|castellano|espanol|español|subtitulada|subtitulado|sub\s*esp|vose|eng|spa)\b/gi,
    ' '
  );
  q = q.replace(/[._]+/g, ' ');
  q = q.replace(/\(\s*(19\d{2}|20\d{2})\s*\)/g, ' ');
  q = q.replace(/\s+-\s*$/g, '');
  q = q.replace(/\s+/g, ' ').trim();
  return q;
}

function extractEpisodeCoordsForMatch(title: string): { season?: number; episode?: number } {
  const s = String(title || '');
  let m = s.match(/\b[ST](\d{1,2})\s*[:\-xX]?\s*[EC](\d{1,3})\b/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = s.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,3})\b/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = s.match(/\b(?:cap(?:itulo|[ií]tulo)?|ep(?:isodio)?|parte)\s*#?\s*(\d{1,3})\b/i);
  if (m) return { episode: Number(m[1]) };
  return {};
}

function buildPictaSearchQueries(
  rawQuery: string,
  tipologiaId?: number
): { primaryQuery: string; coreTitle: string; altQuery?: string } {
  const cleaned = stripTechnicalMovieTags(rawQuery);
  const withoutTrailingYear = cleaned.replace(/\s+(19\d{2}|20\d{2})$/, '').trim();
  const base = withoutTrailingYear || cleaned || rawQuery.trim();

  // For series episodes like "Breaking Bad · T1:E05 - Ozymandias", extract the series base + episode
  const beforeDashOrSep = base
    .split(/\s*[·|]\s*/)[0]
    .replace(/\b(?:[ST]\d{1,2}\s*[:\-xX]?\s*[EC]\d{1,3}|\d{1,2}[xX]\d{1,3})\b.*/i, '')
    .trim();

  if (tipologiaId === 5 && beforeDashOrSep.length >= 2) {
    return {
      primaryQuery: beforeDashOrSep,
      coreTitle: base,
      altQuery: base !== beforeDashOrSep ? base : undefined,
    };
  }

  const colonPrefix = base.includes(':') ? base.split(':')[0].trim() : '';
  return {
    primaryQuery: base,
    coreTitle: base,
    altQuery:
      colonPrefix.length >= 4 && colonPrefix.toLowerCase() !== base.toLowerCase()
        ? colonPrefix
        : undefined,
  };
}

function scorePictaTitleMatch(
  queryRaw: string,
  candidateTitle: string,
  options?: { tipologiaId?: number; seasonNum?: string | number; epNum?: string | number }
): { score: number; level: 'exact' | 'high' | 'partial' } {
  const cleanQ = stripTechnicalMovieTags(queryRaw).replace(/\s+(19\d{2}|20\d{2})$/, '').trim();
  const cleanC = stripTechnicalMovieTags(candidateTitle).replace(/\s+(19\d{2}|20\d{2})$/, '').trim();

  const normQ = normalizePictaSearchText(cleanQ);
  const normC = normalizePictaSearchText(cleanC);
  if (!normQ || !normC) return { score: 0, level: 'partial' };

  // Episode-level conflict check for Series (avoid Episode 1 flagging Episode 2 as duplicate)
  if (options?.tipologiaId === 5 && options.epNum) {
    const targetEp = Number(options.epNum);
    const targetSeason = options.seasonNum ? Number(options.seasonNum) : undefined;
    const candCoords = extractEpisodeCoordsForMatch(candidateTitle);
    if (candCoords.episode !== undefined && targetEp > 0) {
      if (candCoords.episode !== targetEp) {
        return { score: 0.15, level: 'partial' };
      }
      if (
        candCoords.season !== undefined &&
        targetSeason &&
        candCoords.season !== targetSeason
      ) {
        return { score: 0.15, level: 'partial' };
      }
    }
  }

  if (normQ === normC) {
    return { score: 1.0, level: 'exact' };
  }

  // Strip series episode suffix from both to compare base title if exact coordinates matched
  const qBase = normQ
    .replace(/\b(?:s\d{1,2}\s*e\d{1,3}|t\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3})\b.*$/i, '')
    .trim();
  const cBase = normC
    .replace(/\b(?:s\d{1,2}\s*e\d{1,3}|t\d{1,2}\s*e\d{1,3}|\d{1,2}x\d{1,3})\b.*$/i, '')
    .trim();

  if (options?.tipologiaId === 5 && options.epNum && qBase && cBase && qBase === cBase) {
    const candCoords = extractEpisodeCoordsForMatch(candidateTitle);
    const targetEp = Number(options.epNum);
    if (candCoords.episode === targetEp) {
      return { score: 0.96, level: 'exact' };
    }
  }

  const qTokensAll = normQ.split(' ').filter(Boolean);
  const cTokensAll = normC.split(' ').filter(Boolean);
  const qTokens = qTokensAll.filter((t) => !PICTA_SEARCH_STOPWORDS.has(t));
  const cTokens = cTokensAll.filter((t) => !PICTA_SEARCH_STOPWORDS.has(t));

  const effQ = qTokens.length > 0 ? qTokens : qTokensAll;
  const effC = cTokens.length > 0 ? cTokens : cTokensAll;
  if (effQ.length === 0 || effC.length === 0) return { score: 0.2, level: 'partial' };

  if (effQ.join(' ') === effC.join(' ')) {
    return { score: 0.95, level: 'exact' };
  }

  const cSet = new Set(effC);
  const qSet = new Set(effQ);
  let overlap = 0;
  for (const t of qSet) {
    if (cSet.has(t)) overlap++;
  }

  if (overlap === 0) {
    // Check substring match for single joined titles (e.g. "spiderman" vs "spider man")
    const compactQ = effQ.join('');
    const compactC = effC.join('');
    if (compactQ === compactC) return { score: 0.94, level: 'exact' };
    if (compactQ.length >= 5 && (compactC.includes(compactQ) || compactQ.includes(compactC))) {
      return { score: 0.72, level: 'partial' };
    }
    return { score: 0.05, level: 'partial' };
  }

  const recall = overlap / qSet.size;
  const precision = overlap / cSet.size;
  const dice = (2 * overlap) / (qSet.size + cSet.size);

  // Guard against sequels/different parts like "Dune" vs "Dune Parte 2" unless extra tokens are tiny
  const qNums = effQ.filter((t) => /^\d+$/.test(t) || /^(ii|iii|iv|v|vi)$/.test(t));
  const cNums = effC.filter((t) => /^\d+$/.test(t) || /^(ii|iii|iv|v|vi)$/.test(t));
  const numMismatch =
    (qNums.length > 0 || cNums.length > 0) &&
    qNums.join(',') !== cNums.join(',');

  let score = dice * 0.65 + recall * 0.2 + precision * 0.15;
  if (normC.startsWith(normQ) || normQ.startsWith(normC)) {
    score = Math.max(score, Math.min(0.89, 0.74 + precision * 0.15));
  }
  if (numMismatch) {
    score = Math.min(score, 0.62);
  }

  if (score >= 0.92) return { score, level: 'exact' };
  if (score >= 0.78) return { score, level: 'high' };
  return { score, level: 'partial' };
}

function resolutionLabelFromDims(w: number, h: number): string {
  if (w >= 3800 || h >= 2160) return '4K';
  if (w >= 2500 || h >= 1440) return '1440p';
  if (w >= 1800 || h >= 1080) return '1080p';
  if (w >= 1200 || h >= 720) return '720p';
  if (w >= 800 || h >= 480) return '480p';
  if (w >= 580 || h >= 360) return '360p';
  if (w >= 400 || h >= 240) return '240p';
  return h > 0 ? `${h}p` : w > 0 ? `${w}px` : '';
}

function resolutionRankValue(label: string): number {
  const s = label.toLowerCase();
  if (s.includes('4k') || s.includes('2160')) return 2160;
  const m = s.match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

function parseHlsMasterPlaylistResolutions(m3u8Text: string): string[] {
  const found = new Set<string>();
  const lines = String(m3u8Text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const resMatch = line.match(/RESOLUTION\s*=\s*(\d+)\s*x\s*(\d+)/i);
    if (resMatch) {
      const lbl = resolutionLabelFromDims(Number(resMatch[1]), Number(resMatch[2]));
      if (lbl) found.add(lbl);
    }
    const nameMatch = line.match(/NAME\s*=\s*"([^"]+)"/i);
    if (nameMatch) {
      const qm = nameMatch[1].match(/\b(4K|2160p|1440p|1080p|720p|480p|360p|240p)\b/i);
      if (qm) found.add(qm[1].toUpperCase() === '4K' ? '4K' : qm[1].toLowerCase());
    }
    if (!line.startsWith('#')) {
      const pathMatch = line.match(/\b(2160|1440|1080|720|480|360|240)p?\b/i);
      if (pathMatch && found.size === 0) {
        const val = pathMatch[1];
        found.add(val === '2160' ? '4K' : `${val}p`);
      }
    }
  }
  return Array.from(found).sort((a, b) => resolutionRankValue(b) - resolutionRankValue(a));
}

function formatDurationCompact(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  if (total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function extractInlineResolutionsFromPub(pub: any): string[] {
  const found = new Set<string>();
  const addTag = (raw: unknown) => {
    const str = String(raw || '').trim();
    if (!str) return;
    const m = str.match(/\b(4K|2160p|1440p|1080p|720p|480p|360p|240p)\b/i);
    if (m) {
      found.add(m[1].toUpperCase() === '4K' ? '4K' : m[1].toLowerCase());
    }
  };
  addTag(pub?.resolucion);
  addTag(pub?.calidad);
  addTag(pub?.max_resolution);
  if (Array.isArray(pub?.calidades)) pub.calidades.forEach(addTag);
  if (Array.isArray(pub?.resoluciones)) pub.resoluciones.forEach(addTag);
  if (Array.isArray(pub?.formatos)) {
    for (const f of pub.formatos) {
      addTag(f?.nombre || f?.calidad || f?.resolucion || f);
    }
  }
  const w = Number(pub?.ancho || pub?.width || 0);
  const h = Number(pub?.alto || pub?.height || 0);
  if (w > 0 || h > 0) {
    const lbl = resolutionLabelFromDims(w, h);
    if (lbl) found.add(lbl);
  }
  return Array.from(found).sort((a, b) => resolutionRankValue(b) - resolutionRankValue(a));
}

function mapRawPictaItemToHit(
  raw: any,
  kind: 'publicacion' | 'serie',
  queryForScore: string,
  options?: { tipologiaId?: number; seasonNum?: string | number; epNum?: string | number }
): PictaGlobalSearchHit | null {
  const id = Number(raw?.id || 0);
  const title = String(raw?.nombre || raw?.titulo || '').trim();
  if (!id || !title) return null;

  const catObj = raw?.categoria;
  const tipObj = catObj?.tipologia;
  const tipId = Number(tipObj?.id || raw?.tipologia?.id || raw?.tipologia_id || (kind === 'serie' ? 5 : 0)) || undefined;
  const categoryName =
    kind === 'serie'
      ? 'Serie'
      : String(tipObj?.nombre || catObj?.nombre || raw?.tipologia?.nombre || 'Video');

  const canalObj = typeof raw?.canal === 'object' && raw?.canal ? raw.canal : null;
  const channelId = String(canalObj?.id || raw?.canal_id || (typeof raw?.canal === 'number' ? raw.canal : '') || '');
  const channelName = String(
    canalObj?.nombre ||
      raw?.canal_nombre ||
      (channelId ? `Canal #${channelId}` : 'Canal de Picta')
  ).trim();

  const urlDescarga =
    raw?.url_descarga ||
    raw?.url_archivo ||
    (raw?.url_video && !String(raw.url_video).endsWith('.m3u8') ? String(raw.url_video) : undefined);

  let urlManifiesto =
    raw?.url_manifiesto ||
    (raw?.url_video && String(raw.url_video).endsWith('.m3u8') ? String(raw.url_video) : undefined);
  if (urlManifiesto && !String(urlManifiesto).startsWith('http')) {
    urlManifiesto = `https://manifest.picta.cu/${String(urlManifiesto).replace(/^\/+/, '')}`;
  }

  const inlineRes = extractInlineResolutionsFromPub(raw);
  const scored = scorePictaTitleMatch(queryForScore, title, options);

  const webUrl =
    kind === 'serie'
      ? `https://www.picta.cu/series/${id}`
      : `https://www.picta.cu/medias/${id}`;

  return {
    id,
    kind,
    title,
    categoryName,
    tipologiaId: tipId,
    channelId,
    channelName,
    sizeBytes: Number(raw?.tamanio || raw?.size || 0),
    resolutions: inlineRes,
    maxResolutionLabel: inlineRes.length > 0 ? inlineRes.join(' · ') : '',
    durationSeconds: Number(raw?.duracion || 0),
    views: Number(raw?.cantidad_reproducciones || raw?.cantidad_visitas || raw?.vistas || 0),
    createdAt: String(raw?.fecha_publicado || raw?.fecha_creacion || ''),
    webUrl,
    manifestUrl: urlManifiesto ? String(urlManifiesto) : undefined,
    downloadUrl: urlDescarga ? String(urlDescarga) : undefined,
    matchScore: scored.score,
    matchLevel: scored.level,
  };
}

async function fetchJsonWithShortTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 5500
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithShortTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 3500
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    return await res.text().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichPictaHitMetadata(
  hit: PictaGlobalSearchHit,
  headers: Record<string, string>
): Promise<PictaGlobalSearchHit> {
  if (hit.kind !== 'publicacion') return hit;
  try {
    let detail = await fetchJsonWithShortTimeout(
      `https://api.picta.cu/v2/publicacion/${encodeURIComponent(String(hit.id))}/`,
      headers,
      3800
    );
    if (!detail) {
      detail = await fetchJsonWithShortTimeout(
        `https://api.picta.cu/v1/publicacion/${encodeURIComponent(String(hit.id))}/`,
        headers,
        3500
      );
    }
    const pub = detail?.results ? detail.results[0] || detail : detail;
    if (pub && typeof pub === 'object') {
      const sizeVal = Number(pub.tamanio || pub.size || 0);
      if (sizeVal > 0) hit.sizeBytes = sizeVal;
      const durVal = Number(pub.duracion || 0);
      if (durVal > 0) hit.durationSeconds = durVal;
      const viewsVal = Number(pub.cantidad_reproducciones || pub.cantidad_visitas || 0);
      if (viewsVal > hit.views) hit.views = viewsVal;
      if (pub.fecha_publicado || pub.fecha_creacion) {
        hit.createdAt = String(pub.fecha_publicado || pub.fecha_creacion);
      }
      if (pub.canal && typeof pub.canal === 'object') {
        if (pub.canal.nombre) hit.channelName = String(pub.canal.nombre);
        if (pub.canal.id) hit.channelId = String(pub.canal.id);
      } else if (pub.canal_nombre) {
        hit.channelName = String(pub.canal_nombre);
      }
      const inlineRes = extractInlineResolutionsFromPub(pub);
      if (inlineRes.length > 0) {
        const merged = Array.from(new Set([...hit.resolutions, ...inlineRes])).sort(
          (a, b) => resolutionRankValue(b) - resolutionRankValue(a)
        );
        hit.resolutions = merged;
        hit.maxResolutionLabel = merged.join(' · ');
      }
      const dlUrl =
        pub.url_descarga ||
        pub.url_archivo ||
        (pub.url_video && !String(pub.url_video).endsWith('.m3u8') ? String(pub.url_video) : undefined);
      if (dlUrl) hit.downloadUrl = String(dlUrl);
      let maniUrl =
        pub.url_manifiesto ||
        (pub.url_video && String(pub.url_video).endsWith('.m3u8') ? String(pub.url_video) : undefined);
      if (maniUrl && !String(maniUrl).startsWith('http')) {
        maniUrl = `https://manifest.picta.cu/${String(maniUrl).replace(/^\/+/, '')}`;
      }
      if (maniUrl) hit.manifestUrl = String(maniUrl);
    }

    // Parse HLS .m3u8 manifest for real resolutions (1080p, 720p, 480p, etc.)
    if (hit.manifestUrl && hit.manifestUrl.startsWith('http')) {
      const m3u8Text = await fetchTextWithShortTimeout(hit.manifestUrl, headers, 3200);
      if (m3u8Text && m3u8Text.includes('#EXT')) {
        const parsedRes = parseHlsMasterPlaylistResolutions(m3u8Text);
        if (parsedRes.length > 0) {
          const merged = Array.from(new Set([...hit.resolutions, ...parsedRes])).sort(
            (a, b) => resolutionRankValue(b) - resolutionRankValue(a)
          );
          hit.resolutions = merged;
          hit.maxResolutionLabel = merged.join(' · ');
        }
      }
    }

    // Fallback Content-Length HEAD check if Picta omitted tamanio
    if (hit.sizeBytes <= 0 && hit.downloadUrl && hit.downloadUrl.startsWith('http')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);
      try {
        const headRes = await fetch(hit.downloadUrl, {
          method: 'HEAD',
          headers,
          signal: controller.signal,
        });
        const cl = Number(headRes.headers.get('content-length') || 0);
        if (cl > 0) hit.sizeBytes = cl;
      } catch {
        // Ignore
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    // Non-fatal enrichment error
  }
  return hit;
}

async function searchGlobalPictaCatalog(
  rawQuery: string,
  options?: {
    chatId?: string;
    tipologiaId?: number;
    seasonNum?: string | number;
    epNum?: string | number;
    maxEnrich?: number;
    minScore?: number;
  }
): Promise<{ queryUsed: string; hits: PictaGlobalSearchHit[] }> {
  const { primaryQuery, coreTitle, altQuery } = buildPictaSearchQueries(
    rawQuery,
    options?.tipologiaId
  );
  if (!primaryQuery || primaryQuery.length < 2) {
    return { queryUsed: rawQuery.trim(), hits: [] };
  }

  const effectiveChatId = options?.chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise.catch(() => '');
  const headers: Record<string, string> = {
    Origin: 'https://www.picta.cu',
    Referer: 'https://www.picta.cu/',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const queriesToRun = [primaryQuery];
  if (altQuery && altQuery.toLowerCase() !== primaryQuery.toLowerCase()) {
    queriesToRun.push(altQuery);
  }

  const rawPromises: Promise<{ kind: 'publicacion' | 'serie'; data: any }>[] = [];
  for (const q of queriesToRun) {
    const enc = encodeURIComponent(q);
    rawPromises.push(
      fetchJsonWithShortTimeout(
        `https://api.picta.cu/v2/publicacion/?search=${enc}&page_size=25`,
        headers,
        6000
      ).then((data) => ({ kind: 'publicacion' as const, data }))
    );
    rawPromises.push(
      fetchJsonWithShortTimeout(
        `https://api.picta.cu/v2/serie/?search=${enc}&page_size=15`,
        headers,
        5500
      ).then((data) => ({ kind: 'serie' as const, data }))
    );
  }

  let settled = await Promise.all(rawPromises);
  const v2PubCount = settled
    .filter((r) => r.kind === 'publicacion')
    .reduce((sum, r) => sum + (Array.isArray(r.data?.results) ? r.data.results.length : 0), 0);

  if (v2PubCount === 0) {
    const v1Fallback = await fetchJsonWithShortTimeout(
      `https://api.picta.cu/v1/publicacion/?search=${encodeURIComponent(primaryQuery)}&page_size=25`,
      headers,
      5500
    );
    if (v1Fallback) {
      settled.push({ kind: 'publicacion', data: v1Fallback });
    }
  }

  const deduped = new Map<string, PictaGlobalSearchHit>();
  for (const res of settled) {
    const list = Array.isArray(res.data?.results)
      ? res.data.results
      : Array.isArray(res.data)
        ? res.data
        : [];
    for (const rawItem of list) {
      const mapped = mapRawPictaItemToHit(rawItem, res.kind, coreTitle, {
        tipologiaId: options?.tipologiaId,
        seasonNum: options?.seasonNum,
        epNum: options?.epNum,
      });
      if (!mapped) continue;
      const key = `${mapped.kind}:${mapped.id}`;
      const existing = deduped.get(key);
      if (!existing || mapped.matchScore > existing.matchScore) {
        deduped.set(key, mapped);
      }
    }
  }

  const minScore = options?.minScore ?? 0.25;
  const sorted = Array.from(deduped.values())
    .filter((h) => h.matchScore >= minScore)
    .sort((a, b) => {
      if (Math.abs(b.matchScore - a.matchScore) > 0.05) return b.matchScore - a.matchScore;
      return b.views - a.views;
    });

  const maxEnrich = Math.min(options?.maxEnrich ?? 5, sorted.length);
  if (maxEnrich > 0) {
    await Promise.all(
      sorted.slice(0, maxEnrich).map((hit) => enrichPictaHitMetadata(hit, headers))
    );
  }

  return { queryUsed: primaryQuery, hits: sorted };
}

async function findLikelyPictaDuplicates(
  queryTitle: string,
  options: {
    chatId: string;
    tipologiaId?: number;
    seasonNum?: string | number;
    epNum?: string | number;
  }
): Promise<PictaGlobalSearchHit[]> {
  try {
    const res = await searchGlobalPictaCatalog(queryTitle, {
      chatId: options.chatId,
      tipologiaId: options.tipologiaId,
      seasonNum: options.seasonNum,
      epNum: options.epNum,
      maxEnrich: 4,
      minScore: 0.78,
    });
    return res.hits.slice(0, 4);
  } catch {
    return [];
  }
}

function formatPictaHitEntryHtml(hit: PictaGlobalSearchHit, index: number): string {
  const badgeIcon =
    hit.kind === 'serie' || hit.tipologiaId === 5
      ? '📺'
      : hit.tipologiaId === 1
        ? '🎬'
        : hit.tipologiaId === 2
          ? '🎞️'
          : '📹';
  const matchTag =
    hit.matchLevel === 'exact'
      ? ' 🟢 <i>(Coincidencia exacta)</i>'
      : hit.matchLevel === 'high'
        ? ' 🟡 <i>(Muy similar)</i>'
        : '';
  const sizeStr = hit.sizeBytes > 0 ? formatBytes(hit.sizeBytes) : 'No reportado';
  const resStr = hit.maxResolutionLabel
    ? hit.maxResolutionLabel
    : hit.kind === 'serie'
      ? 'Catálogo Serie'
      : 'No detectada';
  const durStr = formatDurationCompact(hit.durationSeconds);
  const dateStr = hit.createdAt
    ? new Date(hit.createdAt).toLocaleDateString('es-CU', { timeZone: 'America/Havana' })
    : '';

  return (
    `<b>${index + 1}.</b> ${badgeIcon} <a href="${escapeHtml(hit.webUrl)}"><b>${escapeHtml(hit.title)}</b></a>${matchTag}\n` +
    `├ 🏷️ <b>Tipo:</b> ${escapeHtml(hit.categoryName)} · 📺 <b>Canal:</b> ${escapeHtml(hit.channelName)}\n` +
    `├ 📦 <b>Peso:</b> <code>${escapeHtml(sizeStr)}</code> · 🎞️ <b>Resolución:</b> <code>${escapeHtml(resStr)}</code>\n` +
    `└ 👁️ <b>Vistas:</b> ${hit.views.toLocaleString('es-CU')}` +
    (durStr ? ` · ⏱️ ${escapeHtml(durStr)}` : '') +
    (dateStr ? ` · 📅 ${escapeHtml(dateStr)}` : '')
  );
}

async function sendOrEditPictaSearchResultsInTelegram(
  chatId: string,
  messageId: number | null,
  rawQuery: string,
  page = 0,
  replyToMessageId?: number
): Promise<void> {
  const cleanQ = rawQuery.trim();
  if (!cleanQ) return;

  let cached = lastPictaSearchResultsByChat.get(chatId);
  let statusMsgId = messageId;
  if (
    !cached ||
    cached.query.toLowerCase() !== cleanQ.toLowerCase() ||
    Date.now() - cached.fetchedAt > 90_000
  ) {
    const loadingText =
      `${hudHeader('BUSCADOR GLOBAL DE PICTA')}\n` +
      `🔎 <i>Buscando "<b>${escapeHtml(cleanQ)}</b>" en todo el catálogo de Picta y leyendo peso/resolución...</i>`;
    if (statusMsgId) {
      await editTelegramStatusMessage(chatId, statusMsgId, loadingText, undefined, true);
    } else {
      statusMsgId = await sendTelegramStatusMessage(chatId, loadingText, replyToMessageId);
    }

    const searchRes = await searchGlobalPictaCatalog(cleanQ, {
      chatId,
      maxEnrich: 5,
      minScore: 0.2,
    });
    cached = {
      query: cleanQ,
      hits: searchRes.hits,
      fetchedAt: Date.now(),
    };
    lastPictaSearchResultsByChat.set(chatId, cached);
  }

  const hits = cached.hits;
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(hits.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = hits.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const bodyHtml =
    slice.length > 0
      ? slice.map((h, i) => formatPictaHitEntryHtml(h, safePage * pageSize + i)).join('\n\n')
      : `🟢 <b>Sin resultados en Picta para "<code>${escapeHtml(cleanQ)}</code>".</b>\n<i>No se encontraron películas, series ni videos con ese nombre en el catálogo global de Picta.</i>`;

  const text =
    `${hudHeader('BUSCADOR GLOBAL DE PICTA')}\n` +
    hudBox([
      `🔎 <b>Consulta:</b> <code>${escapeHtml(cleanQ)}</code>`,
      `📦 <b>Resultados en toda Picta:</b> <b>${hits.length}</b>` +
        (totalPages > 1 ? ` · Página ${safePage + 1}/${totalPages}` : ''),
    ]) +
    `\n${bodyHtml}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      navRow.push({ text: '⬅️ Anterior', callback_data: `picta_search_page:${safePage - 1}` });
    }
    if (safePage < totalPages - 1) {
      navRow.push({ text: 'Siguiente ➡️', callback_data: `picta_search_page:${safePage + 1}` });
    }
    if (navRow.length > 0) keyboard.push(navRow);
  }
  keyboard.push([
    { text: '🔎 Nueva Búsqueda', callback_data: 'picta_search:prompt' },
    { text: '◈ Menú Principal', callback_data: 'cmd_start' },
  ]);

  if (statusMsgId) {
    await editTelegramStatusMessage(chatId, statusMsgId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function promptDuplicateConfirmationInTelegram(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null,
  matches: PictaGlobalSearchHit[],
  nextAction: 'step2' | 'auto' | 'pinned_serie'
): Promise<void> {
  pendingManualTitleByChat.delete(chatId);
  job.stage = 'awaiting_duplicate_confirmation';
  job.duplicateCheckNextAction = nextAction;
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  const topMatches = matches.slice(0, 3);
  const matchesHtml = topMatches.map((h, i) => formatPictaHitEntryHtml(h, i)).join('\n\n');

  const text =
    `${hudHeader('⚠️ POSIBLE CONTENIDO REPETIDO EN PICTA')}\n` +
    hudBox([
      `🎬 <b>Tu video:</b> ${escapeHtml(job.title || job.fileName)}`,
      `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
      `📦 <b>Tu peso:</b> <code>${formatBytes(job.expectedBytes)}</code>`,
    ]) +
    `\n🚨 <b>Encontré ${matches.length} coincidencia(s) ya publicada(s) en Picta:</b>\n\n` +
    `${matchesHtml}\n\n` +
    `💡 <i>Revisa el canal, peso y resolución antes de continuar para evitar sanciones por contenido repetido. ¿Qué deseas hacer?</i>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: '⚠️ Subir de Todas Formas',
        callback_data: `dup_proceed:${job.id}`,
      },
    ],
    [
      {
        text: '✏️ Cambiar / Refinar Título',
        callback_data: `dup_edit_title:${job.id}`,
      },
    ],
    [
      {
        text: '🛑 Cancelar Subida (Ya Existe)',
        callback_data: `cancel_job:${job.id}`,
      },
    ],
  ];

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function checkPictaDuplicateAndPromptIfFound(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null,
  nextAction: 'step2' | 'auto' | 'pinned_serie'
): Promise<boolean> {
  const titleToCheck = String(job.title || job.fileName || '').trim();
  if (!titleToCheck || isRandomOrCrypticFilename(titleToCheck)) {
    return false;
  }

  const normalizedKey = normalizeDuplicateTitleKey(titleToCheck);
  if (job.duplicateCheckApprovedTitle && job.duplicateCheckApprovedTitle === normalizedKey) {
    return false;
  }

  const meta = job.modelMetadata || {};
  const matches = await findLikelyPictaDuplicates(titleToCheck, {
    chatId,
    tipologiaId: Number(job.tipologiaId || 8),
    seasonNum: meta.temporada,
    epNum: meta.numero,
  });

  if (matches.length === 0) {
    return false;
  }

  await promptDuplicateConfirmationInTelegram(job, chatId, messageId, matches, nextAction);
  return true;
}

async function proceedFromStep1ToStep2WithDuplicateCheck(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  const pausedForDuplicate = await checkPictaDuplicateAndPromptIfFound(
    job,
    chatId,
    messageId,
    'step2'
  );
  if (pausedForDuplicate) return;
  await promptStep2Synopsis(job, chatId, messageId);
}

async function executeAutoUploadAfterDuplicateCheck(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  const hasLinkedSerieTitle =
    job.tipologiaId === 5 &&
    Boolean(job.modelMetadata?.serie) &&
    !isGenericOrInvalidSerieName(String(job.modelMetadata?.serie || '')) &&
    Boolean(job.title);
  job.titleMode = hasLinkedSerieTitle ? 'manual' : 'auto';
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  if (!job.preferredUploadAccountKey && getPoolAccountsForChat(chatId).length > 0) {
    await promptUploadAccountSelection(job, chatId, messageId);
    return;
  }

  job.stage = 'generating_auto_title';
  currentActivity = `Autorrellenando todo para "${job.fileName}" (${job.category || 'Audiovisual'})...`;
  saveJobsToDisk();

  const autoStartText =
    `⚡ <b>Autorrellenando ficha de ${escapeHtml(job.category || 'Audiovisual')} e iniciando subida...</b>\n` +
    `<blockquote>📄 <code>${escapeHtml(job.fileName)}</code> (${formatBytes(job.expectedBytes)})` +
    (hasLinkedSerieTitle ? `\n🎬 <b>Título:</b> ${escapeHtml(job.title)}` : '') +
    `</blockquote>`;

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, autoStartText, undefined, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, autoStartText, job.telegramMessageId);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }

  await triggerCloudRunKeepAliveTransfer(job.id, hasLinkedSerieTitle ? job.title : '', job.statusMessageId || messageId);
}

async function executePinnedSerieUploadAfterDuplicateCheck(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  if (getPoolAccountsForChat(chatId).length > 0 && !job.preferredUploadAccountKey) {
    await promptUploadAccountSelection(job, chatId, messageId);
    return;
  }

  const userChannelCtx = getEffectivePictaContext(chatId);
  const pinnedSerie = pinnedBatchSerieByChat.get(chatId);
  const targetSeason = String(job.modelMetadata?.temporada || pinnedSerie?.seasonNum || '1');
  const targetEp = String(job.modelMetadata?.numero || '1');
  const serieLabel = String(job.modelMetadata?.serie || pinnedSerie?.serieName || 'Serie');
  const isQueuing = isTransferJobRunningOrProcessing(job.id);
  const autoKb = [
    [{ text: '🛑 Cancelar este capítulo', callback_data: `cancel_job:${job.id}` }],
    [
      { text: '📋 Ver Cola (/cola)', callback_data: 'queue_view' },
      { text: '🔓 Desactivar Serie Fija', callback_data: 'unpin_serie' },
    ],
  ];

  const batchMsgText =
    `📌 <b>MODO SERIE FIJA · CAPÍTULO DETECTADO AUTOMÁTICAMENTE</b>\n` +
    `<blockquote>` +
    `📺 <b>Serie:</b> ${escapeHtml(serieLabel)} (T${escapeHtml(targetSeason)}:E${escapeHtml(targetEp.padStart(2, '0'))})\n` +
    `🎬 <b>Título final:</b> <code>${escapeHtml(job.title)}</code>\n` +
    `📝 <b>Sinopsis:</b> ${escapeHtml((job.synopsis || '').slice(0, 110))}\n` +
    `📦 <b>Tamaño:</b> ${formatBytes(job.expectedBytes)} · 🖼️ <b>Portada:</b> Oficial de la serie` +
    `</blockquote>\n` +
    (isQueuing
      ? `⏳ <i>Hay una subida en curso: este capítulo se ha puesto en la <b>cola automática</b> y empezará solo al terminar el anterior.</i>`
      : `🚀 <i>Iniciando descarga MTProto 2 GB y subida automática a ${escapeHtml(userChannelCtx.channelName)} (#${escapeHtml(userChannelCtx.channelId)})...</i>`);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, batchMsgText, autoKb, true);
  } else {
    const sentAutoId = await sendTelegramStatusMessage(
      chatId,
      batchMsgText,
      job.telegramMessageId,
      autoKb
    );
    if (sentAutoId) {
      job.statusMessageId = sentAutoId;
      saveJobsToDisk();
    }
  }

  await triggerCloudRunKeepAliveTransfer(job.id, job.title, job.statusMessageId || messageId);
}

async function deletePictaCommentInChannel(
  chatId: string,
  commentId: number
): Promise<void> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise;

  const res = await fetchPictaWithRetry(
    `https://api.picta.cu/v1/comentario/${encodeURIComponent(String(commentId))}/`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    }
  );

  if (!res.ok && res.status !== 204) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }
  invalidateChannelCommentsCache();
}

interface StoredCommentReplyTarget {
  chatId: string;
  channelId: string;
  pubId: number;
  pubTitle: string;
  commentId: number;
  author: string;
  createdAt: string;
}

interface StoredChannelAlertState {
  baselineInitialized: boolean;
  seenCommentIds: number[];
  pubSnapshots: Record<string, PublicationAlertSnapshot>;
}

interface PersistentAlertsState {
  prefsByChat: Record<string, ChatAlertPreferences>;
  channelStates: Record<string, StoredChannelAlertState>;
  replyTargets: Record<string, StoredCommentReplyTarget>;
}

function loadAlertsStateFromDisk(): PersistentAlertsState {
  try {
    if (fs.existsSync(ALERTS_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ALERTS_STATE_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        const prefsByChat: Record<string, ChatAlertPreferences> = {};
        if (parsed.prefsByChat && typeof parsed.prefsByChat === 'object') {
          for (const [k, v] of Object.entries(parsed.prefsByChat)) {
            prefsByChat[String(k)] = normalizeAlertPreferences(v as Partial<ChatAlertPreferences>);
          }
        }
        return {
          prefsByChat,
          channelStates:
            parsed.channelStates && typeof parsed.channelStates === 'object'
              ? parsed.channelStates
              : {},
          replyTargets:
            parsed.replyTargets && typeof parsed.replyTargets === 'object'
              ? parsed.replyTargets
              : {},
        };
      }
    }
  } catch {
    // Ignore read error
  }
  return { prefsByChat: {}, channelStates: {}, replyTargets: {} };
}

const alertsState: PersistentAlertsState = loadAlertsStateFromDisk();

function saveAlertsStateToDisk(): void {
  try {
    const replyEntries = Object.entries(alertsState.replyTargets);
    if (replyEntries.length > 400) {
      alertsState.replyTargets = Object.fromEntries(replyEntries.slice(-400));
    }
    fs.writeFileSync(ALERTS_STATE_FILE, JSON.stringify(alertsState, null, 2), 'utf-8');
    mirrorFileToLegacyDataDir(ALERTS_STATE_FILE, 'picta_alerts_state.json');
  } catch {
    // Ignore write error
  }
}

function getChatAlertPreferences(chatId: string): ChatAlertPreferences {
  if (!alertsState.prefsByChat[chatId]) {
    alertsState.prefsByChat[chatId] = getDefaultAlertPreferences();
  }
  return alertsState.prefsByChat[chatId];
}

function getChannelAlertState(chatId: string, channelId: string): StoredChannelAlertState {
  const key = `${chatId}:${channelId}`;
  if (!alertsState.channelStates[key]) {
    alertsState.channelStates[key] = {
      baselineInitialized: false,
      seenCommentIds: [],
      pubSnapshots: {},
    };
  }
  return alertsState.channelStates[key];
}

let alertsScannerBusy = false;

async function scanPictaAlertsAndMilestonesForTarget(
  chatId: string,
  channelId: string,
  channelName: string,
  token: string,
  ownUserId?: number,
  ownUsername?: string
): Promise<{ newComments: number; newMilestones: number }> {
  const prefs = getChatAlertPreferences(chatId);
  const state = getChannelAlertState(chatId, channelId);
  const wasInitialized = state.baselineInitialized;

  // Fetch up to 2 pages (100 publications) of this channel for accurate metric milestones & comment counters
  const pubs: any[] = [];
  let nextUrl: string | null = `https://api.picta.cu/v2/publicacion/?canal_id=${encodeURIComponent(channelId)}&page_size=50`;
  for (let p = 0; p < 2 && nextUrl; p++) {
    const pubRes = await fetchPictaWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
      },
    }).catch(() => null);
    if (!pubRes || !pubRes.ok) break;
    const pubData = (await pubRes.json().catch(() => null)) as any;
    if (!pubData) break;
    const batch = Array.isArray(pubData.results) ? pubData.results : [];
    pubs.push(...batch);
    nextUrl = typeof pubData.next === 'string' && pubData.next.startsWith('http') ? pubData.next : null;
  }

  if (pubs.length === 0) {
    return { newComments: 0, newMilestones: 0 };
  }

  let newMilestones = 0;
  const pubIdsWithCommentGrowth: number[] = [];

  for (const rawPub of pubs) {
    const pubId = Number(rawPub?.id || 0);
    if (!pubId) continue;
    const prevSnap = state.pubSnapshots[String(pubId)];
    const { nextSnapshot, events } = evaluatePublicationMilestones({
      pub: {
        id: pubId,
        nombre: String(rawPub.nombre || `Video #${pubId}`),
        cantidad_reproducciones: Number(rawPub.cantidad_reproducciones || 0),
        cantidad_me_gusta: Number(rawPub.cantidad_me_gusta || 0),
        cantidad_descargas: Number(rawPub.cantidad_descargas || 0),
        cantidad_comentarios: Number(rawPub.cantidad_comentarios || 0),
        cantidad_visitas: Number(rawPub.cantidad_visitas || 0),
      },
      prefs,
      prevSnapshot: prevSnap,
      baselineInitialized: wasInitialized,
    });

    const prevCommentCount = prevSnap ? Number(prevSnap.commentCount || 0) : 0;
    if (
      nextSnapshot.commentCount > prevCommentCount ||
      (!prevSnap && nextSnapshot.commentCount > 0)
    ) {
      pubIdsWithCommentGrowth.push(pubId);
    }

    state.pubSnapshots[String(pubId)] = nextSnapshot;

    for (const ev of events) {
      newMilestones++;
      const crossedBadge =
        ev.crossedThresholds.length > 1
          ? ` (superando también: ${ev.crossedThresholds.slice(0, -1).map(formatMilestoneNumber).join(', ')})`
          : '';
      const alertText =
        `${hudHeader(`LOGRO ALCANZADO · ${channelName}`)}\n` +
        hudBox([
          `🎬 <b>Video:</b> ${escapeHtml(ev.pubTitle)}`,
          `${ev.metricIcon} <b>Meta superada:</b> <b>${formatMilestoneNumber(ev.threshold)} ${escapeHtml(ev.metricLabel)}</b>${escapeHtml(crossedBadge)}`,
          `📊 <b>Valor actual:</b> <b>${formatMilestoneNumber(ev.currentValue)}</b>`,
        ]) +
        `\n${hudSection('Métricas en Tiempo Real')}\n` +
        hudBox([
          `▶️ Reprod.: <b>${formatMilestoneNumber(ev.statsSummary.plays)}</b> · ❤️ Likes: <b>${formatMilestoneNumber(ev.statsSummary.likes)}</b>`,
          `📥 Descargas: <b>${formatMilestoneNumber(ev.statsSummary.downloads)}</b> · 💬 Comentarios: <b>${formatMilestoneNumber(ev.statsSummary.comments)}</b>`,
        ]);
      await sendTelegramStatusMessage(chatId, alertText, undefined, [
        [
          {
            text: '📊 Editar / Ver Video',
            callback_data: `dash_pub:${ev.pubId}:views:0`,
          },
          {
            text: '🌐 Ver en Picta Web',
            url: `https://www.picta.cu/medias/${ev.pubId}`,
          },
        ],
        [
          {
            text: '🏆 Configurar Metas (/logros)',
            callback_data: 'alerts_menu',
          },
        ],
      ]);
    }
  }

  // Fetch comments from pubs with new comment activity (or recent 4 pubs) + recent global batch filtered to this channel
  const pubMapById = new Map<number, string>();
  for (const p of pubs) {
    if (p?.id) pubMapById.set(Number(p.id), String(p.nombre || `Video #${p.id}`));
  }

  const targetPubIds = Array.from(
    new Set([
      ...pubIdsWithCommentGrowth.slice(0, 6),
      ...pubs.slice(0, wasInitialized ? 3 : 6).map((p) => Number(p?.id || 0)),
    ])
  ).filter((id) => id > 0);

  const collectedRawComments: any[] = [];
  if (targetPubIds.length > 0) {
    const perPub = await Promise.all(
      targetPubIds.map(async (pid) => {
        const cRes = await fetchPictaWithRetry(
          `https://api.picta.cu/v2/comentario/?publicacion_id=${pid}&page_size=20`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: 'https://admin.picta.cu',
            },
          }
        ).catch(() => null);
        if (!cRes || !cRes.ok) return [];
        const cJson = (await cRes.json().catch(() => null)) as any;
        const list = Array.isArray(cJson) ? cJson : cJson?.results || [];
        return list.map((item: any) => ({
          ...item,
          publicacion: {
            id: pid,
            nombre: pubMapById.get(pid) || item?.publicacion?.nombre || `Video #${pid}`,
            canal: { id: Number(channelId) },
          },
        }));
      })
    );
    collectedRawComments.push(...perPub.flat());
  }

  // Also check recent global comments filtered strictly to this channel in case an older video received a comment
  const globalCmRes = await fetchPictaWithRetry(
    `https://api.picta.cu/v2/comentario/?page_size=35`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
      },
    }
  ).catch(() => null);
  if (globalCmRes && globalCmRes.ok) {
    const gJson = (await globalCmRes.json().catch(() => null)) as any;
    const gList = Array.isArray(gJson) ? gJson : gJson?.results || [];
    collectedRawComments.push(...gList);
  }

  const channelComments = filterChannelComments(collectedRawComments, channelId);
  const mappedComments: ChannelCommentInput[] = channelComments.map((c) => ({
    id: Number(c.id),
    texto: String(c.texto || '').trim(),
    usuario: String(c.usuario || 'Usuario').trim(),
    fecha: String(c.fecha || ''),
    publicacionId: Number(c.publicacionId || 0),
    publicacionNombre:
      pubMapById.get(Number(c.publicacionId || 0)) ||
      String(c.publicacionNombre || `Video #${c.publicacionId || 0}`),
  }));

  const { newComments, nextSeenCommentIds } = detectNewChannelComments({
    comments: mappedComments,
    seenCommentIds: state.seenCommentIds,
    baselineInitialized: wasInitialized,
    ownUserId,
    ownUsername,
  });

  state.seenCommentIds = nextSeenCommentIds;
  state.baselineInitialized = true;

  let notifiedComments = 0;
  if (prefs.commentsEnabled) {
    for (const nc of newComments) {
      notifiedComments++;
      const dateLabel = nc.fecha
        ? new Date(nc.fecha).toLocaleString('es-CU', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Reciente';
      const msgText =
        `${hudHeader(`NUEVO COMENTARIO · ${channelName}`)}\n` +
        hudBox([
          `🎬 <b>Video:</b> ${escapeHtml(nc.publicacionNombre)}`,
          `👤 <b>Autor:</b> <code>@${escapeHtml(nc.usuario)}</code> · 🕒 <i>${escapeHtml(dateLabel)}</i>`,
          `💬 "${escapeHtml(nc.texto.slice(0, 700))}"`,
        ]) +
        `\n💡 <i>Responde directo haciendo <b>Reply</b> a este mensaje o pulsando <b>"💬 Responder"</b>.</i>`;

      const sentId = await sendTelegramStatusMessage(chatId, msgText, undefined, [
        [
          {
            text: '💬 Responder',
            callback_data: `comment_reply_prompt:${nc.publicacionId}:${nc.id}`,
          },
          {
            text: '🗑️ Borrar',
            callback_data: `comment_del_alert:${nc.publicacionId}:${nc.id}`,
          },
        ],
        [
          {
            text: '🌐 Ver Video en Picta',
            url: `https://www.picta.cu/medias/${nc.publicacionId}`,
          },
        ],
      ]);

      if (sentId) {
        alertsState.replyTargets[`${chatId}:${sentId}`] = {
          chatId,
          channelId,
          pubId: nc.publicacionId,
          pubTitle: nc.publicacionNombre,
          commentId: nc.id,
          author: nc.usuario,
          createdAt: new Date().toISOString(),
        };
      }
    }
  }

  saveAlertsStateToDisk();
  return { newComments: notifiedComments, newMilestones };
}

async function scanAllPictaAlertsAndMilestones(
  onlyChatId?: string
): Promise<{ checked: number; newComments: number; newMilestones: number }> {
  if (alertsScannerBusy && !onlyChatId) {
    return { checked: 0, newComments: 0, newMilestones: 0 };
  }
  alertsScannerBusy = true;
  let checked = 0;
  let totalComments = 0;
  let totalMilestones = 0;

  try {
    const targets: Array<{
      chatId: string;
      channelId: string;
      channelName: string;
      tokenPromise: Promise<string>;
      ownUserId?: number;
      ownUsername?: string;
    }> = [];

    if (!onlyChatId || isMasterAdminChat(onlyChatId)) {
      const masterCtx = getEffectivePictaContext(MASTER_ADMIN_CHAT_ID);
      if (masterCtx.channelId) {
        targets.push({
          chatId: MASTER_ADMIN_CHAT_ID,
          channelId: masterCtx.channelId,
          channelName: masterCtx.channelName,
          tokenPromise: masterCtx.accessTokenPromise,
          ownUserId: pictaUser?.id,
          ownUsername: pictaUser?.username,
        });
      }
    }

    for (const [guestChatId, sess] of userSessions.entries()) {
      if (isMasterAdminChat(guestChatId)) continue;
      if (onlyChatId && guestChatId !== onlyChatId) continue;
      if (!sess.channelId || !sess.authToken) continue;
      const gCtx = getEffectivePictaContext(guestChatId);
      if (!gCtx.isLinked || !gCtx.channelId) continue;
      targets.push({
        chatId: guestChatId,
        channelId: gCtx.channelId,
        channelName: gCtx.channelName,
        tokenPromise: gCtx.accessTokenPromise,
        ownUserId: sess.userId,
        ownUsername: sess.username,
      });
    }

    for (const t of targets) {
      try {
        const tok = await t.tokenPromise;
        if (!tok) continue;
        const r = await scanPictaAlertsAndMilestonesForTarget(
          t.chatId,
          t.channelId,
          t.channelName,
          tok,
          t.ownUserId,
          t.ownUsername
        );
        checked++;
        totalComments += r.newComments;
        totalMilestones += r.newMilestones;
      } catch {
        // Non-fatal per-channel scan error
      }
    }
  } finally {
    alertsScannerBusy = false;
  }

  return { checked, newComments: totalComments, newMilestones: totalMilestones };
}

async function sendOrEditAlertsMilestonesMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  pendingToolkitInputByChat.delete(chatId);
  const isMaster = isMasterAdminChat(chatId);
  const session = userSessions.get(chatId);
  if (!isMaster && !session?.channelId) {
    const text =
      `${hudHeader('LOGROS Y ALERTAS · ACCESO REQUERIDO')}\n` +
      hudBox([
        `🔒 <b>Estado:</b> Cuenta de Picta sin vincular`,
        `👉 Para recibir notificaciones de comentarios nuevos y logros de tus videos, primero vincula tu cuenta con /login.`,
      ]);
    const keyboard = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }

  const ctx = getEffectivePictaContext(chatId);
  const prefs = getChatAlertPreferences(chatId);
  const state = getChannelAlertState(chatId, ctx.channelId);
  const trackedVideosCount = Object.keys(state.pubSnapshots || {}).length;

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`LOGROS Y ALERTAS · ${ctx.channelName}`)}\n` +
    hudBox([
      `📺 <b>Canal vigilado:</b> ${escapeHtml(ctx.channelName)} · <code>#${escapeHtml(ctx.channelId)}</code>`,
      `💬 <b>Alertas de Comentarios:</b> ${prefs.commentsEnabled ? '🟢 Activadas (Reply directo)' : '⚪ Desactivadas'}`,
      `🏆 <b>Notificaciones de Logros:</b> ${prefs.milestonesEnabled ? '🟢 Activadas' : '⚪ Desactivadas'}`,
      `📡 <b>Videos monitoreados:</b> ${trackedVideosCount > 0 ? trackedVideosCount : 'Se inicializará en la próxima revisión'}`,
    ]) +
    `\n${hudSection('Métricas Vigiladas')}\n` +
    hudBox([
      `▶️ <b>Reproducciones:</b> ${prefs.enabledMetrics.plays ? '🟢 Activa' : '⚪ Pausada'}`,
      `❤️ <b>Likes:</b> ${prefs.enabledMetrics.likes ? '🟢 Activa' : '⚪ Pausada'}`,
      `📥 <b>Descargas:</b> ${prefs.enabledMetrics.downloads ? '🟢 Activa' : '⚪ Pausada'}`,
      `💬 <b>Comentarios:</b> ${prefs.enabledMetrics.comments ? '🟢 Activa' : '⚪ Pausada'}`,
      `👀 <b>Vistas:</b> 🚫 <i>Excluida permanentemente</i>`,
    ]) +
    `\n${hudSection('Metas Progresivas Actuales')}\n` +
    `<code>${prefs.thresholds.map(formatMilestoneNumber).join(' · ')}</code>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: prefs.commentsEnabled ? '💬 Comentarios: 🟢 ON' : '💬 Comentarios: ⚪ OFF',
        callback_data: 'alerts_toggle_comments',
      },
      {
        text: prefs.milestonesEnabled ? '🏆 Logros: 🟢 ON' : '🏆 Logros: ⚪ OFF',
        callback_data: 'alerts_toggle_milestones',
      },
    ],
    [
      {
        text: `${prefs.enabledMetrics.plays ? '✅' : '⬜'} ▶️ Reprod.`,
        callback_data: 'alerts_toggle_metric:plays',
      },
      {
        text: `${prefs.enabledMetrics.likes ? '✅' : '⬜'} ❤️ Likes`,
        callback_data: 'alerts_toggle_metric:likes',
      },
    ],
    [
      {
        text: `${prefs.enabledMetrics.downloads ? '✅' : '⬜'} 📥 Descargas`,
        callback_data: 'alerts_toggle_metric:downloads',
      },
      {
        text: `${prefs.enabledMetrics.comments ? '✅' : '⬜'} 💬 Comentarios`,
        callback_data: 'alerts_toggle_metric:comments',
      },
    ],
    [
      {
        text: '✏️ Editar Metas Progresivas',
        callback_data: 'alerts_edit_thresholds',
      },
      {
        text: '♻️ Metas por Defecto',
        callback_data: 'alerts_reset_thresholds',
      },
    ],
    [
      {
        text: '🔄 Revisar Comentarios y Logros Ahora',
        callback_data: 'alerts_scan_now',
      },
    ],
    [
      { text: '🏛️ Volver a /canal', callback_data: 'chan_editor:open' },
      { text: '🔙 Menú Principal', callback_data: 'cmd_start' },
    ],
  ];

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function sendOrEditAccountDiagnosticInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number
): Promise<void> {
  const isMaster = isMasterAdminChat(chatId);
  if (isMaster) {
    const text =
      `${hudHeader('CUENTA PRINCIPAL · MULTIVERSO VISUAL')}\n` +
      hudBox([
        `👤 <b>Administrador:</b> <code>@admin_bot</code> (+5350000000)`,
        `📺 <b>Canal Oficial:</b> Canal Oficial · <code>#36319</code>`,
        `🛡️ <b>Rol Picta:</b> Jefe de canal (Activo)`,
        `🔑 <b>Estado:</b> Conectado · Credenciales maestras`,
      ]) +
      `\n${hudSection('Comandos de Administración')}\n` +
      hudBox([
        `<code>/canal</code> · Editar nombre, lema, descripción, avatar y portada`,
        `<code>/logros</code> · Alertas de comentarios y metas progresivas`,
        `<code>/usuarios</code> · Lista de usuarios autorizados`,
      ]);
    const kb = [
      [{ text: '🏛️ Editar mi Canal (/canal)', callback_data: 'chan_editor:open' }],
      [{ text: '🏆 Logros y Alertas (/logros)', callback_data: 'alerts_menu' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, kb, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, kb);
    }
    return;
  }

  await ensureGuestSessionChannelDiscovered(chatId, true);
  const session = userSessions.get(chatId);
  if (!session) {
    const text =
      `${hudHeader('CUENTA DE PICTA · SIN VINCULAR')}\n` +
      hudBox([
        `⚪ <b>Estado:</b> No hay sesión vinculada en este chat`,
        `👉 Para subir videos directo a tu canal de Picta, inicia sesión abajo.`,
      ]);
    const kb = [
      [{ text: '🔑 Iniciar Sesión en Picta (/login)', callback_data: 'user_picta_login_start' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, kb, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, kb);
    }
    return;
  }

  let liveGroups = session.pictaGroups || [];
  let hasAdminRole = session.hasChannelAdminRole;
  let liveWriteCheckText = '⏳ Sin verificar';
  let liveUsername = session.username;

  try {
    const ctx = getEffectivePictaContext(chatId);
    const tok = await ctx.accessTokenPromise;
    const meObj = await fetchDecryptedPictaMe2(tok);
    if (meObj) {
      liveUsername = String(meObj.username || session.username);
      const grp = extractPictaGroupSummary(meObj);
      liveGroups = grp.groupNames;
      hasAdminRole = grp.hasChannelAdminRole;
      session.pictaGroups = grp.groupNames;
      session.hasChannelAdminRole = grp.hasChannelAdminRole;
      saveUserSessionsToDisk();
    }
    // Probe real write permission without publishing anything
    const valRes = await fetchPictaWithRetry('https://api.picta.cu/v1/publicacion/validar_campos/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: new FormData(),
    }).catch(() => null);
    if (valRes) {
      if (valRes.status === 403) {
        liveWriteCheckText = '🔴 Bloqueado (HTTP 403 en Picta · falta rol Jefe de canal)';
        hasAdminRole = false;
      } else {
        liveWriteCheckText = '🟢 Activo (Permiso de publicación habilitado)';
      }
    }
  } catch {
    liveWriteCheckText = '⚠️ No se pudo comprobar en vivo con Picta';
  }

  const roleDiag =
    hasAdminRole === false
      ? `\n\n${buildPictaRoleDiagnosticLines({
          username: liveUsername,
          groupNames: liveGroups,
          hasChannelAdminRole: false,
          channelName: session.channelName,
          channelId: session.channelId,
        })}`
      : '';

  const channelButtons: Array<Array<{ text: string; callback_data: string }>> = (
    session.availableChannels || []
  )
    .slice(0, 6)
    .map((c) => [
      {
        text: `📺 ${c.nombre} (#${c.id})`,
        callback_data: `user_channel_pick:${c.id}`,
      },
    ]);
  channelButtons.push([
    { text: '🔄 Re-verificar en Picta', callback_data: 'cmd_cuenta' },
    { text: '🏆 Alertas (/logros)', callback_data: 'alerts_menu' },
  ]);
  channelButtons.push([{ text: '🏛️ Editar mi Canal (/canal)', callback_data: 'chan_editor:open' }]);
  channelButtons.push([{ text: '🚪 Cerrar Sesión (/logout)', callback_data: 'user_picta_logout' }]);

  const text =
    `${hudHeader('DIAGNÓSTICO DE CUENTA EN VIVO')}\n` +
    hudBox([
      `👤 <b>Titular:</b> ${escapeHtml(session.userFullName || session.username)} (<code>${escapeHtml(liveUsername)}</code>)`,
      `📺 <b>Canal Activo:</b> ${session.channelId ? `${escapeHtml(session.channelName)} · <code>#${escapeHtml(session.channelId)}</code>` : 'Sin canal asignado'}`,
      `🛡️ <b>Grupos Picta:</b> ${liveGroups.length > 0 ? escapeHtml(liveGroups.join(', ')) : 'Por verificar'}`,
      `🔐 <b>Permiso Publicación:</b> ${liveWriteCheckText}`,
    ]) +
    roleDiag +
    (!session.channelId
      ? `\n💡 Si tu cuenta tiene un canal aprobado y aún no aparece, pega su enlace con <code>/canal https://www.picta.cu/canal/tu-canal</code>.`
      : '');

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, channelButtons, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, channelButtons);
  }
}

type CommentsDashboardSort = 'recent' | 'oldest' | 'video';

const lastCommentsViewByChat = new Map<
  string,
  { catKey: string; sort: CommentsDashboardSort; page: number; pubId: number }
>();

function getCategoryIconForComments(catName: string): string {
  const s = catName.toLowerCase();
  if (s.includes('pel')) return '🎬';
  if (s.includes('ser') || s.includes('cap')) return '📺';
  if (s.includes('doc')) return '🎞️';
  if (s.includes('mus') || s.includes('clip')) return '🎵';
  if (s.includes('hum')) return '😂';
  if (s.includes('short')) return '⚡';
  if (s.includes('dep')) return '⚽';
  if (s.includes('game')) return '🎮';
  return '📹';
}

function getCommentCatKey(c: PictaCommentRecord): string {
  if (c.tipologiaId && c.tipologiaId > 0) return `tip_${c.tipologiaId}`;
  const clean = String(c.categoriaNombre || 'Otros')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10);
  return `cat_${clean || 'otros'}`;
}

async function sendOrEditCommentsMenuInTelegram(
  chatId: string,
  messageId: number | null,
  pubId?: number,
  replyToMessageId?: number,
  notice?: string,
  options?: {
    catKey?: string;
    sort?: CommentsDashboardSort;
    page?: number;
    forceRefresh?: boolean;
  }
): Promise<void> {
  pendingToolkitInputByChat.delete(chatId);
  const isMaster = isMasterAdminChat(chatId);
  const session = userSessions.get(chatId);
  if (!isMaster && !session?.channelId) {
    const text =
      `${hudHeader('DASHBOARD DE COMENTARIOS · ACCESO REQUERIDO')}\n` +
      hudBox([
        `🔒 <b>Estado:</b> Cuenta de Picta sin vincular`,
        `👉 Para moderar y responder comentarios en los videos de tu propio canal, vincula tu cuenta con /login.`,
      ]);
    const keyboard = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }

  const ctx = getEffectivePictaContext(chatId);
  const effectivePubId = pubId && pubId > 0 ? pubId : 0;
  const catKey = options?.catKey || 'all';
  const sortMode: CommentsDashboardSort = options?.sort || 'recent';
  const reqPage = Math.max(0, options?.page || 0);

  const { comments: allComments, denuncias } = await fetchChannelCommentsAndDenunciasInPicta(
    chatId,
    effectivePubId > 0 ? effectivePubId : undefined,
    Boolean(options?.forceRefresh)
  ).catch(() => ({
    comments: [] as PictaCommentRecord[],
    denuncias: {
      cantidad_pendientes: 0,
      cantidad_en_proceso: 0,
      cantidad_no_proceden: 0,
      cantidad_procesadas: 0,
      total: 0,
    },
  }));

  // Compute dynamic categories breakdown across ALL fetched comments
  const categoryStats = new Map<string, { key: string; label: string; icon: string; count: number }>();
  let unansweredCount = 0;
  let repliesCount = 0;
  let rootCount = 0;

  for (const c of allComments) {
    if (c.parentId) {
      repliesCount++;
    } else {
      rootCount++;
      if (!c.replyCount || c.replyCount === 0) {
        unansweredCount++;
      }
    }
    const k = getCommentCatKey(c);
    const label = String(c.categoriaNombre || 'Otros').trim() || 'Otros';
    const existing = categoryStats.get(k);
    if (existing) {
      existing.count++;
    } else {
      categoryStats.set(k, {
        key: k,
        label,
        icon: getCategoryIconForComments(label),
        count: 1,
      });
    }
  }

  const sortedCategories = Array.from(categoryStats.values()).sort((a, b) => b.count - a.count);
  const isKnownDynamicCat = sortedCategories.some((x) => x.key === catKey);
  const effectiveCatKey =
    catKey === 'all' || catKey === 'unans' || catKey === 'rep' || isKnownDynamicCat
      ? catKey
      : 'all';

  // Filter according to selected category tab
  let filtered = allComments.filter((c) => {
    if (effectiveCatKey === 'all') return true;
    if (effectiveCatKey === 'unans') return !c.parentId && (!c.replyCount || c.replyCount === 0);
    if (effectiveCatKey === 'rep') return Boolean(c.parentId);
    return getCommentCatKey(c) === effectiveCatKey;
  });

  // Sort according to active sort mode
  filtered = [...filtered].sort((a, b) => {
    const tA = a.fecha ? new Date(a.fecha).getTime() : 0;
    const tB = b.fecha ? new Date(b.fecha).getTime() : 0;
    const vA = Number.isFinite(tA) && tA > 0 ? tA : a.id;
    const vB = Number.isFinite(tB) && tB > 0 ? tB : b.id;
    if (sortMode === 'oldest') {
      return vA !== vB ? vA - vB : a.id - b.id;
    }
    if (sortMode === 'video') {
      const cmp = a.publicacionNombre.localeCompare(b.publicacionNombre, 'es');
      if (cmp !== 0) return cmp;
      return vB !== vA ? vB - vA : b.id - a.id;
    }
    return vB !== vA ? vB - vA : b.id - a.id;
  });

  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(reqPage, totalPages - 1));
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  lastCommentsViewByChat.set(chatId, {
    catKey: effectiveCatKey,
    sort: sortMode,
    page: safePage,
    pubId: effectivePubId,
  });

  const activeCategoryObj = sortedCategories.find((x) => x.key === effectiveCatKey);
  const activeCategoryLabel =
    effectiveCatKey === 'all'
      ? '🌐 Todos'
      : effectiveCatKey === 'unans'
        ? '⏳ Sin Respuesta'
        : effectiveCatKey === 'rep'
          ? '↩️ Respuestas'
          : activeCategoryObj
            ? `${activeCategoryObj.icon} ${activeCategoryObj.label}`
            : '🌐 Todos';

  const sortLabels: Record<CommentsDashboardSort, string> = {
    recent: '🕒 Más Recientes',
    oldest: '🕰️ Más Antiguos',
    video: '🎬 Por Video',
  };

  const categoryBreakdownLine =
    sortedCategories.length > 0
      ? sortedCategories
          .slice(0, 12)
          .map((cat) => `${cat.icon} ${escapeHtml(cat.label)}: <b>${cat.count}</b>`)
          .join(' · ')
      : '<i>Sin categorías con comentarios</i>';

  const commentLines =
    pageItems.length > 0
      ? pageItems
          .map((c, idx) => {
            const rank = safePage * PAGE_SIZE + idx + 1;
            const catIcon = getCategoryIconForComments(c.categoriaNombre || 'Otros');
            const catLabel = escapeHtml(c.categoriaNombre || 'Otros');
            const statusBadge = c.parentId
              ? '↩️ <i>Respuesta</i>'
              : c.replyCount && c.replyCount > 0
                ? `✅ <i>${c.replyCount} resp.</i>`
                : '⏳ <i>Sin resp.</i>';
            const dateStr = c.fecha
              ? (() => {
                  try {
                    const d = new Date(c.fecha);
                    return isNaN(d.getTime())
                      ? c.fecha
                      : d.toLocaleString('es-CU', {
                          timeZone: 'America/Havana',
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        });
                  } catch {
                    return c.fecha;
                  }
                })()
              : `#${c.id}`;
            return (
              `<b>${rank}.</b> 👤 <code>@${escapeHtml(c.usuario)}</code> · ${statusBadge} · 📅 <code>${escapeHtml(dateStr)}</code>\n` +
              `   ${catIcon} <b>${catLabel}</b> · <i>${escapeHtml(c.publicacionNombre.slice(0, 34))}</i>\n` +
              `<blockquote>💬 "${escapeHtml(c.texto.slice(0, 170))}"</blockquote>`
            );
          })
          .join('\n\n')
      : effectiveCatKey === 'all'
        ? '<i>✨ No hay comentarios registrados en tu canal todavía.</i>'
        : `<i>✨ No hay comentarios en la categoría "${escapeHtml(activeCategoryLabel)}".</i>`;

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`DASHBOARD DE COMENTARIOS · ${ctx.channelName}`)}\n` +
    hudBox([
      `📺 <b>Canal:</b> ${escapeHtml(ctx.channelName)} · <code>#${escapeHtml(ctx.channelId)}</code>${
        effectivePubId > 0 ? ` · 🎬 <b>Video #${effectivePubId}</b>` : ''
      }`,
      `💬 <b>Total:</b> <b>${allComments.length}</b> · 🗣️ <b>Principales:</b> ${rootCount} · ⏳ <b>Sin resp.:</b> ${unansweredCount} · ↩️ <b>Resp.:</b> ${repliesCount}`,
      `🏷️ <b>Categorías:</b> ${categoryBreakdownLine}`,
      `🚨 <b>Denuncias:</b> Pendientes <code>${denuncias.cantidad_pendientes}</code> · En proceso <code>${denuncias.cantidad_en_proceso}</code> · Procesadas <code>${denuncias.cantidad_procesadas}</code>`,
    ]) +
    `\n${hudSection(`${activeCategoryLabel} · ${sortLabels[sortMode]} · Pág. ${safePage + 1}/${totalPages} (${filtered.length} mostrados)`)}\n\n` +
    `${commentLines}`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (effectivePubId > 0) {
    keyboard.push([
      {
        text: '✍️ Comentar en este Video',
        callback_data: `comment_reply_prompt:${effectivePubId}:0`,
      },
      {
        text: `🌐 Ver Todos del Canal`,
        callback_data: `cm_d:all:${sortMode}:0:0`,
      },
    ]);
  }

  // Row 1 of status categories
  keyboard.push([
    {
      text: `${effectiveCatKey === 'all' ? '✅ ' : ''}🌐 Todos (${allComments.length})`,
      callback_data: `cm_d:all:${sortMode}:0:${effectivePubId}`,
    },
    {
      text: `${effectiveCatKey === 'unans' ? '✅ ' : ''}⏳ Sin Resp. (${unansweredCount})`,
      callback_data: `cm_d:unans:${sortMode}:0:${effectivePubId}`,
    },
    {
      text: `${effectiveCatKey === 'rep' ? '✅ ' : ''}↩️ Respuestas (${repliesCount})`,
      callback_data: `cm_d:rep:${sortMode}:0:${effectivePubId}`,
    },
  ]);

  // Dynamic video category filter rows (2-3 buttons per row)
  if (sortedCategories.length > 0) {
    const catButtons = sortedCategories.slice(0, 12).map((cat) => ({
      text: `${effectiveCatKey === cat.key ? '✅ ' : ''}${cat.icon} ${cat.label.slice(0, 12)} (${cat.count})`,
      callback_data: `cm_d:${cat.key}:${sortMode}:0:${effectivePubId}`,
    }));
    for (let i = 0; i < catButtons.length; i += 3) {
      keyboard.push(catButtons.slice(i, i + 3));
    }
  }

  // Sort & refresh row
  keyboard.push([
    {
      text: `${sortMode === 'recent' ? '✅ ' : ''}🕒 Recientes`,
      callback_data: `cm_d:${effectiveCatKey}:recent:0:${effectivePubId}`,
    },
    {
      text: `${sortMode === 'oldest' ? '✅ ' : ''}🕰️ Antiguos`,
      callback_data: `cm_d:${effectiveCatKey}:oldest:0:${effectivePubId}`,
    },
    {
      text: `${sortMode === 'video' ? '✅ ' : ''}🎬 Por Video`,
      callback_data: `cm_d:${effectiveCatKey}:video:0:${effectivePubId}`,
    },
  ]);

  // Per-comment action buttons for ALL items on the current page
  pageItems.forEach((c, idx) => {
    const rank = safePage * PAGE_SIZE + idx + 1;
    keyboard.push([
      {
        text: `↩️ Responder #${rank} (@${c.usuario.slice(0, 12)})`,
        callback_data: `comment_reply_prompt:${c.publicacionId || effectivePubId || 0}:${c.id}`,
      },
      {
        text: `🗑️ Borrar #${rank}`,
        callback_data: `comment_del:${c.id}:${effectivePubId}`,
      },
    ]);
  });

  // Pagination controls
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      navRow.push({
        text: '⬅️ Anterior',
        callback_data: `cm_d:${effectiveCatKey}:${sortMode}:${safePage - 1}:${effectivePubId}`,
      });
    }
    navRow.push({
      text: `📄 ${safePage + 1} / ${totalPages}`,
      callback_data: `cm_r:${effectiveCatKey}:${sortMode}:${safePage}:${effectivePubId}`,
    });
    if (safePage < totalPages - 1) {
      navRow.push({
        text: 'Siguiente ➡️',
        callback_data: `cm_d:${effectiveCatKey}:${sortMode}:${safePage + 1}:${effectivePubId}`,
      });
    }
    keyboard.push(navRow);
  }

  keyboard.push([
    {
      text: '🔄 Actualizar Comentarios',
      callback_data: `cm_r:${effectiveCatKey}:${sortMode}:${safePage}:${effectivePubId}`,
    },
    effectivePubId > 0
      ? {
          text: '⬅️ Volver al Video',
          callback_data: `dash_pub:${effectivePubId}:views:0`,
        }
      : {
          text: '🏛️ Estudio /canal',
          callback_data: 'chan_editor:open',
        },
  ]);

  keyboard.push([{ text: '◈ Menú Principal', callback_data: 'cmd_start' }]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function downloadOnlineArtworkBuffer(url?: string): Promise<Buffer | null> {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) return null;
  try {
    const res = await fetch(cleanUrl);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    if (arr.byteLength <= 150) return null;
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

async function fetchTmdbSlotBuffersForTitle(
  rawTitle: string,
  tipId: number,
  parentSerieName?: string
): Promise<{
  portadaBuffer: Buffer | null;
  posterBuffer: Buffer | null;
  resolvedTitle: string;
}> {
  const query = cleanTitleForTmdbPosterSearch(rawTitle, parentSerieName) || rawTitle;
  const online = await searchMovieOrSeriesInfoOnline(query, tipId).catch(() => null);
  if (!online) {
    return { portadaBuffer: null, posterBuffer: null, resolvedTitle: query };
  }
  const portadaUrl = selectOnlineImageForSlot(online, 'portada');
  const posterUrl = selectOnlineImageForSlot(online, 'poster');

  const portadaBuffer = portadaUrl ? await downloadOnlineArtworkBuffer(portadaUrl) : null;
  let posterBuffer: Buffer | null = null;
  if (posterUrl && posterUrl === portadaUrl) {
    posterBuffer = portadaBuffer;
  } else if (posterUrl) {
    posterBuffer = await downloadOnlineArtworkBuffer(posterUrl);
  }
  return {
    portadaBuffer,
    posterBuffer,
    resolvedTitle: online.title || query,
  };
}

async function patchSerieInPictaChannel(
  chatId: string,
  pelserId: number,
  fields: {
    nombre?: string;
    sinopsis?: string;
    coverBuffer?: Buffer;
    portadaBuffer?: Buffer;
    posterBuffer?: Buffer;
  }
): Promise<void> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;

  const buildSeriePatchForm = () => {
    const form = new FormData();
    if (fields.nombre) {
      form.append('nombre', cleanSerieDisplayName(fields.nombre) || fields.nombre.trim());
    }
    if (fields.sinopsis) {
      form.append('sinopsis', sanitizePublicPictaText(fields.sinopsis));
    }
    if (fields.portadaBuffer) {
      form.append(
        'url_imagen',
        new Blob([new Uint8Array(fields.portadaBuffer)], { type: 'image/jpeg' }),
        `portada_serie_${pelserId}_${Date.now()}.jpg`
      );
    }
    const effectivePosterBuf = fields.posterBuffer || fields.coverBuffer;
    if (effectivePosterBuf) {
      form.append(
        'imagen_secundaria',
        new Blob([new Uint8Array(effectivePosterBuf)], { type: 'image/jpeg' }),
        `poster_serie_${pelserId}_${Date.now()}.jpg`
      );
    }
    return form;
  };

  let res = await fetchPictaWithRetry(
    `https://api.picta.cu/v1/serie/${encodeURIComponent(String(pelserId))}/`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: buildSeriePatchForm(),
    }
  );

  if (res.status === 401 || res.status === 403) {
    const freshToken =
      effectiveChatId === MASTER_ADMIN_CHAT_ID && !userSessions.has(effectiveChatId)
        ? await authenticateWithPicta(true)
        : await refreshUserPictaSession(effectiveChatId);
    res = await fetchPictaWithRetry(
      `https://api.picta.cu/v1/serie/${encodeURIComponent(String(pelserId))}/`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${freshToken}`,
          Origin: 'https://admin.picta.cu',
          Referer: 'https://admin.picta.cu/',
        },
        body: buildSeriePatchForm(),
      }
    );
  }

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }

  const rec = findUserChannelSerie(pelserId, effectiveChatId);
  if (rec) {
    if (fields.nombre) rec.nombre = cleanSerieDisplayName(fields.nombre) || fields.nombre.trim();
    saveChannelSeriesToDisk(channelSeriesCache);
  }
}

async function deleteSerieInPictaChannel(chatId: string, pelserId: number): Promise<void> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const isMaster = isMasterAdminChat(effectiveChatId);
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;

  const res = await fetchPictaWithRetry(
    `https://api.picta.cu/v1/serie/${encodeURIComponent(String(pelserId))}/`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    }
  );

  if (!res.ok && res.status !== 204) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }

  const targetChanNum = Number(ctx.channelId);
  const idx = channelSeriesCache.findIndex(
    (s) =>
      Number(s.pelser_id) === Number(pelserId) &&
      (Number(s.canal_id || 0) === targetChanNum || (isMaster && (!s.canal_id || Number(s.canal_id) === 36319)))
  );
  if (idx >= 0) {
    channelSeriesCache.splice(idx, 1);
    saveChannelSeriesToDisk(channelSeriesCache);
  }
}

async function searchOrCreatePictaPersonaInCatalog(
  chatId: string,
  nombre: string
): Promise<{ id: number; nombre: string; created: boolean }> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise;
  const clean = nombre.trim();
  if (!clean) throw new Error('Ingresa el nombre del actor o director.');

  const searchRes = await fetchPictaWithRetry(
    `https://api.picta.cu/v2/persona/?search=${encodeURIComponent(clean)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
      },
    }
  );
  if (searchRes.ok) {
    const sData = (await searchRes.json().catch(() => ({}))) as any;
    const exact = (sData.results || []).find(
      (p: any) => String(p.nombre || '').toLowerCase().trim() === clean.toLowerCase()
    );
    if (exact?.id) {
      return { id: Number(exact.id), nombre: String(exact.nombre), created: false };
    }
  }

  const createRes = await fetchPictaWithRetry('https://api.picta.cu/v1/persona/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: JSON.stringify({ nombre: clean }),
  });

  if (!createRes.ok) {
    const errTxt = await createRes.text();
    throw new Error(formatPictaError(createRes.status, errTxt));
  }
  const cObj = (await createRes.json().catch(() => ({}))) as any;
  return { id: Number(cObj.id || 0), nombre: String(cObj.nombre || clean), created: true };
}

async function searchOrCreatePictaKeywordInCatalog(
  chatId: string,
  palabra: string
): Promise<{ id: number; palabra: string; created: boolean }> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const ctx = getEffectivePictaContext(effectiveChatId);
  const token = await ctx.accessTokenPromise;
  const clean = palabra.trim().replace(/^#/, '');
  if (!clean) throw new Error('Ingresa una palabra clave o etiqueta.');

  const searchRes = await fetchPictaWithRetry(
    `https://api.picta.cu/v2/palabra_clave/?search=${encodeURIComponent(clean)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
      },
    }
  );
  if (searchRes.ok) {
    const sData = (await searchRes.json().catch(() => ({}))) as any;
    const exact = (sData.results || []).find(
      (p: any) => String(p.palabra || '').toLowerCase().trim() === clean.toLowerCase()
    );
    if (exact?.id) {
      return { id: Number(exact.id), palabra: String(exact.palabra), created: false };
    }
  }

  const createRes = await fetchPictaWithRetry('https://api.picta.cu/v1/palabra_clave/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: JSON.stringify({ palabra: clean }),
  });

  if (!createRes.ok) {
    const errTxt = await createRes.text();
    throw new Error(formatPictaError(createRes.status, errTxt));
  }
  const cObj = (await createRes.json().catch(() => ({}))) as any;
  return { id: Number(cObj.id || 0), palabra: String(cObj.palabra || clean), created: true };
}

async function sendOrEditPersonasAndTagsMenuInTelegram(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  pendingToolkitInputByChat.delete(chatId);
  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader('CATÁLOGO DE PERSONAS Y ETIQUETAS')}\n` +
    hudBox([
      `🎭 <b>Reparto y Dirección:</b> Registra o busca actores y directores vía API (<code>POST /v1/persona/</code>).`,
      `🏷️ <b>Palabras Clave:</b> Da de alta nuevas etiquetas de búsqueda (<code>POST /v1/palabra_clave/</code>).`,
    ]);

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '👤 Registrar / Buscar Actor o Director en Picta', callback_data: 'persona_create_prompt' }],
    [{ text: '🏷️ Registrar / Buscar Etiqueta (Palabra Clave)', callback_data: 'keyword_create_prompt' }],
    [{ text: '⬅️ Volver a /canal', callback_data: 'chan_editor:open' }],
  ];

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

interface ChannelCatalogSnapshot {
  fetchedAtMs: number;
  publications: any[];
  globalStats: PictaDashboardGlobalStats;
  channelSubscribers: number;
  channelSlugUrl?: string;
}

const channelCatalogSnapshotCache = new Map<string, ChannelCatalogSnapshot>();
const CHANNEL_CATALOG_CACHE_TTL_MS = 60 * 1000;

function invalidateChannelCatalogSnapshotCache(channelId?: string | number | null): void {
  if (!channelId) {
    channelCatalogSnapshotCache.clear();
    lastAuditReportCache.clear();
    return;
  }
  const prefix = `${String(channelId).trim()}:`;
  for (const key of channelCatalogSnapshotCache.keys()) {
    if (key.startsWith(prefix)) {
      channelCatalogSnapshotCache.delete(key);
    }
  }
  for (const key of lastAuditReportCache.keys()) {
    if (key.startsWith(prefix)) {
      lastAuditReportCache.delete(key);
    }
  }
}

async function fetchSinglePictaJsonWithAuthRetry(
  url: string,
  effectiveChatId: string,
  tokenRef: { token: string },
  isMaster: boolean
): Promise<{ ok: boolean; status: number; data: any | null }> {
  const buildHeaders = (t: string) => ({
    Authorization: `Bearer ${t}`,
    Origin: 'https://admin.picta.cu',
    Referer: 'https://admin.picta.cu/',
  });

  let res = await fetchPictaWithRetry(url, { headers: buildHeaders(tokenRef.token) });
  if (res.status === 401 || res.status === 403) {
    try {
      tokenRef.token =
        isMaster && !userSessions.has(effectiveChatId)
          ? await authenticateWithPicta(true)
          : await refreshUserPictaSession(effectiveChatId);
      res = await fetchPictaWithRetry(url, { headers: buildHeaders(tokenRef.token) });
    } catch {
      // Keep original response
    }
  }
  if (!res.ok) {
    return { ok: false, status: res.status, data: null };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data };
}

async function fetchPaginatedChannelEndpoint(
  baseUrl: string,
  channelId: string,
  effectiveChatId: string,
  tokenRef: { token: string },
  isMaster: boolean,
  strictChannelFilterCheck = false
): Promise<{ items: any[]; apiCount: number; ok: boolean; status: number; filterHonored: boolean }> {
  const page1 = await fetchSinglePictaJsonWithAuthRetry(baseUrl, effectiveChatId, tokenRef, isMaster);
  if (!page1.ok || !page1.data) {
    return { items: [], apiCount: 0, ok: false, status: page1.status, filterHonored: false };
  }

  const rawList1: any[] = Array.isArray(page1.data)
    ? page1.data
    : Array.isArray(page1.data?.results)
      ? page1.data.results
      : [];
  const targetNum = Number(channelId);

  if (strictChannelFilterCheck && targetNum > 0 && rawList1.length > 0) {
    const hasForeign = rawList1.some((item) => {
      const chId = Number(
        item?.canal_id ?? (typeof item?.canal === 'object' && item?.canal ? item.canal.id : item?.canal) ?? 0
      );
      return chId > 0 && chId !== targetNum;
    });
    if (hasForeign) {
      // Endpoint ignored ?canal_id / ?canal query filter -> abort pagination safely
      return { items: [], apiCount: 0, ok: true, status: page1.status, filterHonored: false };
    }
  }

  const allItems: any[] = [...rawList1];
  const reportedCount =
    typeof page1.data?.count === 'number' && page1.data.count >= 0
      ? Number(page1.data.count)
      : rawList1.length;

  const MAX_PAGES = 50;
  let nextUrl = parsePictaNextPageUrl(baseUrl, page1.data?.next, 1);

  // If Picta returns next=2 (integer or URL) and total count > page 1 size, fetch remaining pages in parallel batches
  if (nextUrl && rawList1.length > 0 && reportedCount > rawList1.length) {
    let usesNumericPage = false;
    let parsedNext: URL | null = null;
    try {
      parsedNext = new URL(nextUrl);
      usesNumericPage = parsedNext.searchParams.get('page') === '2';
    } catch {
      usesNumericPage = false;
    }

    if (usesNumericPage && parsedNext) {
      const totalPages = Math.min(MAX_PAGES, Math.ceil(reportedCount / rawList1.length));
      const CONCURRENCY = 4;
      for (let start = 2; start <= totalPages; start += CONCURRENCY) {
        const batchNums: number[] = [];
        for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) {
          batchNums.push(p);
        }
        const batchResponses = await Promise.all(
          batchNums.map((pageNum) => {
            const u = new URL(parsedNext!.toString());
            u.searchParams.set('page', String(pageNum));
            return fetchSinglePictaJsonWithAuthRetry(u.toString(), effectiveChatId, tokenRef, isMaster);
          })
        );
        let sawEmpty = false;
        for (const resp of batchResponses) {
          if (!resp.ok || !resp.data) continue;
          const batchItems: any[] = Array.isArray(resp.data)
            ? resp.data
            : Array.isArray(resp.data?.results)
              ? resp.data.results
              : [];
          if (batchItems.length === 0) {
            sawEmpty = true;
            continue;
          }
          allItems.push(...batchItems);
        }
        if (sawEmpty) break;
      }
      return { items: allItems, apiCount: reportedCount, ok: true, status: page1.status, filterHonored: true };
    }
  }

  // Fallback cursor / sequential pagination if `next` doesn't use ?page=2
  let pageCount = 1;
  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    const nextPage = await fetchSinglePictaJsonWithAuthRetry(nextUrl, effectiveChatId, tokenRef, isMaster);
    if (!nextPage.ok || !nextPage.data) break;
    const batchItems: any[] = Array.isArray(nextPage.data)
      ? nextPage.data
      : Array.isArray(nextPage.data?.results)
        ? nextPage.data.results
        : [];
    if (batchItems.length === 0) break;
    allItems.push(...batchItems);
    nextUrl = parsePictaNextPageUrl(baseUrl, nextPage.data?.next, pageCount);
  }

  return { items: allItems, apiCount: reportedCount, ok: true, status: page1.status, filterHonored: true };
}

async function fetchPictaResumenStatsForPeriod(
  effectiveChatId: string,
  tokenRef: { token: string },
  isMaster: boolean,
  period: PictaDashboardPeriod,
  cubaTodayStr: string
): Promise<PictaResumenSummary | null> {
  try {
    const range = getPictaDateRangeForPeriod(period, cubaTodayStr);
    const url = new URL('https://api.picta.cu/v2/resumen/datos/');
    if (range.dateGte && range.dateLte) {
      url.searchParams.set('date__gte', range.dateGte);
      url.searchParams.set('date__lte', range.dateLte);
    }
    const resp = await fetchSinglePictaJsonWithAuthRetry(
      url.toString(),
      effectiveChatId,
      tokenRef,
      isMaster
    );
    if (!resp.ok || !resp.data) return null;
    return extractPictaResumenMetrics(resp.data);
  } catch {
    return null;
  }
}

async function fetchPictaChannelCatalogSnapshot(
  chatId?: string,
  forceRefresh = false
): Promise<ChannelCatalogSnapshot> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const context = getEffectivePictaContext(effectiveChatId);
  if (!context.isLinked || !context.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }

  const isMaster = isMasterAdminChat(effectiveChatId);
  const channelId = context.channelId;
  const cacheKey = `${channelId}:${isMaster ? 'master' : effectiveChatId}`;

  if (!forceRefresh) {
    const cached = channelCatalogSnapshotCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAtMs < CHANNEL_CATALOG_CACHE_TTL_MS) {
      return cached;
    }
  }

  const token = await context.accessTokenPromise;
  const tokenRef = { token };
  ensureDailyQuotaReset();
  const cubaTodayStr = getTodayCubaDateStr();

  // Query Picta Web Admin endpoints in parallel:
  // 1. /v2/publicacion/?canal_id=... (paginated full catalog across ALL pages)
  // 2. /v1/publicacion/?canal_id=... (admin listing capturing hidden/converting videos)
  // 3. /v1/canal/{id}/ (authoritative cantidad_suscripciones, slug_url & channel meta)
  // 4. /v2/resumen/datos/ across all-time, 30d, 7d & today (exact admin.picta.cu/dashboard totals)
  const [
    v2Result,
    v1Result,
    channelDetails,
    webAdminAllTime,
    webAdminLast30d,
    webAdminLast7d,
    webAdminToday,
  ] = await Promise.all([
    fetchPaginatedChannelEndpoint(
      `https://api.picta.cu/v2/publicacion/?canal_id=${encodeURIComponent(channelId)}&page_size=100`,
      channelId,
      effectiveChatId,
      tokenRef,
      isMaster,
      false
    ),
    fetchPaginatedChannelEndpoint(
      `https://api.picta.cu/v1/publicacion/?canal_id=${encodeURIComponent(channelId)}&page_size=100`,
      channelId,
      effectiveChatId,
      tokenRef,
      isMaster,
      true
    ).catch(() => ({ items: [] as any[], apiCount: 0, ok: false, status: 0, filterHonored: false })),
    fetchPictaChannelDetails(effectiveChatId).catch(() => null),
    fetchPictaResumenStatsForPeriod(effectiveChatId, tokenRef, isMaster, 'all', cubaTodayStr),
    fetchPictaResumenStatsForPeriod(effectiveChatId, tokenRef, isMaster, '30d', cubaTodayStr),
    fetchPictaResumenStatsForPeriod(effectiveChatId, tokenRef, isMaster, '7d', cubaTodayStr),
    fetchPictaResumenStatsForPeriod(effectiveChatId, tokenRef, isMaster, 'today', cubaTodayStr),
  ]);

  let v1Final = v1Result;
  if (!v1Final.filterHonored && v1Final.items.length === 0) {
    v1Final = await fetchPaginatedChannelEndpoint(
      `https://api.picta.cu/v1/publicacion/?canal=${encodeURIComponent(channelId)}&page_size=100`,
      channelId,
      effectiveChatId,
      tokenRef,
      isMaster,
      true
    ).catch(() => ({ items: [] as any[], apiCount: 0, ok: false, status: 0, filterHonored: false }));
  }

  if (!v2Result.ok && !v1Final.ok) {
    throw new Error(`Error HTTP ${v2Result.status || v1Final.status || 500} al consultar estadísticas en Picta`);
  }

  const publications = mergeAndDedupeChannelPublications(
    [v2Result.items, v1Final.filterHonored ? v1Final.items : []],
    channelId
  );

  const reportedApiTotalCount = Math.max(
    v2Result.apiCount || 0,
    v1Final.filterHonored ? v1Final.apiCount || 0 : 0,
    channelDetails?.cantidad_publicaciones || 0
  );

  const dailyQuotaCapacity = isMaster
    ? (1 + quotaSettings.poolAccounts.filter((a) => a.canPublishDirectly !== false).length) * 10
    : 10;
  const quotaUsedToday = isMaster
    ? (quotaSettings.seriesUploadedToday || 0) + (quotaSettings.otherUploadedToday || 0)
    : transferJobs.filter(
        (j) =>
          j.telegramChatId === effectiveChatId &&
          j.stage === 'completed' &&
          toCubaDateStr(j.updatedAt || j.createdAt) === cubaTodayStr
      ).length;

  const channelSubscribers = Number(channelDetails?.cantidad_suscriptores || 0);
  const globalStats = computeGlobalChannelStats(publications, {
    reportedApiTotalCount,
    cubaTodayStr,
    dailyQuotaCapacity,
    quotaUsedToday,
    channelSubscribers,
    webAdminAllTime,
    webAdminLast30d,
    webAdminLast7d,
    webAdminToday,
  });

  const snapshot: ChannelCatalogSnapshot = {
    fetchedAtMs: Date.now(),
    publications,
    globalStats,
    channelSubscribers,
    ...(channelDetails?.slug_url ? { channelSlugUrl: channelDetails.slug_url } : {}),
  };
  channelCatalogSnapshotCache.set(cacheKey, snapshot);
  return snapshot;
}

async function fetchPictaChannelPublications(chatId?: string, forceRefresh = false): Promise<any[]> {
  const snapshot = await fetchPictaChannelCatalogSnapshot(chatId, forceRefresh);
  return snapshot.publications;
}

async function fetchSinglePictaPublicationDirect(pubId: number, chatId?: string): Promise<any | null> {
  try {
    const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
    const context = getEffectivePictaContext(effectiveChatId);
    if (!context.isLinked) return null;
    const token = await context.accessTokenPromise;
    const res = await fetchPictaWithRetry(`https://api.picta.cu/v1/publicacion/${pubId}/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function patchPictaPublicationInChannel(
  pubId: number,
  fields: Record<string, string>,
  files?: {
    coverBuffer?: Buffer;
    posterBuffer?: Buffer;
    subtitleBuffer?: Buffer;
    subtitleFileName?: string;
  },
  chatId?: string
): Promise<any> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const context = getEffectivePictaContext(effectiveChatId);
  const token = await context.accessTokenPromise;
  const form = new FormData();
  form.append('tipo', fields.tipo || 'publicacion');
  if (!fields.tipologia) {
    try {
      const pubs = await fetchPictaChannelPublications(effectiveChatId);
      const matchPub = pubs.find((p) => Number(p.id) === Number(pubId));
      const tipId = matchPub?.categoria?.tipologia?.id;
      if (tipId) {
        form.append('tipologia', String(tipId));
      }
    } catch {
      // Continue
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'tipo') continue;
    if (k === 'nombre' || k === 'descripcion' || k === 'sinopsis') {
      form.append(k, sanitizePublicPictaText(v));
    } else {
      form.append(k, v);
    }
  }
  if (files?.coverBuffer) {
    form.append(
      'url_imagen',
      new Blob([new Uint8Array(files.coverBuffer)], { type: 'image/jpeg' }),
      `cover_${pubId}_${Date.now()}.jpg`
    );
  }
  if (files?.posterBuffer) {
    form.append(
      'imagen_secundaria',
      new Blob([new Uint8Array(files.posterBuffer)], { type: 'image/jpeg' }),
      `poster_${pubId}_${Date.now()}.jpg`
    );
  }
  if (files?.subtitleBuffer) {
    const subName = (files.subtitleFileName || `subtitulos_${pubId}.srt`).replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    const subUrl = await uploadSubtitleBufferToMinioS3(token, files.subtitleBuffer, subName);
    if (subUrl) {
      form.append('url_subtitulo', subUrl);
    }
  }

  let res = await fetchPictaWithRetry(`https://api.picta.cu/v1/publicacion/${pubId}/`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
    body: form,
  });

  if (res.status === 401 || res.status === 403) {
    const freshToken =
      effectiveChatId === MASTER_ADMIN_CHAT_ID && !userSessions.has(effectiveChatId)
        ? await authenticateWithPicta(true)
        : await refreshUserPictaSession(effectiveChatId);
    res = await fetchPictaWithRetry(`https://api.picta.cu/v1/publicacion/${pubId}/`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${freshToken}`,
        Origin: 'https://admin.picta.cu',
        Referer: 'https://admin.picta.cu/',
      },
      body: form,
    });
  }

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(formatPictaError(res.status, errTxt));
  }
  invalidateChannelCatalogSnapshotCache(context.channelId);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { id: pubId };
  }
}

async function deletePictaPublicationInChannel(pubId: number, chatId?: string): Promise<void> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const context = getEffectivePictaContext(effectiveChatId);
  const token = await context.accessTokenPromise;
  const res = await fetchPictaWithRetry(`https://api.picta.cu/v1/publicacion/${pubId}/`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://admin.picta.cu',
      Referer: 'https://admin.picta.cu/',
    },
  });

  if (!res.ok && res.status !== 204) {
    // Fallback: unpublish (hide from channel) if Picta blocks hard delete on converted videos
    await patchPictaPublicationInChannel(pubId, { publicado: 'false' }, undefined, effectiveChatId);
  }
  invalidateChannelCatalogSnapshotCache(context.channelId);
}

async function createSerieInPictaChannelDirect(
  chatId: string,
  serieName: string,
  seasonNum = 1,
  customCoverFileId?: string
): Promise<{ pelserId: number; tempId: number; serieName: string; seasonNum: number }> {
  const effectiveChatId = chatId || MASTER_ADMIN_CHAT_ID;
  const isMaster = isMasterAdminChat(effectiveChatId);
  const ctx = getEffectivePictaContext(effectiveChatId);
  if (!ctx.isLinked || !ctx.channelId) {
    throw new Error('No has vinculado tu cuenta de Picta. Usa /login primero.');
  }
  const token = await ctx.accessTokenPromise;
  let coverBuf: Buffer | null = null;
  if (customCoverFileId) {
    coverBuf = await downloadTelegramThumbnailBuffer(customCoverFileId);
  }
  if (!coverBuf || coverBuf.byteLength < 100) {
    coverBuf = Buffer.from(FALLBACK_JPEG_BASE64, 'base64');
  }
  const cleanName = cleanSerieDisplayName(serieName) || 'Nueva Serie';
  const tempId = await ensureSerieAndTemporadaId(
    token,
    cleanName,
    seasonNum,
    { sinopsis: `Serie ${cleanName} disponible en el canal ${ctx.channelName}.` },
    coverBuf,
    ctx.channelId,
    ctx.channelName,
    isMaster
  );
  const scopedSeries = filterSeriesForChannel(channelSeriesCache, ctx.channelId, isMaster);
  const rec = scopedSeries.find(
    (s) => s.nombre.toLowerCase().trim() === cleanName.toLowerCase()
  );
  return {
    pelserId: rec?.pelser_id || tempId,
    tempId,
    serieName: rec?.nombre || cleanName,
    seasonNum,
  };
}

function buildCategorySelectionKeyboard(
  jobId: string
): Array<Array<{ text: string; callback_data: string }>> {
  return [
    [
      { text: '🎬 Película', callback_data: `cat:1:${jobId}` },
      { text: '📺 Serie', callback_data: `cat:5:${jobId}` },
    ],
    [
      { text: '📽️ Documental', callback_data: `cat:2:${jobId}` },
      { text: '📹 Audiovisual', callback_data: `cat:8:${jobId}` },
    ],
    [
      { text: '⚡ Shorts', callback_data: `cat:15:${jobId}` },
      { text: '😂 Humorístico', callback_data: `cat:19:${jobId}` },
    ],
    [
      { text: '🎵 Video Musical', callback_data: `cat:3:${jobId}` },
      { text: '🎶 Videoclip', callback_data: `cat:11:${jobId}` },
    ],
    [
      { text: '📚 Curso', callback_data: `cat:6:${jobId}` },
      { text: '⚽ Deporte', callback_data: `cat:14:${jobId}` },
    ],
    [
      { text: '📰 Informativo', callback_data: `cat:18:${jobId}` },
      { text: '🎭 Cultural', callback_data: `cat:17:${jobId}` },
    ],
    [
      { text: '📊 Dashboard Picta', callback_data: 'dash_refresh:views:0' },
      { text: '📺 Mis Series', callback_data: 'my_series:0' },
    ],
  ];
}

async function sendOrEditPictaDashboardInTelegram(
  chatId: string,
  messageId: number | null,
  sortMode: 'views' | 'plays' | 'likes' | 'downloads' | 'recent' = 'views',
  page = 0,
  replyToMessageId?: number,
  forceRefresh = false,
  period: PictaDashboardPeriod = 'all'
): Promise<void> {
  const ctx = getEffectivePictaContext(chatId);
  if (!ctx.isLinked || !ctx.channelId) {
    const unlinkedText =
      `${hudHeader('ESTADÍSTICAS · ACCESO REQUERIDO')}\n` +
      hudBox([
        `⚪ <b>Estado:</b> Sin canal vinculado en Picta`,
        `👉 Para consultar el Dashboard y editar tus videos, inicia sesión con /login.`,
      ]);
    const unlinkedKb = [
      [{ text: '🔑 Vincular mi cuenta de Picta (/login)', callback_data: 'user_picta_login_start' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, unlinkedText, unlinkedKb, true);
    } else {
      await sendTelegramStatusMessage(chatId, unlinkedText, replyToMessageId, unlinkedKb);
    }
    return;
  }

  try {
    const snapshot = await fetchPictaChannelCatalogSnapshot(chatId, forceRefresh);
    const pubs = snapshot.publications;
    const g = snapshot.globalStats;

    const sorted = [...pubs].sort((a, b) => {
      if (sortMode === 'views') return Number(b.cantidad_visitas || 0) - Number(a.cantidad_visitas || 0);
      if (sortMode === 'plays') return Number(b.cantidad_reproducciones || 0) - Number(a.cantidad_reproducciones || 0);
      if (sortMode === 'likes') return Number(b.cantidad_me_gusta || 0) - Number(a.cantidad_me_gusta || 0);
      if (sortMode === 'downloads') return Number(b.cantidad_descargas || 0) - Number(a.cantidad_descargas || 0);
      return new Date(b.fecha_publicado || b.fecha_creacion || 0).getTime() - new Date(a.fecha_publicado || a.fecha_creacion || 0).getTime();
    });

    const topViewed = g.topViewed;
    const topLiked = g.topLiked;

    const PAGE_SIZE = 6;
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const pageItems = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    const sortLabels: Record<string, string> = {
      views: '🔥 Más Vistos',
      plays: '▶️ Más Reproducidos',
      likes: '❤️ Más Likes',
      downloads: '📥 Más Descargados',
      recent: '🕒 Más Recientes',
    };

    const videoLines =
      pageItems.length > 0
        ? pageItems
            .map((p, idx) => {
              const rank = safePage * PAGE_SIZE + idx + 1;
              const v = Number(p.cantidad_visitas || 0).toLocaleString();
              const r = Number(p.cantidad_reproducciones || 0).toLocaleString();
              const l = Number(p.cantidad_me_gusta || 0).toLocaleString();
              const d = Number(p.cantidad_descargas || 0).toLocaleString();
              const visBadge = p.publicado === false ? '🙈 ' : '';
              const shortTitle = escapeHtml(String(p.nombre || 'Video').slice(0, 46));
              return (
                `<b>${rank}. ${visBadge}${shortTitle}</b>\n` +
                `   <code>👀 ${v}</code> · <code>▶️ ${r}</code> · <code>❤️ ${l}</code> · <code>📥 ${d}</code>`
              );
            })
            .join('\n\n')
        : '<i>No hay videos publicados aún en este canal.</i>';

    const videoExtraNotes: string[] = [];
    if (g.hiddenOrPendingCount > 0) {
      videoExtraNotes.push(`${g.publishedCount} pub. · ${g.hiddenOrPendingCount} ocultos/conv.`);
    }
    if (g.isPartialCatalog) {
      videoExtraNotes.push(`leídos ${g.fetchedVideos}/${g.totalVideos}`);
    }
    const videoExtraStr = videoExtraNotes.length > 0 ? ` <i>(${videoExtraNotes.join(' · ')})</i>` : '';
    const quotaNoteStr =
      g.quotaUsedToday > g.publishedToday
        ? ` <i>(cuota bot: ${g.quotaUsedToday}/${g.dailyCapacity})</i>`
        : '';

    const syncTimeCuba = new Date(snapshot.fetchedAtMs).toLocaleTimeString('es-CU', {
      timeZone: 'America/Havana',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const periodLabels: Record<PictaDashboardPeriod, string> = {
      all: 'Desde siempre',
      '30d': 'Último mes (Web Admin)',
      '7d': 'Últimos 7 días (Web Admin)',
      today: 'Hoy (Web Admin)',
    };
    const activePeriodSummary =
      period === '30d'
        ? g.webAdminLast30d
        : period === '7d'
          ? g.webAdminLast7d
          : period === 'today'
            ? g.webAdminToday
            : null;

    const summaryBoxLines =
      period !== 'all' && activePeriodSummary
        ? [
            `📅 <b>Periodo Web Admin:</b> ${periodLabels[period]}`,
            `🎬 <b>Publicaciones:</b> ${activePeriodSummary.publicadas.toLocaleString()} · 📅 <b>Hoy:</b> ${g.publishedToday}/${g.dailyCapacity}${quotaNoteStr}`,
            `👀 <b>Visitas:</b> ${activePeriodSummary.views.toLocaleString()} · ▶️ <b>Reprod.:</b> ${activePeriodSummary.plays.toLocaleString()}`,
            `❤️ <b>Likes:</b> ${activePeriodSummary.likes.toLocaleString()} · 📥 <b>Descargas:</b> ${activePeriodSummary.downloads.toLocaleString()}`,
            `💬 <b>Comentarios:</b> ${activePeriodSummary.comments.toLocaleString()}${g.channelSubscribers > 0 ? ` · 👥 <b>Subs:</b> ${g.channelSubscribers.toLocaleString()}` : ''}`,
            `🛰️ <b>Sync Web Admin:</b> <code>${syncTimeCuba}</code> · Catálogo total: <code>${g.totalVideos}</code>`,
          ]
        : [
            `🎬 <b>Videos:</b> ${g.totalVideos.toLocaleString()}${videoExtraStr} · 📅 <b>Hoy:</b> ${g.publishedToday}/${g.dailyCapacity}${quotaNoteStr}`,
            `👀 <b>Vistas:</b> ${g.totalViews.toLocaleString()} · ▶️ <b>Reprod.:</b> ${g.totalPlays.toLocaleString()}`,
            `❤️ <b>Likes:</b> ${g.totalLikes.toLocaleString()} · 📥 <b>Descargas:</b> ${g.totalDownloads.toLocaleString()}`,
            `💬 <b>Comentarios:</b> ${g.totalComments.toLocaleString()}${g.channelSubscribers > 0 ? ` · 👥 <b>Subs:</b> ${g.channelSubscribers.toLocaleString()}` : ''}`,
            g.webAdminLast30d
              ? `📆 <b>Último mes:</b> ${g.webAdminLast30d.publicadas} pub. · 👀 ${g.webAdminLast30d.views.toLocaleString()} · 📥 ${g.webAdminLast30d.downloads.toLocaleString()}`
              : undefined,
            `🛰️ <b>Sync Web Admin:</b> <code>${syncTimeCuba}</code> · Catálogo completo (<code>${g.fetchedVideos}</code>)`,
          ];

    const dashboardText =
      `${hudHeader(`TELEMETRÍA · ${ctx.channelName} #${ctx.channelId}`)}\n` +
      hudBox(summaryBoxLines) +
      (topViewed
        ? `\n🏆 <b>Top Vistas:</b> <i>${escapeHtml(String(topViewed.nombre).slice(0, 38))}</i> (<code>${Number(topViewed.cantidad_visitas || 0).toLocaleString()} 👀</code>)`
        : '') +
      (topLiked
        ? `\n💎 <b>Top Likes:</b> <i>${escapeHtml(String(topLiked.nombre).slice(0, 38))}</i> (<code>${Number(topLiked.cantidad_me_gusta || 0).toLocaleString()} ❤️</code>)`
        : '') +
      `\n\n${hudSection(`Catálogo · ${sortLabels[sortMode] || '🔥 Más Vistos'} · Pág. ${safePage + 1}/${totalPages}`)}\n\n` +
      `${videoLines}\n\n` +
      `👇 <i>Pulsa un botón <b>🛠️ #N</b> para editar título, sinopsis, portada, subtítulos o visibilidad:</i>`;

    const detailButtonsRow = pageItems.map((p, idx) => ({
      text: `🛠️ #${safePage * PAGE_SIZE + idx + 1}`,
      callback_data: `dash_pub:${p.id}:${sortMode}:${safePage}`,
    }));

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    if (detailButtonsRow.length > 0) {
      keyboard.push(detailButtonsRow);
    }

    keyboard.push([
      {
        text: period === 'all' ? '✅ ♾️ Todo' : '♾️ Todo',
        callback_data: `dash_period:all:${sortMode}:${safePage}`,
      },
      {
        text: period === '30d' ? '✅ 📅 Último mes' : '📅 Último mes',
        callback_data: `dash_period:30d:${sortMode}:${safePage}`,
      },
      {
        text: period === '7d' ? '✅ 📆 7 días' : '📆 7 días',
        callback_data: `dash_period:7d:${sortMode}:${safePage}`,
      },
      {
        text: period === 'today' ? '✅ 🗓️ Hoy' : '🗓️ Hoy',
        callback_data: `dash_period:today:${sortMode}:${safePage}`,
      },
    ]);

    keyboard.push([
      {
        text: sortMode === 'views' ? '✅ 🔥 Vistas' : '🔥 Vistas',
        callback_data: `dash_sort:views:0:${period}`,
      },
      {
        text: sortMode === 'plays' ? '✅ ▶️ Reprod.' : '▶️ Reprod.',
        callback_data: `dash_sort:plays:0:${period}`,
      },
      {
        text: sortMode === 'likes' ? '✅ ❤️ Likes' : '❤️ Likes',
        callback_data: `dash_sort:likes:0:${period}`,
      },
    ]);

    keyboard.push([
      {
        text: sortMode === 'downloads' ? '✅ 📥 Descargas' : '📥 Descargas',
        callback_data: `dash_sort:downloads:0:${period}`,
      },
      {
        text: sortMode === 'recent' ? '✅ 🕒 Recientes' : '🕒 Recientes',
        callback_data: `dash_sort:recent:0:${period}`,
      },
      {
        text: '🔄 Actualizar',
        callback_data: `dash_refresh:${sortMode}:${safePage}:${period}`,
      },
    ]);

    if (totalPages > 1) {
      const navRow: Array<{ text: string; callback_data: string }> = [];
      if (safePage > 0) {
        navRow.push({
          text: '⬅️ Anterior',
          callback_data: `dash_sort:${sortMode}:${safePage - 1}:${period}`,
        });
      }
      navRow.push({
        text: `📄 ${safePage + 1} / ${totalPages}`,
        callback_data: `dash_refresh:${sortMode}:${safePage}:${period}`,
      });
      if (safePage < totalPages - 1) {
        navRow.push({
          text: 'Siguiente ➡️',
          callback_data: `dash_sort:${sortMode}:${safePage + 1}:${period}`,
        });
      }
      keyboard.push(navRow);
    }

    keyboard.push([
      {
        text: `📺 Series en mi Canal (#${ctx.channelId})`,
        callback_data: 'my_series:0',
      },
      {
        text: '🏛️ Editar mi Canal (/canal)',
        callback_data: 'chan_editor:open',
      },
    ]);

    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, dashboardText, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, dashboardText, replyToMessageId, keyboard);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errText = `⚠️ <b>No se pudo cargar el Dashboard de Picta:</b>\n<code>${escapeHtml(msg)}</code>`;
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, errText, [
        [{ text: '🔄 Reintentar Dashboard', callback_data: `dash_refresh:views:0:${period}` }],
      ]);
    } else {
      await sendTelegramStatusMessage(chatId, errText, replyToMessageId, [
        [{ text: '🔄 Reintentar Dashboard', callback_data: `dash_refresh:views:0:${period}` }],
      ]);
    }
  }
}

async function sendOrEditPictaPubDetailInTelegram(
  chatId: string,
  messageId: number | null,
  pubId: number,
  returnSort: string,
  returnPage: number,
  bannerNotice?: string
): Promise<void> {
  try {
    pendingPubEditByChat.delete(chatId);
    const [directPub, pubs] = await Promise.all([
      fetchSinglePictaPublicationDirect(pubId, chatId),
      fetchPictaChannelPublications(chatId).catch(() => []),
    ]);
    const listMatch = pubs.find((item) => Number(item.id) === Number(pubId));
    let p = directPub ? { ...(listMatch || {}), ...directPub } : listMatch;

    // Fallback to user-scoped Serie chapter cache if Nomad is still converting (convertido: false)
    const chapterLookup = findUserChannelChapter(pubId, chatId);
    const localCap: ChannelChapterRecord | undefined = chapterLookup?.chapter;
    const parentSerie: ChannelSerieRecord | undefined = chapterLookup?.serie;

    if (!p && localCap) {
      p = {
        id: localCap.pubId,
        nombre: localCap.nombre,
        descripcion: localCap.descripcion || '',
        publicado: localCap.publicado !== false,
        convertido: Boolean(localCap.convertido),
        fecha_publicado: localCap.updatedAt,
        cantidad_visitas: 0,
        cantidad_reproducciones: 0,
        cantidad_me_gusta: 0,
        cantidad_no_me_gusta: 0,
        cantidad_descargas: 0,
        cantidad_comentarios: 0,
      };
    }

    if (!p) {
      if (returnSort.startsWith('serie_')) {
        const sPelserId = Number(returnSort.replace('serie_', ''));
        await sendOrEditSerieDetailInTelegram(chatId, messageId, sPelserId, returnPage);
      } else {
        await sendOrEditPictaDashboardInTelegram(chatId, messageId, returnSort as any, returnPage);
      }
      return;
    }

    const isFromSerieMenu = returnSort.startsWith('serie_');
    const returnPelserId = isFromSerieMenu ? Number(returnSort.replace('serie_', '')) : 0;
    const isSerieCap = Boolean(localCap || isFromSerieMenu || p?.categoria?.capitulo);

    const fechaRaw = p.fecha_publicado || p.fecha_creacion || '';
    const fechaFormatted = fechaRaw ? new Date(fechaRaw).toLocaleString('es-CU') : 'N/D';
    const hasSubs = Boolean(p.url_subtitulo || (Array.isArray(p.subtitulos) && p.subtitulos.length > 0));
    const isPublished = p.publicado !== false;
    const stateDesc = String(p.estado || '').trim();
    const rejectReason = String(p.motivo_rechazo || p.razon_rechazo || '').trim();
    const visibilityStatusLabel = isPublished
      ? '🟢 Publicado'
      : !p.fecha_publicado
        ? '⏳ Sin aprobar / No publicado'
        : '🙈 Oculto';

    const detailText =
      (bannerNotice ? `${bannerNotice}\n\n` : '') +
      `${hudHeader('FICHA DE VIDEO Y EDICIÓN DIRECTA')}\n` +
      hudBox([
        `📌 <b>Título:</b> ${escapeHtml(p.nombre || 'Sin título')}`,
        localCap
          ? `📺 <b>Serie:</b> ${escapeHtml(parentSerie?.nombre || 'Serie')} · <code>T${localCap.temporada}:E${String(localCap.numero).padStart(2, '0')}</code>`
          : undefined,
        `👁️ <b>Estado:</b> ${visibilityStatusLabel} · 🎞️ <b>Conversión:</b> ${p.convertido ? '✅ Convertido' : '⏳ Nomad'}`,
        stateDesc ? `📋 <b>Moderación / Estado Picta:</b> ${escapeHtml(stateDesc)}` : undefined,
        rejectReason ? `🚫 <b>Motivo Picta:</b> ${escapeHtml(rejectReason)}` : undefined,
        `📅 <b>Fecha:</b> ${escapeHtml(fechaFormatted)}`,
        `🖼️ <b>Portada:</b> ${p.url_imagen ? '✅ Activa' : '⚪ Vacía'} · 🎞️ <b>Póster:</b> ${p.imagen_secundaria ? '✅ Activo' : '⚪ Vacío'}`,
        `💬 <b>Subtítulos:</b> ${hasSubs ? '✅ Incluidos' : 'Sin subtítulos externos'}`,
      ]) +
      `\n${hudSection('Métricas en Tiempo Real')}\n` +
      hudBox([
        `👀 <b>Vistas:</b> <code>${Number(p.cantidad_visitas || 0).toLocaleString()}</code> · ▶️ <b>Reprod.:</b> <code>${Number(p.cantidad_reproducciones || 0).toLocaleString()}</code>`,
        `❤️ <b>Likes:</b> <code>${Number(p.cantidad_me_gusta || 0).toLocaleString()}</code> · 📥 <b>Descargas:</b> <code>${Number(p.cantidad_descargas || 0).toLocaleString()}</code>`,
      ]) +
      `\n${hudSection('Descripción Actual')}\n` +
      `<blockquote><i>${escapeHtml(sanitizePublicPictaText(String(p.descripcion || 'Sin descripción')).slice(0, 320))}</i></blockquote>\n` +
      `🛠️ <b>Controles directos por API:</b>`;

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [
        {
          text: '✏️ Cambiar Título',
          callback_data: `pub_edit:title:${p.id}:${returnSort}:${returnPage}`,
        },
        {
          text: '📝 Cambiar Descripción',
          callback_data: `pub_edit:desc:${p.id}:${returnSort}:${returnPage}`,
        },
      ],
      [
        {
          text: '🖼️ Cambiar Portada',
          callback_data: `pub_edit:cover:${p.id}:${returnSort}:${returnPage}`,
        },
        {
          text: '🎞️ Cambiar Póster',
          callback_data: `pub_edit:poster:${p.id}:${returnSort}:${returnPage}`,
        },
      ],
      [
        {
          text: '💬 Añadir Subtítulos (.srt)',
          callback_data: `pub_edit:subs:${p.id}:${returnSort}:${returnPage}`,
        },
      ],
    ];

    if (isSerieCap) {
      keyboard.push([
        {
          text: '🔢 Cambiar Nº Capítulo o Temporada',
          callback_data: `pub_edit:epnum:${p.id}:${returnSort}:${returnPage}`,
        },
      ]);
    }

    const allowDl = p.descarga !== false;
    keyboard.push(
      [
        {
          text: allowDl ? '📥 Descarga: Permitida (Bloquear)' : '🔒 Descarga: Bloqueada (Permitir)',
          callback_data: `pub_toggle_dl:${p.id}:${returnSort}:${returnPage}`,
        },
        {
          text: '🏷️ Editar Etiquetas',
          callback_data: `pub_edit:tags:${p.id}:${returnSort}:${returnPage}`,
        },
      ],
      [
        {
          text: '🚪 Descarga Directa (Puerta Trasera)',
          callback_data: `pub_direct_dl:${p.id}`,
        },
        {
          text: '📂 Añadir a Lista',
          callback_data: `pub_add_playlist_pick:${p.id}:${returnSort}:${returnPage}`,
        },
      ],
      [
        {
          text: '💬 Comentarios de este Video',
          callback_data: `comments_menu:${p.id}`,
        },
      ],
      [
        {
          text: isPublished ? '🙈 Ocultar en mi Canal' : '🟢 Publicar en mi Canal',
          callback_data: `pub_toggle_vis:${p.id}:${returnSort}:${returnPage}`,
        },
        {
          text: '🗑️ Eliminar Capítulo/Video',
          callback_data: `pub_del_ask:${p.id}:${returnSort}:${returnPage}`,
        },
      ],
      [
        {
          text: '🔄 Actualizar',
          callback_data: `dash_pub:${p.id}:${returnSort}:${returnPage}`,
        },
        isFromSerieMenu
          ? {
              text: '⬅️ Volver a Capítulos de la Serie',
              callback_data: `serie_manage:${returnPelserId}:${returnPage}`,
            }
          : {
              text: '⬅️ Volver al Dashboard',
              callback_data: `dash_sort:${returnSort}:${returnPage}`,
            },
      ]
    );

    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, detailText, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, detailText, undefined, keyboard);
    }
  } catch {
    if (returnSort.startsWith('serie_')) {
      const sPelserId = Number(returnSort.replace('serie_', ''));
      await sendOrEditSerieDetailInTelegram(chatId, messageId, sPelserId, returnPage);
    } else {
      await sendOrEditPictaDashboardInTelegram(chatId, messageId, returnSort as any, returnPage);
    }
  }
}

async function sendOrEditSerieDetailInTelegram(
  chatId: string,
  messageId: number | null,
  pelserId: number,
  page = 0,
  notice?: string
): Promise<void> {
  pendingPubEditByChat.delete(chatId);
  const isMaster = isMasterAdminChat(chatId);
  const seriesList = await syncAndGetChannelSeries(chatId);
  const serie =
    seriesList.find((s) => Number(s.pelser_id) === Number(pelserId)) || seriesList[0];

  if (!serie) {
    await sendOrEditMyChannelSeriesMenu(chatId, messageId);
    return;
  }

  const cleanSName = cleanSerieDisplayName(serie.nombre) || serie.nombre;
  const chapters = [...(serie.chapters || [])].sort((a, b) =>
    a.temporada !== b.temporada ? a.temporada - b.temporada : a.numero - b.numero
  );

  const seasonsStr =
    serie.seasons.length > 0
      ? serie.seasons.map((st) => `Temporada ${st.numero}`).join(', ')
      : 'Temporada 1';

  const pinned = pinnedBatchSerieByChat.get(chatId);
  const isPinned =
    pinned &&
    (Number(pinned.pelserId) === Number(serie.pelser_id) ||
      cleanSerieDisplayName(pinned.serieName).toLowerCase() === cleanSName.toLowerCase());

  // Check if there are any pending/cancelled/failed jobs for this serie belonging to this user
  const pendingSerieJobs = transferJobs.filter(
    (j) =>
      (isMaster || j.telegramChatId === chatId) &&
      j.tipologiaId === 5 &&
      j.stage !== 'completed' &&
      (Number(j.modelMetadata?.serie_pelser_id) === Number(serie.pelser_id) ||
        cleanSerieDisplayName(String(j.modelMetadata?.serie || j.title))
          .toLowerCase()
          .includes(cleanSName.toLowerCase()))
  );

  const PAGE_SIZE = 6;
  const totalPages = Math.max(1, Math.ceil(chapters.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageChapters = chapters.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const chapterLines =
    pageChapters.length > 0
      ? pageChapters
          .map((c) => {
            const epTag = `T${c.temporada}:E${String(c.numero).padStart(2, '0')}`;
            const statusIcon = c.publicado === false ? '🙈 Oculto' : '🟢 Publicado';
            const convIcon = c.convertido === false ? ' · ⏳ Nomad' : '';
            return (
              `• <b>${epTag}</b> — ${escapeHtml(c.nombre)}\n` +
              `   └ ${statusIcon}${convIcon}`
            );
          })
          .join('\n\n')
      : '<i>Aún no hay capítulos registrados en esta serie. Activa el 📌 Modo Serie Fija abajo y envía tus capítulos.</i>';

  const pendingLines =
    pendingSerieJobs.length > 0
      ? `\n\n⚡ <b>Capítulos en proceso / pendientes de reanudar (${pendingSerieJobs.length}):</b>\n` +
        pendingSerieJobs
          .slice(0, 3)
          .map(
            (pj) =>
              `• ⏳ <b>${escapeHtml(pj.title)}</b> — <i>${
                pj.stage === 'downloading_mtproto'
                  ? 'Descargando MTProto'
                  : pj.stage === 'queued'
                    ? 'En cola'
                    : 'Listo para reanudar'
              }</i>`
          )
          .join('\n')
      : '';

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`GESTOR DE SERIE · ${cleanSName}`)}\n` +
    hudBox([
      `📁 <b>Temporadas:</b> ${escapeHtml(seasonsStr)}`,
      `🎞️ <b>Capítulos subidos:</b> <b>${chapters.length}</b> capítulo(s)`,
      `📌 <b>Modo Serie Fija:</b> ${isPinned ? `🟢 <b>ACTIVO (T${pinned?.seasonNum})</b>` : '⚪ Inactivo'}`,
    ]) +
    `\n${hudSection(`Capítulos Subidos (Pág. ${safePage + 1}/${totalPages})`)}\n\n` +
    `${chapterLines}` +
    `${pendingLines}\n\n` +
    `👇 <i>Pulsa sobre cualquier capítulo para editar sus datos, renumerarlo o eliminarlo:</i>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const c of pageChapters) {
    const epTag = `T${c.temporada}:E${String(c.numero).padStart(2, '0')}`;
    keyboard.push([
      {
        text: `🛠️ Editar ${epTag}`,
        callback_data: `dash_pub:${c.pubId}:serie_${serie.pelser_id}:${safePage}`,
      },
      {
        text: `🔢 Nº ${epTag}`,
        callback_data: `pub_edit:epnum:${c.pubId}:serie_${serie.pelser_id}:${safePage}`,
      },
      {
        text: `🗑️ Borrar`,
        callback_data: `pub_del_ask:${c.pubId}:serie_${serie.pelser_id}:${safePage}`,
      },
    ]);
  }

  for (const pj of pendingSerieJobs.slice(0, 2)) {
    if (pj.stage === 'cancelled' || pj.stage === 'failed') {
      keyboard.push([
        {
          text: `🔄 Reanudar Subida: "${pj.title.slice(0, 28)}"`,
          callback_data: `retry:${pj.id}`,
        },
      ]);
    }
  }

  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (safePage > 0) {
      navRow.push({
        text: '⬅️ Anterior',
        callback_data: `serie_manage:${serie.pelser_id}:${safePage - 1}`,
      });
    }
    navRow.push({
      text: `📄 ${safePage + 1}/${totalPages}`,
      callback_data: `serie_manage:${serie.pelser_id}:${safePage}`,
    });
    if (safePage < totalPages - 1) {
      navRow.push({
        text: 'Siguiente ➡️',
        callback_data: `serie_manage:${serie.pelser_id}:${safePage + 1}`,
      });
    }
    keyboard.push(navRow);
  }

  const maxSeason = serie.seasons.reduce((acc, st) => Math.max(acc, Number(st.numero || 1)), 1);
  const activeSeasonObj =
    serie.seasons.find((st) => Number(st.numero) === maxSeason) || serie.seasons[0];
  const nextSeason = maxSeason + 1;

  keyboard.push([
    {
      text: isPinned
        ? `🟢 Serie Fija Activa (T${maxSeason}) · Desactivar`
        : `📌 Activar Modo Serie Fija (${cleanSName.slice(0, 14)} T${maxSeason})`,
      callback_data: isPinned
        ? 'unpin_serie'
        : `pin_serie:${serie.pelser_id}:${maxSeason}:${activeSeasonObj?.id || 0}`,
    },
  ]);

  keyboard.push([
    {
      text: '✏️ Nombre Serie',
      callback_data: `serie_meta_edit:name:${serie.pelser_id}`,
    },
    {
      text: '📝 Sinopsis Serie',
      callback_data: `serie_meta_edit:synopsis:${serie.pelser_id}`,
    },
  ]);

  keyboard.push([
    {
      text: '🖼️ Portada Serie',
      callback_data: `serie_meta_edit:portada:${serie.pelser_id}`,
    },
    {
      text: '🎞️ Póster Serie',
      callback_data: `serie_meta_edit:poster:${serie.pelser_id}`,
    },
  ]);

  keyboard.push([
    {
      text: `➕ Crear Temporada ${nextSeason}`,
      callback_data: `standalone_season_create:${serie.pelser_id}:${nextSeason}`,
    },
    {
      text: '🗑️ Eliminar Serie',
      callback_data: `serie_del_ask:${serie.pelser_id}`,
    },
  ]);

  keyboard.push([
    {
      text: '⬅️ Volver a Mis Series',
      callback_data: 'my_series:0',
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, undefined, keyboard);
  }
}

async function sendOrEditMyChannelSeriesMenu(
  chatId: string,
  messageId: number | null,
  replyToMessageId?: number,
  notice?: string
): Promise<void> {
  pendingStandaloneSerieByChat.delete(chatId);
  const isMaster = isMasterAdminChat(chatId);
  let session = userSessions.get(chatId);
  if (!isMaster && session && !session.channelId) {
    await ensureGuestSessionChannelDiscovered(chatId).catch(() => null);
    session = userSessions.get(chatId);
  }
  if (!isMaster && !session?.channelId) {
    const text =
      `${hudHeader('SERIES · ACCESO REQUERIDO')}\n` +
      hudBox([
        `🔒 <b>Estado:</b> Cuenta de Picta sin vincular`,
        `👉 Usa /login para gestionar las series y capítulos de tu canal.`,
      ]);
    const keyboard = [
      [{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'cmd_login' }],
      [{ text: '◈ Menú Principal', callback_data: 'cmd_start' }],
    ];
    if (messageId) {
      await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
    } else {
      await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
    }
    return;
  }

  const ctx = getEffectivePictaContext(chatId);
  const seriesList = await syncAndGetChannelSeries(chatId);

  const serieLines =
    seriesList.length > 0
      ? seriesList
          .slice(0, 12)
          .map((s, idx) => {
            const cleanSName = cleanSerieDisplayName(s.nombre) || s.nombre;
            const seasonsStr =
              s.seasons.length > 0
                ? s.seasons.map((st) => `T${st.numero}`).join(', ')
                : 'T1';
            const caps = [...(s.chapters || [])].sort((a, b) =>
              a.temporada !== b.temporada ? a.temporada - b.temporada : a.numero - b.numero
            );
            const capsBadge =
              caps.length > 0
                ? `<b>${caps.length}</b> subido(s) (${caps.map((c) => `E${String(c.numero).padStart(2, '0')}`).join(', ')})`
                : '0 capítulos subidos';
            return (
              `<b>${idx + 1}. 📺 ${escapeHtml(cleanSName)}</b>\n` +
              `   ├ 📁 Temporadas: <b>${seasonsStr}</b>\n` +
              `   └ 🎞️ Capítulos: ${capsBadge}`
            );
          })
          .join('\n\n')
      : '<i>Aún no hay series registradas. Pulsa el botón de abajo para crear una nueva serie en tu canal en 1 clic.</i>';

  const pinned = pinnedBatchSerieByChat.get(chatId);
  const pinnedBanner = pinned
    ? hudBox([
        `📌 <b>Modo Serie Fija ACTIVO:</b> ${escapeHtml(cleanSerieDisplayName(pinned.serieName))} · <code>T${escapeHtml(pinned.seasonNum)}</code>`,
        `<i>Cualquier video enviado ahora se subirá en ráfaga automática sin preguntas.</i>`,
      ]) + '\n'
    : '';

  const text =
    (notice ? `${notice}\n\n` : '') +
    `${hudHeader(`SERIES Y CAPÍTULOS · ${ctx.channelName || 'MI CANAL'}`)}\n` +
    hudBox([
      `📺 <b>Canal:</b> ${escapeHtml(ctx.channelName || 'Mi Canal')} · <b>${seriesList.length}</b> serie(s)`,
      `⚡ Toca una serie para ver/editar capítulos o activa el <b>Modo Ráfaga</b>.`,
    ]) +
    `\n${pinnedBanner}` +
    `${hudSection('Catálogo de Series')}\n` +
    `${serieLines}\n\n` +
    `👇 <i>Selecciona una serie para administrarla o fijarla:</i>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  for (const s of seriesList.slice(0, 8)) {
    const cleanSName = cleanSerieDisplayName(s.nombre) || s.nombre;
    const capCount = (s.chapters || []).length;
    const maxSeason = s.seasons.reduce((acc, st) => Math.max(acc, Number(st.numero || 1)), 1);
    const activeSeasonObj =
      s.seasons.find((st) => Number(st.numero) === maxSeason) || s.seasons[0];
    const isPinned =
      pinned &&
      (Number(pinned.pelserId) === Number(s.pelser_id) ||
        cleanSerieDisplayName(pinned.serieName).toLowerCase() === cleanSName.toLowerCase());

    keyboard.push([
      {
        text: `📂 ${cleanSName.slice(0, 16)}: Ver Capítulos (${capCount})`,
        callback_data: `serie_manage:${s.pelser_id}:0`,
      },
      {
        text: `${isPinned ? '🟢 Fijada' : '📌 Fijar Ráfaga'} (T${maxSeason})`,
        callback_data: `pin_serie:${s.pelser_id}:${maxSeason}:${activeSeasonObj?.id || 0}`,
      },
    ]);
  }

  keyboard.push([
    {
      text: '➕ Crear Nueva Serie en mi Canal',
      callback_data: 'standalone_serie_new',
    },
  ]);

  if (pinned) {
    keyboard.push([
      {
        text: `🔓 Desactivar Modo Serie Fija (${cleanSerieDisplayName(pinned.serieName).slice(0, 18)} T${pinned.seasonNum})`,
        callback_data: 'unpin_serie',
      },
    ]);
  }

  keyboard.push([
    { text: '📋 Ver Cola (/cola)', callback_data: 'queue_view' },
    { text: '📊 Ir al Dashboard', callback_data: 'dash_refresh:views:0' },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    await sendTelegramStatusMessage(chatId, text, replyToMessageId, keyboard);
  }
}

async function promptSeriesSelectionForJob(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  job.stage = 'awaiting_series_selection';
  job.tipologiaId = 5;
  job.category = 'Serie';
  job.updatedAt = new Date().toISOString();
  pendingManualTitleByChat.set(chatId, job.id);
  currentActivity = `Seleccionando Serie del canal para "${job.fileName}"`;
  saveJobsToDisk();

  const serieInfo = extractSeriesInfoFromText(job.fileName, job.caption);
  const existingMeta = job.modelMetadata || {};
  const existingSerieStr = String(existingMeta.serie || '');
  const detectedName = String(
    !serieInfo.missingSerieName
      ? serieInfo.serieName
      : !isGenericOrInvalidSerieName(existingSerieStr)
        ? existingSerieStr
        : ''
  );
  const detectedTemp = String(serieInfo.temporada || existingMeta.temporada || '1');
  const detectedEp = String(serieInfo.numero || existingMeta.numero || '1');
  const detectedSub = String(serieInfo.episodeSubtitle || existingMeta.episodeSubtitle || '').trim();

  job.modelMetadata = {
    ...existingMeta,
    ...(detectedName ? { serie: detectedName } : {}),
    temporada: String(detectedTemp),
    numero: String(detectedEp),
    ...(detectedSub ? { episodeSubtitle: detectedSub } : {}),
  };
  if (detectedName) {
    job.title = formatSerieEpisodeTitle(detectedName, detectedTemp, detectedEp, detectedSub);
  }
  const ctx = getEffectivePictaContext(chatId);
  const targetChName = job.targetChannelName || ctx.channelName || 'Mi Canal';
  const targetChId = job.targetChannelId || ctx.channelId || '';

  if (isStaleOrGenericSerieSynopsis(job.synopsis, job.caption, detectedEp)) {
    job.synopsis = detectedName
      ? `Capítulo ${detectedEp} de la Temporada ${detectedTemp} de la serie ${cleanSerieDisplayName(detectedName)}${detectedSub ? ` titulado "${detectedSub}"` : ''}, disponible en el canal ${targetChName}.`
      : '';
  }
  saveJobsToDisk();

  const channelSeries = await syncAndGetChannelSeries(chatId);

  // Sort channel series so any matching detectedName appears first
  const sortedSeries = [...channelSeries].sort((a, b) => {
    if (!detectedName) return 0;
    const aMatch = a.nombre.toLowerCase().includes(detectedName.toLowerCase()) ? 1 : 0;
    const bMatch = b.nombre.toLowerCase().includes(detectedName.toLowerCase()) ? 1 : 0;
    return bMatch - aMatch;
  });

  const exactChannelMatch = detectedName
    ? sortedSeries.find(
        (s) => s.nombre.toLowerCase().trim() === detectedName.toLowerCase().trim()
      )
    : undefined;

  const chTag = targetChId ? `${targetChName} (#${targetChId})` : targetChName;
  const text =
    `${hudHeader(`SELECCIONAR O CREAR SERIE · ${chTag}`)}\n` +
    hudBox([
      `📄 <b>Archivo:</b> <code>${escapeHtml(job.fileName)}</code>`,
      `🤖 <b>Detectado:</b> ${detectedName ? `<b>${escapeHtml(detectedName)}</b> · ` : '<i>Sin nombre en archivo</i> · '}<code>T${detectedTemp}:E${String(detectedEp).padStart(2, '0')}</code>`,
      serieInfo.episodeSubtitle ? `🏷️ <b>Título cap.:</b> <i>${escapeHtml(serieInfo.episodeSubtitle)}</i>` : undefined,
    ]) +
    `\n📂 <b>Elige una Serie de tu canal${targetChId ? ` (#${escapeHtml(targetChId)})` : ''}</b> o crea una nueva:`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  // 1. If detected serie doesn't exist yet in channel, offer prominent 1-click creation button
  if (detectedName && !exactChannelMatch) {
    keyboard.push([
      {
        text: `➕ Crear serie "${detectedName.slice(0, 24)}" en mi canal (1 clic)`,
        callback_data: `serie_create_auto:${job.id}`,
      },
    ]);
  }

  // 2. List existing series in user's channel
  for (const s of sortedSeries.slice(0, 8)) {
    const isMatched =
      detectedName && s.nombre.toLowerCase().includes(detectedName.toLowerCase());
    const seasonsBadge =
      s.seasons.length > 0 ? ` (${s.seasons.map((st) => `T${st.numero}`).join(',')})` : '';
    keyboard.push([
      {
        text: `${isMatched ? '⭐ ' : '📺 '}${s.nombre.slice(0, 28)}${seasonsBadge}`,
        callback_data: `serie_pick:${s.pelser_id}:${job.id}`,
      },
    ]);
  }

  // 3. Button to create a brand new serie by typing its name
  keyboard.push([
    {
      text: '✍️ Crear Nueva Serie en mi Canal (Escribir nombre)',
      callback_data: `serie_create_new:${job.id}`,
    },
  ]);

  keyboard.push([
    {
      text: '⬅️ Cambiar Categoría',
      callback_data: `back_cats:${job.id}`,
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function promptSeasonSelectionForJob(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null,
  pelserId: number,
  serieName: string,
  bannerNotice?: string
): Promise<void> {
  job.stage = 'awaiting_season_selection';
  const meta = job.modelMetadata || {};
  const serieInfo = extractSeriesInfoFromText(job.fileName, job.caption);
  const tempNum = String(meta.temporada || serieInfo.temporada || '1').replace(/\D/g, '') || '1';
  const epNum = String(meta.numero || serieInfo.numero || '1').replace(/\D/g, '') || '1';
  const epSub = String(meta.episodeSubtitle || serieInfo.episodeSubtitle || '').trim();

  const inheritedStyle = resolveSeriesStyleForChannel(chatId, pelserId, serieName);
  job.modelMetadata = {
    ...meta,
    serie: serieName,
    serie_pelser_id: String(pelserId),
    temporada: tempNum,
    numero: epNum,
    ...(epSub ? { episodeSubtitle: epSub } : {}),
  };
  delete job.modelMetadata.needsManualTitle;
  job.title = inheritedStyle
    ? formatEpisodeWithSeriesStyle(inheritedStyle, {
        serieName,
        temporada: tempNum,
        numero: epNum,
        episodeSubtitle: epSub,
      })
    : formatSerieEpisodeTitle(serieName, tempNum, epNum, epSub);
  const ctx = getEffectivePictaContext(chatId);
  const targetChName = job.targetChannelName || ctx.channelName || 'Mi Canal';
  const targetChId = job.targetChannelId || ctx.channelId || '';
  if (isStaleOrGenericSerieSynopsis(job.synopsis, job.caption, epNum)) {
    job.synopsis = `Capítulo ${epNum} de la Temporada ${tempNum} de la serie ${cleanSerieDisplayName(serieName)}${epSub ? ` titulado "${epSub}"` : ''}, disponible en el canal ${targetChName}.`;
  }
  job.updatedAt = new Date().toISOString();
  pendingManualTitleByChat.set(chatId, job.id);
  currentActivity = `Confirmando Temporada y Capítulo para "${serieName}"`;
  saveJobsToDisk();

  const serieRecord = findUserChannelSerie(pelserId, chatId) ||
    filterSeriesForChannel(channelSeriesCache, targetChId, isMasterAdminChat(chatId)).find(
      (s) => s.nombre.toLowerCase().trim() === serieName.toLowerCase().trim()
    );
  const existingSeasons = serieRecord?.seasons || [];
  const maxSeason = existingSeasons.reduce((acc, s) => Math.max(acc, Number(s.numero || 1)), Number(tempNum) || 1);
  const nextSeason = maxSeason + 1;

  const text =
    (bannerNotice ? `${bannerNotice}\n\n` : '') +
    `${hudHeader(`SERIE SELECCIONADA · ${serieName}`)}\n` +
    hudBox([
      `🏛️ <b>Canal:</b> ${escapeHtml(targetChName)}${targetChId ? ` · <code>#${escapeHtml(targetChId)}</code>` : ''}`,
      `🆔 <b>ID Serie Picta:</b> <code>${pelserId}</code>`,
      `📁 <b>Temporada detectada:</b> Temporada ${tempNum} · 🎞️ <b>Capítulo:</b> ${epNum}`,
      inheritedStyle
        ? `🎨 <b>Formato heredado (${inheritedStyle.sampleCount} caps):</b> <code>${escapeHtml(inheritedStyle.description)}</code>`
        : undefined,
      `📌 <b>Título final:</b> <code>${escapeHtml(job.title)}</code>`,
    ]) +
    `\n👇 <b>Confirma con 1 clic</b>, elige otra temporada o <b>escribe en el chat <code>Temporada | Capítulo</code></b> (ej: <code>${tempNum} | ${epNum}</code>):`;

  const matchedSeasonObj = existingSeasons.find((st) => Number(st.numero) === Number(tempNum));
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: `✅ Confirmar T${tempNum}:E${epNum.padStart(2, '0')} y Continuar`,
        callback_data: `serie_confirm_tc:${tempNum}:${epNum}:${job.id}`,
      },
    ],
    [
      {
        text: `📌 Subir este y FIJAR "${serieName.slice(0, 16)}" (T${tempNum}) para ráfaga`,
        callback_data: `pin_serie_and_start:${pelserId}:${tempNum}:${matchedSeasonObj?.id || 0}:${job.id}`,
      },
    ],
  ];

  if (existingSeasons.length > 0) {
    const seasonRow: Array<{ text: string; callback_data: string }> = [];
    for (const st of existingSeasons.slice(0, 4)) {
      seasonRow.push({
        text: Number(st.numero) === Number(tempNum) ? `✅ Temp. ${st.numero}` : `📁 Temp. ${st.numero}`,
        callback_data: `serie_season_pick:${st.numero}:${st.id}:${job.id}`,
      });
    }
    keyboard.push(seasonRow);
  }

  keyboard.push([
    {
      text: `➕ Crear Temporada ${nextSeason} en Picta (1 clic)`,
      callback_data: `serie_season_create:${pelserId}:${nextSeason}:${job.id}`,
    },
  ]);

  keyboard.push([
    {
      text: '⬅️ Elegir otra Serie',
      callback_data: `cat:5:${job.id}`,
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function promptStep1Title(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  job.stage = 'awaiting_step_title';
  job.updatedAt = new Date().toISOString();
  pendingManualTitleByChat.set(chatId, job.id);
  currentActivity = `Paso 1/4 (Título) para "${job.fileName}" (${job.category})`;
  saveJobsToDisk();

  const isSerie = job.tipologiaId === 5;
  const analyzedNaming = analyzeVideoTitleAndSynopsis(job.fileName, job.caption);
  const serieInfo = isSerie ? analyzedNaming.seriesInfo : null;
  let inheritedStyle: DetectedSeriesTitleStyle | null = null;

  if (isSerie && serieInfo) {
    const existingMeta = job.modelMetadata || {};
    const existingSerieStr = String(existingMeta.serie || '');
    const finalSerieName = !isGenericOrInvalidSerieName(existingSerieStr)
      ? existingSerieStr
      : !serieInfo.missingSerieName
        ? serieInfo.serieName
        : '';
    const finalTemp = existingMeta.temporada || serieInfo.temporada || '1';
    const finalEp = existingMeta.numero || serieInfo.numero || '1';
    const finalSub = String(existingMeta.episodeSubtitle || serieInfo.episodeSubtitle || '').trim();
    const pelserId = Number(existingMeta.serie_pelser_id || 0);
    inheritedStyle = finalSerieName
      ? resolveSeriesStyleForChannel(chatId, pelserId, finalSerieName)
      : null;

    job.modelMetadata = {
      ...existingMeta,
      ...(finalSerieName ? { serie: finalSerieName } : {}),
      temporada: String(finalTemp),
      numero: String(finalEp),
      ...(finalSub ? { episodeSubtitle: finalSub } : {}),
    };
    if (finalSerieName) {
      delete job.modelMetadata.needsManualTitle;
      job.title = inheritedStyle
        ? formatEpisodeWithSeriesStyle(inheritedStyle, {
            serieName: String(finalSerieName),
            temporada: String(finalTemp),
            numero: String(finalEp),
            episodeSubtitle: finalSub,
          })
        : formatSerieEpisodeTitle(
            String(finalSerieName),
            String(finalTemp),
            String(finalEp),
            finalSub
          );
      if (isStaleOrGenericSerieSynopsis(job.synopsis, job.caption, String(finalEp))) {
        const chName = job.targetChannelName || getEffectivePictaContext(chatId).channelName || 'Mi Canal';
        job.synopsis = `Capítulo ${finalEp} de la Temporada ${finalTemp} de la serie ${cleanSerieDisplayName(String(finalSerieName))}${finalSub ? ` titulado "${finalSub}"` : ''}, disponible en el canal ${chName}.`;
      }
    }
  } else {
    const existingTitle = String(job.title || '').trim();
    const needsAskManual =
      job.modelMetadata?.needsManualTitle === 'true' ||
      (!existingTitle && analyzedNaming.needsManualTitle) ||
      (analyzedNaming.needsManualTitle && isRandomOrCrypticFilename(existingTitle));
    if (needsAskManual) {
      job.title = '';
      job.modelMetadata = {
        ...(job.modelMetadata || {}),
        needsManualTitle: 'true',
      };
    } else if (!existingTitle || existingTitle === 'Pendiente de elección...') {
      job.title = analyzedNaming.initialTitle || cleanGeneralVideoTitle(job.fileName) || job.fileName;
      if (job.modelMetadata) delete job.modelMetadata.needsManualTitle;
    }
  }
  saveJobsToDisk();

  const missingRealTitle =
    (!isSerie || !job.modelMetadata?.serie) &&
    (job.modelMetadata?.needsManualTitle === 'true' ||
      !job.title ||
      isRandomOrCrypticFilename(job.title));

  const serieDetectionBanner =
    isSerie && job.modelMetadata?.serie
      ? `📺 <b>Serie vinculada:</b> ${escapeHtml(String(job.modelMetadata.serie))} · <b>T${escapeHtml(String(job.modelMetadata.temporada || '1'))}:E${escapeHtml(String(job.modelMetadata.numero || '1').padStart(2, '0'))}</b>` +
        (job.modelMetadata?.episodeSubtitle
          ? ` · <i>"${escapeHtml(String(job.modelMetadata.episodeSubtitle))}"</i>`
          : '')
      : '';

  const serieTitleOptions = isSerie && !missingRealTitle
    ? buildSerieTitleOptions({
        serieName: String(job.modelMetadata?.serie || 'Serie'),
        temporada: String(job.modelMetadata?.temporada || '1'),
        numero: String(job.modelMetadata?.numero || '1'),
        episodeSubtitle: String(job.modelMetadata?.episodeSubtitle || ''),
        rawCaption: job.caption,
        inheritedStyle,
      })
    : [];

  const text =
    `${hudHeader('ASISTENTE DE PUBLICACIÓN', `${renderWizardStepBar(1)} · TÍTULO`)}` +
    `\n` +
    hudBox([
      `📂 <b>Categoría:</b> ${escapeHtml(job.category)}`,
      `📄 <b>Archivo:</b> <code>${escapeHtml(job.fileName)}</code> (${formatBytes(job.expectedBytes)})`,
      analyzedNaming.titleSource === 'caption' && analyzedNaming.filenameIsRandom
        ? `💬 <b>Fuente elegida:</b> Caption del mensaje (archivo con nombre aleatorio ignorado)`
        : undefined,
      serieDetectionBanner ? serieDetectionBanner : undefined,
      inheritedStyle
        ? `🎨 <b>Formato de serie previo (${inheritedStyle.sampleCount} caps):</b> <code>${escapeHtml(inheritedStyle.sampleTitle.slice(0, 42))}</code>`
        : undefined,
      missingRealTitle
        ? `⚠️ <b>Nombre aleatorio / sin título reconocible:</b> Búsqueda en IMDb pausada hasta recibir el título real`
        : `📌 <b>Título propuesto:</b> <code>${escapeHtml(job.title)}</code>`,
    ]) +
    `\n` +
    (missingRealTitle
      ? `✍️ <b>Escribe ahora en el chat el título real</b> (ej: <i>El Padrino 1972</i> o <i>Dune Parte 2</i>) para buscar su ficha e IMDb correctamente:`
      : isSerie && serieTitleOptions.length > 0
        ? `👇 <b>Elige el formato de título</b>, busca en <b>IMDb / TMDB</b> o escribe el título en el chat:`
        : `✍️ <b>Escribe otro título en el chat</b>, confirma el propuesto o busca en <b>IMDb / TMDB</b>:`);

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (missingRealTitle) {
    keyboard.push([
      {
        text: '⬅️ Cambiar Categoría',
        callback_data: `back_cats:${job.id}`,
      },
      {
        text: '🛑 Cancelar',
        callback_data: `cancel_job:${job.id}`,
      },
    ]);
  } else if (isSerie && serieTitleOptions.length > 0) {
    serieTitleOptions.forEach((opt, idx) => {
      keyboard.push([
        {
          text: opt.buttonLabel,
          callback_data: `step1_opt:${idx}:${job.id}`,
        },
      ]);
    });
    keyboard.push([
      {
        text: '🤖 Buscar título y sinopsis oficial (IMDb / TMDB)',
        callback_data: `step1_ai:${job.id}`,
      },
    ]);
    keyboard.push(
      [
        {
          text: '⚡ Subir directo (Autorrellenar los 4 pasos)',
          callback_data: `auto:${job.id}`,
        },
      ],
      [
        {
          text: '⬅️ Volver a Selección de Serie',
          callback_data: `cat:5:${job.id}`,
        },
      ]
    );
  } else {
    keyboard.push([
      {
        text: `✅ Confirmar título: "${job.title.slice(0, 26)}"`,
        callback_data: `step1_keep:${job.id}`,
      },
    ]);
    keyboard.push([
      {
        text: '🔍 Buscar en IMDb / TMDB (Top 3 / Auto)',
        callback_data: `step1_imdb:${job.id}`,
      },
    ]);
    keyboard.push(
      [
        {
          text: '⚡ Subir directo (Autorrellenar los 4 pasos)',
          callback_data: `auto:${job.id}`,
        },
      ],
      [
        {
          text: '⬅️ Cambiar Categoría',
          callback_data: `back_cats:${job.id}`,
        },
      ]
    );
  }

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function promptImdbDisambiguationTop3(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null,
  candidates: MediaMatchCandidate[],
  nextStep: 2 | 3,
  query: string,
  seasonNum?: number,
  epNum?: number
): Promise<void> {
  const top3 = candidates.slice(0, 3);
  pendingOnlineCandidatesByJob.set(job.id, {
    candidates: top3,
    nextStep,
    seasonNum,
    epNum,
    query,
  });
  pendingManualTitleByChat.set(chatId, job.id);
  job.stage = 'awaiting_step_title';
  saveJobsToDisk();

  const lines = top3.map((c, idx) => {
    const kind = c.mediaType === 'tv' ? '📺 Serie' : '🎬 Película';
    const yr = c.year ? ` (${c.year})` : '';
    const orig =
      c.originalTitle && c.originalTitle.toLowerCase() !== c.title.toLowerCase()
        ? ` · <i>${escapeHtml(c.originalTitle)}</i>`
        : '';
    return `${idx + 1}. <b>${escapeHtml(c.title)}${escapeHtml(yr)}</b> · ${kind}${orig}`;
  });

  const text =
    `${hudHeader('VARIOS RESULTADOS EN IMDb / TMDB', 'ELIGE EL EXACTO')}\n` +
    hudBox([
      `🔍 <b>Búsqueda:</b> <code>${escapeHtml(query)}</code>`,
      ...lines,
    ]) +
    `\n👇 <b>Selecciona el resultado correcto</b> con 1 toque o escribe un título más específico (con año):`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = top3.map((c, idx) => {
    const icon = c.mediaType === 'tv' ? '📺' : '🎬';
    const yr = c.year ? ` (${c.year})` : '';
    return [
      {
        text: `${icon} ${c.title.slice(0, 26)}${yr}`,
        callback_data: `imdb_pick:${idx}:${job.id}`,
      },
    ];
  });

  keyboard.push([
    { text: '✍️ Escribir otro título', callback_data: `imdb_retype:${job.id}` },
    { text: '⏭️ Continuar sin elegir', callback_data: `imdb_skip:${nextStep}:${job.id}` },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function applyEnrichmentToWizardJob(
  job: VideoTransferJob,
  chatId: string,
  options: {
    forceTitleUpdate?: boolean;
    forceSynopsisUpdate?: boolean;
    preResolvedOnlineInfo?: OnlineMediaInfo | null;
  }
): Promise<void> {
  const chInfo = resolveJobTargetChannelInfo(job);
  const meta = job.modelMetadata || {};
  const pelserId = Number(meta.serie_pelser_id || 0);
  const serieStr = meta.serie ? String(meta.serie) : undefined;
  const inheritedStyle =
    job.tipologiaId === 5 && serieStr
      ? resolveSeriesStyleForChannel(chatId, pelserId, serieStr)
      : null;

  const generated = await generateVideoMetadataWithAI(
    job.fileName,
    job.caption,
    options.forceTitleUpdate ? undefined : job.title || undefined,
    job.category,
    job.tipologiaId,
    chInfo.channelName,
    job.tipologiaId === 5
      ? {
          serieName: serieStr,
          temporada: meta.temporada ? String(meta.temporada) : undefined,
          numero: meta.numero ? String(meta.numero) : undefined,
          episodeSubtitle: meta.episodeSubtitle ? String(meta.episodeSubtitle) : undefined,
          inheritedStyle,
          preResolvedOnlineInfo: options.preResolvedOnlineInfo || null,
        }
      : {
          preResolvedOnlineInfo: options.preResolvedOnlineInfo || null,
        }
  );

  if (generated.modelMetadata) {
    job.modelMetadata = { ...generated.modelMetadata, ...(job.modelMetadata || {}) };
    if (generated.modelMetadata.onlineCoverUrl) {
      job.modelMetadata.onlineCoverUrl = generated.modelMetadata.onlineCoverUrl;
    }
    if (generated.modelMetadata.onlinePosterUrl) {
      job.modelMetadata.onlinePosterUrl = generated.modelMetadata.onlinePosterUrl;
    }
    if (generated.modelMetadata.onlineBackdropUrl) {
      job.modelMetadata.onlineBackdropUrl = generated.modelMetadata.onlineBackdropUrl;
    }
    if (options.preResolvedOnlineInfo?.rating) {
      job.modelMetadata.calificacion = String(options.preResolvedOnlineInfo.rating);
    } else if (generated.modelMetadata.calificacion && !job.modelMetadata.calificacion) {
      job.modelMetadata.calificacion = String(generated.modelMetadata.calificacion);
    }
  }

  if (options.forceTitleUpdate) {
    if (job.tipologiaId !== 5 && options.preResolvedOnlineInfo?.title) {
      job.title = options.preResolvedOnlineInfo.year
        ? `${options.preResolvedOnlineInfo.title} (${options.preResolvedOnlineInfo.year})`
        : options.preResolvedOnlineInfo.title;
    } else if (generated.title) {
      job.title = generated.title;
    }
    job.titleMode = 'manual';
  } else if (options.preResolvedOnlineInfo?.title && job.tipologiaId !== 5 && (!job.title || isRandomOrCrypticFilename(job.title))) {
    job.title = options.preResolvedOnlineInfo.title;
  }

  const shouldUseGenSyn =
    job.tipologiaId === 5
      ? isStaleOrGenericSerieSynopsis(job.synopsis, job.caption, String(meta.numero || '1'))
      : isGenericAutoSynopsis(job.synopsis, job.caption);
  if (generated.synopsis && (options.forceSynopsisUpdate || shouldUseGenSyn)) {
    job.synopsis = generated.synopsis;
  }
  saveJobsToDisk();
}

async function promptStep2Synopsis(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  job.stage = 'awaiting_step_synopsis';
  job.updatedAt = new Date().toISOString();
  pendingManualTitleByChat.set(chatId, job.id);
  currentActivity = `Paso 2/4 (Descripción) para "${job.title}"`;

  // If the current synopsis is just a watermark, channel tag, or generic placeholder, clear it so the user sees clean options
  if (job.synopsis && isGenericAutoSynopsis(job.synopsis, job.caption) && job.tipologiaId !== 5) {
    job.synopsis = '';
  }
  saveJobsToDisk();

  const hasValidDetectedSynopsis =
    Boolean(job.synopsis && job.synopsis.trim()) &&
    !isGenericAutoSynopsis(job.synopsis, job.caption);

  const text =
    `${hudHeader('ASISTENTE DE PUBLICACIÓN', `${renderWizardStepBar(2)} · SINOPSIS`)}\n` +
    hudBox([
      `✅ <b>1. Título:</b> ${escapeHtml(job.title)}`,
      `📂 <b>Categoría:</b> ${escapeHtml(job.category)}`,
      hasValidDetectedSynopsis
        ? `💡 <b>Sinopsis detectada:</b> <i>${escapeHtml(job.synopsis.slice(0, 140))}</i>`
        : undefined,
    ]) +
    `\n✍️ <b>Escribe ahora la sinopsis en el chat</b> o elige una opción abajo:`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: '✨ Rellenar Sinopsis y Ficha con IA (IMDb / TMDB)',
        callback_data: `step2_ai:${job.id}`,
      },
    ],
  ];

  if (hasValidDetectedSynopsis) {
    keyboard.push([
      {
        text: '✅ Usar sinopsis detectada del mensaje',
        callback_data: `step2_keep:${job.id}`,
      },
    ]);
  }

  keyboard.push([
    {
      text: '⬅️ Volver a Título',
      callback_data: `step_back:1:${job.id}`,
    },
    {
      text: '⚡ Saltar resto y Subir',
      callback_data: `step4_skip:${job.id}`,
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function promptStep3Cover(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  job.stage = 'awaiting_step_cover';
  job.updatedAt = new Date().toISOString();
  pendingManualTitleByChat.set(chatId, job.id);
  currentActivity = `Paso 3/4 (Portada) para "${job.title}"`;

  // Pre-fetch online poster & backdrop URLs if not yet fetched so the user sees whether the official TMDB/IMDb artwork was found
  const currentMeta = job.modelMetadata || {};
  if (!currentMeta.onlineCoverUrl) {
    try {
      const online = await searchMovieOrSeriesInfoOnline(
        job.title,
        Number(job.tipologiaId || 8),
        currentMeta.temporada ? Number(currentMeta.temporada) : undefined,
        currentMeta.numero ? Number(currentMeta.numero) : undefined
      );
      if (online?.imageUrl) {
        job.modelMetadata = {
          ...currentMeta,
          onlineCoverUrl: online.imageUrl,
          ...(online.posterUrl ? { onlinePosterUrl: online.posterUrl } : {}),
          ...(online.backdropUrl ? { onlineBackdropUrl: online.backdropUrl } : {}),
          ...(online.year && !currentMeta.ano ? { ano: online.year } : {}),
          ...(online.director && !currentMeta.director ? { director: online.director } : {}),
          ...(online.reparto && !currentMeta.reparto ? { reparto: online.reparto } : {}),
          ...(online.pais && !currentMeta.pais ? { pais: online.pais } : {}),
          ...(online.genero && !currentMeta.genero ? { genero: online.genero } : {}),
        };
      }
    } catch {
      // Ignore
    }
  }
  saveJobsToDisk();

  const hasOfficialPoster = Boolean(job.modelMetadata?.onlineCoverUrl || job.modelMetadata?.onlinePosterUrl);
  const hasCustomPoster = Boolean(job.customPosterFileId);
  const hasCustomCover = Boolean(job.customCoverFileId);

  const text =
    `${hudHeader('ASISTENTE DE PUBLICACIÓN', `${renderWizardStepBar(3)} · PORTADA Y PÓSTER`)}\n` +
    hudBox([
      `✅ <b>1. Título:</b> ${escapeHtml(job.title)}`,
      `✅ <b>2. Sinopsis:</b> ${escapeHtml(job.synopsis ? job.synopsis.slice(0, 95) + (job.synopsis.length > 95 ? '...' : '') : 'Automática con IA (TMDB/IMDb)')}`,
      `🎬 <b>TMDB/IMDb:</b> ${hasOfficialPoster ? '🟢 Portada 16:9 y Póster vertical listos' : '🔍 Búsqueda automática al subir'}`,
      hasCustomCover ? `🖼️ <b>Portada propia:</b> ✅ Cargada` : undefined,
      hasCustomPoster ? `🎞️ <b>Póster vertical propio:</b> ✅ Cargado` : undefined,
    ]) +
    `\n📸 <b>Envía una imagen al chat</b> para poner portada propia, o elige una opción:`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: '🎬 Aplicar Oficial HD (TMDB / IMDb)',
        callback_data: `step3_poster:${job.id}`,
      },
    ],
    [
      {
        text: '🎞️ Enviar Póster Vertical Propio (Opcional)',
        callback_data: `step3_set_poster:${job.id}`,
      },
    ],
    [
      {
        text: '🖼️ Usar miniatura fotograma del video',
        callback_data: `step3_frame:${job.id}`,
      },
    ],
    [
      {
        text: '⬅️ Volver a Sinopsis',
        callback_data: `step_back:2:${job.id}`,
      },
      {
        text: '⚡ Subir Ahora',
        callback_data: `step4_skip:${job.id}`,
      },
    ],
  ];

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function promptStep4Subtitles(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  job.stage = 'awaiting_step_subtitles';
  job.updatedAt = new Date().toISOString();
  pendingManualTitleByChat.set(chatId, job.id);
  currentActivity = `Paso 4/4 (Subtítulos) para "${job.title}"`;
  saveJobsToDisk();

  const coverLabel = job.customCoverFileId
    ? '📸 Imagen personalizada enviada al chat'
    : job.modelMetadata?.preferVideoFrameCover === 'true'
      ? '🖼️ Miniatura del fotograma del video'
      : '🎬 Carátula Oficial HD (TMDB / IMDb)';

  const text =
    `${hudHeader('ASISTENTE DE PUBLICACIÓN', `${renderWizardStepBar(4)} · SUBTÍTULOS (OPCIONAL)`)}\n` +
    hudBox([
      `✅ <b>1. Título:</b> ${escapeHtml(job.title)}`,
      `✅ <b>2. Sinopsis:</b> ${escapeHtml(job.synopsis ? job.synopsis.slice(0, 80) + (job.synopsis.length > 80 ? '...' : '') : 'Automática con IA')}`,
      `✅ <b>3. Portada:</b> ${coverLabel}`,
    ]) +
    `\n📎 <b>Envía el archivo de subtítulos (<code>.srt</code> / <code>.vtt</code>)</b> o pulsa el botón para iniciar la subida:`;

  const keyboard = [
    [
      {
        text: '🚀 Sin subtítulos · Iniciar Subida Ahora',
        callback_data: `step4_skip:${job.id}`,
      },
    ],
    [
      {
        text: '⬅️ Volver a Portada',
        callback_data: `step_back:3:${job.id}`,
      },
    ],
  ];

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function promptUploadAccountSelection(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  ensureDailyQuotaReset();
  const poolAccounts = getPoolAccountsForChat(chatId);
  if (poolAccounts.length === 0) {
    // User has no secondary accounts in Pool: never prompt, go straight to upload with Primary
    job.preferredUploadAccountKey = 'primary';
    job.preferredUploadAccountLabel = getPrimaryAccountLabelForChat(chatId);
    saveJobsToDisk();
    await startJobUploadWithSelectedAccount(job, chatId, messageId);
    return;
  }

  pendingManualTitleByChat.delete(chatId);
  job.stage = 'awaiting_upload_account';
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  const { channelId: resolvedChId, channelName: resolvedChName } = resolveJobTargetChannelInfo(job);
  const primaryLabel = getPrimaryAccountLabelForChat(chatId);
  const isMaster = isMasterAdminChat(chatId);
  const todayCuba = getTodayCubaDateStr();
  const primaryUsedToday = isMaster
    ? Math.max(
        0,
        (quotaSettings.seriesUploadedToday || 0) +
          (quotaSettings.otherUploadedToday || 0) -
          poolAccounts.reduce((sum, a) => sum + (a.uploadedToday || 0), 0)
      )
    : transferJobs.filter(
        (j) =>
          j.telegramChatId === chatId &&
          j.stage === 'completed' &&
          (!j.preferredUploadAccountKey || j.preferredUploadAccountKey === 'primary') &&
          toCubaDateStr(j.updatedAt || j.createdAt) === todayCuba
      ).length;

  const text =
    `${hudHeader('ELEGIR CUENTA DE SUBIDA')}\n` +
    hudBox([
      `🎬 <b>Título:</b> ${escapeHtml(job.title || job.fileName)}`,
      `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}`,
      `📺 <b>Canal destino:</b> ${escapeHtml(resolvedChName)}${resolvedChId ? ` · <code>#${escapeHtml(resolvedChId)}</code>` : ''}`,
      `📦 <b>Tamaño:</b> ${formatBytes(job.expectedBytes)}`,
    ]) +
    `\n👇 <b>Selecciona con qué cuenta deseas subir este video a tu canal:</b>`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      {
        text: `🔑 Principal: ${primaryLabel.slice(0, 22)} (${primaryUsedToday}/10)`,
        callback_data: `upload_acct:primary:${job.id}`,
      },
    ],
  ];

  poolAccounts.forEach((acc, idx) => {
    const label = String(acc.displayName || acc.username || `Colaborador ${idx + 1}`).slice(0, 22);
    const roleHint = acc.canPublishDirectly === false ? ' · Usuario común' : '';
    keyboard.push([
      {
        text: `🤝 ${label} (${acc.uploadedToday || 0}/10${roleHint})`,
        callback_data: `upload_acct:pool:${idx}:${job.id}`,
      },
    ]);
  });

  keyboard.push([
    {
      text: '➕ Añadir Nuevo Colaborador al Pool',
      callback_data: `upload_acct_add:${job.id}`,
    },
  ]);
  keyboard.push([
    {
      text: '🛑 Cancelar',
      callback_data: `cancel_job:${job.id}`,
    },
  ]);

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, text, keyboard, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, text, job.telegramMessageId, keyboard);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }
}

async function startJobUploadWithSelectedAccount(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  pendingManualTitleByChat.delete(chatId);
  job.stage = job.minioKey ? 'creating_picta_publication' : 'generating_auto_title';
  job.errorDetails = undefined;
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  const { channelId: resolvedChId, channelName: resolvedChName } = resolveJobTargetChannelInfo(job);
  const acctLabel = job.preferredUploadAccountLabel || getPrimaryAccountLabelForChat(chatId);
  const summaryText =
    `${hudHeader('DESPLIEGUE INICIADO · SUBIENDO A PICTA')}\n` +
    hudBox([
      `👤 <b>Cuenta de subida:</b> ${escapeHtml(acctLabel)}`,
      `🎬 <b>Título:</b> ${escapeHtml(job.title || job.fileName)}`,
      `📂 <b>Categoría:</b> ${escapeHtml(job.category)}`,
      `📝 <b>Descripción:</b> ${escapeHtml(job.synopsis ? job.synopsis.slice(0, 100) : 'Generando automáticamente...')}`,
      `🖼️ <b>Portada:</b> ${job.customCoverFileId ? 'Personalizada 📸' : 'Automática 🖼️'}`,
      `💬 <b>Subtítulos:</b> ${job.subtitleFileName ? escapeHtml(job.subtitleFileName) : 'Sin subtítulos externos'}`,
    ]) +
    `\n⏳ <i>${job.minioKey ? 'Reutilizando video ya subido a S3 MinIO...' : 'Descargando vía MTProto 2 GB y subiendo'} a ${escapeHtml(resolvedChName)}${resolvedChId ? ` (#${escapeHtml(resolvedChId)})` : ''}...</i>`;

  if (messageId) {
    await editTelegramStatusMessage(chatId, messageId, summaryText, undefined, true);
  } else {
    const sentId = await sendTelegramStatusMessage(chatId, summaryText, job.telegramMessageId);
    if (sentId) {
      job.statusMessageId = sentId;
      saveJobsToDisk();
    }
  }

  const customTitleArg = job.titleMode === 'manual' && job.title ? job.title : '';
  await triggerCloudRunKeepAliveTransfer(job.id, customTitleArg, job.statusMessageId || messageId);
}

async function finalizeGuidedStepsAndStart(
  job: VideoTransferJob,
  chatId: string,
  messageId: number | null
): Promise<void> {
  pendingManualTitleByChat.delete(chatId);
  job.titleMode = 'manual';
  job.updatedAt = new Date().toISOString();
  saveJobsToDisk();

  if (!job.preferredUploadAccountKey && getPoolAccountsForChat(chatId).length > 0) {
    await promptUploadAccountSelection(job, chatId, messageId);
    return;
  }

  await startJobUploadWithSelectedAccount(job, chatId, messageId);
}

async function handleTelegramUpdate(update: any): Promise<void> {
  if (externalCloudRunWebhookActive) {
    return;
  }

  if (
    !update ||
    (typeof update.update_id !== 'number' &&
      !update.message &&
      !update.edited_message &&
      !update.channel_post &&
      !update.callback_query)
  ) {
    return;
  }

  if (!cloudVaultLoadedOnce) {
    await Promise.race([
      ensureCloudStateLoadedOnce(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]).catch(() => {});
  }

  if (typeof update?.update_id === 'number') {
    if (processedUpdateIds.has(update.update_id)) {
      return;
    }
    addBoundedSetEntry(processedUpdateIds, update.update_id);
    if (update.update_id + 1 > lastUpdateOffset) {
      lastUpdateOffset = update.update_id + 1;
    }
    saveProcessedUpdatesToDisk();
  }

  lastWakeUpAt = new Date().toISOString();

  // Check if message comes from a user's monitored Requests Group/Channel
  const incomingGroupOrChannelMsg = update.channel_post || update.message;
  const incomingChatType = String(incomingGroupOrChannelMsg?.chat?.type || '');
  if (
    incomingGroupOrChannelMsg &&
    !update.callback_query &&
    (incomingChatType === 'group' ||
      incomingChatType === 'supergroup' ||
      incomingChatType === 'channel')
  ) {
    const monitoredCfg = findOwnerPromoConfigForGroupChat(
      String(incomingGroupOrChannelMsg.chat?.id || ''),
      incomingGroupOrChannelMsg.chat?.username
    );
    if (monitoredCfg) {
      if (!incomingGroupOrChannelMsg.from?.is_bot) {
        await handleMonitoredRequestsGroupMessage(monitoredCfg, incomingGroupOrChannelMsg);
      }
      return;
    }
  }

  const fromUser = update.callback_query?.from || update.message?.from || update.edited_message?.from;
  const rawSenderId = String(
    fromUser?.id ||
      update.message?.chat?.id ||
      update.callback_query?.message?.chat?.id ||
      ''
  );
  const rawChatId = String(
    update.message?.chat?.id || update.callback_query?.message?.chat?.id || rawSenderId
  );
  const fromUsername = fromUser?.username || '';

  if (!isUserAuthorized(rawSenderId, fromUsername)) {
    // Only send unauthorized notice in private chats (avoid spamming random groups)
    if (update.message?.chat?.id && update.message?.chat?.type === 'private') {
      await callTelegramBotApi('sendMessage', {
        chat_id: update.message.chat.id,
        text:
          `⛔ <b>No tienes permiso para usar este bot.</b>\n\n` +
          `Escríbeme a @admin_bot para darte acceso.\n\n` +
          `🆔 <i>Tu ID de Telegram:</i> <code>${rawSenderId}</code>`,
        parse_mode: 'HTML',
      }).catch(() => {});
    } else if (update.callback_query?.id) {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: update.callback_query.id,
        text: '⛔ No tienes permiso para usar el bot. Escríbeme a @admin_bot.',
        show_alert: true,
      }).catch(() => {});
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const cqId = String(cq.id || '');
    if (cqId && processedCallbackIds.has(cqId)) {
      return;
    }
    if (cqId) {
      addBoundedSetEntry(processedCallbackIds, cqId);
      saveProcessedUpdatesToDisk();
    }
    const data: string = cq.data || '';
    const chatId = String(cq.message?.chat?.id || cq.from?.id || '');
    const messageId = cq.message?.message_id || null;

    if (data === 'cmd_start') {
      pendingToolkitInputByChat.delete(chatId);
      pendingUserLoginByChat.delete(chatId);
      pendingPictaSearchByChat.delete(chatId);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Volviendo al menú principal...',
      }).catch(() => {});
      await sendOrEditMainMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'picta_search:prompt') {
      pendingToolkitInputByChat.delete(chatId);
      pendingPictaSearchByChat.set(chatId, { messageId });
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Escribe el título a buscar en Picta',
      }).catch(() => {});
      const promptText =
        `${hudHeader('BUSCADOR GLOBAL DE PICTA')}\n` +
        hudBox([
          `🔍 <b>Alcance:</b> Todo el catálogo público de Picta (películas, series, capítulos y otros)`,
          `📊 <b>Datos mostrados:</b> Canal autor, categoría, peso (MB/GB), resolución (1080p, 720p...) y enlace`,
        ]) +
        `\n✍️ <b>Escribe ahora el nombre de la película, serie o video que deseas verificar:</b>\n\n` +
        `<i>(O usa directo <code>/buscar Nombre</code> en cualquier momento · /cancelar para salir)</i>`;
      const kb = [[{ text: '⬅️ Volver al Menú', callback_data: 'cmd_start' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('picta_search_page:')) {
      const page = Number(data.slice('picta_search_page:'.length) || 0) || 0;
      const last = lastPictaSearchResultsByChat.get(chatId);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      if (!last) {
        await sendOrEditMainMenuInTelegram(chatId, messageId);
        return;
      }
      await sendOrEditPictaSearchResultsInTelegram(chatId, messageId, last.query, page);
      return;
    }

    if (data.startsWith('dup_proceed:')) {
      const jobId = data.slice('dup_proceed:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      job.duplicateCheckApprovedTitle = normalizeDuplicateTitleKey(job.title || job.fileName);
      const nextAct = job.duplicateCheckNextAction || 'step2';
      job.duplicateCheckNextAction = undefined;
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Continuando con la subida...',
      }).catch(() => {});

      if (nextAct === 'auto') {
        await executeAutoUploadAfterDuplicateCheck(job, chatId, messageId);
      } else if (nextAct === 'pinned_serie') {
        await executePinnedSerieUploadAfterDuplicateCheck(job, chatId, messageId);
      } else {
        await promptStep2Synopsis(job, chatId, messageId);
      }
      return;
    }

    if (data.startsWith('dup_edit_title:')) {
      const jobId = data.slice('dup_edit_title:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      job.duplicateCheckApprovedTitle = undefined;
      job.duplicateCheckNextAction = undefined;
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cambia o refina el título...',
      }).catch(() => {});
      await promptStep1Title(job, chatId, messageId);
      return;
    }

    if (data === 'cmd_cuota') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Actualizando cuota diaria...',
      }).catch(() => {});
      await sendOrEditQuotaMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'cmd_cuenta') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Verificando permisos de cuenta en Picta...',
      }).catch(() => {});
      await sendOrEditAccountDiagnosticInTelegram(chatId, messageId);
      return;
    }

    if (data === 'alerts_menu') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await sendOrEditAlertsMilestonesMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'alerts_toggle_comments') {
      const prefs = getChatAlertPreferences(chatId);
      prefs.commentsEnabled = !prefs.commentsEnabled;
      saveAlertsStateToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: prefs.commentsEnabled ? '💬 Alertas de comentarios activadas' : '💬 Alertas desactivadas',
      }).catch(() => {});
      await sendOrEditAlertsMilestonesMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'alerts_toggle_milestones') {
      const prefs = getChatAlertPreferences(chatId);
      prefs.milestonesEnabled = !prefs.milestonesEnabled;
      saveAlertsStateToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: prefs.milestonesEnabled ? '🏆 Logros activados' : '🏆 Logros desactivados',
      }).catch(() => {});
      await sendOrEditAlertsMilestonesMenuInTelegram(chatId, messageId);
      return;
    }

    if (data.startsWith('alerts_toggle_metric:')) {
      const key = data.slice('alerts_toggle_metric:'.length) as AchievementMetricKey;
      const prefs = getChatAlertPreferences(chatId);
      if (key in prefs.enabledMetrics) {
        prefs.enabledMetrics[key] = !prefs.enabledMetrics[key];
        saveAlertsStateToDisk();
      }
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Métrica actualizada.',
      }).catch(() => {});
      await sendOrEditAlertsMilestonesMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'alerts_reset_thresholds') {
      const prefs = getChatAlertPreferences(chatId);
      prefs.thresholds = [...DEFAULT_MILESTONE_THRESHOLDS];
      saveAlertsStateToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '♻️ Metas restauradas a valores por defecto.',
      }).catch(() => {});
      await sendOrEditAlertsMilestonesMenuInTelegram(
        chatId,
        messageId,
        undefined,
        '✅ <b>Metas progresivas restauradas por defecto.</b>'
      );
      return;
    }

    if (data === 'alerts_edit_thresholds') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      const prefs = getChatAlertPreferences(chatId);
      pendingToolkitInputByChat.set(chatId, {
        mode: 'edit_milestone_thresholds',
        messageId,
      });
      const prompt =
        `✏️ <b>EDITAR METAS PROGRESIVAS DE LOGROS</b>\n\n` +
        `Metas actuales:\n<code>${prefs.thresholds.join(', ')}</code>\n\n` +
        `Escribe ahora los números separados por comas o espacios (también puedes usar <code>1k</code>, <code>5k</code>):\n` +
        `<i>Ejemplo: <code>25, 50, 100, 250, 500, 1000, 5000</code></i>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'alerts_menu' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, prompt, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, prompt, undefined, kb);
      }
      return;
    }

    if (data === 'alerts_scan_now') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Buscando nuevos comentarios y logros en tu canal...',
      }).catch(() => {});
      const summary = await scanAllPictaAlertsAndMilestones(chatId);
      await sendOrEditAlertsMilestonesMenuInTelegram(
        chatId,
        messageId,
        undefined,
        `🔄 <b>Revisión completada:</b> ${summary.newComments} comentario(s) nuevo(s) y ${summary.newMilestones} logro(s) nuevo(s).`
      );
      return;
    }

    if (data === 'user_picta_login_start' || data === 'cmd_login') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingUserLoginByChat.set(chatId, { step: 'awaiting_username' });
      await sendTelegramStatusMessage(
        chatId,
        `📱 <b>PASO 1/2 · VINCULAR TU CUENTA DE PICTA</b>\n\n` +
          `Escribe ahora en el chat tu <b>número de teléfono</b> (+53...) o tu <b>nombre de usuario</b> de Picta:\n\n` +
          `<i>(O escribe /cancelar para salir)</i>`
      );
      return;
    }

    if (data === 'retry_auto_discover_channel') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🔍 Buscando tu canal en Picta...',
      }).catch(() => {});
      const updated = await ensureGuestSessionChannelDiscovered(chatId, true);
      if (updated && updated.channelId && updated.channelId !== '0') {
        pendingToolkitInputByChat.delete(chatId);
        const channelButtons = (updated.availableChannels || []).slice(0, 8).map((c) => [
          {
            text: `📺 ${c.nombre} (#${c.id})`,
            callback_data: `user_channel_pick:${c.id}`,
          },
        ]);
        const readyText =
          `🎉 <b>¡CANAL DETECTADO Y VINCULADO AUTOMÁTICAMENTE!</b>\n\n` +
          `<blockquote>` +
          `👤 <b>Usuario Picta:</b> ${escapeHtml(updated.userFullName || updated.username)}\n` +
          `📺 <b>Canal Activo:</b> ${escapeHtml(updated.channelName)} (<code>#${escapeHtml(updated.channelId)}</code>)\n` +
          `📦 <b>Canales encontrados:</b> ${updated.availableChannels.length}` +
          `</blockquote>\n` +
          `✅ <i>Todo listo. Ya puedes enviarme videos directamente aquí para subirlos a tu canal.</i>`;
        if (messageId) {
          await editTelegramStatusMessage(
            chatId,
            messageId,
            readyText,
            channelButtons.length > 1 ? channelButtons : undefined,
            true
          );
        } else {
          await sendTelegramStatusMessage(
            chatId,
            readyText,
            undefined,
            channelButtons.length > 1 ? channelButtons : undefined
          );
        }
      } else {
        pendingToolkitInputByChat.set(chatId, {
          mode: 'switch_channel_query',
          messageId: messageId || null,
        });
        const stillMissingText =
          `🔍 <b>Aún no aparece tu canal en la respuesta de la API</b>\n\n` +
          `📌 <b>Paso único (sin comandos):</b> Pega aquí mismo en el chat el <b>enlace de tu canal</b> (ej: <code>https://www.picta.cu/canal/tu-canal</code>), su <b>nombre</b> o su <b>ID numérico</b> y quedará vinculado al instante:`;
        const kb = [
          [{ text: '🔄 Reintentar Detección', callback_data: 'retry_auto_discover_channel' }],
          [{ text: '⬅️ Cancelar', callback_data: 'cmd_start' }],
        ];
        if (messageId) {
          await editTelegramStatusMessage(chatId, messageId, stillMissingText, kb, true);
        } else {
          await sendTelegramStatusMessage(chatId, stillMissingText, undefined, kb);
        }
      }
      return;
    }

    if (data.startsWith('user_channel_pick:')) {
      const targetChanId = data.replace('user_channel_pick:', '').trim();
      const session = userSessions.get(chatId);
      const isMaster = isMasterAdminChat(chatId);
      const masterChanId = String(botConfig.pictaChannelId || '36319');
      if (!isMaster && targetChanId === masterChanId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ No tienes acceso a ese canal.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      if (session) {
        const foundChan = (session.availableChannels || []).find(
          (c) => String(c.id) === targetChanId
        );
        if (!foundChan && !isMaster) {
          await callTelegramBotApi('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⚠️ Ese canal no pertenece a tu sesión actual.',
            show_alert: true,
          }).catch(() => {});
          return;
        }
        session.channelId = targetChanId;
        if (foundChan) {
          session.channelName = foundChan.nombre;
        }
        session.verifiedChannelOwnership = true;
        session.updatedAt = new Date().toISOString();
        saveUserSessionsToDisk();
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: `Canal cambiado a: ${session.channelName} (#${session.channelId})`,
        }).catch(() => {});
        await sendTelegramStatusMessage(
          chatId,
          `✅ <b>Canal activo actualizado:</b>\n\n` +
            `<blockquote>` +
            `📺 <b>${escapeHtml(session.channelName)}</b> (#${session.channelId})\n` +
            `👤 <b>Propietario:</b> ${escapeHtml(session.userFullName || session.username)}` +
            `</blockquote>\n` +
            `Cualquier video que envíes ahora se subirá a este canal.`
        );
      } else {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'No tienes una sesión de Picta activa.',
        }).catch(() => {});
      }
      return;
    }

    if (data === 'user_picta_logout') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cerrando sesión de Picta...',
      }).catch(() => {});
      userSessions.delete(chatId);
      saveUserSessionsToDisk();
      await sendTelegramStatusMessage(
        chatId,
        `🚪 <b>Sesión de Picta cerrada correctamente.</b>\n\n` +
          `Tu cuenta ha sido desvinculada del bot. Si deseas vincular una cuenta en el futuro usa <code>/login</code>.`
      );
      return;
    }

    if (data.startsWith('dash_sort:')) {
      const parts = data.split(':');
      const sortMode = (parts[1] || 'views') as 'views' | 'plays' | 'likes' | 'downloads' | 'recent';
      const page = Number(parts[2] || 0);
      const period = (parts[3] || 'all') as PictaDashboardPeriod;
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Ordenando catálogo completo...',
      }).catch(() => {});
      await sendOrEditPictaDashboardInTelegram(chatId, messageId, sortMode, page, undefined, false, period);
      return;
    }

    if (data.startsWith('dash_period:')) {
      const parts = data.split(':');
      const period = (parts[1] || 'all') as PictaDashboardPeriod;
      const sortMode = (parts[2] || 'views') as 'views' | 'plays' | 'likes' | 'downloads' | 'recent';
      const page = Number(parts[3] || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Actualizando rango de estadísticas...',
      }).catch(() => {});
      await sendOrEditPictaDashboardInTelegram(chatId, messageId, sortMode, page, undefined, false, period);
      return;
    }

    if (data.startsWith('dash_refresh:')) {
      const parts = data.split(':');
      const sortMode = (parts[1] || 'views') as 'views' | 'plays' | 'likes' | 'downloads' | 'recent';
      const page = Number(parts[2] || 0);
      const period = (parts[3] || 'all') as PictaDashboardPeriod;
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Consultando web admin de Picta en vivo...',
      }).catch(() => {});
      await sendOrEditPictaDashboardInTelegram(chatId, messageId, sortMode, page, undefined, true, period);
      return;
    }

    if (data === 'promo_cfg:open') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await sendOrEditPromoChannelMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'promo_cfg:set' || data.startsWith('promo_cfg:prompt_for:')) {
      const returnPromoId = data.startsWith('promo_cfg:prompt_for:')
        ? data.slice('promo_cfg:prompt_for:'.length).trim()
        : undefined;
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'set_promo_requests_channel',
        promoId: returnPromoId,
        messageId,
      });
      const promptMsg =
        `📢 <b>CONFIGURAR TU CANAL DE PEDIDOS EN TELEGRAM</b>\n\n` +
        `Envía ahora cualquiera de estas opciones:\n` +
        `• El <b>@usuario</b> de tu canal público (ej: <code>@micanal_pedidos</code>)\n` +
        `• El <b>enlace</b> de tu canal (ej: <code>https://t.me/micanal_pedidos</code>)\n` +
        `• El <b>ID numérico</b> de tu canal privado (ej: <code>-1001234567890</code>)\n` +
        `• O <b>reenvía cualquier publicación</b> desde tu canal hacia este chat\n\n` +
        `⚠️ <i>Asegúrate de haber añadido este bot como Administrador del canal con permiso para publicar mensajes.</i>\n` +
        `<i>(O escribe /cancelar para volver)</i>`;
      const kb = [
        [
          {
            text: '⬅️ Cancelar',
            callback_data: returnPromoId ? `promo_back:${returnPromoId}` : 'promo_cfg:open',
          },
        ],
      ];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptMsg, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptMsg, undefined, kb);
      }
      return;
    }

    if (data === 'promo_cfg:test') {
      const resolvedReq = resolveRequestsChannelForChat(
        chatId,
        MASTER_ADMIN_CHAT_ID,
        userPromoChannels,
        MASTER_PRIVATE_REQUESTS_CHANNEL
      );
      if (!resolvedReq.configured) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Configura primero tu Canal de Pedidos.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      try {
        const chatMeta = await callTelegramBotApi('getChat', { chat_id: resolvedReq.targetChannelId });
        const me = await callTelegramBotApi('getMe');
        const member = await callTelegramBotApi('getChatMember', {
          chat_id: resolvedReq.targetChannelId,
          user_id: me.id,
        }).catch(() => null);
        const status = String(member?.status || 'desconocido');
        const canPost =
          status === 'creator' || (status === 'administrator' && member?.can_post_messages !== false);
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: canPost ? '✅ Bot listo para publicar' : '⚠️ Revisa permisos del bot',
        }).catch(() => {});
        await sendOrEditPromoChannelMenuInTelegram(
          chatId,
          messageId,
          undefined,
          canPost
            ? `✅ <b>Conexión verificada con "${escapeHtml(chatMeta?.title || resolvedReq.targetChannelLabel)}".</b> El bot tiene permisos activos para publicar fichas.`
            : `⚠️ <b>Canal encontrado ("${escapeHtml(chatMeta?.title || resolvedReq.targetChannelLabel)}"), pero el bot figura como <code>${escapeHtml(status)}</code>.</b> Dale permiso de Administrador para publicar mensajes.`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ No se pudo acceder al canal',
          show_alert: true,
        }).catch(() => {});
        await sendOrEditPromoChannelMenuInTelegram(
          chatId,
          messageId,
          undefined,
          `⚠️ <b>No se pudo verificar el canal:</b> <code>${escapeHtml(errMsg.slice(0, 140))}</code>\n<i>Verifica el @usuario / ID y que el bot sea Administrador del canal.</i>`
        );
      }
      return;
    }

    if (data === 'promo_cfg:group') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'set_requests_group_chat',
        messageId,
      });
      const promptMsg =
        `👥 <b>VINCULAR GRUPO O CHAT DE PEDIDOS</b>\n\n` +
        `Envía ahora el <b>@usuario</b>, <b>enlace t.me/...</b> o <b>ID numérico (-100...)</b> del grupo donde tus suscriptores piden películas/series (o reenvía un mensaje de ese grupo/canal).\n\n` +
        `📌 <i>Recuerda añadir el bot al grupo con permiso para leer y responder mensajes.</i>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'promo_cfg:open' }]];
      if (messageId) await editTelegramStatusMessage(chatId, messageId, promptMsg, kb, true);
      else await sendTelegramStatusMessage(chatId, promptMsg, undefined, kb);
      return;
    }

    if (data.startsWith('promo_cfg:mode:')) {
      const nextMode = data.slice('promo_cfg:mode:'.length).trim() as RequestsMonitorMode;
      const existing = userPromoChannels.get(chatId);
      const fallbackTarget = resolveRequestsChannelForChat(
        chatId,
        MASTER_ADMIN_CHAT_ID,
        userPromoChannels,
        MASTER_PRIVATE_REQUESTS_CHANNEL
      );
      userPromoChannels.set(chatId, {
        chatId,
        targetChannelId: existing?.targetChannelId || fallbackTarget.targetChannelId || '',
        targetChannelLabel: existing?.targetChannelLabel || fallbackTarget.targetChannelLabel || '',
        customPictaChannelUrl: existing?.customPictaChannelUrl,
        autoSendToRequests: existing?.autoSendToRequests,
        requestsGroupChatId: existing?.requestsGroupChatId,
        requestsGroupLabel: existing?.requestsGroupLabel,
        requestsMonitorMode:
          nextMode === 'prefix' || nextMode === 'all' ? nextMode : 'off',
        disabled: existing?.disabled ?? false,
        updatedAt: new Date().toISOString(),
      });
      saveUserPromoChannelsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `🤖 Auto-verificador actualizado: ${nextMode.toUpperCase()}`,
      }).catch(() => {});
      await sendOrEditPromoChannelMenuInTelegram(chatId, messageId);
      return;
    }

    if (data.startsWith('audit:')) {
      const parts = data.split(':');
      const isRefresh = parts[1] === 'refresh';
      const tabRaw = isRefresh ? parts[2] : parts[1];
      const page = Number(isRefresh ? parts[3] : parts[2]) || 0;
      const tab: ChannelAuditTab =
        tabRaw === 'inc' || tabRaw === 'unpub' || tabRaw === 'series' ? tabRaw : 'dups';
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: isRefresh ? 'Re-escaneando catálogo del canal...' : 'Cargando auditoría...',
      }).catch(() => {});
      await sendOrEditChannelAuditInTelegram(chatId, messageId, tab, page, undefined, isRefresh);
      return;
    }

    if (data.startsWith('req:')) {
      const parts = data.split(':');
      const action = parts[1] || '';
      if (action === 'list') {
        const filterRaw = parts[2] || 'pending';
        const filter: 'pending' | 'fulfilled' | 'all' =
          filterRaw === 'fulfilled' || filterRaw === 'all' ? filterRaw : 'pending';
        const page = Number(parts[3] || 0) || 0;
        await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
        await sendOrEditRequestsManagerInTelegram(chatId, messageId, filter, page);
        return;
      }
      if (action === 'add_prompt') {
        await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
        pendingToolkitInputByChat.set(chatId, {
          mode: 'add_or_check_request',
          messageId,
        });
        const promptHtml =
          `🔎 <b>VERIFICADOR Y GESTOR DE PEDIDOS</b>\n\n` +
          `Escribe ahora el título de la película o serie que pidió un suscriptor (o reenvía su mensaje aquí).\n\n` +
          `<i>Primero buscaré en toda Picta: si ya existe te daré el enlace + peso/resolución listo para responder; si no existe podrás guardarlo en Pedidos Pendientes.</i>`;
        const kb = [[{ text: '⬅️ Cancelar', callback_data: 'req:list:pending:0' }]];
        if (messageId) await editTelegramStatusMessage(chatId, messageId, promptHtml, kb, true);
        else await sendTelegramStatusMessage(chatId, promptHtml, undefined, kb);
        return;
      }
      if (action === 'scan_comments') {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Escaneando comentarios de Picta...',
        }).catch(() => {});
        await sendOrEditRequestsManagerInTelegram(
          chatId,
          messageId,
          'pending',
          0,
          undefined,
          undefined,
          true
        );
        return;
      }
      if (action === 'save_last') {
        const pendingSave = pendingRequestSaveByChat.get(chatId);
        pendingRequestSaveByChat.delete(chatId);
        if (!pendingSave) {
          await callTelegramBotApi('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⚠️ La consulta previa expiró.',
          }).catch(() => {});
          return;
        }
        const norm = normalizeRequestTitle(pendingSave.query);
        const dup = channelMediaRequests.find(
          (r) => r.ownerChatId === chatId && r.status === 'pending' && r.normalizedTitle === norm
        );
        if (!dup) {
          channelMediaRequests.unshift({
            id: `rq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
            ownerChatId: chatId,
            requestedTitle: pendingSave.query,
            normalizedTitle: norm,
            requestedByName: pendingSave.requesterName,
            ...(pendingSave.requesterUsername
              ? { requestedByUsername: pendingSave.requesterUsername }
              : {}),
            sourceType: 'manual',
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
          saveChannelMediaRequestsToDisk();
        }
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '📥 Pedido guardado en Pendientes',
        }).catch(() => {});
        await sendOrEditRequestsManagerInTelegram(
          chatId,
          messageId,
          'pending',
          0,
          undefined,
          `📥 <b>Pedido guardado:</b> ${escapeHtml(pendingSave.query)}`
        );
        return;
      }
      const reqId = parts[2] || '';
      const targetReq = channelMediaRequests.find(
        (r) => r.id === reqId && r.ownerChatId === chatId
      );
      if (!targetReq) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Pedido no encontrado.',
        }).catch(() => {});
        return;
      }
      if (action === 'check') {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Verificando en catálogo global de Picta...',
        }).catch(() => {});
        await processRequestQueryAndReplyOrSave({
          ownerChatId: chatId,
          replyChatId: chatId,
          query: targetReq.requestedTitle,
          requesterName: targetReq.requestedByName,
          requesterUsername: targetReq.requestedByUsername,
          autoSaveIfMissing: false,
        });
        return;
      }
      if (action === 'done') {
        targetReq.status = 'fulfilled';
        targetReq.fulfilledAt = new Date().toISOString();
        saveChannelMediaRequestsToDisk();
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '✅ Marcado como cumplido',
        }).catch(() => {});
        await sendOrEditRequestsManagerInTelegram(
          chatId,
          messageId,
          'pending',
          0,
          undefined,
          `✅ <b>Pedido marcado como cumplido:</b> ${escapeHtml(targetReq.requestedTitle)}`
        );
        return;
      }
      if (action === 'reply_cm') {
        if (!targetReq.commentPublicationId || !targetReq.commentId || !targetReq.matchedPictaUrl) {
          await callTelegramBotApi('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: 'Faltan datos del comentario o enlace en Picta.',
          }).catch(() => {});
          return;
        }
        const replyBody = `¡Hola! Ya subimos "${targetReq.requestedTitle}" al canal. Puedes verlo aquí: ${targetReq.matchedPictaUrl}`;
        await postPictaCommentInChannel(
          chatId,
          targetReq.commentPublicationId,
          replyBody,
          targetReq.commentId
        );
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '💬 Respuesta publicada en Picta',
        }).catch(() => {});
        await sendTelegramStatusMessage(
          chatId,
          `💬 <b>Comentario respondido en Picta</b> para el pedido <b>${escapeHtml(targetReq.requestedTitle)}</b>:\n<code>${escapeHtml(replyBody)}</code>`,
          messageId || undefined
        );
        return;
      }
      if (action === 'del') {
        if (targetReq.commentId) {
          ignoredRequestCommentIds.add(targetReq.commentId);
        }
        channelMediaRequests = channelMediaRequests.filter(
          (r) => !(r.id === reqId && r.ownerChatId === chatId)
        );
        saveChannelMediaRequestsToDisk();
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '🗑️ Pedido eliminado',
        }).catch(() => {});
        await sendOrEditRequestsManagerInTelegram(
          chatId,
          messageId,
          'pending',
          0,
          undefined,
          `🗑️ <b>Pedido eliminado de tu lista.</b>`
        );
        return;
      }
    }

    if (data === 'promo_cfg:disable') {
      const prevCfg = userPromoChannels.get(chatId);
      userPromoChannels.set(chatId, {
        chatId,
        targetChannelId: '',
        targetChannelLabel: '',
        requestsGroupChatId: prevCfg?.requestsGroupChatId,
        requestsGroupLabel: prevCfg?.requestsGroupLabel,
        requestsMonitorMode: prevCfg?.requestsMonitorMode,
        disabled: true,
        updatedAt: new Date().toISOString(),
      });
      saveUserPromoChannelsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🚫 Canal de pedidos desactivado para tu cuenta.',
      }).catch(() => {});
      await sendOrEditPromoChannelMenuInTelegram(
        chatId,
        messageId,
        undefined,
        '🚫 <b>Canal de Pedidos desactivado para tu cuenta.</b> Puedes configurarlo de nuevo cuando quieras.'
      );
      return;
    }

    if (data.startsWith('promo_back:')) {
      const promoId = data.slice('promo_back:'.length).trim();
      pendingToolkitInputByChat.delete(chatId);
      const promo = pendingMoviePromos.get(promoId);
      if (!promo || promo.ownerChatId !== chatId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Ficha promocional expirada.',
          show_alert: true,
        }).catch(() => {});
        await sendOrEditPromoChannelMenuInTelegram(chatId, messageId);
        return;
      }
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      const prompt = buildMoviePromoConfirmationPrompt(promo, chatId);
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, prompt.textHtml, prompt.keyboard as any, true);
      } else {
        await sendTelegramStatusMessage(chatId, prompt.textHtml, undefined, prompt.keyboard as any);
      }
      return;
    }

    if (data.startsWith('promo_preview:')) {
      const promoId = data.slice('promo_preview:'.length).trim();
      const promo = pendingMoviePromos.get(promoId);
      if (!promo || promo.ownerChatId !== chatId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Ficha promocional no disponible.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Enviando vista previa a tu chat privado...',
      }).catch(() => {});
      const res = await publishPromoRecordToTargetChat(promo, chatId);
      if (!res.ok) {
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>No se pudo generar la vista previa:</b> <code>${escapeHtml(String(res.error || 'Error desconocido').slice(0, 140))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('promo_skip:')) {
      const promoId = data.slice('promo_skip:'.length).trim();
      const promo = pendingMoviePromos.get(promoId);
      if (!promo || promo.ownerChatId !== chatId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Omitido.',
        }).catch(() => {});
        return;
      }
      pendingMoviePromos.delete(promoId);
      savePendingPromosToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '⏭️ Publicación en canal de pedidos omitida.',
      }).catch(() => {});
      if (messageId) {
        await editTelegramStatusMessage(
          chatId,
          messageId,
          `⏭️ <b>Ficha promocional omitida</b> para <b>${escapeHtml(promo.title)}</b>.\n<i>La subida en Picta permanece intacta.</i>`,
          [[{ text: '🌐 Ver Película en Picta', url: promo.pictaVideoUrl }]] as any,
          true
        );
      }
      return;
    }

    if (data.startsWith('promo_send:')) {
      const promoId = data.slice('promo_send:'.length).trim();
      const promo = pendingMoviePromos.get(promoId);
      if (!promo || promo.ownerChatId !== chatId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Esta ficha no te pertenece o ya expiró.',
          show_alert: true,
        }).catch(() => {});
        return;
      }

      const resolvedReq = resolveRequestsChannelForChat(
        chatId,
        MASTER_ADMIN_CHAT_ID,
        userPromoChannels,
        MASTER_PRIVATE_REQUESTS_CHANNEL
      );
      if (!resolvedReq.configured) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚙️ Configura primero tu Canal de Pedidos.',
          show_alert: true,
        }).catch(() => {});
        await sendOrEditPromoChannelMenuInTelegram(chatId, messageId, undefined, undefined, promoId);
        return;
      }

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '📢 Publicando ficha visual en tu Canal de Pedidos...',
      }).catch(() => {});

      const sendRes = await publishPromoRecordToTargetChat(promo, resolvedReq.targetChannelId);
      if (sendRes.ok) {
        promo.publishedToChannelId = resolvedReq.targetChannelId;
        promo.publishedAt = new Date().toISOString();
        savePendingPromosToDisk();

        const successHtml =
          `${hudHeader('FICHA PUBLICADA EN CANAL DE PEDIDOS')}\n` +
          hudBox([
            `🎬 <b>Película:</b> ${escapeHtml(promo.title)}${promo.year ? ` (${escapeHtml(promo.year)})` : ''}`,
            `📢 <b>Canal:</b> ${escapeHtml(resolvedReq.targetChannelLabel)}`,
            `🖼️ <b>Formato:</b> ${sendRes.viaFallbackText ? 'Ficha HTML enriquecida' : 'Portada HD + Ficha visual y botones directos'}`,
          ]);
        const successKb = [
          [{ text: '🎬 Ver Película en Picta', url: promo.pictaVideoUrl }],
          [{ text: `📺 ${promo.pictaChannelName.slice(0, 30)}`, url: promo.pictaChannelUrl }],
        ];
        if (messageId) {
          await editTelegramStatusMessage(chatId, messageId, successHtml, successKb as any, true);
        } else {
          await sendTelegramStatusMessage(chatId, successHtml, undefined, successKb as any);
        }
      } else {
        const failHtml =
          `⚠️ <b>No se pudo publicar en tu Canal de Pedidos</b> (<code>${escapeHtml(resolvedReq.targetChannelLabel)}</code>)\n\n` +
          `<blockquote><code>${escapeHtml(String(sendRes.error || 'Error de permisos en Telegram').slice(0, 180))}</code></blockquote>\n` +
          `<i>Verifica que el bot sea Administrador con permiso para publicar mensajes en ese canal. Tu video en Picta sigue publicado sin problema.</i>`;
        const failKb = [
          [{ text: '🔄 Reintentar Publicación', callback_data: `promo_send:${promo.promoId}` }],
          [
            { text: '⚙️ Configurar / Cambiar Canal', callback_data: `promo_cfg:prompt_for:${promo.promoId}` },
            { text: '⏭️ Omitir', callback_data: `promo_skip:${promo.promoId}` },
          ],
        ];
        if (messageId) {
          await editTelegramStatusMessage(chatId, messageId, failHtml, failKb, true);
        } else {
          await sendTelegramStatusMessage(chatId, failHtml, undefined, failKb);
        }
      }
      return;
    }

    if (data.startsWith('dash_pub:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando ficha del video...',
      }).catch(() => {});
      await sendOrEditPictaPubDetailInTelegram(chatId, messageId, pubId, returnSort, returnPage);
      return;
    }

    if (data === 'chan_editor:open' || data === 'chan_editor:refresh') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando configuración de tu canal...',
      }).catch(() => {});
      await sendOrEditChannelEditorMenu(chatId, messageId);
      return;
    }

    if (data.startsWith('chan_edit:')) {
      const mode = data.slice('chan_edit:'.length).trim() as PendingChannelEditState['mode'];
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

      const ctx = getEffectivePictaContext(chatId);
      if (!ctx.isLinked || !ctx.channelId) {
        await sendOrEditChannelEditorMenu(chatId, messageId);
        return;
      }

      if (mode === 'clasificacion') {
        pendingChannelEditByChat.set(chatId, { mode: 'clasificacion', messageId });
        const clasifRows = [
          PICTA_CHANNEL_CLASIFICACIONES.slice(0, 3).map((c) => ({
            text: `🔞 ${c}`,
            callback_data: `chan_set_clasif:${c}`,
          })),
          PICTA_CHANNEL_CLASIFICACIONES.slice(3).map((c) => ({
            text: `🔞 ${c}`,
            callback_data: `chan_set_clasif:${c}`,
          })),
          [{ text: '⬅️ Cancelar y Volver al Canal', callback_data: 'chan_editor:open' }],
        ];
        const promptText =
          `🔞 <b>CAMBIAR CLASIFICACIÓN DEL CANAL</b>\n` +
          `<blockquote>📺 <b>Canal:</b> ${escapeHtml(ctx.channelName)} (<code>#${escapeHtml(ctx.channelId)}</code>)</blockquote>\n` +
          `Selecciona la clasificación de edad para tu canal (o escríbela en el chat):`;
        if (messageId) {
          await editTelegramStatusMessage(chatId, messageId, promptText, clasifRows, true);
        } else {
          await sendTelegramStatusMessage(chatId, promptText, undefined, clasifRows);
        }
        return;
      }

      pendingChannelEditByChat.set(chatId, { mode, messageId });

      const prompts: Record<PendingChannelEditState['mode'], string> = {
        nombre: `✏️ <b>Escribe ahora en el chat el nuevo NOMBRE</b> para tu canal en Picta:`,
        alias: `🏷️ <b>Escribe ahora en el chat el nuevo LEMA / ALIAS</b> para tu canal en Picta:`,
        descripcion: `📝 <b>Escribe ahora en el chat la nueva DESCRIPCIÓN</b> para tu canal en Picta:`,
        clasificacion: `🔞 <b>Escribe la nueva CLASIFICACIÓN</b> (ej: TP, 7+, 12+, 16+, 18+):`,
        avatar: `👤 <b>Envía ahora al chat una FOTO o IMAGEN</b> para actualizar el <b>AVATAR (foto de perfil)</b> de tu canal en Picta:`,
        portada: `🖼️ <b>Envía ahora al chat una FOTO o IMAGEN</b> para actualizar la <b>PORTADA (banner)</b> de tu canal en Picta:`,
      };

      const promptText =
        `🏛️ <b>EDITAR PROPIEDAD DEL CANAL EN PICTA</b>\n` +
        `<blockquote>📺 <b>Canal:</b> ${escapeHtml(ctx.channelName)} (<code>#${escapeHtml(ctx.channelId)}</code>)</blockquote>\n` +
        `${prompts[mode] || 'Envía el nuevo valor al chat:'}`;
      const cancelKb = [[{ text: '⬅️ Cancelar y Volver al Canal', callback_data: 'chan_editor:open' }]];

      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, cancelKb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, cancelKb);
      }
      return;
    }

    if (data.startsWith('chan_set_clasif:')) {
      const clasifVal = data.slice('chan_set_clasif:'.length).trim();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Actualizando clasificación a ${clasifVal}...`,
      }).catch(() => {});
      try {
        await patchPictaChannelDetails(chatId, { clasificacion: clasifVal });
        await sendOrEditChannelEditorMenu(
          chatId,
          messageId,
          undefined,
          `✅ <b>¡Clasificación del canal actualizada a ${escapeHtml(clasifVal)}!</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditChannelEditorMenu(
          chatId,
          messageId,
          undefined,
          `⚠️ <b>No se pudo cambiar la clasificación:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('chan_toggle:')) {
      const field = data.slice('chan_toggle:'.length).trim() as 'publicado' | 'donacion';
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Actualizando canal en Picta...',
      }).catch(() => {});
      try {
        const current = await fetchPictaChannelDetails(chatId);
        const nextVal = field === 'publicado' ? !current.publicado : !current.donacion;
        await patchPictaChannelDetails(chatId, {
          [field]: nextVal ? 'true' : 'false',
          ...(field === 'donacion' ? { donar: nextVal ? 'true' : 'false' } : {}),
        });
        const notice =
          field === 'publicado'
            ? nextVal
              ? '🟢 <b>¡Tu canal ahora está Público (Visible) en Picta!</b>'
              : '🙈 <b>¡Tu canal ha sido ocultado en Picta!</b>'
            : nextVal
              ? '💳 <b>¡Donaciones activadas en tu canal de Picta!</b>'
              : '💳 <b>¡Donaciones desactivadas en tu canal de Picta!</b>';
        await sendOrEditChannelEditorMenu(chatId, messageId, undefined, notice);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditChannelEditorMenu(
          chatId,
          messageId,
          undefined,
          `⚠️ <b>No se pudo actualizar el canal:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data === 'chan_collabs:open') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando colaboradores del canal...',
      }).catch(() => {});
      await sendOrEditChannelCollaboratorsMenu(chatId, messageId);
      return;
    }

    if (data === 'chan_collabs:add_prompt') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'add_collaborator_id',
        messageId,
      });
      const promptText =
        `➕ <b>AÑADIR COLABORADOR AL CANAL EN PICTA</b>\n` +
        `<blockquote>` +
        `Escribe ahora en el chat cualquiera de estas opciones sobre tu socio:\n` +
        `• <b>Enlace directo o nombre de su canal en Picta</b> (ej: <code>https://www.picta.cu/canal/su-canal</code>)\n` +
        `• Su <b>nombre de usuario de Picta</b> (ej: <code>@usuario</code>)\n` +
        `• Su <b>ID numérico de usuario Picta</b> (ej: <code>994913</code>)` +
        `</blockquote>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'chan_collabs:open' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('chan_collabs:del:')) {
      const targetUserId = Number(data.slice('chan_collabs:del:'.length) || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Retirando colaborador #${targetUserId}...`,
      }).catch(() => {});
      try {
        await modifyChannelCollaboratorInPicta(chatId, targetUserId, 'remove');
        await sendOrEditChannelCollaboratorsMenu(
          chatId,
          messageId,
          undefined,
          `🗑️ <b>Colaborador <code>#${targetUserId}</code> retirado de tu canal en Picta.</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditChannelCollaboratorsMenu(
          chatId,
          messageId,
          undefined,
          `⚠️ <b>No se pudo retirar colaborador:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data === 'chan_switch:prompt') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'switch_channel_query',
        messageId,
      });
      const promptText =
        `📺 <b>VINCULAR O CAMBIAR TU CANAL DE PICTA</b>\n` +
        `<blockquote>` +
        `Escribe ahora en el chat el <b>enlace directo de tu canal</b> (ej: <code>https://www.picta.cu/canal/mi-canal</code>), el <b>slug</b> o su <b>ID numérico</b> (ej: <code>12345</code>):` +
        `</blockquote>\n` +
        `<i>💡 También puedes escribir parte del nombre de tu canal para buscarlo.</i>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'chan_editor:open' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('chan_switch:select:')) {
      const targetChanId = data.slice('chan_switch:select:'.length).trim();
      const isMaster = isMasterAdminChat(chatId);
      const masterChanId = String(botConfig.pictaChannelId || '36319');
      if (!isMaster && targetChanId === masterChanId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ No tienes acceso a ese canal.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      const session = userSessions.get(chatId);
      if (session) {
        try {
          const chk = await fetchPictaWithRetry(`https://api.picta.cu/v1/canal/${targetChanId}/`, {
            headers: {
              Authorization: `Bearer ${session.authToken}`,
              Origin: 'https://admin.picta.cu',
              Referer: 'https://admin.picta.cu/',
            },
          });
          if (chk.ok) {
            const dataObj = (await chk.json()) as any;
            if (!isMaster && (session.userId || session.username)) {
              const owned = isChannelOwnedOrAssociatedByUser(dataObj, {
                ...(session.userId ? { userId: session.userId } : {}),
                username: session.username,
                phone: session.username,
              });
              if (owned === false) {
                await callTelegramBotApi('answerCallbackQuery', {
                  callback_query_id: cq.id,
                  text: '⛔ Ese canal pertenece a otro usuario de Picta.',
                  show_alert: true,
                }).catch(() => {});
                return;
              }
            }
            session.channelId = targetChanId;
            session.channelName = String(dataObj?.nombre || `Canal #${targetChanId}`);
            session.verifiedChannelOwnership = true;
            if (!session.availableChannels.some((x) => String(x.id) === targetChanId)) {
              session.availableChannels.push({ id: Number(targetChanId), nombre: session.channelName });
            }
            saveUserSessionsToDisk();
            await callTelegramBotApi('answerCallbackQuery', {
              callback_query_id: cq.id,
              text: `✅ Canal vinculado: ${session.channelName}`,
            }).catch(() => {});
            await sendOrEditChannelEditorMenu(
              chatId,
              messageId,
              undefined,
              `✅ <b>Canal activo actualizado a:</b> ${escapeHtml(session.channelName)} (<code>#${targetChanId}</code>)\n` +
              `Todos tus videos y publicaciones se subirán a este canal.`
            );
            return;
          }
        } catch {
          // Continue
        }
      }
    }

    if (data.startsWith('playlists_menu:')) {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando listas de reproducción del canal...',
      }).catch(() => {});
      await sendOrEditPlaylistsMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'playlist_create_prompt') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'new_playlist_name',
        messageId,
      });
      const promptText =
        `➕ <b>CREAR NUEVA LISTA DE REPRODUCCIÓN EN TU CANAL</b>\n` +
        `<blockquote>` +
        `Escribe ahora en el chat el <b>nombre de la nueva Lista de Reproducción</b> (ej: <i>Películas de Acción</i>, <i>Series en Emisión</i>):` +
        `</blockquote>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'playlists_menu:0' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('playlist_del:')) {
      const playlistId = Number(data.slice('playlist_del:'.length) || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Eliminando lista de reproducción...',
      }).catch(() => {});
      try {
        await deleteChannelPlaylistInPicta(chatId, playlistId);
        await sendOrEditPlaylistsMenuInTelegram(
          chatId,
          messageId,
          undefined,
          `🗑️ <b>Lista de reproducción <code>#${playlistId}</code> eliminada de Picta.</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditPlaylistsMenuInTelegram(
          chatId,
          messageId,
          undefined,
          `⚠️ <b>No se pudo eliminar la lista:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('comments_menu:')) {
      const pubId = Number(data.slice('comments_menu:'.length) || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando Dashboard de Comentarios...',
      }).catch(() => {});
      await sendOrEditCommentsMenuInTelegram(
        chatId,
        messageId,
        pubId > 0 ? pubId : undefined
      );
      return;
    }

    if (data.startsWith('cm_d:') || data.startsWith('cm_r:')) {
      const isRefresh = data.startsWith('cm_r:');
      const parts = data.split(':');
      const catKey = parts[1] || 'all';
      const sortRaw = parts[2] || 'recent';
      const sortMode: CommentsDashboardSort =
        sortRaw === 'oldest' || sortRaw === 'video' ? sortRaw : 'recent';
      const page = Number(parts[3] || 0) || 0;
      const pubId = Number(parts[4] || 0) || 0;
      if (isRefresh) {
        invalidateChannelCommentsCache();
      }
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: isRefresh ? 'Sincronizando todos los comentarios con Picta...' : 'Actualizando vista...',
      }).catch(() => {});
      await sendOrEditCommentsMenuInTelegram(
        chatId,
        messageId,
        pubId > 0 ? pubId : undefined,
        undefined,
        undefined,
        { catKey, sort: sortMode, page, forceRefresh: isRefresh }
      );
      return;
    }

    if (data.startsWith('comment_reply_prompt:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const parentId = Number(parts[2] || 0);
      const prevView = lastCommentsViewByChat.get(chatId);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'reply_comment_text',
        targetId: pubId,
        secondaryId: parentId,
        messageId,
      });
      const promptText =
        `💬 <b>${parentId > 0 ? 'RESPONDER COMENTARIO EN PICTA' : 'PUBLICAR COMENTARIO EN VIDEO'}</b>\n` +
        `<blockquote>` +
        `🎬 <b>Video ID:</b> <code>#${pubId}</code>${parentId > 0 ? ` · ↩️ <b>Respuesta a comentario:</b> <code>#${parentId}</code>` : ''}` +
        `</blockquote>\n` +
        `✍️ <b>Escribe ahora en el chat el texto de tu respuesta/comentario:</b>`;
      const cancelCallback = prevView
        ? `cm_d:${prevView.catKey}:${prevView.sort}:${prevView.page}:${prevView.pubId}`
        : `comments_menu:${pubId}`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: cancelCallback }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('comment_del:')) {
      const parts = data.split(':');
      const commentId = Number(parts[1] || 0);
      const returnPubId = Number(parts[2] || 0);
      const prevView = lastCommentsViewByChat.get(chatId);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Eliminando comentario...',
      }).catch(() => {});
      try {
        await deletePictaCommentInChannel(chatId, commentId);
        await sendOrEditCommentsMenuInTelegram(
          chatId,
          messageId,
          returnPubId > 0 ? returnPubId : undefined,
          undefined,
          `🗑️ <b>Comentario <code>#${commentId}</code> eliminado de Picta.</b>`,
          prevView
            ? { catKey: prevView.catKey, sort: prevView.sort, page: prevView.page, forceRefresh: true }
            : { forceRefresh: true }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditCommentsMenuInTelegram(
          chatId,
          messageId,
          returnPubId > 0 ? returnPubId : undefined,
          undefined,
          `⚠️ <b>No se pudo borrar el comentario:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`,
          prevView ? { catKey: prevView.catKey, sort: prevView.sort, page: prevView.page } : undefined
        );
      }
      return;
    }

    if (data.startsWith('comment_del_alert:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const commentId = Number(parts[2] || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Eliminando comentario de Picta...',
      }).catch(() => {});
      try {
        await deletePictaCommentInChannel(chatId, commentId);
        if (messageId) {
          await editTelegramStatusMessage(
            chatId,
            messageId,
            `🗑️ <b>Comentario <code>#${commentId}</code> eliminado en Picta</b> (Video #${pubId}).`,
            undefined,
            true
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>No se pudo borrar el comentario #${commentId}:</b> <code>${escapeHtml(msg.slice(0, 140))}</code>`,
          messageId || undefined
        );
      }
      return;
    }

    if (data === 'personas_menu') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Abriendo catálogo de actores y etiquetas...',
      }).catch(() => {});
      await sendOrEditPersonasAndTagsMenuInTelegram(chatId, messageId);
      return;
    }

    if (data === 'persona_create_prompt') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'new_persona_name',
        messageId,
      });
      const promptText =
        `👤 <b>BUSCAR O REGISTRAR ACTOR / DIRECTOR EN PICTA</b>\n` +
        `<blockquote>Escribe ahora el <b>nombre completo del actor o director</b> (ej: <i>Simon Baker</i>, <i>Pedro Pascal</i>) para buscar su ID o darlo de alta en Picta:</blockquote>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'personas_menu' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data === 'keyword_create_prompt') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingToolkitInputByChat.set(chatId, {
        mode: 'new_keyword_name',
        messageId,
      });
      const promptText =
        `🏷️ <b>BUSCAR O CREAR ETIQUETA / PALABRA CLAVE EN PICTA</b>\n` +
        `<blockquote>Escribe ahora la <b>etiqueta o palabra clave</b> (ej: <i>Suspenso</i>, <i>Estreno 2026</i>) para registrarla en el buscador de Picta:</blockquote>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'personas_menu' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('serie_meta_edit:')) {
      const parts = data.split(':');
      const editField = parts[1] as 'name' | 'synopsis' | 'cover' | 'portada' | 'poster';
      const pelserId = Number(parts[2] || 0);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

      const ctx = getEffectivePictaContext(chatId);
      if (!ctx.isLinked || !ctx.channelId) {
        await sendOrEditMyChannelSeriesMenu(chatId, messageId);
        return;
      }
      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = serieRec?.nombre || `Serie #${pelserId}`;

      const stateMode: PendingStandaloneSerieState['mode'] =
        editField === 'name'
          ? 'edit_serie_name'
          : editField === 'synopsis'
            ? 'edit_serie_synopsis'
            : editField === 'portada'
              ? 'edit_serie_portada'
              : editField === 'poster'
                ? 'edit_serie_poster'
                : 'edit_serie_cover';

      pendingStandaloneSerieByChat.set(chatId, {
        mode: stateMode,
        pelserId,
        serieName,
        messageId,
      });

      const instructions =
        editField === 'name'
          ? '✏️ <b>Escribe ahora en el chat el nuevo NOMBRE</b> para esta Serie en Picta:'
          : editField === 'synopsis'
            ? '📝 <b>Escribe ahora en el chat la nueva SINOPSIS en español</b> para la ficha principal de esta Serie:'
            : editField === 'portada'
              ? '🖼️ <b>Envía ahora al chat una FOTO o IMAGEN horizontal (16:9)</b> para actualizar la <b>Portada</b> de esta Serie en Picta, o aplícala automáticamente desde TMDB:'
              : '🎞️ <b>Envía ahora al chat una FOTO o IMAGEN vertical (2:3)</b> para actualizar el <b>Póster</b> de esta Serie en Picta, o aplícalo automáticamente desde TMDB:';

      const promptText =
        `📺 <b>EDITAR FICHA DE LA SERIE · ${escapeHtml(serieName.toUpperCase())}</b>\n` +
        `<blockquote>🆔 <b>ID Serie en Picta:</b> <code>#${pelserId}</code></blockquote>\n` +
        `${instructions}`;
      const kb: Array<Array<{ text: string; callback_data: string }>> = [];
      if (editField === 'portada' || editField === 'poster' || editField === 'cover') {
        const slot: PictaImageSlot = editField === 'portada' ? 'portada' : 'poster';
        kb.push([
          {
            text:
              slot === 'portada'
                ? '🎬 Aplicar Portada Oficial TMDB'
                : '🎬 Aplicar Póster Oficial TMDB',
            callback_data: `serie_tmdb_img:${slot}:${pelserId}`,
          },
        ]);
        kb.push([
          {
            text: '✨ Aplicar Portada y Póster ambos (TMDB)',
            callback_data: `serie_tmdb_img:both:${pelserId}`,
          },
        ]);
      }
      kb.push([{ text: '⬅️ Cancelar', callback_data: `serie_manage:${pelserId}:0` }]);
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('serie_tmdb_img:')) {
      const parts = data.split(':');
      const slot = (parts[1] || 'poster') as PictaImageSlot;
      const pelserId = Number(parts[2] || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Buscando imagen oficial en TMDB...',
      }).catch(() => {});

      pendingStandaloneSerieByChat.delete(chatId);
      const ctx = getEffectivePictaContext(chatId);
      if (!ctx.isLinked || !ctx.channelId) {
        await sendOrEditMyChannelSeriesMenu(chatId, messageId);
        return;
      }

      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = cleanSerieDisplayName(serieRec?.nombre || '') || `Serie #${pelserId}`;

      try {
        const { portadaBuffer, posterBuffer } = await fetchTmdbSlotBuffersForTitle(serieName, 5);
        const patchFiles = buildSerieImagePatchFiles({
          slot,
          tmdbPortadaBuffer: portadaBuffer,
          tmdbPosterBuffer: posterBuffer,
        });
        if (!patchFiles.portadaBuffer && !patchFiles.posterBuffer) {
          throw new Error(`No se encontró imagen oficial en TMDB para "${serieName}".`);
        }
        await patchSerieInPictaChannel(chatId, pelserId, patchFiles);
        const label =
          slot === 'both'
            ? 'Portada horizontal y Póster vertical'
            : slot === 'portada'
              ? 'Portada horizontal'
              : 'Póster vertical';
        await sendOrEditSerieDetailInTelegram(
          chatId,
          messageId,
          pelserId,
          0,
          `✅ <b>¡${label} de la serie actualizado(s) desde TMDB en Picta!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditSerieDetailInTelegram(
          chatId,
          messageId,
          pelserId,
          0,
          `⚠️ <b>No se pudo aplicar imagen TMDB a la serie:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('serie_del_ask:')) {
      const pelserId = Number(data.slice('serie_del_ask:'.length) || 0);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      const ctx = getEffectivePictaContext(chatId);
      if (!ctx.isLinked || !ctx.channelId) {
        await sendOrEditMyChannelSeriesMenu(chatId, messageId);
        return;
      }
      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = serieRec?.nombre || `Serie #${pelserId}`;

      const confirmText =
        `⚠️ <b>¿CONFIRMAS ELIMINAR LA SERIE "${escapeHtml(serieName.toUpperCase())}" DE PICTA?</b>\n` +
        `<blockquote>🆔 <b>ID Serie:</b> <code>#${pelserId}</code>\nEsta acción ejecutará <code>DELETE /v1/serie/${pelserId}/</code> en Picta.</blockquote>`;
      const kb = [
        [{ text: '🗑️ Sí, Eliminar Serie', callback_data: `serie_del_confirm:${pelserId}` }],
        [{ text: '⬅️ Cancelar', callback_data: `serie_manage:${pelserId}:0` }],
      ];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, confirmText, kb, true);
      }
      return;
    }

    if (data.startsWith('serie_del_confirm:')) {
      const pelserId = Number(data.slice('serie_del_confirm:'.length) || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Eliminando serie de Picta...',
      }).catch(() => {});
      try {
        await deleteSerieInPictaChannel(chatId, pelserId);
        await sendOrEditMyChannelSeriesMenu(
          chatId,
          messageId,
          undefined,
          `🗑️ <b>Serie <code>#${pelserId}</code> eliminada correctamente de Picta.</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditSerieDetailInTelegram(
          chatId,
          messageId,
          pelserId,
          0,
          `⚠️ <b>No se pudo eliminar la serie:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    // Direct Published Video Editing Callbacks
    if (data.startsWith('pub_edit:')) {
      const parts = data.split(':');
      const mode = parts[1] as 'title' | 'desc' | 'cover' | 'poster' | 'both' | 'subs' | 'epnum' | 'tags';
      const pubId = Number(parts[2] || 0);
      const returnSort = parts[3] || 'views';
      const returnPage = Number(parts[4] || 0);

      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

      const pubs = await fetchPictaChannelPublications(chatId).catch(() => []);
      const pub = pubs.find((p) => Number(p.id) === pubId);
      let pubTitle = String(pub?.nombre || '');
      if (!pubTitle) {
        const foundCap = findUserChannelChapter(pubId, chatId);
        if (foundCap) {
          pubTitle = foundCap.chapter.nombre;
        }
      }
      if (!pubTitle) pubTitle = `Video #${pubId}`;

      pendingPubEditByChat.set(chatId, {
        pubId,
        pubTitle,
        mode,
        messageId,
        returnSort,
        returnPage,
      });

      const modeInstructions: Record<string, string> = {
        title: `✏️ <b>Escribe ahora en el chat el nuevo TÍTULO</b> para este video en Picta:`,
        desc: `📝 <b>Escribe ahora en el chat la nueva DESCRIPCIÓN / SINOPSIS</b> para este video en Picta (el bot limpiará cualquier ID automáticamente):`,
        cover: `🖼️ <b>Envía ahora al chat una FOTO o IMAGEN horizontal (16:9)</b> para actualizar la <b>Portada</b> de este video en Picta, o aplícala automáticamente desde TMDB:`,
        poster: `🎞️ <b>Envía ahora al chat una FOTO o IMAGEN vertical (2:3)</b> para actualizar el <b>Póster</b> de este video en Picta, o aplícalo automáticamente desde TMDB:`,
        subs: `💬 <b>Envía ahora al chat el archivo de subtítulos (<code>.srt</code> o <code>.vtt</code>)</b> para adjuntarlo a este video en Picta:`,
        epnum: `🔢 <b>Escribe ahora el nuevo número de Capítulo</b> (ej: <code>4</code>) o <b>Temporada | Capítulo</b> (ej: <code>1 | 4</code>) para actualizar este capítulo en Picta:`,
        tags: `🏷️ <b>Escribe ahora las etiquetas separadas por coma</b> (ej: <code>Acción, Suspenso, Estreno</code>) para registrarlas y asignarlas al video en Picta:`,
      };

      const promptText =
        `🛠️ <b>EDITAR CAPÍTULO / VIDEO EN PICTA</b>\n` +
        `<blockquote>` +
        `🎬 <b>Video:</b> ${escapeHtml(pubTitle)}` +
        `</blockquote>\n` +
        `${modeInstructions[mode] || 'Envía el nuevo valor al chat:'}`;

      const cancelKb: Array<Array<{ text: string; callback_data: string }>> = [];
      if (mode === 'cover' || mode === 'poster') {
        const slot: PictaImageSlot = mode === 'poster' ? 'poster' : 'portada';
        cancelKb.push([
          {
            text:
              slot === 'poster'
                ? '🎬 Aplicar Póster Oficial TMDB'
                : '🎬 Aplicar Portada Oficial TMDB',
            callback_data: `pub_tmdb_img:${slot}:${pubId}:${returnSort}:${returnPage}`,
          },
        ]);
        cancelKb.push([
          {
            text: '✨ Aplicar Portada y Póster ambos (TMDB)',
            callback_data: `pub_tmdb_img:both:${pubId}:${returnSort}:${returnPage}`,
          },
        ]);
      }
      cancelKb.push([
        {
          text: '⬅️ Cancelar y Volver',
          callback_data: `dash_pub:${pubId}:${returnSort}:${returnPage}`,
        },
      ]);

      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, cancelKb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, cancelKb);
      }
      return;
    }

    if (data.startsWith('pub_tmdb_img:')) {
      const parts = data.split(':');
      const slot = (parts[1] || 'poster') as PictaImageSlot;
      const pubId = Number(parts[2] || 0);
      const returnSort = parts[3] || 'views';
      const returnPage = Number(parts[4] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Buscando carátula/póster oficial en TMDB...',
      }).catch(() => {});

      pendingPubEditByChat.delete(chatId);

      try {
        const pubs = await fetchPictaChannelPublications(chatId).catch(() => []);
        const pub = pubs.find((item) => Number(item.id) === pubId);
        const foundCap = findUserChannelChapter(pubId, chatId);
        const pubTitle = String(pub?.nombre || foundCap?.chapter?.nombre || `Video #${pubId}`);
        const parentSerieName = foundCap?.serie?.nombre;
        const tipId = Number(pub?.categoria?.tipologia?.id || (foundCap ? 5 : 1));

        const { portadaBuffer, posterBuffer } = await fetchTmdbSlotBuffersForTitle(
          pubTitle,
          tipId,
          parentSerieName
        );
        const patchFiles = buildPublicationImagePatchFiles({
          slot,
          tmdbPortadaBuffer: portadaBuffer,
          tmdbPosterBuffer: posterBuffer,
        });
        if (!patchFiles.coverBuffer && !patchFiles.posterBuffer) {
          throw new Error(`No se encontró portada/póster oficial en TMDB para "${pubTitle}".`);
        }

        await patchPictaPublicationInChannel(pubId, {}, patchFiles, chatId);
        const label =
          slot === 'both'
            ? 'Portada y Póster'
            : slot === 'poster'
              ? 'Póster vertical'
              : 'Portada horizontal';
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `✅ <b>¡${label} actualizado(s) desde TMDB exitosamente en Picta!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `⚠️ <b>No se pudo aplicar desde TMDB:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('pub_toggle_dl:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Actualizando permiso de descarga en Picta...',
      }).catch(() => {});

      try {
        const pubs = await fetchPictaChannelPublications(chatId).catch(() => []);
        const pub = pubs.find((p) => Number(p.id) === pubId);
        const nextDl = pub?.descarga === false ? 'true' : 'false';
        await patchPictaPublicationInChannel(pubId, { descarga: nextDl }, undefined, chatId);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          nextDl === 'true'
            ? '📥 <b>Descarga directa ACTIVADA para este video en Picta.</b>'
            : '🔒 <b>Descarga directa BLOQUEADA para este video en Picta.</b>'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `⚠️ <b>No se pudo cambiar descarga:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('pub_direct_dl:')) {
      const pubId = Number(data.slice('pub_direct_dl:'.length) || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Generando enlaces directos de descarga...',
      }).catch(() => {});

      try {
        const direct = await fetchPictaPublicationDirectLinks(chatId, pubId);
        const dlUrl = direct.url_descarga || direct.url_video;
        const maniUrl = direct.url_manifiesto;

        const dlBlock = dlUrl
          ? `📥 <b>Enlace de Descarga Directa (Archivo Video/MP4):</b>\n<code>${escapeHtml(dlUrl)}</code>\n\n`
          : `📥 <i>Enlace MP4 directo aún procesándose en los servidores de Picta.</i>\n\n`;

        const maniBlock = maniUrl
          ? `📺 <b>Enlace de Streaming Directo (HLS .m3u8):</b>\n<code>${escapeHtml(maniUrl)}</code>\n\n`
          : '';

        const webUrl = `https://www.picta.cu/medias/${pubId}`;

        const text =
          `🚪 <b>ENLACES DIRECTOS ("PUERTA TRASERA") · PICTA</b>\n` +
          `<blockquote>` +
          `🎬 <b>Título:</b> ${escapeHtml(direct.nombre)}\n` +
          `🆔 <b>ID Picta:</b> <code>#${pubId}</code>\n` +
          (direct.tamanio > 0 ? `📦 <b>Tamaño:</b> ${formatBytes(direct.tamanio)}\n` : '') +
          `🌐 <b>Web Oficial:</b> ${webUrl}` +
          `</blockquote>\n\n` +
          `${dlBlock}` +
          `${maniBlock}` +
          `💡 <i>Puedes abrir o copiar estos enlaces en tu navegador, gestor de descargas (IDM, FDM) o reproductor VLC para descargar o ver el video directamente sin pasar por la web de Picta.</i>`;

        const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
        if (dlUrl && dlUrl.startsWith('http')) {
          keyboard.push([{ text: '📥 Descargar Archivo Directo (MP4)', url: dlUrl }]);
        }
        if (maniUrl && maniUrl.startsWith('http')) {
          keyboard.push([{ text: '📺 Abrir Stream HLS (.m3u8)', url: maniUrl }]);
        }
        keyboard.push([
          { text: '🌐 Abrir en Picta Web', url: webUrl },
          { text: '⬅️ Volver', callback_data: `dash_pub:${pubId}:views:0` },
        ]);

        if (messageId) {
          await editTelegramStatusMessage(chatId, messageId, text, keyboard as any, true);
        } else {
          await sendTelegramStatusMessage(chatId, text, undefined, keyboard as any);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>No se pudieron extraer los enlaces directos del video #${pubId}:</b>\n<code>${escapeHtml(msg.slice(0, 140))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('pub_dl_link:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Obteniendo enlaces directos de Picta...',
      }).catch(() => {});

      try {
        const pubs = await fetchPictaChannelPublications(chatId).catch(() => []);
        const pub = pubs.find((p) => Number(p.id) === pubId) || { id: pubId };
        const links = extractPictaPublicationLinks(pub);
        const linkNotice =
          `🔗 <b>ENLACES DIRECTOS DEL VIDEO (#${pubId}):</b>\n` +
          `• 🌐 <b>Web Picta:</b> ${escapeHtml(links.webUrl)}\n` +
          (links.directStreamUrl
            ? `• 🎞️ <b>Stream/HLS:</b> <code>${escapeHtml(links.directStreamUrl)}</code>\n`
            : '') +
          (links.coverUrl
            ? `• 🖼️ <b>Portada:</b> <code>${escapeHtml(links.coverUrl)}</code>`
            : '');
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          linkNotice
        );
      } catch {
        await sendOrEditPictaPubDetailInTelegram(chatId, messageId, pubId, returnSort, returnPage);
      }
      return;
    }

    if (data.startsWith('pub_add_playlist_pick:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando listas de reproducción...',
      }).catch(() => {});

      const playlists = await fetchChannelPlaylistsInPicta(chatId).catch(() => []);
      const kb: Array<Array<{ text: string; callback_data: string }>> = [];
      for (const pl of playlists.slice(0, 8)) {
        kb.push([
          {
            text: `📂 Añadir a "${pl.nombre.slice(0, 26)}" (#${pl.id})`,
            callback_data: `pub_add_playlist_do:${pl.id}:${pubId}:${returnSort}:${returnPage}`,
          },
        ]);
      }
      kb.push([
        { text: '➕ Crear Nueva Lista (/listas)', callback_data: 'playlist_create_prompt' },
        { text: '⬅️ Volver al Video', callback_data: `dash_pub:${pubId}:${returnSort}:${returnPage}` },
      ]);

      const text =
        `📂 <b>AÑADIR VIDEO #${pubId} A UNA LISTA DE REPRODUCCIÓN</b>\n\n` +
        (playlists.length > 0
          ? `Selecciona en qué lista de reproducción de tu canal deseas incluir este video:`
          : `<i>Aún no tienes listas creadas en tu canal. Pulsa "➕ Crear Nueva Lista" abajo para crear una.</i>`);

      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, text, kb, true);
      }
      return;
    }

    if (data.startsWith('pub_add_playlist_do:')) {
      const parts = data.split(':');
      const playlistId = Number(parts[1] || 0);
      const pubId = Number(parts[2] || 0);
      const returnSort = parts[3] || 'views';
      const returnPage = Number(parts[4] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Añadiendo video a la lista de reproducción...',
      }).catch(() => {});

      try {
        await addPublicationToPlaylistInPicta(chatId, playlistId, pubId);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `✅ <b>¡Video añadido exitosamente a la Lista de Reproducción <code>#${playlistId}</code>!</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `⚠️ <b>No se pudo añadir a la lista:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('pub_toggle_vis:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Actualizando visibilidad en Picta...',
      }).catch(() => {});

      try {
        const directBefore = await fetchSinglePictaPublicationDirect(pubId, chatId);
        const pubs = directBefore ? [] : await fetchPictaChannelPublications(chatId).catch(() => []);
        const pub = directBefore || pubs.find((p) => Number(p.id) === pubId);
        let currentPubState = pub?.publicado;
        const foundCap = findUserChannelChapter(pubId, chatId);
        if (typeof currentPubState !== 'boolean' && foundCap) {
          currentPubState = foundCap.chapter.publicado !== false;
        }
        const nextPublished = currentPubState === false ? 'true' : 'false';
        const patchResult = await patchPictaPublicationInChannel(
          pubId,
          { publicado: nextPublished },
          undefined,
          chatId
        );
        const verifiedAfter = await fetchSinglePictaPublicationDirect(pubId, chatId);
        const actualPublished =
          typeof verifiedAfter?.publicado === 'boolean'
            ? verifiedAfter.publicado
            : typeof patchResult?.publicado === 'boolean'
              ? patchResult.publicado
              : nextPublished === 'true';

        if (foundCap) {
          foundCap.chapter.publicado = actualPublished;
          saveChannelSeriesToDisk(channelSeriesCache);
        }

        const bannerResult =
          nextPublished === 'true'
            ? actualPublished
              ? '✅ <b>Video publicado en tu canal de Picta (verificado en vivo).</b>'
              : '⚠️ <b>Picta mantuvo el video SIN PUBLICAR.</b>\n<i>Este video nunca fue aprobado por moderación en Picta o no completó la conversión Nomad. Picta no permite forzar su publicación hasta que un moderador lo apruebe (puedes eliminarlo si deseas limpiar la auditoría).</i>'
            : !actualPublished
              ? '🙈 <b>Video ocultado de tu canal en Picta (verificado en vivo).</b>'
              : '⚠️ <b>Picta mantuvo el video publicado.</b>';

        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          bannerResult
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `⚠️ <b>Aviso al cambiar visibilidad:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('pub_del_ask:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);

      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

      const foundCap = findUserChannelChapter(pubId, chatId);
      const capTitle = foundCap?.chapter.nombre || `Publicación #${pubId}`;

      const confirmText =
        `⚠️ <b>¿CONFIRMAS ELIMINAR ESTE VIDEO DE PICTA?</b>\n` +
        `<blockquote>` +
        `🎬 <b>Video:</b> ${escapeHtml(capTitle)}\n` +
        `Esta acción eliminará o retirará el capítulo/video de tu canal en Picta.` +
        `</blockquote>`;

      const confirmKb = [
        [
          {
            text: '🗑️ Sí, Eliminar Definitivamente',
            callback_data: `pub_del_confirm:${pubId}:${returnSort}:${returnPage}`,
          },
        ],
        [
          {
            text: '⬅️ Cancelar',
            callback_data: returnSort.startsWith('serie_')
              ? `serie_manage:${returnSort.replace('serie_', '')}:${returnPage}`
              : `dash_pub:${pubId}:${returnSort}:${returnPage}`,
          },
        ],
      ];

      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, confirmText, confirmKb, true);
      }
      return;
    }

    if (data.startsWith('pub_del_confirm:')) {
      const parts = data.split(':');
      const pubId = Number(parts[1] || 0);
      const returnSort = parts[2] || 'views';
      const returnPage = Number(parts[3] || 0);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Eliminando de Picta...',
      }).catch(() => {});

      try {
        await deletePictaPublicationInChannel(pubId, chatId);
        const ctx = getEffectivePictaContext(chatId);
        const scopedSeries = filterSeriesForChannel(
          channelSeriesCache,
          ctx.channelId,
          isMasterAdminChat(chatId),
          botConfig.pictaChannelId || '36319'
        );
        for (const s of scopedSeries) {
          if (Array.isArray(s.chapters)) {
            s.chapters = s.chapters.filter((c) => Number(c.pubId) !== pubId);
          }
        }
        saveChannelSeriesToDisk(channelSeriesCache);

        if (returnSort.startsWith('serie_')) {
          const sPelserId = Number(returnSort.replace('serie_', ''));
          await sendOrEditSerieDetailInTelegram(
            chatId,
            messageId,
            sPelserId,
            returnPage,
            `🗑️ <b>Capítulo eliminado correctamente de Picta.</b>`
          );
        } else {
          await sendOrEditPictaDashboardInTelegram(chatId, messageId, returnSort as any, returnPage);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          messageId,
          pubId,
          returnSort,
          returnPage,
          `⚠️ <b>No se pudo eliminar:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    // Queue Manager & Live Cancellation & Modo Serie Fija Callbacks
    if (data === 'queue_view') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando cola de subida...',
      }).catch(() => {});
      await sendOrEditQueueManagerInTelegram(chatId, messageId);
      return;
    }

    if (data === 'quota_menu') {
      pendingPoolAccountByChat.delete(chatId);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Abriendo gestor de cuota diaria y Pool...',
      }).catch(() => {});
      await sendOrEditQuotaMenuInTelegram(chatId, messageId);
      return;
    }

    if (data.startsWith('quota_split:')) {
      if (!isMasterAdminChat(chatId)) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Solo el Administrador Principal puede configurar el Pool multi-cuenta.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      const maxS = Number(data.slice('quota_split:'.length) || 0);
      ensureDailyQuotaReset();
      quotaSettings.maxSeriesPerDay = isNaN(maxS) || maxS < 0 ? 0 : maxS;
      saveQuotaSettingsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text:
          quotaSettings.maxSeriesPerDay > 0
            ? `Cuota dividida: ${quotaSettings.maxSeriesPerDay} Series / ${10 - quotaSettings.maxSeriesPerDay} Películas`
            : 'Cuota 10/10 sin reserva activada',
      }).catch(() => {});
      await sendOrEditQuotaMenuInTelegram(
        chatId,
        messageId,
        undefined,
        quotaSettings.maxSeriesPerDay > 0
          ? `✅ <b>División de cuota actualizada:</b> Máximo <b>${quotaSettings.maxSeriesPerDay} capítulos de Serie</b> al día en la cuenta principal (reservando <b>${Math.max(0, 10 - quotaSettings.maxSeriesPerDay)} cupos</b> para películas u otros videos).`
          : `✅ <b>Reserva desactivada:</b> Los 10 cupos diarios de cada cuenta están 100% libres para Series o Películas.`
      );
      return;
    }

    if (data.startsWith('quota_unlock_and_retry:')) {
      if (!isMasterAdminChat(chatId)) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Acción reservada al Administrador Principal.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      const targetJobId = data.slice('quota_unlock_and_retry:'.length);
      ensureDailyQuotaReset();
      quotaSettings.maxSeriesPerDay = 0;
      saveQuotaSettingsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🔓 Cupos liberados. Reanudando subida de la serie...',
      }).catch(() => {});
      const job = transferJobs.find((j) => j.id === targetJobId);
      if (job) {
        job.errorDetails = undefined;
        saveJobsToDisk();
        await triggerCloudRunKeepAliveTransfer(job.id, job.title, messageId || job.statusMessageId);
      }
      return;
    }

    if (data === 'quota_resume_queue') {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '▶️ Reanudando tu cola de subida...',
      }).catch(() => {});
      const isMaster = isMasterAdminChat(chatId);
      const myQueueIds = uploadQueue.filter((qId) => {
        const j = transferJobs.find((x) => x.id === qId);
        return j && (isMaster || j.telegramChatId === chatId);
      });
      for (const qId of myQueueIds) {
        const j = transferJobs.find((x) => x.id === qId);
        if (j && j.errorDetails) {
          j.errorDetails = undefined;
        }
      }
      saveJobsToDisk();
      void scheduleTransferPipeline();
      await sendOrEditQueueManagerInTelegram(
        chatId,
        messageId,
        undefined,
        `▶️ <b>Cola de subida reanudada.</b>`
      );
      return;
    }

    if (data === 'quota_add_account') {
      const ctx = getEffectivePictaContext(chatId);
      if (!isMasterAdminChat(chatId) && (!ctx.isLinked || !ctx.channelId)) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Vincula primero tu cuenta y canal con /login para añadir colaboradores al Pool.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingPoolAccountByChat.set(chatId, { step: 'awaiting_username', messageId });
      const promptText =
        `➕ <b>AÑADIR CUENTA COLABORADORA AL POOL (+10 VIDEOS/DÍA)</b>\n` +
        `<blockquote>` +
        `La cuenta que agregues aquí quedará guardada en tu Pool y asociada como colaboradora de tu canal <b>${escapeHtml(ctx.channelName || 'Canal Oficial')} (#${escapeHtml(ctx.channelId || '36319')})</b>.` +
        `</blockquote>\n` +
        `📱 <b>PASO 1/2:</b> Escribe ahora en el chat el <b>número de teléfono (+53...)</b> o <b>usuario de Picta</b> de la cuenta colaboradora:\n\n` +
        `<i>(O escribe /cancelar para volver)</i>`;
      const kb = [[{ text: '⬅️ Cancelar y Volver a Cuota', callback_data: 'quota_menu' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('quota_del_account:')) {
      const chatPool = getPoolAccountsForChat(chatId);
      const idx = Number(data.slice('quota_del_account:'.length));
      const removed =
        !isNaN(idx) && idx >= 0 && idx < chatPool.length
          ? chatPool.splice(idx, 1)[0]
          : null;
      savePoolAccountsForChat(chatId);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: removed ? `Cuenta ${removed.username} eliminada del Pool` : 'Cuenta no encontrada',
      }).catch(() => {});
      await sendOrEditQuotaMenuInTelegram(
        chatId,
        messageId,
        undefined,
        removed
          ? `🗑️ <b>Cuenta secundaria <code>${escapeHtml(removed.displayName || removed.username)}</code> retirada del Pool.</b>`
          : undefined
      );
      return;
    }

    if (data.startsWith('retry_acct:')) {
      pendingPoolAccountByChat.delete(chatId);
      const jobId = data.slice('retry_acct:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      job.preferredUploadAccountKey = undefined;
      job.preferredUploadAccountLabel = undefined;
      saveJobsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Elige la cuenta para reintentar...',
      }).catch(() => {});
      await promptUploadAccountSelection(job, chatId, messageId);
      return;
    }

    if (data.startsWith('upload_acct_add:')) {
      const jobId = data.slice('upload_acct_add:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      const ctx = getEffectivePictaContext(chatId);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      pendingPoolAccountByChat.set(chatId, {
        step: 'awaiting_username',
        messageId,
        returnToJobId: job.id,
      });
      const promptText =
        `➕ <b>AÑADIR NUEVO COLABORADOR AL POOL</b>\n` +
        `<blockquote>` +
        `Al terminar de añadirlo volverás automáticamente para subir <b>${escapeHtml(job.title || job.fileName)}</b> en el canal <b>${escapeHtml(ctx.channelName || 'tu canal')} (#${escapeHtml(ctx.channelId || '')})</b>.` +
        `</blockquote>\n` +
        `📱 <b>PASO 1/2:</b> Escribe ahora en el chat el <b>número de teléfono (+53...)</b> o <b>usuario de Picta</b> del colaborador:\n\n` +
        `<i>(O escribe /cancelar para volver al selector)</i>`;
      const kb = [[{ text: '⬅️ Volver al Selector de Cuenta', callback_data: `retry_acct:${job.id}` }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('upload_acct:')) {
      const rest = data.slice('upload_acct:'.length);
      let selectedKey = 'primary';
      let selectedLabel = getPrimaryAccountLabelForChat(chatId);
      let jobId = '';

      if (rest.startsWith('primary:')) {
        jobId = rest.slice('primary:'.length);
      } else if (rest.startsWith('pool:')) {
        const afterPool = rest.slice('pool:'.length);
        const colonIdx = afterPool.indexOf(':');
        if (colonIdx === -1) return;
        const poolIdx = Number(afterPool.slice(0, colonIdx));
        jobId = afterPool.slice(colonIdx + 1);
        const poolAccounts = getPoolAccountsForChat(chatId);
        const acc = poolAccounts[poolIdx];
        if (!acc) {
          await callTelegramBotApi('answerCallbackQuery', {
            callback_query_id: cq.id,
            text: '⚠️ Esa cuenta ya no está en el Pool. Elige otra.',
            show_alert: true,
          }).catch(() => {});
          const jFallback = transferJobs.find((j) => j.id === jobId);
          if (jFallback) await promptUploadAccountSelection(jFallback, chatId, messageId);
          return;
        }
        selectedKey = `pool:${String(acc.username || '').trim().toLowerCase()}`;
        selectedLabel = acc.displayName || acc.username;
      } else {
        return;
      }

      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      job.preferredUploadAccountKey = selectedKey;
      job.preferredUploadAccountLabel = selectedLabel;
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Subiendo con ${selectedLabel}`,
      }).catch(() => {});

      await startJobUploadWithSelectedAccount(job, chatId, messageId);
      return;
    }

    if (data.startsWith('admin_users_list:')) {
      if (!isMasterAdminChat(chatId)) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Solo el Administrador Principal puede consultar la lista de usuarios.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      const page = Number(data.slice('admin_users_list:'.length) || 0) || 0;
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Actualizando panel de usuarios y cuotas...',
      }).catch(() => {});
      await sendOrEditAdminUsersDashboardInTelegram(chatId, messageId, page);
      return;
    }

    if (data.startsWith('admin_user_detail:')) {
      if (!isMasterAdminChat(chatId)) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ Solo el Administrador Principal puede inspeccionar usuarios.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      const parts = data.slice('admin_user_detail:'.length).split(':');
      const targetUserChatId = parts[0] || '';
      const returnPage = Number(parts[1] || 0) || 0;
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Abriendo ficha detallada del usuario...',
      }).catch(() => {});
      await sendOrEditAdminUserDetailInTelegram(chatId, messageId, targetUserChatId, returnPage);
      return;
    }

    if (data.startsWith('admin_user_revoke_prompt:')) {
      if (!isMasterAdminChat(chatId)) return;
      const parts = data.slice('admin_user_revoke_prompt:'.length).split(':');
      const targetUserChatId = parts[0] || '';
      const returnPage = Number(parts[1] || 0) || 0;
      const rec = authorizedUsers.get(targetUserChatId);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      const promptText =
        `⚠️ <b>CONFIRMAR REVOCACIÓN DE ACCESO</b>\n\n` +
        `¿Estás seguro de que deseas retirar a <b>${escapeHtml(rec?.name || rec?.username || targetUserChatId)}</b> (<code>${escapeHtml(targetUserChatId)}</code>) de la lista blanca y cerrar su sesión de Picta?`;
      const kb = [
        [
          {
            text: '✅ Sí, Revocar Acceso Ahora',
            callback_data: `admin_user_revoke_confirm:${targetUserChatId}:${returnPage}`,
          },
        ],
        [
          {
            text: '⬅️ Cancelar y Volver a la Ficha',
            callback_data: `admin_user_detail:${targetUserChatId}:${returnPage}`,
          },
        ],
      ];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, promptText, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, promptText, undefined, kb);
      }
      return;
    }

    if (data.startsWith('admin_user_revoke_confirm:')) {
      if (!isMasterAdminChat(chatId)) return;
      const parts = data.slice('admin_user_revoke_confirm:'.length).split(':');
      const targetUserChatId = parts[0] || '';
      const returnPage = Number(parts[1] || 0) || 0;
      const res = revokeUser(targetUserChatId);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: res.message,
      }).catch(() => {});
      await sendOrEditAdminUsersDashboardInTelegram(
        chatId,
        messageId,
        returnPage,
        undefined,
        res.success ? `✅ <b>${escapeHtml(res.message)}</b>` : `⚠️ <b>${escapeHtml(res.message)}</b>`
      );
      return;
    }

    if (data.startsWith('multipart_join:')) {
      const action = data.slice('multipart_join:'.length);
      if (action === 'open') {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Abriendo asistente /unir en Disco Efímero...',
        }).catch(() => {});
        await sendOrEditMultiPartMenuInTelegram(chatId, messageId);
        return;
      }
      if (action === 'clear') {
        const s = pendingMultiPartByChat.get(chatId);
        if (s) s.parts = [];
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Lista de partes vaciada',
        }).catch(() => {});
        await sendOrEditMultiPartMenuInTelegram(
          chatId,
          messageId,
          undefined,
          `🧹 <b>Lista de partes vaciada.</b>`
        );
        return;
      }
      if (action === 'cancel') {
        pendingMultiPartByChat.delete(chatId);
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Modo /unir cerrado',
        }).catch(() => {});
        await sendOrEditQueueManagerInTelegram(
          chatId,
          messageId,
          undefined,
          `ℹ️ <b>Modo /unir desactivado.</b>`
        );
        return;
      }
      if (action === 'confirm') {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Iniciando descarga y unión en Disco Efímero...',
        }).catch(() => {});
        await executeMultiPartJoinAndCreateJobInTelegram(chatId, messageId);
        return;
      }
    }

    if (data.startsWith('cancel_job:')) {
      const targetJobId = data.slice('cancel_job:'.length);
      const targetJob = transferJobs.find((j) => j.id === targetJobId);
      if (targetJob && !isMasterAdminChat(chatId) && targetJob.telegramChatId !== chatId) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⛔ No puedes cancelar la subida de otro usuario.',
          show_alert: true,
        }).catch(() => {});
        return;
      }
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🛑 Cancelando subida...',
      }).catch(() => {});
      await cancelTransferJob(targetJobId, chatId, messageId);
      return;
    }

    if (data === 'unpin_serie') {
      const prev = pinnedBatchSerieByChat.get(chatId);
      pinnedBatchSerieByChat.delete(chatId);
      savePinnedSeriesToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🔓 Modo Serie Fija desactivado',
      }).catch(() => {});
      await sendOrEditQueueManagerInTelegram(
        chatId,
        messageId,
        undefined,
        `🔓 <b>Modo Serie Fija desactivado${prev ? ` (${escapeHtml(prev.serieName)})` : ''}.</b>\n<i>Los próximos videos volverán a mostrarte el menú normal de selección.</i>`
      );
      return;
    }

    if (data.startsWith('pin_serie:')) {
      const parts = data.split(':');
      const pelserId = Number(parts[1] || 0);
      const seasonNum = String(parts[2] || '1');
      const seasonId = Number(parts[3] || 0);
      const isMaster = isMasterAdminChat(chatId);
      const ctx = getEffectivePictaContext(chatId);
      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = String(serieRec?.nombre || `Serie #${pelserId}`);
      const defaultCoverUrl =
        serieRec?.coverUrl ||
        (isMaster && (pelserId === 4054 || /mentalista/i.test(serieName))
          ? 'https://www.picta.cu/imagen/poster_L6utIgf.jpeg'
          : undefined);

      pinnedBatchSerieByChat.set(chatId, {
        pelserId,
        serieName,
        seasonNum,
        ...(seasonId > 0 ? { seasonId } : {}),
        ...(defaultCoverUrl ? { coverUrl: defaultCoverUrl } : {}),
        ...(serieRec?.customCoverFileId ? { customCoverFileId: serieRec.customCoverFileId } : {}),
        pinnedAt: new Date().toISOString(),
      });
      savePinnedSeriesToDisk();

      // Background fetch of official Serie cover URL from Picta API if not cached yet
      if (!defaultCoverUrl && pelserId > 0 && ctx.isLinked) {
        void (async () => {
          try {
            const token = await ctx.accessTokenPromise;
            const sRes = await fetchPictaWithRetry(`https://api.picta.cu/v1/serie/${pelserId}/`, {
              headers: {
                Authorization: `Bearer ${token}`,
                Origin: 'https://admin.picta.cu',
                Referer: 'https://admin.picta.cu/',
              },
            });
            if (sRes.ok) {
              const sObj = (await sRes.json()) as any;
              const fetchedCover = String(sObj?.url_imagen || sObj?.imagen_secundaria || '').trim();
              if (fetchedCover) {
                upsertChannelSerieRecord(pelserId, serieName, undefined, {
                  coverUrl: fetchedCover,
                  canalId: Number(ctx.channelId || 0),
                });
                const curPin = pinnedBatchSerieByChat.get(chatId);
                if (curPin && curPin.pelserId === pelserId) {
                  curPin.coverUrl = fetchedCover;
                  savePinnedSeriesToDisk();
                }
              }
            }
          } catch {
            // Non-fatal
          }
        })();
      }

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `📌 Serie fijada: ${serieName} (T${seasonNum})`,
      }).catch(() => {});

      await sendOrEditMyChannelSeriesMenu(
        chatId,
        messageId,
        undefined,
        `📌 <b>¡MODO SERIE FIJA ACTIVADO PARA "${escapeHtml(serieName.toUpperCase())}" (TEMPORADA ${escapeHtml(seasonNum)})!</b>\n` +
          `<blockquote>` +
          `⚡ <b>¿Cómo funciona ahora?</b>\n` +
          `• Reenvía al bot todos los capítulos seguidos que quieras (2, 5, 10 capítulos...).\n` +
          `• El bot <b>NO te hará preguntas</b>: extraerá el número y título de cada capítulo, reutilizará la <b>portada oficial de la serie</b> (o envía una foto ahora al chat si prefieres fijar otra portada personalizada) y los subirá <b>uno detrás de otro en cola automática</b>.` +
          `</blockquote>`
      );
      return;
    }

    if (data.startsWith('pin_serie_and_start:')) {
      const parts = data.split(':');
      const pelserId = Number(parts[1] || 0);
      const seasonNum = String(parts[2] || '1');
      const seasonId = Number(parts[3] || 0);
      const jobId = parts.slice(4).join(':');
      const isMaster = isMasterAdminChat(chatId);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMaster && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const ctx = getEffectivePictaContext(chatId);
      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = String(
        serieRec?.nombre || job.modelMetadata?.serie || `Serie #${pelserId}`
      );
      const serieInfo = extractSeriesInfoFromText(job.fileName, job.caption);
      const epNum = String(job.modelMetadata?.numero || serieInfo.numero || '1');
      const epSub = String(
        job.modelMetadata?.episodeSubtitle || serieInfo.episodeSubtitle || ''
      ).trim();
      const defaultCoverUrl =
        serieRec?.coverUrl ||
        (isMaster && (pelserId === 4054 || /mentalista/i.test(serieName))
          ? 'https://www.picta.cu/imagen/poster_L6utIgf.jpeg'
          : undefined);

      pinnedBatchSerieByChat.set(chatId, {
        pelserId,
        serieName,
        seasonNum,
        ...(seasonId > 0 ? { seasonId } : {}),
        ...(defaultCoverUrl ? { coverUrl: defaultCoverUrl } : {}),
        ...(serieRec?.customCoverFileId ? { customCoverFileId: serieRec.customCoverFileId } : {}),
        pinnedAt: new Date().toISOString(),
      });
      savePinnedSeriesToDisk();

      job.tipologiaId = 5;
      job.category = 'Serie';
      job.titleMode = 'manual';
      job.modelMetadata = {
        ...(job.modelMetadata || {}),
        serie: serieName,
        ...(pelserId > 0 ? { serie_pelser_id: String(pelserId) } : {}),
        temporada: seasonNum,
        ...(seasonId > 0 ? { temporada_id: String(seasonId) } : {}),
        numero: epNum,
        ...(epSub ? { episodeSubtitle: epSub } : {}),
      };
      job.title = formatSerieEpisodeTitle(serieName, seasonNum, epNum, epSub);
      const targetChanLabel = job.targetChannelName || ctx.channelName || 'tu canal';
      job.synopsis = sanitizePublicPictaText(
        `Capítulo ${epNum} de la Temporada ${seasonNum} de la serie ${cleanSerieDisplayName(serieName)}${epSub ? ` titulado "${epSub}"` : ''}, disponible en el canal ${targetChanLabel}.`
      );
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `📌 Modo Serie Fija activado para ${cleanSerieDisplayName(serieName)} (T${seasonNum})`,
      }).catch(() => {});

      await finalizeGuidedStepsAndStart(job, chatId, messageId);
      return;
    }

    // Standalone Channel Series Manager Callbacks
    if (data.startsWith('my_series:')) {
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Sincronizando series y capítulos del canal...',
      }).catch(() => {});
      await sendOrEditMyChannelSeriesMenu(chatId, messageId);
      return;
    }

    if (data.startsWith('serie_manage:')) {
      const parts = data.split(':');
      const pelserId = Number(parts[1] || 0);
      const page = Number(parts[2] || 0);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Cargando capítulos de la serie...',
      }).catch(() => {});
      await sendOrEditSerieDetailInTelegram(chatId, messageId, pelserId, page);
      return;
    }

    if (data === 'standalone_serie_new') {
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      const ctx = getEffectivePictaContext(chatId);
      if (!ctx.isLinked || !ctx.channelId) {
        await sendOrEditMyChannelSeriesMenu(chatId, messageId);
        return;
      }
      pendingStandaloneSerieByChat.set(chatId, {
        mode: 'new_serie_name',
        messageId,
      });
      const text =
        `➕ <b>CREAR NUEVA SERIE EN ${escapeHtml(ctx.channelName.toUpperCase())} (#${escapeHtml(ctx.channelId)})</b>\n` +
        `<blockquote>` +
        `El bot registrará la Serie y su Temporada 1 directamente por API en tu canal (#${escapeHtml(ctx.channelId)}) sin pasar por la web de Picta.` +
        `</blockquote>\n` +
        `✍️ <b>Escribe ahora en el chat el nombre de la nueva Serie:</b>`;
      const kb = [[{ text: '⬅️ Cancelar', callback_data: 'my_series:0' }]];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, text, kb, true);
      } else {
        await sendTelegramStatusMessage(chatId, text, undefined, kb);
      }
      return;
    }

    if (data.startsWith('standalone_season_create:')) {
      const parts = data.split(':');
      const pelserId = Number(parts[1] || 0);
      const seasonNum = Number(parts[2] || 1);
      const ctx = getEffectivePictaContext(chatId);
      if (!ctx.isLinked || !ctx.channelId) {
        await sendOrEditMyChannelSeriesMenu(chatId, messageId);
        return;
      }
      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = serieRec?.nombre || `Serie #${pelserId}`;

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Creando Temporada ${seasonNum} en Picta...`,
      }).catch(() => {});

      try {
        const token = await ctx.accessTokenPromise;
        const coverBuf = Buffer.from(FALLBACK_JPEG_BASE64, 'base64');
        const newTempId = await ensureSerieAndTemporadaId(
          token,
          serieName,
          seasonNum,
          { serie_pelser_id: String(pelserId) },
          coverBuf,
          ctx.channelId,
          ctx.channelName,
          isMasterAdminChat(chatId)
        );
        await sendOrEditMyChannelSeriesMenu(
          chatId,
          messageId,
          undefined,
          `✅ <b>¡Temporada ${seasonNum} creada exitosamente en "${escapeHtml(serieName)}" (ID: <code>${newTempId}</code>)!</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendOrEditMyChannelSeriesMenu(
          chatId,
          messageId,
          undefined,
          `⚠️ <b>Error al crear Temporada ${seasonNum}:</b> <code>${escapeHtml(msg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('back_cats:')) {
      const jobId = data.slice('back_cats:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      job.stage = 'awaiting_category';
      saveJobsToDisk();
      const chInfo = resolveJobTargetChannelInfo(job);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await editTelegramStatusMessage(
        chatId,
        messageId,
        `${hudHeader('SELECCIONA CATEGORÍA EN PICTA')}\n` +
          hudBox([
            `📄 <b>Archivo:</b> <code>${escapeHtml(job.fileName)}</code>`,
            `📦 <b>Tamaño:</b> ${formatBytes(job.expectedBytes)}`,
            `📺 <b>Canal:</b> ${escapeHtml(chInfo.channelName)}${chInfo.channelId ? ` · <code>#${escapeHtml(chInfo.channelId)}</code>` : ''}`,
          ]) +
          `\n👇 <b>Elige la categoría para continuar:</b>`,
        buildCategorySelectionKeyboard(job.id),
        true
      );
      return;
    }

    if (data.startsWith('step_back:')) {
      const parts = data.split(':');
      const targetStep = Number(parts[1]);
      const jobId = parts.slice(2).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      if (targetStep === 1) {
        await promptStep1Title(job, chatId, messageId);
      } else if (targetStep === 2) {
        await promptStep2Synopsis(job, chatId, messageId);
      } else if (targetStep === 3) {
        await promptStep3Cover(job, chatId, messageId);
      }
      return;
    }

    if (data.startsWith('retry:')) {
      const jobId = data.slice('retry:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;

      if (messageId) {
        job.statusMessageId = messageId;
      }
      const chInfo = resolveJobTargetChannelInfo(job);
      const wasEncoderFailure = Boolean(
        job.encoderRetryActive ||
          (job.encoderRetryLastError &&
            isPictaEncoderOrTransientServerError(job.encoderRetryLastError, job.pictaResponseCode))
      );
      if (wasEncoderFailure) {
        job.encoderManualRetryTriggered = true;
      }
      job.encoderRetryNextAt = 0;
      job.stage = job.minioKey ? 'creating_picta_publication' : 'generating_auto_title';
      job.errorDetails = undefined;
      job.updatedAt = new Date().toISOString();
      currentActivity = `Reintentando publicación en Picta para "${job.title}" (${job.category || 'Audiovisual'})...`;
      saveJobsToDisk();

      await Promise.all([
        callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Reintentando publicación en Picta...',
        }).catch(() => {}),
        editTelegramStatusMessage(
          chatId,
          messageId,
          `🔄 <b>Reintentando publicación en ${escapeHtml(chInfo.channelName)}${chInfo.channelId ? ` (#${escapeHtml(chInfo.channelId)})` : ''}...</b>\n` +
            `<blockquote>` +
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}\n` +
            `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}\n` +
            `🔑 <b>Manifiesto S3:</b> <code>${job.minioKey || 'Por verificar'}</code>` +
            `</blockquote>\n` +
            `⏳ <i>${job.minioKey ? 'Video ya verificado en S3 MinIO. Enviando ficha técnica a Picta...' : 'Iniciando transferencia...'}</i>`
        ),
      ]);

      await triggerCloudRunKeepAliveTransfer(job.id, job.title, messageId);
      return;
    }

    if (data.startsWith('encoder_auto_queue:')) {
      const jobId = data.slice('encoder_auto_queue:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;

      if (messageId) {
        job.statusMessageId = messageId;
      }
      if (!job.minioKey) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: 'Reanudando subida normal...',
        }).catch(() => {});
        await triggerCloudRunKeepAliveTransfer(job.id, job.title, messageId);
        return;
      }

      const decision = computeNextEncoderRetryState(job.encoderRetryCount || 0, Date.now());
      job.stage = 'queued';
      job.encoderRetryActive = true;
      job.encoderRetryCount = decision.nextAttemptCount;
      job.encoderRetryNextAt = decision.nextRetryAtMs;
      job.encoderManualRetryTriggered = false;
      job.updatedAt = new Date().toISOString();
      if (!uploadQueue.includes(job.id)) {
        uploadQueue.push(job.id);
      }
      saveJobsToDisk();
      startCloudRunCpuKeepAlive();

      await Promise.all([
        callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: `⏱️ Auto-reintento activado (cada ${decision.waitMinutes} min)`,
        }).catch(() => {}),
        editTelegramStatusMessage(
          chatId,
          messageId,
          `⏱️ <b>AUTO-REINTENTO ACTIVADO · ESPERANDO CODIFICADOR DE PICTA</b>\n` +
            `<blockquote>` +
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}\n` +
            `📂 <b>Categoría:</b> ${escapeHtml(job.category || 'Audiovisual')}\n` +
            `🔑 <b>Manifiesto S3 Listo:</b> <code>${escapeHtml(job.minioKey)}</code> (100% seguro, 0 MB a re-subir)\n` +
            `⏳ <b>Próximo intento automático:</b> en ${decision.waitMinutes} min (Intento ${decision.nextAttemptCount}/${MAX_ENCODER_AUTO_RETRIES})` +
            `</blockquote>\n` +
            `<i>Tus demás subidas continúan con normalidad. Te avisaré apenas Picta vuelva a aceptar publicaciones.</i>`,
          [
            [{ text: '🔄 Reintentar Ahora Mismo', callback_data: `retry:${job.id}` }],
            [{ text: '🛑 Detener Auto-Reintento', callback_data: `encoder_stop_retry:${job.id}` }],
          ],
          true
        ),
      ]);
      return;
    }

    if (data.startsWith('encoder_stop_retry:')) {
      const jobId = data.slice('encoder_stop_retry:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;

      removeJobFromUploadQueue(job.id);
      job.stage = 'failed';
      job.encoderRetryActive = false;
      job.encoderRetryNextAt = undefined;
      job.encoderManualRetryTriggered = false;
      job.updatedAt = new Date().toISOString();
      saveJobsToDisk();

      await Promise.all([
        callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⏸️ Auto-reintento detenido.',
        }).catch(() => {}),
        editTelegramStatusMessage(
          chatId,
          messageId,
          `⏸️ <b>AUTO-REINTENTO DETENIDO</b>\n` +
            `<blockquote>` +
            `🎬 <b>Título:</b> ${escapeHtml(job.title)}\n` +
            `🔑 <b>Manifiesto S3:</b> <code>${escapeHtml(job.minioKey || 'Pendiente')}</code> (100% seguro)` +
            `</blockquote>\n` +
            `<i>Puedes reintentar manualmente cuando quieras sin volver a subir el video.</i>`,
          [
            [{ text: '🔄 Reintentar Publicación Ahora', callback_data: `retry:${job.id}` }],
            [{ text: '⏱️ Reactivar Auto-Reintento (cada 2 min)', callback_data: `encoder_auto_queue:${job.id}` }],
          ],
          true
        ),
      ]);
      return;
    }

    if (data.startsWith('retry_manual:')) {
      const jobId = data.slice('retry_manual:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;

      if (messageId) {
        job.statusMessageId = messageId;
      }
      job.preferredUploadAccountKey = undefined;
      job.preferredUploadAccountLabel = undefined;
      saveJobsToDisk();
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      if (job.tipologiaId === 5) {
        await promptSeriesSelectionForJob(job, chatId, messageId);
      } else {
        await promptStep1Title(job, chatId, messageId);
      }
      return;
    }

    if (data.startsWith('cat:')) {
      const parts = data.split(':');
      const catId = Number(parts[1]);
      const jobId = parts.slice(2).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;

      if (messageId) {
        job.statusMessageId = messageId;
      }
      const tipologia = PICTA_TIPOLOGIAS.find((t) => t.id === catId) || {
        id: catId,
        nombre: 'Audiovisual',
        modelo: 'categoria',
        icon: '📹',
      };

      job.tipologiaId = tipologia.id;
      job.category = tipologia.nombre;
      job.updatedAt = new Date().toISOString();
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Categoría: ${tipologia.nombre}`,
      }).catch(() => {});

      if (tipologia.id === 5) {
        await promptSeriesSelectionForJob(job, chatId, messageId);
      } else {
        await promptStep1Title(job, chatId, messageId);
      }
      return;
    }

    // Series Selection & Creation Callbacks for Upload Job
    if (data.startsWith('serie_pick:')) {
      const parts = data.split(':');
      const pelserId = Number(parts[1] || 0);
      const jobId = parts.slice(2).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const serieRec = findUserChannelSerie(pelserId, chatId);
      const serieName = String(serieRec?.nombre || job.modelMetadata?.serie || `Serie #${pelserId}`);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Serie elegida: ${serieName}`,
      }).catch(() => {});

      await promptSeasonSelectionForJob(job, chatId, messageId, pelserId, serieName);
      return;
    }

    if (data.startsWith('serie_create_auto:')) {
      const jobId = data.slice('serie_create_auto:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const ctx = getEffectivePictaContext(chatId);
      const chTag = ctx.channelId ? `${ctx.channelName} (#${ctx.channelId})` : ctx.channelName;

      const serieInfo = extractSeriesInfoFromText(job.fileName, job.caption);
      const serieName = String(
        job.modelMetadata?.serie ||
          (!serieInfo.missingSerieName ? serieInfo.serieName : '') ||
          cleanGeneralVideoTitle(job.fileName)
      );
      const seasonNum = Number(job.modelMetadata?.temporada || serieInfo.temporada || 1) || 1;

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Creando serie "${serieName}" en tu canal...`,
      }).catch(() => {});

      await editTelegramStatusMessage(
        chatId,
        messageId,
        `⏳ <b>Creando serie "${escapeHtml(serieName)}" y Temporada ${seasonNum} en ${escapeHtml(chTag)}...</b>`
      );

      try {
        const created = await createSerieInPictaChannelDirect(
          chatId,
          serieName,
          seasonNum,
          job.customCoverFileId || job.thumbnailFileId
        );
        job.modelMetadata = {
          ...(job.modelMetadata || {}),
          serie: created.serieName,
          serie_pelser_id: String(created.pelserId),
          temporada: String(created.seasonNum),
          temporada_id: String(created.tempId),
        };
        saveJobsToDisk();

        await promptSeasonSelectionForJob(
          job,
          chatId,
          messageId,
          created.pelserId,
          created.serieName,
          `✅ <b>¡Serie "${escapeHtml(created.serieName)}" y Temporada ${created.seasonNum} creadas en ${escapeHtml(chTag)}!</b>`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await promptSeasonSelectionForJob(
          job,
          chatId,
          messageId,
          0,
          serieName,
          `⚠️ <b>Aviso al pre-crear serie (se creará al publicar):</b> <code>${escapeHtml(msg.slice(0, 100))}</code>`
        );
      }
      return;
    }

    if (data.startsWith('serie_create_new:')) {
      const jobId = data.slice('serie_create_new:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const ctx = getEffectivePictaContext(chatId);
      const chTag = ctx.channelId ? `${ctx.channelName} (#${ctx.channelId})` : ctx.channelName;

      job.stage = 'awaiting_new_series_name';
      job.updatedAt = new Date().toISOString();
      pendingManualTitleByChat.set(chatId, job.id);
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});

      const text =
        `➕ <b>CREAR NUEVA SERIE EN TU CANAL (${escapeHtml(chTag)})</b>\n` +
        `<blockquote>` +
        `📄 <b>Archivo:</b> <code>${escapeHtml(job.fileName)}</code>\n` +
        `📁 <b>Temporada detectada:</b> ${escapeHtml(String(job.modelMetadata?.temporada || '1'))} · <b>Capítulo:</b> ${escapeHtml(String(job.modelMetadata?.numero || '1'))}` +
        `</blockquote>\n` +
        `✍️ <b>Escribe ahora en el chat el nombre de la nueva Serie</b> y el bot la creará automáticamente en ${escapeHtml(chTag)}:`;

      const kb = [[{ text: '⬅️ Volver a mis Series', callback_data: `cat:5:${job.id}` }]];
      await editTelegramStatusMessage(chatId, messageId, text, kb, true);
      return;
    }

    if (data.startsWith('serie_season_pick:')) {
      const parts = data.split(':');
      const seasonNum = String(parts[1] || '1');
      const seasonId = Number(parts[2] || 0);
      const jobId = parts.slice(3).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const meta = job.modelMetadata || {};
      const epNum = String(meta.numero || '1');
      const serieName = String(meta.serie || 'Serie');
      const epSub = String(meta.episodeSubtitle || '').trim();
      job.modelMetadata = {
        ...meta,
        temporada: seasonNum,
        ...(seasonId > 0 ? { temporada_id: String(seasonId) } : {}),
      };
      job.title = formatSerieEpisodeTitle(serieName, seasonNum, epNum, epSub);
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Temporada ${seasonNum} seleccionada`,
      }).catch(() => {});

      await promptStep1Title(job, chatId, messageId);
      return;
    }

    if (data.startsWith('serie_season_create:')) {
      const parts = data.split(':');
      const pelserId = Number(parts[1] || 0);
      const seasonNum = Number(parts[2] || 1);
      const jobId = parts.slice(3).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const serieName = String(job.modelMetadata?.serie || `Serie #${pelserId}`);
      const epSub = String(job.modelMetadata?.episodeSubtitle || '').trim();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Creando Temporada ${seasonNum} en Picta...`,
      }).catch(() => {});

      try {
        const created = await createSerieInPictaChannelDirect(
          chatId,
          serieName,
          seasonNum,
          job.customCoverFileId || job.thumbnailFileId
        );
        const inheritedStyle = resolveSeriesStyleForChannel(chatId, created.pelserId, created.serieName);
        job.modelMetadata = {
          ...(job.modelMetadata || {}),
          serie: created.serieName,
          serie_pelser_id: String(created.pelserId),
          temporada: String(seasonNum),
          temporada_id: String(created.tempId),
        };
        const epNumStr = String(job.modelMetadata.numero || '1');
        job.title = inheritedStyle
          ? formatEpisodeWithSeriesStyle(inheritedStyle, {
              serieName: created.serieName,
              temporada: String(seasonNum),
              numero: epNumStr,
              episodeSubtitle: epSub,
            })
          : formatSerieEpisodeTitle(
              created.serieName,
              String(seasonNum),
              epNumStr,
              epSub
            );
        saveJobsToDisk();
      } catch {
        job.modelMetadata = {
          ...(job.modelMetadata || {}),
          temporada: String(seasonNum),
        };
        saveJobsToDisk();
      }

      await promptStep1Title(job, chatId, messageId);
      return;
    }

    if (data.startsWith('serie_confirm_tc:')) {
      const parts = data.split(':');
      const tempNum = String(parts[1] || '1');
      const epNum = String(parts[2] || '1');
      const jobId = parts.slice(3).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const serieName = String(job.modelMetadata?.serie || 'Serie');
      const pelserId = Number(job.modelMetadata?.serie_pelser_id || 0);
      const epSub = String(job.modelMetadata?.episodeSubtitle || '').trim();
      const inheritedStyle = resolveSeriesStyleForChannel(chatId, pelserId, serieName);
      job.modelMetadata = {
        ...(job.modelMetadata || {}),
        temporada: tempNum,
        numero: epNum,
      };
      job.title = inheritedStyle
        ? formatEpisodeWithSeriesStyle(inheritedStyle, {
            serieName,
            temporada: tempNum,
            numero: epNum,
            episodeSubtitle: epSub,
          })
        : formatSerieEpisodeTitle(serieName, tempNum, epNum, epSub);
      saveJobsToDisk();

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `T${tempNum}:E${epNum.padStart(2, '0')} confirmado`,
      }).catch(() => {});

      await promptStep1Title(job, chatId, messageId);
      return;
    }

    if (data.startsWith('step1_opt:')) {
      const parts = data.split(':');
      const optIdx = Number(parts[1] || 0);
      const jobId = parts.slice(2).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const meta = job.modelMetadata || {};
      const serieName = String(meta.serie || 'Serie');
      const pelserId = Number(meta.serie_pelser_id || 0);
      const inheritedStyle = resolveSeriesStyleForChannel(chatId, pelserId, serieName);
      const opts = buildSerieTitleOptions({
        serieName,
        temporada: String(meta.temporada || '1'),
        numero: String(meta.numero || '1'),
        episodeSubtitle: String(meta.episodeSubtitle || ''),
        rawCaption: job.caption,
        inheritedStyle,
      });
      const chosen = opts[optIdx] || opts[0];
      if (chosen) {
        job.title = chosen.title;
      }
      job.titleMode = 'manual';
      if (isStaleOrGenericSerieSynopsis(job.synopsis, job.caption, String(meta.numero || '1'))) {
        const chName = job.targetChannelName || getEffectivePictaContext(chatId).channelName || 'Mi Canal';
        const cleanSName = cleanSerieDisplayName(String(meta.serie || '')) || String(meta.serie || 'la serie');
        const epSub = String(meta.episodeSubtitle || '').trim();
        job.synopsis = `Capítulo ${String(meta.numero || '1')} de la Temporada ${String(meta.temporada || '1')} de la serie ${cleanSName}${epSub ? ` titulado "${epSub}"` : ''}, disponible en el canal ${chName}.`;
      }
      saveJobsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: `Título elegido: ${(chosen?.title || job.title).slice(0, 40)}`,
      }).catch(() => {});
      await proceedFromStep1ToStep2WithDuplicateCheck(job, chatId, messageId);
      return;
    }

    if (data.startsWith('imdb_pick:')) {
      const parts = data.split(':');
      const pickIdx = Number(parts[1] || 0);
      const jobId = parts.slice(2).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const pending = pendingOnlineCandidatesByJob.get(job.id);
      const chosenCand = pending?.candidates?.[pickIdx];
      pendingOnlineCandidatesByJob.delete(job.id);

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: chosenCand
          ? `✅ Elegido: ${chosenCand.title.slice(0, 34)}`
          : 'Cargando ficha seleccionada...',
      }).catch(() => {});

      let preResolved: OnlineMediaInfo | null = null;
      if (chosenCand) {
        preResolved = await fetchOnlineMediaDetailsByCandidate(
          chosenCand,
          pending?.seasonNum || 0,
          pending?.epNum || 0
        ).catch(() => null);
        if (job.tipologiaId === 5 && chosenCand.title && isGenericOrInvalidSerieName(String(job.modelMetadata?.serie || ''))) {
          job.modelMetadata = {
            ...(job.modelMetadata || {}),
            serie: chosenCand.title,
          };
        }
      }

      try {
        await applyEnrichmentToWizardJob(job, chatId, {
          forceTitleUpdate: pending?.nextStep === 2,
          forceSynopsisUpdate: true,
          preResolvedOnlineInfo: preResolved,
        });
      } catch {
        // Continue with fallback
      }

      if (pending?.nextStep === 3) {
        await promptStep3Cover(job, chatId, messageId);
      } else {
        await proceedFromStep1ToStep2WithDuplicateCheck(job, chatId, messageId);
      }
      return;
    }

    if (data.startsWith('imdb_retype:')) {
      const jobId = data.slice('imdb_retype:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      pendingOnlineCandidatesByJob.delete(job.id);
      job.modelMetadata = { ...(job.modelMetadata || {}), needsManualTitle: 'true' };
      job.title = '';
      saveJobsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Escribe el título exacto en el chat',
      }).catch(() => {});
      await promptStep1Title(job, chatId, messageId);
      return;
    }

    if (data.startsWith('imdb_skip:')) {
      const parts = data.split(':');
      const nextStep = Number(parts[1] || 2);
      const jobId = parts.slice(2).join(':');
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      pendingOnlineCandidatesByJob.delete(job.id);
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      if (nextStep === 3) {
        await promptStep3Cover(job, chatId, messageId);
      } else {
        await proceedFromStep1ToStep2WithDuplicateCheck(job, chatId, messageId);
      }
      return;
    }

    if (data.startsWith('step1_ai:') || data.startsWith('step1_imdb:')) {
      const isMovieImdbSearch = data.startsWith('step1_imdb:');
      const jobId = data.slice(isMovieImdbSearch ? 'step1_imdb:'.length : 'step1_ai:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;

      const meta = job.modelMetadata || {};
      const queryBase =
        job.tipologiaId === 5 && meta.serie && !isGenericOrInvalidSerieName(String(meta.serie))
          ? String(meta.serie)
          : String(job.title || '').trim();

      if (!queryBase || isRandomOrCrypticFilename(queryBase) || meta.needsManualTitle === 'true') {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Escribe primero el título real en el chat',
          show_alert: true,
        }).catch(() => {});
        await promptStep1Title(job, chatId, messageId);
        return;
      }

      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '🔍 Buscando en IMDb + TMDB...',
      }).catch(() => {});

      try {
        const discovery = await searchMediaCandidatesOnline(
          queryBase,
          Number(job.tipologiaId || 8),
          meta.temporada ? Number(meta.temporada) : undefined,
          meta.numero ? Number(meta.numero) : undefined
        );
        if (discovery.disambiguation.needsDisambiguation && discovery.disambiguation.topCandidates.length > 1) {
          await promptImdbDisambiguationTop3(
            job,
            chatId,
            messageId,
            discovery.disambiguation.topCandidates,
            2,
            discovery.cleanQuery || queryBase,
            discovery.effectiveSeason,
            discovery.effectiveEp
          );
          return;
        }
        const winner = discovery.disambiguation.confidentWinner || discovery.disambiguation.topCandidates[0] || null;
        const preResolved = winner
          ? await fetchOnlineMediaDetailsByCandidate(
              winner,
              discovery.effectiveSeason,
              discovery.effectiveEp
            ).catch(() => null)
          : null;

        await applyEnrichmentToWizardJob(job, chatId, {
          forceTitleUpdate: true,
          forceSynopsisUpdate: true,
          preResolvedOnlineInfo: preResolved,
        });
      } catch {
        // Continue with current title
      }
      await proceedFromStep1ToStep2WithDuplicateCheck(job, chatId, messageId);
      return;
    }

    if (data.startsWith('step1_keep:')) {
      const jobId = data.slice('step1_keep:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      if (job.modelMetadata?.needsManualTitle === 'true' || !job.title || isRandomOrCrypticFilename(job.title)) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Escribe primero el título real en el chat',
          show_alert: true,
        }).catch(() => {});
        await promptStep1Title(job, chatId, messageId);
        return;
      }
      job.titleMode = 'manual';
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Título confirmado',
      }).catch(() => {});
      await proceedFromStep1ToStep2WithDuplicateCheck(job, chatId, messageId);
      return;
    }

    if (
      data.startsWith('step2_auto:') ||
      data.startsWith('step2_ai:') ||
      data.startsWith('step2_keep:')
    ) {
      const isForceAi = data.startsWith('step2_ai:');
      const isKeepDetected = data.startsWith('step2_keep:');
      const prefix = isForceAi ? 'step2_ai:' : isKeepDetected ? 'step2_keep:' : 'step2_auto:';
      const jobId = data.slice(prefix.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: isKeepDetected
          ? '✅ Sinopsis conservada · Buscando ficha técnica y carátula...'
          : '🔍 Buscando en IMDb + TMDB sinopsis y carátula HD...',
      }).catch(() => {});
      try {
        const meta = job.modelMetadata || {};
        const queryBase =
          job.tipologiaId === 5 && meta.serie && !isGenericOrInvalidSerieName(String(meta.serie))
            ? String(meta.serie)
            : String(job.title || '').trim();

        let preResolved: OnlineMediaInfo | null = null;
        if (!isKeepDetected && queryBase && !isRandomOrCrypticFilename(queryBase) && !meta.onlineCoverUrl) {
          const discovery = await searchMediaCandidatesOnline(
            queryBase,
            Number(job.tipologiaId || 8),
            meta.temporada ? Number(meta.temporada) : undefined,
            meta.numero ? Number(meta.numero) : undefined
          ).catch(() => null);
          if (
            discovery &&
            discovery.disambiguation.needsDisambiguation &&
            discovery.disambiguation.topCandidates.length > 1
          ) {
            await promptImdbDisambiguationTop3(
              job,
              chatId,
              messageId,
              discovery.disambiguation.topCandidates,
              3,
              discovery.cleanQuery || queryBase,
              discovery.effectiveSeason,
              discovery.effectiveEp
            );
            return;
          }
          const winner =
            discovery?.disambiguation.confidentWinner || discovery?.disambiguation.topCandidates[0] || null;
          if (winner) {
            preResolved = await fetchOnlineMediaDetailsByCandidate(
              winner,
              discovery?.effectiveSeason || 0,
              discovery?.effectiveEp || 0
            ).catch(() => null);
          }
        }

        await applyEnrichmentToWizardJob(job, chatId, {
          forceTitleUpdate: false,
          forceSynopsisUpdate: isForceAi,
          preResolvedOnlineInfo: preResolved,
        });
      } catch {
        // Non-fatal
      }
      await promptStep3Cover(job, chatId, messageId);
      return;
    }

    if (data.startsWith('step3_set_poster:')) {
      const jobId = data.slice('step3_set_poster:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      job.modelMetadata = {
        ...(job.modelMetadata || {}),
        awaitingCustomPoster: 'true',
      };
      saveJobsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Envía ahora la imagen vertical para el póster',
      }).catch(() => {});
      const posterPrompt =
        `🎞️ <b>${renderWizardStepBar(3)} · PÓSTER VERTICAL OPCIONAL</b>\n` +
        `<blockquote>🎬 <b>Video:</b> ${escapeHtml(job.title)}</blockquote>\n` +
        `📸 <b>Envía ahora al chat una foto o imagen vertical (2:3)</b> para usarla como Póster independiente en Picta:`;
      const posterKb = [
        [{ text: '⬅️ Volver a Opciones de Portada', callback_data: `step3_cancel_poster:${job.id}` }],
      ];
      if (messageId) {
        await editTelegramStatusMessage(chatId, messageId, posterPrompt, posterKb, true);
      } else {
        await sendTelegramStatusMessage(chatId, posterPrompt, undefined, posterKb);
      }
      return;
    }

    if (data.startsWith('step3_cancel_poster:')) {
      const jobId = data.slice('step3_cancel_poster:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (job.modelMetadata) {
        delete job.modelMetadata.awaitingCustomPoster;
        saveJobsToDisk();
      }
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await promptStep3Cover(job, chatId, messageId);
      return;
    }

    if (
      data.startsWith('step3_auto:') ||
      data.startsWith('step3_poster:') ||
      data.startsWith('step3_frame:')
    ) {
      const isFrameOnly = data.startsWith('step3_frame:');
      const prefix = data.startsWith('step3_poster:')
        ? 'step3_poster:'
        : isFrameOnly
          ? 'step3_frame:'
          : 'step3_auto:';
      const jobId = data.slice(prefix.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      const nextMeta: Record<string, string | number | number[]> = {
        ...(job.modelMetadata || {}),
        preferVideoFrameCover: isFrameOnly ? 'true' : 'false',
      };
      delete nextMeta.awaitingCustomPoster;
      job.modelMetadata = nextMeta;
      saveJobsToDisk();
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: isFrameOnly
          ? '🖼️ Miniatura del video seleccionada'
          : '🎬 Carátula Oficial HD (TMDB/IMDb) seleccionada',
      }).catch(() => {});
      await promptStep4Subtitles(job, chatId, messageId);
      return;
    }

    if (data.startsWith('step4_skip:')) {
      const jobId = data.slice('step4_skip:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Iniciando subida a Picta...',
      }).catch(() => {});
      await finalizeGuidedStepsAndStart(job, chatId, messageId);
      return;
    }

    if (data.startsWith('manual:')) {
      const jobId = data.slice('manual:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;
      if (messageId) job.statusMessageId = messageId;
      await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await promptStep1Title(job, chatId, messageId);
      return;
    }

    if (data.startsWith('auto:')) {
      const jobId = data.slice('auto:'.length);
      const job = transferJobs.find((j) => j.id === jobId);
      if (!job || (!isMasterAdminChat(chatId) && job.telegramChatId !== chatId)) return;

      if (messageId) {
        job.statusMessageId = messageId;
      }
      if (
        job.tipologiaId !== 5 &&
        (job.modelMetadata?.needsManualTitle === 'true' ||
          (!job.title && isRandomOrCrypticFilename(job.fileName)))
      ) {
        await callTelegramBotApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: '⚠️ Nombre aleatorio: escribe primero el título real para buscar en IMDb.',
          show_alert: true,
        }).catch(() => {});
        await promptStep1Title(job, chatId, messageId);
        return;
      }
      pendingManualTitleByChat.delete(chatId);
      await callTelegramBotApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: 'Verificando si existe en Picta...',
      }).catch(() => {});

      const pausedForDuplicate = await checkPictaDuplicateAndPromptIfFound(
        job,
        chatId,
        messageId,
        'auto'
      );
      if (pausedForDuplicate) return;

      await executeAutoUploadAfterDuplicateCheck(job, chatId, messageId);
      return;
    }

    await callTelegramBotApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
    return;
  }

  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = String(msg.chat?.id || '');
  const msgKey = `${chatId}:${msg.message_id}`;
  if (processedMessageKeys.has(msgKey)) {
    return;
  }
  addBoundedSetEntry(processedMessageKeys, msgKey);
  saveProcessedUpdatesToDisk();

  const senderName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
    msg.from?.username ||
    `Chat ${chatId}`;

  const photoArray = Array.isArray(msg.photo) && msg.photo.length > 0 ? msg.photo : null;
  const imageDoc =
    msg.document && String(msg.document.mime_type || '').startsWith('image/')
      ? msg.document
      : null;

  const subDoc =
    msg.document &&
    (/\.(srt|vtt|ass|sub)$/i.test(String(msg.document.file_name || '')) ||
      String(msg.document.mime_type || '').includes('subrip') ||
      String(msg.document.mime_type || '').includes('vtt'))
      ? msg.document
      : null;

  // 0. Check if user is uploading Avatar or Portada for their Picta Channel (/canal)
  const pendingChanEdit = pendingChannelEditByChat.get(chatId);
  if (
    pendingChanEdit &&
    (photoArray || imageDoc) &&
    (pendingChanEdit.mode === 'avatar' || pendingChanEdit.mode === 'portada')
  ) {
    const largestPhoto = photoArray ? photoArray[photoArray.length - 1] : imageDoc;
    if (largestPhoto?.file_id) {
      pendingChannelEditByChat.delete(chatId);
      try {
        const imgBuf = await downloadTelegramThumbnailBuffer(String(largestPhoto.file_id));
        if (!imgBuf) throw new Error('No se pudo descargar la imagen desde Telegram.');
        if (pendingChanEdit.mode === 'avatar') {
          await patchPictaChannelDetails(chatId, {}, { avatarBuffer: imgBuf });
          await sendOrEditChannelEditorMenu(
            chatId,
            pendingChanEdit.messageId,
            msg.message_id,
            '✅ <b>¡Avatar (foto de perfil) del canal actualizado exitosamente en Picta!</b>'
          );
        } else {
          await patchPictaChannelDetails(chatId, {}, { coverBuffer: imgBuf });
          await sendOrEditChannelEditorMenu(
            chatId,
            pendingChanEdit.messageId,
            msg.message_id,
            '✅ <b>¡Portada (banner) del canal actualizada exitosamente en Picta!</b>'
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditChannelEditorMenu(
          chatId,
          pendingChanEdit.messageId,
          msg.message_id,
          `⚠️ <b>No se pudo actualizar la imagen del canal:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }
  }

  // 0.8 Check if user is updating a Serie's portada or poster in /series
  const pendingSeriePhotoEdit = pendingStandaloneSerieByChat.get(chatId);
  if (
    pendingSeriePhotoEdit &&
    (pendingSeriePhotoEdit.mode === 'edit_serie_cover' ||
      pendingSeriePhotoEdit.mode === 'edit_serie_portada' ||
      pendingSeriePhotoEdit.mode === 'edit_serie_poster' ||
      pendingSeriePhotoEdit.mode === 'edit_serie_both') &&
    pendingSeriePhotoEdit.pelserId &&
    (photoArray || imageDoc)
  ) {
    const largestPhoto = photoArray ? photoArray[photoArray.length - 1] : imageDoc;
    if (largestPhoto?.file_id) {
      pendingStandaloneSerieByChat.delete(chatId);
      const serieSlot: PictaImageSlot =
        pendingSeriePhotoEdit.mode === 'edit_serie_portada'
          ? 'portada'
          : pendingSeriePhotoEdit.mode === 'edit_serie_both'
            ? 'both'
            : 'poster';
      try {
        const photoFileId = String(largestPhoto.file_id);
        const imgBuf = await downloadTelegramThumbnailBuffer(photoFileId);
        if (!imgBuf) throw new Error('No se pudo descargar la imagen desde Telegram.');
        const seriePatch = buildSerieImagePatchFiles({
          slot: serieSlot,
          uploadedBuffer: imgBuf,
        });
        await patchSerieInPictaChannel(chatId, pendingSeriePhotoEdit.pelserId, seriePatch);
        const cached = findUserChannelSerie(pendingSeriePhotoEdit.pelserId, chatId);
        if (cached) {
          cached.customCoverFileId = photoFileId;
          saveChannelSeriesToDisk(channelSeriesCache);
        }
        const okMsg =
          serieSlot === 'portada'
            ? '✅ <b>¡Portada horizontal (16:9) de la serie actualizada en Picta!</b>'
            : serieSlot === 'both'
              ? '✅ <b>¡Portada y Póster de la serie actualizados en Picta!</b>'
              : '✅ <b>¡Póster vertical (2:3) de la serie actualizado en Picta!</b>';
        await sendOrEditSerieDetailInTelegram(
          chatId,
          pendingSeriePhotoEdit.messageId,
          pendingSeriePhotoEdit.pelserId,
          0,
          okMsg
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditSerieDetailInTelegram(
          chatId,
          pendingSeriePhotoEdit.messageId,
          pendingSeriePhotoEdit.pelserId,
          0,
          `⚠️ <b>No se pudo cambiar la imagen de la serie:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }
  }

  // 1. Check if user is editing an already-published Picta video (Portada, Póster, or Subtítulos)
  const pendingPubEdit = pendingPubEditByChat.get(chatId);
  if (
    pendingPubEdit &&
    (photoArray || imageDoc) &&
    (pendingPubEdit.mode === 'cover' ||
      pendingPubEdit.mode === 'poster' ||
      pendingPubEdit.mode === 'both')
  ) {
    const largestPhoto = photoArray ? photoArray[photoArray.length - 1] : imageDoc;
    if (largestPhoto?.file_id) {
      const pubSlot: PictaImageSlot =
        pendingPubEdit.mode === 'poster'
          ? 'poster'
          : pendingPubEdit.mode === 'both'
            ? 'both'
            : 'portada';
      try {
        const imgBuf = await downloadTelegramThumbnailBuffer(String(largestPhoto.file_id));
        if (!imgBuf) throw new Error('No se pudo descargar la imagen desde Telegram.');
        const patchFiles = buildPublicationImagePatchFiles({
          slot: pubSlot,
          uploadedBuffer: imgBuf,
        });
        await patchPictaPublicationInChannel(
          pendingPubEdit.pubId,
          {},
          patchFiles,
          chatId
        );
        const okMsg =
          pubSlot === 'poster'
            ? '✅ <b>¡Póster vertical actualizado exitosamente en Picta!</b>'
            : pubSlot === 'both'
              ? '✅ <b>¡Portada y Póster actualizados exitosamente en Picta!</b>'
              : '✅ <b>¡Portada horizontal actualizada exitosamente en Picta!</b>';
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          pendingPubEdit.messageId,
          pendingPubEdit.pubId,
          pendingPubEdit.returnSort,
          pendingPubEdit.returnPage,
          okMsg
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          pendingPubEdit.messageId,
          pendingPubEdit.pubId,
          pendingPubEdit.returnSort,
          pendingPubEdit.returnPage,
          `⚠️ <b>No se pudo cambiar la imagen:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }
  }

  if (pendingPubEdit && subDoc && pendingPubEdit.mode === 'subs') {
    try {
      const subBuf = await downloadTelegramThumbnailBuffer(String(subDoc.file_id));
      if (!subBuf) throw new Error('No se pudo descargar el archivo .srt desde Telegram.');
      await patchPictaPublicationInChannel(
        pendingPubEdit.pubId,
        {},
        {
          subtitleBuffer: subBuf,
          subtitleFileName: String(subDoc.file_name || 'subtitulos.srt'),
        },
        chatId
      );
      await sendOrEditPictaPubDetailInTelegram(
        chatId,
        pendingPubEdit.messageId,
        pendingPubEdit.pubId,
        pendingPubEdit.returnSort,
        pendingPubEdit.returnPage,
        `✅ <b>¡Subtítulos (${escapeHtml(String(subDoc.file_name || 'subtitulos.srt'))}) añadidos al video en Picta!</b>`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await sendOrEditPictaPubDetailInTelegram(
        chatId,
        pendingPubEdit.messageId,
        pendingPubEdit.pubId,
        pendingPubEdit.returnSort,
        pendingPubEdit.returnPage,
        `⚠️ <b>No se pudo subir el subtítulo:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
      );
    }
    return;
  }

  // 2. Check if user is in the 4-Step Upload Wizard
  const activeWizardJobId = pendingManualTitleByChat.get(chatId);
  const activeWizardJob = activeWizardJobId
    ? transferJobs.find((j) => j.id === activeWizardJobId)
    : transferJobs.find(
        (j) =>
          j.telegramChatId === chatId &&
          (j.stage === 'awaiting_series_selection' ||
            j.stage === 'awaiting_new_series_name' ||
            j.stage === 'awaiting_season_selection' ||
            j.stage === 'awaiting_step_title' ||
            j.stage === 'awaiting_step_synopsis' ||
            j.stage === 'awaiting_step_cover' ||
            j.stage === 'awaiting_step_subtitles' ||
            j.stage === 'awaiting_manual_title')
      );

  if ((photoArray || imageDoc) && activeWizardJob && activeWizardJob.stage === 'awaiting_step_cover') {
    const largestPhoto = photoArray ? photoArray[photoArray.length - 1] : imageDoc;
    if (largestPhoto?.file_id) {
      if (activeWizardJob.modelMetadata?.awaitingCustomPoster === 'true') {
        activeWizardJob.customPosterFileId = String(largestPhoto.file_id);
        delete activeWizardJob.modelMetadata.awaitingCustomPoster;
        activeWizardJob.updatedAt = new Date().toISOString();
        saveJobsToDisk();
        await promptStep3Cover(activeWizardJob, chatId, activeWizardJob.statusMessageId || null);
        return;
      }
      activeWizardJob.customCoverFileId = String(largestPhoto.file_id);
      activeWizardJob.updatedAt = new Date().toISOString();
      saveJobsToDisk();
      await promptStep4Subtitles(activeWizardJob, chatId, activeWizardJob.statusMessageId || null);
      return;
    }
  }

  // If user sends a photo while Modo Serie Fija is active (and not inside another wizard), save it as the pinned serie's cover!
  const activePinnedSerieForPhoto = pinnedBatchSerieByChat.get(chatId);
  if ((photoArray || imageDoc) && !activeWizardJob && activePinnedSerieForPhoto) {
    const largestPhoto = photoArray ? photoArray[photoArray.length - 1] : imageDoc;
    if (largestPhoto?.file_id) {
      const photoFileId = String(largestPhoto.file_id);
      activePinnedSerieForPhoto.customCoverFileId = photoFileId;
      savePinnedSeriesToDisk();
      const pinChanId = Number(getEffectivePictaContext(chatId).channelId || 0);
      upsertChannelSerieRecord(
        activePinnedSerieForPhoto.pelserId,
        activePinnedSerieForPhoto.serieName,
        undefined,
        { customCoverFileId: photoFileId, ...(pinChanId > 0 ? { canalId: pinChanId } : {}) }
      );
      await sendTelegramStatusMessage(
        chatId,
        `🖼️ <b>¡Portada fijada para "${escapeHtml(activePinnedSerieForPhoto.serieName)}"!</b>\n` +
          `<blockquote>` +
          `Todos los capítulos que envíes ahora en <b>📌 Modo Serie Fija</b> usarán automáticamente esta portada.` +
          `</blockquote>`,
        msg.message_id
      );
      return;
    }
  }

  if (subDoc && activeWizardJob) {
    activeWizardJob.subtitleFileId = String(subDoc.file_id);
    activeWizardJob.subtitleFileName = String(subDoc.file_name || 'subtitulos.srt');
    activeWizardJob.updatedAt = new Date().toISOString();
    saveJobsToDisk();
    await finalizeGuidedStepsAndStart(
      activeWizardJob,
      chatId,
      activeWizardJob.statusMessageId || null
    );
    return;
  }

  // 2.5 Check if user forwarded a channel/group message while configuring Requests Channel or Requests Group
  const pendingPromoInputCheck = pendingToolkitInputByChat.get(chatId);
  if (
    pendingPromoInputCheck &&
    (pendingPromoInputCheck.mode === 'set_promo_requests_channel' ||
      pendingPromoInputCheck.mode === 'set_requests_group_chat')
  ) {
    const fwdChat = msg.forward_origin?.chat || msg.forward_from_chat;
    if (fwdChat && fwdChat.id) {
      pendingToolkitInputByChat.delete(chatId);
      const fwdId = String(fwdChat.id);
      const fwdUsername = fwdChat.username ? `@${fwdChat.username}` : '';
      const fwdTitle = String(fwdChat.title || fwdUsername || fwdId).trim();
      const displayLabel = fwdUsername ? `${fwdTitle} (${fwdUsername})` : fwdTitle;
      const existingCfg = userPromoChannels.get(chatId);

      if (pendingPromoInputCheck.mode === 'set_requests_group_chat') {
        userPromoChannels.set(chatId, {
          chatId,
          targetChannelId: existingCfg?.targetChannelId || '',
          targetChannelLabel: existingCfg?.targetChannelLabel || '',
          customPictaChannelUrl: existingCfg?.customPictaChannelUrl,
          autoSendToRequests: existingCfg?.autoSendToRequests,
          requestsGroupChatId: fwdId,
          requestsGroupLabel: displayLabel,
          requestsMonitorMode:
            existingCfg?.requestsMonitorMode && existingCfg.requestsMonitorMode !== 'off'
              ? existingCfg.requestsMonitorMode
              : 'prefix',
          disabled: existingCfg?.disabled ?? false,
          updatedAt: new Date().toISOString(),
        });
        saveUserPromoChannelsToDisk();
        await sendOrEditPromoChannelMenuInTelegram(
          chatId,
          pendingPromoInputCheck.messageId,
          msg.message_id,
          `✅ <b>¡Grupo de Pedidos vinculado por reenvío!</b> ${escapeHtml(displayLabel)} (<code>${escapeHtml(fwdId)}</code>)`
        );
        return;
      }

      userPromoChannels.set(chatId, {
        chatId,
        targetChannelId: fwdId,
        targetChannelLabel: displayLabel,
        customPictaChannelUrl: existingCfg?.customPictaChannelUrl,
        autoSendToRequests: existingCfg?.autoSendToRequests,
        requestsGroupChatId: existingCfg?.requestsGroupChatId,
        requestsGroupLabel: existingCfg?.requestsGroupLabel,
        requestsMonitorMode: existingCfg?.requestsMonitorMode,
        disabled: false,
        updatedAt: new Date().toISOString(),
      });
      saveUserPromoChannelsToDisk();

      const linkedPromo = pendingPromoInputCheck.promoId
        ? pendingMoviePromos.get(pendingPromoInputCheck.promoId)
        : undefined;
      if (linkedPromo && linkedPromo.ownerChatId === chatId) {
        const prompt = buildMoviePromoConfirmationPrompt(linkedPromo, chatId);
        await sendTelegramStatusMessage(
          chatId,
          `✅ <b>Canal de Pedidos guardado:</b> ${escapeHtml(displayLabel)} (<code>${escapeHtml(fwdId)}</code>)\n\n${prompt.textHtml}`,
          msg.message_id,
          prompt.keyboard as any
        );
      } else {
        await sendOrEditPromoChannelMenuInTelegram(
          chatId,
          pendingPromoInputCheck.messageId,
          msg.message_id,
          `✅ <b>¡Canal de Pedidos configurado por reenvío!</b> ${escapeHtml(displayLabel)} (<code>${escapeHtml(fwdId)}</code>)`
        );
      }
      return;
    }
  }

  // 3. Check if user is in /unir Multi-Part mode and sent a video or archive/split document
  const activeMultiPartSession = pendingMultiPartByChat.get(chatId);
  const rawIncomingMedia = msg.video || msg.document;
  if (activeMultiPartSession && rawIncomingMedia && !activeMultiPartSession.assembling) {
    const partFileName =
      rawIncomingMedia.file_name ||
      `parte_${activeMultiPartSession.parts.length + 1}_${msg.message_id}.mp4`;
    const partSize = Number(rawIncomingMedia.file_size || 0);
    activeMultiPartSession.parts.push({
      telegramMessageId: msg.message_id,
      fileId: rawIncomingMedia.file_id,
      fileUniqueId: String(rawIncomingMedia.file_unique_id || ''),
      fileName: partFileName,
      mimeType: rawIncomingMedia.mime_type || 'application/octet-stream',
      sizeBytes: partSize,
      caption: String(msg.caption || '').trim(),
      thumbnailFileId: String(
        rawIncomingMedia.thumbnail?.file_id || rawIncomingMedia.thumb?.file_id || ''
      ),
    });
    await sendOrEditMultiPartMenuInTelegram(
      chatId,
      activeMultiPartSession.statusMessageId,
      msg.message_id,
      `✅ <b>Parte #${activeMultiPartSession.parts.length} agregada:</b> <code>${escapeHtml(partFileName)}</code> (${formatBytes(partSize)})`
    );
    return;
  }

  // 3b. Check if user sent a new Video
  const videoObj =
    msg.video ||
    (msg.document &&
    (String(msg.document.mime_type || '').startsWith('video/') ||
      /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(String(msg.document.file_name || '')))
      ? msg.document
      : null);

  if (videoObj) {
    if (!isMasterAdminChat(chatId)) {
      await ensureGuestSessionChannelDiscovered(chatId);
    }
    const userChannelCtx = getEffectivePictaContext(chatId);
    if (!userChannelCtx.isLinked || !userChannelCtx.channelId) {
      const session = userSessions.get(chatId);
      if (session && session.authToken) {
        await sendTelegramStatusMessage(
          chatId,
          `📺 <b>CUENTA AUTENTICADA, FALTA VINCULAR TU CANAL</b>\n\n` +
            `Tu sesión está activa como <b>${escapeHtml(session.userFullName || session.username)}</b> ✅\n\n` +
            `Para subir tus videos a tu propio canal de Picta, escribe:\n` +
            `<code>/canal &lt;enlace o id de tu canal&gt;</code>\n\n` +
            `<i>Ejemplo:</i> <code>/canal https://www.picta.cu/canal/mi-canal</code>`,
          msg.message_id,
          [[{ text: '🔍 Vincular mi canal (/canal)', callback_data: 'chan_switch:prompt' }]]
        );
        return;
      }

      await sendTelegramStatusMessage(
        chatId,
        `⚪ <b>CUENTA DE PICTA SIN VINCULAR</b>\n\n` +
          `<blockquote>` +
          `👤 <b>Estado:</b> Sin vincular\n` +
          `📺 <b>Canal activo:</b> Sin vincular` +
          `</blockquote>\n` +
          `Para subir videos a tu propio canal de Picta, primero vincula tu cuenta tocando el botón de abajo o escribiendo <code>/login</code>:`,
        msg.message_id,
        [[{ text: '🔑 Vincular mi cuenta de Picta (/login)', callback_data: 'user_picta_login_start' }]]
      );
      return;
    }

    const fileName =
      videoObj.file_name ||
      `video_telegram_${msg.message_id}_${Date.now().toString().slice(-4)}.mp4`;
    const fileSize = Number(videoObj.file_size || 0);
    const caption = String(msg.caption || '').trim();
    const fileUniqueId = String(videoObj.file_unique_id || '');
    const thumbnailFileId = String(
      videoObj.thumbnail?.file_id || videoObj.thumb?.file_id || ''
    );

    const existingActiveJob = fileUniqueId
      ? transferJobs.find(
          (j) =>
            j.telegramChatId === chatId &&
            j.fileUniqueId === fileUniqueId &&
            j.stage !== 'completed' &&
            j.stage !== 'failed'
        )
      : undefined;

    if (existingActiveJob) {
      existingActiveJob.telegramMessageId = msg.message_id;
      existingActiveJob.fileId = videoObj.file_id || existingActiveJob.fileId;
      if (thumbnailFileId) {
        existingActiveJob.thumbnailFileId = thumbnailFileId;
      }
      existingActiveJob.updatedAt = new Date().toISOString();
      saveJobsToDisk();
      return;
    }

    const analyzedIntake = analyzeVideoTitleAndSynopsis(fileName, caption);

    const newJob: VideoTransferJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      telegramMessageId: msg.message_id,
      statusMessageId: null,
      telegramChatId: chatId,
      senderName,
      fileId: videoObj.file_id,
      fileUniqueId,
      thumbnailFileId,
      fileName,
      mimeType: videoObj.mime_type || 'video/mp4',
      caption,
      expectedBytes: fileSize,
      downloadedBytes: 0,
      integrityVerified: false,
      diskVerifiedBytes: 0,
      uploadedBytes: 0,
      stage: 'awaiting_category',
      title: analyzedIntake.initialTitle,
      titleMode: 'pending',
      synopsis: analyzedIntake.initialSynopsis,
      category: 'Audiovisual',
      tipologiaId: 8,
      tags: [],
      speedMBps: 0,
      targetChannelId: userChannelCtx.channelId,
      targetChannelName: userChannelCtx.channelName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...((analyzedIntake.episodeSubtitle || analyzedIntake.needsManualTitle || analyzedIntake.filenameIsRandom)
        ? {
            modelMetadata: {
              ...(analyzedIntake.episodeSubtitle ? { episodeSubtitle: analyzedIntake.episodeSubtitle } : {}),
              ...(analyzedIntake.needsManualTitle ? { needsManualTitle: 'true' } : {}),
              ...(analyzedIntake.filenameIsRandom ? { filenameIsRandom: 'true' } : {}),
            },
          }
        : {}),
    };

    transferJobs.unshift(newJob);
    pruneTransferJobsMemory();

    // Check if 📌 Modo Serie Fija (Ráfaga Automática) is active for this chat!
    const pinnedSerie = pinnedBatchSerieByChat.get(chatId);
    if (pinnedSerie) {
      const serieInfo = analyzedIntake.seriesInfo;
      const targetSeason = String(
        serieInfo.temporada && Number(serieInfo.temporada) > 1
          ? serieInfo.temporada
          : pinnedSerie.seasonNum || '1'
      );
      const targetEp = String(serieInfo.numero || '1');
      const epSub = String(
        serieInfo.episodeSubtitle || analyzedIntake.episodeSubtitle || ''
      ).trim();

      const inheritedStyle = resolveSeriesStyleForChannel(
        chatId,
        pinnedSerie.pelserId,
        pinnedSerie.serieName
      );

      newJob.tipologiaId = 5;
      newJob.category = 'Serie';
      newJob.titleMode = 'manual';
      newJob.title = inheritedStyle
        ? formatEpisodeWithSeriesStyle(inheritedStyle, {
            serieName: pinnedSerie.serieName,
            temporada: targetSeason,
            numero: targetEp,
            episodeSubtitle: epSub,
          })
        : formatSerieEpisodeTitle(
            pinnedSerie.serieName,
            targetSeason,
            targetEp,
            epSub
          );
      const cleanPinnedName = cleanSerieDisplayName(pinnedSerie.serieName) || pinnedSerie.serieName;
      newJob.synopsis = sanitizePublicPictaText(
        analyzedIntake.initialSynopsis &&
          !isStaleOrGenericSerieSynopsis(analyzedIntake.initialSynopsis, caption, targetEp)
          ? analyzedIntake.initialSynopsis
          : `Capítulo ${targetEp} de la Temporada ${targetSeason} de la serie ${cleanPinnedName}${epSub ? ` titulado "${epSub}"` : ''}, disponible en el canal ${userChannelCtx.channelName}.`
      );
      newJob.modelMetadata = {
        serie: pinnedSerie.serieName,
        ...(pinnedSerie.pelserId > 0 ? { serie_pelser_id: String(pinnedSerie.pelserId) } : {}),
        temporada: targetSeason,
        ...(pinnedSerie.seasonId && targetSeason === String(pinnedSerie.seasonNum)
          ? { temporada_id: String(pinnedSerie.seasonId) }
          : {}),
        numero: targetEp,
        ...(epSub ? { episodeSubtitle: epSub } : {}),
      };
      if (!newJob.customCoverFileId && pinnedSerie.customCoverFileId) {
        newJob.customCoverFileId = pinnedSerie.customCoverFileId;
      }
      saveJobsToDisk();

      const pausedForDup = await checkPictaDuplicateAndPromptIfFound(
        newJob,
        chatId,
        null,
        'pinned_serie'
      );
      if (pausedForDup) return;

      await executePinnedSerieUploadAfterDuplicateCheck(newJob, chatId, null);
      return;
    }

    currentActivity = `Video recibido de ${senderName}: "${fileName}" (${formatBytes(fileSize)}). Esperando elección de categoría...`;
    saveJobsToDisk();

    addLiveLog(
      'telegram',
      'info',
      `Video recibido de ${senderName}: "${fileName}" (${formatBytes(fileSize)}). Solicitando categoría de Picta.`
    );

    const sentPromptId = await sendTelegramStatusMessage(
      chatId,
      `${hudHeader('NUEVO VIDEO RECIBIDO')}\n` +
        hudBox([
          `📄 <b>Archivo:</b> <code>${escapeHtml(fileName)}</code>`,
          `📦 <b>Tamaño:</b> ${formatBytes(fileSize)}`,
          `📺 <b>Canal:</b> ${escapeHtml(userChannelCtx.channelName)} · <code>#${escapeHtml(userChannelCtx.channelId)}</code>`,
          analyzedIntake.needsManualTitle
            ? `⚠️ <b>Nombre aleatorio:</b> <i>Te pediré el título tras elegir categoría</i>`
            : analyzedIntake.initialTitle
              ? `${analyzedIntake.titleSource === 'caption' && analyzedIntake.filenameIsRandom ? '💬' : '🎬'} <b>Título detectado:</b> <code>${escapeHtml(analyzedIntake.initialTitle.slice(0, 64))}</code>`
              : undefined,
        ]) +
        `\n📂 <b>Selecciona la categoría de Picta:</b>\n` +
        `<i>(Si eliges <b>📺 Serie</b> podrás elegir una serie de tu canal, crear una nueva o activar el <b>📌 Modo Serie Fija</b> para ráfagas automáticas)</i>`,
      msg.message_id,
      buildCategorySelectionKeyboard(newJob.id)
    );
    if (sentPromptId) {
      newJob.statusMessageId = sentPromptId;
      saveJobsToDisk();
    }
    return;
  }

  const text = String(msg.text || '').trim();
  if (!text) return;

  // Handle direct Telegram Reply to any comment alert notification
  const repliedMsgId = msg.reply_to_message?.message_id;
  if (repliedMsgId && !text.startsWith('/')) {
    const replyTarget = alertsState.replyTargets[`${chatId}:${repliedMsgId}`];
    if (replyTarget) {
      try {
        await postPictaCommentInChannel(
          chatId,
          replyTarget.pubId,
          text,
          replyTarget.commentId
        );
        await sendTelegramStatusMessage(
          chatId,
          `✅ <b>Respuesta publicada en Picta</b>\n` +
            `<blockquote>` +
            `🎬 <b>Video:</b> ${escapeHtml(replyTarget.pubTitle)}\n` +
            `↩️ <b>Respondiendo a:</b> @${escapeHtml(replyTarget.author)}\n` +
            `💬 <i>"${escapeHtml(text.slice(0, 220))}"</i>` +
            `</blockquote>`,
          msg.message_id,
          [
            [
              {
                text: '🌐 Ver Video en Picta',
                url: `https://www.picta.cu/medias/${replyTarget.pubId}`,
              },
            ],
          ]
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>No se pudo publicar tu respuesta en Picta:</b>\n<code>${escapeHtml(errMsg.slice(0, 180))}</code>`,
          msg.message_id
        );
      }
      return;
    }
  }

  // 0. Handle Pending User Picta Login Wizard (Username / Password)
  const pendingLogin = pendingUserLoginByChat.get(chatId);
  if (pendingLogin) {
    if (text.startsWith('/cancelar') || text.startsWith('/salir')) {
      pendingUserLoginByChat.delete(chatId);
      await sendTelegramStatusMessage(
        chatId,
        '❌ <i>Inicio de sesión en Picta cancelado.</i>',
        msg.message_id
      );
      return;
    }

    if (pendingLogin.step === 'awaiting_username') {
      pendingLogin.username = text.trim();
      pendingLogin.step = 'awaiting_password';
      await sendTelegramStatusMessage(
        chatId,
        `🔑 <b>PASO 2/2 · CONTRASEÑA DE PICTA</b>\n\n` +
          `Usuario: <code>${escapeHtml(pendingLogin.username)}</code>\n\n` +
          `Escribe ahora tu contraseña de Picta:\n\n` +
          `🛡️ <i>Tu mensaje será eliminado del chat de inmediato tras ser leído para proteger tu privacidad.</i>`,
        msg.message_id
      );
      return;
    }

    if (pendingLogin.step === 'awaiting_password') {
      const inputPass = text.trim();
      // Immediately delete the user's password message
      await callTelegramBotApi('deleteMessage', {
        chat_id: chatId,
        message_id: msg.message_id,
      }).catch(() => {});

      const authResult = await performUserPictaLogin(chatId, pendingLogin.username || '', inputPass);
      pendingUserLoginByChat.delete(chatId);

      if (!authResult.success || !authResult.session) {
        await sendTelegramStatusMessage(
          chatId,
          `❌ <b>Error al autenticar en Picta:</b>\n\n` +
            `<blockquote>${escapeHtml(authResult.message)}</blockquote>\n\n` +
            `Verifica tus credenciales y prueba de nuevo escribiendo <code>/login</code>.`,
          undefined,
          [[{ text: '🔄 Intentar de nuevo (/login)', callback_data: 'user_picta_login_start' }]]
        );
        return;
      }

      const session = authResult.session;
      const hasLinkedChan = Boolean(session.channelId && session.channelId !== '0');
      const channelButtons = (session.availableChannels || []).slice(0, 8).map((c) => [
        {
          text: `📺 ${c.nombre} (#${c.id})`,
          callback_data: `user_channel_pick:${c.id}`,
        },
      ]);

      if (hasLinkedChan) {
        pendingToolkitInputByChat.delete(chatId);
        await sendTelegramStatusMessage(
          chatId,
          `🎉 <b>¡CUENTA DE PICTA VINCULADA CON ÉXITO!</b>\n\n` +
            `<blockquote>` +
            `👤 <b>Usuario Picta:</b> ${escapeHtml(session.userFullName || session.username)}\n` +
            `📺 <b>Canal Activo:</b> ${escapeHtml(session.channelName)} (<code>#${escapeHtml(session.channelId)}</code>)\n` +
            `📦 <b>Canales encontrados:</b> ${session.availableChannels.length}` +
            `</blockquote>\n` +
            `✅ <b>Todo listo en 1 paso:</b> Ya puedes enviarme tus videos directamente aquí y se subirán exclusivamente a este canal.\n\n` +
            (session.availableChannels.length > 1
              ? `<i>Puedes tocar un botón abajo para cambiar de canal activo en cualquier momento:</i>`
              : ''),
          undefined,
          channelButtons.length > 1 ? channelButtons : undefined
        );
      } else {
        pendingToolkitInputByChat.set(chatId, {
          mode: 'switch_channel_query',
          messageId: null,
        });
        await sendTelegramStatusMessage(
          chatId,
          `🎉 <b>¡CUENTA DE PICTA VINCULADA CON ÉXITO!</b>\n\n` +
            `<blockquote>` +
            `👤 <b>Usuario Picta:</b> ${escapeHtml(session.userFullName || session.username)}\n` +
            `📺 <b>Canal Activo:</b> Sin canal asignado automáticamente\n` +
            `📦 <b>Canales encontrados:</b> 0` +
            `</blockquote>\n` +
            `📌 <b>Último paso (solo responde este mensaje):</b> Pega aquí mismo el <b>enlace de tu canal</b> (ej: <code>https://www.picta.cu/canal/tu-canal</code>), su <b>nombre</b> o su <b>ID numérico</b> y quedará vinculado al instante sin escribir comandos:`,
          undefined,
          [
            [{ text: '🔄 Reintentar Detección Automática', callback_data: 'retry_auto_discover_channel' }],
            [{ text: '❌ Cancelar', callback_data: 'cmd_start' }],
          ]
        );
      }
      return;
    }
  }

  // 0.4 Handle Pending Global Picta Search (/buscar)
  const pendingPictaSearch = pendingPictaSearchByChat.get(chatId);
  if (pendingPictaSearch && !text.startsWith('/')) {
    pendingPictaSearchByChat.delete(chatId);
    await sendOrEditPictaSearchResultsInTelegram(
      chatId,
      pendingPictaSearch.messageId,
      text.trim(),
      0,
      msg.message_id
    );
    return;
  }

  // 0.5 Handle Pending Multi-Account Quota Pool Wizard (Username / Password)
  const pendingPool = pendingPoolAccountByChat.get(chatId);
  if (pendingPool) {
    const primaryCtxCheck = getEffectivePictaContext(chatId);
    if (!isMasterAdminChat(chatId) && (!primaryCtxCheck.isLinked || !primaryCtxCheck.channelId)) {
      pendingPoolAccountByChat.delete(chatId);
      return;
    }
    if (text.startsWith('/cancelar') || text.startsWith('/salir')) {
      const retJobId = pendingPool.returnToJobId;
      pendingPoolAccountByChat.delete(chatId);
      if (retJobId) {
        const retJob = transferJobs.find((j) => j.id === retJobId);
        if (retJob) {
          await promptUploadAccountSelection(retJob, chatId, pendingPool.messageId);
          return;
        }
      }
      await sendOrEditQuotaMenuInTelegram(
        chatId,
        pendingPool.messageId,
        msg.message_id,
        'ℹ️ <i>Registro de cuenta secundaria cancelado.</i>'
      );
      return;
    }

    if (pendingPool.step === 'awaiting_username') {
      pendingPool.username = text.trim();
      pendingPool.step = 'awaiting_password';
      await sendTelegramStatusMessage(
        chatId,
        `🔑 <b>PASO 2/2 · CONTRASEÑA DE LA CUENTA COLABORADORA</b>\n\n` +
          `Cuenta para el Pool: <code>${escapeHtml(pendingPool.username)}</code>\n\n` +
          `Escribe ahora la contraseña de Picta de esta cuenta:\n\n` +
          `🛡️ <i>Tu mensaje será eliminado del chat de inmediato y la cuenta quedará guardada en tu Pool para subir en tu canal.</i>`,
        msg.message_id
      );
      return;
    }

    if (pendingPool.step === 'awaiting_password') {
      const inputPass = text.trim();
      await callTelegramBotApi('deleteMessage', {
        chat_id: chatId,
        message_id: msg.message_id,
      }).catch(() => {});

      const rawUser = (pendingPool.username || '').trim();
      const retJobId = pendingPool.returnToJobId;
      const savedMsgId = pendingPool.messageId;
      pendingPoolAccountByChat.delete(chatId);

      const newPoolAcc: QuotaPoolAccount = {
        username: rawUser,
        password: inputPass,
        uploadedToday: 0,
      };

      try {
        const { userId } = await authenticatePoolPictaAccount(newPoolAcc, true);
        const primaryCtx = getEffectivePictaContext(chatId);
        const targetChanId = primaryCtx.channelId || botConfig.pictaChannelId || '36319';
        const primaryTokenOpt = await primaryCtx.accessTokenPromise.catch(() => '');
        if (primaryTokenOpt) {
          await ensurePoolAccountAssociatedWithChannel(primaryTokenOpt, targetChanId, userId).catch(() => {});
        }
        newPoolAcc.associatedChannelIds = [String(targetChanId)];

        let targetPoolList: QuotaPoolAccount[];
        if (isMasterAdminChat(chatId)) {
          targetPoolList = quotaSettings.poolAccounts;
        } else {
          const sess = userSessions.get(chatId);
          if (!sess) {
            throw new Error('No se encontró tu sesión activa de Picta (/login).');
          }
          if (!Array.isArray(sess.poolAccounts)) sess.poolAccounts = [];
          targetPoolList = sess.poolAccounts;
        }

        const existingIdx = targetPoolList.findIndex(
          (a) => a.username.toLowerCase() === rawUser.toLowerCase()
        );
        if (existingIdx >= 0) {
          targetPoolList[existingIdx] = newPoolAcc;
        } else {
          targetPoolList.push(newPoolAcc);
        }
        savePoolAccountsForChat(chatId);

        if (retJobId) {
          const retJob = transferJobs.find((j) => j.id === retJobId);
          if (retJob) {
            await sendTelegramStatusMessage(
              chatId,
              `✅ <b>Colaborador <code>${escapeHtml(newPoolAcc.displayName || rawUser)}</code> añadido al Pool.</b> Elígelo abajo para subir tu video:`,
              msg.message_id
            );
            await promptUploadAccountSelection(retJob, chatId, savedMsgId);
            return;
          }
        }

        const publishablePoolCount = targetPoolList.filter(
          (a) => a.canPublishDirectly !== false
        ).length;
        const roleNotice =
          newPoolAcc.canPublishDirectly === false
            ? `⚠️ <b>Rol detectado:</b> <code>Usuario común</code> (sin permiso <b>Jefe de canal</b>).\nPodrá pre-subir videos a S3 MinIO pero requiere grupo Jefe de canal en Picta para publicar.`
            : `✅ <b>Rol verificado:</b> <code>Jefe de canal</code> · Suma <b>+10 publicaciones reales diarias</b> (total actual: <b>${(1 + publishablePoolCount) * 10} subidas diarias</b>).`;
        await sendOrEditQuotaMenuInTelegram(
          chatId,
          savedMsgId,
          undefined,
          `🎉 <b>¡Cuenta colaboradora <code>${escapeHtml(newPoolAcc.displayName || rawUser)}</code> verificada y guardada en tu Pool (#${escapeHtml(targetChanId)})!</b>\n${roleNotice}`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (retJobId) {
          const retJob = transferJobs.find((j) => j.id === retJobId);
          if (retJob) {
            await sendTelegramStatusMessage(
              chatId,
              `❌ <b>No se pudo autenticar al colaborador (${escapeHtml(rawUser)}):</b> <code>${escapeHtml(errMsg.slice(0, 140))}</code>`,
              msg.message_id
            );
            await promptUploadAccountSelection(retJob, chatId, savedMsgId);
            return;
          }
        }
        await sendOrEditQuotaMenuInTelegram(
          chatId,
          savedMsgId,
          undefined,
          `❌ <b>No se pudo autenticar la cuenta colaboradora (${escapeHtml(rawUser)}):</b> <code>${escapeHtml(errMsg.slice(0, 140))}</code>`
        );
      }
      return;
    }
  }

  // Admin Commands: /autorizar, /quitar, /revocar, /usuarios, /whitelist
  if (text.startsWith('/autorizar')) {
    if (chatId !== MASTER_ADMIN_CHAT_ID) {
      await sendTelegramStatusMessage(
        chatId,
        `⛔ <i>Solo el Administrador Principal (@admin_bot) tiene permiso para autorizar usuarios.</i>`,
        msg.message_id
      );
      return;
    }
    const target = text.replace(/^\/autorizar(@\w+)?/i, '').trim();
    if (!target) {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ <b>Uso del comando:</b>\n<code>/autorizar &lt;ID o @usuario&gt;</code>\n\n` +
          `<b>Ejemplos:</b>\n` +
          `• <code>/autorizar 123456789</code>\n` +
          `• <code>/autorizar @pepito</code>`,
        msg.message_id
      );
      return;
    }
    const res = authorizeUser(target, chatId);
    await sendTelegramStatusMessage(
      chatId,
      res.success
        ? `✅ <b>Usuario Autorizado:</b>\n\n` +
          `<blockquote>` +
          `👤 <b>Identificador:</b> <code>${escapeHtml(target)}</code>\n` +
          `📅 <b>Fecha:</b> ${new Date().toLocaleString('es-CU')}\n` +
          `🛡️ <b>Autorizado por:</b> @admin_bot` +
          `</blockquote>\n` +
          `El usuario ya puede interactuar con el bot y subir videos a Picta.`
        : `⚠️ <b>Aviso:</b> ${escapeHtml(res.message)}`,
      msg.message_id
    );
    if (res.success && /^\d+$/.test(target)) {
      // Send welcoming notice to newly authorized user
      await callTelegramBotApi('sendMessage', {
        chat_id: target,
        text:
          `🎉 <b>¡HAS SIDO AUTORIZADO!</b>\n\n` +
          `El administrador (@admin_bot) te ha concedido acceso para usar el bot de Picta.\n\n` +
          `• Escribe <code>/start</code> para ver el menú principal.\n` +
          `• Escribe <code>/login</code> para conectar tu propia cuenta y canal de Picta.`,
        parse_mode: 'HTML',
      }).catch(() => {});
    }
    return;
  }

  if (text.startsWith('/quitar') || text.startsWith('/revocar')) {
    if (chatId !== MASTER_ADMIN_CHAT_ID) {
      await sendTelegramStatusMessage(
        chatId,
        `⛔ <i>Solo el Administrador Principal (@admin_bot) tiene permiso para revocar usuarios.</i>`,
        msg.message_id
      );
      return;
    }
    const target = text.replace(/^\/(quitar|revocar)(@\w+)?/i, '').trim();
    if (!target) {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ <b>Uso:</b> <code>/quitar &lt;ID o @usuario&gt;</code>`,
        msg.message_id
      );
      return;
    }
    const res = revokeUser(target);
    await sendTelegramStatusMessage(
      chatId,
      res.success ? `✅ ${escapeHtml(res.message)}` : `⚠️ ${escapeHtml(res.message)}`,
      msg.message_id
    );
    return;
  }

  if (text.startsWith('/usuarios') || text.startsWith('/whitelist')) {
    await sendOrEditAdminUsersDashboardInTelegram(chatId, null, 0, msg.message_id);
    return;
  }

  // User Picta Session Commands: /login, /micuenta, /canales, /canal, /logout
  if (text.startsWith('/login') || text.startsWith('/conectar')) {
    pendingUserLoginByChat.set(chatId, { step: 'awaiting_username' });
    await sendTelegramStatusMessage(
      chatId,
      `📱 <b>PASO 1/2 · VINCULAR TU CUENTA DE PICTA</b>\n\n` +
        `Por favor, escribe tu <b>número de teléfono (+53...)</b> o tu <b>usuario de Picta</b>:\n\n` +
        `<i>(O escribe /cancelar para salir)</i>`,
      msg.message_id
    );
    return;
  }

  if (text.startsWith('/micuenta') || text.startsWith('/cuenta')) {
    await sendOrEditAccountDiagnosticInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/canales')) {
    const isMaster = isMasterAdminChat(chatId);
    if (isMaster) {
      await sendTelegramStatusMessage(
        chatId,
        `📺 <b>CANAL ACTIVO:</b> Canal Oficial (#36319)`,
        msg.message_id,
        [[{ text: '🏛️ Editar Canal (/canal)', callback_data: 'chan_editor:open' }]]
      );
      return;
    }
    await ensureGuestSessionChannelDiscovered(chatId, true);
    const session = userSessions.get(chatId);
    if (!session) {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ Primero debes iniciar sesión en Picta con <code>/login</code> para ver tus canales.`,
        msg.message_id,
        [[{ text: '🔑 Iniciar Sesión (/login)', callback_data: 'user_picta_login_start' }]]
      );
      return;
    }
    const channelButtons = (session.availableChannels || []).slice(0, 8).map((c) => [
      {
        text: `📺 ${c.nombre} (#${c.id})${String(c.id) === session.channelId ? ' ✅' : ''}`,
        callback_data: `user_channel_pick:${c.id}`,
      },
    ]);
    channelButtons.push([{ text: '🏛️ Editar Canal Activo (/canal)', callback_data: 'chan_editor:open' }]);
    await sendTelegramStatusMessage(
      chatId,
      `📺 <b>ELIGE TU CANAL ACTIVO EN PICTA:</b>\n\n` +
        `Actualmente seleccionado: ${session.channelId ? `<b>${escapeHtml(session.channelName)} (#${escapeHtml(session.channelId)})</b>` : '<i>Sin canal asignado</i>'}\n\n` +
        `Toca el canal donde deseas que se suban tus videos:`,
      msg.message_id,
      channelButtons
    );
    return;
  }

  if (
    text.startsWith('/canal') ||
    text.startsWith('/micanal') ||
    text.startsWith('/editarcanal')
  ) {
    pendingToolkitInputByChat.delete(chatId);
    const rawArg = text.replace(/^\/(?:canal|micanal|editarcanal)/i, '').trim();
    const isMaster = isMasterAdminChat(chatId);
    if (!isMaster) {
      await ensureGuestSessionChannelDiscovered(chatId, true);
    }
    const session = userSessions.get(chatId);
    if (isMaster && session && (!session.channelId || session.channelId === '0')) {
      const masterChId = String(botConfig.pictaChannelId || '36319');
      session.channelId = masterChId;
      session.channelName = session.channelName || 'Canal Oficial';
      session.verifiedChannelOwnership = true;
      if (!Array.isArray(session.availableChannels)) session.availableChannels = [];
      if (!session.availableChannels.some((x) => String(x.id) === masterChId)) {
        session.availableChannels.unshift({ id: Number(masterChId), nombre: session.channelName });
      }
      saveUserSessionsToDisk();
    } else if (!isMaster && session && (!session.channelId || session.channelId === '0') && session.availableChannels?.length > 0) {
      session.channelId = String(session.availableChannels[0].id);
      session.channelName = session.availableChannels[0].nombre;
      session.verifiedChannelOwnership = true;
      saveUserSessionsToDisk();
    }

    if (rawArg) {
      if (session) {
        const candidates = await findPictaChannel(rawArg, session.authToken, chatId);
        if (candidates.length === 1) {
          const found = candidates[0];
          session.channelId = String(found.id);
          session.channelName = found.nombre;
          session.verifiedChannelOwnership = true;
          if (!session.availableChannels.some((x) => String(x.id) === String(found.id))) {
            session.availableChannels.push({ id: found.id, nombre: found.nombre, alias: found.alias });
          }
          saveUserSessionsToDisk();
          await sendTelegramStatusMessage(
            chatId,
            `✅ <b>Canal activo actualizado a:</b> ${escapeHtml(session.channelName)} (<code>#${found.id}</code>)\n` +
            `Todos tus videos y publicaciones se subirán a este canal.`,
            msg.message_id
          );
          await sendOrEditChannelEditorMenu(chatId, null, msg.message_id);
          return;
        } else if (candidates.length > 1) {
          const kb = candidates.slice(0, 5).map((c) => [
            {
              text: `📺 ${c.nombre} (#${c.id})`,
              callback_data: `chan_switch:select:${c.id}`,
            },
          ]);
          kb.push([{ text: '⬅️ Cancelar', callback_data: 'chan_editor:open' }]);
          await sendTelegramStatusMessage(
            chatId,
            `🔍 <b>Se encontraron ${candidates.length} canales:</b>\n` +
            `Toca el botón correspondiente a tu canal para vincularlo:\n\n` +
            candidates
              .map((c) => `• <b>${escapeHtml(c.nombre)}</b> (<code>#${c.id}</code>)`)
              .join('\n'),
            msg.message_id,
            kb
          );
          return;
        } else {
          await sendTelegramStatusMessage(
            chatId,
            `⚠️ No pudimos encontrar un canal propio con "<code>${escapeHtml(rawArg)}</code>" en Picta.\n\n` +
            `💡 <b>¿Cómo vincularlo?</b>\n` +
            `• Entra a tu canal en Picta y copia el enlace: <code>/canal https://www.picta.cu/canal/tu-canal</code>\n` +
            `• O ingresa su ID numérico si lo conoces: <code>/canal 12345</code>`,
            msg.message_id
          );
          return;
        }
      } else if (!isMaster) {
        await sendTelegramStatusMessage(
          chatId,
          `ℹ️ Primero debes iniciar sesión en Picta con <code>/login</code> para vincular tu canal.`,
          msg.message_id
        );
        return;
      }
    }

    const ctx = getEffectivePictaContext(chatId);
    if (!isMaster && session && (!ctx.isLinked || !ctx.channelId || ctx.channelId === '0')) {
      pendingToolkitInputByChat.set(chatId, {
        mode: 'switch_channel_query',
        messageId: null,
      });
      await sendTelegramStatusMessage(
        chatId,
        `📺 <b>VINCULA TU CANAL DE PICTA</b>\n\n` +
        `Escribe ahora el <b>enlace directo de tu canal</b> (ej: <code>https://www.picta.cu/canal/mi-canal</code>) o su <b>ID numérico</b>:\n\n` +
        `<i>💡 También puedes escribir /canal &lt;enlace o id&gt; en cualquier momento.</i>`,
        msg.message_id,
        [[{ text: '⬅️ Cancelar', callback_data: 'cmd_start' }]]
      );
      return;
    }

    await sendOrEditChannelEditorMenu(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/logout') || text.startsWith('/cerrarsesion')) {
    if (chatId === MASTER_ADMIN_CHAT_ID) {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ La cuenta del Administrador Principal utiliza las credenciales seguras del servidor.`,
        msg.message_id
      );
      return;
    }
    userSessions.delete(chatId);
    saveUserSessionsToDisk();
    await sendTelegramStatusMessage(
      chatId,
      `🚪 <b>Tu sesión de Picta ha sido cerrada.</b>`,
      msg.message_id
    );
    return;
  }

  if (
    text.startsWith('/cola') ||
    text.startsWith('/queue') ||
    text.startsWith('/rafaga') ||
    text.startsWith('/fijar')
  ) {
    await sendOrEditQueueManagerInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/unir') || text.startsWith('/partes') || text.startsWith('/join')) {
    await sendOrEditMultiPartMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (
    text.startsWith('/cuota') ||
    text.startsWith('/limite') ||
    text.startsWith('/pool') ||
    text.startsWith('/cuentas')
  ) {
    await sendOrEditQuotaMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/buscar') || text.startsWith('/search')) {
    pendingPictaSearchByChat.delete(chatId);
    const searchArg = text.replace(/^\/(buscar|search)(@\w+)?/i, '').trim();
    if (!searchArg) {
      pendingPictaSearchByChat.set(chatId, { messageId: null });
      await sendTelegramStatusMessage(
        chatId,
        `${hudHeader('BUSCADOR GLOBAL DE PICTA')}\n` +
          `✍️ <b>Escribe ahora el título de la película, serie o video que quieres buscar en toda Picta</b> (ej: <i>Dune Parte 2</i> o <i>Deadpool</i>):\n\n` +
          `<i>(O escribe <code>/buscar Título</code> directamente · /cancelar para salir)</i>`,
        msg.message_id,
        [[{ text: '⬅️ Volver al Menú', callback_data: 'cmd_start' }]]
      );
      return;
    }
    await sendOrEditPictaSearchResultsInTelegram(chatId, null, searchArg, 0, msg.message_id);
    return;
  }

  if (text.startsWith('/cancelar') || text.startsWith('/stop')) {
    if (pendingPictaSearchByChat.has(chatId)) {
      const pendingS = pendingPictaSearchByChat.get(chatId);
      pendingPictaSearchByChat.delete(chatId);
      await sendOrEditMainMenuInTelegram(chatId, pendingS?.messageId || null, msg.message_id);
      return;
    }
    if (pendingPoolAccountByChat.has(chatId)) {
      const pending = pendingPoolAccountByChat.get(chatId);
      pendingPoolAccountByChat.delete(chatId);
      await sendOrEditQuotaMenuInTelegram(
        chatId,
        pending?.messageId || null,
        msg.message_id,
        `ℹ️ <i>Registro de cuenta secundaria cancelado.</i>`
      );
      return;
    }
    if (pendingChannelEditByChat.has(chatId)) {
      const pending = pendingChannelEditByChat.get(chatId);
      pendingChannelEditByChat.delete(chatId);
      await sendOrEditChannelEditorMenu(
        chatId,
        pending?.messageId || null,
        msg.message_id,
        `ℹ️ <i>Edición de canal cancelada.</i>`
      );
      return;
    }
    if (pendingToolkitInputByChat.has(chatId)) {
      const pendingTk = pendingToolkitInputByChat.get(chatId);
      pendingToolkitInputByChat.delete(chatId);
      if (pendingTk?.mode === 'set_promo_requests_channel') {
        await sendOrEditPromoChannelMenuInTelegram(
          chatId,
          pendingTk.messageId || null,
          msg.message_id,
          `ℹ️ <i>Configuración de Canal de Pedidos cancelada.</i>`,
          pendingTk.promoId
        );
        return;
      }
      await sendOrEditChannelEditorMenu(
        chatId,
        pendingTk?.messageId || null,
        msg.message_id,
        `ℹ️ <i>Acción cancelada.</i>`
      );
      return;
    }
    if (pendingStandaloneSerieByChat.has(chatId)) {
      const pendingSt = pendingStandaloneSerieByChat.get(chatId);
      pendingStandaloneSerieByChat.delete(chatId);
      await sendOrEditMyChannelSeriesMenu(
        chatId,
        pendingSt?.messageId || null,
        msg.message_id,
        `ℹ️ <i>Edición de serie cancelada.</i>`
      );
      return;
    }
    const isMaster = isMasterAdminChat(chatId);
    const myTargetJob = transferJobs.find(
      (j) =>
        (isMaster || j.telegramChatId === chatId) &&
        (j.id === activeUploadJobId ||
          j.id === activeDownloadJobId ||
          uploadQueue.includes(j.id))
    );
    if (myTargetJob) {
      await cancelTransferJob(myTargetJob.id, chatId);
      await sendOrEditQueueManagerInTelegram(
        chatId,
        null,
        msg.message_id,
        `🛑 <b>Transferencia cancelada correctamente.</b>`
      );
    } else {
      await sendOrEditQueueManagerInTelegram(
        chatId,
        null,
        msg.message_id,
        `ℹ️ <i>No tienes ninguna subida activa ni en cola en este momento.</i>`
      );
    }
    return;
  }

  if (
    text.startsWith('/stats') ||
    text.startsWith('/estadisticas') ||
    text.startsWith('/dashboard') ||
    text.startsWith('/picta')
  ) {
    await sendOrEditPictaDashboardInTelegram(chatId, null, 'views', 0, msg.message_id, true);
    return;
  }

  if (text.startsWith('/series') || text.startsWith('/misseries')) {
    await sendOrEditMyChannelSeriesMenu(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/colaboradores') || text.startsWith('/asociados')) {
    await sendOrEditChannelCollaboratorsMenu(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/listas') || text.startsWith('/playlists')) {
    await sendOrEditPlaylistsMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/comentarios') || text.startsWith('/denuncias')) {
    await sendOrEditCommentsMenuInTelegram(chatId, null, undefined, msg.message_id);
    return;
  }

  if (text.startsWith('/logros') || text.startsWith('/alertas') || text.startsWith('/metas')) {
    await sendOrEditAlertsMilestonesMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (
    text.startsWith('/personas') ||
    text.startsWith('/actores') ||
    text.startsWith('/etiquetas') ||
    text.startsWith('/tags')
  ) {
    await sendOrEditPersonasAndTagsMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (
    text.startsWith('/canalpedidos') ||
    text.startsWith('/promocion') ||
    text.startsWith('/pedidoscanal')
  ) {
    await sendOrEditPromoChannelMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/auditoria') || text.startsWith('/saludcanal')) {
    await sendOrEditChannelAuditInTelegram(chatId, null, 'dups', 0, msg.message_id, true);
    return;
  }

  if (text === '/pedidos' || text.startsWith('/pedidos ')) {
    const inlineReq = text.replace(/^\/pedidos(@[A-Za-z0-9_]+)?\s*/i, '').trim();
    if (inlineReq) {
      await processRequestQueryAndReplyOrSave({
        ownerChatId: chatId,
        replyChatId: chatId,
        replyToMessageId: msg.message_id,
        query: inlineReq,
        requesterName: senderName,
        requesterUsername: msg.from?.username,
        autoSaveIfMissing: false,
      });
    } else {
      await sendOrEditRequestsManagerInTelegram(chatId, null, 'pending', 0, msg.message_id);
    }
    return;
  }

  if (text.startsWith('/pedir')) {
    const queryArg = text.replace(/^\/pedir(@[A-Za-z0-9_]+)?\s*/i, '').trim();
    if (!queryArg) {
      pendingToolkitInputByChat.set(chatId, {
        mode: 'add_or_check_request',
        messageId: null,
      });
      await sendTelegramStatusMessage(
        chatId,
        `🔎 <b>VERIFICAR O ANOTAR PEDIDO</b>\n\nEscribe ahora el título que pidió el suscriptor (o usa <code>/pedir Nombre</code>):`,
        msg.message_id,
        [[{ text: '📋 Ver Lista (/pedidos)', callback_data: 'req:list:pending:0' }]]
      );
      return;
    }
    await processRequestQueryAndReplyOrSave({
      ownerChatId: chatId,
      replyChatId: chatId,
      replyToMessageId: msg.message_id,
      query: queryArg,
      requesterName: senderName,
      requesterUsername: msg.from?.username,
      autoSaveIfMissing: false,
    });
    return;
  }

  if (text.startsWith('/start') || text.startsWith('/estado') || text.startsWith('/menu')) {
    await sendOrEditMainMenuInTelegram(chatId, null, msg.message_id);
    return;
  }

  if (text.startsWith('/netlog') || text.startsWith('/diag') || text.startsWith('/mtproto')) {
    if (!isMasterAdminChat(chatId)) {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ El diagnóstico avanzado de red MTProto está reservado para el administrador.`,
        msg.message_id
      );
      return;
    }
    const readyAux = Array.from(auxiliaryBotClients.values()).filter((c) => c.connected).length;
    const cooldownSec =
      mtprotoAuxFloodWaitUntilMs > Date.now()
        ? Math.ceil((mtprotoAuxFloodWaitUntilMs - Date.now()) / 1000)
        : 0;
    const recent = mtprotoDiagLogs.slice(0, 10);
    const lines = recent.length
      ? recent.map((entry) => {
          const t = new Date(entry.timestamp).toLocaleTimeString('es-CU', {
            timeZone: 'America/Havana',
            hour12: false,
          });
          return `• <code>${t}</code> ${escapeHtml(entry.message)}`;
        })
      : ['• Sin eventos MTProto registrados aún en esta instancia.'];
    await sendTelegramStatusMessage(
      chatId,
      `📡 <b>LOG DE RED Y VELOCIDAD MTPROTO</b>\n\n` +
        `<blockquote>` +
        `🔌 <b>Pool activo:</b> ${mtprotoConnected ? 1 : 0} principal + ${readyAux}/${Math.max(0, MTPROTO_TCP_POOL_SIZE - 1)} auxiliares\n` +
        (cooldownSec > 0 ? `⏳ <b>Enfriamiento login auxiliar:</b> ${cooldownSec}s\n` : '') +
        `📊 <b>Últimos ${recent.length} eventos:</b>\n` +
        lines.join('\n') +
        `</blockquote>`,
      msg.message_id
    );
    return;
  }

  if (text.startsWith('/disco')) {
    if (!isMasterAdminChat(chatId)) {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ El disco temporal de transferencias se gestiona automáticamente para tus videos.`,
        msg.message_id
      );
      return;
    }
    const diskStats = getScratchDiskStats(TMP_UPLOAD_DIR);
    const memStats = getMemoryTelemetry();
    const storageLabel =
      diskStats.storageType === 'ephemeral_disk'
        ? 'Disco efímero real (sin consumir RAM)'
        : diskStats.storageType === 'tmpfs_ram'
          ? 'Memoria temporal (tmpfs)'
          : 'Almacenamiento automático';
    await sendTelegramStatusMessage(
      chatId,
      `💾 <b>Estado de Disco Efímero y RAM (Automático)</b>\n\n` +
        `<blockquote>` +
        `📁 <b>Ruta activa:</b> <code>${escapeHtml(diskStats.path)}</code>\n` +
        `⚙️ <b>Tipo:</b> ${storageLabel}\n` +
        `💽 <b>Espacio libre:</b> ${formatBytes(diskStats.freeBytes)} / ${formatBytes(diskStats.totalBytes)} (${diskStats.usedPercent}% usado)\n` +
        `🧠 <b>RAM proceso:</b> ${formatBytes(memStats.rssBytes)} (Heap ${formatBytes(memStats.heapUsedBytes)})\n` +
        `🔄 <b>Pipeline:</b> 1 descarga + 1 subida simultánea` +
        `</blockquote>`,
      msg.message_id
    );
    return;
  }

  if (text.startsWith('/reintentar') || text.startsWith('/retry')) {
    const failedJob = transferJobs.find(
      (j) =>
        j.telegramChatId === chatId &&
        (j.stage === 'failed' ||
          (j.stage !== 'completed' && j.stage !== 'cancelled' && Boolean(j.minioKey)))
    );
    if (failedJob) {
      if (
        failedJob.encoderRetryActive ||
        (failedJob.encoderRetryLastError &&
          isPictaEncoderOrTransientServerError(
            failedJob.encoderRetryLastError,
            failedJob.pictaResponseCode
          ))
      ) {
        failedJob.encoderManualRetryTriggered = true;
      }
      failedJob.encoderRetryNextAt = 0;
      failedJob.stage = failedJob.minioKey ? 'creating_picta_publication' : 'generating_auto_title';
      failedJob.errorDetails = undefined;
      failedJob.updatedAt = new Date().toISOString();
      saveJobsToDisk();

      await sendTelegramStatusMessage(
        chatId,
        `🔄 <b>Reintentando publicación para:</b> ${escapeHtml(failedJob.title)}\n` +
          `<blockquote>` +
          `📂 <b>Categoría:</b> ${escapeHtml(failedJob.category || 'Audiovisual')}\n` +
          `🔑 <b>Manifiesto S3:</b> <code>${failedJob.minioKey || 'Por verificar'}</code>` +
          `</blockquote>\n` +
          `⏳ <i>${failedJob.minioKey ? 'Reutilizando subida completa a S3 MinIO. Creando ficha en Picta...' : 'Iniciando transferencia...'}</i>`,
        msg.message_id
      );

      await triggerCloudRunKeepAliveTransfer(
        failedJob.id,
        failedJob.title,
        failedJob.statusMessageId || null
      );
      return;
    } else {
      await sendTelegramStatusMessage(
        chatId,
        `ℹ️ No hay transferencias fallidas pendientes de reintento para este chat.`,
        msg.message_id
      );
      return;
    }
  }

  // 3.5 Handle text input when editing Channel Details in /canal (nombre, alias, descripcion, clasificacion)
  if (
    pendingChanEdit &&
    (pendingChanEdit.mode === 'nombre' ||
      pendingChanEdit.mode === 'alias' ||
      pendingChanEdit.mode === 'descripcion' ||
      pendingChanEdit.mode === 'clasificacion')
  ) {
    pendingChannelEditByChat.delete(chatId);
    const fieldLabels: Record<string, string> = {
      nombre: 'Nombre del canal',
      alias: 'Lema / Alias del canal',
      descripcion: 'Descripción del canal',
      clasificacion: 'Clasificación del canal',
    };
    const cleanVal = text.trim();
    try {
      await patchPictaChannelDetails(chatId, {
        [pendingChanEdit.mode]: cleanVal,
      });
      await sendOrEditChannelEditorMenu(
        chatId,
        pendingChanEdit.messageId,
        msg.message_id,
        `✅ <b>¡${fieldLabels[pendingChanEdit.mode] || 'Propiedad'} actualizado exitosamente en Picta!</b>`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await sendOrEditChannelEditorMenu(
        chatId,
        pendingChanEdit.messageId,
        msg.message_id,
        `⚠️ <b>Error al actualizar ${fieldLabels[pendingChanEdit.mode] || 'canal'}:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
      );
    }
    return;
  }

  // 3.8 Handle text input for Picta API Toolkit (Playlists, Collaborators, Comments, Personas, Keywords)
  const pendingToolkit = pendingToolkitInputByChat.get(chatId);
  if (pendingToolkit) {
    pendingToolkitInputByChat.delete(chatId);
    const cleanVal = text.trim();
    if (pendingToolkit.mode === 'new_playlist_name') {
      try {
        const created = await createChannelPlaylistInPicta(chatId, cleanVal);
        await sendOrEditPlaylistsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `✅ <b>¡Lista de reproducción "${escapeHtml(created.nombre)}" (ID: <code>${created.id}</code>) creada en tu canal!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPlaylistsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `⚠️ <b>Error al crear lista:</b> <code>${escapeHtml(errMsg.slice(0, 130))}</code>`
        );
      }
      return;
    }

    if (pendingToolkit.mode === 'add_collaborator_id') {
      if (!cleanVal) {
        await sendOrEditChannelCollaboratorsMenu(
          chatId,
          null,
          msg.message_id,
          `⚠️ <b>Ingresa el enlace del canal de tu socio, su @usuario o su ID numérico de Picta.</b>`
        );
        return;
      }
      try {
        const result = await modifyChannelCollaboratorInPicta(chatId, cleanVal, 'add');
        const labelExtra = result.resolvedLabel ? ` (${escapeHtml(result.resolvedLabel)})` : '';
        await sendOrEditChannelCollaboratorsMenu(
          chatId,
          null,
          msg.message_id,
          `✅ <b>¡Usuario <code>#${result.targetUserId}</code>${labelExtra} añadido como colaborador del canal!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditChannelCollaboratorsMenu(
          chatId,
          null,
          msg.message_id,
          `⚠️ <b>No se pudo asociar el colaborador:</b> ${escapeHtml(errMsg.slice(0, 260))}`
        );
      }
      return;
    }

    if (pendingToolkit.mode === 'reply_comment_text') {
      const pubId = Number(pendingToolkit.targetId || 0);
      const parentId = Number(pendingToolkit.secondaryId || 0);
      const prevView = lastCommentsViewByChat.get(chatId);
      const returnPubId = prevView ? prevView.pubId : pubId;
      try {
        await postPictaCommentInChannel(chatId, pubId, cleanVal, parentId);
        await sendOrEditCommentsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          returnPubId > 0 ? returnPubId : undefined,
          msg.message_id,
          `✅ <b>¡Tu respuesta fue publicada exitosamente en Picta!</b>\n\n<blockquote>💬 <i>"${escapeHtml(cleanVal.slice(0, 120))}"</i></blockquote>`,
          prevView
            ? { catKey: prevView.catKey, sort: prevView.sort, page: prevView.page, forceRefresh: true }
            : { forceRefresh: true }
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditCommentsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          returnPubId > 0 ? returnPubId : undefined,
          msg.message_id,
          `⚠️ <b>No se pudo publicar el comentario en Picta:</b> <code>${escapeHtml(errMsg.slice(0, 150))}</code>`,
          prevView ? { catKey: prevView.catKey, sort: prevView.sort, page: prevView.page } : undefined
        );
      }
      return;
    }

    if (pendingToolkit.mode === 'new_persona_name') {
      try {
        const persona = await searchOrCreatePictaPersonaInCatalog(chatId, cleanVal);
        await sendOrEditPersonasAndTagsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `✅ <b>¡Persona "${escapeHtml(persona.nombre)}" ${persona.created ? 'creada' : 'encontrada'} en Picta (ID: <code>${persona.id}</code>)!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPersonasAndTagsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `⚠️ <b>Error con persona:</b> <code>${escapeHtml(errMsg.slice(0, 130))}</code>`
        );
      }
      return;
    }

    if (pendingToolkit.mode === 'new_keyword_name') {
      try {
        const kw = await searchOrCreatePictaKeywordInCatalog(chatId, cleanVal);
        await sendOrEditPersonasAndTagsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `✅ <b>¡Palabra clave "${escapeHtml(kw.palabra)}" ${kw.created ? 'creada' : 'encontrada'} en Picta (ID: <code>${kw.id}</code>)!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPersonasAndTagsMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `⚠️ <b>Error con palabra clave:</b> <code>${escapeHtml(errMsg.slice(0, 130))}</code>`
        );
      }
      return;
    }

    if (pendingToolkit.mode === 'switch_channel_query') {
      const session = userSessions.get(chatId);
      if (!session) {
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ Debes iniciar sesión con /login primero.`,
          msg.message_id
        );
        return;
      }
      const candidates = await findPictaChannel(cleanVal, session.authToken, chatId);
      if (candidates.length === 1) {
        const found = candidates[0];
        session.channelId = String(found.id);
        session.channelName = found.nombre;
        session.verifiedChannelOwnership = true;
        if (!session.availableChannels.some((x) => String(x.id) === String(found.id))) {
          session.availableChannels.push({ id: found.id, nombre: found.nombre, alias: found.alias });
        }
        saveUserSessionsToDisk();
        if (!pendingToolkit.messageId) {
          await sendTelegramStatusMessage(
            chatId,
            `✅ <b>¡CANAL VINCULADO CON ÉXITO!</b>\n\n` +
              `<blockquote>` +
              `👤 <b>Usuario Picta:</b> ${escapeHtml(session.userFullName || session.username)}\n` +
              `📺 <b>Canal Activo:</b> ${escapeHtml(found.nombre)} (<code>#${found.id}</code>)` +
              `</blockquote>\n` +
              `🚀 <b>¡Todo listo!</b> Ya puedes enviarme tu primer video directamente aquí para subirlo a este canal.`,
            msg.message_id,
            [[{ text: '🏛️ Abrir Panel de Mi Canal', callback_data: 'chan_editor:open' }]]
          );
          return;
        }
        await sendOrEditChannelEditorMenu(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `✅ <b>Canal vinculado con éxito:</b> ${escapeHtml(found.nombre)} (<code>#${found.id}</code>)\n` +
          `Todos tus videos y publicaciones se subirán a este canal.`
        );
        return;
      } else if (candidates.length > 1) {
        const kb = candidates.slice(0, 5).map((c) => [
          {
            text: `📺 ${c.nombre} (#${c.id})`,
            callback_data: `chan_switch:select:${c.id}`,
          },
        ]);
        kb.push([{ text: '⬅️ Cancelar', callback_data: 'chan_editor:open' }]);
        const prompt =
          `🔍 <b>Se encontraron ${candidates.length} canales:</b>\n` +
          `Toca el botón correspondiente a tu canal para vincularlo:\n\n` +
          candidates
            .map((c) => `• <b>${escapeHtml(c.nombre)}</b> (<code>#${c.id}</code>)`)
            .join('\n');
        if (pendingToolkit.messageId) {
          await editTelegramStatusMessage(chatId, pendingToolkit.messageId, prompt, kb, true);
        } else {
          await sendTelegramStatusMessage(chatId, prompt, msg.message_id, kb);
        }
        return;
      } else {
        if (!pendingToolkit.messageId && (!session.channelId || session.channelId === '0')) {
          pendingToolkitInputByChat.set(chatId, {
            mode: 'switch_channel_query',
            messageId: null,
          });
          await sendTelegramStatusMessage(
            chatId,
            `⚠️ No pude verificar un canal propio con "<code>${escapeHtml(cleanVal)}</code>".\n\n` +
              `📌 <b>Prueba pegar directamente el enlace completo</b> (ej: <code>https://www.picta.cu/canal/tu-canal</code>) o el <b>ID numérico</b> de tu canal aquí mismo:`,
            msg.message_id,
            [
              [{ text: '🔄 Reintentar Detección Automática', callback_data: 'retry_auto_discover_channel' }],
              [{ text: '❌ Cancelar', callback_data: 'cmd_start' }],
            ]
          );
          return;
        }
        await sendOrEditChannelEditorMenu(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `⚠️ No se encontró ningún canal con: "<code>${escapeHtml(cleanVal)}</code>".\n\n` +
          `💡 <i>Tip:</i> Puedes copiar el enlace de tu canal en Picta (ej: <code>/canal https://www.picta.cu/canal/tu-canal</code>) o ingresar su ID numérico.`
        );
        return;
      }
    }

    if (pendingToolkit.mode === 'edit_milestone_thresholds') {
      const parsed = parseCustomMilestoneThresholds(cleanVal);
      if (!parsed.valid) {
        await sendOrEditAlertsMilestonesMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `⚠️ <b>${escapeHtml(parsed.error || 'Valores inválidos')}</b>`
        );
        return;
      }
      const prefs = getChatAlertPreferences(chatId);
      prefs.thresholds = parsed.thresholds;
      saveAlertsStateToDisk();
      await sendOrEditAlertsMilestonesMenuInTelegram(
        chatId,
        pendingToolkit.messageId,
        msg.message_id,
        `✅ <b>¡Metas progresivas actualizadas!</b>\n<code>${parsed.thresholds.map(formatMilestoneNumber).join(' · ')}</code>`
      );
      return;
    }

    if (pendingToolkit.mode === 'set_promo_requests_channel') {
      const parsed = parseTelegramChannelInput(cleanVal);
      if (!parsed.valid || !parsed.targetChannelId) {
        pendingToolkitInputByChat.set(chatId, pendingToolkit);
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>${escapeHtml(parsed.error || 'Canal inválido')}</b>`,
          msg.message_id
        );
        return;
      }

      let finalChannelId = parsed.targetChannelId;
      let finalLabel = parsed.displayLabel || finalChannelId;
      try {
        const chatMeta = await callTelegramBotApi('getChat', { chat_id: finalChannelId });
        if (chatMeta?.id) {
          finalChannelId = String(chatMeta.id);
          const uname = chatMeta.username ? `@${chatMeta.username}` : '';
          const title = String(chatMeta.title || uname || finalChannelId).trim();
          finalLabel = uname && title !== uname ? `${title} (${uname})` : title;
        }
      } catch {
        // Keep parsed target if bot hasn't been added yet; user can verify later
      }

      const prevCfg = userPromoChannels.get(chatId);
      userPromoChannels.set(chatId, {
        chatId,
        targetChannelId: finalChannelId,
        targetChannelLabel: finalLabel,
        customPictaChannelUrl: prevCfg?.customPictaChannelUrl,
        autoSendToRequests: prevCfg?.autoSendToRequests,
        requestsGroupChatId: prevCfg?.requestsGroupChatId,
        requestsGroupLabel: prevCfg?.requestsGroupLabel,
        requestsMonitorMode: prevCfg?.requestsMonitorMode,
        disabled: false,
        updatedAt: new Date().toISOString(),
      });
      saveUserPromoChannelsToDisk();

      const linkedPromo = pendingToolkit.promoId
        ? pendingMoviePromos.get(pendingToolkit.promoId)
        : undefined;
      if (linkedPromo && linkedPromo.ownerChatId === chatId) {
        const prompt = buildMoviePromoConfirmationPrompt(linkedPromo, chatId);
        await sendTelegramStatusMessage(
          chatId,
          `✅ <b>Canal de Pedidos guardado:</b> ${escapeHtml(finalLabel)} (<code>${escapeHtml(finalChannelId)}</code>)\n\n${prompt.textHtml}`,
          msg.message_id,
          prompt.keyboard as any
        );
      } else {
        await sendOrEditPromoChannelMenuInTelegram(
          chatId,
          pendingToolkit.messageId,
          msg.message_id,
          `✅ <b>¡Canal de Pedidos guardado!</b> ${escapeHtml(finalLabel)} (<code>${escapeHtml(finalChannelId)}</code>)`
        );
      }
      return;
    }

    if (pendingToolkit.mode === 'set_requests_group_chat') {
      const parsed = parseTelegramChannelInput(cleanVal);
      if (!parsed.valid || !parsed.targetChannelId) {
        pendingToolkitInputByChat.set(chatId, pendingToolkit);
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>${escapeHtml(parsed.error || 'Grupo inválido')}</b>`,
          msg.message_id
        );
        return;
      }

      let finalGroupId = parsed.targetChannelId;
      let finalGroupLabel = parsed.displayLabel || finalGroupId;
      try {
        const chatMeta = await callTelegramBotApi('getChat', { chat_id: finalGroupId });
        if (chatMeta?.id) {
          finalGroupId = String(chatMeta.id);
          const uname = chatMeta.username ? `@${chatMeta.username}` : '';
          const title = String(chatMeta.title || uname || finalGroupId).trim();
          finalGroupLabel = uname && title !== uname ? `${title} (${uname})` : title;
        }
      } catch {
        // Keep parsed target
      }

      const prevCfg = userPromoChannels.get(chatId);
      userPromoChannels.set(chatId, {
        chatId,
        targetChannelId: prevCfg?.targetChannelId || '',
        targetChannelLabel: prevCfg?.targetChannelLabel || '',
        customPictaChannelUrl: prevCfg?.customPictaChannelUrl,
        autoSendToRequests: prevCfg?.autoSendToRequests,
        requestsGroupChatId: finalGroupId,
        requestsGroupLabel: finalGroupLabel,
        requestsMonitorMode:
          prevCfg?.requestsMonitorMode && prevCfg.requestsMonitorMode !== 'off'
            ? prevCfg.requestsMonitorMode
            : 'prefix',
        disabled: prevCfg?.disabled ?? false,
        updatedAt: new Date().toISOString(),
      });
      saveUserPromoChannelsToDisk();

      await sendOrEditPromoChannelMenuInTelegram(
        chatId,
        pendingToolkit.messageId,
        msg.message_id,
        `✅ <b>¡Grupo de Pedidos vinculado!</b> ${escapeHtml(finalGroupLabel)} (<code>${escapeHtml(finalGroupId)}</code>)`
      );
      return;
    }

    if (pendingToolkit.mode === 'add_or_check_request') {
      const fwdFrom = msg.forward_origin?.sender_user || msg.forward_from;
      const requesterName = fwdFrom
        ? [fwdFrom.first_name, fwdFrom.last_name].filter(Boolean).join(' ') ||
          fwdFrom.username ||
          senderName
        : senderName;
      await processRequestQueryAndReplyOrSave({
        ownerChatId: chatId,
        replyChatId: chatId,
        replyToMessageId: msg.message_id,
        query: cleanVal,
        requesterName,
        requesterUsername: fwdFrom?.username || msg.from?.username,
        autoSaveIfMissing: false,
      });
      return;
    }
  }

  // 4. Handle text input when editing an already-published video (Título, Descripción, Nº Capítulo/Temporada, or Etiquetas)
  if (
    pendingPubEdit &&
    (pendingPubEdit.mode === 'title' ||
      pendingPubEdit.mode === 'desc' ||
      pendingPubEdit.mode === 'epnum' ||
      pendingPubEdit.mode === 'tags')
  ) {
    if (pendingPubEdit.mode === 'tags') {
      pendingPubEditByChat.delete(chatId);
      try {
        const rawTags = text
          .split(/[,;\n]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8);
        if (rawTags.length === 0) throw new Error('Envía al menos una etiqueta válida.');
        const keywordIds: number[] = [];
        const resolvedWords: string[] = [];
        for (const tag of rawTags) {
          const kw = await searchOrCreatePictaKeywordInCatalog(chatId, tag);
          if (kw.id > 0) {
            keywordIds.push(kw.id);
            resolvedWords.push(kw.palabra);
          }
        }
        const ctx = getEffectivePictaContext(chatId);
        const token = await ctx.accessTokenPromise;
        const form = new FormData();
        for (const kid of keywordIds) {
          form.append('palabra_clave', String(kid));
        }
        const res = await fetch(`https://api.picta.cu/v1/publicacion/${pendingPubEdit.pubId}/`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          body: form,
        });
        if (!res.ok) {
          const errTxt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
        }
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          pendingPubEdit.messageId,
          pendingPubEdit.pubId,
          pendingPubEdit.returnSort,
          pendingPubEdit.returnPage,
          `✅ <b>¡Etiquetas actualizadas en Picta (${escapeHtml(resolvedWords.join(', '))})!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          pendingPubEdit.messageId,
          pendingPubEdit.pubId,
          pendingPubEdit.returnSort,
          pendingPubEdit.returnPage,
          `⚠️ <b>Error al actualizar etiquetas:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    if (pendingPubEdit.mode === 'epnum') {
      try {
        let newTempNum = 1;
        let newEpNum = 1;
        const foundCap = findUserChannelChapter(pendingPubEdit.pubId, chatId);
        const matchedSerie: ChannelSerieRecord | undefined = foundCap?.serie;
        const matchedCap: ChannelChapterRecord | undefined = foundCap?.chapter;
        if (matchedCap) {
          newTempNum = matchedCap.temporada || 1;
          newEpNum = matchedCap.numero || 1;
        }

        if (text.includes('|')) {
          const parts = text
            .split('|')
            .map((p) => p.replace(/\D/g, '').trim())
            .filter(Boolean);
          if (parts.length >= 2) {
            newTempNum = Number(parts[0]) || 1;
            newEpNum = Number(parts[1]) || 1;
          } else if (parts.length === 1) {
            newEpNum = Number(parts[0]) || 1;
          }
        } else {
          const seMatch = text.match(/[sStT]?(\d{1,2})\s*[eExX.:-]\s*[eE]?(\d{1,3})/);
          if (seMatch) {
            newTempNum = Number(seMatch[1]) || 1;
            newEpNum = Number(seMatch[2]) || 1;
          } else {
            const singleNum = Number(text.replace(/\D/g, ''));
            if (singleNum > 0) {
              newEpNum = singleNum;
            }
          }
        }

        const ctx = getEffectivePictaContext(chatId);
        const serieName = cleanSerieDisplayName(matchedSerie?.nombre || 'Serie');
        const oldTitle = matchedCap?.nombre || pendingPubEdit.pubTitle;
        const subMatch = oldTitle.match(/T\d+:E\d+\s*[-–]\s*(.+)$/i);
        const epSub = subMatch ? subMatch[1].trim() : '';
        const updatedTitle = formatSerieEpisodeTitle(serieName, newTempNum, newEpNum, epSub);
        const updatedDesc = sanitizePublicPictaText(
          `Capítulo ${newEpNum} de la Temporada ${newTempNum} de la serie ${serieName}${epSub ? ` titulado "${epSub}"` : ''}, disponible en el canal ${ctx.channelName || 'tu canal'}.`
        );

        const patchFields: Record<string, string> = {
          tipologia: '5',
          numero: String(newEpNum),
          nombre: updatedTitle,
          descripcion: updatedDesc,
        };

        if (matchedSerie && ctx.isLinked && ctx.channelId) {
          const token = await ctx.accessTokenPromise;
          const resolvedTempId = await ensureSerieAndTemporadaId(
            token,
            serieName,
            newTempNum,
            { serie_pelser_id: String(matchedSerie.pelser_id) },
            Buffer.from(FALLBACK_JPEG_BASE64, 'base64'),
            ctx.channelId,
            ctx.channelName,
            isMasterAdminChat(chatId)
          );
          if (resolvedTempId > 0) {
            patchFields.temporada = String(resolvedTempId);
          }
        }

        await patchPictaPublicationInChannel(pendingPubEdit.pubId, patchFields, undefined, chatId);

        if (matchedCap) {
          matchedCap.temporada = newTempNum;
          matchedCap.numero = newEpNum;
          matchedCap.nombre = updatedTitle;
          matchedCap.descripcion = updatedDesc;
          if (matchedSerie?.chapters) {
            matchedSerie.chapters.sort((a, b) =>
              a.temporada !== b.temporada ? a.temporada - b.temporada : a.numero - b.numero
            );
          }
          saveChannelSeriesToDisk(channelSeriesCache);
        }

        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          pendingPubEdit.messageId,
          pendingPubEdit.pubId,
          pendingPubEdit.returnSort,
          pendingPubEdit.returnPage,
          `✅ <b>¡Capítulo movido a T${newTempNum}:E${String(newEpNum).padStart(2, '0')} (${escapeHtml(updatedTitle)})!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditPictaPubDetailInTelegram(
          chatId,
          pendingPubEdit.messageId,
          pendingPubEdit.pubId,
          pendingPubEdit.returnSort,
          pendingPubEdit.returnPage,
          `⚠️ <b>Error al cambiar número de capítulo:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }

    const fieldName = pendingPubEdit.mode === 'title' ? 'nombre' : 'descripcion';
    const label = pendingPubEdit.mode === 'title' ? 'Título' : 'Descripción';
    const cleanValue = sanitizePublicPictaText(text);
    try {
      await patchPictaPublicationInChannel(
        pendingPubEdit.pubId,
        {
          [fieldName]: cleanValue,
        },
        undefined,
        chatId
      );
      const foundCap = findUserChannelChapter(pendingPubEdit.pubId, chatId);
      if (foundCap) {
        if (fieldName === 'nombre') foundCap.chapter.nombre = cleanValue;
        if (fieldName === 'descripcion') foundCap.chapter.descripcion = cleanValue;
        saveChannelSeriesToDisk(channelSeriesCache);
      }
      await sendOrEditPictaPubDetailInTelegram(
        chatId,
        pendingPubEdit.messageId,
        pendingPubEdit.pubId,
        pendingPubEdit.returnSort,
        pendingPubEdit.returnPage,
        `✅ <b>¡${label} actualizado directamente en Picta!</b>`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await sendOrEditPictaPubDetailInTelegram(
        chatId,
        pendingPubEdit.messageId,
        pendingPubEdit.pubId,
        pendingPubEdit.returnSort,
        pendingPubEdit.returnPage,
        `⚠️ <b>Error al actualizar ${label}:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
      );
    }
    return;
  }

  // 5. Handle text input when creating or editing a standalone Serie in /series
  const pendingStandalone = pendingStandaloneSerieByChat.get(chatId);
  if (pendingStandalone) {
    if (pendingStandalone.mode === 'new_serie_name') {
      pendingStandaloneSerieByChat.delete(chatId);
      try {
        const created = await createSerieInPictaChannelDirect(chatId, text.trim(), 1);
        await sendOrEditMyChannelSeriesMenu(
          chatId,
          pendingStandalone.messageId,
          msg.message_id,
          `✅ <b>¡Serie "${escapeHtml(created.serieName)}" (ID: <code>${created.pelserId}</code>) y Temporada 1 creadas en tu canal!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditMyChannelSeriesMenu(
          chatId,
          pendingStandalone.messageId,
          msg.message_id,
          `⚠️ <b>Error al crear la serie en Picta:</b> <code>${escapeHtml(errMsg.slice(0, 140))}</code>`
        );
      }
      return;
    }

    if (
      (pendingStandalone.mode === 'edit_serie_name' ||
        pendingStandalone.mode === 'edit_serie_synopsis') &&
      pendingStandalone.pelserId
    ) {
      pendingStandaloneSerieByChat.delete(chatId);
      const isName = pendingStandalone.mode === 'edit_serie_name';
      const cleanVal = sanitizePublicPictaText(text.trim());
      try {
        await patchSerieInPictaChannel(chatId, pendingStandalone.pelserId, {
          ...(isName ? { nombre: cleanVal } : { sinopsis: cleanVal }),
        });
        await sendOrEditSerieDetailInTelegram(
          chatId,
          pendingStandalone.messageId,
          pendingStandalone.pelserId,
          0,
          `✅ <b>¡${isName ? 'Nombre' : 'Sinopsis'} de la serie actualizado en Picta!</b>`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sendOrEditSerieDetailInTelegram(
          chatId,
          pendingStandalone.messageId,
          pendingStandalone.pelserId,
          0,
          `⚠️ <b>Error al editar serie:</b> <code>${escapeHtml(errMsg.slice(0, 120))}</code>`
        );
      }
      return;
    }
  }

  // 6. Handle step-by-step text responses for the active upload wizard job
  if (activeWizardJob) {
    if (
      activeWizardJob.stage === 'awaiting_series_selection' ||
      activeWizardJob.stage === 'awaiting_new_series_name'
    ) {
      const newSerieName = text.trim();
      const seasonNum = Number(activeWizardJob.modelMetadata?.temporada || 1) || 1;
      const ctx = getEffectivePictaContext(chatId);
      const chTag = ctx.channelId ? `${ctx.channelName} (#${ctx.channelId})` : ctx.channelName;
      try {
        const created = await createSerieInPictaChannelDirect(
          chatId,
          newSerieName,
          seasonNum,
          activeWizardJob.customCoverFileId || activeWizardJob.thumbnailFileId
        );
        activeWizardJob.modelMetadata = {
          ...(activeWizardJob.modelMetadata || {}),
          serie: created.serieName,
          serie_pelser_id: String(created.pelserId),
          temporada: String(created.seasonNum),
          temporada_id: String(created.tempId),
        };
        saveJobsToDisk();
        await promptSeasonSelectionForJob(
          activeWizardJob,
          chatId,
          activeWizardJob.statusMessageId || null,
          created.pelserId,
          created.serieName,
          `✅ <b>¡Serie "${escapeHtml(created.serieName)}" creada en tu canal ${escapeHtml(chTag)}!</b>`
        );
      } catch {
        activeWizardJob.modelMetadata = {
          ...(activeWizardJob.modelMetadata || {}),
          serie: newSerieName,
        };
        saveJobsToDisk();
        await promptSeasonSelectionForJob(
          activeWizardJob,
          chatId,
          activeWizardJob.statusMessageId || null,
          0,
          newSerieName
        );
      }
      return;
    }

    if (activeWizardJob.stage === 'awaiting_season_selection') {
      const existingMeta = activeWizardJob.modelMetadata || {};
      const serieName = String(existingMeta.serie || 'Serie');
      const epSub = String(existingMeta.episodeSubtitle || '').trim();
      let tempNum = String(existingMeta.temporada || '1');
      let epNum = String(existingMeta.numero || '1');

      if (text.includes('|')) {
        const parts = text.split('|').map((p) => p.replace(/\D/g, '').trim()).filter(Boolean);
        if (parts.length >= 2) {
          tempNum = parts[0];
          epNum = parts[1];
        } else if (parts.length === 1) {
          epNum = parts[0];
        }
      } else {
        const seMatch = text.match(/[sS]?(\d{1,2})\s*[eExX.:-]\s*(\d{1,3})/);
        if (seMatch) {
          tempNum = String(Number(seMatch[1]));
          epNum = String(Number(seMatch[2]));
        } else {
          const singleNum = text.replace(/\D/g, '');
          if (singleNum) {
            epNum = singleNum;
          }
        }
      }

      activeWizardJob.modelMetadata = {
        ...existingMeta,
        temporada: tempNum,
        numero: epNum,
      };
      activeWizardJob.title = formatSerieEpisodeTitle(serieName, tempNum, epNum, epSub);
      saveJobsToDisk();
      await promptStep1Title(activeWizardJob, chatId, activeWizardJob.statusMessageId || null);
      return;
    }

    if (
      activeWizardJob.stage === 'awaiting_step_title' ||
      activeWizardJob.stage === 'awaiting_manual_title' ||
      activeWizardJob.stage === 'awaiting_title_choice'
    ) {
      const isAskingForAuto = /^(saltar|auto|autom[aá]tico|dejar|ok|si|s[ií])$/i.test(text);
      const missingRealTitleOnJob =
        activeWizardJob.modelMetadata?.needsManualTitle === 'true' ||
        !activeWizardJob.title ||
        isRandomOrCrypticFilename(activeWizardJob.title);
      if (isAskingForAuto && missingRealTitleOnJob) {
        await sendTelegramStatusMessage(
          chatId,
          `⚠️ <b>Falta el título real:</b> El archivo <code>${escapeHtml(activeWizardJob.fileName)}</code> tiene un nombre aleatorio.\n✍️ Escribe el nombre de la película/serie/video para continuar:`,
          msg.message_id
        );
        return;
      }
      if (!isAskingForAuto) {
        if (activeWizardJob.modelMetadata?.needsManualTitle) {
          delete activeWizardJob.modelMetadata.needsManualTitle;
        }
        if (activeWizardJob.tipologiaId === 5) {
          const existingMeta = activeWizardJob.modelMetadata || {};
          const existingSerieStr = String(existingMeta.serie || '');
          const parsedCandidate = parseSingleSeriesCandidate(text);
          const fromFile = extractSeriesInfoFromText(activeWizardJob.fileName, activeWizardJob.caption);

          const serieName = String(
            !isGenericOrInvalidSerieName(existingSerieStr)
              ? existingSerieStr
              : !isGenericOrInvalidSerieName(parsedCandidate.serieName)
                ? parsedCandidate.serieName
                : !fromFile.missingSerieName
                  ? fromFile.serieName
                  : text.trim()
          );
          const seasonNum = String(
            parsedCandidate.hasExplicitNumbers
              ? parsedCandidate.temporada
              : existingMeta.temporada || fromFile.temporada || '1'
          );
          const epNum = String(
            parsedCandidate.hasExplicitNumbers
              ? parsedCandidate.numero
              : existingMeta.numero || fromFile.numero || '1'
          );
          const epSub = String(
            parsedCandidate.episodeSubtitle ||
              (!parsedCandidate.hasExplicitNumbers &&
              text.trim().toLowerCase() !== serieName.toLowerCase()
                ? text.trim()
                : existingMeta.episodeSubtitle || fromFile.episodeSubtitle || '')
          ).trim();

          const pelserId = Number(existingMeta.serie_pelser_id || 0);
          const inheritedStyle = resolveSeriesStyleForChannel(chatId, pelserId, serieName);

          activeWizardJob.modelMetadata = {
            ...existingMeta,
            serie: serieName,
            temporada: seasonNum,
            numero: epNum,
            ...(epSub ? { episodeSubtitle: epSub } : {}),
          };

          // If user typed a deliberate custom title, preserve it verbatim; if bare coordinate like "S01E06", format using inherited series style or default
          const isBareEpCodeOnly = /^(?:[sS]\d{1,2}\s*[eE]\d{1,3}|[tT]\d{1,2}\s*[:\-]?\s*[eE]\d{1,3}|\d{1,2}\s*[|xX]\s*\d{1,3}|\d{1,3})$/.test(
            text.trim()
          );
          activeWizardJob.title = isBareEpCodeOnly
            ? inheritedStyle
              ? formatEpisodeWithSeriesStyle(inheritedStyle, {
                  serieName,
                  temporada: seasonNum,
                  numero: epNum,
                  episodeSubtitle: epSub,
                })
              : formatSerieEpisodeTitle(serieName, seasonNum, epNum, epSub)
            : text.trim();
        } else {
          const parsed = parseUserManualMetadata(text, activeWizardJob.tipologiaId || 8);
          activeWizardJob.title = parsed.title || text.trim();
          if (parsed.synopsis) {
            activeWizardJob.synopsis = parsed.synopsis;
          }
          if (Object.keys(parsed.meta).length > 0) {
            activeWizardJob.modelMetadata = {
              ...(activeWizardJob.modelMetadata || {}),
              ...parsed.meta,
            };
          }
        }
      }
      activeWizardJob.titleMode = 'manual';
      saveJobsToDisk();
      await proceedFromStep1ToStep2WithDuplicateCheck(
        activeWizardJob,
        chatId,
        activeWizardJob.statusMessageId || null
      );
      return;
    }

    if (activeWizardJob.stage === 'awaiting_step_synopsis') {
      const isAskingForAuto = /^(saltar|auto|autom[aá]tico|ia|no)$/i.test(text);
      if (!isAskingForAuto) {
        activeWizardJob.synopsis = text.trim();
      }
      saveJobsToDisk();
      await promptStep3Cover(
        activeWizardJob,
        chatId,
        activeWizardJob.statusMessageId || null
      );
      return;
    }

    if (activeWizardJob.stage === 'awaiting_step_cover') {
      await promptStep4Subtitles(
        activeWizardJob,
        chatId,
        activeWizardJob.statusMessageId || null
      );
      return;
    }

    if (activeWizardJob.stage === 'awaiting_step_subtitles') {
      await finalizeGuidedStepsAndStart(
        activeWizardJob,
        chatId,
        activeWizardJob.statusMessageId || null
      );
      return;
    }
  }

  // Fallback for unhandled text: check if user pasted a t.me/... link or direct HTTP video URL
  if (text && !text.startsWith('/')) {
    const handledAsLink = await handleIncomingLinkOrUrlIngestion(
      chatId,
      msg.message_id,
      senderName,
      text
    );
    if (handledAsLink) return;
  }
}

let pollingActive = false;
let pollingLoopGeneration = 0;

async function startPollingBridge(): Promise<void> {
  if (externalCloudRunWebhookActive || pollingActive) return;
  pollingActive = true;
  const myGeneration = ++pollingLoopGeneration;

  addLiveLog(
    'telegram',
    'info',
    'Receptor único de Telegram activo con deduplicación en /tmp/picta_bot_state.'
  );

  while (pollingActive && myGeneration === pollingLoopGeneration && !externalCloudRunWebhookActive) {
    try {
      const updates = await callTelegramBotApi('getUpdates', {
        offset: lastUpdateOffset,
        timeout: 15,
        allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'],
      });
      if (Array.isArray(updates) && updates.length > 0) {
        for (const upd of updates) {
          const nextOffset = Number(upd.update_id) + 1;
          if (nextOffset > lastUpdateOffset) {
            lastUpdateOffset = nextOffset;
            saveProcessedUpdatesToDisk();
          }
          await handleTelegramUpdate(upd);
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function isWebhookUrlPubliclyReachable(url: string): Promise<boolean> {
  try {
    const probe = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      redirect: 'manual',
    });
    return probe.status === 200;
  } catch {
    return false;
  }
}

async function initTelegramListener(): Promise<void> {
  try {
    // Restore authorizedUsers, userSessions, pinnedBatchSerieByChat, and quotaSettings from Telegram Cloud Vault
    // before processing any updates so Cloud Run scale-to-zero never wipes user data!
    await ensureCloudStateLoadedOnce();

    const me = await callTelegramBotApi('getMe');
    botProfile = {
      id: me.id,
      username: me.username || 'Picta2bot',
      firstName: me.first_name || 'Pictaupload',
    };
    addLiveLog(
      'telegram',
      'success',
      `Bot verificado en Telegram: @${botProfile.username} (ID: ${botProfile.id})`
    );

    const hookInfo = await callTelegramBotApi('getWebhookInfo');
    const currentHookUrl = String(hookInfo.url || '').trim();

    if (!IS_PREVIEW_INSTANCE) {
      // Register convenient command menu in Telegram client (production only)
      void callTelegramBotApi('setMyCommands', {
        commands: [
          {
            command: 'buscar',
            description: '🔎 Buscar si una película, serie o video ya existe en Picta',
          },
          {
            command: 'canal',
            description: '🏛️ Editar mi Canal de Picta (Nombre, Lema, Avatar, Portada)',
          },
          {
            command: 'series',
            description: '📺 Series de mi Canal y 📌 Modo Serie Fija (Ráfaga)',
          },
          {
            command: 'cola',
            description: '📋 Ver Cola de Espera, Modo Ráfaga y Cancelar Subidas',
          },
          {
            command: 'cuota',
            description: '⚡ Dividir Cuota Diaria (10/día) y Pool Multi-Cuenta (+10/cuenta)',
          },
          {
            command: 'stats',
            description: '📊 Dashboard de Picta y Edición de Videos Publicados',
          },
          {
            command: 'auditoria',
            description: '🩺 Auditar duplicados internos, faltantes y salud de tu canal',
          },
          {
            command: 'pedidos',
            description: '📥 Gestor de pedidos y verificador rápido en Picta',
          },
          {
            command: 'canalpedidos',
            description: '📢 Configurar Canal/Grupo de Pedidos y auto-verificador',
          },
          {
            command: 'logros',
            description: '🏆 Alertas de Comentarios y Metas de Reproducciones/Likes',
          },
          {
            command: 'cuenta',
            description: '🛡️ Estado y permisos Jefe de canal de tu cuenta Picta',
          },
          {
            command: 'menu',
            description: '🟢 Menú principal y estado del bot',
          },
          {
            command: 'reintentar',
            description: '🔄 Reintentar última publicación pendiente',
          },
        ],
      }).catch(() => {});

      const targetUrl = `${detectCloudRunUrl()}/api/telegram/webhook`;
      const isPlaceholderUrl = targetUrl.includes('placeholder.ai.studio');
      const isPublicHttps =
        targetUrl.startsWith('https://') &&
        !targetUrl.includes('localhost') &&
        !targetUrl.includes('ais-dev-') &&
        !isPlaceholderUrl;
      if (isPublicHttps) {
        pollingActive = false;
        externalCloudRunWebhookActive = false;
        await callTelegramBotApi('setWebhook', {
          url: targetUrl,
          allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'],
          drop_pending_updates: false,
        });
        webhookRegistered = true;
        botConfig.webhookUrl = targetUrl;
        lastWebhookError = null;
      } else if (
        currentHookUrl &&
        currentHookUrl.startsWith('https://') &&
        !currentHookUrl.includes('ais-dev-') &&
        !currentHookUrl.includes('localhost') &&
        !currentHookUrl.includes('pictauploader.ai.studio')
      ) {
        pollingActive = false;
        externalCloudRunWebhookActive = true;
        webhookRegistered = true;
        botConfig.webhookUrl = currentHookUrl;
        return;
      } else {
        await callTelegramBotApi('deleteWebhook', { drop_pending_updates: false });
        webhookRegistered = false;
        externalCloudRunWebhookActive = false;
        void startPollingBridge();
      }
    } else {
      // In AI Studio preview, NEVER delete or hijack an existing production webhook (even if it had a transient error during redeploy)
      const hasExternalProdWebhook =
        Boolean(currentHookUrl) &&
        !currentHookUrl.includes('ais-dev-') &&
        !currentHookUrl.includes('localhost');

      if (hasExternalProdWebhook) {
        pollingActive = false;
        externalCloudRunWebhookActive = true;
        webhookRegistered = true;
        botConfig.webhookUrl = currentHookUrl;
        return;
      }

      externalCloudRunWebhookActive = false;
      if (currentHookUrl) {
        await callTelegramBotApi('deleteWebhook', { drop_pending_updates: false });
      }
      webhookRegistered = true;
      void startPollingBridge();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLiveLog('telegram', 'error', `Error iniciando Telegram: ${msg}`);
  }

  if (!externalCloudRunWebhookActive) {
    await ensureMtprotoClient();
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/cloudrun-keepalive', async (req: Request, res: Response) => {
    const isBusy = () => Boolean(activeDownloadJobId || activeUploadJobId || activeJobId);
    if (req.query.hold === '1' && isBusy()) {
      // Keep the HTTP request actively open for up to 25 seconds while a download/upload is running.
      // This forces Cloud Run's load balancer to allocate 100% CPU during the entire download/upload.
      const holdStart = Date.now();
      while (isBusy() && Date.now() - holdStart < 25_000) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    res.status(200).send('OK');
  });

  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (
        host &&
        !String(host).includes('localhost') &&
        !String(host).includes('127.0.0.1') &&
        !String(host).includes('ais-dev-')
      ) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        dynamicDetectedPublicUrl = `${proto}://${host}`;
      }
      await handleTelegramUpdate(req.body);
      res.status(200).json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLiveLog('telegram', 'error', `Error procesando webhook de Telegram: ${msg}`);
      res.status(200).json({ ok: true, error: msg });
    }
  });

  app.post('/api/internal/run-transfer', async (req: Request, res: Response) => {
    const { jobId, customTitle, callbackMessageId } = req.body || {};
    const job = transferJobs.find((j) => j.id === jobId);
    if (!job) {
      res.status(404).json({ ok: false });
      return;
    }

    if (runningJobIds.has(job.id)) {
      res.status(200).json({ ok: true, skippedDuplicate: true });
      return;
    }

    try {
      if (callbackMessageId) {
        job.statusMessageId = Number(callbackMessageId);
      }

      await prepareJobMetadataBeforeTransfer(job, customTitle ? String(customTitle) : undefined);

      cancelledJobIds.delete(job.id);
      if (!uploadQueue.includes(job.id)) {
        uploadQueue.push(job.id);
      }
      job.stage = 'queued';
      job.errorDetails = undefined;
      job.updatedAt = new Date().toISOString();
      saveJobsToDisk();

      void scheduleTransferPipeline();
      res.status(200).json({ ok: true, queued: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLiveLog('system', 'error', `Error en worker interno: ${msg}`);
      res.status(200).json({ ok: false, error: msg });
    }
  });

  app.post('/api/republish-job/:id', async (req: Request, res: Response) => {
    const jobId = req.params.id;
    const job = transferJobs.find((j) => j.id === jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: 'Trabajo no encontrado' });
      return;
    }

    if (runningJobIds.has(job.id)) {
      res.status(400).json({ ok: false, error: 'El trabajo ya se está procesando actualmente' });
      return;
    }

    try {
      job.stage = job.minioKey ? 'creating_picta_publication' : 'generating_auto_title';
      job.errorDetails = undefined;
      job.updatedAt = new Date().toISOString();
      saveJobsToDisk();

      addLiveLog(
        'picta',
        'info',
        `Reintentando publicación para "${job.title}" (${job.category || 'Audiovisual'}, S3 key: ${job.minioKey || 'Por generar'}).`
      );

      void triggerCloudRunKeepAliveTransfer(job.id, job.title, job.statusMessageId || null);

      res.status(200).json({ ok: true, job });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.delete('/api/jobs/:id', (req: Request, res: Response) => {
    const jobId = String(req.params.id || '').trim();
    const idx = transferJobs.findIndex((j) => j.id === jobId);
    if (idx === -1) {
      res.status(404).json({ ok: false, error: 'Trabajo no encontrado' });
      return;
    }
    if (runningJobIds.has(jobId)) {
      res.status(400).json({ ok: false, error: 'No se puede eliminar un trabajo en ejecución activa' });
      return;
    }
    const [removed] = transferJobs.splice(idx, 1);
    const qIdx = uploadQueue.indexOf(jobId);
    if (qIdx !== -1) {
      uploadQueue.splice(qIdx, 1);
    }
    if (removed?.tempFilePath && fs.existsSync(removed.tempFilePath)) {
      try {
        fs.unlinkSync(removed.tempFilePath);
      } catch {
        // Ignore cleanup failure
      }
    }
    saveJobsToDisk();
    addLiveLog('system', 'info', `Registro eliminado del historial: "${removed?.title || jobId}"`);
    res.status(200).json({ ok: true, removedId: jobId });
  });

  app.post('/api/jobs/clear-failed', (_req: Request, res: Response) => {
    let removedCount = 0;
    const kept: VideoTransferJob[] = [];
    for (const j of transferJobs) {
      if (j.stage === 'failed' && !runningJobIds.has(j.id)) {
        const qIdx = uploadQueue.indexOf(j.id);
        if (qIdx !== -1) uploadQueue.splice(qIdx, 1);
        if (j.tempFilePath && fs.existsSync(j.tempFilePath)) {
          try {
            fs.unlinkSync(j.tempFilePath);
          } catch {
            // Ignore cleanup failure
          }
        }
        removedCount++;
      } else {
        kept.push(j);
      }
    }
    transferJobs = kept;
    saveJobsToDisk();
    if (removedCount > 0) {
      addLiveLog('system', 'info', `Historial limpiado: ${removedCount} trabajo(s) fallido(s) descartado(s).`);
    }
    res.status(200).json({ ok: true, removedCount });
  });

  app.get('/api/picta/toolkit/overview', async (_req: Request, res: Response) => {
    try {
      const chatId = MASTER_ADMIN_CHAT_ID;
      const [chanDetails, collabs, playlists, commentsAndDenuncias, channelPubs] = await Promise.all(
        [
          fetchPictaChannelDetails(chatId).catch(() => null),
          fetchChannelCollaboratorsInPicta(chatId).catch(() => ({
            ownerId: 212033,
            ownerUsername: 'Admin',
            associatedIds: [] as number[],
          })),
          fetchChannelPlaylistsInPicta(chatId).catch(() => []),
          fetchChannelCommentsAndDenunciasInPicta(chatId).catch(() => ({
            comments: [],
            denuncias: {
              cantidad_pendientes: 0,
              cantidad_en_proceso: 0,
              cantidad_no_proceden: 0,
              cantidad_procesadas: 0,
              total: 0,
            },
          })),
          fetchPictaChannelPublications(chatId).catch(() => []),
        ]
      );

      ensureDailyQuotaReset();
      const associatedIds = (collabs as { collaborators?: { id: number }[] }).collaborators
        ? (collabs as { collaborators: { id: number }[] }).collaborators.map((c) => c.id)
        : [212033, 994913];

      const ownerUsernames = [
        'ownerUsername' in collabs ? collabs.ownerUsername : 'Admin',
        userSessions.get(chatId)?.username || '',
      ].filter(Boolean);
      syncPictaCommentsToChannelRequests(chatId, commentsAndDenuncias.comments, ownerUsernames);

      const enrichedComments = commentsAndDenuncias.comments.map((cm) => {
        const authorLower = String(cm.usuario || '').trim().toLowerCase();
        const isOwnerAuthor = ownerUsernames.some((u) => u.toLowerCase() === authorLower);
        const det = !isOwnerAuthor
          ? extractMediaRequestFromPictaComment(cm.texto, cm.publicacionNombre)
          : { matched: false, title: '', reason: '' };
        const linkedReq = channelMediaRequests.find(
          (r) => r.ownerChatId === chatId && r.commentId === cm.id
        );
        return {
          ...cm,
          ...(det.matched
            ? {
                detectedRequestTitle: det.title,
                detectedRequestReason: det.reason,
              }
            : {}),
          ...(linkedReq ? { linkedRequestId: linkedReq.id, linkedRequestStatus: linkedReq.status } : {}),
        };
      });

      const ownerRequests = channelMediaRequests.filter(
        (r) => r.ownerChatId === chatId && r.status !== 'dismissed'
      );

      res.json({
        ok: true,
        channel: chanDetails,
        collaborators: {
          ownerId: collabs.ownerId || 212033,
          ownerUsername: 'Admin',
          associatedIds,
          poolAccounts: quotaSettings.poolAccounts.map((acc, idx) => ({
            id: String(acc.userId || idx + 1),
            phone: acc.username,
            username: acc.displayName || acc.fullName || acc.username,
            channelId: '36319',
            channelName: 'Canal Oficial',
            uploadedToday: acc.uploadedToday || acc.usedToday || 0,
          })),
        },
        playlists: playlists.map((pl) => ({
          id: pl.id,
          nombre: pl.nombre,
          canalId: pl.canalId,
          canalNombre: pl.canalNombre,
          cantidadPublicaciones: (pl.publicacionesIds || []).length,
        })),
        comments: enrichedComments,
        requests: ownerRequests,
        denuncias: commentsAndDenuncias.denuncias,
        series: filterSeriesForChannel(
          channelSeriesCache,
          botConfig.pictaChannelId || '36319',
          true,
          botConfig.pictaChannelId || '36319'
        ),
        publications: channelPubs.slice(0, 40),
        quota: {
          seriesDailyTarget: quotaSettings.maxSeriesPerDay,
          otherDailyTarget: Math.max(0, 10 - quotaSettings.maxSeriesPerDay),
          seriesUploadedToday: quotaSettings.seriesUploadedToday,
          otherUploadedToday: quotaSettings.otherUploadedToday,
          poolCount: quotaSettings.poolAccounts.length,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post('/api/picta/toolkit/action', async (req: Request, res: Response) => {
    try {
      const chatId = MASTER_ADMIN_CHAT_ID;
      const body = (req.body || {}) as Record<string, unknown>;
      const action = String(body.action || '').trim();

      if (action === 'update_channel') {
        const fields: Record<string, string> = {};
        if (typeof body.nombre === 'string' && body.nombre.trim())
          fields.nombre = body.nombre.trim();
        if (typeof body.alias === 'string') fields.alias = body.alias.trim();
        if (typeof body.descripcion === 'string') fields.descripcion = body.descripcion.trim();
        if (typeof body.clasificacion === 'string' && body.clasificacion.trim())
          fields.clasificacion = body.clasificacion.trim();
        if (typeof body.visible === 'boolean') fields.visible = String(body.visible);
        if (typeof body.recibir_donacion === 'boolean')
          fields.recibir_donacion = String(body.recibir_donacion);
        await patchPictaChannelDetails(chatId, fields);
        res.json({ ok: true, message: 'Canal actualizado exitosamente en Picta.' });
        return;
      }

      if (action === 'add_collaborator' || action === 'remove_collaborator') {
        const rawTarget = String(body.targetIdentifier ?? body.targetUserId ?? '').trim();
        if (!rawTarget) {
          res.status(400).json({ ok: false, error: 'Ingresa el ID, usuario o enlace del canal.' });
          return;
        }
        const result = await modifyChannelCollaboratorInPicta(
          chatId,
          rawTarget,
          action === 'add_collaborator' ? 'add' : 'remove'
        );
        res.json({
          ok: true,
          associatedIds: result.collaborators.map((c) => c.id),
          targetUserId: result.targetUserId,
          message:
            action === 'add_collaborator'
              ? `Usuario #${result.targetUserId}${result.resolvedLabel ? ` (${result.resolvedLabel})` : ''} asociado al canal.`
              : `Usuario #${result.targetUserId} desvinculado del canal.`,
        });
        return;
      }

      if (action === 'create_playlist') {
        const nombre = String(body.nombre || '').trim();
        const created = await createChannelPlaylistInPicta(chatId, nombre);
        res.json({
          ok: true,
          playlist: created,
          message: `Lista "${created.nombre}" creada (#${created.id}).`,
        });
        return;
      }

      if (action === 'delete_playlist') {
        const playlistId = Number(body.playlistId || 0);
        await deleteChannelPlaylistInPicta(chatId, playlistId);
        res.json({ ok: true, message: `Lista #${playlistId} eliminada.` });
        return;
      }

      if (action === 'add_pub_to_playlist') {
        const playlistId = Number(body.playlistId || 0);
        const pubId = Number(body.pubId || 0);
        await addPublicationToPlaylistInPicta(chatId, playlistId, pubId);
        res.json({
          ok: true,
          message: `Video #${pubId} añadido a la lista #${playlistId}.`,
        });
        return;
      }

      if (action === 'post_comment') {
        const pubId = Number(body.pubId || 0);
        const texto = String(body.texto || '').trim();
        const parentCommentId = body.parentCommentId ? Number(body.parentCommentId) : undefined;
        await postPictaCommentInChannel(chatId, pubId, texto, parentCommentId);
        res.json({ ok: true, message: 'Comentario publicado en Picta.' });
        return;
      }

      if (action === 'delete_comment') {
        const commentId = Number(body.commentId || 0);
        await deletePictaCommentInChannel(chatId, commentId);
        res.json({ ok: true, message: `Comentario #${commentId} eliminado.` });
        return;
      }

      if (action === 'update_serie') {
        const pelserId = Number(body.pelserId || 0);
        const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : undefined;
        const sinopsis = typeof body.sinopsis === 'string' ? body.sinopsis.trim() : undefined;
        await patchSerieInPictaChannel(chatId, pelserId, { nombre, sinopsis });
        res.json({ ok: true, message: `Serie #${pelserId} actualizada en Picta.` });
        return;
      }

      if (action === 'delete_serie') {
        const pelserId = Number(body.pelserId || 0);
        await deleteSerieInPictaChannel(chatId, pelserId);
        res.json({ ok: true, message: `Serie #${pelserId} eliminada de Picta.` });
        return;
      }

      if (action === 'toggle_pub_download') {
        const pubId = Number(body.pubId || 0);
        const descargas = Boolean(body.descargas);
        await patchPictaPublicationInChannel(
          pubId,
          { descargas: String(descargas) },
          undefined,
          chatId
        );
        res.json({
          ok: true,
          message: `Descarga directa ${descargas ? 'habilitada' : 'deshabilitada'} para el video #${pubId}.`,
        });
        return;
      }

      if (action === 'toggle_pub_visibility') {
        const pubId = Number(body.pubId || 0);
        const publicado = Boolean(body.publicado);
        await patchPictaPublicationInChannel(
          pubId,
          { publicado: String(publicado) },
          undefined,
          chatId
        );
        res.json({
          ok: true,
          message: `Visibilidad del video #${pubId} cambiada a ${publicado ? 'Público' : 'Oculto'}.`,
        });
        return;
      }

      if (action === 'create_persona') {
        const nombre = String(body.nombre || '').trim();
        const persona = await searchOrCreatePictaPersonaInCatalog(chatId, nombre);
        res.json({
          ok: true,
          persona,
          message: `Persona "${persona.nombre}" ${persona.created ? 'creada' : 'encontrada'} en Picta (#${persona.id}).`,
        });
        return;
      }

      if (action === 'create_keyword') {
        const palabra = String(body.palabra || '').trim();
        const keyword = await searchOrCreatePictaKeywordInCatalog(chatId, palabra);
        res.json({
          ok: true,
          keyword,
          message: `Palabra clave "${keyword.palabra}" ${keyword.created ? 'creada' : 'encontrada'} en Picta (#${keyword.id}).`,
        });
        return;
      }

      if (action === 'scan_comment_requests') {
        const { comments } = await fetchChannelCommentsAndDenunciasInPicta(
          chatId,
          undefined,
          true
        );
        const ownerUname = userSessions.get(chatId)?.username || 'Admin';
        const syncRes = syncPictaCommentsToChannelRequests(chatId, comments, [
          'Admin',
          ownerUname,
        ]);
        res.json({
          ok: true,
          added: syncRes.added,
          requests: syncRes.requests.filter((r) => r.status !== 'dismissed'),
          message:
            syncRes.added > 0
              ? `Escaneo completado: ${syncRes.added} nuevo(s) pedido(s) detectado(s) en comentarios.`
              : `Escaneo completado: no se encontraron nuevos pedidos sin registrar.`,
        });
        return;
      }

      if (action === 'check_or_add_request') {
        const query = String(body.query || '').trim();
        const saveAnyway = Boolean(body.saveAnyway);
        const requesterName = String(body.requesterName || 'Admin Web').trim() || 'Admin Web';
        if (!query || query.length < 2) {
          res.status(400).json({ ok: false, error: 'Escribe el título que deseas verificar o añadir.' });
          return;
        }
        const searchRes = await searchGlobalPictaCatalog(query, {
          chatId,
          maxEnrich: 3,
          minScore: 0.65,
        }).catch(() => ({ queryUsed: query, hits: [] as PictaGlobalSearchHit[] }));

        const matches = searchRes.hits.slice(0, 3);
        let savedRequest: ChannelMediaRequest | null = null;
        if (matches.length === 0 || saveAnyway) {
          const norm = normalizeRequestTitle(query);
          const dup = channelMediaRequests.find(
            (r) => r.ownerChatId === chatId && r.status === 'pending' && r.normalizedTitle === norm
          );
          if (dup) {
            savedRequest = dup;
          } else {
            savedRequest = {
              id: `rq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
              ownerChatId: chatId,
              requestedTitle: query,
              normalizedTitle: norm,
              requestedByName: requesterName,
              sourceType: 'manual',
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            channelMediaRequests.unshift(savedRequest);
            saveChannelMediaRequestsToDisk();
          }
        }
        res.json({
          ok: true,
          query,
          matches,
          savedRequest,
          requests: channelMediaRequests.filter(
            (r) => r.ownerChatId === chatId && r.status !== 'dismissed'
          ),
          message:
            matches.length > 0 && !saveAnyway
              ? `Se encontraron ${matches.length} coincidencia(s) ya publicadas en Picta.`
              : savedRequest
                ? `Pedido "${savedRequest.requestedTitle}" guardado en Pendientes.`
                : 'Consulta completada.',
        });
        return;
      }

      if (action === 'verify_request') {
        const requestId = String(body.requestId || '').trim();
        const target = channelMediaRequests.find(
          (r) => r.id === requestId && r.ownerChatId === chatId
        );
        const query = String(body.query || target?.requestedTitle || '').trim();
        if (!query) {
          res.status(400).json({ ok: false, error: 'Pedido o título no especificado.' });
          return;
        }
        const searchRes = await searchGlobalPictaCatalog(query, {
          chatId,
          maxEnrich: 3,
          minScore: 0.65,
        }).catch(() => ({ queryUsed: query, hits: [] as PictaGlobalSearchHit[] }));
        res.json({
          ok: true,
          requestId,
          query,
          matches: searchRes.hits.slice(0, 3),
          message:
            searchRes.hits.length > 0
              ? `Encontradas ${Math.min(3, searchRes.hits.length)} coincidencia(s) en Picta.`
              : `"${query}" no aparece publicado todavía en Picta.`,
        });
        return;
      }

      if (action === 'import_comment_request') {
        const commentId = Number(body.commentId || 0);
        const pubId = Number(body.pubId || 0);
        const pubNombre = String(body.pubNombre || '').trim();
        const usuario = String(body.usuario || 'Suscriptor Picta').trim();
        const rawText = String(body.texto || '').trim();
        const customTitle = String(body.customTitle || '').trim();
        const extracted = extractMediaRequestFromPictaComment(rawText, pubNombre);
        const requestedTitle = (customTitle || extracted.title || rawText).trim().slice(0, 100);
        if (!requestedTitle || requestedTitle.length < 2) {
          res.status(400).json({ ok: false, error: 'No se pudo extraer un título válido del comentario.' });
          return;
        }
        if (commentId > 0) {
          ignoredRequestCommentIds.delete(commentId);
        }
        const norm = normalizeRequestTitle(requestedTitle);
        const existing = channelMediaRequests.find(
          (r) =>
            r.ownerChatId === chatId &&
            ((commentId > 0 && r.commentId === commentId) ||
              (r.status === 'pending' && r.normalizedTitle === norm))
        );
        if (!existing) {
          channelMediaRequests.unshift({
            id: commentId > 0 ? `rq_cm_${commentId}` : `rq_${Date.now().toString(36)}`,
            ownerChatId: chatId,
            requestedTitle,
            normalizedTitle: norm,
            requestedByName: usuario.startsWith('@') ? usuario : `@${usuario}`,
            requestedByUsername: usuario.replace(/^@/, ''),
            sourceType: 'picta_comment',
            ...(commentId > 0 ? { commentId } : {}),
            ...(pubId > 0 ? { commentPublicationId: pubId } : {}),
            ...(pubNombre ? { commentPublicationTitle: pubNombre } : {}),
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
          saveChannelMediaRequestsToDisk();
        }
        res.json({
          ok: true,
          requests: channelMediaRequests.filter(
            (r) => r.ownerChatId === chatId && r.status !== 'dismissed'
          ),
          message: existing
            ? `El pedido "${requestedTitle}" ya estaba en tu lista.`
            : `Comentario añadido a Pedidos Pendientes: "${requestedTitle}".`,
        });
        return;
      }

      if (action === 'fulfill_request') {
        const requestId = String(body.requestId || '').trim();
        const target = channelMediaRequests.find(
          (r) => r.id === requestId && r.ownerChatId === chatId
        );
        if (!target) {
          res.status(404).json({ ok: false, error: 'Pedido no encontrado.' });
          return;
        }
        target.status = 'fulfilled';
        target.fulfilledAt = new Date().toISOString();
        if (body.matchedPictaPubId) target.matchedPictaPubId = Number(body.matchedPictaPubId);
        if (typeof body.matchedPictaUrl === 'string' && body.matchedPictaUrl.trim()) {
          target.matchedPictaUrl = body.matchedPictaUrl.trim();
        }
        saveChannelMediaRequestsToDisk();

        const replyCommentText =
          typeof body.replyCommentText === 'string' ? body.replyCommentText.trim() : '';
        if (replyCommentText && target.commentPublicationId && target.commentId) {
          await postPictaCommentInChannel(
            chatId,
            target.commentPublicationId,
            replyCommentText,
            target.commentId
          );
        }
        res.json({
          ok: true,
          requests: channelMediaRequests.filter(
            (r) => r.ownerChatId === chatId && r.status !== 'dismissed'
          ),
          message: replyCommentText
            ? `Pedido "${target.requestedTitle}" cumplido y comentario respondido en Picta.`
            : `Pedido "${target.requestedTitle}" marcado como cumplido.`,
        });
        return;
      }

      if (action === 'reopen_request') {
        const requestId = String(body.requestId || '').trim();
        const target = channelMediaRequests.find(
          (r) => r.id === requestId && r.ownerChatId === chatId
        );
        if (!target) {
          res.status(404).json({ ok: false, error: 'Pedido no encontrado.' });
          return;
        }
        target.status = 'pending';
        target.fulfilledAt = undefined;
        saveChannelMediaRequestsToDisk();
        res.json({
          ok: true,
          requests: channelMediaRequests.filter(
            (r) => r.ownerChatId === chatId && r.status !== 'dismissed'
          ),
          message: `Pedido "${target.requestedTitle}" reabierto como pendiente.`,
        });
        return;
      }

      if (action === 'delete_request') {
        const requestId = String(body.requestId || '').trim();
        const target = channelMediaRequests.find(
          (r) => r.id === requestId && r.ownerChatId === chatId
        );
        if (target?.commentId) {
          ignoredRequestCommentIds.add(target.commentId);
        }
        channelMediaRequests = channelMediaRequests.filter(
          (r) => !(r.id === requestId && r.ownerChatId === chatId)
        );
        saveChannelMediaRequestsToDisk();
        res.json({
          ok: true,
          requests: channelMediaRequests.filter(
            (r) => r.ownerChatId === chatId && r.status !== 'dismissed'
          ),
          message: 'Pedido eliminado de la lista.',
        });
        return;
      }

      res.status(400).json({ ok: false, error: `Acción desconocida: ${action}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  let cachedDiskStats: ReturnType<typeof getScratchDiskStats> | null = null;
  let cachedDiskStatsAt = 0;

  app.get(['/healthz', '/api/health'], (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000) });
  });

  app.get('/api/live-state', (_req: Request, res: Response) => {
    const nowMs = Date.now();
    const now24h = nowMs - 24 * 60 * 60 * 1000;
    let completedUploads = 0;
    let activeTransfers = 0;
    let failedTransfers = 0;
    let totalBytesTransferred = 0;
    let completed24h = 0;
    let failed24h = 0;
    let totalDurationSec24h = 0;
    let durationCount24h = 0;

    for (const j of transferJobs) {
      const createdMs = j.createdAt ? new Date(j.createdAt).getTime() : NaN;
      const in24h = !isNaN(createdMs) && createdMs >= now24h;

      if (j.stage === 'completed') {
        completedUploads++;
        totalBytesTransferred += j.diskVerifiedBytes || j.expectedBytes || 0;
        if (in24h) {
          completed24h++;
          if (j.updatedAt) {
            const endMs = new Date(j.updatedAt).getTime();
            const diff = Math.max(1, Math.round((endMs - createdMs) / 1000));
            if (!isNaN(diff)) {
              totalDurationSec24h += diff;
              durationCount24h++;
            }
          }
        }
      } else if (j.stage === 'failed') {
        failedTransfers++;
        if (in24h) failed24h++;
      } else {
        activeTransfers++;
      }
    }

    const total24h = completed24h + failed24h;
    const successRate24h = total24h > 0 ? Math.round((completed24h / total24h) * 100) : 100;
    const avgProcessingTimeSeconds24h =
      durationCount24h > 0 ? Math.round(totalDurationSec24h / durationCount24h) : 0;

    if (!cachedDiskStats || nowMs - cachedDiskStatsAt > 5000) {
      cachedDiskStats = getScratchDiskStats(TMP_UPLOAD_DIR);
      cachedDiskStatsAt = nowMs;
    }
    const diskStats = cachedDiskStats;
    const memStats = getMemoryTelemetry();

    const state: LiveSystemState = {
      isPreviewInstance: externalCloudRunWebhookActive,
      instanceRole: externalCloudRunWebhookActive
        ? 'preview_passive_monitor'
        : 'cloud_run_active_bot',
      cloudRunAppUrl: detectCloudRunUrl(),
      webhookRegistered,
      webhookUrl: botConfig.webhookUrl,
      webhookPendingUpdates,
      lastWebhookError,
      lastWakeUpAt,
      botProfile,
      mtprotoReady: true,
      mtprotoConnected,
      maxDownloadLimitMB: TELEGRAM_MTPROTO_MAX_FILE_MB,
      pictaConfigured: Boolean(pictaUser || botConfig.pictaAuthToken.trim()),
      pictaUser,
      pictaChannels,
      currentActivity,
      activeJobId,
      activeDownloadJobId,
      activeUploadJobId,
      uptimeSeconds: Math.floor((nowMs - START_TIME) / 1000),
      systemMetrics: {
        scratchDir: diskStats.path,
        isEphemeralVolume: diskStats.isEphemeralVolume,
        storageType: diskStats.storageType,
        diskTotalBytes: diskStats.totalBytes,
        diskFreeBytes: diskStats.freeBytes,
        diskUsedPercent: diskStats.usedPercent,
        rssBytes: memStats.rssBytes,
        heapUsedBytes: memStats.heapUsedBytes,
      },
      stats: {
        totalReceived: transferJobs.length,
        completedUploads,
        activeTransfers,
        failedTransfers,
        totalBytesTransferred,
        successRate24h,
        completed24h,
        failed24h,
        total24h,
        avgProcessingTimeSeconds24h,
      },
      jobs: transferJobs,
      logs: liveLogs.slice(0, 120),
      mtprotoLogs: mtprotoDiagLogs.slice(0, 80),
      pendingRequestsCount: channelMediaRequests.filter(
        (r) => r.ownerChatId === MASTER_ADMIN_CHAT_ID && r.status === 'pending'
      ).length,
    };

    res.json(state);
  });

  app.get('/api/mtproto-logs', (_req: Request, res: Response) => {
    res.json({ ok: true, logs: mtprotoDiagLogs.slice(0, 150) });
  });

  if (!IS_PRODUCTION_RUNTIME) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(
        express.static(distPath, {
          index: false,
          setHeaders: (res, filePath) => {
            if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
            } else if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-store');
            }
          },
        })
      );
      app.get('*', (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        const indexHtml = path.join(distPath, 'index.html');
        if (fs.existsSync(indexHtml)) {
          res.sendFile(indexHtml);
        } else {
          res.status(503).send('PictaBot frontend build not found');
        }
      });
    } else {
      app.get('*', (_req: Request, res: Response) => {
        res.status(503).send('PictaBot frontend dist missing');
      });
    }
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    const bootDiskStats = getScratchDiskStats(TMP_UPLOAD_DIR);
    console.log(
      `PictaBot Cloud Run Server listening on http://0.0.0.0:${PORT} (Scratch: ${TMP_UPLOAD_DIR}, Tipo: ${bootDiskStats.storageType}, Libre: ${formatBytes(bootDiskStats.freeBytes)}/${formatBytes(bootDiskStats.totalBytes)})`
    );
    addLiveLog(
      'system',
      'info',
      `Disco efímero auto-configurado: ${TMP_UPLOAD_DIR} (${bootDiskStats.storageType === 'ephemeral_disk' ? 'Disco real' : 'Temporal'} · ${formatBytes(bootDiskStats.freeBytes)} libres de ${formatBytes(bootDiskStats.totalBytes)}).`
    );

    const startupRemoved = cleanupOrphanedScratchFiles(
      TMP_UPLOAD_DIR,
      getProtectedScratchPaths(),
      30 * 60 * 1000
    );
    if (startupRemoved > 0) {
      addLiveLog(
        'system',
        'info',
        `Limpieza inicial de disco scratch (${TMP_UPLOAD_DIR}): ${startupRemoved} archivo(s) huérfano(s) eliminado(s).`
      );
    }

    const scratchCleanupInterval = setInterval(() => {
      try {
        const cleaned = cleanupOrphanedScratchFiles(
          TMP_UPLOAD_DIR,
          getProtectedScratchPaths(),
          2 * 60 * 60 * 1000
        );
        if (cleaned > 0) {
          addLiveLog(
            'system',
            'info',
            `Limpieza periódica scratch: ${cleaned} archivo(s) antiguo(s) eliminado(s).`
          );
        }
      } catch {
        // Ignore cleanup errors
      }
    }, 30 * 60 * 1000);
    if (typeof scratchCleanupInterval.unref === 'function') {
      scratchCleanupInterval.unref();
    }

    const encoderRetryInterval = setInterval(() => {
      try {
        if (externalCloudRunWebhookActive || activeUploadJobId) return;
        const hasDueEncoderRetry = uploadQueue.some((qId) => {
          const j = transferJobs.find((x) => x.id === qId);
          return j && isEncoderJobDueForRetry(j);
        });
        if (hasDueEncoderRetry) {
          void scheduleTransferPipeline();
        }
      } catch {
        // Ignore scheduler tick error
      }
    }, 20 * 1000);
    if (typeof encoderRetryInterval.unref === 'function') {
      encoderRetryInterval.unref();
    }

    const alertsBaselineTimer = setTimeout(() => {
      if (!externalCloudRunWebhookActive) {
        void scanAllPictaAlertsAndMilestones();
      }
    }, 12 * 1000);
    if (typeof alertsBaselineTimer.unref === 'function') {
      alertsBaselineTimer.unref();
    }

    const pictaAlertsInterval = setInterval(() => {
      if (externalCloudRunWebhookActive) return;
      void scanAllPictaAlertsAndMilestones();
    }, 65 * 1000);
    if (typeof pictaAlertsInterval.unref === 'function') {
      pictaAlertsInterval.unref();
    }

    void authenticateWithPicta(true).catch((err) => {
      addLiveLog('picta', 'warn', `Aviso en login inicial Picta: ${err.message}`);
    });

    void initTelegramListener().then(() => {
      // Clean any (#36319) from stored job synopses and backfill targetChannel info for legacy master jobs
      for (const j of transferJobs) {
        if (j.synopsis) {
          j.synopsis = sanitizePublicPictaText(j.synopsis);
        }
        if (j.telegramChatId === MASTER_ADMIN_CHAT_ID && !j.targetChannelId) {
          j.targetChannelId = botConfig.pictaChannelId || '36319';
          j.targetChannelName = 'Canal Oficial';
        }
      }

      // Re-enqueue any interrupted in-progress or queued transfers without creating duplicate messages
      let reQueuedCount = 0;
      for (const j of transferJobs) {
        const isResumable =
          j.stage === 'queued' ||
          j.stage === 'generating_auto_title' ||
          j.stage === 'downloading_mtproto' ||
          j.stage === 'verifying_integrity' ||
          j.stage === 'uploading_full_file_to_picta' ||
          j.stage === 'creating_picta_publication' ||
          (j.stage === 'failed' && String(j.errorDetails || '').includes('503'));

        if (isResumable) {
          if (j.stage !== 'queued') {
            j.stage = 'queued';
          }
          if (
            j.errorDetails &&
            !j.encoderRetryActive &&
            !j.errorDetails.includes('QUOTA_') &&
            !isDailyLimitErrorText(j.errorDetails)
          ) {
            j.errorDetails = undefined;
          }
          if (j.encoderRetryActive && Number(j.encoderRetryNextAt || 0) <= Date.now()) {
            j.encoderRetryNextAt = Date.now() + 5_000;
          }
          if (!uploadQueue.includes(j.id)) {
            uploadQueue.push(j.id);
            reQueuedCount++;
          }
        }
      }
      saveJobsToDisk();

      if (reQueuedCount > 0 || (uploadQueue.length > 0 && !externalCloudRunWebhookActive)) {
        addLiveLog(
          'system',
          'info',
          `Pipeline reanudado al iniciar: ${uploadQueue.length} trabajo(s) en cola.`
        );
        if (!externalCloudRunWebhookActive) {
          void scheduleTransferPipeline();
        }
      }
    });
  });

  // Cloud Run Google Frontend (GFE) keeps idle sockets open > 5s; matching keepAliveTimeout avoids 502/Network errors
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  let shuttingDown = false;
  const handleGracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Señal ${signal} recibida. Guardando estado antes de salir...`);
    pollingActive = false;
    keepAliveActive = false;
    try {
      flushProcessedUpdatesToDiskNow();
      saveJobsToDisk();
      saveUserSessionsToDisk();
      saveQuotaSettingsToDisk();
      saveAuthorizedUsersToDisk();
      savePinnedSeriesToDisk();
      if (!IS_PREVIEW_INSTANCE) {
        await Promise.race([
          saveCloudStateToTelegramNow(),
          new Promise((r) => setTimeout(r, 3500)),
        ]).catch(() => {});
      }
      await disconnectAuxiliaryBotClients(false);
      if (mtprotoClient) {
        await Promise.race([
          mtprotoClient.disconnect(),
          new Promise((r) => setTimeout(r, 1500)),
        ]).catch(() => {});
      }
    } catch {
      // Ignore shutdown errors
    } finally {
      httpServer.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
    }
  };

  process.once('SIGTERM', () => {
    void handleGracefulShutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void handleGracefulShutdown('SIGINT');
  });
}

void startServer();
