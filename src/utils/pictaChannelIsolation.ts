export const PICTA_CHANNEL_CLASIFICACIONES: string[] = [
  'TP',
  '+12',
  '+16',
  '18+',
  'Todos',
];

export interface PictaChannelDetails {
  id: number;
  nombre: string;
  alias: string;
  descripcion: string;
  clasificacion: string;
  slug_url?: string;
  visible: boolean;
  publicado: boolean;
  recibir_donacion: boolean;
  donacion: boolean;
  cantidad_suscriptores: number;
  cantidad_publicaciones: number;
  url_avatar?: string;
  url_imagen?: string;
}

export interface PictaUserOwnershipIdentity {
  userId?: number;
  username?: string;
  phone?: string;
  fullName?: string;
  email?: string;
}

export function isMasterAdminChat(chatId?: string | null): boolean {
  const clean = String(chatId || '').trim();
  return clean === '1981484200';
}

export function extractPictaEntityId(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const m = trimmed.match(/\/(\d+)\/?$/);
    if (m) return Number(m[1]);
    return 0;
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return extractPictaEntityId(obj.id ?? obj.pk ?? obj.canal_id ?? obj.channel_id ?? obj.user_id);
  }
  return 0;
}

function normalizeOwnerToken(val: unknown): string {
  return String(val || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function normalizeOwnershipIdentity(
  userIdOrIdentity?: number | PictaUserOwnershipIdentity
): { userId: number; tokens: Set<string>; phone8: string } {
  const tokens = new Set<string>();
  let userId = 0;
  let phone8 = '';

  const addToken = (raw?: unknown) => {
    const t = normalizeOwnerToken(raw);
    if (t && t.length >= 3 && !/^\d+$/.test(t)) {
      tokens.add(t);
    }
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length >= 8) {
      const tail8 = digits.slice(-8);
      if (!phone8) phone8 = tail8;
      tokens.add(`+53${tail8}`);
      tokens.add(`53${tail8}`);
      tokens.add(tail8);
    }
  };

  if (typeof userIdOrIdentity === 'number') {
    userId = Number.isFinite(userIdOrIdentity) && userIdOrIdentity > 0 ? Math.trunc(userIdOrIdentity) : 0;
  } else if (userIdOrIdentity && typeof userIdOrIdentity === 'object') {
    if (userIdOrIdentity.userId && userIdOrIdentity.userId > 0) {
      userId = Math.trunc(userIdOrIdentity.userId);
    }
    addToken(userIdOrIdentity.username);
    addToken(userIdOrIdentity.phone);
    addToken(userIdOrIdentity.email);
  }

  return { userId, tokens, phone8 };
}

function candidateMatchesOwnerIdentity(
  cand: unknown,
  norm: { userId: number; tokens: Set<string>; phone8: string }
): boolean {
  if (cand === undefined || cand === null || cand === '') return false;
  const cid = extractPictaEntityId(cand);
  if (norm.userId > 0 && cid > 0 && cid === norm.userId) {
    return true;
  }

  if (norm.tokens.size > 0 || norm.phone8) {
    const strFields: unknown[] = [];
    if (typeof cand === 'string') {
      strFields.push(cand);
    } else if (typeof cand === 'object') {
      const obj = cand as Record<string, unknown>;
      strFields.push(
        obj.username,
        obj.user_name,
        obj.phone_number,
        obj.telefono,
        obj.email,
        obj.slug
      );
    }
    for (const rawField of strFields) {
      const t = normalizeOwnerToken(rawField);
      if (t && norm.tokens.has(t)) return true;
      const digits = String(rawField || '').replace(/\D/g, '');
      if (norm.phone8 && digits.length >= 8 && digits.slice(-8) === norm.phone8) {
        return true;
      }
    }
  }

  return false;
}

export function isChannelOwnedOrAssociatedByUser(
  record: Record<string, unknown> | null | undefined,
  userIdOrIdentity?: number | PictaUserOwnershipIdentity
): boolean | null {
  if (!record || typeof record !== 'object') return null;
  const norm = normalizeOwnershipIdentity(userIdOrIdentity);
  if (!norm.userId && norm.tokens.size === 0) return null;

  const ownerCandidates = [
    record.propietario,
    record.propietario_id,
    record.usuario,
    record.usuario_id,
    record.owner,
    record.owner_id,
    record.user,
    record.user_id,
    record.creador,
    record.creador_id,
    record.usuario_creador,
    record.admin,
    record.admin_id,
  ];
  let sawOwnershipField = false;

  for (const cand of ownerCandidates) {
    if (cand !== undefined && cand !== null && cand !== '') {
      sawOwnershipField = true;
      if (candidateMatchesOwnerIdentity(cand, norm)) {
        return true;
      }
    }
  }

  const assocSources = [
    record.usuarios_asociados,
    record.colaboradores,
    record.users,
    record.miembros,
    record.gestores,
    record.editors,
  ];
  for (const assocRaw of assocSources) {
    if (Array.isArray(assocRaw)) {
      sawOwnershipField = true;
      for (const entry of assocRaw) {
        if (candidateMatchesOwnerIdentity(entry, norm)) {
          return true;
        }
      }
    }
  }

  return sawOwnershipField ? false : null;
}

export function extractScalarChannelIdsFromRecord(
  record: Record<string, unknown> | null | undefined,
  excludeIds: Set<string> = new Set()
): number[] {
  if (!record || typeof record !== 'object') return [];
  const found = new Set<number>();
  const addId = (raw: unknown) => {
    const id = extractPictaEntityId(raw);
    if (id > 0 && !excludeIds.has(String(id))) {
      found.add(id);
    }
  };

  addId(record.canal_id);
  addId(record.channel_id);
  addId(record.canal_principal_id);
  addId(record.canal);
  addId(record.channel);

  if (record.publicacion && typeof record.publicacion === 'object') {
    const pub = record.publicacion as Record<string, unknown>;
    addId(pub.canal_id);
    addId(pub.channel_id);
    addId(pub.canal);
    addId(pub.channel);
  }

  for (const listKey of ['canales', 'mis_canales', 'channels', 'canales_asociados', 'usuario_canales']) {
    const arr = record[listKey];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        addId(entry);
      }
    }
  }

  return Array.from(found);
}

