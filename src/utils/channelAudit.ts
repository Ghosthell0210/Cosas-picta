export interface ChannelPublicationRecord {
  id: number;
  nombre?: string;
  descripcion?: string;
  publicado?: boolean;
  estado?: string;
  tamanio?: number;
  duracion?: number;
  cantidad_visitas?: number;
  cantidad_me_gusta?: number;
  fecha_creacion?: string;
  slug_url?: string;
  url_imagen?: string;
  url_imagen_resized?: string;
  palabras_clave?: any[];
  categoria?: {
    id?: number;
    nombre?: string;
    tipologia?: {
      id?: number;
      nombre?: string;
    };
  };
  pelicula_serie?: any;
  serie?: any;
  serie_id?: any;
  temporada?: any;
  [key: string]: any;
}

export interface ChannelAuditPubItem {
  id: number;
  nombre: string;
  categoriaNombre: string;
  tipologiaId: number;
  views: number;
  likes: number;
  tamanio: number;
  duracion: number;
  publicado: boolean;
  estado: string;
  fecha: string;
  slugUrl?: string;
  issueSummary: string;
}

export interface ChannelAuditDuplicateGroup {
  groupKey: string;
  reason: string;
  items: ChannelAuditPubItem[];
}

export interface ChannelAuditReport {
  totalScanned: number;
  duplicateGroups: ChannelAuditDuplicateGroup[];
  duplicateItems: ChannelAuditPubItem[];
  incompleteItems: ChannelAuditPubItem[];
  unpublishedItems: ChannelAuditPubItem[];
  orphanEpisodeItems: ChannelAuditPubItem[];
  generatedAt: string;
}

