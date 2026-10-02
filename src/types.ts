/** Gate names for Arcanea-themed output */
export const GATE_NAMES = {
  disk: { gate: 'Foundation', guardian: 'Lyssandria', plain: 'Disk Health' },
  memory: { gate: 'Flow', guardian: 'Leyla', plain: 'Memory' },
  cpu: { gate: 'Fire', guardian: 'Draconia', plain: 'CPU / GPU' },
  processes: { gate: 'Heart', guardian: 'Maylinn', plain: 'Process Health' },
  git: { gate: 'Voice', guardian: 'Alera', plain: 'Git Hygiene' },
  secrets: { gate: 'Sight', guardian: 'Lyria', plain: 'Security' },
  workspace: { gate: 'Crown', guardian: 'Aiyami', plain: 'Workspace' },
  knowledge: { gate: 'Starweave', guardian: 'Elara', plain: 'Knowledge' },
  agents: { gate: 'Unity', guardian: 'Ino', plain: 'Agent Load' },
  system: { gate: 'Source', guardian: 'Shinkami', plain: 'System' },
} as const;

export type GateId = keyof typeof GATE_NAMES;

export interface GateScore {
  id: GateId;
  score: number | null; // 0-10, null when required evidence is unknown
  status: 'OK' | 'WARN' | 'CRIT' | 'PERFECT' | 'UNKNOWN';
  detail: string;
  metrics: Record<string, string | number>;
}

export interface AuditResult {
  timestamp: string;
  hostname: string;
  platform: NodeJS.Platform;
  totalScore: number | null; // 0-100, null for an incomplete audit
  rawScore: number | null; // sum before caps, null for incomplete evidence
  scoreCaps: string[];
  grade: string;
  gates: GateScore[];
  recommendations: Recommendation[];
}

export interface Recommendation {
  priority: 'urgent' | 'high' | 'medium' | 'low';
  gate: GateId;
  message: string;
  fix?: string; // CLI command to fix
  autoFixable: boolean;
}

export interface TrendEntry {
  timestamp: string;
  score: number | null;
  grade: string;
  gates: Record<GateId, number | null>;
  trigger?: string;
}

export interface PPConfig {
  /** Use Arcanea gate names or plain names */
  theme: 'arcanea' | 'plain';
  /** Path to trend history file */
  historyPath: string;
  /** Max trend entries to keep */
  maxHistory: number;
  /** Working directory to audit */
  cwd: string;
}

export const DEFAULT_CONFIG: PPConfig = {
  theme: 'arcanea',
  historyPath: '.pp/history.json',
  maxHistory: 100,
  cwd: process.cwd(),
};