export function extractChannelsFromPictaRecords(
  records: unknown[],
  excludeIds: Set<string> = new Set(),
  userIdOrIdentity?: number | PictaUserOwnershipIdentity
): Array<{ id: number; nombre: string; alias?: string; slug_url?: string }> {
  const out: Array<{ id: number; nombre: string; alias?: string; slug_url?: string }> = [];
  const seen = new Set<number>();
  const norm = normalizeOwnershipIdentity(userIdOrIdentity);
  const checkOwnership = norm.userId > 0 || norm.tokens.size > 0;

  const tryPush = (obj: Record<string, unknown> | null | undefined) => {
    if (!obj || typeof obj !== 'object') return;
    const id = extractPictaEntityId(obj.id ?? obj.canal_id ?? obj.channel_id);
    if (!id || id <= 0 || excludeIds.has(String(id)) || seen.has(id)) return;
    if (checkOwnership) {
      const owned = isChannelOwnedOrAssociatedByUser(obj, userIdOrIdentity);
      if (owned === false) return;
    }
    const nombre = String(obj.nombre || obj.title || obj.name || `Canal #${id}`).trim();
    const alias = obj.alias ? String(obj.alias).trim() : undefined;
    const slugUrl = obj.slug_url ? String(obj.slug_url).trim() : undefined;
    seen.add(id);
    out.push({
      id,
      nombre,
      ...(alias ? { alias } : {}),
      ...(slugUrl ? { slug_url: slugUrl } : {}),
    });
  };

  for (const raw of records) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    for (const listKey of ['canales', 'mis_canales', 'channels', 'canales_asociados', 'usuario_canales']) {
      const arr = rec[listKey];
      if (Array.isArray(arr)) {
        for (const c of arr) {
          if (c && typeof c === 'object') tryPush(c as Record<string, unknown>);
        }
      }
    }
    if (rec.canal && typeof rec.canal === 'object') {
      tryPush(rec.canal as Record<string, unknown>);
    }
    if (rec.channel && typeof rec.channel === 'object') {
      tryPush(rec.channel as Record<string, unknown>);
    }
    if (rec.nombre || rec.alias || rec.slug_url || rec.propietario !== undefined) {
      tryPush(rec);
    }
  }

  return out;
}

