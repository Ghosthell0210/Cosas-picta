export interface PictaTipologia {
  id: number;
  nombre: string;
  modelo?: string;
}

export const PICTA_TIPOLOGIAS: PictaTipologia[] = [
  { id: 1, nombre: 'Película', modelo: 'pelicula' },
  { id: 5, nombre: 'Serie', modelo: 'capitulo' },
  { id: 2, nombre: 'Documental', modelo: 'documental' },
  { id: 8, nombre: 'Audiovisual', modelo: 'audiovisual' },
  { id: 15, nombre: 'Shorts', modelo: 'shorts' },
  { id: 19, nombre: 'Humorístico', modelo: 'humoristico' },
  { id: 3, nombre: 'Video Musical', modelo: 'video_musical' },
  { id: 11, nombre: 'Videoclip', modelo: 'videoclip' },
  { id: 6, nombre: 'Deporte', modelo: 'deporte' },
  { id: 14, nombre: 'Gameplay', modelo: 'gameplay' },
  { id: 18, nombre: 'Receta', modelo: 'receta' },
  { id: 17, nombre: 'Reportaje', modelo: 'reportaje' },
];

export interface PictaFieldMapping {
  videoField: string;
  titleField: string;
  synopsisField: string;
  categoryField: string;
  channelField: string;
  publishedField: string;
  extraFieldsJson: string;
}

export interface BotConfig {
  telegramBotToken: string;
  telegramApiId: string;
  telegramApiHash: string;
  telegramLocalApiUrl: string;
  webhookUrl: string;
  useWebhook: boolean;
  allowedChatIds: string;
  pictaUsername: string;
  pictaPassword: string;
  pictaClientId: string;
  pictaBaseUrl: string;
  pictaUploadEndpoint: string;
  pictaAuthType: 'oauth_password' | 'bearer' | 'cookie' | string;
  pictaAuthToken: string;
  pictaCookie: string;
  pictaChannelId: string;
  pictaTipologiaId: string;
  pictaDefaultCategory: string;
  pictaClasificacion: string;
  pictaPalabraClaveId: string;
  channelThemeDescription: string;
  fieldMapping: PictaFieldMapping;
}

export interface PictaAuthenticatedUser {
  id?: number;
  username: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  roles: string[];
  fullName?: string;
  email?: string;
  avatarUrl?: string;
  groups?: string[];
  hasChannelAdminRole?: boolean;
}

export interface PictaChannelOption {
  id: number | string;
  nombre: string;
  alias?: string;
  slug_url?: string;
  cantidad_suscriptores?: number;
  cantidad_publicaciones?: number;
}

export type TransferStage =
  | 'awaiting_category'
  | 'awaiting_series_selection'
  | 'awaiting_new_series_name'
  | 'awaiting_season_selection'
  | 'awaiting_title_choice'
  | 'awaiting_manual_title'
  | 'awaiting_step_title'
  | 'awaiting_step_synopsis'
  | 'awaiting_step_cover'
  | 'awaiting_step_subtitles'
  | 'awaiting_duplicate_confirmation'
  | 'awaiting_upload_account'
  | 'queued'
  | 'generating_auto_title'
  | 'downloading_mtproto'
  | 'verifying_integrity'
  | 'uploading_full_file_to_picta'
  | 'creating_picta_publication'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface VideoTransferJob {
  id: string;
  telegramMessageId: number;
  statusMessageId?: number | null;
  telegramChatId: string;
  senderName: string;
  fileId: string;
  fileUniqueId?: string;
  thumbnailFileId?: string;
  customCoverFileId?: string;
  customPosterFileId?: string;
  subtitleFileId?: string;
  subtitleFileName?: string;
  fileName: string;
  mimeType?: string;
  caption: string;
  expectedBytes: number;
  downloadedBytes: number;
  integrityVerified?: boolean;
  diskVerifiedBytes: number;
  uploadedBytes: number;
  tempFilePath?: string;
  minioKey?: string;
  stage: TransferStage;
  title: string;
  titleMode?: 'pending' | 'auto' | 'manual' | string;
  synopsis: string;
  category: string;
  tipologiaId: number;
  tags: string[];
  modelMetadata?: Record<string, any>;
  speedMBps: number;
  targetChannelId?: string;
  targetChannelName?: string;
  sourceType?: 'telegram_media' | 'telegram_link' | 'http_url';
  sourceUrl?: string;
  sourcePeerRef?: string;
  sourceMessageId?: number;
  linkedRequestId?: string;
  preferredUploadAccountKey?: string;
  preferredUploadAccountLabel?: string;
  duplicateCheckApprovedTitle?: string;
  duplicateCheckNextAction?: 'step2' | 'auto' | 'pinned_serie';
  pictaPublicationId?: number;
  pictaResponseCode?: number;
  pictaResponseText?: string;
  errorDetails?: string;
  encoderRetryActive?: boolean;
  encoderRetryCount?: number;
  encoderRetryNextAt?: number;
  encoderRetryLastError?: string;
  encoderManualRetryTriggered?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface LiveEventLog {
  id: string;
  timestamp: string;
  source: 'telegram' | 'mtproto' | 'picta' | 'ai' | 'system' | string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface MtprotoDiagLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  dcId?: number;
  activeSockets?: number;
  maxSockets?: number;
  windowMBps?: number;
  avgMBps?: number;
  cpuPct?: number;
  avgLatencyMs?: number;
  errorCount?: number;
  fileName?: string;
  reparto?: string;
  cryptoBackend?: string;
  workerThreads?: number;
  pipelineDepth?: number;
  cdnUsed?: boolean;
  message: string;
}

export interface LiveSystemState {
  isPreviewInstance: boolean;
  instanceRole?: 'preview_passive_monitor' | 'cloud_run_active_bot' | string;
  cloudRunAppUrl?: string;
  webhookRegistered: boolean;
  webhookUrl?: string;
  webhookPendingUpdates?: number;
  lastWebhookError?: string | null;
  lastWakeUpAt?: string | null;
  botProfile?: {
    id: number;
    username: string;
    firstName: string;
  } | null;
  mtprotoReady: boolean;
  mtprotoConnected: boolean;
  maxDownloadLimitMB: number;
  pictaConfigured: boolean;
  pictaUser?: PictaAuthenticatedUser | null;
  pictaChannels?: PictaChannelOption[];
  currentActivity?: string;
  activeJobId?: string | null;
  activeDownloadJobId?: string | null;
  activeUploadJobId?: string | null;
  uptimeSeconds: number;
  systemMetrics?: {
    scratchDir: string;
    isEphemeralVolume: boolean;
    storageType: 'ephemeral_disk' | 'tmpfs_ram' | 'auto';
    diskTotalBytes: number;
    diskFreeBytes: number;
    diskUsedPercent: number;
    rssBytes: number;
    heapUsedBytes: number;
  };
  stats: {
    totalReceived: number;
    completedUploads: number;
    activeTransfers: number;
    failedTransfers: number;
    totalBytesTransferred: number;
    successRate24h: number;
    completed24h: number;
    failed24h: number;
    total24h: number;
    avgProcessingTimeSeconds24h: number;
  };
  jobs: VideoTransferJob[];
  logs: LiveEventLog[];
  mtprotoLogs?: MtprotoDiagLogEntry[];
  pendingRequestsCount?: number;
}
