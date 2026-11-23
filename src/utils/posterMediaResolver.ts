export type PictaImageSlot = 'portada' | 'poster' | 'both';

export function buildTmdbImageUrls(
  posterPath?: string | null,
  backdropPath?: string | null
): {
  imageUrl?: string;
  posterUrl?: string;
  backdropUrl?: string;
} {
  const cleanPoster = String(posterPath || '').trim();
  const cleanBackdrop = String(backdropPath || '').trim();
  const posterUrl = cleanPoster
    ? cleanPoster.startsWith('http')
      ? cleanPoster
      : `https://image.tmdb.org/t/p/w780${cleanPoster.startsWith('/') ? '' : '/'}${cleanPoster}`
    : undefined;
  const backdropUrl = cleanBackdrop
    ? cleanBackdrop.startsWith('http')
      ? cleanBackdrop
      : `https://image.tmdb.org/t/p/w1280${cleanBackdrop.startsWith('/') ? '' : '/'}${cleanBackdrop}`
    : undefined;
  return {
    ...(posterUrl || backdropUrl ? { imageUrl: posterUrl || backdropUrl } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(backdropUrl ? { backdropUrl } : {}),
  };
}

export function selectOnlineImageForSlot(
  onlineInfo: {
    imageUrl?: string;
    posterUrl?: string;
    backdropUrl?: string;
  } | null | undefined,
  slot: PictaImageSlot
): string | undefined {
  if (!onlineInfo) return undefined;
  if (slot === 'poster') {
    return onlineInfo.posterUrl || onlineInfo.imageUrl || onlineInfo.backdropUrl;
  }
  return onlineInfo.backdropUrl || onlineInfo.imageUrl || onlineInfo.posterUrl;
}

export function cleanTitleForTmdbPosterSearch(rawTitle: string, parentSerieName?: string): string {
  const parent = String(parentSerieName || '').trim();
  if (parent) {
    return parent
      .replace(/\bT\d+\s*Cap\.?\s*\d+.*$/i, '')
      .replace(/\bS\d{1,2}E\d{1,3}.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return String(rawTitle || '')
    .replace(/\bT\d+\s*Cap\.?\s*\d+.*$/i, '')
    .replace(/\bS\d{1,2}E\d{1,3}.*$/i, '')
    .replace(/\b(?:Temporada|Season)\s*\d+.*$/i, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function selectUploadPairBuffers(params: {
  customCoverBuf?: Buffer | null;
  customPosterBuf?: Buffer | null;
  onlineBackdropBuf?: Buffer | null;
  onlinePosterBuf?: Buffer | null;
  videoFrameBuf?: Buffer | null;
  preferVideoFrameCover?: boolean;
  fallbackBuf: Buffer;
}): {
  urlImagenBuf: Buffer;
  imagenSecundariaBuf: Buffer;
} {
  const {
    customCoverBuf,
    customPosterBuf,
    onlineBackdropBuf,
    onlinePosterBuf,
    videoFrameBuf,
    preferVideoFrameCover,
    fallbackBuf,
  } = params;

  const isValid = (b?: Buffer | null): b is Buffer => Boolean(b && b.byteLength > 100);

  let urlImagenBuf: Buffer;
  if (preferVideoFrameCover && isValid(videoFrameBuf)) {
    urlImagenBuf = videoFrameBuf;
  } else if (isValid(customCoverBuf)) {
    urlImagenBuf = customCoverBuf;
  } else if (isValid(onlineBackdropBuf)) {
    urlImagenBuf = onlineBackdropBuf;
  } else if (isValid(videoFrameBuf)) {
    urlImagenBuf = videoFrameBuf;
  } else if (isValid(onlinePosterBuf)) {
    urlImagenBuf = onlinePosterBuf;
  } else {
    urlImagenBuf = fallbackBuf;
  }

  let imagenSecundariaBuf: Buffer;
  if (isValid(customPosterBuf)) {
    imagenSecundariaBuf = customPosterBuf;
  } else if (isValid(onlinePosterBuf)) {
    imagenSecundariaBuf = onlinePosterBuf;
  } else if (isValid(customCoverBuf)) {
    imagenSecundariaBuf = customCoverBuf;
  } else if (isValid(onlineBackdropBuf)) {
    imagenSecundariaBuf = onlineBackdropBuf;
  } else {
    imagenSecundariaBuf = urlImagenBuf;
  }

  return { urlImagenBuf, imagenSecundariaBuf };
}

export function buildPublicationImagePatchFiles(params: {
  slot: PictaImageSlot;
  uploadedBuffer?: Buffer | null;
  tmdbPortadaBuffer?: Buffer | null;
  tmdbPosterBuffer?: Buffer | null;
}): {
  coverBuffer?: Buffer;
  posterBuffer?: Buffer;
} {
  const { slot, uploadedBuffer, tmdbPortadaBuffer, tmdbPosterBuffer } = params;
  const out: { coverBuffer?: Buffer; posterBuffer?: Buffer } = {};
  if (uploadedBuffer && uploadedBuffer.byteLength > 100) {
    if (slot === 'portada' || slot === 'both') out.coverBuffer = uploadedBuffer;
    if (slot === 'poster' || slot === 'both') out.posterBuffer = uploadedBuffer;
    return out;
  }
  if ((slot === 'portada' || slot === 'both') && tmdbPortadaBuffer && tmdbPortadaBuffer.byteLength > 100) {
    out.coverBuffer = tmdbPortadaBuffer;
  }
  if ((slot === 'poster' || slot === 'both') && tmdbPosterBuffer && tmdbPosterBuffer.byteLength > 100) {
    out.posterBuffer = tmdbPosterBuffer;
  }
  return out;
}

export function buildSerieImagePatchFiles(params: {
  slot: PictaImageSlot;
  uploadedBuffer?: Buffer | null;
  tmdbPortadaBuffer?: Buffer | null;
  tmdbPosterBuffer?: Buffer | null;
}): {
  portadaBuffer?: Buffer;
  posterBuffer?: Buffer;
} {
  const { slot, uploadedBuffer, tmdbPortadaBuffer, tmdbPosterBuffer } = params;
  const out: { portadaBuffer?: Buffer; posterBuffer?: Buffer } = {};
  if (uploadedBuffer && uploadedBuffer.byteLength > 100) {
    if (slot === 'portada' || slot === 'both') out.portadaBuffer = uploadedBuffer;
    if (slot === 'poster' || slot === 'both') out.posterBuffer = uploadedBuffer;
    return out;
  }
  if ((slot === 'portada' || slot === 'both') && tmdbPortadaBuffer && tmdbPortadaBuffer.byteLength > 100) {
    out.portadaBuffer = tmdbPortadaBuffer;
  }
  if ((slot === 'poster' || slot === 'both') && tmdbPosterBuffer && tmdbPosterBuffer.byteLength > 100) {
    out.posterBuffer = tmdbPosterBuffer;
  }
  return out;
}
