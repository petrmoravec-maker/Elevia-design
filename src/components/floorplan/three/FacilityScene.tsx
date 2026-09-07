/**
 * 3D view of the facility plan (react-three-fiber). Same store, same layer visibility, same
 * selection as the 2D canvas - only the renderer differs.
 *
 * World mapping: plan X -> three X, plan Y (north) -> three -Z, height -> three Y.
 * Props are modelled on the site photos of the stage II grow rooms: continuous rolling benches
 * with Grodan blocks and plants, purple 8-bar LED fixtures on wires, wall-mounted Quest
 * dehumidifiers, Sinclair duct units, white plasterboard walls and ceilings, grey epoxy floor.
 *
 * Cutaway: the walls between the camera and the room it looks into fade out (see cutaway.ts).
 * Live state: light rows follow controller channels / schedules, valves animate the drip lines.
 */

import { forwardRef, useImperativeHandle, useMemo, useRef, useState, useCallback, useEffect, Suspense } from 'react';
import { Canvas as R3FCanvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Grid, ContactShadows, Environment, MeshReflectorMaterial, RoundedBox, Instances, Instance } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, N8AO } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type {
  FloorplanEntity, RoomEntity, WallEntity, DoorEntity, EquipmentEntity, Point2D,
} from '../../../types/floorplan';
import { polygonCentroid } from '../../../types/floorplan';
import { ROOM_TYPES } from '../../../data/roomTypes';
import { getEquipmentById } from '../../../data/equipmentLibrary';
import { doorSegment, type EditorTool } from '../../../stores/useFloorplanStore';
import { ROUTE_COLORS } from '../Canvas';
import type { LabDevice, LabRoom, ControlDevice, RoomLive } from '../../../services/labInventory';
import { findBound, lightsOnNow, roomLive } from '../../../services/labInventory';
import { makePlantGeometry, concreteTexture, epoxyTexture, epoxyRoughness, steelTexture, plasterTexture, aluminiumRibTexture, grodanTexture, galvanisedTexture } from './assets';
import { activeRoomAt, occludingWalls, type WallSeg, type RoomShape } from './cutaway';

export type CameraPreset = 'iso' | 'top' | 'orbit' | 'walk' | 'room';
export type CutawayMode = 'auto' | 'glass' | 'solid' | 'cut';
export type Quality = 'high' | 'balanced' | 'fast';

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
  control?: Record<string, ControlDevice>;
  focusIds?: Set<string> | null;
  autoOrbit?: boolean;
  activeTool?: EditorTool;
  cutaway?: CutawayMode;
  quality?: Quality;
  /** localStorage key for camera persistence */
  cameraKey?: string;
  onActiveRoom?(roomId: string | null): void;
  onDegrade?(): void;
  clock?: number;
}

const DEFAULT_H = { table_top: 0.75, light: 2.55, light_depth: 0.08, hvac_indoor_bottom: 3.15, duct_bottom: 2.95, duct_top: 3.45, dehumidifier_bottom: 2.35 };
const DIM_OPACITY = 0.1;

// plan -> three
const P = (x: number, y: number, z = 0): [number, number, number] => [x, z, -y];

let ASSETS: ReturnType<typeof buildAssets> | null = null;
function buildAssets() {
  return {
    plant: makePlantGeometry(), concrete: concreteTexture(false), concreteLight: concreteTexture(true), epoxy: epoxyTexture(), epoxyRough: epoxyRoughness(),
    steel: steelTexture(), plaster: plasterTexture(), alu: aluminiumRibTexture(), grodan: grodanTexture(), galv: galvanisedTexture(),
  };
}
function assets() { return (ASSETS ??= buildAssets()); }

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

function roomCodeOf(r: RoomEntity): string {
  return typeof r.meta?.code === 'string' ? (r.meta!.code as string) : r.name.split(' ')[0];
}
function roomColor(r: RoomEntity): string {
  return ROOM_TYPES.find(t => t.id === r.roomTypeId)?.color ?? '#94a3b8';
}
function floorTint(hex: string, isLight: boolean): string {
  const c = new THREE.Color(hex);
  const base = new THREE.Color(isLight ? '#b4b6b3' : '#9fa19d');   // grey epoxy as photographed
  return '#' + base.lerp(c, 0.08).getHexString();
}

type Handlers = { onClick: (e: { stopPropagation(): void }) => void; onPointerOver: (e: { stopPropagation(): void }) => void; onPointerOut: () => void };
const mkHandlers = (id: string, onSelect: (id: string) => void, onHover?: (id: string | null) => void): Handlers => ({
  onClick: e => { e.stopPropagation(); onSelect(id); },
  onPointerOver: e => { e.stopPropagation(); onHover?.(id); },
  onPointerOut: () => onHover?.(null),
});

// ─── Shared fade registry (cutaway) ───────────────────────────────────────────
// wall id -> { mats, target } ; CutawayDriver updates targets each frame and lerps opacities.
type FadeEntry = { mats: THREE.Material[]; base: number; target: number; group?: THREE.Object3D };
type FadeRegistry = Map<string, FadeEntry>;

// ─── Rooms: epoxy floor slabs + ceilings ──────────────────────────────────────

