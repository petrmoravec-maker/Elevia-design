/**
 * Zustand store for floorplan scene state.
 *
 * Architecture inspired by Pascal Editor's flat entity dictionary with dirty tracking.
 * Middleware stack (innermost to outermost):
 *   immer (immutable updates) -> temporal/zundo (undo/redo) -> base store
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

// dirtyIds is a Set inside immer-managed state
enableMapSet();
import type {
  FloorplanEntity,
  FloorplanEntityType,
  RoomEntity,
  WallEntity,
  DoorEntity,
  EquipmentEntity,
  MeasureEntity,
  NoteEntity,
  Point2D,
} from '../types/floorplan';
import {
  polygonArea,
  polygonCentroid,
  pointInPolygon,
  distanceToSegment,
} from '../types/floorplan';

// ─── Active drawing tool ────────────────────────────────────────────────────────

export type EditorTool =
  | 'select'
  | 'pan'
  | 'room'
  | 'wall'
  | 'door'
  | 'equipment'
  | 'measure'
  | 'note';

// ─── Layer model ────────────────────────────────────────────────────────────────

export interface SceneLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Locked layers render and can be inspected/selected, but their entities cannot be edited. */
  locked: boolean;
  color: string;
  /** Discipline group shown in the layer tree (Architecture, Dimensions, Fit-out, ...). */
  group?: string;
}

const DEFAULT_LAYERS: SceneLayer[] = [
  { id: 'rooms', name: 'Rooms', visible: true, locked: false, color: '#4A9EF5', group: 'Design' },
  { id: 'walls', name: 'Walls', visible: true, locked: false, color: '#8B8B8B', group: 'Design' },
  { id: 'doors', name: 'Doors', visible: true, locked: false, color: '#F5A623', group: 'Design' },
  { id: 'equipment', name: 'Equipment', visible: true, locked: false, color: '#7ED321', group: 'Design' },
  { id: 'measurements', name: 'Measurements', visible: true, locked: false, color: '#BD10E0', group: 'Design' },
  { id: 'notes', name: 'Notes', visible: true, locked: false, color: '#9B9B9B', group: 'Design' },
];

/** Discipline group for generator-owned (existing-*) layers, by layer id. */
const EXISTING_LAYER_GROUPS: Record<string, string> = {
  'existing-rooms': 'Existing - architecture',
  'existing-walls': 'Existing - architecture',
  'existing-doors': 'Existing - architecture',
  'existing-dimensions': 'Existing - dimensions',
  'existing-tables': 'Existing - fit-out',
  'existing-lighting': 'Existing - fit-out',
  'existing-equipment': 'Existing - fit-out',
  'existing-hvac': 'Existing - HVAC',
  'existing-notes': 'Existing - HVAC',
  // model/expansion.yaml (planned extension) - one group, drawn red
  'expansion-rooms': 'Expansion', 'expansion-walls': 'Expansion', 'expansion-doors': 'Expansion', 'expansion-dimensions': 'Expansion',
  'expansion-tables': 'Expansion', 'expansion-lighting': 'Expansion', 'expansion-equipment': 'Expansion', 'expansion-hvac': 'Expansion', 'expansion-notes': 'Expansion',
};

/**
 * Build the layer list for a loaded scene: defaults + layers declared by the project
 * (sceneLayers on design_projects) + any layer id referenced by an entity but declared nowhere.
 */
