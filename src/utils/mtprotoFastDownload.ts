export const MTPROTO_TURBO_CHUNK_BYTES = 1024 * 1024; // 1 MB
export const MTPROTO_FALLBACK_CHUNK_BYTES = 512 * 1024; // 512 KB
export const MTPROTO_TCP_POOL_SIZE = 6;
export const MTPROTO_PIPELINE_MIN_PER_SOCKET = 1;
export const MTPROTO_PIPELINE_DEFAULT_PER_SOCKET = 3;
export const MTPROTO_PIPELINE_MAX_PER_SOCKET = 4;
export const MTPROTO_SAFE_PARALLEL_WORKERS =
  MTPROTO_TCP_POOL_SIZE * MTPROTO_PIPELINE_MAX_PER_SOCKET; // 24 in-flight across 6 persistent DC sockets
export const MTPROTO_SLEEP_THRESHOLD_SECONDS = 30;
export const S3_UPLOAD_HIGH_WATER_MARK_BYTES = 256 * 1024; // 256 KB
export const TELEGRAM_MTPROTO_MAX_FILE_MB = 4096; // 4 GB
export const PICTA_S3_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export interface DownloadChunkDescriptor {
  index: number;
  offset: number;
  requestLimit: number;
  expectedBytes: number;
}

export interface DecodedTelegramFileId {
  valid: boolean;
  dcId: number;
  fileType: number;
  mediaId: string;
  accessHash: string;
  fileReference: Buffer<ArrayBuffer>;
  isPhoto: boolean;
}

function rleDecodeTelegramFileId(buf: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0) {
      const count = buf[i + 1] ?? 0;
      i++;
      for (let j = 0; j < count; j++) {
        out.push(0);
      }
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out);
}

function readTlBytes(buf: Buffer, offset: number): { data: Buffer<ArrayBuffer>; nextOffset: number } | null {
  if (offset >= buf.length) return null;
  let len = buf[offset];
  let cursor = offset + 1;
  if (len === 254) {
    if (cursor + 3 > buf.length) return null;
    len = buf[cursor] | (buf[cursor + 1] << 8) | (buf[cursor + 2] << 16);
    cursor += 3;
  }
  if (cursor + len > buf.length) return null;
  const data = Buffer.from(buf.subarray(cursor, cursor + len)) as Buffer<ArrayBuffer>;
  const totalBytes = (len === buf[offset] ? 1 : 4) + len;
  const pad = (4 - (totalBytes % 4)) % 4;
  return { data, nextOffset: cursor + len + pad };
}

function readInt64LeSigned(buf: Buffer, offset: number): bigint {
  const lo = BigInt(buf.readUInt32LE(offset));
  const hi = BigInt(buf.readInt32LE(offset + 4));
  return (hi << 32n) | lo;
}

export function decodeTelegramBotFileId(fileId: string): DecodedTelegramFileId | null {
  const rawStr = String(fileId || '').trim();
  if (!rawStr || rawStr.length < 16) return null;

  try {
    const b64 = rawStr.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const rawBuf = Buffer.from(b64 + pad, 'base64');
    if (rawBuf.length < 20) return null;

    const decoded = rleDecodeTelegramFileId(rawBuf);
    if (decoded.length < 22) return null;

    const major = decoded[decoded.length - 1];
    let body = decoded;
    if (major >= 4) {
      body = decoded.subarray(0, decoded.length - 2);
    } else if (major === 2 || major === 3) {
      body = decoded.subarray(0, decoded.length - 1);
    }
    if (body.length < 24) return null;

    const rawTypeId = body.readInt32LE(0);
    const dcId = body.readInt32LE(4);
    if (dcId < 1 || dcId > 5) return null;

    const hasWebLocation = (rawTypeId & 0x2000000) !== 0;
    const hasFileReference = (rawTypeId & 0x1000000) !== 0;
    const baseFileType = rawTypeId & 0xffffff;
    const isPhoto = baseFileType === 0 || baseFileType === 1 || baseFileType === 2;

    if (hasWebLocation) return null;

    let cursor = 8;
    let fileReference: Buffer<ArrayBuffer> = Buffer.alloc(0) as Buffer<ArrayBuffer>;
    if (hasFileReference) {
      const ref = readTlBytes(body, cursor);
      if (!ref) return null;
      fileReference = ref.data;
      cursor = ref.nextOffset;
    }

    if (cursor + 16 > body.length) return null;
    const mediaId = readInt64LeSigned(body, cursor);
    const accessHash = readInt64LeSigned(body, cursor + 8);

    return {
      valid: true,
      dcId,
      fileType: baseFileType,
      mediaId: mediaId.toString(),
      accessHash: accessHash.toString(),
      fileReference,
      isPhoto,
    };
  } catch {
    return null;
  }
}