const EPISODE_PATTERN_REGEX =
  /(?:\bs\d{1,2}\s*e\d{1,3}\b|\b\d{1,2}x\d{1,3}\b|\b(?:cap[ií]tulo|episodio|ep\.?)\s*#?\d{1,3}\b|\btemporada\s*\d+\b)/i;

export function normalizeAuditTitle(rawTitle: string): string {
  return String(rawTitle || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i, '')
    .replace(
      /\b(?:1080p|720p|480p|360p|2160p|4k|hdrip|webrip|web-dl|bluray|brrip|x264|x265|hevc|aac|ac3|dual|latino|espanol|castellano|subtitulada|sub|hd)\b/gi,
      ' '
    )
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAuditItem(pub: ChannelPublicationRecord, issueSummary: string): ChannelAuditPubItem {
  const tipId = Number(pub.categoria?.tipologia?.id || pub.categoria?.id || 8);
  const catName = String(
    pub.categoria?.tipologia?.nombre || pub.categoria?.nombre || 'Audiovisual'
  ).trim();
  return {
    id: Number(pub.id || 0),
    nombre: String(pub.nombre || `Video #${pub.id}`).trim(),
    categoriaNombre: catName || 'Audiovisual',
    tipologiaId: tipId,
    views: Number(pub.cantidad_visitas || 0),
    likes: Number(pub.cantidad_me_gusta || 0),
    tamanio: Number(pub.tamanio || 0),
    duracion: Number(pub.duracion || 0),
    publicado: pub.publicado !== false,
    estado: String(pub.estado || ''),
    fecha: String(pub.fecha_creacion || ''),
    slugUrl: pub.slug_url,
    issueSummary,
  };
}

export function buildChannelAuditReport(
  publications: ChannelPublicationRecord[]
): ChannelAuditReport {
  const list = Array.isArray(publications) ? publications : [];
  const byTitleMap = new Map<string, ChannelPublicationRecord[]>();
  const bySizeDurMap = new Map<string, ChannelPublicationRecord[]>();

  const incompleteItems: ChannelAuditPubItem[] = [];
  const unpublishedItems: ChannelAuditPubItem[] = [];
  const orphanEpisodeItems: ChannelAuditPubItem[] = [];

  for (const pub of list) {
    if (!pub || !pub.id) continue;

    // 1. Group candidates for duplicate detection
    const normTitle = normalizeAuditTitle(pub.nombre || '');
    if (normTitle.length >= 3) {
      const arr = byTitleMap.get(normTitle) || [];
      arr.push(pub);
      byTitleMap.set(normTitle, arr);
    }

    const size = Number(pub.tamanio || 0);
    const dur = Number(pub.duracion || 0);
    if (size > 2 * 1024 * 1024 && dur > 30) {
      const sig = `${size}:${Math.round(dur)}`;
      const arr = bySizeDurMap.get(sig) || [];
      arr.push(pub);
      bySizeDurMap.set(sig, arr);
    }

    // 2. Unpublished / pending moderation / failed / processing check
    const rawPubAny: any = pub;
    const stateStr = String(pub.estado || '').trim();
    const stateLower = stateStr.toLowerCase();
    const rejectReason = String(
      rawPubAny.motivo_rechazo || rawPubAny.rechazo || rawPubAny.razon_rechazo || ''
    ).trim();
    const hasPublishedDate = Boolean(rawPubAny.fecha_publicado);
    const isConverted = rawPubAny.convertido !== false;

    const isHidden =
      pub.publicado === false ||
      stateLower.includes('error') ||
      stateLower.includes('fail') ||
      stateLower.includes('pend') ||
      stateLower.includes('rechaz') ||
      stateLower.includes('ocult') ||
      stateLower.includes('elimin');
    if (isHidden) {
      let reason = 'No publicado';
      if (rejectReason) {
        reason = `No aprobado (${rejectReason.slice(0, 60)})`;
      } else if (stateLower.includes('rechaz')) {
        reason = `No aprobado en moderación (${stateStr})`;
      } else if (stateLower.includes('error') || stateLower.includes('fail')) {
        reason = `Error de procesamiento (${stateStr})`;
      } else if (!isConverted) {
        reason = 'Sin convertir en Nomad / Sin aprobar';
      } else if (pub.publicado === false && !hasPublishedDate) {
        reason = 'Nunca publicado / Sin aprobación de Picta';
      } else if (pub.publicado === false) {
        reason = 'Oculto manualmente en tu canal';
      } else if (stateStr) {
        reason = `Estado: ${stateStr}`;
      }
      unpublishedItems.push(toAuditItem(pub, reason));
    }

    // 3. Incomplete metadata check (cover, description, tags)
    const missingCover =
      !String(pub.url_imagen || '').trim() && !String(pub.url_imagen_resized || '').trim();
    const descLen = String(pub.descripcion || '').trim().length;
    const missingDesc = descLen < 12;
    const missingTags = !Array.isArray(pub.palabras_clave) || pub.palabras_clave.length === 0;
    if (missingCover || missingDesc || missingTags) {
      const missingParts: string[] = [];
      if (missingCover) missingParts.push('Sin portada');
      if (missingDesc) missingParts.push('Sin sinopsis');
      if (missingTags) missingParts.push('Sin etiquetas');
      incompleteItems.push(toAuditItem(pub, missingParts.join(' · ')));
    }

    // 4. Orphan episodes check
    const rawPub: any = pub;
    const hasLinkedSerie = Boolean(
      rawPub.pelicula_serie ||
        rawPub.serie ||
        rawPub.serie_id ||
        Number(pub.categoria?.tipologia?.id || 0) === 5
    );
    const looksLikeEpisode = EPISODE_PATTERN_REGEX.test(String(pub.nombre || ''));
    if (looksLikeEpisode && !hasLinkedSerie) {
      orphanEpisodeItems.push(
        toAuditItem(pub, 'Parece capítulo de serie pero está en otra categoría sin vincular')
      );
    } else if (
      Number(pub.categoria?.tipologia?.id || 0) === 5 &&
      !rawPub.pelicula_serie &&
      !rawPub.serie &&
      !rawPub.temporada
    ) {
      orphanEpisodeItems.push(
        toAuditItem(pub, 'Categoría Serie sin serie/temporada vinculada')
      );
    }
  }

  // Merge duplicate groups without repeating identical ID sets
  const seenGroupSignatures = new Set<string>();
  const duplicateGroups: ChannelAuditDuplicateGroup[] = [];
  const duplicateItemIds = new Set<number>();
  const duplicateItems: ChannelAuditPubItem[] = [];

  const registerGroup = (groupKey: string, reason: string, pubs: ChannelPublicationRecord[]) => {
    if (pubs.length < 2) return;
    const sorted = [...pubs].sort((a, b) => Number(a.id) - Number(b.id));
    const sig = sorted.map((p) => p.id).join(',');
    if (seenGroupSignatures.has(sig)) return;
    seenGroupSignatures.add(sig);

    const mapped = sorted.map((p) => toAuditItem(p, reason));
    duplicateGroups.push({
      groupKey,
      reason,
      items: mapped,
    });
    for (const item of mapped) {
      if (!duplicateItemIds.has(item.id)) {
        duplicateItemIds.add(item.id);
        duplicateItems.push(item);
      }
    }
  };

  for (const [normTitle, pubs] of byTitleMap.entries()) {
    if (pubs.length >= 2) {
      registerGroup(`title:${normTitle}`, `Título repetido (${pubs.length} copias)`, pubs);
    }
  }
  for (const [sig, pubs] of bySizeDurMap.entries()) {
    if (pubs.length >= 2) {
      registerGroup(`file:${sig}`, `Mismo peso y duración (${pubs.length} archivos)`, pubs);
    }
  }

  return {
    totalScanned: list.length,
    duplicateGroups,
    duplicateItems,
    incompleteItems,
    unpublishedItems,
    orphanEpisodeItems,
    generatedAt: new Date().toISOString(),
  };
}
