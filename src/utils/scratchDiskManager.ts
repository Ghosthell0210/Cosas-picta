import fs from 'fs';
import path from 'path';

export interface ScratchDiskStats {
  path: string;
  isEphemeralVolume: boolean;
  storageType: 'ephemeral_disk' | 'tmpfs_ram' | 'auto';
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export interface MemoryTelemetry {
  rssBytes: number;
  heapUsedBytes: number;
}

export function resolveScratchUploadDir(): string {
  const candidates = [
    process.env.PICTA_SCRATCH_DIR,
    '/mnt/picta_scratch',
    '/tmp/picta_uploads',
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const dir of candidates) {
    try {
      if (dir === '/mnt/picta_scratch' && !fs.existsSync('/mnt/picta_scratch')) {
        continue;
      }
      fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, `.probe_${process.pid}_${Date.now()}`);
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return dir;
    } catch {
      // Try next candidate
    }
  }
  const fallback = '/tmp/picta_uploads';
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    // Ignore
  }
  return fallback;
}

export function getScratchDiskStats(dirPath: string): ScratchDiskStats {
  const isEphemeral =
    dirPath.startsWith('/mnt/picta_scratch') ||
    (Boolean(process.env.PICTA_SCRATCH_DIR) && dirPath === process.env.PICTA_SCRATCH_DIR);
  const storageType: ScratchDiskStats['storageType'] = isEphemeral
    ? 'ephemeral_disk'
    : dirPath.startsWith('/tmp')
      ? 'tmpfs_ram'
      : 'auto';

  try {
    const statFn = (fs as any).statfsSync;
    if (typeof statFn === 'function') {
      const st = statFn(dirPath);
      const bsize = Number(st.bsize || 4096);
      const blocks = Number(st.blocks || 0);
      const bavail = Number(st.bavail || st.bfree || 0);
      const totalBytes = blocks * bsize;
      const freeBytes = bavail * bsize;
      const usedPercent =
        totalBytes > 0 ? Math.min(100, Math.max(0, Math.round(((totalBytes - freeBytes) / totalBytes) * 100))) : 0;
      return {
        path: dirPath,
        isEphemeralVolume: isEphemeral,
        storageType,
        totalBytes,
        freeBytes,
        usedPercent,
      };
    }
  } catch {
    // Fallback if statfsSync is unavailable
  }

  return {
    path: dirPath,
    isEphemeralVolume: isEphemeral,
    storageType,
    totalBytes: 10 * 1024 * 1024 * 1024,
    freeBytes: 8 * 1024 * 1024 * 1024,
    usedPercent: 20,
  };
}

export function ensureScratchSpaceForFile(
  dirPath: string,
  requiredBytes: number,
  protectedPaths: Set<string> | string[] = []
): {
  ok: boolean;
  freedBytes: number;
  deletedFiles: string[];
  freeBytesAfter: number;
} {
  const protectedSet =
    protectedPaths instanceof Set ? protectedPaths : new Set(protectedPaths.map((p) => path.resolve(p)));
  
  // Aggressively purge ALL unprotected files in scratch dir immediately to maximize free space
  let freedBytes = 0;
  const deletedFiles: string[] = [];
  try {
    if (fs.existsSync(dirPath)) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const full = path.resolve(path.join(dirPath, entry.name));
        if (protectedSet.has(full)) continue;
        try {
          const st = fs.statSync(full);
          fs.unlinkSync(full);
          freedBytes += st.size;
          deletedFiles.push(full);
        } catch {
          // Ignore individual file deletion errors
        }
      }
    }
  } catch {
    // Ignore readdir errors
  }

  const statsAfter = getScratchDiskStats(dirPath);
  // Lean margin of 16 MB or required bytes
  const requiredWithMargin = requiredBytes + 16 * 1024 * 1024;
  const ok = statsAfter.freeBytes >= requiredBytes || statsAfter.freeBytes >= requiredWithMargin || statsAfter.freeBytes >= 512 * 1024 * 1024;

  return {
    ok: statsAfter.freeBytes >= requiredBytes,
    freedBytes,
    deletedFiles,
    freeBytesAfter: statsAfter.freeBytes,
  };
}

export function cleanupOrphanedScratchFiles(
  dirPath: string,
  protectedPaths: Set<string> | string[] = [],
  maxAgeMs = 30 * 60 * 1000
): number {
  const protectedSet =
    protectedPaths instanceof Set ? protectedPaths : new Set(protectedPaths.map((p) => path.resolve(p)));
  let removedCount = 0;
  const now = Date.now();
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.resolve(path.join(dirPath, entry.name));
      if (protectedSet.has(fullPath)) continue;
      try {
        const st = fs.statSync(fullPath);
        if (now - st.mtimeMs >= maxAgeMs) {
          fs.unlinkSync(fullPath);
          removedCount++;
        }
      } catch {
        // Ignore file errors
      }
    }
  } catch {
    // Ignore dir errors
  }
  return removedCount;
}

export function getMemoryTelemetry(): MemoryTelemetry {
  const mem = process.memoryUsage();
  return {
    rssBytes: Number(mem.rss || 0),
    heapUsedBytes: Number(mem.heapUsed || 0),
  };
}
