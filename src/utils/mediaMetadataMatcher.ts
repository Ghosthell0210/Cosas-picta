export interface MediaMatchCandidate {
  id: string;
  source: 'tmdb' | 'imdb' | 'tvmaze' | 'wikipedia' | string;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  year?: string;
  overview?: string;
  popularity?: number;
  score: number;
  imageUrl?: string;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: string;
  tmdbId?: number;
  imdbId?: string;
}

export interface CandidateDisambiguationResult {
  confidentWinner: MediaMatchCandidate | null;
  topCandidates: MediaMatchCandidate[];
  needsDisambiguation: boolean;
}

function normalizeCmp(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLikelyEnglishText(text?: string | null): boolean {
  const t = String(text || '').trim();
  if (!t || t.length < 15) return false;
  const lower = ` ${t.toLowerCase()} `;
  const englishStopwords = [
    ' the ', ' and ', ' with ', ' from ', ' that ', ' this ', ' when ', ' into ', ' their ', ' where ', ' his ', ' her ', ' they ', ' after ', ' before ', ' which ',
  ];
  const spanishStopwords = [
    ' el ', ' la ', ' los ', ' las ', ' una ', ' uno ', ' con ', ' para ', ' por ', ' sobre ', ' entre ', ' cuando ', ' donde ', ' después ', ' antes ', ' su ', ' sus ', ' del ', ' al ',
  ];
  let enHits = 0;
  let esHits = 0;
  for (const w of englishStopwords) if (lower.includes(w)) enHits++;
  for (const w of spanishStopwords) if (lower.includes(w)) esHits++;
  if (/[áéíóúñü¿¡]/i.test(t) && esHits >= enHits) return false;
  return enHits >= 2 && enHits > esHits;
}

export function cleanMediaTitleForSearch(rawQuery: string): {
  cleanQuery: string;
  simplifiedTitle: string;
  franchise?: string;
  subtitleQuery?: string;
  year?: string;
} {
  let raw = String(rawQuery || '').trim();
  const yearMatch = raw.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : undefined;

  raw = raw
    .replace(/\.(mp4|mkv|avi|mov|webm|flv|wmv|ts|m4v|srt|vtt)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:1080p|720p|480p|2160p|4k|hd|bluray|web-?dl|webrip|hdrip|dvdrip|x264|x265|hevc|aac|latino|español|espanol|subtitulado|dual|castellano)\)/gi, ' ')
    .replace(/\b(?:1080p|720p|480p|2160p|4k|uhd|hdr|bluray|bdrip|brrip|web-?dl|webrip|hdrip|dvdrip|camrip|x264|x265|h264|h265|hevc|aac|ac3|dts|latino|castellano|subtitulado|dual|vose)\b/gi, ' ')
    .replace(/\bS\d{1,2}E\d{1,3}\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
    .replace(/\b(?:temporada|season|cap[íi]tulo|episodio|episode|ep|cap)\s*\d+\b/gi, ' ');

  if (year) {
    raw = raw.replace(new RegExp(`\\(?\\b${year}\\b\\)?`, 'g'), ' ');
  }

  const cleanQuery = raw.replace(/\s+/g, ' ').replace(/[-:|\s]+$/g, '').trim();
  let subtitleQuery: string | undefined;
  let franchise: string | undefined;
  let simplifiedTitle = cleanQuery;
  const colonSplit = cleanQuery.split(/[:\-–—]/);
  if (colonSplit.length >= 2 && colonSplit[0].trim().length >= 3) {
    simplifiedTitle = colonSplit[0].trim();
    franchise = simplifiedTitle;
    const rest = colonSplit.slice(1).join(' ').trim();
    if (rest.length >= 3) subtitleQuery = rest;
  }

  return {
    cleanQuery,
    simplifiedTitle,
    ...(franchise ? { franchise } : {}),
    ...(subtitleQuery ? { subtitleQuery } : {}),
    ...(year ? { year } : {}),
  };
}

