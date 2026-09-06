/**
 * 3D view of the facility plan (react-three-fiber). Same store, same layer visibility,
 * same selection as the 2D canvas - only the renderer differs.
 *
 * World mapping: plan X -> three X, plan Y (north) -> three -Z, height -> three Y.
 * Heights: rooms extrude to ceilingHeight (walls), equipment uses meta.z / meta.h written
 * by facility-design/build.py (datasheet envelopes), with per-layer fallbacks.
 * Live state (Phase 2 bindings): light rows switch with the mapped Lab room schedule,
 * bound devices tint by status, offline devices go grey.
 */

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useCallback, useEffect, Suspense } from 'react';
import { Canvas as R3FCanvas, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Grid, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type {
  FloorplanEntity, RoomEntity, WallEntity, DoorEntity, EquipmentEntity, Point2D,
} from '../../../types/floorplan';
import { polygonCentroid } from '../../../types/floorplan';
import { ROOM_TYPES } from '../../../data/roomTypes';
import { getEquipmentById } from '../../../data/equipmentLibrary';
import { doorSegment } from '../../../stores/useFloorplanStore';
import { ROUTE_COLORS } from '../Canvas';
import type { LabDevice, LabRoom } from '../../../services/labInventory';
import { findBound, lightsOnNow } from '../../../services/labInventory';

export type CameraPreset = 'iso' | 'top' | 'orbit' | 'walk';

export interface FacilitySceneHandle {
  setPreset(p: CameraPreset): void;
  zoomTo(entityId: string): void;
  /** PNG data URL of the current frame */
  snapshot(): string | null;
}

export interface FacilitySceneProps {
  entities: Record<string, FloorplanEntity>;
  layerVisible: Map<string, boolean>;
  scope: Set<string> | null;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onHover?(id: string | null): void;
  showLabels: boolean;
  isLight: boolean;
  heights: Record<string, number>;
  devices: Record<string, LabDevice>;
  labRooms: LabRoom[];
  /** Tick used to re-evaluate light schedules (minutes) */
  clock?: number;
}

const DEFAULT_H = { table_top: 0.75, light: 2.55, light_depth: 0.1, hvac_indoor_bottom: 3.15, duct_bottom: 2.95, duct_top: 3.45 };

// plan -> three
const P = (x: number, y: number, z = 0): [number, number, number] => [x, z, -y];

function bboxOfEntity(e: FloorplanEntity): { min: Point2D; max: Point2D; h: number } | null {
  let pts: Point2D[] = [];
  let h = 3.5;
  switch (e.type) {
    case 'room': pts = (e as RoomEntity).polygon; h = (e as RoomEntity).ceilingHeight; break;
    case 'wall': pts = (e as WallEntity).points; h = (e as WallEntity).height; break;
    case 'equipment': {
      const q = e as EquipmentEntity;
      const hw = q.dimensions[0] / 2, hd = q.dimensions[1] / 2;
      pts = [[q.center[0] - hw, q.center[1] - hd], [q.center[0] + hw, q.center[1] + hd]];
      h = (Number(q.meta?.z) || 0) + (Number(q.meta?.h) || 1);
      break;
    }
    case 'note': pts = [(e as any).position]; h = 1; break;
    case 'measure': pts = [(e as any).start, (e as any).end]; h = 0.5; break;
    default: return null;
  }
  if (!pts.length) return null;
  const min: Point2D = [Infinity, Infinity], max: Point2D = [-Infinity, -Infinity];
  for (const [x, y] of pts) { if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; }
  return { min, max, h };
}

function roomColor(r: RoomEntity): string {
  return ROOM_TYPES.find(t => t.id === r.roomTypeId)?.color ?? '#94a3b8';
}

// ─── Scene contents ───────────────────────────────────────────────────────────

function Rooms({ rooms, selectedId, onSelect, onHover, showLabels, isLight, hovered }: {
  rooms: RoomEntity[]; selectedId: string | null; onSelect(id: string): void; onHover?(id: string | null): void; showLabels: boolean; isLight: boolean; hovered: string | null;
}) {
  return (
    <group>
      {rooms.map(r => {
        const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, -y)));
        const c = polygonCentroid(r.polygon);
        const active = selectedId === r.id || hovered === r.id;
        const code = typeof r.meta?.code === 'string' ? (r.meta!.code as string) : r.name.split(' ')[0];
        return (
          <group key={r.id}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.004, 0]}
              onClick={e => { e.stopPropagation(); onSelect(r.id); }}
              onPointerOver={e => { e.stopPropagation(); onHover?.(r.id); }}
              onPointerOut={() => onHover?.(null)}
              receiveShadow
            >
              <shapeGeometry args={[shape]} />
              <meshStandardMaterial color={r.layer.startsWith('expansion-') ? '#e03030' : roomColor(r)} transparent opacity={active ? 0.55 : isLight ? 0.28 : 0.35} roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
            {showLabels && (
              <Html position={P(c[0], c[1], 0.05)} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, fontFamily: 'system-ui, sans-serif', color: isLight ? '#111' : '#fff',
                  textShadow: isLight ? '0 0 3px #fff, 0 0 3px #fff' : '0 0 3px #000, 0 0 3px #000', opacity: 0.95,
                }}>
                  {code} <span style={{ fontWeight: 500, opacity: 0.85 }}>{r.name.replace(code, '').trim()}</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Walls({ walls, doors, entities, selectedId, hovered, onSelect, onHover, isLight }: {
  walls: WallEntity[]; doors: DoorEntity[]; entities: Record<string, FloorplanEntity>; selectedId: string | null; hovered: string | null;
  onSelect(id: string): void; onHover?(id: string | null): void; isLight: boolean;
}) {
  const wallMat = useMemo(() => ({ ext: isLight ? '#8d8d8d' : '#6e6e6e', int: isLight ? '#d9d9d9' : '#9a9a9a', sel: '#3B9EFF' }), [isLight]);
  return (
    <group>
      {walls.map(w => {
        const kind = String(w.meta?.kind ?? 'wall');
        const active = selectedId === w.id || hovered === w.id;
        const isRoute = kind === 'duct' || kind === 'cable';
        const z0 = isRoute ? Number(w.meta?.z ?? 0) : 0;
        const routeColor = ROUTE_COLORS[String(w.meta?.route_kind)] ?? '#667';
        return w.points.slice(1).map((b, i) => {
          const a = w.points[i];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1e-4) return null;
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          if (isRoute) {
            const round = String(w.meta?.size ?? '').startsWith('DN');
            return (
              <group key={`${w.id}_${i}`} position={P(mx, my, z0 + w.height / 2)} rotation={[0, ang, 0]}>
                <mesh rotation={round ? [0, 0, Math.PI / 2] : [0, 0, 0]} castShadow
                  onClick={e => { e.stopPropagation(); onSelect(w.id); }}
                  onPointerOver={e => { e.stopPropagation(); onHover?.(w.id); }}
                  onPointerOut={() => onHover?.(null)}>
                  {round
                    ? <cylinderGeometry args={[w.thickness / 2, w.thickness / 2, len + w.thickness * 0.5, 20]} />
                    : <boxGeometry args={[len + w.thickness * 0.5, w.height, w.thickness]} />}
                  <meshStandardMaterial color={active ? '#3B9EFF' : routeColor} roughness={0.5} metalness={0.3}
                    transparent={w.layer.startsWith('expansion-')} opacity={w.layer.startsWith('expansion-') ? 0.75 : 1} />
                </mesh>
              </group>
            );
          }
          return (
            <mesh
              key={`${w.id}_${i}`}
              position={P(mx, my, w.height / 2)}
              rotation={[0, ang, 0]}
              castShadow receiveShadow
              onClick={e => { e.stopPropagation(); onSelect(w.id); }}
              onPointerOver={e => { e.stopPropagation(); onHover?.(w.id); }}
              onPointerOut={() => onHover?.(null)}
            >
              <boxGeometry args={[len, w.height, w.thickness]} />
              <meshStandardMaterial color={active ? wallMat.sel : w.layer.startsWith('expansion-') ? '#e06060' : kind === 'exterior' ? wallMat.ext : wallMat.int} roughness={0.85}
                transparent={w.layer.startsWith('expansion-')} opacity={w.layer.startsWith('expansion-') ? 0.7 : 1} />
            </mesh>
          );
        });
      })}
      {doors.map(d => {
        const seg = doorSegment(d, entities[d.wallOwner]);
        if (!seg) return null;
        const [a, b] = seg;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const h = d.height ?? 1.97;
        const active = selectedId === d.id || hovered === d.id;
        const owner = entities[d.wallOwner];
        const t = owner?.type === 'wall' ? (owner as WallEntity).thickness : (owner as RoomEntity | undefined)?.wallThickness ?? 0.13;
        return (
          <mesh key={d.id} position={P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, h / 2)} rotation={[0, ang, 0]}
            onClick={e => { e.stopPropagation(); onSelect(d.id); }}
            onPointerOver={e => { e.stopPropagation(); onHover?.(d.id); }}
            onPointerOut={() => onHover?.(null)}>
            <boxGeometry args={[d.width, h, Math.max(t, 0.08) + 0.04]} />
            <meshStandardMaterial color={active ? '#3B9EFF' : '#b5651d'} roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

interface EqVisual { color: string; emissive: string; emissiveIntensity: number; opacity: number; z: number; h: number }

function equipmentVisual(eq: EquipmentEntity, H: Record<string, number>, dev: LabDevice | undefined, roomLightsOn: boolean | undefined, active: boolean): EqVisual {
  const def = getEquipmentById(eq.equipmentId);
  const layer = eq.layer;
  const isLightRow = layer.includes('light') || def?.category === 'lighting';
  const isTable = layer.includes('table') || eq.equipmentId.startsWith('grow_table');
  const isHvac = layer.includes('hvac') || def?.category === 'hvac' || def?.category === 'ventilation';
  const isDehu = def?.category === 'dehumidifier';
  let z = Number(eq.meta?.z);
  let h = Number(eq.meta?.h);
  if (!isFinite(z)) z = isLightRow ? H.light : isHvac ? H.hvac_indoor_bottom : 0;
  if (!isFinite(h) || h <= 0) h = isLightRow ? H.light_depth : isTable ? H.table_top : isHvac ? 0.3 : isDehu ? 0.55 : 0.8;

  let color = '#94a3b8', emissive = '#000000', ei = 0, opacity = 1;
  if (isTable) color = '#e39bb8';
  else if (isLightRow) {
    const on = roomLightsOn ?? true;
    color = on ? '#fff4c2' : '#7a7a7a';
    emissive = on ? '#ffd54a' : '#000000';
    ei = on ? (roomLightsOn === undefined ? 0.6 : 1.4) : 0;
  } else if (isHvac) color = '#6fb1ff';
  else if (isDehu) color = '#5ec8c8';
  else if (def?.category === 'irrigation') color = '#4fa3f7';
  else if (def?.category === 'co2') color = '#c9a0ff';
  else if (def?.category === 'processing') color = '#f0b46a';

  if (dev) {
    if (dev.status === 'offline') { color = '#8a8a8a'; emissive = '#ff4d4d'; ei = 0.35; }
    else if (dev.status === 'maintenance') { emissive = '#f59e0b'; ei = 0.35; }
    else if (dev.status === 'active' || dev.status === 'online') { if (!isLightRow) { emissive = '#22c55e'; ei = 0.25; } }
    else if (dev.status === 'retired') { opacity = 0.4; }
  }
  if (active) { emissive = '#3B9EFF'; ei = 0.9; }
  return { color, emissive, emissiveIntensity: ei, opacity, z, h };
}

function Equipment({ items, H, selectedId, hovered, onSelect, onHover, devices, roomLights, showLabels, isLight }: {
  items: EquipmentEntity[]; H: Record<string, number>; selectedId: string | null; hovered: string | null;
  onSelect(id: string): void; onHover?(id: string | null): void; devices: Record<string, LabDevice>;
  roomLights: Map<string, boolean | undefined>; showLabels: boolean; isLight: boolean;
}) {
  return (
    <group>
      {items.map(eq => {
        const dev = findBound(devices, eq.binding);
        const active = selectedId === eq.id || hovered === eq.id;
        const v = equipmentVisual(eq, H, dev, eq.roomId ? roomLights.get(eq.roomId) : undefined, active);
        const [w, d] = eq.dimensions;
        const label = dev?.name ?? eq.binding?.name;
        return (
          <group key={eq.id} position={P(eq.center[0], eq.center[1], v.z + v.h / 2)} rotation={[0, (eq.rotation * Math.PI) / 180, 0]}>
            <mesh castShadow receiveShadow
              onClick={e => { e.stopPropagation(); onSelect(eq.id); }}
              onPointerOver={e => { e.stopPropagation(); onHover?.(eq.id); }}
              onPointerOut={() => onHover?.(null)}>
              <boxGeometry args={[Math.max(w, 0.05), Math.max(v.h, 0.02), Math.max(d, 0.05)]} />
              <meshStandardMaterial color={v.color} emissive={v.emissive} emissiveIntensity={v.emissiveIntensity} transparent={v.opacity < 1} opacity={v.opacity} roughness={0.7} metalness={0.05} />
            </mesh>
            {showLabels && (label || active) && (
              <Html position={[0, v.h / 2 + 0.15, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 10, fontWeight: 600, fontFamily: 'system-ui, sans-serif', padding: '1px 5px', borderRadius: 4,
                  background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)', color: isLight ? '#111' : '#fff', border: dev ? `1px solid ${dev.status === 'offline' ? '#ef4444' : '#22c55e'}` : 'none' }}>
                  {label ?? getEquipmentById(eq.equipmentId)?.name ?? eq.equipmentId}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Translucent band showing the duct zone under the ceiling of grow rooms (from heights_m). */
function DuctZone({ rooms, H, isLight }: { rooms: RoomEntity[]; H: Record<string, number>; isLight: boolean }) {
  const grow = rooms.filter(r => r.roomTypeId === 'grow_flower' || r.roomTypeId === 'grow_veg');
  if (!isFinite(H.duct_bottom) || !isFinite(H.duct_top)) return null;
  return (
    <group>
      {grow.map(r => {
        const b = bboxOfEntity(r)!;
        const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
        return (
          <mesh key={r.id} position={P((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (H.duct_bottom + H.duct_top) / 2)} raycast={() => null}>
            <boxGeometry args={[Math.max(w - 0.6, 0.1), H.duct_top - H.duct_bottom, Math.max(d - 0.6, 0.1)]} />
            <meshStandardMaterial color={isLight ? '#9fb3c8' : '#5b6b7d'} transparent opacity={0.12} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Camera rig ───────────────────────────────────────────────────────────────

type RigApi = { preset: (p: CameraPreset) => void; zoomTo: (b: { min: Point2D; max: Point2D; h: number }) => void; snapshot: () => string | null };

function CameraRig({ register, center, size }: { register: (api: RigApi) => void; center: Point2D; size: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, gl } = useThree();

  const fly = useCallback((pos: [number, number, number], target: [number, number, number]) => {
    camera.position.set(...pos);
    if (controls.current) { controls.current.target.set(...target); controls.current.update(); }
    camera.lookAt(...target);
  }, [camera]);

  useEffect(() => {
    const api: RigApi = {
      preset: (p) => {
        const [cx, cy] = center;
        const t: [number, number, number] = P(cx, cy, 1.2);
        if (p === 'top') fly(P(cx, cy - 0.01, size * 1.7), t);
        else if (p === 'iso') fly(P(cx - size * 0.75, cy - size * 0.75, size * 0.7), t);
        else if (p === 'orbit') fly(P(cx + size * 0.6, cy - size * 0.9, size * 0.45), t);
        else if (p === 'walk') fly(P(cx, cy - size * 0.55, 1.7), P(cx, cy, 1.5));
      },
      zoomTo: (b) => {
        const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
        const s = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 2);
        fly(P(cx - s * 0.9, cy - s * 1.1, Math.max(b.h, 2) + s * 0.7), P(cx, cy, b.h / 2));
      },
      snapshot: () => { try { return gl.domElement.toDataURL('image/png'); } catch { return null; } },
    };
    register(api);
    if (!initialised.current) { initialised.current = true; api.preset('iso'); }
  }, [register, center, size, fly, gl]);
  const initialised = useRef(false);

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={1.5} maxDistance={size * 4} />;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export const FacilityScene = forwardRef<FacilitySceneHandle, FacilitySceneProps>(function FacilityScene(props, ref) {
  const { entities, layerVisible, scope, selectedId, onSelect, onHover, showLabels, isLight, heights, devices, labRooms, clock } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const api = useRef<RigApi | null>(null);
  const register = useCallback((a: RigApi) => { api.current = a; }, []);
  const H = useMemo(() => ({ ...DEFAULT_H, ...heights }), [heights]);

  const visible = useMemo(() => Object.values(entities).filter(e => e.visible && (layerVisible.get(e.layer) ?? true) && (!scope || scope.has(e.id))), [entities, layerVisible, scope]);
  const rooms = useMemo(() => visible.filter(e => e.type === 'room') as RoomEntity[], [visible]);
  const walls = useMemo(() => visible.filter(e => e.type === 'wall') as WallEntity[], [visible]);
  const doors = useMemo(() => visible.filter(e => e.type === 'door') as DoorEntity[], [visible]);
  const equipment = useMemo(() => visible.filter(e => e.type === 'equipment') as EquipmentEntity[], [visible]);

  // room entity id -> lights on now (from the mapped Lab room schedule)
  const roomLights = useMemo(() => {
    const m = new Map<string, boolean | undefined>();
    for (const r of Object.values(entities)) {
      if (r.type !== 'room') continue;
      const lab = labRooms.find(x => x.id === (r as RoomEntity).labRoomId);
      m.set(r.id, lightsOnNow(lab));
    }
    return m;
  }, [entities, labRooms, clock]); // eslint-disable-line react-hooks/exhaustive-deps

  const { center, size } = useMemo(() => {
    const all = Object.values(entities).filter(e => e.type === 'room' || e.type === 'wall');
    const min: Point2D = [Infinity, Infinity], max: Point2D = [-Infinity, -Infinity];
    for (const e of all) { const b = bboxOfEntity(e); if (!b) continue; min[0] = Math.min(min[0], b.min[0]); min[1] = Math.min(min[1], b.min[1]); max[0] = Math.max(max[0], b.max[0]); max[1] = Math.max(max[1], b.max[1]); }
    if (!isFinite(min[0])) return { center: [0, 0] as Point2D, size: 20 };
    return { center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] as Point2D, size: Math.max(max[0] - min[0], max[1] - min[1], 5) };
  }, [entities]);

  useImperativeHandle(ref, () => ({
    setPreset: (p) => api.current?.preset(p),
    zoomTo: (id) => { const e = entities[id]; const b = e && bboxOfEntity(e); if (b) api.current?.zoomTo(b); },
    snapshot: () => api.current?.snapshot() ?? null,
  }), [entities]);

  const hover = useCallback((id: string | null) => { setHovered(id); onHover?.(id); }, [onHover]);

  return (
    <R3FCanvas
      shadows
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ fov: 45, near: 0.1, far: 500, position: P(center[0] - size, center[1] - size, size) }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: isLight ? '#eef1f5' : '#15171b', cursor: hovered ? 'pointer' : 'default' }}
    >
      <hemisphereLight args={[isLight ? '#ffffff' : '#cfd8ff', isLight ? '#cfd3da' : '#202020', 0.75]} />
      <directionalLight position={P(center[0] - size, center[1] - size * 0.6, size * 1.2)} intensity={isLight ? 1.1 : 0.8} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size} shadow-camera-far={size * 4} />
      <ambientLight intensity={isLight ? 0.35 : 0.25} />

      <Grid position={P(center[0], center[1], -0.002)} args={[size * 4, size * 4]} cellSize={1} sectionSize={5}
        cellColor={isLight ? '#c8ccd3' : '#2c3038'} sectionColor={isLight ? '#a6abb5' : '#3a3f4a'} fadeDistance={size * 3} infiniteGrid={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P(center[0], center[1], -0.01)} receiveShadow onClick={() => onSelect(null)}>
        <planeGeometry args={[size * 4, size * 4]} />
        <meshStandardMaterial color={isLight ? '#e6e9ee' : '#1c1f25'} roughness={1} />
      </mesh>

      <Suspense fallback={null}>
        <Rooms rooms={rooms} selectedId={selectedId} onSelect={onSelect} onHover={hover} showLabels={showLabels} isLight={isLight} hovered={hovered} />
        <Walls walls={walls} doors={doors} entities={entities} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={hover} isLight={isLight} />
        <Equipment items={equipment} H={H} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={hover} devices={devices} roomLights={roomLights} showLabels={showLabels} isLight={isLight} />
        <DuctZone rooms={rooms} H={H} isLight={isLight} />
        <ContactShadows position={P(center[0], center[1], 0.001)} opacity={isLight ? 0.35 : 0.5} scale={size * 2.5} blur={2} far={4} resolution={1024} frames={1} />
      </Suspense>

      <CameraRig register={register} center={center} size={size} />
    </R3FCanvas>
  );
});
