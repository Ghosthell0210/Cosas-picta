import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface MultiPartSourceDescriptor {
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.ts', '.m4v']);

function findLargestVideoFileRecursive(dirPath: string): string | null {
  let bestFile: string | null = null;
  let bestSize = -1;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const sz = fs.statSync(full).size;
        if ((VIDEO_EXTS.has(ext) || bestFile === null) && sz > bestSize) {
          bestSize = sz;
          bestFile = full;
        }
      }
    }
  };
  walk(dirPath);
  return bestFile;
}

function cleanupPartFiles(parts: MultiPartSourceDescriptor[], keepPath?: string): void {
  for (const p of parts) {
    if (keepPath && path.resolve(p.filePath) === path.resolve(keepPath)) continue;
    try {
      if (fs.existsSync(p.filePath)) fs.unlinkSync(p.filePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function assembleMultiPartFilesOnDisk(
  parts: MultiPartSourceDescriptor[],
  scratchDir: string,
  masterJobId: string
): Promise<{
  finalFilePath: string;
  finalFileName: string;
  finalSizeBytes: number;
  modeUsed: string;
}> {
  if (!parts || parts.length === 0) {
    throw new Error('No hay archivos descargados para unir.');
  }

  const sorted = [...parts].sort((a, b) =>
    a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' })
  );

  const first = sorted[0];
  const firstLower = first.fileName.toLowerCase();
  const isSplitNumeric = /\.\d{3}$/.test(firstLower) || /\.part\d+$/i.test(firstLower);
  const allVideos = sorted.every((p) => VIDEO_EXTS.has(path.extname(p.fileName).toLowerCase()));
  const isZip = firstLower.endsWith('.zip') || firstLower.includes('.z01');
  const isTar = /\.(tar|tar\.gz|tgz)$/i.test(firstLower);

  // Case 1: Split binary archives or split video parts (.001, .002 / .zip.001)
  if (isSplitNumeric) {
    const cleanBase = first.fileName
      .replace(/\.\d{3}$/i, '')
      .replace(/\.part\d+$/i, '');
    const joinedPath = path.join(scratchDir, `${masterJobId}_joined_${path.basename(cleanBase)}`);
    const outStream = fs.createWriteStream(joinedPath, { highWaterMark: 256 * 1024 });

    for (const part of sorted) {
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream(part.filePath, { highWaterMark: 256 * 1024 });
        rs.on('error', reject);
        outStream.on('error', reject);
        rs.on('end', resolve);
        rs.pipe(outStream, { end: false });
      });
    }
    await new Promise<void>((resolve, reject) => {
      outStream.end(() => resolve());
      outStream.on('error', reject);
    });

    if (cleanBase.toLowerCase().endsWith('.zip')) {
      const extractDir = path.join(scratchDir, `${masterJobId}_unzip`);
      fs.mkdirSync(extractDir, { recursive: true });
      await execFileAsync('unzip', ['-o', joinedPath, '-d', extractDir]);
      try {
        fs.unlinkSync(joinedPath);
      } catch {
        // Ignore
      }
      const extractedVideo = findLargestVideoFileRecursive(extractDir);
      if (!extractedVideo) {
        throw new Error('No se encontró ningún archivo de video dentro del ZIP ensamblado.');
      }
      const finalFileName = path.basename(extractedVideo);
      const finalFilePath = path.join(scratchDir, `${masterJobId}${path.extname(finalFileName) || '.mp4'}`);
      fs.renameSync(extractedVideo, finalFilePath);
      fs.rmSync(extractDir, { recursive: true, force: true });
      cleanupPartFiles(sorted, finalFilePath);
      return {
        finalFilePath,
        finalFileName,
        finalSizeBytes: fs.statSync(finalFilePath).size,
        modeUsed: 'concat_binario_zip',
      };
    }

    cleanupPartFiles(sorted, joinedPath);
    return {
      finalFilePath: joinedPath,
      finalFileName: cleanBase || `${masterJobId}.mp4`,
      finalSizeBytes: fs.statSync(joinedPath).size,
      modeUsed: 'concat_binario',
    };
  }

  // Case 2: Single or multi-file ZIP archive
  if (isZip) {
    const extractDir = path.join(scratchDir, `${masterJobId}_unzip`);
    fs.mkdirSync(extractDir, { recursive: true });
    await execFileAsync('unzip', ['-o', first.filePath, '-d', extractDir]);
    const extractedVideo = findLargestVideoFileRecursive(extractDir);
    if (!extractedVideo) {
      throw new Error('No se encontró un archivo de video válido dentro del archivo ZIP.');
    }
    const finalFileName = path.basename(extractedVideo);
    const finalFilePath = path.join(scratchDir, `${masterJobId}${path.extname(finalFileName) || '.mp4'}`);
    fs.renameSync(extractedVideo, finalFilePath);
    fs.rmSync(extractDir, { recursive: true, force: true });
    cleanupPartFiles(sorted, finalFilePath);
    return {
      finalFilePath,
      finalFileName,
      finalSizeBytes: fs.statSync(finalFilePath).size,
      modeUsed: 'extraccion_zip',
    };
  }

  // Case 3: TAR / TGZ archive
  if (isTar) {
    const extractDir = path.join(scratchDir, `${masterJobId}_untar`);
    fs.mkdirSync(extractDir, { recursive: true });
    const flags = firstLower.endsWith('.gz') || firstLower.endsWith('.tgz') ? '-xzf' : '-xf';
    await execFileAsync('tar', [flags, first.filePath, '-C', extractDir]);
    const extractedVideo = findLargestVideoFileRecursive(extractDir);
    if (!extractedVideo) {
      throw new Error('No se encontró un archivo de video válido dentro del archivo TAR.');
    }
    const finalFileName = path.basename(extractedVideo);
    const finalFilePath = path.join(scratchDir, `${masterJobId}${path.extname(finalFileName) || '.mp4'}`);
    fs.renameSync(extractedVideo, finalFilePath);
    fs.rmSync(extractDir, { recursive: true, force: true });
    cleanupPartFiles(sorted, finalFilePath);
    return {
      finalFilePath,
      finalFileName,
      finalSizeBytes: fs.statSync(finalFilePath).size,
      modeUsed: 'extraccion_tar',
    };
  }

  // Case 4: Multiple separate video files -> concatenate with ffmpeg (zero re-encoding, -c copy)
  if (allVideos && sorted.length > 1) {
    const listFile = path.join(scratchDir, `${masterJobId}_concat.txt`);
    const lines = sorted.map((p) => `file '${p.filePath.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, lines, 'utf-8');
    const ext = path.extname(first.fileName) || '.mp4';
    const outPath = path.join(scratchDir, `${masterJobId}${ext}`);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c',
        'copy',
        outPath,
      ]);
    } finally {
      try {
        fs.unlinkSync(listFile);
      } catch {
        // Ignore
      }
    }
    cleanupPartFiles(sorted, outPath);
    const cleanName = first.fileName.replace(/[._\s-]*(?:part|parte|cd)?\s*\d+(?=\.[^.]+$)/i, '');
    return {
      finalFilePath: outPath,
      finalFileName: cleanName || first.fileName,
      finalSizeBytes: fs.statSync(outPath).size,
      modeUsed: 'ffmpeg_concat_copy',
    };
  }

  // Fallback: single file passthrough
  return {
    finalFilePath: first.filePath,
    finalFileName: first.fileName,
    finalSizeBytes: fs.existsSync(first.filePath) ? fs.statSync(first.filePath).size : first.sizeBytes,
    modeUsed: 'directo',
  };
}
