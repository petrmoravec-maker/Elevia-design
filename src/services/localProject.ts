/**
 * Dev-only local preview of the generated facility plan.
 *
 * `facility-design/build.py` copies its outputs to elevia-design/public/facility-dev/ (git
 * ignored). Opening /floorplan/local in `vite dev` renders them without Firebase, so the
 * model -> Design loop can be checked before seeding design_projects/FACILITY.
 */

import type { DesignProject } from './designProject';
import { projectFromData } from './designProject';

export const LOCAL_PROJECT_ID = 'local';
const BASE = '/facility-dev';

export function isLocalProject(projectId: string | undefined): boolean {
  return import.meta.env.DEV && projectId === LOCAL_PROJECT_ID;
}

export interface LocalProjectBundle {
  project: DesignProject;
  entities: Record<string, unknown>;
  guideUrl: string;
}

async function getJson(name: string): Promise<any> {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} - run facility-design/build.py first`);
  return res.json();
}

export async function loadLocalProject(): Promise<LocalProjectBundle> {
  const [scene, legend, guide] = await Promise.all([
    getJson('facility.scene.json'),
    getJson('legend.json'),
    getJson('facility_guide.json'),
  ]);
  const project = projectFromData(LOCAL_PROJECT_ID, {
    name: `${scene.project?.name ?? 'Facility'} (local preview)`,
    userId: 'local',
    shared: false,
    kind: 'facility',
    toolId: 'floorplan',
    status: 'preview',
    scale: '1:50',
    units: scene.units ?? 'm',
    originNote: scene.origin_note,
    roomCount: Object.values(scene.entities as Record<string, { type: string }>).filter(e => e.type === 'room').length,
    sceneLayers: scene.layers,
    guide: {
      storagePath: `${BASE}/facility_guide.dxf`,
      fileName: 'facility_guide.dxf',
      units: guide.units,
      originNote: guide.origin_note,
      worldAligned: true,
      layers: guide.layers,
    },
    facility: {
      project: scene.project ?? {},
      construction: scene.construction ?? {},
      calcs: scene.calcs ?? undefined,
      legend: {
        rooms: legend.rooms ?? {},
        notes: legend.notes ?? [],
        symbols: legend.symbols ?? [],
        sections: legend.sections ?? {},
        title: legend.title ?? {},
      },
    },
  });
  return { project, entities: scene.entities, guideUrl: `${BASE}/facility_guide.dxf` };
}
