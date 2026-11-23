export interface DetectedSeriesTitleStyle {
  pattern: 'tx_capx' | 'sxe' | 'cap_only' | 'temporada_cap';
  padEp: boolean;
  includeSubtitle: boolean;
  separator: string;
  sampleCount: number;
  sampleTitle: string;
  description: string;
}

export interface ParsedSeriesCandidate {
  hasExplicitNumbers: boolean;
  serieName: string;
  temporada: string;
  numero: string;
  episodeSubtitle?: string;
}

export interface ExtractedSeriesInfo {
  serieName: string;
  temporada: string;
  numero: string;
  episodeSubtitle?: string;
  missingSerieName: boolean;
  hasExplicitNumbers: boolean;
}

export function cleanGeneralVideoTitle(rawName: string): string {
  const s = String(rawName || '')
    .replace(/\.(mp4|mkv|avi|mov|webm|flv|wmv|ts|m4v|part\d*|rar|zip|7z)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:1080p|720p|480p|2160p|4k|hd|bluray|web-?dl|webrip|hdrip|dvdrip|x264|x265|hevc|aac|latino|español|espanol|subtitulado|dual|castellano)\)/gi, ' ')
    .replace(/\b(?:1080p|720p|480p|2160p|4k|uhd|hdr|bluray|bdrip|brrip|web-?dl|webrip|hdrip|dvdrip|camrip|x264|x265|h264|h265|hevc|aac|ac3|dts|latino|castellano|subtitulado|dual|vose|mp4|mkv)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-:|_\s]+|[-:|_\s]+$/g, '')
    .trim();
  if (!s) return '';
  return s;
}

export function isGenericOrInvalidSerieName(name?: string | null): boolean {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean || clean.length < 2) return true;
  const generics = new Set([
    'serie',
    'series',
    'nueva serie',
    'video',
    'capitulo',
    'capítulo',
    'episodio',
    'temporada',
    'desconocido',
    'desconocida',
    'pendiente',
    'sin nombre',
    'untitled',
    'document',
    'file',
    'archivo',
  ]);
  if (generics.has(clean)) return true;
  if (/^(?:cap(?:itulo|[ií]tulo)?|ep(?:isodio)?|temp(?:orada)?|s\d+|t\d+|\d+)$/i.test(clean)) {
    return true;
  }
  return false;
}

export function isRandomOrCrypticFilename(name?: string | null): boolean {
  const clean = cleanGeneralVideoTitle(String(name || '')).replace(/\s+/g, '');
  if (!clean || clean.length < 2) return true;
  if (/^(?:vid|video|mov|img|doc|file|wa|tg|telegram|document|clip)[_-]?\d{4,}$/i.test(clean)) {
    return true;
  }
  if (/^[0-9a-f]{12,}$/i.test(clean)) return true;
  if (/^\d{6,}$/.test(clean)) return true;
  const digits = (clean.match(/\d/g) || []).length;
  const letters = (clean.match(/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/g) || []).length;
  if (letters < 2) return true;
  if (clean.length >= 10 && digits / clean.length > 0.72) return true;
  return false;
}

