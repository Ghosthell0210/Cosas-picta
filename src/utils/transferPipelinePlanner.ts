export const MAX_PREFETCH_LOOKAHEAD = 1;

export interface PipelineJobDescriptor {
  id: string;
  telegramChatId: string;
  stage: string;
  expectedBytes: number;
  diskVerifiedBytes?: number;
  integrityVerified?: boolean;
  minioKey?: string;
  tempFilePath?: string;
  fileExistsOnDisk?: boolean;
}

export function isJobReadyForUpload(job: PipelineJobDescriptor | null | undefined): boolean {
  if (!job) return false;
  if (job.stage === 'quota_paused' || job.stage === 'encoder_paused') return false;
  if (job.stage !== 'queued') return false;
  if (job.minioKey) return true;
  return Boolean(job.integrityVerified && job.fileExistsOnDisk);
}

export function selectNextUploadJob(
  queue: string[],
  jobsMap: Map<string, PipelineJobDescriptor>,
  activeUploadJobId: string | null,
  _activeDownloadJobId?: string | null
): PipelineJobDescriptor | null {
  if (activeUploadJobId) return null;
  for (const id of queue) {
    const job = jobsMap.get(id);
    if (isJobReadyForUpload(job)) {
      return job!;
    }
  }
  return null;
}

export function selectNextDownloadJob(
  queue: string[],
  jobsMap: Map<string, PipelineJobDescriptor>,
  activeDownloadJobId: string | null,
  _activeUploadJobId: string | null,
  maxLookahead = MAX_PREFETCH_LOOKAHEAD
): PipelineJobDescriptor | null {
  if (activeDownloadJobId) return null;
  let prefetchedCount = 0;
  for (const id of queue) {
    const job = jobsMap.get(id);
    if (!job) continue;
    if (job.stage === 'quota_paused' || job.stage === 'encoder_paused') continue;
    if (isJobReadyForUpload(job)) {
      prefetchedCount++;
      continue;
    }
    if (job.stage === 'queued') {
      if (prefetchedCount >= maxLookahead) {
        return null;
      }
      return job;
    }
  }
  return null;
}

export function filterJobsForUser<T extends { telegramChatId?: string }>(
  jobs: T[],
  chatId: string,
  _masterAdminChatId?: string
): T[] {
  const target = String(chatId || '').trim();
  if (!target) return [];
  return (jobs || []).filter((j) => String(j.telegramChatId || '').trim() === target);
}
