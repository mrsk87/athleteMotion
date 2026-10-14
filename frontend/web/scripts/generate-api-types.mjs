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

    dts += `export interface SessionReport {\n  session_id: string;\n  status: string;\n  compliance_score: number;\n  diagnostics: Array<Record<string, unknown>>;\n  recommendations: string[];\n}\n`;

    fs.writeFileSync(OUTPUT_FILE, dts, 'utf-8');
    console.log(`[gen:api] Definições de tipos guardadas em ${OUTPUT_FILE}`);
  } catch (err) {
    console.warn(`[gen:api] Backend offline ou indisponível (${err.message}). Mantendo definições existentes.`);
  }
}

main();