export function parseSingleSeriesCandidate(rawText: string): ParsedSeriesCandidate {
  const text = cleanGeneralVideoTitle(rawText);
  let temporada = '1';
  let numero = '1';
  let hasExplicitNumbers = false;
  let serieName = text;
  let episodeSubtitle: string | undefined;

  const sxeMatch = text.match(/^(.*?)\bS(\d{1,2})\s*[ExX](\d{1,3})\b(.*)$/i);
  const txCapMatch = text.match(/^(.*?)\bT(\d{1,2})\s*[-·.]?\s*(?:Cap\.?|Capítulo|Capitulo|Ep\.?|E)\s*(\d{1,3})\b(.*)$/i);
  const xMatch = text.match(/^(.*?)\b(\d{1,2})x(\d{1,3})\b(.*)$/i);
  const tempEpMatch = text.match(
    /^(.*?)\b(?:Temporada|Temp\.?|Season)\s*(\d{1,2})\s*[-·,]?\s*(?:Cap[íi]tulo|Cap\.?|Episodio|Ep\.?)\s*(\d{1,3})\b(.*)$/i
  );
  const capOnlyMatch = text.match(/^(.*?)\b(?:Cap[íi]tulo|Cap\.?|Episodio|Ep\.?|E)\s*(\d{1,3})\b(.*)$/i);

  const chosen = sxeMatch || txCapMatch || xMatch || tempEpMatch;
  if (chosen) {
    hasExplicitNumbers = true;
    serieName = (chosen[1] || '').replace(/[-·:|_\s]+$/g, '').trim();
    temporada = String(Number(chosen[2] || 1));
    numero = String(Number(chosen[3] || 1));
    const tail = (chosen[4] || '').replace(/^[-·:|_\s]+/, '').trim();
    if (tail && !isRandomOrCrypticFilename(tail)) {
      episodeSubtitle = tail;
    }
  } else if (capOnlyMatch) {
    hasExplicitNumbers = true;
    serieName = (capOnlyMatch[1] || '').replace(/[-·:|_\s]+$/g, '').trim();
    temporada = '1';
    numero = String(Number(capOnlyMatch[2] || 1));
    const tail = (capOnlyMatch[3] || '').replace(/^[-·:|_\s]+/, '').trim();
    if (tail && !isRandomOrCrypticFilename(tail)) {
      episodeSubtitle = tail;
    }
  }

  return {
    hasExplicitNumbers,
    serieName,
    temporada,
    numero,
    ...(episodeSubtitle ? { episodeSubtitle } : {}),
  };
}

export function formatSerieEpisodeTitle(
  serieName: string,
  temporada: string | number = '1',
  numero: string | number = '1',
  episodeSubtitle?: string
): string {
  const cleanName = String(serieName || 'Serie').trim() || 'Serie';
  const temp = Number(String(temporada || '1').replace(/\D/g, '') || 1);
  const ep = Number(String(numero || '1').replace(/\D/g, '') || 1);
  const base = `${cleanName} T${temp} Cap. ${ep}`;
  const sub = String(episodeSubtitle || '').trim();
  return sub ? `${base} · ${sub}` : base;
}