export function buildSceneLayers(
  entities: Record<string, FloorplanEntity>,
  declared: Partial<SceneLayer>[] = [],
  previous: SceneLayer[] = [],
): SceneLayer[] {
  const prevById = new Map(previous.map(l => [l.id, l]));
  const out: SceneLayer[] = DEFAULT_LAYERS.map(l => ({ ...l, ...(prevById.get(l.id) ? { visible: prevById.get(l.id)!.visible } : {}) }));
  const seen = new Set(out.map(l => l.id));
  for (const d of declared) {
    if (!d.id || seen.has(d.id)) continue;
    seen.add(d.id);
    const prev = prevById.get(d.id);
    out.push({
      id: d.id,
      name: d.name ?? d.id,
      visible: prev ? prev.visible : (d.visible ?? true),
      locked: d.locked ?? d.id.startsWith('existing-'),
      color: d.color ?? '#9B9B9B',
      group: d.group ?? EXISTING_LAYER_GROUPS[d.id] ?? (d.id.startsWith('existing-') ? 'Existing' : d.id.startsWith('expansion-') ? 'Expansion' : 'Design'),
    });
  }
  for (const e of Object.values(entities)) {
    if (!e.layer || seen.has(e.layer)) continue;
    seen.add(e.layer);
    const prev = prevById.get(e.layer);
    out.push({
      id: e.layer,
      name: e.layer.replace(/^existing-/, 'Existing ').replace(/-/g, ' '),
      visible: prev ? prev.visible : true,
      locked: e.layer.startsWith('existing-'),
      color: '#9B9B9B',
      group: EXISTING_LAYER_GROUPS[e.layer] ?? (e.layer.startsWith('existing-') ? 'Existing' : 'Design'),
    });
  }
  return out;
}

const ENTITY_DEFAULT_LAYER: Record<FloorplanEntityType, string> = {
  room: 'rooms',
  wall: 'walls',
  door: 'doors',
  equipment: 'equipment',
  measure: 'measurements',
  note: 'notes',
};

// ─── Store interface ─────────────────────────────────────────────────────────────

interface FloorplanState {
  // Scene entities -- flat dictionary, all coordinates in meters Y-up
  entities: Record<string, FloorplanEntity>;

  // Selection
  selectedIds: string[];

  // Dirty tracking (IDs modified since last save)
  dirtyIds: Set<string>;

  // Layers
  layers: SceneLayer[];

  // Active tool
  activeTool: EditorTool;

  // Grid snap
  snapToGrid: boolean;
  gridSize: number; // meters

  // Persistence tracking
  isDirty: boolean;
  lastSavedAt: number | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error' | 'offline';

  /** Viewer without edit rights (shared facility plan without manage_facility_plan). */
  readOnly: boolean;
  setReadOnly(readOnly: boolean): void;

  /** Replace the layer list (layer tree presets, project-declared layers). */
  setLayers(layers: SceneLayer[]): void;
  setLayersVisible(ids: string[], visible: boolean): void;

  /** True when the entity may be edited (not locked, layer not locked, not read-only). */
  canEdit(id: string): boolean;

  // ─── Actions ──────────────────────────────────────────────────────────────────

  addEntity(entity: FloorplanEntity): void;
  updateEntity(id: string, patch: Partial<FloorplanEntity>): void;
  deleteEntity(id: string): void;
  deleteEntities(ids: string[]): void;

  selectEntity(id: string | null, addToSelection?: boolean): void;
  selectEntities(ids: string[]): void;
  clearSelection(): void;

  setActiveTool(tool: EditorTool): void;
  setSnapToGrid(enabled: boolean): void;
  setGridSize(meters: number): void;

  updateLayer(id: string, patch: Partial<SceneLayer>): void;

  markSaved(): void;
  setSaveStatus(status: FloorplanState['saveStatus']): void;

  /** Load a full scene snapshot (from Firestore) plus the layers the project declares */
  loadScene(entities: Record<string, FloorplanEntity>, declaredLayers?: Partial<SceneLayer>[]): void;

  /** Clear all entities (new project) */
  clearScene(): void;

  // ─── Derived queries (computed on demand, not stored) ──────────────────────