function Rooms({ rooms, selectedId, onSelect, onHover, showLabels, isLight, hovered, focusIds, ceilings }: {
  rooms: RoomEntity[]; selectedId: string | null; onSelect(id: string): void; onHover?(id: string | null): void; showLabels: boolean; isLight: boolean; hovered: string | null;
  focusIds?: Set<string> | null; ceilings: React.MutableRefObject<THREE.Group | null>;
}) {
  const A = assets();
  return (
    <group>
      {rooms.map(r => {
        const dim = !!focusIds && !focusIds.has(r.id);
        // rotation -90deg about X maps shape (x, y) -> three (x, 0, -y), matching P()
        const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
        const c = polygonCentroid(r.polygon);
        const active = selectedId === r.id || hovered === r.id;
        const code = roomCodeOf(r);
        const planned = r.layer.startsWith('expansion-');
        return (
          <group key={r.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow {...mkHandlers(r.id, onSelect, onHover)}>
              <extrudeGeometry args={[shape, { depth: 0.03, bevelEnabled: false }]} />
              <meshPhysicalMaterial key={dim ? 'dim' : 'lit'} map={A.epoxy} roughnessMap={A.epoxyRough}
                color={planned ? '#7a2020' : floorTint(roomColor(r), isLight)}
                emissive={active ? '#3B9EFF' : '#000000'} emissiveIntensity={active ? 0.18 : 0}
                roughness={0.45} metalness={0.02} clearcoat={0.5} clearcoatRoughness={0.35}
                transparent={planned || dim} opacity={dim ? DIM_OPACITY : planned ? 0.7 : 1} />
            </mesh>
            {showLabels && !dim && (
              <Html position={P(c[0], c[1], 0.05)} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'system-ui, sans-serif', color: isLight ? '#111' : '#fff',
                  textShadow: isLight ? '0 0 3px #fff, 0 0 3px #fff' : '0 0 3px #000, 0 0 3px #000', opacity: 0.95 }}>
                  {code} <span style={{ fontWeight: 500, opacity: 0.85 }}>{r.name.replace(code, '').trim()}</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
      {/* ceilings (white plasterboard) - visibility driven per frame by camera height */}
      <group ref={ceilings}>
        {rooms.map(r => {
          const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
          const dim = !!focusIds && !focusIds.has(r.id);
          if (dim || r.layer.startsWith('expansion-')) return null;
          const fit = (r.meta?.fitout as { work_lights?: number } | undefined);
          const b = bboxOfEntity(r)!;
          const cx = (b.min[0] + b.max[0]) / 2, L = b.max[1] - b.min[1];
          return (
            <group key={r.id}>
              <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, r.ceilingHeight, 0]} raycast={() => null}>
                <shapeGeometry args={[shape]} />
                <meshStandardMaterial map={A.plaster} color="#f3f3f0" roughness={0.95} side={THREE.DoubleSide} />
              </mesh>
              {/* fluorescent work lights on the centre line (off by default) */}
              {fit?.work_lights ? Array.from({ length: fit.work_lights }, (_, i) => (
                <mesh key={i} position={P(cx, b.min[1] + ((i + 0.5) * L) / fit.work_lights!, r.ceilingHeight - 0.05)} raycast={() => null}>
                  <boxGeometry args={[0.08, 0.06, 1.2]} />
                  <meshStandardMaterial color="#dfe3e8" roughness={0.4} />
                </mesh>
              )) : null}
            </group>
          );
        })}
      </group>
    </group>
  );
}

// ─── Walls + doors ────────────────────────────────────────────────────────────

function Walls({ walls, doors, entities, selectedId, hovered, onSelect, onHover, isLight, focusIds, registry, mode, clip }: {
  walls: WallEntity[]; doors: DoorEntity[]; entities: Record<string, FloorplanEntity>; selectedId: string | null; hovered: string | null;
  onSelect(id: string): void; onHover?(id: string | null): void; isLight: boolean; focusIds?: Set<string> | null; registry: FadeRegistry; mode: CutawayMode; clip: THREE.Plane[] | null;
}) {
  const A = assets();
  const glass = mode === 'glass';
  const register = useCallback((id: string, base: number) => (m: THREE.Material | null) => {
    if (!m) return;
    const e = registry.get(id) ?? { mats: [], base, target: base };
    if (!e.mats.includes(m)) e.mats.push(m);
    e.base = base;
    registry.set(id, e);
  }, [registry]);
  return (
    <group>
      {walls.map(w => {
        const kind = String(w.meta?.kind ?? 'wall');
        const active = selectedId === w.id || hovered === w.id;
        const dim = !!focusIds && !focusIds.has(w.id);
        const isRoute = kind === 'duct' || kind === 'cable';
        const z0 = isRoute ? Number(w.meta?.z ?? 0) : 0;
        const routeColor = ROUTE_COLORS[String(w.meta?.route_kind)] ?? '#667';
        const planned = w.layer.startsWith('expansion-');
        const base = dim ? DIM_OPACITY : planned ? 0.6 : glass ? 0.42 : kind === 'exterior' ? 1 : 0.97;
        return w.points.slice(1).map((b, i) => {
          const a = w.points[i];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 1e-4) return null;
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          const segId = `${w.id}#${i}`;
          if (isRoute) {
            const round = String(w.meta?.size ?? '').startsWith('DN');
            return (
              <group key={segId} position={P(mx, my, z0 + w.height / 2)} rotation={[0, ang, 0]}>
                <mesh rotation={round ? [0, 0, Math.PI / 2] : [0, 0, 0]} castShadow {...mkHandlers(w.id, onSelect, onHover)}>
                  {round ? <cylinderGeometry args={[w.thickness / 2, w.thickness / 2, len + w.thickness * 0.5, 20]} /> : <boxGeometry args={[len + w.thickness * 0.5, w.height, w.thickness]} />}
                  <meshStandardMaterial key={dim ? 'dim' : 'lit'} color={active ? '#3B9EFF' : routeColor} roughness={0.35} metalness={0.65} map={A.galv}
                    transparent={planned || dim} opacity={dim ? DIM_OPACITY : planned ? 0.75 : 1} />
                </mesh>
              </group>
            );
          }
          return (
            <mesh key={segId} position={P(mx, my, w.height / 2)} rotation={[0, ang, 0]} castShadow receiveShadow {...mkHandlers(w.id, onSelect, onHover)}>
              <boxGeometry args={[len, w.height, w.thickness]} />
              <meshPhysicalMaterial
                ref={register(segId, base)}
                key={`${dim ? 'dim' : 'lit'}-${glass ? 'g' : 'w'}`}
                color={active ? '#3B9EFF' : planned ? '#e06060' : glass ? (isLight ? '#9fb3c8' : '#33465e') : kind === 'exterior' ? (isLight ? '#d6d8dc' : '#c9ccd2') : '#f2f2ee'}
                map={glass ? undefined : kind === 'exterior' ? (isLight ? A.concreteLight : A.concrete) : A.plaster}
                roughness={glass ? 0.15 : 0.9} metalness={0.02} clearcoat={glass ? 0.6 : 0.03}
                transparent opacity={base} depthWrite={base > 0.5} side={THREE.DoubleSide}
                clippingPlanes={clip ?? undefined} />
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
        const dimD = !!focusIds && !focusIds.has(d.id);
        const owner = entities[d.wallOwner];
        const t = owner?.type === 'wall' ? (owner as WallEntity).thickness : (owner as RoomEntity | undefined)?.wallThickness ?? 0.13;
        return (
          <group key={d.id} position={P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, h / 2)} rotation={[0, ang, 0]}>
            <mesh {...mkHandlers(d.id, onSelect, onHover)}>
              <boxGeometry args={[d.width, h, Math.max(t, 0.08) + 0.04]} />
              <meshStandardMaterial key={dimD ? 'dim' : 'lit'} ref={register(`${d.id}#door`, dimD ? DIM_OPACITY : 1)} color={active ? '#3B9EFF' : '#f6f6f3'} roughness={0.5}
                transparent opacity={dimD ? DIM_OPACITY : 1} clippingPlanes={clip ?? undefined} />
            </mesh>
            {/* frame + handle */}
            <mesh position={[0, 0, 0]} raycast={() => null}>
              <boxGeometry args={[d.width + 0.08, h + 0.04, Math.max(t, 0.08) + 0.06]} />
              <meshStandardMaterial ref={register(`${d.id}#frame`, dimD ? DIM_OPACITY : 1)} color="#c9ccd2" roughness={0.5} metalness={0.3} transparent opacity={dimD ? DIM_OPACITY : 1} wireframe clippingPlanes={clip ?? undefined} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ─── Flow particles ───────────────────────────────────────────────────────────

function FlowLine({ points, count = 20, speed = 1, color = '#ffffff', size = 0.05, spread = 0, reverse = false }: {
  points: [number, number, number][]; count?: number; speed?: number; color?: string; size?: number; spread?: number; reverse?: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const { segs, total } = useMemo(() => {
    const segs: { a: THREE.Vector3; b: THREE.Vector3; len: number; start: number }[] = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]);
      const len = a.distanceTo(b);
      segs.push({ a, b, len, start: total });
      total += len;
    }
    return { segs, total: total || 1 };
  }, [points]);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => ({ t: i / count, ox: (Math.sin(i * 12.9898) * 0.5) * spread, oz: (Math.cos(i * 78.233) * 0.5) * spread })), [count, spread]);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  useFrame((state) => {
    const pts = ref.current;
    if (!pts) return;
    const time = state.clock.getElapsedTime();
    const arr = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      let t = (offsets[i].t + (time * speed) / total) % 1;
      if (reverse) t = 1 - t;
      const dist = t * total;
      const sg = segs.find(sg => dist >= sg.start && dist <= sg.start + sg.len) ?? segs[segs.length - 1];
      const u = sg.len ? (dist - sg.start) / sg.len : 0;
      arr[i * 3] = sg.a.x + (sg.b.x - sg.a.x) * u + offsets[i].ox;
      arr[i * 3 + 1] = sg.a.y + (sg.b.y - sg.a.y) * u;
      arr[i * 3 + 2] = sg.a.z + (sg.b.z - sg.a.z) * u + offsets[i].oz;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref} raycast={() => null}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial color={color} size={size} sizeAttenuation transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// ─── Bench (rolling bench with Grodan blocks, plants, drip line, trellis) ─────

function Bench({ eq, H, active, planned, dim, lightsOn, irrigationOn, handlers, trellisRail }: {
  eq: EquipmentEntity; H: Record<string, number>; active: boolean; planned: boolean; dim: boolean; lightsOn: boolean | undefined; irrigationOn: boolean; handlers: Handlers; trellisRail?: number;
}) {
  const A = assets();
  const [w, L] = eq.dimensions;              // w across (x), L along (y -> -z)
  const top = H.table_top;
  const trayH = 0.06;
  const blocks = useMemo(() => {
    const cols = Math.max(1, Math.round(w / 0.3)), rows = Math.max(1, Math.round(L / 0.3));
    const out: [number, number, number, number][] = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -w / 2 + (i + 0.5) * (w / cols), z = -L / 2 + (j + 0.5) * (L / rows);
      const s = 0.55 + 0.3 * (((i * 7 + j * 13) % 10) / 10);
      const rot = ((i * 31 + j * 17) % 12) * (Math.PI / 6);
      out.push([x, z, s, rot]);
    }
    return out;
  }, [w, L]);
  const legs = useMemo(() => {
    const n = Math.max(2, Math.round(L / 1.5) + 1);
    return Array.from({ length: n }, (_, i) => -L / 2 + 0.12 + (i * (L - 0.24)) / (n - 1));
  }, [L]);
  const drip = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const n = Math.max(8, Math.round(L / 0.25));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(Math.sin(t * Math.PI * n * 0.5) * (w * 0.28), top + trayH + 0.03, -L / 2 + t * L));
    }
    return new THREE.CatmullRomCurve3(pts);
  }, [w, L, top]);
  const tint = planned ? '#c07070' : lightsOn === false ? '#9fb59a' : '#ffffff';
  const op = dim ? DIM_OPACITY : planned ? 0.7 : 1;
  const legMat = <meshStandardMaterial key={dim ? 'dim' : 'lit'} map={A.galv} color="#c3c7cd" roughness={0.45} metalness={0.7} transparent={dim} opacity={dim ? DIM_OPACITY : 1} />;
  return (
    <group position={[0, 0, 0]}>
      {/* tray (ribbed aluminium) */}
      <mesh position={[0, top - trayH / 2, 0]} castShadow receiveShadow {...handlers}>
        <boxGeometry args={[w, trayH, L]} />
        <meshPhysicalMaterial key={dim ? 'dim' : 'lit'} map={A.alu} color={active ? '#8fc4ff' : planned ? '#d88' : '#eef0f2'} roughness={0.35} metalness={0.4} clearcoat={0.3} transparent={planned || dim} opacity={op} />
      </mesh>
      {/* tray rim */}
      <mesh position={[0, top + 0.02, 0]} raycast={() => null}>
        <boxGeometry args={[w + 0.02, 0.04, L + 0.02]} />
        <meshStandardMaterial key={dim ? 'dim' : 'lit'} map={A.alu} color="#f4f5f7" roughness={0.3} metalness={0.5} transparent={dim} opacity={dim ? DIM_OPACITY : 1} />
      </mesh>
      {/* irrigation mains under the tray */}
      {[-0.25, 0.25].map((dx, i) => (
        <mesh key={i} position={[dx * w, top - 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.025, 0.025, L, 12]} />
          {legMat}
        </mesh>
      ))}
      {/* legs + cross bars + base plates */}
      {legs.map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          {[-1, 1].map(sx => (
            <group key={sx} position={[sx * (w / 2 - 0.06), 0, 0]}>
              <mesh position={[0, (top - trayH) / 2, 0]} castShadow raycast={() => null}><boxGeometry args={[0.04, top - trayH, 0.04]} />{legMat}</mesh>
              <mesh position={[0, 0.006, 0]} raycast={() => null}><boxGeometry args={[0.12, 0.012, 0.12]} />{legMat}</mesh>
            </group>
          ))}
          <mesh position={[0, 0.35, 0]} raycast={() => null}><boxGeometry args={[w - 0.12, 0.03, 0.03]} />{legMat}</mesh>
          <mesh position={[0, top - trayH - 0.05, 0]} raycast={() => null}><boxGeometry args={[w - 0.12, 0.03, 0.03]} />{legMat}</mesh>
        </group>
      ))}
      {/* longitudinal rails between legs */}
      {[-1, 1].map(sx => (
        <mesh key={sx} position={[sx * (w / 2 - 0.06), 0.35, 0]} raycast={() => null}><boxGeometry args={[0.03, 0.03, L - 0.2]} />{legMat}</mesh>
      ))}
      {!dim && (
        <>
          {/* Grodan blocks: wrap + rockwool top */}
          <Instances frustumCulled={false} range={blocks.length} castShadow receiveShadow>
            <boxGeometry args={[0.15, 0.142, 0.15]} />
            <meshStandardMaterial map={A.grodan} color="#ffffff" roughness={0.85} />
            {blocks.map(([x, z], i) => <Instance key={i} position={[x, top + 0.071, z]} />)}
          </Instances>
          <Instances frustumCulled={false} range={blocks.length}>
            <boxGeometry args={[0.15, 0.006, 0.15]} />
            <meshStandardMaterial color="#6b4a2b" roughness={1} />
            {blocks.map(([x, z], i) => <Instance key={i} position={[x, top + 0.145, z]} />)}
          </Instances>
          {/* plants */}
          <Instances frustumCulled={false} range={blocks.length} geometry={A.plant} castShadow>
            <meshStandardMaterial vertexColors color={tint} roughness={0.7} side={THREE.DoubleSide} />
            {blocks.map(([x, z, sc, rot], i) => <Instance key={i} position={[x, top + 0.142, z]} scale={[sc, sc, sc]} rotation={[0, rot, 0]} />)}
          </Instances>
          {/* drip line (white PE) on the tray, glowing while the valve is open */}
          <mesh raycast={() => null}>
            <tubeGeometry args={[drip, Math.max(24, Math.round(L * 12)), 0.008, 6, false]} />
            <meshStandardMaterial color={irrigationOn ? '#c8f0ff' : '#f2f2f0'} emissive={irrigationOn ? '#3fb7ff' : '#000'} emissiveIntensity={irrigationOn ? 1.2 : 0} roughness={0.6} />
          </mesh>
          {irrigationOn && (
            <FlowLine points={[[-w * 0.2, top + trayH + 0.06, -L / 2 + 0.1], [w * 0.2, top + trayH + 0.06, L / 2 - 0.1]]} count={Math.round(L * 2)} speed={0.6} color="#5ab4ff" size={0.035} spread={w * 0.3} />
          )}
          {/* trellis: white poles at the ends and every ~3 m, two longitudinal rails */}
          {trellisRail && (
            <group>
              {legs.filter((_, i) => i % 2 === 0 || i === legs.length - 1).map((z, i) => [-1, 1].map(sx => (
                <mesh key={`${i}-${sx}`} position={[sx * (w / 2 - 0.02), top + (trellisRail - top) / 2, z]} raycast={() => null}>
                  <cylinderGeometry args={[0.012, 0.012, trellisRail - top, 8]} />
                  <meshStandardMaterial color="#f5f5f2" roughness={0.5} metalness={0.2} />
                </mesh>
              )))}
              {[-1, 1].map(sx => (
                <mesh key={sx} position={[sx * (w / 2 - 0.02), trellisRail, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
                  <cylinderGeometry args={[0.012, 0.012, L, 8]} />
                  <meshStandardMaterial color="#f5f5f2" roughness={0.5} metalness={0.2} />
                </mesh>
              ))}
            </group>
          )}
        </>
      )}
    </group>
  );
}

// ─── LED fixtures (instanced per room: purple rails, 8 white bars, wires) ────

function LedFixtures({ items, H, selectedId, hovered, onSelect, onHover, on, dimSet, beams, planned }: {
  items: EquipmentEntity[]; H: Record<string, number>; selectedId: string | null; hovered: string | null; onSelect(id: string): void; onHover?(id: string | null): void;
  on: Map<string, boolean | undefined>; dimSet?: Set<string> | null; beams: boolean; planned: boolean;
}) {
  const fixtures = useMemo(() => items.map(eq => {
    const [w, d] = eq.dimensions;
    const z = Number(eq.meta?.z ?? H.light), h = Number(eq.meta?.h ?? 0.08);
    return { eq, w, d, z, h, bars: Number(eq.meta?.bars ?? 8), frame: String(eq.meta?.frame_color ?? '#b23bc9'), pos: P(eq.center[0], eq.center[1], z + h / 2), ceiling: H.duct_top + 0.05 };
  }), [items, H]);
  const A = assets();
  const wires = useMemo(() => {
    const arr: number[] = [];
    for (const f of fixtures) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        arr.push(f.pos[0] + sx * (f.w / 2 - 0.08), f.pos[1] + f.h / 2, f.pos[2] + sz * (f.d / 2 - 0.08));
        arr.push(f.pos[0] + sx * (f.w / 2 - 0.08), f.ceiling, f.pos[2] + sz * (f.d / 2 - 0.08));
      }
    }
    return new Float32Array(arr);
  }, [fixtures]);
  if (!fixtures.length) return null;
  const nBars = fixtures[0].bars;
  return (
    <group>
      {/* purple rails: 2 per fixture along the bench (z) */}
      <Instances frustumCulled={false} range={fixtures.length * 2} castShadow>
        <boxGeometry args={[0.05, 0.08, 1]} />
        <meshPhysicalMaterial color={fixtures[0].frame} roughness={0.3} metalness={0.6} clearcoat={0.5} transparent={planned} opacity={planned ? 0.7 : 1} />
        {fixtures.flatMap(f => [-1, 1].map(sx => {
          const d = !!dimSet && !dimSet.has(f.eq.id);
          const active = selectedId === f.eq.id || hovered === f.eq.id;
          return <Instance key={`${f.eq.id}-${sx}`} position={[f.pos[0] + sx * (f.w / 2 - 0.025), f.pos[1], f.pos[2]]} scale={[1, 1, f.d]} color={d ? '#333' : active ? '#3B9EFF' : f.frame} {...mkHandlers(f.eq.id, onSelect, onHover)} />;
        }))}
      </Instances>
      {/* white LED bars across (x) */}
      <Instances frustumCulled={false} range={fixtures.length * nBars}>
        <boxGeometry args={[1, 0.035, 0.05]} />
        <meshStandardMaterial map={A.steel} color="#ffffff" roughness={0.3} metalness={0.4} transparent={planned} opacity={planned ? 0.7 : 1} />
        {fixtures.flatMap(f => Array.from({ length: f.bars }, (_, bi) => {
          const d = !!dimSet && !dimSet.has(f.eq.id);
          return <Instance key={`${f.eq.id}-b${bi}`} position={[f.pos[0], f.pos[1] - 0.015, f.pos[2] - f.d / 2 + ((bi + 0.5) * f.d) / f.bars]} scale={[f.w - 0.06, 1, 1]} color={d ? '#444' : '#ffffff'} {...mkHandlers(f.eq.id, onSelect, onHover)} />;
        }))}
      </Instances>
      {/* emitting undersides (per-instance colour = on/off) */}
      <Instances frustumCulled={false} range={fixtures.length * nBars}>
        <planeGeometry args={[1, 0.04]} />
        <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
        {fixtures.flatMap(f => Array.from({ length: f.bars }, (_, bi) => {
          const d = !!dimSet && !dimSet.has(f.eq.id);
          const lit = !d && (on.get(f.eq.roomId ?? '') ?? true);
          return <Instance key={`${f.eq.id}-e${bi}`} position={[f.pos[0], f.pos[1] - 0.034, f.pos[2] - f.d / 2 + ((bi + 0.5) * f.d) / f.bars]} rotation={[Math.PI / 2, 0, 0]} scale={[f.w - 0.08, 1, 1]} color={lit ? '#fff1e0' : '#3a3a3a'} />;
        }))}
      </Instances>
      {/* hanger wires */}
      <lineSegments raycast={() => null}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[wires, 3]} /></bufferGeometry>
        <lineBasicMaterial color="#5a5f66" transparent opacity={0.7} />
      </lineSegments>
      {/* light beams (cheap additive wedges) */}
      {beams && fixtures.map(f => {
        const d = !!dimSet && !dimSet.has(f.eq.id);
        const lit = !d && (on.get(f.eq.roomId ?? '') ?? true);
        if (!lit) return null;
        const coneH = Math.max(0.3, f.z - H.table_top - 0.2);
        return (
          <mesh key={`${f.eq.id}-beam`} position={[f.pos[0], f.pos[1] - f.h / 2 - coneH / 2, f.pos[2]]} scale={[f.w / 2 + 0.1, 1, f.d / 2 + 0.1]} raycast={() => null}>
            <cylinderGeometry args={[1.0, 0.8, coneH, 4, 1, true]} />
            <meshBasicMaterial color="#ffe6c8" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Units: dehumidifier (wall), HVAC duct unit (ceiling), generic ───────────

function Dehumidifier({ eq, dev, active, dim, running, handlers }: { eq: EquipmentEntity; dev?: LabDevice; active: boolean; dim: boolean; running: boolean; handlers: Handlers }) {
  const [w, d] = eq.dimensions;
  const z = Number(eq.meta?.z ?? 2.35), h = Number(eq.meta?.h ?? 0.53);
  // wall-mounted: the short side (w) points into the room; hose drops to the floor along the wall
  const hose = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(0, -h / 2, d / 2 - 0.05), new THREE.Vector3(0.05, -h / 2 - 0.4, d / 2), new THREE.Vector3(0.02, -z - h / 2 + 0.05, d / 2 + 0.02)]), [h, d, z]);
  const op = dim ? DIM_OPACITY : 1;
  return (
    <group position={P(eq.center[0], eq.center[1], z + h / 2)}>
      <RoundedBox args={[w, h, d]} radius={0.02} smoothness={3} castShadow {...handlers}>
        <meshPhysicalMaterial key={dim ? 'dim' : 'lit'} color={active ? '#8fc4ff' : '#f4f5f4'} roughness={0.35} metalness={0.2} clearcoat={0.4} transparent={dim} opacity={op} />
      </RoundedBox>
      {/* intake grille on the room side */}
      <mesh position={[(eq.center[0] < 2.25 ? 1 : -1) * (w / 2 + 0.002), 0, 0]} rotation={[0, Math.PI / 2, 0]} raycast={() => null}>
        <planeGeometry args={[d * 0.8, h * 0.6]} />
        <meshStandardMaterial key={dim ? 'dim' : 'lit'} color="#3a3d42" roughness={0.9} transparent={dim} opacity={op} />
      </mesh>
      {/* bracket */}
      <mesh position={[0, -h / 2 - 0.02, 0]} raycast={() => null}>
        <boxGeometry args={[w * 0.9, 0.04, d * 0.9]} />
        <meshStandardMaterial key={dim ? 'dim' : 'lit'} color="#9aa0a8" metalness={0.6} roughness={0.4} transparent={dim} opacity={op} />
      </mesh>
      {!dim && (
        <mesh raycast={() => null}>
          <tubeGeometry args={[hose, 16, 0.01, 6, false]} />
          <meshStandardMaterial color="#2a2a2e" roughness={0.8} />
        </mesh>
      )}
      {dev && !dim && (
        <mesh position={[0, h / 2 - 0.04, d / 2 + 0.002]}>
          <sphereGeometry args={[0.015, 10, 10]} />
          <meshStandardMaterial color={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissive={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      )}
      {running && !dim && <FlowLine points={[[0, -h / 2, 0], [0, -h / 2 - 1.2, 0]]} count={12} speed={0.7} color="#dfe8ff" size={0.05} spread={Math.max(w, d) * 0.4} />}
    </group>
  );
}

function HvacUnit({ eq, dev, active, dim, running, handlers }: { eq: EquipmentEntity; dev?: LabDevice; active: boolean; dim: boolean; running: boolean; handlers: Handlers }) {
  const [w, d] = eq.dimensions;
  const z = Number(eq.meta?.z ?? 3.15), h = Number(eq.meta?.h ?? 0.3);
  const op = dim ? DIM_OPACITY : 1;
  return (
    <group position={P(eq.center[0], eq.center[1], z + h / 2)}>
      <RoundedBox args={[w, h, d]} radius={0.015} smoothness={2} castShadow {...handlers}>
        <meshPhysicalMaterial key={dim ? 'dim' : 'lit'} color={active ? '#8fc4ff' : '#b9bec6'} roughness={0.4} metalness={0.55} clearcoat={0.2} transparent={dim} opacity={op} />
      </RoundedBox>
      {/* panel seam + label */}
      <mesh position={[0, -h / 2 - 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[w * 0.98, 0.01]} />
        <meshBasicMaterial color="#8a8f96" />
      </mesh>
      {!dim && (
        <Html position={[0, -h / 2 - 0.02, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }} distanceFactor={8}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#2c2f33', fontFamily: 'system-ui, sans-serif' }}>SINCLAIR</div>
        </Html>
      )}
      {/* round supply diffuser beside the unit */}
      <mesh position={[w / 2 + 0.35, h / 2 - 0.02, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.16, 0.16, 0.05, 20]} />
        <meshStandardMaterial key={dim ? 'dim' : 'lit'} color="#f0f0ee" roughness={0.6} transparent={dim} opacity={op} />
      </mesh>
      {dev && !dim && (
        <mesh position={[w / 2 - 0.05, -h / 2 + 0.03, d / 2 + 0.002]}>
          <sphereGeometry args={[0.015, 10, 10]} />
          <meshStandardMaterial color={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissive={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      )}
      {running && !dim && <FlowLine points={[[w / 2 + 0.35, h / 2 - 0.05, 0], [w / 2 + 0.35, -1.6, 0]]} count={16} speed={0.8} color="#dfe8ff" size={0.06} spread={0.5} />}
    </group>
  );
}

function GenericUnit({ eq, dev, active, dim, planned, handlers, def }: { eq: EquipmentEntity; dev?: LabDevice; active: boolean; dim: boolean; planned: boolean; handlers: Handlers; def: ReturnType<typeof getEquipmentById> }) {
  const [w, d] = eq.dimensions;
  const z = Number(eq.meta?.z ?? 0), h = Number(eq.meta?.h ?? 0.8);
  let color = '#c9ced6';
  if (def?.category === 'irrigation') color = '#5fa8f0';
  else if (def?.category === 'co2') color = '#c9a0ff';
  else if (def?.category === 'processing') color = '#f0b46a';
  else if (def?.category === 'hvac' || def?.category === 'ventilation') color = '#c9d4e6';
  if (dev?.status === 'offline') color = '#8a8a8a';
  return (
    <group position={P(eq.center[0], eq.center[1], z + h / 2)} rotation={[0, (eq.rotation * Math.PI) / 180, 0]}>
      <RoundedBox args={[Math.max(w, 0.05), Math.max(h, 0.02), Math.max(d, 0.05)]} radius={Math.min(0.03, w / 6, h / 6)} smoothness={3} castShadow receiveShadow {...handlers}>
        <meshPhysicalMaterial key={dim ? 'dim' : 'lit'} color={active ? '#8fc4ff' : color} roughness={0.35} metalness={0.35} clearcoat={0.4} transparent={planned || dim} opacity={dim ? DIM_OPACITY : planned ? 0.7 : 1} />
      </RoundedBox>
      {dev && !dim && (
        <mesh position={[w / 2 - 0.05, h / 2 - 0.03, d / 2 + 0.005]}>
          <sphereGeometry args={[0.018, 12, 12]} />
          <meshStandardMaterial color={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissive={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

// ─── Equipment dispatcher ─────────────────────────────────────────────────────

function Equipment({ items, H, selectedId, hovered, onSelect, onHover, devices, roomLights, roomLiveMap, showLabels, isLight, focusIds, rooms }: {
  items: EquipmentEntity[]; H: Record<string, number>; selectedId: string | null; hovered: string | null;
  onSelect(id: string): void; onHover?(id: string | null): void; devices: Record<string, LabDevice>;
  roomLights: Map<string, boolean | undefined>; roomLiveMap: Map<string, RoomLive | undefined>; showLabels: boolean; isLight: boolean; focusIds?: Set<string> | null;
  rooms: Record<string, RoomEntity>;
}) {
  const fixtures = items.filter(eq => eq.equipmentId === 'led_fixture_8bar');
  const fixturesPlanned = fixtures.filter(f => f.layer.startsWith('expansion-'));
  const fixturesExisting = fixtures.filter(f => !f.layer.startsWith('expansion-'));
  const rest = items.filter(eq => eq.equipmentId !== 'led_fixture_8bar');
  return (
    <group>
      <LedFixtures items={fixturesExisting} H={H} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={onHover} on={roomLights} dimSet={focusIds} beams planned={false} />
      {fixturesPlanned.length > 0 && <LedFixtures items={fixturesPlanned} H={H} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={onHover} on={roomLights} dimSet={focusIds} beams={false} planned />}
      {rest.map(eq => {
        const dev = findBound(devices, eq.binding);
        const active = selectedId === eq.id || hovered === eq.id;
        const dim = !!focusIds && !focusIds.has(eq.id);
        const live = eq.roomId ? roomLiveMap.get(eq.roomId) : undefined;
        const def = getEquipmentById(eq.equipmentId);
        const handlers = mkHandlers(eq.id, onSelect, onHover);
        const planned = eq.layer.startsWith('expansion-');
        const label = dev?.name ?? eq.binding?.name;
        const room = eq.roomId ? rooms[eq.roomId] : undefined;
        const fit = room?.meta?.fitout as { trellis_rail_m?: number } | undefined;
        let body: React.ReactNode;
        if (eq.equipmentId === 'grow_bench' || eq.meta?.kind === 'bench') {
          body = <Bench eq={eq} H={H} active={active} planned={planned} dim={dim} lightsOn={eq.roomId ? roomLights.get(eq.roomId) : undefined} irrigationOn={!!live?.irrigationOn} handlers={handlers} trellisRail={fit?.trellis_rail_m} />;
        } else if (eq.equipmentId === 'dehu_130ppd' || def?.category === 'dehumidifier') {
          body = <Dehumidifier eq={eq} dev={dev} active={active} dim={dim} running={!!live && live.dehuOn > 0 && (dev ? dev.status !== 'offline' : true)} handlers={handlers} />;
        } else if (eq.equipmentId === 'hvac_unit_external' || eq.layer.includes('hvac')) {
          const acOn = !!live?.devices.some(d => /ac|clima|sinclair|hvac/i.test(d.name) && d.state);
          body = <HvacUnit eq={eq} dev={dev} active={active} dim={dim} running={acOn} handlers={handlers} />;
        } else if (eq.equipmentId === 'grow_table_1200x1100') {
          body = <Bench eq={eq} H={H} active={active} planned={planned} dim={dim} lightsOn={eq.roomId ? roomLights.get(eq.roomId) : undefined} irrigationOn={!!live?.irrigationOn} handlers={handlers} />;
        } else {
          body = <GenericUnit eq={eq} dev={dev} active={active} dim={dim} planned={planned} handlers={handlers} def={def} />;
        }
        const z = Number(eq.meta?.z ?? 0), h = Number(eq.meta?.h ?? 0.8);
        return (
          <group key={eq.id}>
            {eq.equipmentId === 'grow_bench' || eq.equipmentId === 'grow_table_1200x1100'
              ? <group position={P(eq.center[0], eq.center[1], 0)} rotation={[0, (eq.rotation * Math.PI) / 180, 0]}>{body}</group>
              : body}
            {showLabels && !dim && (label || active) && (
              <Html position={P(eq.center[0], eq.center[1], z + h + 0.15)} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 10, fontWeight: 600, fontFamily: 'system-ui, sans-serif', padding: '1px 5px', borderRadius: 4,
                  background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)', color: isLight ? '#111' : '#fff', border: dev ? `1px solid ${dev.status === 'offline' ? '#ef4444' : '#22c55e'}` : 'none' }}>
                  {label ?? def?.name ?? eq.equipmentId}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ─── Real area lights for the active room (max 3 benches) ────────────────────

// RectAreaLight needs its uniform LUTs once per page (module side effect, not React state)
const ensureRectAreaLib = (() => { let done = false; return () => { if (!done) { RectAreaLightUniformsLib.init(); done = true; } }; })();
function RoomLights({ benches, H, on }: { benches: EquipmentEntity[]; H: Record<string, number>; on: boolean }) {
  useEffect(() => { ensureRectAreaLib(); }, []);
  if (!on) return null;
  return (
    <group>
      {benches.slice(0, 3).map(b => {
        const [w, L] = b.dimensions;
        const pos = P(b.center[0], b.center[1], H.light - 0.02);
        return (
          <rectAreaLight key={b.id} position={pos} rotation={[-Math.PI / 2, 0, 0]} width={w} height={L} intensity={5.5} color="#ffe9d6" />
        );
      })}
    </group>
  );
}

// ─── Cutaway + ceiling + keyboard driver (runs every frame) ──────────────────

function setVisible(o: THREE.Object3D, v: boolean) { o.visible = v; }
function applyFade(e: FadeEntry, t: number, dt: number) {
  e.target = t;
  for (const m of e.mats) {
    const cur = m.opacity;
    const next = cur + (t - cur) * Math.min(1, dt * 9);
    if (Math.abs(next - cur) > 1e-4) m.opacity = next;
    m.visible = next > 0.035;
    m.depthWrite = next > 0.5;
  }
}

function FrameDriver({ registry, walls, rooms, ceilings, controls, mode, selectedRoomId, onActiveRoom, activeTool, onDegrade }: {
  registry: FadeRegistry; walls: WallSeg[]; rooms: RoomShape[]; ceilings: React.MutableRefObject<THREE.Group | null>;
  controls: React.MutableRefObject<OrbitControlsImpl | null>; mode: CutawayMode; selectedRoomId: string | null;
  onActiveRoom?(id: string | null): void; activeTool?: EditorTool; onDegrade?(): void;
}) {
  const { camera, scene } = useThree();
  useEffect(() => { if (import.meta.env.DEV) (window as any).__scene3d = scene; }, [scene]);
  const lastRoom = useRef<string | null>(null);
  const keys = useRef(new Set<string>());
  const frameAcc = useRef({ t: 0, n: 0, slow: 0 });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        // drawing tool shortcuts (W/D/E) only apply in 2D; in 3D they move the camera
        keys.current.add(e.key.toLowerCase());
        if (e.key.startsWith('Arrow')) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  useFrame((state, dt) => {
    const ctl = controls.current;
    // keyboard move: camera + target together
    if (ctl && keys.current.size) {
      const dist = camera.position.distanceTo(ctl.target);
      const v = Math.max(1.5, dist * 0.6) * Math.min(dt, 0.05);
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const mv = new THREE.Vector3();
      const k = keys.current;
      if (k.has('w') || k.has('arrowup')) mv.add(fwd);
      if (k.has('s') || k.has('arrowdown')) mv.sub(fwd);
      if (k.has('d') || k.has('arrowright')) mv.add(right);
      if (k.has('a') || k.has('arrowleft')) mv.sub(right);
      if (k.has('e')) mv.y += 1;
      if (k.has('q')) mv.y -= 1;
      if (mv.lengthSq() > 0) { mv.normalize().multiplyScalar(v); camera.position.add(mv); ctl.target.add(mv); }
    }
    // active room from the orbit target (or the selection)
    const target = ctl ? ctl.target : new THREE.Vector3();
    const tPlan: Point2D = [target.x, -target.z];
    const active = selectedRoomId ?? activeRoomAt(tPlan, rooms, lastRoom.current);
    if (active !== lastRoom.current) { lastRoom.current = active; onActiveRoom?.(active); }
    // ceilings: hide when the camera is above them or looks steeply down
    if (ceilings.current) {
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      const steep = dir.y < -0.55;
      setVisible(ceilings.current, mode !== 'cut' && camera.position.y < 3.2 && !steep);
    }
    // cutaway targets
    const cam: Point2D = [camera.position.x, -camera.position.z];
    const room = active ? rooms.find(r => r.id === active) : undefined;
    const occ = mode === 'auto' && room ? occludingWalls(cam, room, walls) : null;
    for (const [id, e] of registry) {
      let t = e.base;
      if (occ) {
        const wallId = id.split('#')[0];
        const o = occ.get(id) ?? occ.get(wallId);
        if (o === 'own') t = Math.min(t, 0.06);
        else if (o === 'between') t = Math.min(t, 0.15);
      }
      applyFade(e, t, dt);
    }
    // frame-time watchdog
    const fa = frameAcc.current;
    fa.t += dt; fa.n += 1;
    if (fa.n >= 60) {
      const avg = fa.t / fa.n;
      fa.slow = avg > 0.04 ? fa.slow + 1 : 0;
      fa.t = 0; fa.n = 0;
      if (fa.slow >= 3) { fa.slow = 0; onDegrade?.(); }
    }
    void state; void activeTool;
  });
  return null;
}

// ─── Camera rig ───────────────────────────────────────────────────────────────

type RigApi = { preset: (p: CameraPreset) => void; zoomTo: (b: { min: Point2D; max: Point2D; h: number }, room?: { centroid: Point2D; door?: Point2D }) => void; snapshot: () => string | null };

function CameraRig({ register, center, size, autoOrbit, activeTool, controlsRef, cameraKey }: {
  register: (api: RigApi) => void; center: Point2D; size: number; autoOrbit: boolean; activeTool?: EditorTool; controlsRef: React.MutableRefObject<OrbitControlsImpl | null>; cameraKey?: string;
}) {
  const { camera, gl } = useThree();
  const initialised = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const fly = useCallback((pos: [number, number, number], target: [number, number, number]) => {
    camera.position.set(...pos);
    if (controlsRef.current) { controlsRef.current.target.set(...target); controlsRef.current.update(); }
    camera.lookAt(...target);
  }, [camera, controlsRef]);

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
      zoomTo: (b, room) => {
        const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
        const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
        if (room) {
          // room view: front-elevated from the door side, like the site photos
          const c = room.centroid;
          let dir: Point2D = [0, -1];
          if (room.door) { const dx = room.door[0] - c[0], dy = room.door[1] - c[1]; const n = Math.hypot(dx, dy) || 1; dir = [dx / n, dy / n]; }
          else if (d > w) dir = [0, -1]; else dir = [-1, 0];
          // stand just outside the door at eye height, slightly elevated, looking down the benches (site-photo framing)
          const dist = Math.max(w, d) * 0.55 + 1.2;
          fly(P(c[0] + dir[0] * dist, c[1] + dir[1] * dist, 1.9 + dist * 0.1), P(c[0], c[1], 1.1));
          return;
        }
        const s = Math.max(w, d, 2);
        fly(P(cx - s * 0.9, cy - s * 1.1, Math.max(b.h, 2) + s * 0.7), P(cx, cy, b.h / 2));
      },
      snapshot: () => { try { return gl.domElement.toDataURL('image/png'); } catch { return null; } },
    };
    register(api);
    if (!initialised.current) {
      initialised.current = true;
      let restored = false;
      if (cameraKey) {
        try {
          const saved = JSON.parse(localStorage.getItem(`elevia-3d-cam:${cameraKey}`) ?? 'null');
          if (saved && Array.isArray(saved.p) && Array.isArray(saved.t)) { fly(saved.p, saved.t); restored = true; }
        } catch { /* ignore */ }
      }
      if (!restored) api.preset('iso');
    }
  }, [register, center, size, fly, gl, cameraKey]);

  // persist camera (throttled)
  const onChange = useCallback(() => {
    if (!cameraKey) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const t = controlsRef.current?.target;
      if (!t) return;
      localStorage.setItem(`elevia-3d-cam:${cameraKey}`, JSON.stringify({ p: camera.position.toArray(), t: t.toArray() }));
    }, 400);
  }, [cameraKey, camera, controlsRef]);

  const pan = activeTool === 'pan';
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={0.6} maxDistance={size * 4}
      autoRotate={autoOrbit} autoRotateSpeed={0.6}
      screenSpacePanning
      zoomToCursor
      mouseButtons={{ LEFT: pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      touches={{ ONE: pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      onChange={onChange}
    />
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export const FacilityScene = forwardRef<FacilitySceneHandle, FacilitySceneProps>(function FacilityScene(props, ref) {
  const { entities, layerVisible, scope, selectedId, onSelect, onHover, showLabels, isLight, heights, devices, labRooms, clock, control = {}, focusIds = null,
    autoOrbit = false, activeTool = 'select', cutaway = 'auto', quality = 'balanced', cameraKey, onActiveRoom, onDegrade } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const api = useRef<RigApi | null>(null);
  const register = useCallback((a: RigApi) => { api.current = a; }, []);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const ceilingsRef = useRef<THREE.Group | null>(null);
  const registry = useMemo<FadeRegistry>(() => new Map(), []);
  const H = useMemo(() => ({ ...DEFAULT_H, ...heights }), [heights]);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);

  const visible = useMemo(() => Object.values(entities).filter(e => e.visible && (layerVisible.get(e.layer) ?? true) && (!scope || scope.has(e.id))), [entities, layerVisible, scope]);
  const rooms = useMemo(() => visible.filter(e => e.type === 'room') as RoomEntity[], [visible]);
  const roomsById = useMemo(() => Object.fromEntries(rooms.map(r => [r.id, r])) as Record<string, RoomEntity>, [rooms]);
  const walls = useMemo(() => visible.filter(e => e.type === 'wall') as WallEntity[], [visible]);
  const doors = useMemo(() => visible.filter(e => e.type === 'door') as DoorEntity[], [visible]);
  const equipment = useMemo(() => visible.filter(e => e.type === 'equipment') as EquipmentEntity[], [visible]);

  // cutaway inputs
  const wallSegs = useMemo<WallSeg[]>(() => walls.filter(w => w.meta?.kind !== 'duct' && w.meta?.kind !== 'cable').flatMap(w =>
    w.points.slice(1).map((b, i) => ({ id: `${w.id}#${i}`, a: w.points[i], b, rooms: Array.isArray(w.meta?.between) ? (w.meta!.between as string[]) : [], exterior: w.meta?.kind === 'exterior' }))), [walls]);
  const roomShapes = useMemo<RoomShape[]>(() => rooms.filter(r => r.roomTypeId !== 'utility' || !/corridor|hall/i.test(r.name)).map(r => ({ id: r.id, code: roomCodeOf(r), polygon: r.polygon })), [rooms]);
  const selectedRoomId = useMemo(() => {
    const sel = selectedId ? entities[selectedId] : undefined;
    if (!sel) return null;
    if (sel.type === 'room') return sel.id;
    if (sel.type === 'equipment') return (sel as EquipmentEntity).roomId ?? null;
    return null;
  }, [selectedId, entities]);

  // live state per room
  const roomLiveMap = useMemo(() => {
    const m = new Map<string, RoomLive | undefined>();
    for (const r of Object.values(entities)) {
      if (r.type !== 'room') continue;
      m.set(r.id, roomLive(labRooms.find(x => x.id === (r as RoomEntity).labRoomId), control));
    }
    return m;
  }, [entities, labRooms, control]);
  const roomLights = useMemo(() => {
    const m = new Map<string, boolean | undefined>();
    for (const r of Object.values(entities)) {
      if (r.type !== 'room') continue;
      const lab = labRooms.find(x => x.id === (r as RoomEntity).labRoomId);
      m.set(r.id, roomLiveMap.get(r.id)?.lightsOn ?? lightsOnNow(lab));
    }
    return m;
  }, [entities, labRooms, roomLiveMap, clock]); // eslint-disable-line react-hooks/exhaustive-deps
  const ducts = useMemo(() => walls.filter(w => w.meta?.kind === 'duct' && (!focusIds || focusIds.has(w.id))), [walls, focusIds]);

  const { center, size } = useMemo(() => {
    const all = Object.values(entities).filter(e => e.type === 'room' || e.type === 'wall');
    const min: Point2D = [Infinity, Infinity], max: Point2D = [-Infinity, -Infinity];
    for (const e of all) { const b = bboxOfEntity(e); if (!b) continue; min[0] = Math.min(min[0], b.min[0]); min[1] = Math.min(min[1], b.min[1]); max[0] = Math.max(max[0], b.max[0]); max[1] = Math.max(max[1], b.max[1]); }
    if (!isFinite(min[0])) return { center: [0, 0] as Point2D, size: 20 };
    return { center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] as Point2D, size: Math.max(max[0] - min[0], max[1] - min[1], 5) };
  }, [entities]);

  useImperativeHandle(ref, () => ({
    setPreset: (p) => api.current?.preset(p),
    zoomTo: (id) => {
      const e = entities[id];
      const b = e && bboxOfEntity(e);
      if (!b) return;
      if (e.type === 'room') {
        const r = e as RoomEntity;
        const code = roomCodeOf(r);
        const door = Object.values(entities).find(d => d.type === 'door' && (d.meta?.to === code || d.meta?.from === code)) as DoorEntity | undefined;
        const seg = door ? doorSegment(door, entities[door.wallOwner]) : null;
        api.current?.zoomTo(b, { centroid: polygonCentroid(r.polygon), door: seg ? [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2] : undefined });
      } else api.current?.zoomTo(b);
    },
    snapshot: () => api.current?.snapshot() ?? null,
  }), [entities]);

  const hover = useCallback((id: string | null) => { setHovered(id); onHover?.(id); }, [onHover]);
  const activeRoomCb = useCallback((id: string | null) => { setActiveRoom(id); onActiveRoom?.(id); }, [onActiveRoom]);

  const clipPlanes = useMemo(() => cutaway === 'cut' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2)] : null, [cutaway]);
  const dpr: [number, number] = quality === 'high' ? [1, 2] : quality === 'balanced' ? [1, 1.5] : [1, 1];
  const activeBenches = useMemo(() => equipment.filter(e => e.equipmentId === 'grow_bench' && e.roomId === activeRoom), [equipment, activeRoom]);
  const activeLightsOn = activeRoom ? (roomLights.get(activeRoom) ?? true) : false;

  return (
    <R3FCanvas
      shadows
      dpr={dpr}
      gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: isLight ? 1.0 : 1.05, localClippingEnabled: true }}
      camera={{ fov: 40, near: 0.05, far: 500, position: P(center[0] - size, center[1] - size, size) }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: isLight ? 'radial-gradient(ellipse at 50% 40%, #f4f6f9 0%, #dfe3ea 100%)' : 'radial-gradient(ellipse at 50% 35%, #182033 0%, #070a12 100%)', cursor: activeTool === 'pan' ? 'grab' : hovered ? 'pointer' : 'default' }}
    >
      <fog attach="fog" args={[isLight ? '#dfe3ea' : '#070a12', size * 1.6, size * 5]} />
      <hemisphereLight args={['#ffffff', isLight ? '#cfd3da' : '#1a1e26', 0.5]} />
      <directionalLight position={P(center[0] - size * 0.8, center[1] - size * 0.5, size * 1.1)} intensity={isLight ? 1.4 : 1.0} color="#fdfbf7" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={4}
        shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size} shadow-camera-far={size * 4} />
      <directionalLight position={P(center[0] + size, center[1] + size * 0.8, size * 0.6)} intensity={0.35} color="#dfe8ff" />
      <ambientLight intensity={0.22} />
      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={isLight ? 0.45 : 0.4} />
      </Suspense>

      {/* studio floor outside the building */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P(center[0], center[1], -0.01)} receiveShadow onClick={() => onSelect(null)}>
        <planeGeometry args={[size * 5, size * 5]} />
        <MeshReflectorMaterial color={isLight ? '#d5d9e0' : '#111521'} roughness={0.85} metalness={0.2}
          blur={[400, 120]} mixBlur={1} mixStrength={isLight ? 0.6 : 1.4} mirror={0.3} resolution={quality === 'high' ? 1024 : 512} depthScale={0.6} minDepthThreshold={0.85} maxDepthThreshold={1.2} />
      </mesh>
      <Grid position={P(center[0], center[1], 0.0)} args={[size * 4, size * 4]} cellSize={1} sectionSize={5} cellThickness={0.6} sectionThickness={1}
        cellColor={isLight ? '#b9bfc9' : '#232a3a'} sectionColor={isLight ? '#98a0ad' : '#33405a'} fadeDistance={size * 2.6} fadeStrength={1.5} infiniteGrid={false} />

      <Suspense fallback={null}>
        <Rooms rooms={rooms} selectedId={selectedId} onSelect={onSelect} onHover={hover} showLabels={showLabels} isLight={isLight} hovered={hovered} focusIds={focusIds} ceilings={ceilingsRef} />
        <Walls walls={walls} doors={doors} entities={entities} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={hover} isLight={isLight} focusIds={focusIds}
          registry={registry} mode={cutaway} clip={clipPlanes} />
        <Equipment items={equipment} H={H} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={hover} devices={devices} roomLights={roomLights} roomLiveMap={roomLiveMap}
          showLabels={showLabels} isLight={isLight} focusIds={focusIds} rooms={roomsById} />
        <RoomLights benches={activeBenches} H={H} on={activeLightsOn && quality !== 'fast'} />
        {ducts.map(w => {
          const z = Number(w.meta?.z ?? 0) + w.height / 2;
          const pts = w.points.map(p => P(p[0], p[1], z));
          const kind = String(w.meta?.route_kind ?? 'supply');
          return <FlowLine key={w.id} points={pts} count={Math.max(8, Math.round(Number(w.meta?.length ?? 5) * 2))} speed={1.4} reverse={kind !== 'supply'}
            color={kind === 'supply' ? '#9cc4ff' : '#ffb27a'} size={Math.max(0.05, w.thickness * 0.35)} spread={w.thickness * 0.4} />;
        })}
        <ContactShadows position={P(center[0], center[1], 0.001)} opacity={isLight ? 0.3 : 0.45} scale={size * 2.5} blur={2.2} far={4} resolution={1024} frames={1} />
      </Suspense>

      {quality !== 'fast' && (
        <EffectComposer multisampling={4}>
          <N8AO aoRadius={0.6} intensity={2.2} distanceFalloff={0.8} halfRes={quality !== 'high'} />
          <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={isLight ? 0.25 : 0.4} mipmapBlur />
          <Vignette eskil={false} offset={0.25} darkness={isLight ? 0.3 : 0.6} />
        </EffectComposer>
      )}

      <FrameDriver registry={registry} walls={wallSegs} rooms={roomShapes} ceilings={ceilingsRef} controls={controlsRef} mode={cutaway} selectedRoomId={selectedRoomId}
        onActiveRoom={activeRoomCb} activeTool={activeTool} onDegrade={onDegrade} />
      <CameraRig register={register} center={center} size={size} autoOrbit={autoOrbit} activeTool={activeTool} controlsRef={controlsRef} cameraKey={cameraKey} />
    </R3FCanvas>
  );
});

