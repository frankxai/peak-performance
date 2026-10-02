import { execFileSync } from 'node:child_process';
import os from 'node:os';

export const STORAGE_SCOPES = ['system', 'target', 'temp'] as const;
export type StorageScope = typeof STORAGE_SCOPES[number];
export type StorageState = 'normal' | 'bounded' | 'hold' | 'freeze' | 'unknown';
export interface StorageReading {
  scope: StorageScope;
  status: 'measured' | 'unknown';
  // Decimal strings retain native byte precision through JSON.
  totalBytes?: string;
  availableBytes?: string;
}
export interface StorageEvidence {
  sampledAt: string;
  readings: StorageReading[];
}

export function storageState(reading: StorageReading): StorageState {
  if (!reading || reading.status !== 'measured' || typeof reading.totalBytes !== 'string' || typeof reading.availableBytes !== 'string' || !/^\d{1,40}$/.test(reading.totalBytes) || !/^\d{1,40}$/.test(reading.availableBytes)) return 'unknown';
  const total = BigInt(reading.totalBytes!);
  const available = BigInt(reading.availableBytes!);
  if (total <= 0n || available > total) return 'unknown';
  // Compare exact bytes; rounding a display percentage must not cross a floor.
  if (available * 100n < total * 4n) return 'freeze';
  if (available * 100n < total * 8n) return 'hold';
  if (available * 100n < total * 15n) return 'bounded';
  return 'normal';
}

export function freshEvidence(sampledAt: string | undefined, now = Date.now()): boolean {
  const sampled = Date.parse(sampledAt ?? '');
  return Number.isFinite(sampled) && sampled <= now && now - sampled < 15 * 60_000;
}

// One bounded child owns native filesystem calls, including resolution of mount
// points. Paths are JSON argv data, never shell interpolation. No recursive scan.
export const STORAGE_CHILD = String.raw`
const fs = require('node:fs');
const { paths, localDrives } = JSON.parse(process.argv[1]);
const windows = process.platform === 'win32';
function accepted(path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) return false;
  if (!windows) return path.startsWith('/') && !path.startsWith('//');
  const match = /^([a-z]):[\\/]/i.exec(path);
  return !!match && localDrives.includes(match[1].toUpperCase() + ':');
}
const readings = paths.map(({ scope, path }) => {
  try {
    if (!accepted(path)) return { scope, status: 'unknown' };
    const resolved = fs.realpathSync.native(path);
    if (!accepted(resolved) || !fs.statSync(resolved).isDirectory()) return { scope, status: 'unknown' };
    const s = fs.statfsSync(resolved, { bigint: true });
    // bavail excludes blocks unavailable to this caller (e.g. reserved blocks).
    if (s.bsize <= 0n || s.blocks <= 0n || s.bavail < 0n || s.bavail > s.blocks) return { scope, status: 'unknown' };
    return { scope, status: 'measured', totalBytes: String(s.bsize * s.blocks), availableBytes: String(s.bsize * s.bavail) };
  } catch { return { scope, status: 'unknown' }; }
});
process.stdout.write(JSON.stringify({ sampledAt: new Date().toISOString(), readings }));
`;

export function probeStorage(cwd: string): StorageEvidence {
  const unknown = (): StorageEvidence => ({ sampledAt: new Date().toISOString(), readings: STORAGE_SCOPES.map(scope => ({ scope, status: 'unknown' })) });
  try {
    let localDrives: string[] = [];
    if (os.platform() === 'win32') {
      // Reject mapped network drives before resolving/statting their paths.
      const raw = execFileSync('powershell', ['-NoProfile', '-NoLogo', '-Command',
        '$ErrorActionPreference="Stop"; @((Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3").DeviceID) | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 8_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const parsed: unknown = JSON.parse(raw);
      const drives = Array.isArray(parsed) ? parsed : [parsed];
      if (!drives.length || !drives.every(d => typeof d === 'string' && /^[A-Z]:$/i.test(d))) return unknown();
      localDrives = drives.map(d => String(d).toUpperCase());
    }
    const paths = [
      { scope: 'system', path: os.platform() === 'win32' ? process.env.SystemRoot : '/' },
      { scope: 'target', path: cwd },
      { scope: 'temp', path: os.tmpdir() },
    ];
    const raw = execFileSync(process.execPath, ['-e', STORAGE_CHILD, JSON.stringify({ paths, localDrives })],
      { encoding: 'utf8', timeout: 8_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(raw) as StorageEvidence;
    if (!Array.isArray(parsed.readings) || parsed.readings.length !== 3 || !freshEvidence(parsed.sampledAt)) return unknown();
    return parsed;
  } catch { return unknown(); }
}