  getEntitiesByType<T extends FloorplanEntityType>(
    type: T,
  ): Extract<FloorplanEntity, { type: T }>[];
  getEntitiesByLayer(layerId: string): FloorplanEntity[];
  getEquipmentInRoom(roomId: string): EquipmentEntity[];
  getSelectedEntities(): FloorplanEntity[];
  getRoomAtPoint(point: Point2D): RoomEntity | undefined;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useFloorplanStore = create<FloorplanState>()(
  temporal(
    immer((set, get) => ({
      entities: {},
      selectedIds: [],
      dirtyIds: new Set<string>(),
      layers: DEFAULT_LAYERS,
      activeTool: 'select',
      snapToGrid: true,
      gridSize: 0.5, // 0.5m grid
      isDirty: false,
      lastSavedAt: null,
      saveStatus: 'idle',
      readOnly: false,

      setReadOnly(readOnly) {
        set(state => { state.readOnly = readOnly; });
      },

      setLayers(layers) {
        set(state => { state.layers = layers; });
      },

      setLayersVisible(ids, visible) {
        set(state => {
          const wanted = new Set(ids);
          for (const l of state.layers) if (wanted.has(l.id)) l.visible = visible;
        });
      },

      canEdit(id) {
        const { entities, layers, readOnly } = get();
        const e = entities[id];
        if (!e || readOnly || e.locked) return false;
        const layer = layers.find(l => l.id === e.layer);
        return !layer || !layer.locked;
      },

      // ─── Entity CRUD ────────────────────────────────────────────────────────

      addEntity(entity) {
        if (get().readOnly) return;
        set(state => {
          // Ensure entity has the correct default layer if unset
          const layer = entity.layer || ENTITY_DEFAULT_LAYER[entity.type] || 'rooms';
          state.entities[entity.id] = { ...entity, layer };
          state.dirtyIds.add(entity.id);
          state.isDirty = true;
        });
        // If it's equipment, auto-assign roomId
        if (entity.type === 'equipment') {
          get().updateEntity(entity.id, {
            roomId: get().getRoomAtPoint((entity as EquipmentEntity).center),
          } as Partial<EquipmentEntity>);
        }
      },

      updateEntity(id, patch) {
        // Generated (existing-*) entities and read-only viewers: no edits. Bindings to the
        // inventory are the one exception - they are metadata, not geometry.
        if (!get().canEdit(id)) {
          const keys = Object.keys(patch);
          if (get().readOnly || !keys.every(k => k === 'binding' || k === 'labRoomId')) return;
        }
        set(state => {
          const existing = state.entities[id];
          if (!existing) return;
          // Immer allows direct mutation in set()
          Object.assign(state.entities[id], patch);

          // Recalculate area if room polygon changed
          if (existing.type === 'room' && 'polygon' in patch) {
            const room = state.entities[id] as RoomEntity;
            room.area = polygonArea(room.polygon);
          }
          // Recalculate measure distance if endpoints changed
          if (existing.type === 'measure' && ('start' in patch || 'end' in patch)) {
            const m = state.entities[id] as MeasureEntity;
            const [sx, sy] = m.start;
            const [ex, ey] = m.end;
            m.distance = Math.hypot(ex - sx, ey - sy);
          }

          state.dirtyIds.add(id);
          state.isDirty = true;
        });
      },

      deleteEntity(id) {
        if (!get().canEdit(id)) return;
        set(state => {
          // When deleting a room, also orphan its doors and un-assign its equipment
          const entity = state.entities[id];
          if (entity?.type === 'room') {
            for (const e of Object.values(state.entities)) {
              if (e.type === 'door' && (e as DoorEntity).wallOwner === id) {
                delete state.entities[e.id];
              }
              if (e.type === 'equipment' && (e as EquipmentEntity).roomId === id) {
                (state.entities[e.id] as EquipmentEntity).roomId = undefined;
              }
            }
          }
          delete state.entities[id];
          state.selectedIds = state.selectedIds.filter(sid => sid !== id);
          state.dirtyIds.add(id); // Track as deleted to trigger save
          state.isDirty = true;
        });
      },

      deleteEntities(ids) {
        ids.forEach(id => get().deleteEntity(id));
      },

      // ─── Selection ──────────────────────────────────────────────────────────

      selectEntity(id, addToSelection = false) {
        set(state => {
          if (id === null) {
            state.selectedIds = [];
            return;
          }
          const entity = state.entities[id];
          if (!entity) return;
          if (addToSelection) {
            const idx = state.selectedIds.indexOf(id);
            if (idx >= 0) {
              state.selectedIds.splice(idx, 1); // Deselect if already selected
            } else {
              state.selectedIds.push(id);
            }
          } else {
            state.selectedIds = [id];
          }
        });
      },

      selectEntities(ids) {
        set(state => {
          state.selectedIds = ids.filter(id => !!state.entities[id]);
        });
      },

      clearSelection() {
        set(state => {
          state.selectedIds = [];
        });
      },

      // ─── Tool + settings ────────────────────────────────────────────────────

      setActiveTool(tool) {
        set(state => {
          state.activeTool = tool;
          // Clear selection when switching tools
          if (tool !== 'select') state.selectedIds = [];
        });
      },

      setSnapToGrid(enabled) {
        set(state => { state.snapToGrid = enabled; });
      },

      setGridSize(meters) {
        set(state => { state.gridSize = meters; });
      },

      // ─── Layers ─────────────────────────────────────────────────────────────

      updateLayer(id, patch) {
        set(state => {
          const idx = state.layers.findIndex(l => l.id === id);
          if (idx >= 0) Object.assign(state.layers[idx], patch);
        });
      },

      // ─── Persistence ────────────────────────────────────────────────────────

      markSaved() {
        set(state => {
          state.isDirty = false;
          state.lastSavedAt = Date.now();
          state.saveStatus = 'saved';
          state.dirtyIds.clear();
        });
      },

      setSaveStatus(status) {
        set(state => { state.saveStatus = status; });
      },

      loadScene(entities, declaredLayers = []) {
        set(state => {
          state.entities = entities;
          state.layers = buildSceneLayers(entities, declaredLayers, state.layers);
          state.selectedIds = [];
          state.dirtyIds.clear();
          state.isDirty = false;
          state.lastSavedAt = Date.now();
          state.saveStatus = 'saved';
        });
      },

      clearScene() {
        set(state => {
          state.entities = {};
          state.selectedIds = [];
          state.dirtyIds.clear();
          state.isDirty = false;
        });
      },

      // ─── Derived queries ─────────────────────────────────────────────────────

      getEntitiesByType(type) {
        return Object.values(get().entities).filter(
          e => e.type === type,
        ) as Extract<FloorplanEntity, { type: typeof type }>[];
      },

      getEntitiesByLayer(layerId) {
        return Object.values(get().entities).filter(e => e.layer === layerId);
      },

      getEquipmentInRoom(roomId) {
        return Object.values(get().entities).filter(
          e => e.type === 'equipment' && (e as EquipmentEntity).roomId === roomId,
        ) as EquipmentEntity[];
      },

      getSelectedEntities() {
        const { entities, selectedIds } = get();
        return selectedIds.map(id => entities[id]).filter(Boolean);
      },

      getRoomAtPoint(point) {
        for (const entity of Object.values(get().entities)) {
          if (entity.type === 'room') {
            const room = entity as RoomEntity;
            if (pointInPolygon(point, room.polygon)) return room;
          }
        }
        return undefined;
      },
    })),
    {
      // Zundo config: 50-step undo history
      limit: 50,
      // Only track entity mutations in history (not UI state like selectedIds, activeTool)
      partialize: (state) => ({
        entities: state.entities,
      }),
    },
  ),
);

// ─── Convenience hooks ────────────────────────────────────────────────────────

export const useEntities = () => useFloorplanStore(s => s.entities);
export const useSelectedIds = () => useFloorplanStore(s => s.selectedIds);
export const useActiveTool = () => useFloorplanStore(s => s.activeTool);
export const useSnapToGrid = () => useFloorplanStore(s => s.snapToGrid);
export const useGridSize = () => useFloorplanStore(s => s.gridSize);
export const useLayers = () => useFloorplanStore(s => s.layers);
export const useSaveStatus = () =>
  useFloorplanStore(useShallow(s => ({ saveStatus: s.saveStatus, lastSavedAt: s.lastSavedAt, isDirty: s.isDirty })));

// ─── Scale-snapping utility ────────────────────────────────────────────────────

/**
 * Snap a world coordinate to the nearest grid intersection.
 * Only applies when snapToGrid is enabled.
 */
export function snapPoint(point: Point2D, gridSize: number, snapEnabled: boolean): Point2D {
  if (!snapEnabled) return point;
  const snap = (v: number) => Math.round(v / gridSize) * gridSize;
  return [snap(point[0]), snap(point[1])];
}

/**
 * Snap a point to 45-degree angle increments from a base point (Shift key).
 */
export function snapAngle(from: Point2D, to: Point2D): Point2D {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return [
    from[0] + len * Math.cos(snappedAngle),
    from[1] + len * Math.sin(snappedAngle),
  ];
}

// ─── ID generation ─────────────────────────────────────────────────────────────

/** Generate a type-prefixed entity ID using nanoid */
export async function generateEntityId(type: FloorplanEntityType): Promise<string> {
  const { nanoid } = await import('nanoid');
  return `${type}_${nanoid(8)}`;
}

/**
 * Synchronous entity ID for situations where async is not possible.
 * Falls back to Math.random if nanoid is not available.
 */
export function generateEntityIdSync(type: FloorplanEntityType): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${type}_${id}`;
}

// ─── Hit-testing utilities ────────────────────────────────────────────────────

const HIT_RADIUS_METERS = 0.3; // 0.3m tolerance for clicking lines/points

/** Door leaf segment (hinge -> latch) on its owner edge, in world metres. */
export function doorSegment(
  door: DoorEntity,
  owner: FloorplanEntity | undefined,
): [Point2D, Point2D] | null {
  let a: Point2D | undefined;
  let b: Point2D | undefined;
  if (owner?.type === 'room') {
    const poly = (owner as RoomEntity).polygon;
    a = poly[door.edgeIndex % poly.length];
    b = poly[(door.edgeIndex + 1) % poly.length];
  } else if (owner?.type === 'wall') {
    const pts = (owner as WallEntity).points;
    a = pts[door.edgeIndex];
    b = pts[door.edgeIndex + 1];
  }
  if (!a || !b) return null;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const cx = a[0] + (b[0] - a[0]) * door.position;
  const cy = a[1] + (b[1] - a[1]) * door.position;
  const hw = door.width / 2;
  return [[cx - ux * hw, cy - uy * hw], [cx + ux * hw, cy + uy * hw]];
}

/**
 * Find the topmost entity at a world-space point.
 * Priority: equipment > doors > dimensions > walls > room edges > rooms > notes.
 * Locked entities are hit too (they can be inspected); `scope` limits the search.
 */
export function hitTest(
  point: Point2D,
  entities: Record<string, FloorplanEntity>,
  layers: SceneLayer[],
  opts: { hitRadius?: number; scope?: Set<string> | null } = {},
): FloorplanEntity | null {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  const R = opts.hitRadius ?? HIT_RADIUS_METERS;
  const isInteractable = (e: FloorplanEntity) => {
    if (opts.scope && !opts.scope.has(e.id)) return false;
    const layer = layerMap.get(e.layer);
    return e.visible && (!layer || layer.visible);
  };

  const allEntities = Object.values(entities);
  const [px, py] = point;

  // 1. Equipment (bounding box, rotation aware)
  for (const e of allEntities) {
    if (e.type !== 'equipment' || !isInteractable(e)) continue;
    const eq = e as EquipmentEntity;
    const [cx, cy] = eq.center;
    const ang = (-(eq.rotation || 0) * Math.PI) / 180;
    const dx = px - cx, dy = py - cy;
    const lx = dx * Math.cos(ang) - dy * Math.sin(ang);
    const ly = dx * Math.sin(ang) + dy * Math.cos(ang);
    if (Math.abs(lx) <= eq.dimensions[0] / 2 && Math.abs(ly) <= eq.dimensions[1] / 2) return e;
  }

  // 2. Doors (distance to the leaf segment)
  for (const e of allEntities) {
    if (e.type !== 'door' || !isInteractable(e)) continue;
    const seg = doorSegment(e as DoorEntity, entities[(e as DoorEntity).wallOwner]);
    if (seg && distanceToSegment(point, seg[0], seg[1]) <= R) return e;
  }

  // 3. Dimensions / measures (proximity to line)
  for (const e of allEntities) {
    if (e.type !== 'measure' || !isInteractable(e)) continue;
    const m = e as MeasureEntity;
    if (distanceToSegment(point, m.start, m.end) <= R * 0.6) return e;
  }

  // 4. Walls (distance to segments, half thickness + tolerance)
  for (const e of allEntities) {
    if (e.type !== 'wall' || !isInteractable(e)) continue;
    const wall = e as WallEntity;
    const tol = Math.max(R * 0.5, wall.thickness / 2 + 0.02);
    for (let i = 0; i < wall.points.length - 1; i++) {
      if (distanceToSegment(point, wall.points[i], wall.points[i + 1]) <= tol) return e;
    }
  }

  // 5. Rooms (interior fill; smallest room wins so nested/adjacent rooms resolve sensibly)
  let best: RoomEntity | null = null;
  for (const e of allEntities) {
    if (e.type !== 'room' || !isInteractable(e)) continue;
    const room = e as RoomEntity;
    if (pointInPolygon(point, room.polygon) && (!best || room.area < best.area)) best = room;
  }
  if (best) return best;

  // 7. Notes (bounding box by font size)
  for (const e of allEntities) {
    if (e.type !== 'note' || !isInteractable(e)) continue;
    const note = e as { position: Point2D; fontSize: number } & FloorplanEntity;
    const [nx, ny] = note.position;
    const [px, py] = point;
    const approxW = note.fontSize * 5;
    if (px >= nx && px <= nx + approxW && py >= ny - note.fontSize && py <= ny) return e;
  }

  return null;
}

// ─── Box selection ────────────────────────────────────────────────────────────

/**
 * Find all entities whose bounding box intersects a selection rectangle.
 * Used for drag-box multi-select.
 */
export function boxSelect(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  entities: Record<string, FloorplanEntity>,
  layers: SceneLayer[],
): string[] {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  const isInteractable = (e: FloorplanEntity) => {
    const layer = layerMap.get(e.layer);
    return e.visible && (!layer || layer.visible);
  };

  const contains = (px: number, py: number) =>
    px >= rect.minX && px <= rect.maxX && py >= rect.minY && py <= rect.maxY;

  const selected: string[] = [];

  for (const e of Object.values(entities)) {
    if (!isInteractable(e)) continue;
    let hit = false;

    if (e.type === 'room') {
      hit = (e as RoomEntity).polygon.some(([x, y]) => contains(x, y));
    } else if (e.type === 'wall') {
      hit = (e as WallEntity).points.some(([x, y]) => contains(x, y));
    } else if (e.type === 'equipment') {
      const eq = e as EquipmentEntity;
      hit = contains(eq.center[0], eq.center[1]);
    } else if (e.type === 'measure') {
      const m = e as MeasureEntity;
      hit = contains(m.start[0], m.start[1]) || contains(m.end[0], m.end[1]);
    } else if (e.type === 'note') {
      const n = e as NoteEntity;
      hit = contains(n.position[0], n.position[1]);
    }

    if (hit) selected.push(e.id);
  }

  return selected;
}