export function buildDirectDownloadChunks(
  totalBytes: number,
  chunkBytes = MTPROTO_TURBO_CHUNK_BYTES
): DownloadChunkDescriptor[] {
  const safeTotal = Math.max(0, Number(totalBytes || 0));
  const safeChunk = Math.max(64 * 1024, Number(chunkBytes || MTPROTO_TURBO_CHUNK_BYTES));
  const chunks: DownloadChunkDescriptor[] = [];
  let offset = 0;
  let index = 0;
  while (offset < safeTotal) {
    const remaining = safeTotal - offset;
    const expectedBytes = Math.min(safeChunk, remaining);
    chunks.push({
      index,
      offset,
      requestLimit: safeChunk,
      expectedBytes,
    });
    offset += expectedBytes;
    index++;
  }
  return chunks;
}

export function splitChunkInto512KbParts(
  chunk: DownloadChunkDescriptor,
  totalBytes: number
): DownloadChunkDescriptor[] {
  const half = MTPROTO_FALLBACK_CHUNK_BYTES;
  if (chunk.expectedBytes <= half) {
    return [
      {
        index: chunk.index,
        offset: chunk.offset,
        requestLimit: half,
        expectedBytes: Math.min(chunk.expectedBytes, Math.max(0, totalBytes - chunk.offset)),
      },
    ];
  }
  const firstExpected = Math.min(half, chunk.expectedBytes);
  const secondOffset = chunk.offset + firstExpected;
  const secondExpected = Math.max(0, Math.min(chunk.expectedBytes - firstExpected, totalBytes - secondOffset));
  const out: DownloadChunkDescriptor[] = [
    {
      index: chunk.index,
      offset: chunk.offset,
      requestLimit: half,
      expectedBytes: firstExpected,
    },
  ];
  if (secondExpected > 0) {
    out.push({
      index: chunk.index,
      offset: secondOffset,
      requestLimit: half,
      expectedBytes: secondExpected,
    });
  }
  return out;
}

export type ClassifiedMtprotoDownloadError =
  | {
      kind: 'file_migrate';
      retryable: boolean;
      waitSeconds: number;
      newDcId: number;
      dcId: number;
      message: string;
    }
  | {
      kind:
        | 'cancelled'
        | 'fatal_auth'
        | 'flood_wait'
        | 'file_reference_expired'
        | 'limit_invalid'
        | 'offset_invalid'
        | 'transient_network'
        | 'unknown';
      retryable: boolean;
      waitSeconds: number;
      newDcId?: number;
      dcId?: number;
      message: string;
    };

export function classifyMtprotoDownloadError(err: any): ClassifiedMtprotoDownloadError {
  const msg = String(err?.errorMessage || err?.message || err || 'Error desconocido').trim();
  const upper = msg.toUpperCase();

  if (upper.includes('SUBIDA_CANCELADA_POR_USUARIO') || upper.includes('ABORT')) {
    return { kind: 'cancelled', retryable: false, waitSeconds: 0, message: msg };
  }
  if (
    upper.includes('AUTH_KEY_DUPLICATED') ||
    upper.includes('AUTH_KEY_UNREGISTERED') ||
    upper.includes('SESSION_REVOKED') ||
    upper.includes('USER_DEACTIVATED')
  ) {
    return { kind: 'fatal_auth', retryable: false, waitSeconds: 0, message: msg };
  }
  const floodMatch = upper.match(/FLOOD_WAIT_(\d+)/);
  if (floodMatch) {
    return {
      kind: 'flood_wait',
      retryable: true,
      waitSeconds: Number(floodMatch[1] || 5),
      message: msg,
    };
  }
  if (upper.includes('FILE_REFERENCE_EXPIRED') || upper.includes('FILE_REFERENCE_INVALID')) {
    return { kind: 'file_reference_expired', retryable: true, waitSeconds: 0, message: msg };
  }
  const dcMatch = upper.match(/(?:FILE_MIGRATE|NETWORK_MIGRATE|PHONE_MIGRATE)_(\d+)/);
  if (dcMatch) {
    const migratedDc = Number(dcMatch[1]);
    return {
      kind: 'file_migrate',
      retryable: true,
      waitSeconds: 0,
      newDcId: migratedDc,
      dcId: migratedDc,
      message: msg,
    };
  }
  if (upper.includes('OFFSET_INVALID')) {
    return { kind: 'offset_invalid', retryable: false, waitSeconds: 0, message: msg };
  }
  if (upper.includes('LIMIT_INVALID')) {
    return { kind: 'limit_invalid', retryable: true, waitSeconds: 0, message: msg };
  }
  if (
    upper.includes('TIMEOUT') ||
    upper.includes('ECONNRESET') ||
    upper.includes('EPIPE') ||
    upper.includes('CLOSED') ||
    upper.includes('DISCONNECT')
  ) {
    return { kind: 'transient_network', retryable: true, waitSeconds: 0, message: msg };
  }
  return { kind: 'unknown', retryable: true, waitSeconds: 0, message: msg };
}

