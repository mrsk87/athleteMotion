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

export interface MeasureWithConfidence {
  value: number | null;
  unit: string;
  confidence: number;
  uncertainty: number | null;
  source: string;
  withheld: boolean;
  withhold_reason?: string | null;
}

export interface Point2DCoord {
  x: number;
  y: number;
}

export interface SimulatedPostureSnapshot {
  crank_phase: 'BDC' | 'TDC' | 'POWER_3H';
  crank_angle_deg: number;
  hip_point: Point2DCoord;
  knee_point: Point2DCoord;
  ankle_point: Point2DCoord;
  pedal_point: Point2DCoord;
  shoulder_point: Point2DCoord;
  elbow_point: Point2DCoord;
  hand_point: Point2DCoord;
  knee_angle_deg: number;
  hip_angle_deg: number;
  torso_angle_deg: number;
  elbow_angle_deg: number;
  shoulder_angle_deg: number;
}

export interface KinematicRiskWarning {
  code: string;
  severity: 'optimal' | 'warning' | 'critical';
  joint: string;
  message_pt: string;
  message_en: string;
  measured_value: number;
  threshold_value: number;
}

export interface SimulateAdjustmentsRequest {
  anthropometry: {
    femur_length_mm: number;
    tibia_length_mm: number;
    trunk_length_mm: number;
    arm_length_mm: number;
    forearm_length_mm: number;
    foot_length_mm?: number;
    pelvic_width_mm?: number;
  };
  baseline_geometry: {
    saddle_height_mm: number;
    saddle_setback_mm: number;
    seat_tube_angle_deg?: number;
    handlebar_stack_mm: number;
    handlebar_reach_mm: number;
    crank_length_mm?: number;
  };
  adjustments: {
    delta_saddle_height_mm?: number;
    delta_saddle_setback_mm?: number;
    delta_stem_stack_mm?: number;
    delta_stem_reach_mm?: number;
    delta_crank_length_mm?: number;
  };
}

export interface SimulateAdjustmentsResponse {
  baseline_knee_bdc_deg: number;
  simulated_knee_bdc_deg: number;
  delta_knee_bdc_deg: number;
  baseline_hip_tdc_deg: number;
  simulated_hip_tdc_deg: number;
  delta_hip_tdc_deg: number;
  baseline_torso_deg: number;
  simulated_torso_deg: number;
  delta_torso_deg: number;
  baseline_elbow_deg: number;
  simulated_elbow_deg: number;
  delta_elbow_deg: number;
  kops_offset_3h_mm: number;
  bdc_posture: SimulatedPostureSnapshot;
  tdc_posture: SimulatedPostureSnapshot;
  power_3h_posture: SimulatedPostureSnapshot;
  warnings: KinematicRiskWarning[];
  is_anatomically_feasible: boolean;
  summary_pt: string;
  summary_en: string;
}

export interface BikeCadReportResponse {
  stack_bb_to_bar: MeasureWithConfidence;
  reach_bb_to_bar: MeasureWithConfidence;
  saddle_height_bb: MeasureWithConfidence;
  saddle_setback_bb: MeasureWithConfidence;
  saddle_to_bar_distance: MeasureWithConfidence;
  saddle_to_bar_drop: MeasureWithConfidence;
  saddle_to_hood_distance?: MeasureWithConfidence | null;
  wheelbase?: MeasureWithConfidence | null;
  effective_seat_tube_angle_deg: number;
  confidence_score: number;
  warnings: string[];
}

export interface PatellofemoralSample {
  crank_angle_deg: number;
  knee_flexion_deg: number;
  cadence_rpm: number;
  power_watts: number;
  pedal_force_tangential_n: number;
  knee_extensor_moment_nm: number;
  quadriceps_force_n: number;
  patellofemoral_compressive_force_n: number;
  patellofemoral_stress_mpa: number;
  risk_level: 'low' | 'moderate' | 'high';
}

export interface PatellofemoralRevolutionResponse {
  peak_compressive_force_n: number;
  peak_stress_mpa: number;
  peak_force_crank_angle_deg: number;
  mean_downstroke_force_n: number;
  risk_level: 'low' | 'moderate' | 'high';
  saddle_height_correlation_note_pt: string;
  saddle_height_correlation_note_en: string;
  recommendation_pt: string;
  recommendation_en: string;
  samples: PatellofemoralSample[];
}
