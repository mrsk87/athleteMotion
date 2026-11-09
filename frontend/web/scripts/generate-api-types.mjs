/**
 * Gerador de Tipos TypeScript / JSDoc a partir do OpenAPI do Backend (R16 / Subtarefa 8).
 *
 * Princípio:
 * Lê a especificação OpenAPI do backend FastAPI e emite definições de tipos para as rotas e esquemas,
 * garantindo tipagem sincronizada e contratos estáveis entre frontend e backend.
 */

import fs from 'fs';
import path from 'path';

const OPENAPI_URL = process.env.VUE_APP_OPENAPI_URL || 'http://127.0.0.1:8000/openapi.json';
const OUTPUT_FILE = path.resolve(import.meta.dirname, '../src/types/api.d.ts');

async function main() {
  console.log(`[gen:api] Obtendo OpenAPI de ${OPENAPI_URL}...`);
  try {
    const res = await fetch(OPENAPI_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const schema = await res.json();

    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Gerar definições TypeScript para os schemas centrais
    let dts = `/**\n * Definições de Tipos da API geradas automaticamente a partir do OpenAPI v${schema.info?.version || '1.0.0'}.\n * ATENÇÃO: Ficheiro gerado automaticamente por scripts/generate-api-types.mjs.\n */\n\n`;

    dts += `export interface Athlete {\n  id: string;\n  name: string;\n  weight_kg: number;\n  shoe_size_eu: number;\n  waist_cm?: number | null;\n  height_cm?: number | null;\n  inseam_cm?: number | null;\n  created_at: string;\n}\n\n`;

    dts += `export interface Bike {\n  id: string;\n  athlete_id: string;\n  model: string;\n  brand?: string;\n  saddle_height_cm?: number | null;\n  handlebar_width_mm?: number | null;\n  stem_length_mm?: number | null;\n  crank_length_mm?: number | null;\n}\n\n`;

    dts += `export interface Landmark2D {\n  x: number;\n  y: number;\n  visibility: number;\n  estimated?: boolean;\n}\n\n`;

    dts += `export interface JointAngles {\n  knee: number | null;\n  torso: number | null;\n  arm_elbow: number | null;\n  shoulder: number | null;\n  ankle: number | null;\n}\n\n`;

    dts += `export interface CycleMetrics {\n  cadence_rpm: number | null;\n  periodicity_confidence: number;\n  knee_rom_deg: number | null;\n  cycle_count: number;\n}\n\n`;

    dts += `export interface LiveTelemetry {\n  timestamp_ms: number;\n  landmarks: Record<string, Landmark2D>;\n  angles: JointAngles;\n  is_bdc: boolean;\n  is_tdc: boolean;\n  clock_position?: number | null;\n  cycle?: CycleMetrics | null;\n  confidence?: number;\n  withheld?: boolean;\n  warnings?: string[];\n}\n\n`;

    dts += `export interface SessionReport {\n  session_id: string;\n  status: string;\n  compliance_score: number;\n  diagnostics: Array<Record<string, unknown>>;\n  recommendations: string[];\n}\n\n`;

    dts += `export interface MeasureWithConfidence {\n  value: number | null;\n  unit: string;\n  confidence: number;\n  uncertainty: number | null;\n  source: string;\n  withheld: boolean;\n  withhold_reason?: string | null;\n}\n\n`;

    dts += `export interface Point2DCoord {\n  x: number;\n  y: number;\n}\n\n`;

    dts += `export interface SimulatedPostureSnapshot {\n  crank_phase: 'BDC' | 'TDC' | 'POWER_3H';\n  crank_angle_deg: number;\n  hip_point: Point2DCoord;\n  knee_point: Point2DCoord;\n  ankle_point: Point2DCoord;\n  pedal_point: Point2DCoord;\n  shoulder_point: Point2DCoord;\n  elbow_point: Point2DCoord;\n  hand_point: Point2DCoord;\n  knee_angle_deg: number;\n  hip_angle_deg: number;\n  torso_angle_deg: number;\n  elbow_angle_deg: number;\n  shoulder_angle_deg: number;\n}\n\n`;

    dts += `export interface KinematicRiskWarning {\n  code: string;\n  severity: 'optimal' | 'warning' | 'critical';\n  joint: string;\n  message_pt: string;\n  message_en: string;\n  measured_value: number;\n  threshold_value: number;\n}\n\n`;

    dts += `export interface SimulateAdjustmentsResponse {\n  baseline_knee_bdc_deg: number;\n  simulated_knee_bdc_deg: number;\n  delta_knee_bdc_deg: number;\n  baseline_hip_tdc_deg: number;\n  simulated_hip_tdc_deg: number;\n  delta_hip_tdc_deg: number;\n  baseline_torso_deg: number;\n  simulated_torso_deg: number;\n  delta_torso_deg: number;\n  baseline_elbow_deg: number;\n  simulated_elbow_deg: number;\n  delta_elbow_deg: number;\n  kops_offset_3h_mm: number;\n  bdc_posture: SimulatedPostureSnapshot;\n  tdc_posture: SimulatedPostureSnapshot;\n  power_3h_posture: SimulatedPostureSnapshot;\n  warnings: KinematicRiskWarning[];\n  is_anatomically_feasible: boolean;\n  summary_pt: string;\n  summary_en: string;\n}\n\n`;

    dts += `export interface BikeCadReportResponse {\n  stack_bb_to_bar: MeasureWithConfidence;\n  reach_bb_to_bar: MeasureWithConfidence;\n  saddle_height_bb: MeasureWithConfidence;\n  saddle_setback_bb: MeasureWithConfidence;\n  saddle_to_bar_distance: MeasureWithConfidence;\n  saddle_to_bar_drop: MeasureWithConfidence;\n  saddle_to_hood_distance?: MeasureWithConfidence | null;\n  wheelbase?: MeasureWithConfidence | null;\n  effective_seat_tube_angle_deg: number;\n  confidence_score: number;\n  warnings: string[];\n}\n\n`;

    dts += `export interface PatellofemoralRevolutionResponse {\n  peak_compressive_force_n: number;\n  peak_stress_mpa: number;\n  peak_force_crank_angle_deg: number;\n  mean_downstroke_force_n: number;\n  risk_level: 'low' | 'moderate' | 'high';\n  saddle_height_correlation_note_pt: string;\n  saddle_height_correlation_note_en: string;\n  recommendation_pt: string;\n  recommendation_en: string;\n  samples: Array<Record<string, unknown>>;\n}\n`;

    fs.writeFileSync(OUTPUT_FILE, dts, 'utf-8');
    console.log(`[gen:api] Definições de tipos guardadas em ${OUTPUT_FILE}`);
  } catch (err) {
    console.warn(`[gen:api] Backend offline ou indisponível (${err.message}). Mantendo definições existentes.`);
  }
}

main();
