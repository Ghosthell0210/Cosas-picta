export interface PictaPlaylistRecord {
  id: number;
  nombre: string;
  publicado: boolean;
  descarga: boolean;
  fecha_creacion?: string;
  canalId: number;
  canalNombre: string;
  publicacionesIds: number[];
}

export interface PictaCommentRecord {
  id: number;
  texto: string;
  usuario: string;
  usuarioId?: number;
  fecha: string;
  publicacionId: number;
  publicacionNombre: string;
  tipologiaId?: number;
  categoriaNombre?: string;
  parentId?: number;
  replyCount?: number;
  answered?: boolean;
}

export interface PictaDenunciaSummary {
  cantidad_pendientes: number;
  cantidad_en_proceso: number;
  cantidad_no_proceden: number;
  cantidad_procesadas: number;
  total: number;
}

export function filterChannelPlaylists(
  records: any[],
  channelId: string | number
): PictaPlaylistRecord[] {
  const targetId = Number(channelId || 0);
  const out: PictaPlaylistRecord[] = [];
  for (const item of records || []) {
    if (!item || typeof item !== 'object') continue;
    const cId = Number(
      typeof item.canal === 'object' ? item.canal?.id : item.canal_id ?? item.canal ?? 0
    );
    if (targetId > 0 && cId > 0 && cId !== targetId) continue;
    const pubsRaw = Array.isArray(item.publicaciones) ? item.publicaciones : [];
    const pubsIds = pubsRaw
      .map((p: any) => Number(typeof p === 'object' ? p?.id : p))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    out.push({
      id: Number(item.id || 0),
      nombre: String(item.nombre || `Lista #${item.id}`).trim(),
      publicado: item.publicado !== false,
      descarga: Boolean(item.descarga),
      ...(item.fecha_creacion ? { fecha_creacion: String(item.fecha_creacion) } : {}),
      canalId: cId || targetId,
      canalNombre: String(
        typeof item.canal === 'object' ? item.canal?.nombre || '' : item.canal_nombre || ''
      ).trim(),
      publicacionesIds: pubsIds,
    });
  }
  return out;
}

export interface CommentPublicationMeta {
  nombre?: string;
  tipologiaId?: number;
  categoriaNombre?: string;
}

export function filterChannelComments(
  records: any[],
  channelId: string | number,
  pubIdFilter?: number,
  pubMetaMap?: Map<number, CommentPublicationMeta>
): PictaCommentRecord[] {
  const targetChan = Number(channelId || 0);
  const out: PictaCommentRecord[] = [];
  const seenIds = new Set<number>();

  const pushNormalizedItem = (item: any, forcedParentId?: number, inheritedPubObj?: any) => {
    if (!item || typeof item !== 'object') return;
    const id = Number(item.id || 0);
    if (!id || seenIds.has(id)) return;

    const pubObj =
      typeof item.publicacion === 'object' && item.publicacion
        ? item.publicacion
        : inheritedPubObj || null;
    const pubId = Number(pubObj?.id ?? item.publicacion_id ?? item.publicacion ?? 0);
    if (pubIdFilter && pubId && pubId !== Number(pubIdFilter)) return;

    const commentChanId = Number(
      typeof pubObj?.canal === 'object'
        ? pubObj.canal?.id
        : pubObj?.canal_id ?? pubObj?.canal ?? item.canal_id ?? item.canal ?? 0
    );
    if (targetChan > 0 && commentChanId > 0 && commentChanId !== targetChan) return;

    seenIds.add(id);
    const userObj = typeof item.usuario === 'object' && item.usuario ? item.usuario : null;
    const usuario = String(
      userObj?.username || userObj?.nombre || item.usuario_username || item.usuario || 'Usuario'
    ).trim();

    const metaFromMap = pubId && pubMetaMap ? pubMetaMap.get(pubId) : undefined;
    const rawCatObj = pubObj?.categoria;
    const rawTipObj = rawCatObj?.tipologia || pubObj?.tipologia;
    const tipologiaId = Number(rawTipObj?.id || metaFromMap?.tipologiaId || 0) || undefined;
    const categoriaNombre = String(
      rawTipObj?.nombre ||
        rawCatObj?.nombre ||
        metaFromMap?.categoriaNombre ||
        'Otros'
    ).trim();

    const parentRaw =
      forcedParentId ||
      item.comentario_padre?.id ||
      item.comentario_padre ||
      item.parent_id ||
      item.padre_id ||
      0;
    const parentId = Number(parentRaw) > 0 ? Number(parentRaw) : undefined;

    out.push({
      id,
      texto: String(item.texto || item.comentario || item.contenido || '').trim(),
      usuario,
      usuarioId: userObj?.id ? Number(userObj.id) : item.usuario_id ? Number(item.usuario_id) : undefined,
      fecha: String(item.fecha || item.created_at || item.creado || ''),
      publicacionId: pubId,
      publicacionNombre: String(
        pubObj?.nombre ||
          metaFromMap?.nombre ||
          item.publicacion_nombre ||
          (pubId ? `Video #${pubId}` : 'Video')
      ).trim(),
      ...(tipologiaId ? { tipologiaId } : {}),
      categoriaNombre: categoriaNombre || 'Otros',
      ...(parentId ? { parentId } : {}),
    });

    const nestedReplies = Array.isArray(item.respuestas)
      ? item.respuestas
      : Array.isArray(item.replies)
        ? item.replies
        : [];
    for (const rep of nestedReplies) {
      pushNormalizedItem(rep, id, pubObj);
    }
  };

  for (const item of records || []) {
    pushNormalizedItem(item);
  }

  // Compute reply counts for root comments
  const replyCountByParent = new Map<number, number>();
  for (const c of out) {
    if (c.parentId) {
      replyCountByParent.set(c.parentId, (replyCountByParent.get(c.parentId) || 0) + 1);
    }
  }
  for (const c of out) {
    const rCount = replyCountByParent.get(c.id) || 0;
    c.replyCount = rCount;
    c.answered = Boolean(c.parentId) || rCount > 0;
  }

  // Sort newest-first by fecha, fallback to id desc
  out.sort((a, b) => {
    const tA = a.fecha ? new Date(a.fecha).getTime() : 0;
    const tB = b.fecha ? new Date(b.fecha).getTime() : 0;
    const validA = Number.isFinite(tA) && tA > 0 ? tA : 0;
    const validB = Number.isFinite(tB) && tB > 0 ? tB : 0;
    if (validB !== validA) return validB - validA;
    return b.id - a.id;
  });

  return out;
}