export function isTitleMatchStrict(query: string, candidateTitle: string, originalTitle?: string): boolean {
  const nq = normalizeCmp(query);
  if (!nq) return false;
  const titles = [normalizeCmp(candidateTitle), normalizeCmp(originalTitle || '')].filter(Boolean);
  for (const nt of titles) {
    if (nt === nq) return true;
    if (nt.includes(nq) || nq.includes(nt)) {
      const qWords = nq.split(' ').filter(Boolean);
      const tWords = nt.split(' ').filter(Boolean);
      const overlap = qWords.filter((w) => tWords.includes(w)).length;
      if (overlap >= Math.max(1, Math.ceil(Math.min(qWords.length, tWords.length) * 0.7))) {
        return true;
      }
    }
  }
  return false;
}

export function scoreCandidateMatch(
  cleanQuery: string,
  candidateTitle: string,
  originalTitle = '',
  candidateYear?: string,
  targetYear?: string,
  subtitleQuery?: string,
  popularity = 0
): number {
  const nq = normalizeCmp(cleanQuery);
  const nt = normalizeCmp(candidateTitle);
  const no = normalizeCmp(originalTitle);
  if (!nq || (!nt && !no)) return 0;

  let bestTextScore = 0;
  for (const target of [nt, no].filter(Boolean)) {
    if (target === nq) {
      bestTextScore = Math.max(bestTextScore, 95);
    } else if (target.startsWith(nq) || nq.startsWith(target)) {
      bestTextScore = Math.max(bestTextScore, 75);
    } else {
      const qWords = nq.split(' ').filter((w) => w.length > 1);
      const tWords = target.split(' ').filter((w) => w.length > 1);
      if (qWords.length > 0 && tWords.length > 0) {
        const hits = qWords.filter((w) => tWords.includes(w)).length;
        const ratio = hits / Math.max(qWords.length, tWords.length);
        bestTextScore = Math.max(bestTextScore, Math.round(ratio * 70));
      }
    }
  }

  if (subtitleQuery) {
    const ns = normalizeCmp(subtitleQuery);
    if (ns && (nt.includes(ns) || no.includes(ns))) {
      bestTextScore += 10;
    }
  }

  if (targetYear && candidateYear) {
    if (String(targetYear) === String(candidateYear)) {
      bestTextScore += 15;
    } else {
      bestTextScore -= 12;
    }
  }

  if (popularity > 0) {
    bestTextScore += Math.min(8, Math.log10(popularity + 1) * 2.5);
  }

  return Math.max(0, Math.round(bestTextScore));
}

export function decideBestOrTop3Candidates(
  cleanQuery: string,
  candidates: MediaMatchCandidate[],
  releaseYear?: string
): CandidateDisambiguationResult {
  if (!candidates || candidates.length === 0) {
    return { confidentWinner: null, topCandidates: [], needsDisambiguation: false };
  }

  const deduped: MediaMatchCandidate[] = [];
  const seenKeys = new Set<string>();
  const sorted = [...candidates].sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const c of sorted) {
    const key = `${normalizeCmp(c.title)}:${c.mediaType}:${c.year || ''}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(c);
  }

  const top3 = deduped.slice(0, 3);
  const first = top3[0];
  const second = top3[1];

  const exact = isTitleMatchStrict(cleanQuery, first.title, first.originalTitle);
  const yearMatches = !releaseYear || !first.year || String(first.year) === String(releaseYear);
  const strongLead = !second || first.score - second.score >= 12 || (exact && yearMatches && first.score >= 85);

  if (first.score >= 70 && strongLead) {
    return {
      confidentWinner: first,
      topCandidates: top3,
      needsDisambiguation: false,
    };
  }

  return {
    confidentWinner: top3.length === 1 ? first : null,
    topCandidates: top3,
    needsDisambiguation: top3.length > 1,
  };
}
