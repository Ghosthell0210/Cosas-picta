export const MAX_ENCODER_AUTO_RETRIES = 6;

const RETRY_DELAYS_MIN = [2, 5, 10, 15, 25, 40];

export function isPictaEncoderOrTransientServerError(
  errorMsg?: string | null,
  statusCode?: number
): boolean {
  const msg = String(errorMsg || '').toLowerCase();
  if (statusCode && [500, 502, 503, 504, 520, 521, 522, 524].includes(Number(statusCode))) {
    return true;
  }
  return (
    msg.includes('codificador') ||
    msg.includes('nomad') ||
    msg.includes('502 bad gateway') ||
    msg.includes('503 service unavailable') ||
    msg.includes('504 gateway') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('error interno del servidor') ||
    msg.includes('error http 5')
  );
}

export function extractShortEncoderErrorReason(errorMsg?: string | null): string {
  const raw = String(errorMsg || '').trim();
  if (!raw) return 'Codificador / Servidor Picta temporalmente ocupado';
  const lower = raw.toLowerCase();
  if (lower.includes('nomad') || lower.includes('codificador')) {
    return 'El servidor codificador (Nomad) de Picta está saturado momentáneamente';
  }
  if (lower.includes('502') || lower.includes('503') || lower.includes('504')) {
    return 'Picta devolvió un error temporal de puerta de enlace (502/503/504)';
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset')) {
    return 'Tiempo de espera agotado al conectar con Picta';
  }
  return raw.slice(0, 110);
}

export function computeNextEncoderRetryState(
  currentRetryCount: number,
  nowMs = Date.now()
): {
  shouldContinue: boolean;
  nextAttemptCount: number;
  waitMinutes: number;
  nextRetryAtMs: number;
} {
  const count = Math.max(0, Number(currentRetryCount || 0));
  if (count >= MAX_ENCODER_AUTO_RETRIES) {
    return {
      shouldContinue: false,
      nextAttemptCount: count,
      waitMinutes: 0,
      nextRetryAtMs: 0,
    };
  }
  const waitMinutes = RETRY_DELAYS_MIN[Math.min(count, RETRY_DELAYS_MIN.length - 1)] || 15;
  return {
    shouldContinue: true,
    nextAttemptCount: count + 1,
    waitMinutes,
    nextRetryAtMs: nowMs + waitMinutes * 60 * 1000,
  };
}

export function isEncoderJobPausedInQueue(job: {
  stage?: string;
  encoderRetryActive?: boolean;
  encoderRetryNextAt?: number;
}): boolean {
  if (!job || job.stage !== 'queued') return false;
  if (!job.encoderRetryActive) return false;
  return Number(job.encoderRetryNextAt || 0) > Date.now();
}

export function isEncoderJobDueForRetry(job: {
  stage?: string;
  encoderRetryActive?: boolean;
  encoderRetryNextAt?: number;
}): boolean {
  if (!job || job.stage !== 'queued') return false;
  if (!job.encoderRetryActive) return false;
  const nextAt = Number(job.encoderRetryNextAt || 0);
  return nextAt > 0 && Date.now() >= nextAt;
}