export function shouldUseMainClientSenderForPrimarySlot(
  targetDcId?: number,
  homeDcId?: number
): boolean {
  if (!targetDcId || !homeDcId) return true;
  return Number(targetDcId) === Number(homeDcId);
}

export function selectLeastBusySenderSlot(
  inFlightCounts: number[],
  healthyFlags: boolean[],
  roundRobinCounter = 0
): number {
  const len = inFlightCounts.length;
  if (len === 0) return 0;
  let bestIdx = -1;
  let bestLoad = Number.POSITIVE_INFINITY;

  for (let step = 0; step < len; step++) {
    const idx = (roundRobinCounter + step) % len;
    if (!healthyFlags[idx]) continue;
    const load = inFlightCounts[idx] ?? 0;
    if (load < bestLoad) {
      bestLoad = load;
      bestIdx = idx;
    }
  }
  return bestIdx >= 0 ? bestIdx : 0;
}

export function computePoolWarmupCount(
  totalBytes: number,
  maxPoolSize = MTPROTO_TCP_POOL_SIZE
): number {
  const mb = Number(totalBytes || 0) / (1024 * 1024);
  if (mb <= 15) return Math.min(2, maxPoolSize);
  if (mb <= 80) return Math.min(4, maxPoolSize);
  return maxPoolSize;
}

export function computeAdaptivePipelineDepth(params: {
  currentDepth: number;
  errorDelta: number;
  floodWaitHit: boolean;
  avgLatencyMs: number;
}): number {
  if (params.floodWaitHit) {
    return MTPROTO_PIPELINE_MIN_PER_SOCKET;
  }
  if (params.errorDelta >= 3) {
    return Math.max(MTPROTO_PIPELINE_MIN_PER_SOCKET, params.currentDepth - 1);
  }
  if (params.errorDelta === 0 && params.avgLatencyMs > 0 && params.avgLatencyMs < 1500) {
    return Math.min(MTPROTO_PIPELINE_MAX_PER_SOCKET, params.currentDepth + 1);
  }
  return Math.max(
    MTPROTO_PIPELINE_MIN_PER_SOCKET,
    Math.min(MTPROTO_PIPELINE_MAX_PER_SOCKET, params.currentDepth)
  );
}

export function formatMtprotoDownloadHudLine(params: {
  dcId?: number;
  activeSockets: number;
  maxSockets: number;
  speedMBps?: number;
  pipelineDepth?: number;
  workerCount?: number;
}): string {
  const dcStr = params.dcId ? `DC #${params.dcId}` : 'DC Auto';
  const speed = Number(params.speedMBps || 0);
  const speedStr = speed > 0 ? `${speed.toFixed(2)} MB/s` : 'Calculando...';
  const pipeSuffix =
    params.pipelineDepth && params.pipelineDepth > 1 ? ` (${params.pipelineDepth}x/sock)` : '';
  return `🌐 <b>Red MTProto:</b> <code>${dcStr}</code> · 🔌 <b>Sockets:</b> ${params.activeSockets}/${params.maxSockets}${pipeSuffix} · 🚀 <b>${speedStr}</b>`;
}