export function computeUpdatedChannelCollaborators(
  currentAssocRaw: unknown[],
  ownerId: number,
  targetUserId: number,
  action: 'add' | 'remove'
): number[] {
  const set = new Set<number>();
  if (ownerId > 0) set.add(Number(ownerId));
  for (const raw of currentAssocRaw || []) {
    const id = Number(typeof raw === 'object' && raw ? (raw as any).id : raw);
    if (Number.isFinite(id) && id > 0) set.add(id);
  }
  if (targetUserId > 0) {
    if (action === 'add') {
      set.add(Number(targetUserId));
    } else if (action === 'remove' && Number(targetUserId) !== Number(ownerId)) {
      set.delete(Number(targetUserId));
    }
  }
  return Array.from(set);
}

export function extractPictaPublicationLinks(pub: Record<string, any>): {
  webUrl: string;
  directStreamUrl?: string;
  downloadUrl?: string;
  coverUrl?: string;
} {
  const id = Number(pub?.id || 0);
  const slug = String(pub?.slug_url || '').trim();
  const webUrl = slug
    ? `https://www.picta.cu/medias/${slug.replace(/^\/+/, '')}`
    : `https://www.picta.cu/medias/${id}`;
  const directStreamUrl =
    String(pub?.url_manifiesto || pub?.url_hls || pub?.manifest_url || '').trim() || undefined;
  const downloadUrl =
    String(pub?.url_descarga || pub?.download_url || '').trim() || undefined;
  const coverUrl =
    String(pub?.url_imagen || pub?.imagen_secundaria || '').trim() || undefined;
  return {
    webUrl,
    ...(directStreamUrl ? { directStreamUrl } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(coverUrl ? { coverUrl } : {}),
  };
}

export function normalizeDenunciaCounts(raw: Record<string, any> | null | undefined): PictaDenunciaSummary {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pendientes = Number(src.cantidad_pendientes ?? src.pendientes ?? 0) || 0;
  const enProceso = Number(src.cantidad_en_proceso ?? src.en_proceso ?? 0) || 0;
  const noProceden = Number(src.cantidad_no_proceden ?? src.no_proceden ?? 0) || 0;
  const procesadas = Number(src.cantidad_procesadas ?? src.procesadas ?? 0) || 0;
  const total = Number(src.total ?? pendientes + enProceso + noProceden + procesadas) || 0;
  return {
    cantidad_pendientes: pendientes,
    cantidad_en_proceso: enProceso,
    cantidad_no_proceden: noProceden,
    cantidad_procesadas: procesadas,
    total,
  };
}
