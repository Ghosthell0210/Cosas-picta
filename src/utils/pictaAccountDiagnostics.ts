export function extractPictaGroupSummary(profileObj: Record<string, any> | null | undefined): {
  groupNames: string[];
  hasChannelAdminRole: boolean;
} {
  if (!profileObj || typeof profileObj !== 'object') {
    return { groupNames: [], hasChannelAdminRole: false };
  }
  const rawGroups = Array.isArray(profileObj.groups)
    ? profileObj.groups
    : Array.isArray(profileObj.grupos)
      ? profileObj.grupos
      : [];

  const groupNames: string[] = [];
  for (const g of rawGroups) {
    if (typeof g === 'string' && g.trim()) {
      groupNames.push(g.trim());
    } else if (g && typeof g === 'object') {
      const name = String(g.name || g.nombre || '').trim();
      if (name) groupNames.push(name);
    }
  }

  const isSuperuser = Boolean(profileObj.is_superuser || profileObj.is_staff);
  const hasChannelAdminRole =
    isSuperuser ||
    groupNames.some((n) => {
      const low = n.toLowerCase();
      return (
        low.includes('jefe de canal') ||
        low.includes('admin') ||
        low.includes('creador') ||
        low.includes('supervisor') ||
        low.includes('moderador')
      );
    });

  return { groupNames, hasChannelAdminRole };
}

export function isPictaForbiddenResponse(
  statusCode?: number,
  responseText?: string | null
): boolean {
  if (Number(statusCode) === 403) return true;
  const low = String(responseText || '').toLowerCase();
  return low.includes('forbidden') || low.includes('no tiene permiso') || low.includes('permission');
}

export function buildPictaRoleDiagnosticLines(params: {
  username: string;
  groupNames: string[];
  hasChannelAdminRole: boolean;
  channelName?: string;
  channelId?: string;
}): string {
  const groupsText = params.groupNames.length > 0 ? params.groupNames.join(', ') : 'Usuario común';
  const chText = params.channelName ? ` en el canal "${params.channelName}"` : '';
  return (
    `⚠️ <b>Diagnóstico de permisos Picta (@${params.username}):</b>\n` +
    `• Rol detectado: <code>${groupsText}</code>${params.hasChannelAdminRole ? ' (con permiso)' : ' (sin rol Jefe de canal)'}\n` +
    `• Esta cuenta no tiene permisos para crear publicaciones directamente${chText}. Solicita al soporte de Picta activar el grupo <b>"Jefe de canal"</b>.`
  );
}
