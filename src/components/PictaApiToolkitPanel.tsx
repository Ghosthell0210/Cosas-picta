import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  ListVideo,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import type {
  ChannelMediaRequest,
  PictaRequestMatchHit,
} from '../utils/channelRequestsManager';

interface ToolkitOverview {
  ok: boolean;
  channel: {
    id: number;
    nombre: string;
    alias: string;
    descripcion: string;
    clasificacion: string;
    slug_url?: string;
    visible: boolean;
    recibir_donacion: boolean;
    cantidad_suscriptores: number;
    cantidad_publicaciones: number;
  } | null;
  collaborators: {
    ownerId: number;
    ownerUsername: string;
    associatedIds: number[];
    poolAccounts: Array<{
      id: string;
      phone: string;
      username: string;
      channelId: string;
      channelName: string;
      uploadedToday: number;
    }>;
  };
  playlists: Array<{
    id: number;
    nombre: string;
    canalId: number;
    canalNombre: string;
    cantidadPublicaciones: number;
  }>;
  comments: Array<{
    id: number;
    texto: string;
    usuario: string;
    fecha: string;
    publicacionId: number;
    publicacionNombre: string;
    tipologiaId?: number;
    categoriaNombre?: string;
    parentId?: number;
    replyCount?: number;
    answered?: boolean;
    detectedRequestTitle?: string;
    detectedRequestReason?: string;
    linkedRequestId?: string;
    linkedRequestStatus?: string;
  }>;
  requests: ChannelMediaRequest[];
  denuncias: {
    cantidad_pendientes: number;
    cantidad_en_proceso: number;
    cantidad_no_proceden: number;
    cantidad_procesadas: number;
    total: number;
  };
  series: Array<{
    pelser_id: number;
    nombre: string;
    sinopsis?: string;
    chapters?: Array<{ pubId: number; temporada: number; numero: number; nombre?: string }>;
  }>;
  publications: Array<{
    id: number;
    nombre: string;
    publicado?: boolean;
    descargas?: boolean;
    cantidad_visitas?: number;
    cantidad_reproducciones?: number;
    cantidad_me_gusta?: number;
    slug_url?: string;
  }>;
  quota: {
    seriesDailyTarget: number;
    otherDailyTarget: number;
    seriesUploadedToday: number;
    otherUploadedToday: number;
    poolCount: number;
  };
}

