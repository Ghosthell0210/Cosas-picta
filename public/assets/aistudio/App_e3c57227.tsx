import React, { Suspense, lazy, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  HardDrive,
  Moon,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sun,
  Terminal,
  Trash2,
  UserCheck,
  Webhook,
  Wrench,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
const PictaApiToolkitPanel = lazy(() =>
  import('./components/PictaApiToolkitPanel').then((m) => ({ default: m.PictaApiToolkitPanel }))
);
import type { LiveSystemState, TransferStage, VideoTransferJob } from './types';

type ActiveSection = 'monitor' | 'transfers' | 'toolkit' | 'logs';
type JobFilter = 'all' | 'active' | 'completed' | 'failed';

interface SpeedTelemetryPoint {
  time: string;
  downloadMBps: number;
  uploadMBps: number;
}

function createInitialSpeedHistory(): SpeedTelemetryPoint[] {
  const now = Date.now();
  return Array.from({ length: 12 }, (_, idx) => {
    const t = new Date(now - (11 - idx) * 2000);
    return {
      time: t.toLocaleTimeString('es-CU', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      downloadMBps: 0,
      uploadMBps: 0,
    };
  });
}

function formatBytesExact(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDurationSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getStageLabel(stage: TransferStage): {
  label: string;
  tone: 'amber' | 'cyan' | 'emerald' | 'rose';
  stepIndex: number;
} {
  switch (stage) {
    case 'awaiting_category':
      return {
        label: 'Esperando elección de categoría en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_series_selection':
      return {
        label: 'Serie: Eligiendo serie del canal en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_new_series_name':
      return {
        label: 'Serie: Escribiendo nombre de nueva serie en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_season_selection':
      return {
        label: 'Serie: Confirmando temporada y capítulo en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_title_choice':
      return {
        label: 'Esperando elección de título en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_manual_title':
    case 'awaiting_step_title':
      return {
        label: 'Paso 1/4: Esperando título en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_step_synopsis':
      return {
        label: 'Paso 2/4: Esperando descripción en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_step_cover':
      return {
        label: 'Paso 3/4: Esperando portada en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'awaiting_step_subtitles':
      return {
        label: 'Paso 4/4: Esperando subtítulos en Telegram',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'queued':
      return {
        label: 'En cola de espera automática',
        tone: 'amber',
        stepIndex: 1,
      };
    case 'generating_auto_title':
      return {
        label: 'Generando título y sinopsis automáticos',
        tone: 'cyan',
        stepIndex: 1,
      };
    case 'downloading_mtproto':
      return {
        label: 'Descargando video en Cloud Run (MTProto 2 GB)',
        tone: 'cyan',
        stepIndex: 2,
      };
    case 'verifying_integrity':
      return {
        label: 'Verificando 100% del archivo en disco',
        tone: 'cyan',
        stepIndex: 3,
      };
    case 'uploading_full_file_to_picta':
      return {
        label: 'Transmitiendo archivo 100% entero a S3 MinIO',
        tone: 'cyan',
        stepIndex: 4,
      };
    case 'creating_picta_publication':
      return {
        label: 'Registrando publicación y conversión Nomad en Picta',
        tone: 'cyan',
        stepIndex: 4,
      };
    case 'completed':
      return {
        label: 'Publicado íntegramente en Picta',
        tone: 'emerald',
        stepIndex: 4,
      };
    case 'cancelled':
      return {
        label: 'Subida cancelada por el usuario',
        tone: 'rose',
        stepIndex: 0,
      };
    case 'failed':
      return {
        label: 'Error reportado en transferencia',
        tone: 'rose',
        stepIndex: 0,
      };
  }
}

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>('monitor');
  const [liveState, setLiveState] = useState<LiveSystemState | null>(null);
  const [speedHistory, setSpeedHistory] = useState<SpeedTelemetryPoint[]>(() =>
    createInitialSpeedHistory()
  );
  const lastBytesSnapshotRef = useRef<{
    jobId: string | null;
    downloadedBytes: number;
    uploadedBytes: number;
    timestampMs: number;
  }>({
    jobId: null,
    downloadedBytes: 0,
    uploadedBytes: 0,
    timestampMs: Date.now(),
  });

  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [logSourceFilter, setLogSourceFilter] = useState<string>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logViewTab, setLogViewTab] = useState<'events' | 'mtproto'>('mtproto');
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [copiedMtprotoLogs, setCopiedMtprotoLogs] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const fetchLiveState = useCallback(async () => {
    try {
      const res = await fetch('/api/live-state');
      if (res.ok) {
        const data = (await res.json()) as LiveSystemState;
        setLiveState(data);

        const nowMs = Date.now();
        const currentJob = data.jobs.find(
          (j) =>
            j.id === data.activeJobId ||
            [
              'downloading_mtproto',
              'verifying_integrity',
              'uploading_full_file_to_picta',
              'creating_picta_publication',
            ].includes(j.stage)
        );

        let downloadMBps = 0;
        let uploadMBps = 0;

        if (currentJob) {
          const prev = lastBytesSnapshotRef.current;
          const elapsedSec = Math.max(0.5, (nowMs - prev.timestampMs) / 1000);

          if (currentJob.stage === 'downloading_mtproto') {
            const deltaDown =
              prev.jobId === currentJob.id
                ? Math.max(0, currentJob.downloadedBytes - prev.downloadedBytes)
                : 0;
            const instantDownMBps = deltaDown / (1024 * 1024) / elapsedSec;
            downloadMBps = Number(
              (instantDownMBps > 0 ? instantDownMBps : currentJob.speedMBps || 0).toFixed(2)
            );
          } else if (currentJob.stage === 'uploading_full_file_to_picta') {
            const deltaUp =
              prev.jobId === currentJob.id
                ? Math.max(0, currentJob.uploadedBytes - prev.uploadedBytes)
                : 0;
            const instantUpMBps = deltaUp / (1024 * 1024) / elapsedSec;
            uploadMBps = Number(
              (instantUpMBps > 0 ? instantUpMBps : currentJob.speedMBps || 0).toFixed(2)
            );
          }

          lastBytesSnapshotRef.current = {
            jobId: currentJob.id,
            downloadedBytes: currentJob.downloadedBytes,
            uploadedBytes: currentJob.uploadedBytes,
            timestampMs: nowMs,
          };
        } else {
          lastBytesSnapshotRef.current = {
            jobId: null,
            downloadedBytes: 0,
            uploadedBytes: 0,
            timestampMs: nowMs,
          };
        }

        const timeLabel = new Date(nowMs).toLocaleTimeString('es-CU', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        setSpeedHistory((prev) => [
          ...prev.slice(-29),
          {
            time: timeLabel,
            downloadMBps,
            uploadMBps,
          },
        ]);
      }
    } catch {
      // Keep last known state
    }
  }, []);

  useEffect(() => {
    void fetchLiveState();
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        void fetchLiveState();
      }
    }, 2500);
    const handleVisibility = () => {
      if (!document.hidden) {
        void fetchLiveState();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchLiveState]);

  const activeJob: VideoTransferJob | undefined = useMemo(
    () =>
      liveState?.jobs.find(
        (j) =>
          j.id === liveState.activeJobId ||
          [
            'awaiting_title_choice',
            'awaiting_manual_title',
            'generating_auto_title',
            'downloading_mtproto',
            'verifying_integrity',
            'uploading_full_file_to_picta',
            'creating_picta_publication',
          ].includes(j.stage)
      ),
    [liveState?.jobs, liveState?.activeJobId]
  );

  const failedJobs = useMemo(
    () => (liveState?.jobs || []).filter((j) => j.stage === 'failed'),
    [liveState?.jobs]
  );
  const latestFailedJob = failedJobs[0];

  const filteredJobs = useMemo(
    () =>
      (liveState?.jobs || []).filter((job) => {
        const q = searchQuery.trim().toLowerCase();
        const matchesSearch =
          !q ||
          job.title.toLowerCase().includes(q) ||
          job.fileName.toLowerCase().includes(q) ||
          job.senderName.toLowerCase().includes(q) ||
          Boolean(job.category && job.category.toLowerCase().includes(q));

        if (!matchesSearch) return false;
        if (jobFilter === 'all') return true;
        if (jobFilter === 'completed') return job.stage === 'completed';
        if (jobFilter === 'failed') return job.stage === 'failed';
        if (jobFilter === 'active') {
          return job.stage !== 'completed' && job.stage !== 'failed';
        }
        return true;
      }),
    [liveState?.jobs, searchQuery, jobFilter]
  );

  const filteredLogs = useMemo(
    () =>
      (liveState?.logs || []).filter((log) => {
        if (logSourceFilter !== 'all' && log.source !== logSourceFilter) return false;
        if (logSearchQuery.trim()) {
          const q = logSearchQuery.toLowerCase();
          return (
            log.message.toLowerCase().includes(q) ||
            log.source.toLowerCase().includes(q) ||
            log.level.toLowerCase().includes(q)
          );
        }
        return true;
      }),
    [liveState?.logs, logSourceFilter, logSearchQuery]
  );

  const filteredMtprotoLogs = useMemo(() => {
    const entries = liveState?.mtprotoLogs || [];
    if (!logSearchQuery.trim()) return entries;
    const q = logSearchQuery.toLowerCase();
    return entries.filter(
      (entry) =>
        entry.message.toLowerCase().includes(q) ||
        (entry.fileName && entry.fileName.toLowerCase().includes(q)) ||
        (entry.reparto && entry.reparto.toLowerCase().includes(q)) ||
        (entry.dcId !== undefined && `dc #${entry.dcId}`.includes(q))
    );
  }, [liveState?.mtprotoLogs, logSearchQuery]);

  const latestMtprotoMetrics = useMemo(
    () =>
      (liveState?.mtprotoLogs || []).find(
        (entry) =>
          entry.dcId !== undefined ||
          entry.windowMBps !== undefined ||
          entry.activeSockets !== undefined
      ) || null,
    [liveState?.mtprotoLogs]
  );

  const navItems: Array<{ id: ActiveSection; label: string }> = [
    { id: 'monitor', label: 'Estado en Vivo' },
    { id: 'transfers', label: 'Videos Telegram' },
    { id: 'toolkit', label: 'Centro API Picta' },
    { id: 'logs', label: 'Registro Eventos' },
  ];

  const activeProgressRatio = activeJob
    ? activeJob.stage === 'uploading_full_file_to_picta' ||
      activeJob.stage === 'creating_picta_publication'
      ? Math.min(
          1,
          activeJob.expectedBytes > 0 ? activeJob.uploadedBytes / activeJob.expectedBytes : 0
        )
      : Math.min(
          1,
          activeJob.expectedBytes > 0 ? activeJob.downloadedBytes / activeJob.expectedBytes : 0.15
        )
    : 0;

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-slate-900 dark:bg-[#050811] dark:text-slate-100 orbital-grid-backdrop flex flex-col">
      {/* TOP BAR CONTRACT: 3 CLEAN ZONES */}
      <header className="h-14 border-b border-slate-200/90 dark:border-cyan-500/15 bg-white/90 dark:bg-[#080E1A]/90 backdrop-blur-md px-6 flex items-center justify-between gap-8 shrink-0 sticky top-0 z-30">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#monitor"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('monitor');
          }}
          className="flex items-center gap-2.5 text-base font-bold tracking-tight font-display text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          <span className="w-7 h-7 rounded-lg border border-cyan-500/35 bg-cyan-500/10 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="8.5" strokeDasharray="3 2" />
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </span>
          <span>Bot de Picta</span>
        </a>

        {/* Zone 2: Primary Navigation Links (Single-line text links) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`relative py-4 text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-xs ${
                  isActive
                    ? 'text-cyan-700 dark:text-cyan-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-cyan-600 dark:bg-cyan-400" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary External Action (+ real failure alert if present) */}
        <div className="flex items-center gap-3 shrink-0">
          {latestFailedJob && (
            <button
              type="button"
              onClick={() => {
                setActiveSection('transfers');
                setJobFilter('failed');
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs font-medium hover:bg-rose-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title={`Fallo reportado: ${latestFailedJob.title}`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span className="tabular-nums">
                {failedJobs.length === 1 ? '1 Fallo' : `${failedJobs.length} Fallos`}
              </span>
            </button>
          )}
          <a
            href="https://admin.picta.cu/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <span>admin.picta.cu</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* LEFT ORBITAL SIDEBAR: NAVIGATION & ACCOUNT TELEMETRY */}
        <aside className="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-slate-200/90 dark:border-cyan-500/15 bg-white/85 dark:bg-[#080E1A]/95 backdrop-blur-sm p-4 flex flex-col justify-between shrink-0">
          <div className="space-y-6">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 px-3 mb-2">
                Módulos del Sistema
              </div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setActiveSection('monitor')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeSection === 'monitor'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Activity className="w-4 h-4 shrink-0" />
                    <span>01. Estado en Vivo</span>
                  </span>
                  {activeJob && (
                    <span className="text-[11px] font-mono">Activo</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('transfers')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeSection === 'transfers'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Server className="w-4 h-4 shrink-0" />
                    <span>02. Videos Telegram</span>
                  </span>
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      activeSection === 'transfers'
                        ? 'text-cyan-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {liveState?.jobs.length || 0}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('toolkit')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeSection === 'toolkit'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Wrench className="w-4 h-4 shrink-0" />
                    <span>03. Centro API Picta</span>
                  </span>
                  <span
                    className={`text-xs font-mono ${
                      activeSection === 'toolkit'
                        ? 'text-cyan-100'
                        : 'text-cyan-600 dark:text-cyan-400'
                    }`}
                  >
                    API
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection('logs')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeSection === 'logs'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 shrink-0" />
                    <span>04. Registro Eventos</span>
                  </span>
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      activeSection === 'logs'
                        ? 'text-cyan-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {liveState?.logs.length || 0}
                  </span>
                </button>
              </div>
            </div>

            {/* Account & Channel Information */}
            <div className="pt-4 border-t border-slate-200/90 dark:border-cyan-500/15 space-y-3">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Cuenta Principal
              </div>
              <div className="p-3.5 rounded-lg border border-slate-200/90 dark:border-cyan-500/20 bg-slate-50 dark:bg-[#0B1220] space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                    @{liveState?.pictaUser?.username || 'Ghosthell'}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {liveState?.pictaUser?.phoneNumber || '+5356942234'}
                  </span>
                </div>
                <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  {liveState?.pictaUser
                    ? `${liveState.pictaUser.firstName} ${liveState.pictaUser.lastName}`
                    : 'Cristhian Perez'}
                </div>
                <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  Multiverso Visual · #36319
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {liveState?.pictaUser?.roles.join(' · ') || 'Jefe de canal'}
                </div>
              </div>

              <div className="space-y-2 text-xs pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-cyan-500" />
                    Bot Telegram
                  </span>
                  <span className="font-mono font-medium text-cyan-700 dark:text-cyan-300">
                    @{liveState?.botProfile?.username || 'Picta2bot'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Instancia</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {liveState?.isPreviewInstance ? 'Modo Espejo' : 'Cloud Run'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">ID del Bot</span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {liveState?.botProfile?.id || '9004203200'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-cyan-500" />
                    MTProto
                  </span>
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                    23067663 · 2 GB
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Transmisión</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                    S3 Full-Wait 100%
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Tiempo en línea</span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {formatUptime(liveState?.uptimeSeconds || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200/90 dark:border-cyan-500/15">
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-slate-200/90 dark:border-cyan-500/20 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10 transition-colors cursor-pointer"
            >
              <span>Tema Visual</span>
              <span className="flex items-center gap-1.5 text-cyan-700 dark:text-cyan-300">
                {darkMode ? (
                  <>
                    <Moon className="w-3.5 h-3.5" /> Oscuro Orbital
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5" /> Claro Orbital
                  </>
                )}
              </span>
            </button>
          </div>
        </aside>

        {/* MAIN VIEWPORT */}
        <main className="flex-1 p-6 lg:p-8 space-y-6 overflow-x-hidden">
          {/* Cloud Run Isolation Notice */}
          {liveState?.isPreviewInstance && (
            <div className="p-4 rounded-xl border border-cyan-500/25 bg-cyan-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    Protección Anti-Doble Respuesta Activa: El bot de esta vista previa está silenciado
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Esta instancia local no ejecuta <code className="font-mono">getUpdates</code> para evitar conflictos. Responde únicamente la instancia publicada en <strong>Google Cloud Run</strong> vía Webhook (<code className="font-mono">/api/telegram/webhook</code>).
                </p>
              </div>
            </div>
          )}

          {/* Prominent Alert Banner when a transfer has failed */}
          {latestFailedJob && (
            <div className="p-4 rounded-xl border border-rose-500/35 bg-rose-500/10 flex flex-col gap-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg border border-rose-500/30 bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 font-semibold">
                      <span>Publicación Fallida en Picta</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">HTTP / Transferencia</span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 font-medium">
                      Video: <strong className="font-semibold">{latestFailedJob.title}</strong> ({latestFailedJob.fileName}) · Categoría: {latestFailedJob.category || 'Película'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await fetch(`/api/republish-job/${latestFailedJob.id}`, { method: 'POST' });
                        fetchLiveState();
                      } catch {
                        // Ignore
                      }
                    }}
                    className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors shrink-0 cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{latestFailedJob.minioKey ? 'Reintentar Publicar Ficha' : 'Reintentar'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSection('transfers');
                      setJobFilter('failed');
                    }}
                    className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium transition-colors shrink-0 cursor-pointer whitespace-nowrap"
                  >
                    Ver en Historial
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await fetch(`/api/jobs/${latestFailedJob.id}`, { method: 'DELETE' });
                        fetchLiveState();
                      } catch {
                        // Ignore
                      }
                    }}
                    title="Quitar del historial"
                    className="px-3 py-2 rounded-lg border border-rose-500/35 bg-white/80 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-200 font-medium transition-colors shrink-0 cursor-pointer flex items-center gap-1 whitespace-nowrap"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Quitar</span>
                  </button>
                </div>
              </div>

              {latestFailedJob.errorDetails && (
                <div className="p-3 rounded-lg bg-white/80 dark:bg-[#060913] border border-rose-500/25 font-mono text-[11px] leading-relaxed text-rose-800 dark:text-rose-200 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  <div className="font-semibold text-rose-900 dark:text-rose-100 mb-1">
                    Detalle completo del error reportado por Picta:
                  </div>
                  {latestFailedJob.errorDetails}
                </div>
              )}
            </div>
          )}

          {/* ===================================================================
              VIEW 1: MONITOR EN VIVO
             =================================================================== */}
          {activeSection === 'monitor' && (
            <div className="space-y-6">
              <section className="p-6 rounded-xl border border-slate-200/90 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-cyan-500/15 pb-4">
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                      <span className="text-cyan-700 dark:text-cyan-400 font-medium">
                        Telemetría Orbital en Vivo
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Cuenta Picta: @{liveState?.pictaUser?.username || 'Ghosthell'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Canal: Multiverso Visual (#36319)</span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
                      {liveState?.currentActivity ||
                        'Monitoreando estado del Bot de Picta en tiempo real'}
                    </h1>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <Webhook className="w-3.5 h-3.5 text-cyan-500" />
                    <span>
                      Último evento:{' '}
                      {liveState?.lastWakeUpAt
                        ? new Date(liveState.lastWakeUpAt).toLocaleTimeString('es-CU')
                        : 'En espera'}
                    </span>
                  </div>
                </div>

                {/* 4-Stage Pipeline Indicator */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    {
                      step: '01. Webhook y Asistente Telegram',
                      desc: 'Recibe el video en @Picta2bot y guía categoría, serie, título y portada.',
                      index: 1,
                    },
                    {
                      step: '02. Descarga MTProto 2 GB',
                      desc: `Descarga el archivo íntegro en ${liveState?.systemMetrics?.scratchDir || '/tmp/picta_uploads'} (${liveState?.systemMetrics?.isEphemeralVolume ? 'Disco Efímero' : 'Almacenamiento'}).`,
                      index: 2,
                    },
                    {
                      step: '03. Verificación 100% en Disco',
                      desc: 'Comprueba bytes_en_disco === bytes_esperados antes de abrir conexión S3.',
                      index: 3,
                    },
                    {
                      step: '04. S3 MinIO -> Publicación Picta',
                      desc: 'Sube el 100% a videos.picta.cu y registra la ficha en el canal destino.',
                      index: 4,
                    },
                  ].map((item) => {
                    const currentStep = activeJob ? getStageLabel(activeJob.stage).stepIndex : 0;
                    const isCurrent = currentStep === item.index;
                    const isPassed = currentStep > item.index;

                    return (
                      <div
                        key={item.step}
                        className={`p-4 rounded-lg border transition-colors ${
                          isCurrent
                            ? 'border-cyan-500/70 bg-cyan-500/10'
                            : isPassed
                              ? 'border-emerald-500/40 bg-emerald-500/5'
                              : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#070C16]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {item.step}
                          </span>
                          <span
                            className={`text-xs font-mono ${
                              isCurrent
                                ? 'text-cyan-600 dark:text-cyan-300 font-semibold'
                                : isPassed
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {isCurrent ? 'Activo' : isPassed ? 'Listo' : 'Espera'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {item.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {activeJob && (
                  <div className="pt-4 border-t border-slate-200/80 dark:border-cyan-500/15 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                          {getStageLabel(activeJob.stage).label}
                        </span>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 font-display">
                          {activeJob.title} ({activeJob.fileName})
                        </h2>
                      </div>
                      <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        <span>
                          Descargado: {formatBytesExact(activeJob.downloadedBytes)} /{' '}
                          {formatBytesExact(activeJob.expectedBytes)}
                        </span>
                        <span className="mx-2">·</span>
                        <span>S3: {formatBytesExact(activeJob.uploadedBytes)}</span>
                        <span className="mx-2">·</span>
                        <span className="text-cyan-600 dark:text-cyan-400 font-semibold">
                          {activeJob.speedMBps} MB/s
                        </span>
                      </div>
                    </div>

                    <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800/90 rounded-sm overflow-hidden border border-slate-300/60 dark:border-cyan-500/20">
                      <div
                        className="h-full bg-cyan-500 transition-transform duration-150 origin-left"
                        style={{
                          transform: `scaleX(${activeProgressRatio})`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* HIGHLIGHTED 24-HOUR METRICS STRIP */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 rounded-xl border border-slate-200/90 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Tasa de Éxito en 24 Horas</span>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      Últimas 24h
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-3">
                    <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {(liveState?.stats.successRate24h ?? 100).toFixed(1)}%
                    </div>
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {liveState?.stats.total24h === 0
                        ? 'Sin transferencias finalizadas en 24h'
                        : `${liveState?.stats.completed24h ?? 0} completados · ${liveState?.stats.failed24h ?? 0} fallidos`}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Proporción de subidas a Picta completadas con éxito respecto al total en 24h.
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200/90 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>Tiempo Promedio por Archivo (24h)</span>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      Flujo completo
                    </span>
                  </div>
                  <div className="mt-3 flex items-baseline gap-3">
                    <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatDurationSeconds(liveState?.stats.avgProcessingTimeSeconds24h ?? 0)}
                    </div>
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {!liveState?.stats?.completed24h
                        ? 'En espera de primer video completado'
                        : `Promedio en ${liveState.stats.completed24h} publicaciones de 24h`}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Tiempo medio transcurrido desde la recepción en Telegram hasta su publicación.
                  </div>
                </div>
              </section>

              {/* 4-COLUMN KPI METRIC STRIP */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl border border-slate-200/90 dark:border-cyan-500/15 bg-white dark:bg-[#0B1220]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Videos Recibidos por Telegram
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {liveState?.stats.totalReceived ?? 0}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {liveState?.stats.activeTransfers ?? 0} en procesamiento activo
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200/90 dark:border-cyan-500/15 bg-white dark:bg-[#0B1220]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Capacidad MTProto Configurada
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                    2.00 GB
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    API_ID 23067663 · @Picta2bot
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200/90 dark:border-cyan-500/15 bg-white dark:bg-[#0B1220]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Publicados en Multiverso Visual
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {liveState?.stats.completedUploads ?? 0}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    Canal #36319 · @Ghosthell
                  </div>
                </div>

                <div className="p-5 rounded-xl border border-slate-200/90 dark:border-cyan-500/15 bg-white dark:bg-[#0B1220]">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Disco Efímero y RAM
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {liveState?.systemMetrics
                      ? formatBytesExact(liveState.systemMetrics.diskFreeBytes)
                      : formatBytesExact(liveState?.stats.totalBytesTransferred ?? 0)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                    {liveState?.systemMetrics
                      ? `${liveState.systemMetrics.storageType === 'ephemeral_disk' ? 'Disco Real' : 'Temp'} · RAM ${formatBytesExact(liveState.systemMetrics.rssBytes)}`
                      : 'Verificado 100% antes de Nomad'}
                  </div>
                </div>
              </section>

              {/* REAL-TIME SPEED TELEMETRY LINE CHART (RECHARTS) */}
              <section className="p-6 rounded-xl border border-slate-200/90 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                      Velocidad de Descarga y Subida en Tiempo Real (MB/s)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Telemetría en vivo del flujo MTProto 2 GB (Telegram → Disco) y S3 MinIO (Disco → Picta).
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-0.5 bg-cyan-400 inline-block" />
                      <span className="text-slate-500 dark:text-slate-400">MTProto:</span>
                      <span className="font-semibold text-cyan-600 dark:text-cyan-400">
                        {(speedHistory[speedHistory.length - 1]?.downloadMBps ?? 0).toFixed(2)} MB/s
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-0.5 bg-emerald-400 inline-block" />
                      <span className="text-slate-500 dark:text-slate-400">S3 Picta:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {(speedHistory[speedHistory.length - 1]?.uploadMBps ?? 0).toFixed(2)} MB/s
                      </span>
                    </div>
                  </div>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={speedHistory}
                      margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={darkMode ? 'rgba(34,211,238,0.10)' : '#e2e8f0'}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 11, fill: darkMode ? '#94a3b8' : '#64748b' }}
                        stroke={darkMode ? '#1e293b' : '#cbd5e1'}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: darkMode ? '#94a3b8' : '#64748b' }}
                        stroke={darkMode ? '#1e293b' : '#cbd5e1'}
                        unit=" MB/s"
                        width={70}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: darkMode ? '#080E1A' : '#ffffff',
                          borderColor: darkMode ? 'rgba(34,211,238,0.28)' : '#e2e8f0',
                          borderRadius: '0.5rem',
                          fontSize: '12px',
                          color: darkMode ? '#f1f5f9' : '#0f172a',
                        }}
                        formatter={(value: any, name: any) => [
                          `${Number(value || 0).toFixed(2)} MB/s`,
                          String(name),
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                      <Line
                        type="monotone"
                        dataKey="downloadMBps"
                        name="Descarga MTProto (MB/s)"
                        stroke="#22d3ee"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="uploadMBps"
                        name="Subida S3 Picta (MB/s)"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* SPLIT: RECENT TELEGRAM VIDEOS + LIVE CONSOLE STREAM */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <section className="lg:col-span-7 p-6 rounded-xl border border-slate-200/90 dark:border-cyan-500/15 bg-white dark:bg-[#0B1220] flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                          Últimos Videos Recibidos desde Telegram
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Seguimiento en vivo de las transferencias enviadas a @Picta2bot.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveSection('transfers')}
                        className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline shrink-0 cursor-pointer"
                      >
                        Ver historial ({liveState?.jobs.length || 0})
                      </button>
                    </div>

                    {!liveState?.jobs.length ? (
                      <div className="py-12 px-4 text-center rounded-lg border border-dashed border-slate-200 dark:border-cyan-500/20 space-y-2">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Aún no se han registrado videos en esta instancia
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                          Envía cualquier video por Telegram a{' '}
                          <code className="font-mono">@Picta2bot</code> y su flujo aparecerá aquí automáticamente.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200/80 dark:divide-cyan-500/10">
                        {liveState.jobs.slice(0, 5).map((job) => {
                          const stageMeta = getStageLabel(job.stage);
                          return (
                            <div
                              key={job.id}
                              className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                  {job.title}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                  <span>{job.fileName}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{formatBytesExact(job.expectedBytes)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-cyan-600 dark:text-cyan-400 font-medium">
                                    {job.category || 'Audiovisual'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    {job.titleMode === 'auto'
                                      ? 'Título automático'
                                      : job.titleMode === 'manual'
                                        ? 'Título manual'
                                        : 'Pendiente en chat'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <span
                                  className={`text-xs font-mono font-medium ${
                                    stageMeta.tone === 'emerald'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : stageMeta.tone === 'amber'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : stageMeta.tone === 'rose'
                                          ? 'text-rose-600 dark:text-rose-400'
                                          : 'text-cyan-600 dark:text-cyan-400'
                                  }`}
                                >
                                  {stageMeta.label}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-200/80 dark:border-cyan-500/15 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      Integridad estricta: verifica <code className="font-mono">bytes_en_disco === bytes_esperados</code> antes de publicar
                    </span>
                    <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  </div>
                </section>

                {/* LIVE LOGS STREAM PREVIEW */}
                <section className="lg:col-span-5 p-6 rounded-xl border border-slate-200/90 dark:border-cyan-500/15 bg-white dark:bg-[#0B1220] flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                          Eventos Recibidos del Bot
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Actividad registrada en vivo.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveSection('logs')}
                        className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline shrink-0 cursor-pointer"
                      >
                        Abrir registro
                      </button>
                    </div>

                    <div className="h-72 overflow-y-auto rounded-lg bg-slate-950 dark:bg-[#050811] p-3.5 font-mono text-xs space-y-2 border border-slate-800 dark:border-cyan-500/20">
                      {!liveState?.logs.length ? (
                        <div className="text-slate-500 py-8 text-center">
                          Esperando eventos...
                        </div>
                      ) : (
                        liveState.logs.slice(0, 18).map((log) => (
                          <div key={log.id} className="leading-relaxed break-words">
                            <span className="text-slate-500">
                              [{new Date(log.timestamp).toLocaleTimeString('es-CU')}]
                            </span>{' '}
                            <span
                              className={
                                log.level === 'success'
                                  ? 'text-emerald-400 font-semibold'
                                  : log.level === 'error'
                                    ? 'text-rose-400 font-semibold'
                                    : log.level === 'warn'
                                      ? 'text-amber-400 font-semibold'
                                      : 'text-cyan-400'
                              }
                            >
                              [{log.source.toUpperCase()}]
                            </span>{' '}
                            <span className="text-slate-200">{log.message}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-200/80 dark:border-cyan-500/15 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <span>Endpoint: /api/telegram/webhook</span>
                    <span>ACK 200 Inmediato</span>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* ===================================================================
              VIEW 2: HISTORIAL DE VIDEOS DE TELEGRAM
             =================================================================== */}
          {activeSection === 'transfers' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
                    Videos Recibidos desde Telegram
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Monitoreo en vivo de cada archivo enviado por Telegram hacia Picta.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filtrar por título o archivo..."
                      className="pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#080E1A] border border-slate-200 dark:border-cyan-500/15">
                    {(['all', 'active', 'completed', 'failed'] as JobFilter[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setJobFilter(f)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                          jobFilter === f
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {f === 'all'
                          ? 'Todos'
                          : f === 'active'
                            ? 'En Curso'
                            : f === 'completed'
                              ? 'Completados'
                              : 'Con Error'}
                      </button>
                    ))}
                  </div>

                  {failedJobs.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await fetch('/api/jobs/clear-failed', { method: 'POST' });
                          fetchLiveState();
                        } catch {
                          // Ignore
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-rose-500/35 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-200 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Limpiar fallidos ({failedJobs.length})</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/90 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] overflow-hidden">
                {!filteredJobs.length ? (
                  <div className="p-12 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      No hay registros que coincidan con el filtro
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Cuando envíes videos por Telegram a @Picta2bot, su progreso aparecerá aquí.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-cyan-500/15 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#080E1A]">
                          <th className="py-3 px-4 font-semibold">Video y Título Asignado</th>
                          <th className="py-3 px-4 font-semibold">Modo Título</th>
                          <th className="py-3 px-4 font-semibold">Descarga 2 GB</th>
                          <th className="py-3 px-4 font-semibold">Integridad 100%</th>
                          <th className="py-3 px-4 font-semibold">Subida S3 Picta</th>
                          <th className="py-3 px-4 font-semibold">Estado y Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/80 dark:divide-cyan-500/10 text-xs">
                        {filteredJobs.map((job) => {
                          const stageMeta = getStageLabel(job.stage);
                          return (
                            <tr key={job.id} className="align-top hover:bg-slate-50/70 dark:hover:bg-cyan-500/5 transition-colors">
                              <td className="py-3.5 px-4 max-w-xs">
                                <div className="font-semibold text-slate-900 dark:text-slate-100">
                                  {job.title}
                                </div>
                                <div className="font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                  {job.fileName}
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                  <span className="font-medium text-cyan-600 dark:text-cyan-400">
                                    {job.category || 'Audiovisual'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{job.targetChannelName || 'Multiverso Visual'}</span>
                                </div>
                                {job.minioKey && (
                                  <div className="font-mono text-[11px] text-cyan-600 dark:text-cyan-400 mt-0.5">
                                    minio_id: {job.minioKey}
                                  </div>
                                )}
                                {job.modelMetadata && Object.keys(job.modelMetadata).length > 0 && (
                                  <div className="mt-1.5 p-2 rounded bg-slate-50 dark:bg-[#070C16] border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono">
                                    {job.modelMetadata.ano && <div>Año: {String(job.modelMetadata.ano)}</div>}
                                    {job.modelMetadata.pais && <div>País: {String(job.modelMetadata.pais)}</div>}
                                    {job.modelMetadata.genero && (
                                      <div className="col-span-2 truncate">Género: {String(job.modelMetadata.genero)}</div>
                                    )}
                                    {job.modelMetadata.interprete && (
                                      <div className="col-span-2 truncate">Intérprete: {String(job.modelMetadata.interprete)}</div>
                                    )}
                                    {job.modelMetadata.director && (
                                      <div className="truncate">Director: {String(job.modelMetadata.director)}</div>
                                    )}
                                    {job.modelMetadata.productora && (
                                      <div className="truncate">Productora: {String(job.modelMetadata.productora)}</div>
                                    )}
                                    {job.modelMetadata.productor && (
                                      <div className="truncate">Productor: {String(job.modelMetadata.productor)}</div>
                                    )}
                                    {job.modelMetadata.sello && (
                                      <div className="truncate">Sello: {String(job.modelMetadata.sello)}</div>
                                    )}
                                    {job.modelMetadata.serie && (
                                      <div className="col-span-2 truncate">Serie: {String(job.modelMetadata.serie)}</div>
                                    )}
                                    {job.modelMetadata.temporada && (
                                      <div>
                                        T{String(job.modelMetadata.temporada)}:E{String(job.modelMetadata.numero || '1')}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {job.synopsis && (
                                  <p className="text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                    {job.synopsis}
                                  </p>
                                )}
                                {job.errorDetails && (
                                  <div className="mt-2 p-2.5 rounded-lg bg-rose-50/90 dark:bg-rose-950/50 border border-rose-500/30 font-mono text-[11px] leading-relaxed text-rose-800 dark:text-rose-200 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                    <div className="font-semibold text-rose-900 dark:text-rose-100 flex items-center gap-1.5 mb-1">
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                      <span>Detalle del error en Picta:</span>
                                    </div>
                                    {job.errorDetails}
                                  </div>
                                )}
                              </td>

                              <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                                {job.titleMode === 'auto'
                                  ? 'Automático (IA)'
                                  : job.titleMode === 'manual'
                                    ? 'Manual (Usuario)'
                                    : 'Pendiente en Chat'}
                              </td>

                              <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap">
                                <div>
                                  {formatBytesExact(job.downloadedBytes)} /{' '}
                                  {formatBytesExact(job.expectedBytes)}
                                </div>
                                <div className="text-slate-500 dark:text-slate-400">
                                  {job.expectedBytes > 0
                                    ? `${Math.min(
                                        100,
                                        Math.round(
                                          (job.downloadedBytes / job.expectedBytes) * 100
                                        )
                                      )}%`
                                    : '0%'}
                                </div>
                              </td>

                              <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                                {job.integrityVerified ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    Verificado 100% ({job.diskVerifiedBytes.toLocaleString()} B)
                                  </span>
                                ) : (
                                  <span className="text-slate-500 dark:text-slate-400">Pendiente</span>
                                )}
                              </td>

                              <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap">
                                <div>
                                  {formatBytesExact(job.uploadedBytes)} /{' '}
                                  {formatBytesExact(job.expectedBytes)}
                                </div>
                                {job.pictaResponseCode ? (
                                  <div className="text-slate-500 dark:text-slate-400">
                                    HTTP {job.pictaResponseCode}
                                  </div>
                                ) : null}
                              </td>

                              <td className="py-3.5 px-4 whitespace-nowrap space-y-2">
                                <div
                                  className={`font-mono font-medium ${
                                    stageMeta.tone === 'emerald'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : stageMeta.tone === 'amber'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : stageMeta.tone === 'rose'
                                          ? 'text-rose-600 dark:text-rose-400'
                                          : 'text-cyan-600 dark:text-cyan-400'
                                  }`}
                                >
                                  {stageMeta.label}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {(job.stage === 'failed' || (job.minioKey && job.stage !== 'completed')) && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await fetch(`/api/republish-job/${job.id}`, { method: 'POST' });
                                          fetchLiveState();
                                        } catch {
                                          // Ignore
                                        }
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-cyan-600 hover:bg-cyan-500 text-white transition-colors cursor-pointer"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>{job.minioKey ? 'Reintentar Ficha' : 'Reintentar'}</span>
                                    </button>
                                  )}
                                  {(job.stage === 'failed' || job.stage === 'completed' || job.stage === 'cancelled') && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
                                          fetchLiveState();
                                        } catch {
                                          // Ignore
                                        }
                                      }}
                                      title="Quitar del historial"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      <span>Quitar</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================================================================
              VIEW 3: CONSOLA DE LOGS EN VIVO
             =================================================================== */}
          {activeSection === 'logs' && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
                    Registro de Eventos en Vivo
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Diagnóstico de red MTProto (sockets, DC, latencia, reparto) y flujo general del sistema. En Telegram usa <code className="font-mono text-cyan-600 dark:text-cyan-400">/netlog</code>.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#080E1A] border border-slate-200 dark:border-cyan-500/15">
                    <button
                      type="button"
                      onClick={() => setLogViewTab('mtproto')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        logViewTab === 'mtproto'
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Red y Velocidad MTProto ({filteredMtprotoLogs.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogViewTab('events')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                        logViewTab === 'events'
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Eventos Generales ({filteredLogs.length})
                    </button>
                  </div>

                  <div className="relative min-w-[220px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar en logs (DC, socket, error)..."
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>

                  {logViewTab === 'events' && (
                    <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-[#080E1A] border border-slate-200 dark:border-cyan-500/15">
                      {(['all', 'webhook', 'telegram', 'mtproto', 'ai', 'picta'] as const).map(
                        (src) => (
                          <button
                            key={src}
                            type="button"
                            onClick={() => setLogSourceFilter(src)}
                            className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                              logSourceFilter === src
                                ? 'bg-cyan-600 text-white'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {src.toUpperCase()}
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {logViewTab === 'mtproto' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const text = filteredMtprotoLogs
                          .map((entry) => {
                            const ts = new Date(entry.timestamp).toLocaleTimeString('es-CU', {
                              hour12: false,
                            });
                            const meta = [
                              entry.dcId !== undefined ? `DC#${entry.dcId}` : null,
                              entry.activeSockets !== undefined
                                ? `${entry.activeSockets}/${entry.maxSockets ?? '?'} TCP`
                                : null,
                              entry.windowMBps !== undefined
                                ? `win=${entry.windowMBps.toFixed(2)}MB/s`
                                : null,
                              entry.avgMBps !== undefined
                                ? `avg=${entry.avgMBps.toFixed(2)}MB/s`
                                : null,
                              entry.cpuPct !== undefined ? `CPU=${entry.cpuPct}%` : null,
                              entry.avgLatencyMs !== undefined
                                ? `lat=${entry.avgLatencyMs}ms`
                                : null,
                              entry.errorCount !== undefined ? `err=${entry.errorCount}` : null,
                              entry.reparto ? `reparto=${entry.reparto}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ');
                            return `[${ts}] [${entry.level.toUpperCase()}]${meta ? ` [${meta}]` : ''} ${entry.message}`;
                          })
                          .join('\n');
                        navigator.clipboard.writeText(text);
                        setCopiedMtprotoLogs(true);
                        setTimeout(() => setCopiedMtprotoLogs(false), 2000);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10 cursor-pointer whitespace-nowrap"
                    >
                      {copiedMtprotoLogs ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedMtprotoLogs ? 'Copiado' : 'Copiar Log MTProto'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const text = filteredLogs
                          .map(
                            (l) =>
                              `[${new Date(l.timestamp).toLocaleTimeString('es-CU')}] [${l.source.toUpperCase()}] [${l.level.toUpperCase()}] ${l.message}`
                          )
                          .join('\n');
                        navigator.clipboard.writeText(text);
                        setCopiedLogs(true);
                        setTimeout(() => setCopiedLogs(false), 2000);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10 cursor-pointer whitespace-nowrap"
                    >
                      {copiedLogs ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedLogs ? 'Copiados' : 'Copiar Logs'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void fetchLiveState()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-cyan-500/10 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refrescar</span>
                  </button>
                </div>
              </div>

              {logViewTab === 'mtproto' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-3.5">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Data Center
                      </div>
                      <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                        {latestMtprotoMetrics?.dcId !== undefined
                          ? `DC #${latestMtprotoMetrics.dcId}`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-3.5">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Sockets TCP
                      </div>
                      <div className="mt-1 text-lg font-bold font-mono text-cyan-600 dark:text-cyan-400">
                        {latestMtprotoMetrics?.activeSockets !== undefined
                          ? `${latestMtprotoMetrics.activeSockets}/${latestMtprotoMetrics.maxSockets ?? 6}`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-3.5">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Ventana / Total
                      </div>
                      <div className="mt-1 text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        {latestMtprotoMetrics?.windowMBps !== undefined
                          ? `${latestMtprotoMetrics.windowMBps.toFixed(2)} MB/s`
                          : '—'}
                      </div>
                      {latestMtprotoMetrics?.avgMBps !== undefined && (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          Prom: {latestMtprotoMetrics.avgMBps.toFixed(2)} MB/s
                        </div>
                      )}
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-3.5">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        CPU Proceso
                      </div>
                      <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                        {latestMtprotoMetrics?.cpuPct !== undefined
                          ? `${latestMtprotoMetrics.cpuPct}%`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-3.5">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Latencia Chunk
                      </div>
                      <div className="mt-1 text-lg font-bold font-mono text-slate-900 dark:text-slate-100">
                        {latestMtprotoMetrics?.avgLatencyMs !== undefined
                          ? `${latestMtprotoMetrics.avgLatencyMs} ms`
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] p-3.5">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Errores / Reparto
                      </div>
                      <div
                        className={`mt-1 text-lg font-bold font-mono ${
                          (latestMtprotoMetrics?.errorCount ?? 0) > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {latestMtprotoMetrics?.errorCount ?? 0} err
                      </div>
                      {latestMtprotoMetrics?.reparto && (
                        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate" title={latestMtprotoMetrics.reparto}>
                          {latestMtprotoMetrics.reparto}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 dark:border-cyan-500/20 bg-[#050811] p-5 font-mono text-xs h-[560px] overflow-y-auto space-y-3">
                    {!filteredMtprotoLogs.length ? (
                      <div className="text-slate-500 py-24 text-center space-y-2">
                        <div>Aún no hay telemetría MTProto registrada en esta sesión.</div>
                        <div className="text-[11px] text-slate-600">
                          Cuando inicie una descarga MTProto aparecerán aquí cada 10s la velocidad real, CPU, sockets activos, reparto [s0..s5] y errores exactos.
                        </div>
                      </div>
                    ) : (
                      filteredMtprotoLogs.map((entry) => (
                        <div
                          key={entry.id}
                          className="border-b border-slate-900 pb-3 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="text-slate-500 tabular-nums">
                              {new Date(entry.timestamp).toLocaleTimeString('es-CU', {
                                hour12: false,
                              })}
                            </span>
                            <span
                              className={`font-semibold uppercase ${
                                entry.level === 'success'
                                  ? 'text-emerald-400'
                                  : entry.level === 'error'
                                    ? 'text-rose-400'
                                    : entry.level === 'warn'
                                      ? 'text-amber-400'
                                      : 'text-cyan-400'
                              }`}
                            >
                              [{entry.level}]
                            </span>
                            {entry.dcId !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                                DC #{entry.dcId}
                              </span>
                            )}
                            {entry.activeSockets !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                                {entry.activeSockets}/{entry.maxSockets ?? 6} TCP
                              </span>
                            )}
                            {entry.windowMBps !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300">
                                {entry.windowMBps.toFixed(2)} MB/s
                              </span>
                            )}
                            {entry.cpuPct !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                CPU {entry.cpuPct}%
                              </span>
                            )}
                            {entry.avgLatencyMs !== undefined && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                {entry.avgLatencyMs} ms/chunk
                              </span>
                            )}
                            {entry.errorCount !== undefined && entry.errorCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300">
                                {entry.errorCount} err
                              </span>
                            )}
                            {entry.fileName && (
                              <span className="text-slate-400 truncate max-w-[260px]">
                                {entry.fileName}
                              </span>
                            )}
                          </div>
                          <div className="text-slate-200 break-words whitespace-pre-wrap leading-relaxed select-text">
                            {entry.message}
                          </div>
                          {entry.reparto && (
                            <div className="text-[11px] text-cyan-300/80 break-all">
                              Reparto sockets: {entry.reparto}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 dark:border-cyan-500/20 bg-[#050811] p-5 font-mono text-xs h-[650px] overflow-y-auto space-y-2.5">
                  {!filteredLogs.length ? (
                    <div className="text-slate-500 py-24 text-center">
                      No hay eventos para el filtro seleccionado.
                    </div>
                  ) : (
                    filteredLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 border-b border-slate-900 pb-2.5"
                      >
                        <span className="text-slate-500 shrink-0 tabular-nums">
                          {new Date(log.timestamp).toLocaleTimeString('es-CU')}
                        </span>
                        <span
                          className={`shrink-0 w-20 font-semibold ${
                            log.level === 'success'
                              ? 'text-emerald-400'
                              : log.level === 'error'
                                ? 'text-rose-400'
                                : log.level === 'warn'
                                  ? 'text-amber-400'
                                  : 'text-cyan-400'
                          }`}
                        >
                          [{log.source.toUpperCase()}]
                        </span>
                        <span className="text-slate-200 break-words whitespace-pre-wrap font-mono leading-relaxed select-text flex-1">
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* ===================================================================
              VIEW 4: CENTRO API PICTA
             =================================================================== */}
          {activeSection === 'toolkit' && (
            <Suspense
              fallback={
                <div className="p-8 rounded-xl border border-slate-200 dark:border-cyan-500/20 bg-white dark:bg-[#0B1220] text-center text-xs font-mono text-slate-500 dark:text-slate-400">
                  Cargando Centro API Picta...
                </div>
              }
            >
              <PictaApiToolkitPanel />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