export function extractSeriesInfoFromText(
  fileName: string,
  caption?: string
): ExtractedSeriesInfo {
  const capLines = String(caption || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const firstCap = capLines[0] || '';
  const fromCap = firstCap ? parseSingleSeriesCandidate(firstCap) : null;
  const fromFile = parseSingleSeriesCandidate(fileName);

  const chosenSerieName =
    (fromCap && !isGenericOrInvalidSerieName(fromCap.serieName) ? fromCap.serieName : '') ||
    (!isGenericOrInvalidSerieName(fromFile.serieName) ? fromFile.serieName : '');

  const hasExplicitNumbers = Boolean(fromCap?.hasExplicitNumbers || fromFile.hasExplicitNumbers);
  const temporada = fromCap?.hasExplicitNumbers
    ? fromCap.temporada
    : fromFile.hasExplicitNumbers
      ? fromFile.temporada
      : '1';
  const numero = fromCap?.hasExplicitNumbers
    ? fromCap.numero
    : fromFile.hasExplicitNumbers
      ? fromFile.numero
      : '1';
  const episodeSubtitle = fromCap?.episodeSubtitle || fromFile.episodeSubtitle;

  return {
    serieName: chosenSerieName || 'Serie',
    temporada,
    numero,
    ...(episodeSubtitle ? { episodeSubtitle } : {}),
    missingSerieName: isGenericOrInvalidSerieName(chosenSerieName),
    hasExplicitNumbers,
  };
}

export function splitCaptionIntoTitleAndSynopsis(caption: string): {
  title: string;
  synopsis: string;
} {
  const lines = String(caption || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { title: '', synopsis: '' };
  if (lines.length === 1) {
    const line = lines[0];
    if (line.length > 90) {
      return { title: '', synopsis: line };
    }
    return { title: cleanGeneralVideoTitle(line), synopsis: '' };
  }
  return {
    title: cleanGeneralVideoTitle(lines[0]),
    synopsis: lines.slice(1).join(' ').trim(),
  };
}

export function analyzeVideoTitleAndSynopsis(
  fileName: string,
  caption?: string
): {
  initialTitle: string;
  initialSynopsis: string;
  filenameIsRandom: boolean;
  needsManualTitle: boolean;
  titleSource: 'caption' | 'filename' | 'none';
  episodeSubtitle?: string;
  seriesInfo: ExtractedSeriesInfo;
} {
  const capSplit = splitCaptionIntoTitleAndSynopsis(caption || '');
  const cleanFileTitle = cleanGeneralVideoTitle(fileName);
  const filenameIsRandom = isRandomOrCrypticFilename(fileName);
  const seriesInfo = extractSeriesInfoFromText(fileName, caption);

  const hasCaptionTitle = Boolean(capSplit.title && !isRandomOrCrypticFilename(capSplit.title));
  let initialTitle = '';
  let titleSource: 'caption' | 'filename' | 'none' = 'none';

  if (hasCaptionTitle) {
    initialTitle = capSplit.title;
    titleSource = 'caption';
  } else if (!filenameIsRandom && cleanFileTitle) {
    initialTitle = cleanFileTitle;
    titleSource = 'filename';
  }

  const needsManualTitle = !initialTitle;
  if (!initialTitle) {
    initialTitle = 'Pendiente de elección...';
  }

  return {
    initialTitle,
    initialSynopsis: capSplit.synopsis || '',
    filenameIsRandom,
    needsManualTitle,
    titleSource,
    ...(seriesInfo.episodeSubtitle ? { episodeSubtitle: seriesInfo.episodeSubtitle } : {}),
    seriesInfo,
  };
}

export function detectDominantSeriesTitleStyle(
  chapterTitles: string[],
  _serieName?: string
): DetectedSeriesTitleStyle | null {
  if (!chapterTitles || chapterTitles.length === 0) return null;
  let txCap = 0;
  let sxe = 0;
  let tempCap = 0;
  let capOnly = 0;
  let padded = 0;
  let withSub = 0;

  for (const t of chapterTitles) {
    const title = String(t || '').trim();
    if (/T\d+\s*Cap\.?\s*\d+/i.test(title)) {
      txCap++;
      if (/Cap\.?\s*0\d/i.test(title)) padded++;
    } else if (/S\d{1,2}E\d{1,3}/i.test(title)) {
      sxe++;
      if (/E0\d/i.test(title)) padded++;
    } else if (/Temporada\s*\d+.*Cap[íi]tulo\s*\d+/i.test(title)) {
      tempCap++;
    } else if (/Cap[íi]tulo\s*\d+/i.test(title)) {
      capOnly++;
    }
    if (/[·\-:]/.test(title)) withSub++;
  }

  const max = Math.max(txCap, sxe, tempCap, capOnly);
  if (max === 0) return null;
  const pattern: DetectedSeriesTitleStyle['pattern'] =
    sxe === max
      ? 'sxe'
      : tempCap === max
        ? 'temporada_cap'
        : capOnly === max
          ? 'cap_only'
          : 'tx_capx';

  const padEp = padded > chapterTitles.length / 2;
  const includeSubtitle = withSub >= Math.max(1, Math.floor(chapterTitles.length / 2));
  const descriptionMap: Record<DetectedSeriesTitleStyle['pattern'], string> = {
    tx_capx: padEp ? 'Nombre T1 Cap. 01' : 'Nombre T1 Cap. 1',
    sxe: 'Nombre S01E01',
    temporada_cap: 'Nombre Temporada 1 Capítulo 1',
    cap_only: 'Nombre Capítulo 1',
  };

  return {
    pattern,
    padEp,
    includeSubtitle,
    separator: ' · ',
    sampleCount: chapterTitles.length,
    sampleTitle: String(chapterTitles[0] || '').trim(),
    description: descriptionMap[pattern],
  };
}

export function formatEpisodeWithSeriesStyle(
  style: DetectedSeriesTitleStyle,
  params: {
    serieName: string;
    temporada: string | number;
    numero: string | number;
    episodeSubtitle?: string;
  }
): string {
  const name = String(params.serieName || 'Serie').trim();
  const tempNum = Number(String(params.temporada || '1').replace(/\D/g, '') || 1);
  const epNum = Number(String(params.numero || '1').replace(/\D/g, '') || 1);
  const tempPad = String(tempNum).padStart(2, '0');
  const epStr = style.padEp ? String(epNum).padStart(2, '0') : String(epNum);

  let base = `${name} T${tempNum} Cap. ${epStr}`;
  if (style.pattern === 'sxe') {
    base = `${name} S${tempPad}E${String(epNum).padStart(2, '0')}`;
  } else if (style.pattern === 'temporada_cap') {
    base = `${name} Temporada ${tempNum} Capítulo ${epStr}`;
  } else if (style.pattern === 'cap_only') {
    base = `${name} Capítulo ${epStr}`;
  }

  const sub = String(params.episodeSubtitle || '').trim();
  if (sub && style.includeSubtitle !== false) {
    return `${base}${style.separator || ' · '}${sub}`;
  }
  return base;
}

export function buildSerieTitleOptions(params: {
  serieName: string;
  temporada: string;
  numero: string;
  episodeSubtitle?: string;
  rawCaption?: string;
  inheritedStyle?: DetectedSeriesTitleStyle | null;
}): Array<{ label: string; buttonLabel: string; title: string }> {
  const cleanName = String(params.serieName || 'Serie').trim() || 'Serie';
  const temp = Number(String(params.temporada || '1').replace(/\D/g, '') || 1);
  const ep = Number(String(params.numero || '1').replace(/\D/g, '') || 1);
  const epPad = String(ep).padStart(2, '0');
  const tempPad = String(temp).padStart(2, '0');
  const sub = String(params.episodeSubtitle || '').trim();

  const candidates: Array<{ label: string; buttonLabel: string; title: string }> = [];
  if (params.inheritedStyle) {
    const styled = formatEpisodeWithSeriesStyle(params.inheritedStyle, {
      serieName: cleanName,
      temporada: temp,
      numero: ep,
      episodeSubtitle: sub,
    });
    candidates.push({
      label: `Estilo de la serie: ${styled}`,
      buttonLabel: `🎨 ${styled.slice(0, 44)}`,
      title: styled,
    });
  }

  const txCap = `${cleanName} T${temp} Cap. ${ep}${sub ? ` · ${sub}` : ''}`;
  const sxe = `${cleanName} S${tempPad}E${epPad}${sub ? ` · ${sub}` : ''}`;
  const fullEs = `${cleanName} · Temporada ${temp} Capítulo ${ep}`;

  for (const item of [
    { label: `Estándar (${txCap})`, buttonLabel: `📌 ${txCap.slice(0, 44)}`, title: txCap },
    { label: `Internacional (${sxe})`, buttonLabel: `🌐 ${sxe.slice(0, 44)}`, title: sxe },
    { label: `Descriptivo (${fullEs})`, buttonLabel: `📝 ${fullEs.slice(0, 44)}`, title: fullEs },
  ]) {
    if (!candidates.some((c) => c.title.toLowerCase() === item.title.toLowerCase())) {
      candidates.push(item);
    }
  }

  return candidates.slice(0, 4);
}

export function isStaleOrGenericSerieSynopsis(
  synopsis?: string | null,
  rawCaption?: string | null,
  expectedEpNum?: string | number
): boolean {
  const s = String(synopsis || '').trim();
  if (!s || s.length < 24) return true;
  const lower = s.toLowerCase();
  if (
    lower.includes('disponible en el canal') ||
    lower.includes('video publicado automáticamente') ||
    lower.includes('sin sinopsis') ||
    lower.startsWith('pendiente')
  ) {
    return true;
  }
  if (rawCaption && s === String(rawCaption).trim() && s.length < 55) {
    return true;
  }
  const epStr = String(expectedEpNum || '').replace(/\D/g, '');
  if (epStr) {
    const m = s.match(/\b(?:cap[íi]tulo|episodio)\s*(\d+)\b/i);
    if (m && m[1] !== epStr && lower.includes('de la temporada')) {
      return true;
    }
  }
  return false;
}
