/**
 * design_projects/{projectId} document shape + loader.
 *
 * Personal projects (created in the app) have userId == uid. The shared facility plan is
 * seeded by scripts/seed_design_project.cjs with shared: true, a world-aligned guide DXF in
 * Storage and legend/construction data under `facility`.
 */

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { SceneLayer } from '../stores/useFloorplanStore';
import type { RoomFinish } from '../types/floorplan';

export interface GuideLayerMeta {
  /** DXF layer name, e.g. GUIDE_ARCH_walls */
  name: string;
  label: string;
  group: string;
  /** Source sheet: ARCH / HVAC / KOORD */
  source: string;
  aci: number;
  count: number;
  /** Visible by default */
  visible: boolean;
}

export interface ProjectGuide {
  storagePath: string;
  fileName: string;
  bytes?: number;
  units: 'm' | 'mm';
  originNote?: string;
  /** Coordinates already match the scene (metres, same origin) - draw without re-centring. */
  worldAligned: boolean;
  layers: GuideLayerMeta[];
}

export interface LegendRoom {
  name: string;
  area_m2?: number;
  finish?: RoomFinish;
  hvac?: Record<string, unknown>;
}

export interface FacilityCalcRoom {
  id: string; name: string; type: string; area_m2: number; volume_m3: number;
  light_rows: number; lighting_kw: number; lighting_estimated?: boolean; lighting_w_m2: number; lighting_w_m2_canopy: number | null;
  dehumidifiers: number; dehu_kw: number; hvac_units: number; hvac_kw: number; small_power_kw: number; connected_kw: number;
  heat_kw: number; cooling_kw_available: number | null; canopy_m2: number; water_l_day: number; dehu_capacity_l_day: number; dehu_margin_pct: number | null;
  supply_m3h: number; extract_m3h: number; ach_supply: number | null; ach_stated: number | null; balance_m3h: number | null;
  pressure: 'positive' | 'negative' | 'neutral' | null;
}

export interface FacilityCalcs {
  assumptions: Record<string, number>;
  rooms: FacilityCalcRoom[];
  summary: {
    connected_kw: number; design_kw: number; design_current_a: number; main_breaker_a: number;
    lighting_kw: number; dehu_kw: number; hvac_kw: number; heat_kw: number; canopy_m2: number;
    water_l_day: number; dehu_capacity_l_day: number; supply_m3h: number; extract_m3h: number; grow_rooms: number; daily_kwh_lights_12h: number;
  };
}

export interface FacilityData {
  project: { name?: string; stage?: string; revision?: string | number; default_height?: number };
  construction: {
    exterior_wall_mm?: number;
    interior_masonry_wall_mm?: number;
    door_height_mm?: number;
    clear_height_m?: number;
    table_height_m?: number;
    stack_order?: string[];
    /** z-levels above finished floor (m): duct_top, duct_bottom, hvac_indoor_bottom, light, light_depth, table_top, canopy_top */
    heights_m?: Record<string, number>;
    /** device envelopes from datasheets: { w, d, h, mount, source } */
    datasheets?: Record<string, { w: number; d: number; h: number; mount?: string; source?: string }>;
  };
  /** Engineering estimates from facility-design/calcs.py (loads, ACH, moisture) */
  calcs?: FacilityCalcs;
  legend: {
    rooms: Record<string, LegendRoom>;
    notes: string[];
    symbols: string[];
    sections: Record<string, number[]>;
    title: Record<string, string>;
  };
}

export interface DesignProject {
  id: string;
  name: string;
  description?: string;
  userId: string;
  shared: boolean;
  kind: 'facility' | 'personal';
  toolId: string;
  scale: string;
  status: string;
  units: 'm' | 'mm';
  originNote?: string;
  roomCount: number;
  sourceFile?: string;
  sourceFileUrl?: string;
  guide?: ProjectGuide;
  /** Hand-off files uploaded by the seed (design/{id}/exports/...): builder sheets PDF, IFC */
  exports?: Record<string, { storagePath: string; fileName: string; bytes?: number; label?: string }>;
  facility?: FacilityData;
  sceneLayers: Partial<SceneLayer>[];
  updatedAt?: Date;
}

export function projectFromData(id: string, data: Record<string, any>): DesignProject {
  return {
    id,
    name: data.name ?? 'Floorplan',
    description: data.description,
    userId: data.userId ?? '',
    shared: data.shared === true,
    kind: data.kind === 'facility' ? 'facility' : 'personal',
    toolId: data.toolId ?? 'floorplan',
    scale: data.scale ?? '1:100',
    status: data.status ?? 'draft',
    units: data.units === 'mm' ? 'mm' : 'm',
    originNote: data.originNote,
    roomCount: data.roomCount ?? 0,
    sourceFile: data.sourceFile,
    sourceFileUrl: data.sourceFileUrl,
    exports: data.exports && typeof data.exports === 'object' ? data.exports : undefined,
    guide: data.guide && data.guide.storagePath
      ? {
          storagePath: data.guide.storagePath,
          fileName: data.guide.fileName ?? 'guide.dxf',
          bytes: data.guide.bytes,
          units: data.guide.units === 'mm' ? 'mm' : 'm',
          originNote: data.guide.originNote,
          worldAligned: data.guide.worldAligned !== false,
          layers: Array.isArray(data.guide.layers) ? data.guide.layers : [],
        }
      : undefined,
    facility: data.facility
      ? {
          project: data.facility.project ?? {},
          construction: data.facility.construction ?? {},
          calcs: data.facility.calcs ?? undefined,
          legend: {
            rooms: data.facility.legend?.rooms ?? {},
            notes: data.facility.legend?.notes ?? [],
            symbols: data.facility.legend?.symbols ?? [],
            sections: data.facility.legend?.sections ?? {},
            title: data.facility.legend?.title ?? {},
          },
        }
      : undefined,
    sceneLayers: Array.isArray(data.sceneLayers) ? data.sceneLayers : [],
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : undefined,
  };
}

export async function loadDesignProject(projectId: string): Promise<DesignProject | null> {
  const snap = await getDoc(doc(db, 'design_projects', projectId));
  if (!snap.exists()) return null;
  return projectFromData(snap.id, snap.data());
}

/** Mirrors the design_projects rule in firestore.rules. */
export function canEditProject(
  project: DesignProject,
  uid: string | undefined,
  hasPermission: (p: string) => boolean,
): boolean {
  if (!uid) return false;
  if (project.shared) return hasPermission('manage_facility_plan');
  return project.userId === uid;
}

/** Metres -> whole millimetres as a string (dimension labels). */
export function mm(metres: number | undefined | null): string {
  if (metres === undefined || metres === null || !isFinite(metres)) return '-';
  return String(Math.round(metres * 1000));
}

/** Metres -> "1.40 m". */
export function fmtM(metres: number | undefined | null, digits = 2): string {
  if (metres === undefined || metres === null || !isFinite(metres)) return '-';
  return `${metres.toFixed(digits)} m`;
}

export function fmtArea(m2: number | undefined | null): string {
  if (m2 === undefined || m2 === null || !isFinite(m2)) return '-';
  return `${m2.toFixed(2)} m²`;
}