export function filterMatchingOwnedChannels(
  channels: Array<{ id: number; nombre: string; alias?: string; slug_url?: string; [k: string]: any }>,
  query: string,
  userIdOrIdentity?: number | PictaUserOwnershipIdentity,
  excludeIds: Set<string> = new Set(),
  requireMatch = true
): Array<{ id: number; nombre: string; alias?: string; slug_url?: string }> {
  const q = String(query || '').trim().toLowerCase();
  const res: Array<{ id: number; nombre: string; alias?: string; slug_url?: string }> = [];
  const norm = normalizeOwnershipIdentity(userIdOrIdentity);
  const checkOwnership = norm.userId > 0 || norm.tokens.size > 0;

  for (const ch of channels || []) {
    if (!ch || !ch.id) continue;
    const id = Number(ch.id);
    if (excludeIds.has(String(id))) continue;
    if (checkOwnership) {
      const owned = isChannelOwnedOrAssociatedByUser(ch, userIdOrIdentity);
      if (owned === false) continue;
    }
    const nombre = String(ch.nombre || '').trim();
    const alias = String(ch.alias || '').trim();
    const slug = String(ch.slug_url || '').trim();
    if (requireMatch && q) {
      const hay = `${id} ${nombre} ${alias} ${slug}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    res.push({
      id,
      nombre: nombre || `Canal #${id}`,
      ...(alias ? { alias } : {}),
      ...(slug ? { slug_url: slug } : {}),
    });
  }
  return res;
}

export function resolveGuestOrAdminChannelMeta(
  chatId: string,
  session: {
    channelId?: string;
    channelName?: string;
    username?: string;
    userFullName?: string;
    verifiedChannelOwnership?: boolean;
  } | null | undefined,
  masterChannelId: string,
  masterChannelName: string
): {
  isMaster: boolean;
  isLinked: boolean;
  channelId: string;
  channelName: string;
} {
  const isMaster = isMasterAdminChat(chatId);
  if (isMaster) {
    const chId = String(session?.channelId || masterChannelId || '36319').trim();
    const chName = String(session?.channelName || masterChannelName || 'Canal Oficial').trim();
    return {
      isMaster: true,
      isLinked: Boolean(chId),
      channelId: chId,
      channelName: chName,
    };
  }
  const guestChanId = String(session?.channelId || '').trim();
  if (!session || !guestChanId || guestChanId === String(masterChannelId)) {
    return {
      isMaster: false,
      isLinked: false,
      channelId: '',
      channelName: '',
    };
  }
  return {
    isMaster: false,
    isLinked: true,
    channelId: guestChanId,
    channelName: String(session.channelName || `Canal #${guestChanId}`).trim(),
  };
}

export function sanitizeLeakedUserSession<
  T extends {
    chatId: string;
    channelId?: string;
    channelName?: string;
    availableChannels?: Array<{ id: number; nombre: string; alias?: string }>;
    verifiedChannelOwnership?: boolean;
  }
