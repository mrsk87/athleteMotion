/**
 * Definições de Tipos da API geradas a partir do OpenAPI FastAPI (R16 / Subtarefa 8).
 */

export interface Athlete {
  id: string;
  name: string;
  weight_kg: number;
  shoe_size_eu: number;
  waist_cm?: number | null;
  height_cm?: number | null;
  inseam_cm?: number | null;
  created_at: string;
}

export interface Bike {
  id: string;
  athlete_id: string;
  model: string;
  brand?: string;
  saddle_height_cm?: number | null;
  handlebar_width_mm?: number | null;
  stem_length_mm?: number | null;
  crank_length_mm?: number | null;
}

export interface Landmark2D {
  x: number;
  y: number;
  visibility: number;
  estimated?: boolean;
}

export interface JointAngles {
  knee: number | null;
  torso: number | null;
  arm_elbow: number | null;
  shoulder: number | null;
  ankle: number | null;
}

export interface CycleMetrics {
  cadence_rpm: number | null;
  periodicity_confidence: number;
  knee_rom_deg: number | null;
  cycle_count: number;
}

export interface LiveTelemetry {
  timestamp_ms: number;
  landmarks: Record<string, Landmark2D>;
  angles: JointAngles;
  is_bdc: boolean;
  is_tdc: boolean;
  clock_position?: number | null;
  cycle?: CycleMetrics | null;
  confidence?: number;
  withheld?: boolean;
  warnings?: string[];
}

export interface SessionReport {
  session_id: string;
  status: string;
  compliance_score: number;
  diagnostics: Array<Record<string, unknown>>;
  recommendations: string[];
}