export function PictaApiToolkitPanel({
  focusMode = 'full',
}: {
  focusMode?: 'full' | 'requests';
} = {}) {
  const [overview, setOverview] = useState<ToolkitOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Channel edit state
  const [chanName, setChanName] = useState('');
  const [chanAlias, setChanAlias] = useState('');
  const [chanDesc, setChanDesc] = useState('');
  const [chanClasif, setChanClasif] = useState('18+');
  const [chanVisible, setChanVisible] = useState(true);
  const [chanDonation, setChanDonation] = useState(false);

  // Toolkit inputs
  const [collabInput, setCollabInput] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [commentPubId, setCommentPubId] = useState('');
  const [commentText, setCommentText] = useState('');
  const [personaInput, setPersonaInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [selectedPubForPlaylist, setSelectedPubForPlaylist] = useState('');
  const [commentSearch, setCommentSearch] = useState('');
  const [commentCategory, setCommentCategory] = useState<string>(
    focusMode === 'requests' ? 'requests' : 'all'
  );
  const [commentSort, setCommentSort] = useState<'recent' | 'oldest'>('recent');
  const [commentPage, setCommentPage] = useState(0);
  const [replyingToCommentId, setReplyingToCommentId] = useState<number | null>(null);

  useEffect(() => {
    setCommentCategory(focusMode === 'requests' ? 'requests' : 'all');
    setCommentPage(0);
  }, [focusMode]);

  // Pedidos manager state
  const [requestQueryInput, setRequestQueryInput] = useState('');
  const [requestRequesterInput, setRequestRequesterInput] = useState('');
  const [requestStatusFilter, setRequestStatusFilter] = useState<'pending' | 'fulfilled' | 'all'>('pending');
  const [requestSourceFilter, setRequestSourceFilter] = useState<'all' | 'picta_comment' | 'telegram_group' | 'manual'>('all');
  const [requestSearch, setRequestSearch] = useState('');
  const [quickVerifyState, setQuickVerifyState] = useState<{
    query: string;
    matches: PictaRequestMatchHit[];
  } | null>(null);
  const [requestMatchesById, setRequestMatchesById] = useState<Record<string, PictaRequestMatchHit[]>>({});
  const [copiedUrlKey, setCopiedUrlKey] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/picta/toolkit/overview');
      const data = (await res.json()) as ToolkitOverview & { error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Error HTTP ${res.status}`);
      }
      setOverview(data);
      if (data.channel) {
        setChanName(data.channel.nombre || '');
        setChanAlias(data.channel.alias || '');
        setChanDesc(data.channel.descripcion || '');
        setChanClasif(data.channel.clasificacion || '18+');
        setChanVisible(Boolean(data.channel.visible));
        setChanDonation(Boolean(data.channel.recibir_donacion));
      }
      if (data.playlists.length > 0 && !selectedPlaylistId) {
        setSelectedPlaylistId(String(data.playlists[0].id));
      }
      if (data.publications.length > 0 && !selectedPubForPlaylist) {
        setSelectedPubForPlaylist(String(data.publications[0].id));
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo cargar el Centro API Picta.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedPlaylistId, selectedPubForPlaylist]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runAction = async (
    actionKey: string,
    payload: Record<string, unknown>,
    skipOverviewReload = false
  ): Promise<Record<string, any> | null> => {
    setBusyAction(actionKey);
    setFeedback(null);
    try {
      const res = await fetch('/api/picta/toolkit/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, any> & {
        ok?: boolean;
        message?: string;
        error?: string;
        requests?: ChannelMediaRequest[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Error HTTP ${res.status}`);
      }
      setFeedback({ type: 'ok', text: data.message || 'Operación ejecutada en Picta.' });
      if (Array.isArray(data.requests)) {
        const nextReqs = data.requests;
        setOverview((prev) => {
          if (!prev) return prev;
          const byCommentId = new Map<number, ChannelMediaRequest>();
          for (const req of nextReqs) {
            if (req.commentId) byCommentId.set(req.commentId, req);
          }
          return {
            ...prev,
            requests: nextReqs,
            comments: prev.comments.map((cm) => {
              const linked = byCommentId.get(cm.id);
              return {
                ...cm,
                linkedRequestId: linked?.id,
                linkedRequestStatus: linked?.status,
              };
            }),
          };
        });
      }
      if (!skipOverviewReload) {
        await loadOverview();
      }
      return data;
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al ejecutar operación en Picta.',
      });
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const formatHitSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return 'N/D';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleCopyText = (key: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedUrlKey(key);
        setTimeout(() => setCopiedUrlKey((cur) => (cur === key ? null : cur)), 1800);
      });
    }
  };

  if (loading && !overview) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-8 flex items-center justify-center gap-3 text-sm text-slate-500 dark:text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin text-cyan-500" />
        Sincronizando canal, colaboradores, listas, comentarios y publicaciones con api.picta.cu...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
            {focusMode === 'requests' ? (
              <ClipboardList className="w-5 h-5 text-cyan-500" />
            ) : (
              <Wrench className="w-5 h-5 text-cyan-500" />
            )}
            {focusMode === 'requests' ? 'Pedidos y Verificador en Picta' : 'Centro API Picta'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {focusMode === 'requests'
              ? 'Pedidos manuales, grupo de Telegram y solicitudes reconocidas automáticamente en comentarios de Picta.'
              : (
                  <>
                    Administración directa en vivo sobre <code className="font-mono">api.picta.cu</code>: perfil de canal, colaboradores, listas, comentarios, series y catálogo.
                  </>
                )}
          </p>
        </div>

        <button
          onClick={() => void loadOverview()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-cyan-500/25 bg-white dark:bg-[#0B1220] text-slate-700 dark:text-cyan-300 hover:border-cyan-500/50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Sincronizar con Picta
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs font-medium flex items-center gap-2 ${
            feedback.type === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <ShieldAlert className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {focusMode === 'full' && (
        <>
      {/* Row 1: Channel Summary + Quota & Denuncias */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white">
              Perfil del Canal (#{overview?.channel?.id || '36319'})
            </h3>
            {overview?.channel && (
              <span className="text-[11px] font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                {overview.channel.cantidad_suscriptores} suscriptores · {overview.channel.cantidad_publicaciones} videos
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Nombre del canal
              </label>
              <input
                type="text"
                value={chanName}
                onChange={(e) => setChanName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Alias
              </label>
              <input
                type="text"
                value={chanAlias}
                onChange={(e) => setChanAlias(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Descripción pública
            </label>
            <textarea
              rows={2}
              value={chanDesc}
              onChange={(e) => setChanDesc(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <select
                value={chanClasif}
                onChange={(e) => setChanClasif(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
              >
                {['TP', '+12', '+16', '18+', 'Todos'].map((c) => (
                  <option key={c} value={c}>
                    Clasificación: {c}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chanVisible}
                  onChange={(e) => setChanVisible(e.target.checked)}
                />
                Canal visible
              </label>

              <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chanDonation}
                  onChange={(e) => setChanDonation(e.target.checked)}
                />
                Donaciones
              </label>
            </div>

            <button
              onClick={() =>
                void runAction('update_channel', {
                  action: 'update_channel',
                  nombre: chanName,
                  alias: chanAlias,
                  descripcion: chanDesc,
                  clasificacion: chanClasif,
                  visible: chanVisible,
                  recibir_donacion: chanDonation,
                })
              }
              disabled={busyAction === 'update_channel'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              Guardar Canal
            </button>
          </div>
        </div>

        {/* Quota + Moderation Summary */}
        <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-4">
          <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white">
            Cuota Diaria y Moderación
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Series subidas hoy</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                {overview?.quota.seriesUploadedToday || 0} / {overview?.quota.seriesDailyTarget || 10}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Películas / Otros hoy</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                {overview?.quota.otherUploadedToday || 0} / {overview?.quota.otherDailyTarget || 10}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Cuentas en Pool</span>
              <span className="font-mono tabular-nums font-semibold text-cyan-600 dark:text-cyan-400">
                +{overview?.quota.poolCount || 0} secundarias
              </span>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-1.5 text-xs">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Denuncias del Canal
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
              <div className="rounded-lg bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5">
                Pendientes: <b>{overview?.denuncias.cantidad_pendientes || 0}</b>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5">
                Procesadas: <b>{overview?.denuncias.cantidad_procesadas || 0}</b>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Crear persona/actor..."
                value={personaInput}
                onChange={(e) => setPersonaInput(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5 text-xs"
              />
              <button
                onClick={() => {
                  if (!personaInput.trim()) return;
                  void runAction('create_persona', {
                    action: 'create_persona',
                    nombre: personaInput.trim(),
                  }).then(() => setPersonaInput(''));
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 dark:bg-cyan-500/20 text-white dark:text-cyan-300 text-xs font-semibold cursor-pointer"
              >
                +Persona
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Crear palabra clave..."
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5 text-xs"
              />
              <button
                onClick={() => {
                  if (!keywordInput.trim()) return;
                  void runAction('create_keyword', {
                    action: 'create_keyword',
                    palabra: keywordInput.trim(),
                  }).then(() => setKeywordInput(''));
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 dark:bg-cyan-500/20 text-white dark:text-cyan-300 text-xs font-semibold cursor-pointer"
              >
                +Tag
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Collaborators & Playlists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Collaborators */}
        <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-500" />
              Colaboradores Asociados ({overview?.collaborators.associatedIds.length || 0})
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              Owner #{overview?.collaborators.ownerId}
            </span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enlace del canal, @usuario o ID (ej: 994913)"
              value={collabInput}
              onChange={(e) => setCollabInput(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-1.5 text-xs font-mono"
            />
            <button
              onClick={() => {
                const raw = collabInput.trim();
                if (!raw) return;
                void runAction('add_collaborator', {
                  action: 'add_collaborator',
                  targetIdentifier: raw,
                }).then(() => setCollabInput(''));
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Asociar
            </button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {(overview?.collaborators.associatedIds || []).map((uid) => {
              const isOwner = uid === overview?.collaborators.ownerId;
              const poolMatch = overview?.collaborators.poolAccounts.find(
                (p) => Number(p.id) === uid
              );
              return (
                <div
                  key={uid}
                  className="flex items-center justify-between rounded-lg border border-slate-200/70 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <div className="font-mono tabular-nums">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      #{uid}
                    </span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                      {isOwner
                        ? `@${overview?.collaborators.ownerUsername} (Propietario)`
                        : poolMatch
                          ? `${poolMatch.username} (Pool · ${poolMatch.uploadedToday}/10 hoy)`
                          : 'Colaborador asociado'}
                    </span>
                  </div>
                  {!isOwner && (
                    <button
                      onClick={() =>
                        void runAction(`rm_col_${uid}`, {
                          action: 'remove_collaborator',
                          targetUserId: uid,
                        })
                      }
                      className="text-rose-500 hover:text-rose-400 p-1 cursor-pointer"
                      title="Desvincular colaborador"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Playlists */}
        <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-3">
          <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
            <ListVideo className="w-4 h-4 text-cyan-500" />
            Listas de Reproducción ({overview?.playlists.length || 0})
          </h3>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Nombre de nueva lista..."
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-1.5 text-xs"
            />
            <button
              onClick={() => {
                if (!playlistName.trim()) return;
                void runAction('create_playlist', {
                  action: 'create_playlist',
                  nombre: playlistName.trim(),
                }).then(() => setPlaylistName(''));
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Crear
            </button>
          </div>

          {overview && overview.playlists.length > 0 && overview.publications.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              <select
                value={selectedPlaylistId}
                onChange={(e) => setSelectedPlaylistId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2 py-1.5 text-xs"
              >
                {overview.playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.nombre} (#{pl.id})
                  </option>
                ))}
              </select>
              <select
                value={selectedPubForPlaylist}
                onChange={(e) => setSelectedPubForPlaylist(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2 py-1.5 text-xs"
              >
                {overview.publications.slice(0, 25).map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.id} · {p.nombre.slice(0, 32)}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  void runAction('add_pub_to_playlist', {
                    action: 'add_pub_to_playlist',
                    playlistId: Number(selectedPlaylistId),
                    pubId: Number(selectedPubForPlaylist),
                  })
                }
                className="px-3 py-1.5 rounded-lg border border-cyan-500/35 text-cyan-600 dark:text-cyan-400 text-xs font-semibold cursor-pointer"
              >
                Añadir Video
              </button>
            </div>
          )}

          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {(overview?.playlists || []).map((pl) => (
              <div
                key={pl.id}
                className="flex items-center justify-between rounded-lg border border-slate-200/70 dark:border-slate-800 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {pl.nombre}
                  </span>
                  <span className="ml-2 font-mono text-slate-400">
                    #{pl.id} · {pl.cantidadPublicaciones} videos
                  </span>
                </div>
                <button
                  onClick={() =>
                    void runAction(`del_pl_${pl.id}`, {
                      action: 'delete_playlist',
                      playlistId: pl.id,
                    })
                  }
                  className="text-rose-500 hover:text-rose-400 p-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
        </>
      )}

      {/* Row 2.5: Gestor de Pedidos y Verificador (Comentarios Picta + Telegram + Manual) */}
      <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-4">
        {(() => {
          const allRequests = overview?.requests || [];
          const pendingReqCount = allRequests.filter((r) => r.status === 'pending').length;
          const fulfilledReqCount = allRequests.filter((r) => r.status === 'fulfilled').length;
          const commentReqCount = allRequests.filter(
            (r) => r.sourceType === 'picta_comment'
          ).length;

          const reqSearchLower = requestSearch.trim().toLowerCase();
          const visibleRequests = allRequests.filter((r) => {
            if (requestStatusFilter === 'pending' && r.status !== 'pending') return false;
            if (requestStatusFilter === 'fulfilled' && r.status !== 'fulfilled') return false;
            if (requestSourceFilter !== 'all') {
              const effSrc = r.sourceType || (r.sourceChatId ? 'telegram_group' : 'manual');
              if (effSrc !== requestSourceFilter) return false;
            }
            if (!reqSearchLower) return true;
            return (
              r.requestedTitle.toLowerCase().includes(reqSearchLower) ||
              r.requestedByName.toLowerCase().includes(reqSearchLower) ||
              (r.commentPublicationTitle || '').toLowerCase().includes(reqSearchLower)
            );
          });

          return (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-cyan-500" />
                    Gestor de Pedidos y Verificador
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    <span>{pendingReqCount} pendientes</span>
                    <span aria-hidden="true">·</span>
                    <span>{fulfilledReqCount} cumplidos</span>
                    <span aria-hidden="true">·</span>
                    <span>{commentReqCount} detectados en comentarios</span>
                  </div>
                </div>

                <button
                  onClick={() =>
                    void runAction('scan_comment_requests', { action: 'scan_comment_requests' })
                  }
                  disabled={busyAction === 'scan_comment_requests'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-cyan-500/30 bg-slate-50 dark:bg-[#060B14] text-xs font-medium text-slate-700 dark:text-cyan-300 hover:border-cyan-500/60 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      busyAction === 'scan_comment_requests' ? 'animate-spin' : ''
                    }`}
                  />
                  Escanear Comentarios Picta
                </button>
              </div>

              {/* Verify / Add Request Bar */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Título de película o serie pedida para verificar en Picta o añadir..."
                  value={requestQueryInput}
                  onChange={(e) => setRequestQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && requestQueryInput.trim()) {
                      void runAction(
                        'check_or_add_request',
                        {
                          action: 'check_or_add_request',
                          query: requestQueryInput.trim(),
                          requesterName: requestRequesterInput.trim() || 'Admin Web',
                        },
                        true
                      ).then((res) => {
                        if (res) {
                          setQuickVerifyState({
                            query: requestQueryInput.trim(),
                            matches: Array.isArray(res.matches) ? res.matches : [],
                          });
                          if (res.savedRequest) {
                            setRequestQueryInput('');
                            setRequestRequesterInput('');
                          }
                        }
                      });
                    }
                  }}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="text"
                  placeholder="Suscriptor (opcional)"
                  value={requestRequesterInput}
                  onChange={(e) => setRequestRequesterInput(e.target.value)}
                  className="sm:w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => {
                    const q = requestQueryInput.trim();
                    if (!q) return;
                    void runAction(
                      'check_or_add_request',
                      {
                        action: 'check_or_add_request',
                        query: q,
                        requesterName: requestRequesterInput.trim() || 'Admin Web',
                      },
                      true
                    ).then((res) => {
                      if (res) {
                        setQuickVerifyState({
                          query: q,
                          matches: Array.isArray(res.matches) ? res.matches : [],
                        });
                        if (res.savedRequest) {
                          setRequestQueryInput('');
                          setRequestRequesterInput('');
                        }
                      }
                    });
                  }}
                  disabled={busyAction === 'check_or_add_request' || !requestQueryInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" />
                  Verificar / Añadir
                </button>
              </div>

              {quickVerifyState && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#060B14] p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {quickVerifyState.matches.length > 0
                        ? `Resultados en Picta para "${quickVerifyState.query}" (${quickVerifyState.matches.length})`
                        : `"${quickVerifyState.query}" no aparece en Picta todavía (añadido a pendientes).`}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {quickVerifyState.matches.length > 0 && (
                        <button
                          onClick={() =>
                            void runAction(
                              'check_or_add_request',
                              {
                                action: 'check_or_add_request',
                                query: quickVerifyState.query,
                                requesterName: requestRequesterInput.trim() || 'Admin Web',
                                saveAnyway: true,
                              },
                              true
                            ).then(() => {
                              setQuickVerifyState(null);
                              setRequestQueryInput('');
                              setRequestRequesterInput('');
                            })
                          }
                          className="px-2.5 py-1 rounded border border-cyan-500/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 font-medium cursor-pointer whitespace-nowrap"
                        >
                          Guardar igual en pendientes
                        </button>
                      )}
                      <button
                        onClick={() => setQuickVerifyState(null)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1.5 py-1 cursor-pointer"
                      >
                        Cerrar
                      </button>
                    </div>
                  </div>
                  {quickVerifyState.matches.length > 0 && (
                    <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {quickVerifyState.matches.map((m) => (
                        <div
                          key={`${m.kind}_${m.id}`}
                          className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {m.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-1.5">
                              <span>{m.channelName || 'Picta'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{formatHitSize(m.sizeBytes)}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {m.maxResolutionLabel ||
                                  (m.resolutions?.length ? m.resolutions.join(', ') : 'Estándar')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleCopyText(`qv_${m.id}`, m.webUrl)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-cyan-500/40 cursor-pointer whitespace-nowrap"
                            >
                              {copiedUrlKey === `qv_${m.id}` ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedUrlKey === `qv_${m.id}` ? 'Copiado' : 'Copiar enlace'}
                            </button>
                            <a
                              href={m.webUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-500/35 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 whitespace-nowrap"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Abrir
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Filters & Search */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#060B14] border border-slate-200/70 dark:border-slate-800">
                    {(
                      [
                        { key: 'pending', label: `Pendientes (${pendingReqCount})` },
                        { key: 'fulfilled', label: `Cumplidos (${fulfilledReqCount})` },
                        { key: 'all', label: `Todos (${allRequests.length})` },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setRequestStatusFilter(tab.key)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          requestStatusFilter === tab.key
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <select
                    value={requestSourceFilter}
                    onChange={(e) => setRequestSourceFilter(e.target.value as any)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                  >
                    <option value="all">Todos los orígenes</option>
                    <option value="picta_comment">Comentarios de Picta</option>
                    <option value="telegram_group">Grupo / Canal Telegram</option>
                    <option value="manual">Manuales</option>
                  </select>
                </div>

                <input
                  type="text"
                  placeholder="Filtrar pedidos por título, usuario o video..."
                  value={requestSearch}
                  onChange={(e) => setRequestSearch(e.target.value)}
                  className="lg:w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Requests Table / List */}
              <div className="divide-y divide-slate-200/80 dark:divide-slate-800 max-h-96 overflow-y-auto border-t border-slate-200/80 dark:border-slate-800">
                {visibleRequests.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    {allRequests.length === 0
                      ? 'No hay pedidos registrados todavía. Escanea los comentarios de Picta o verifica un título arriba.'
                      : 'Ningún pedido coincide con los filtros actuales.'}
                  </div>
                ) : (
                  visibleRequests.map((req) => {
                    const effSource =
                      req.sourceType || (req.sourceChatId ? 'telegram_group' : 'manual');
                    const originLabel =
                      effSource === 'picta_comment'
                        ? `Comentario Picta${
                            req.commentPublicationTitle ? ` · ${req.commentPublicationTitle}` : ''
                          }`
                        : effSource === 'telegram_group'
                          ? 'Grupo Telegram'
                          : 'Manual';
                    const matches = requestMatchesById[req.id];
                    const formattedReqDate = (() => {
                      try {
                        const d = new Date(req.createdAt);
                        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CU');
                      } catch {
                        return '';
                      }
                    })();

                    return (
                      <div key={req.id} className="py-3 space-y-2.5 text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="min-w-0 space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 font-semibold ${
                                  req.status === 'fulfilled'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {req.status === 'fulfilled' ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                ) : (
                                  <Clock className="w-3.5 h-3.5 shrink-0" />
                                )}
                                {req.status === 'fulfilled' ? 'Cumplido' : 'Pendiente'}
                              </span>
                              <span aria-hidden="true" className="text-slate-400">
                                ·
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-slate-100 break-words">
                                {req.requestedTitle}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                              <span className="font-mono">{req.requestedByName}</span>
                              <span aria-hidden="true">·</span>
                              <span>{originLabel}</span>
                              {formattedReqDate && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">{formattedReqDate}</span>
                                </>
                              )}
                              {req.matchedPictaUrl && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <a
                                    href={req.matchedPictaUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-cyan-600 dark:text-cyan-400 hover:underline inline-flex items-center gap-1"
                                  >
                                    Ver enlace Picta
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              onClick={() =>
                                void runAction(
                                  `verify_${req.id}`,
                                  {
                                    action: 'verify_request',
                                    requestId: req.id,
                                  },
                                  true
                                ).then((res) => {
                                  if (res && Array.isArray(res.matches)) {
                                    setRequestMatchesById((prev) => ({
                                      ...prev,
                                      [req.id]: res.matches,
                                    }));
                                  }
                                })
                              }
                              disabled={busyAction === `verify_${req.id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-cyan-500/35 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 text-[11px] font-medium cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              <Search className="w-3 h-3" />
                              Verificar
                            </button>

                            {req.status === 'pending' ? (
                              <button
                                onClick={() =>
                                  void runAction(
                                    `fulfill_${req.id}`,
                                    { action: 'fulfill_request', requestId: req.id },
                                    true
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-500/35 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-medium cursor-pointer whitespace-nowrap"
                              >
                                <Check className="w-3 h-3" />
                                Cumplido
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  void runAction(
                                    `reopen_${req.id}`,
                                    { action: 'reopen_request', requestId: req.id },
                                    true
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-cyan-500/40 text-[11px] font-medium cursor-pointer whitespace-nowrap"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Reabrir
                              </button>
                            )}

                            <button
                              onClick={() =>
                                void runAction(
                                  `del_req_${req.id}`,
                                  { action: 'delete_request', requestId: req.id },
                                  true
                                )
                              }
                              className="text-rose-500 hover:text-rose-400 p-1.5 rounded hover:bg-rose-500/10 cursor-pointer"
                              title="Eliminar pedido"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {Array.isArray(matches) && (
                          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#060B14] px-3 py-2 space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                              <span>
                                {matches.length > 0
                                  ? `Coincidencias en Picta (${matches.length})`
                                  : `No se encontró "${req.requestedTitle}" publicado en Picta todavía.`}
                              </span>
                              <button
                                onClick={() =>
                                  setRequestMatchesById((prev) => {
                                    const copy = { ...prev };
                                    delete copy[req.id];
                                    return copy;
                                  })
                                }
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                              >
                                Ocultar
                              </button>
                            </div>
                            {matches.map((m) => (
                              <div
                                key={`${req.id}_${m.id}`}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-800"
                              >
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {m.title}
                                  </div>
                                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                    {m.channelName || 'Picta'} · {formatHitSize(m.sizeBytes)} ·{' '}
                                    {m.maxResolutionLabel ||
                                      (m.resolutions?.length ? m.resolutions.join(', ') : 'Estándar')}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                  <a
                                    href={m.webUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] whitespace-nowrap"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    Ver
                                  </a>
                                  <button
                                    onClick={() =>
                                      void runAction(
                                        `fulfill_hit_${req.id}`,
                                        {
                                          action: 'fulfill_request',
                                          requestId: req.id,
                                          matchedPictaPubId: m.id,
                                          matchedPictaUrl: m.webUrl,
                                        },
                                        true
                                      )
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium cursor-pointer whitespace-nowrap"
                                  >
                                    <Check className="w-3 h-3" />
                                    Cumplir con enlace
                                  </button>
                                  {req.commentId && req.commentPublicationId && (
                                    <button
                                      onClick={() =>
                                        void runAction(
                                          `reply_fulfill_${req.id}`,
                                          {
                                            action: 'fulfill_request',
                                            requestId: req.id,
                                            matchedPictaPubId: m.id,
                                            matchedPictaUrl: m.webUrl,
                                            replyCommentText: `¡Hola! Ya está disponible en Picta ("${m.title}"). Puedes verlo aquí: ${m.webUrl}`,
                                          },
                                          true
                                        )
                                      }
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-medium cursor-pointer whitespace-nowrap"
                                    >
                                      <Send className="w-3 h-3" />
                                      Responder comentario
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* Row 3: Recent Publications & Comments */}
      <div className={`grid grid-cols-1 ${focusMode === 'full' ? 'lg:grid-cols-2' : ''} gap-5`}>
        {focusMode === 'full' && (
        <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-3">
          <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
            <Film className="w-4 h-4 text-cyan-500" />
            Publicaciones Recientes ({overview?.publications.length || 0})
          </h3>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(overview?.publications || []).slice(0, 20).map((pub) => (
              <div
                key={pub.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 dark:border-slate-800 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {pub.nombre}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    #{pub.id} · 👁 {pub.cantidad_visitas || 0} · ❤️ {pub.cantidad_me_gusta || 0}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() =>
                      void runAction(`vis_${pub.id}`, {
                        action: 'toggle_pub_visibility',
                        pubId: pub.id,
                        publicado: !pub.publicado,
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] inline-flex items-center gap-1 cursor-pointer"
                    title="Alternar visibilidad"
                  >
                    {pub.publicado !== false ? (
                      <>
                        <Eye className="w-3 h-3 text-emerald-500" /> Público
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3 h-3 text-amber-500" /> Oculto
                      </>
                    )}
                  </button>
                  <button
                    onClick={() =>
                      void runAction(`dl_${pub.id}`, {
                        action: 'toggle_pub_download',
                        pubId: pub.id,
                        descargas: !pub.descargas,
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] cursor-pointer"
                  >
                    {pub.descargas ? 'DL: ON' : 'DL: OFF'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-5 space-y-4">
          {(() => {
            const allComments = overview?.comments || [];
            const unansweredCount = allComments.filter(
              (c) => !c.parentId && (!c.replyCount || c.replyCount === 0)
            ).length;
            const repliesCount = allComments.filter((c) => Boolean(c.parentId)).length;
            const detectedRequestsCount = allComments.filter((c) =>
              Boolean(c.detectedRequestTitle || c.linkedRequestId)
            ).length;
            const categoryMap = new Map<string, number>();
            for (const c of allComments) {
              const cat = (c.categoriaNombre || 'Otros').trim() || 'Otros';
              categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
            }
            const dynamicCategories = Array.from(categoryMap.entries()).sort((a, b) => b[1] - a[1]);
            const effectiveCategory =
              commentCategory === 'all' ||
              commentCategory === 'unanswered' ||
              commentCategory === 'replies' ||
              commentCategory === 'requests' ||
              categoryMap.has(commentCategory)
                ? commentCategory
                : 'all';

            const q = commentSearch.trim().toLowerCase();
            const filtered = allComments.filter((c) => {
              if (effectiveCategory === 'unanswered') {
                if (c.parentId || (c.replyCount && c.replyCount > 0)) return false;
              } else if (effectiveCategory === 'replies') {
                if (!c.parentId) return false;
              } else if (effectiveCategory === 'requests') {
                if (!c.detectedRequestTitle && !c.linkedRequestId) return false;
              } else if (effectiveCategory !== 'all') {
                const cat = (c.categoriaNombre || 'Otros').trim() || 'Otros';
                if (cat !== effectiveCategory) return false;
              }
              if (!q) return true;
              return (
                c.texto.toLowerCase().includes(q) ||
                c.usuario.toLowerCase().includes(q) ||
                c.publicacionNombre.toLowerCase().includes(q) ||
                (c.categoriaNombre || '').toLowerCase().includes(q) ||
                (c.detectedRequestTitle || '').toLowerCase().includes(q) ||
                String(c.publicacionId).includes(q)
              );
            });

            filtered.sort((a, b) => {
              const tA = a.fecha ? new Date(a.fecha).getTime() : a.id;
              const tB = b.fecha ? new Date(b.fecha).getTime() : b.id;
              return commentSort === 'recent' ? tB - tA : tA - tB;
            });

            const PAGE_SIZE = 20;
            const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
            const safePage = Math.max(0, Math.min(commentPage, totalPages - 1));
            const visibleComments = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

            return (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold font-display text-slate-900 dark:text-white flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-cyan-500" />
                      Dashboard de Comentarios ({allComments.length})
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                      Mostrando {filtered.length} comentarios · {unansweredCount} sin respuesta · {detectedRequestsCount} pedidos detectados
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <select
                      value={commentSort}
                      onChange={(e) => {
                        setCommentSort(e.target.value as 'recent' | 'oldest');
                        setCommentPage(0);
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200"
                    >
                      <option value="recent">Más recientes primero</option>
                      <option value="oldest">Más viejos primero</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => {
                      setCommentCategory('all');
                      setCommentPage(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                      effectiveCategory === 'all'
                        ? 'bg-cyan-600 text-white border-cyan-600'
                        : 'bg-slate-50 dark:bg-[#060B14] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-cyan-500/40'
                    }`}
                  >
                    Todos ({allComments.length})
                  </button>
                  <button
                    onClick={() => {
                      setCommentCategory('requests');
                      setCommentPage(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                      effectiveCategory === 'requests'
                        ? 'bg-cyan-600 text-white border-cyan-600'
                        : 'bg-slate-50 dark:bg-[#060B14] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-cyan-500/40'
                    }`}
                  >
                    Pedidos detectados ({detectedRequestsCount})
                  </button>
                  <button
                    onClick={() => {
                      setCommentCategory('unanswered');
                      setCommentPage(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                      effectiveCategory === 'unanswered'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-slate-50 dark:bg-[#060B14] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-500/40'
                    }`}
                  >
                    Sin respuesta ({unansweredCount})
                  </button>
                  <button
                    onClick={() => {
                      setCommentCategory('replies');
                      setCommentPage(0);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                      effectiveCategory === 'replies'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 dark:bg-[#060B14] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/40'
                    }`}
                  >
                    Respuestas ({repliesCount})
                  </button>
                  {dynamicCategories.map(([catName, count]) => (
                    <button
                      key={catName}
                      onClick={() => {
                        setCommentCategory(catName);
                        setCommentPage(0);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border cursor-pointer transition-colors ${
                        effectiveCategory === catName
                          ? 'bg-cyan-600 text-white border-cyan-600'
                          : 'bg-slate-50 dark:bg-[#060B14] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-cyan-500/40'
                      }`}
                    >
                      {catName} ({count})
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Filtrar por texto, usuario, categoría o video..."
                    value={commentSearch}
                    onChange={(e) => {
                      setCommentSearch(e.target.value);
                      setCommentPage(0);
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="ID Video"
                    value={commentPubId}
                    onChange={(e) => setCommentPubId(e.target.value)}
                    className="w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5 text-xs font-mono"
                  />
                  {replyingToCommentId && (
                    <span className="text-[11px] font-mono text-cyan-500 bg-cyan-500/10 px-2 py-1 rounded">
                      Respondiendo a #{replyingToCommentId}
                    </span>
                  )}
                  <input
                    type="text"
                    placeholder={
                      replyingToCommentId
                        ? 'Escribe tu respuesta...'
                        : 'Escribir comentario oficial en video...'
                    }
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#060B14] px-2.5 py-1.5 text-xs"
                  />
                  <button
                    onClick={() => {
                      const pid = Number(commentPubId || overview?.publications[0]?.id || 0);
                      if (!pid || !commentText.trim()) return;
                      void runAction('post_comment', {
                        action: 'post_comment',
                        pubId: pid,
                        texto: commentText.trim(),
                        ...(replyingToCommentId ? { parentCommentId: replyingToCommentId } : {}),
                      }).then(() => {
                        setCommentText('');
                        setReplyingToCommentId(null);
                      });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                  >
                    {replyingToCommentId ? 'Responder' : 'Comentar'}
                  </button>
                  {replyingToCommentId && (
                    <button
                      onClick={() => setReplyingToCommentId(null)}
                      className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-500 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  )}
                </div>

                <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                  {visibleComments.length === 0 ? (
                    <div className="text-xs text-slate-400 py-6 text-center">
                      {allComments.length === 0
                        ? 'Sin comentarios registrados en el canal.'
                        : 'Ningún comentario coincide con esta categoría o búsqueda.'}
                    </div>
                  ) : (
                    visibleComments.map((c) => {
                      const formattedDate = c.fecha
                        ? (() => {
                            try {
                              const d = new Date(c.fecha);
                              return isNaN(d.getTime()) ? c.fecha : d.toLocaleString();
                            } catch {
                              return c.fecha;
                            }
                          })()
                        : `Comentario #${c.id}`;

                      return (
                        <div
                          key={c.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-[#060B14]/50 px-3.5 py-2.5 text-xs transition-colors hover:border-cyan-500/30"
                        >
                          <div className="min-w-0 space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold font-mono text-cyan-600 dark:text-cyan-400">
                                @{c.usuario}
                              </span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                                {c.categoriaNombre || 'Otros'}
                              </span>
                              {c.parentId ? (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                  Respuesta
                                </span>
                              ) : !c.replyCount ? (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                  Sin responder
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-600 dark:text-slate-300">
                                  {c.replyCount} resp.
                                </span>
                              )}
                              <span className="text-[11px] font-mono text-slate-400">
                                · Video:{' '}
                                <b className="text-slate-700 dark:text-slate-300">
                                  {c.publicacionNombre || `#${c.publicacionId}`}
                                </b>
                              </span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                {formattedDate}
                              </span>
                            </div>
                            <p className="text-slate-800 dark:text-slate-200 break-words leading-relaxed">
                              {c.texto}
                            </p>
                            {(c.detectedRequestTitle || c.linkedRequestId) && (
                              <div className="text-[11px] text-cyan-600 dark:text-cyan-400 font-medium pt-0.5">
                                Pedido reconocido:{' '}
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {c.detectedRequestTitle || c.texto.slice(0, 60)}
                                </span>
                                {c.linkedRequestStatus && (
                                  <span className="text-slate-500 dark:text-slate-400">
                                    {' '}
                                    · {c.linkedRequestStatus === 'fulfilled' ? 'Cumplido' : 'En lista de pedidos'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0 pt-0.5">
                            {!c.linkedRequestId && (
                              <button
                                onClick={() =>
                                  void runAction(
                                    `imp_cm_${c.id}`,
                                    {
                                      action: 'import_comment_request',
                                      commentId: c.id,
                                      pubId: c.publicacionId,
                                      pubNombre: c.publicacionNombre,
                                      usuario: c.usuario,
                                      texto: c.texto,
                                      customTitle: c.detectedRequestTitle,
                                    },
                                    true
                                  )
                                }
                                className="px-2 py-1 rounded border border-emerald-500/35 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-[11px] font-medium cursor-pointer whitespace-nowrap"
                                title="Enviar este comentario al Gestor de Pedidos"
                              >
                                + Pedido
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setCommentPubId(String(c.publicacionId));
                                setReplyingToCommentId(c.id);
                              }}
                              className="px-2 py-1 rounded border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 text-[11px] font-medium cursor-pointer"
                              title="Responder a este comentario"
                            >
                              Responder
                            </button>
                            <button
                              onClick={() =>
                                void runAction(`del_cm_${c.id}`, {
                                  action: 'delete_comment',
                                  commentId: c.id,
                                })
                              }
                              className="text-rose-500 hover:text-rose-400 p-1.5 rounded hover:bg-rose-500/10 cursor-pointer"
                              title="Eliminar comentario"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-slate-800 text-xs">
                    <span className="text-slate-500 font-mono">
                      Página {safePage + 1} de {totalPages} ({filtered.length} comentarios)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={safePage === 0}
                        onClick={() => setCommentPage(Math.max(0, safePage - 1))}
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                      >
                        Anterior
                      </button>
                      <button
                        disabled={safePage >= totalPages - 1}
                        onClick={() => setCommentPage(Math.min(totalPages - 1, safePage + 1))}
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