>(
  session: T,
  masterChannelId: string
): { session: T; changed: boolean } {
  if (isMasterAdminChat(session.chatId)) {
    return { session, changed: false };
  }
  const masterIdStr = String(masterChannelId || '36319').trim();
  let changed = false;
  const copy = { ...session };
  if (Array.isArray(copy.availableChannels)) {
    const filtered = copy.availableChannels.filter((c) => String(c.id) !== masterIdStr);
    if (filtered.length !== copy.availableChannels.length) {
      copy.availableChannels = filtered;
      changed = true;
    }
  }
  if (String(copy.channelId || '').trim() === masterIdStr) {
    const fallback = (copy.availableChannels || [])[0];
    if (fallback) {
      copy.channelId = String(fallback.id);
      copy.channelName = fallback.nombre;
    } else {
      copy.channelId = '';
      copy.channelName = '';
      copy.verifiedChannelOwnership = false;
    }
    changed = true;
  }
  return { session: copy, changed };
}

export function normalizePictaChannelDetails(
  raw: Record<string, any> | null | undefined,
  fallbackId: string | number,
  fallbackName: string,
  fallbackClasificacion = '18+'
): PictaChannelDetails {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = Number(src.id || fallbackId || 0);
  const nombre = String(src.nombre || src.name || fallbackName || `Canal #${id}`).trim();
  const alias = String(src.alias || '').trim();
  const descripcion = String(src.descripcion || src.description || '').trim();
  const clasificacion = String(src.clasificacion || fallbackClasificacion || '18+').trim();
  const slugUrl = src.slug_url ? String(src.slug_url).trim() : undefined;
  return {
    id,
    nombre,
    alias,
    descripcion,
    clasificacion,
    ...(slugUrl ? { slug_url: slugUrl } : {}),
    visible: src.visible !== undefined ? Boolean(src.visible) : src.publicado !== undefined ? Boolean(src.publicado) : true,
    publicado: src.publicado !== undefined ? Boolean(src.publicado) : src.visible !== undefined ? Boolean(src.visible) : true,
    recibir_donacion:
      src.recibir_donacion !== undefined ? Boolean(src.recibir_donacion) : Boolean(src.donacion ?? src.donar),
    donacion:
      src.donacion !== undefined ? Boolean(src.donacion) : Boolean(src.recibir_donacion ?? src.donar),
    cantidad_suscriptores: Number(src.cantidad_suscriptores || 0),
    cantidad_publicaciones: Number(src.cantidad_publicaciones || 0),
    ...(src.url_avatar ? { url_avatar: String(src.url_avatar) } : {}),
    ...(src.url_imagen ? { url_imagen: String(src.url_imagen) } : {}),
  };
}

export function isGenericAutoSynopsis(synopsis?: string | null, rawCaption?: string | null): boolean {
  const s = String(synopsis || '').trim();
  if (!s || s.length < 25) return true;
  const lower = s.toLowerCase();
  if (
    lower.includes('disponible en el canal') ||
    lower.includes('video publicado automáticamente') ||
    lower.includes('video disponible en') ||
    lower.includes('capítulo de la serie') ||
    lower.startsWith('archivo:') ||
    lower.startsWith('sin sinopsis') ||
    lower.startsWith('pendiente')
  ) {
    return true;
  }
  if (rawCaption && s === String(rawCaption).trim() && s.length < 55) {
    return true;
  }
  return false;
}

export function filterSeriesForChannel<T extends { canal_id?: number; canal?: number | { id?: number } }>(
  seriesList: T[],
  channelId: string | number,
  isMaster: boolean,
  masterChannelId = '36319'
): T[] {
  const targetId = Number(channelId || 0);
  if (!targetId) return [];
  const masterNum = Number(masterChannelId || 36319);
  return (seriesList || []).filter((s) => {
    const cId = Number(
      s.canal_id || (typeof s.canal === 'object' ? s.canal?.id : s.canal) || 0
    );
    if (cId > 0) return cId === targetId;
    return isMaster && targetId === masterNum;
  });
}
