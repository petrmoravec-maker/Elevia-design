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
import { OrbitControls, Html, Grid, ContactShadows, Environment, MeshReflectorMaterial, RoundedBox, Instances, Instance } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
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

/** Room-type colour blended into a dark (or light) epoxy floor tone. */
function floorTint(hex: string, isLight: boolean): string {
  const c = new THREE.Color(hex);
  const base = new THREE.Color(isLight ? '#d8dbe0' : '#1a1f2b');
  return '#' + base.lerp(c, isLight ? 0.25 : 0.22).getHexString();
}

// ─── Scene contents ───────────────────────────────────────────────────────────

function Rooms({ rooms, selectedId, onSelect, onHover, showLabels, isLight, hovered }: {
  rooms: RoomEntity[]; selectedId: string | null; onSelect(id: string): void; onHover?(id: string | null): void; showLabels: boolean; isLight: boolean; hovered: string | null;
}) {
  return (
    <group>
      {rooms.map(r => {
        // rotation -90deg about X maps shape (x, y) -> three (x, 0, -y), matching P()
        const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
        const c = polygonCentroid(r.polygon);
        const active = selectedId === r.id || hovered === r.id;
        const code = typeof r.meta?.code === 'string' ? (r.meta!.code as string) : r.name.split(' ')[0];
        return (
          <group key={r.id}>
            {/* epoxy floor slab tinted by room type; planned rooms red */}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.03, 0]}
              onClick={e => { e.stopPropagation(); onSelect(r.id); }}
              onPointerOver={e => { e.stopPropagation(); onHover?.(r.id); }}
              onPointerOut={() => onHover?.(null)}
              receiveShadow
            >
              <extrudeGeometry args={[shape, { depth: 0.03, bevelEnabled: false }]} />
              <meshPhysicalMaterial
                color={r.layer.startsWith('expansion-') ? '#7a2020' : floorTint(roomColor(r), isLight)}
                emissive={active ? '#3B9EFF' : '#000000'} emissiveIntensity={active ? 0.25 : 0}
                roughness={0.35} metalness={0.05} clearcoat={0.6} clearcoatRoughness={0.3}
                transparent={r.layer.startsWith('expansion-')} opacity={r.layer.startsWith('expansion-') ? 0.7 : 1} />
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
  const wallMat = useMemo(() => ({ ext: isLight ? '#9aa0a8' : '#4b5261', int: isLight ? '#e2e5ea' : '#7d8593', sel: '#3B9EFF' }), [isLight]);
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
                  <meshStandardMaterial color={active ? '#3B9EFF' : routeColor} roughness={0.35} metalness={0.65}
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
              <meshPhysicalMaterial color={active ? wallMat.sel : w.layer.startsWith('expansion-') ? '#e06060' : kind === 'exterior' ? wallMat.ext : wallMat.int}
                roughness={0.7} metalness={0.05} clearcoat={0.15}
                transparent opacity={w.layer.startsWith('expansion-') ? 0.6 : kind === 'exterior' ? 0.92 : 0.85} depthWrite />
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

  let color = '#9aa3b2', emissive = '#000000', ei = 0, opacity = 1;
  if (isTable) color = '#e6e8ec';
  else if (isLightRow) {
    const on = roomLightsOn ?? true;
    color = on ? '#fff4c2' : '#7a7a7a';
    emissive = on ? '#ffd54a' : '#000000';
    ei = on ? (roomLightsOn === undefined ? 0.6 : 1.4) : 0;
  } else if (isHvac) color = '#c9d4e6';
  else if (isDehu) color = '#dfe3e8';
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
        const def = getEquipmentById(eq.equipmentId);
        const isTable = eq.layer.includes('table') || eq.equipmentId.startsWith('grow_table');
        const isLightRow = eq.layer.includes('light') || def?.category === 'lighting';
        const handlers = {
          onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onSelect(eq.id); },
          onPointerOver: (e: { stopPropagation(): void }) => { e.stopPropagation(); onHover?.(eq.id); },
          onPointerOut: () => onHover?.(null),
        };
        const planned = eq.layer.startsWith('expansion-');
        return (
          <group key={eq.id} position={P(eq.center[0], eq.center[1], v.z + v.h / 2)} rotation={[0, (eq.rotation * Math.PI) / 180, 0]}>
            {isTable ? (
              <GrowTable w={w} d={d} h={v.h} active={active} planned={planned} handlers={handlers} lightsOn={eq.roomId ? roomLights.get(eq.roomId) : undefined} />
            ) : isLightRow ? (
              <LedFixture w={w} d={d} h={v.h} on={v.emissiveIntensity > 0 && !(dev && dev.status === 'offline')} dim={eq.roomId ? roomLights.get(eq.roomId) === undefined : true}
                active={active} planned={planned} ceiling={H.duct_top + 0.05 - v.z - v.h / 2} tableTop={H.table_top - v.z - v.h / 2} handlers={handlers} />
            ) : (
              <RoundedBox args={[Math.max(w, 0.05), Math.max(v.h, 0.02), Math.max(d, 0.05)]} radius={Math.min(0.03, w / 6, v.h / 6)} smoothness={3} castShadow receiveShadow {...handlers}>
                <meshPhysicalMaterial color={v.color} emissive={v.emissive} emissiveIntensity={v.emissiveIntensity} transparent={v.opacity < 1 || planned} opacity={planned ? 0.7 : v.opacity}
                  roughness={0.35} metalness={0.35} clearcoat={0.4} />
              </RoundedBox>
            )}
            {dev && !isTable && (
              <mesh position={[w / 2 - 0.05, v.h / 2 - 0.03, d / 2 + 0.005]}>
                <sphereGeometry args={[0.018, 12, 12]} />
                <meshStandardMaterial color={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissive={dev.status === 'offline' ? '#ff4d4d' : '#22ff88'} emissiveIntensity={2.5} toneMapped={false} />
              </mesh>
            )}
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

// ─── Props ────────────────────────────────────────────────────────────────────

type Handlers = { onClick: (e: { stopPropagation(): void }) => void; onPointerOver: (e: { stopPropagation(): void }) => void; onPointerOut: () => void };

/** Bench: steel frame, white tray, pots with canopy (instanced). Group origin = centre of the table volume. */
function GrowTable({ w, d, h, active, planned, handlers, lightsOn }: { w: number; d: number; h: number; active: boolean; planned: boolean; handlers: Handlers; lightsOn: boolean | undefined }) {
  const top = h / 2;             // tray surface (local y)
  const legIn = 0.08;
  const plants = useMemo(() => {
    const cols = Math.max(1, Math.round(w / 0.36)), rows = Math.max(1, Math.round(d / 0.36));
    const out: [number, number, number][] = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -w / 2 + (i + 0.5) * (w / cols), z = -d / 2 + (j + 0.5) * (d / rows);
      // deterministic size variation
      const s = 0.85 + 0.3 * (((i * 7 + j * 13) % 10) / 10);
      out.push([x, z, s]);
    }
    return out;
  }, [w, d]);
  const leaf = planned ? '#b04040' : lightsOn === false ? '#2f5d34' : '#3f9a48';
  return (
    <group>
      {/* tray */}
      <RoundedBox args={[w, 0.06, d]} radius={0.015} smoothness={2} position={[0, top - 0.03, 0]} castShadow receiveShadow {...handlers}>
        <meshPhysicalMaterial color={active ? '#8fc4ff' : planned ? '#d88' : '#e6e8ec'} roughness={0.3} metalness={0.15} clearcoat={0.5} transparent={planned} opacity={planned ? 0.7 : 1} />
      </RoundedBox>
      {/* rim */}
      <mesh position={[0, top - 0.01, 0]}>
        <boxGeometry args={[w + 0.02, 0.02, d + 0.02]} />
        <meshStandardMaterial color="#c9ccd2" roughness={0.4} metalness={0.5} />
      </mesh>
      {/* legs */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (w / 2 - legIn), -0.03, sz * (d / 2 - legIn)]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, h - 0.06, 10]} />
          <meshStandardMaterial color="#8a8f99" roughness={0.35} metalness={0.8} />
        </mesh>
      ))}
      {/* pots + canopy */}
      <Instances range={plants.length} castShadow>
        <cylinderGeometry args={[0.075, 0.06, 0.13, 12]} />
        <meshStandardMaterial color="#2b2b2f" roughness={0.8} />
        {plants.map(([x, z], i) => <Instance key={i} position={[x, top + 0.065, z]} />)}
      </Instances>
      <Instances range={plants.length} castShadow>
        <icosahedronGeometry args={[0.16, 1]} />
        <meshStandardMaterial color={leaf} roughness={0.85} flatShading />
        {plants.map(([x, z, sc], i) => <Instance key={i} position={[x, top + 0.13 + 0.12 * sc, z]} scale={[sc, sc * 0.8, sc]} />)}
      </Instances>
    </group>
  );
}

/** LED bar with hangers to the ceiling and a soft light cone down to the canopy when on. */
function LedFixture({ w, d, h, on, dim, active, planned, ceiling, tableTop, handlers }: {
  w: number; d: number; h: number; on: boolean; dim: boolean; active: boolean; planned: boolean; ceiling: number; tableTop: number; handlers: Handlers;
}) {
  const coneH = Math.max(0.3, -tableTop - 0.05);   // from fixture underside down to just above the table
  return (
    <group>
      <RoundedBox args={[w, h, Math.max(d, 0.1)]} radius={0.02} smoothness={2} castShadow {...handlers}>
        <meshPhysicalMaterial color={active ? '#8fc4ff' : planned ? '#d88' : '#f2f3f5'} roughness={0.25} metalness={0.4} clearcoat={0.6} transparent={planned} opacity={planned ? 0.7 : 1} />
      </RoundedBox>
      {/* emitting face */}
      <mesh position={[0, -h / 2 - 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 0.96, Math.max(d, 0.1) * 0.8]} />
        <meshStandardMaterial color={on ? '#fff6d5' : '#555'} emissive={on ? '#ffe9a8' : '#000'} emissiveIntensity={on ? (dim ? 1.2 : 2.4) : 0} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* hangers */}
      {[-1, 1].map(sx => (
        <mesh key={sx} position={[sx * (w / 2 - 0.15), (ceiling + h / 2) / 2, 0]}>
          <cylinderGeometry args={[0.006, 0.006, Math.max(0.05, ceiling - h / 2), 6]} />
          <meshStandardMaterial color="#9aa0a8" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* light cone */}
      {on && (
        <mesh position={[0, -h / 2 - coneH / 2, 0]} raycast={() => null}>
          <cylinderGeometry args={[w / 2 + 0.25, w / 2 * 0.55, coneH, 24, 1, true]} />
          <meshBasicMaterial color="#ffe6a3" transparent opacity={dim ? 0.035 : 0.07} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
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
      dpr={[1, 1.75]}
      gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: isLight ? 1.0 : 1.15 }}
      camera={{ fov: 42, near: 0.1, far: 500, position: P(center[0] - size, center[1] - size, size) }}
      onPointerMissed={() => onSelect(null)}
      style={{ background: isLight ? 'radial-gradient(ellipse at 50% 40%, #f4f6f9 0%, #dfe3ea 100%)' : 'radial-gradient(ellipse at 50% 35%, #182033 0%, #070a12 100%)', cursor: hovered ? 'pointer' : 'default' }}
    >
      <fog attach="fog" args={[isLight ? '#dfe3ea' : '#070a12', size * 1.6, size * 5]} />
      <hemisphereLight args={[isLight ? '#ffffff' : '#b9c6ff', isLight ? '#cfd3da' : '#101318', isLight ? 0.6 : 0.45]} />
      <directionalLight position={P(center[0] - size * 0.8, center[1] - size * 0.5, size * 1.1)} intensity={isLight ? 1.6 : 1.1} color={isLight ? '#fff7ea' : '#dfe6ff'} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-size} shadow-camera-right={size} shadow-camera-top={size} shadow-camera-bottom={-size} shadow-camera-far={size * 4} />
      <directionalLight position={P(center[0] + size, center[1] + size * 0.8, size * 0.6)} intensity={isLight ? 0.5 : 0.35} color="#9fb6ff" />
      <ambientLight intensity={isLight ? 0.25 : 0.15} />
      <Suspense fallback={null}>
        <Environment preset={isLight ? 'city' : 'warehouse'} environmentIntensity={isLight ? 0.35 : 0.3} />
      </Suspense>

      {/* studio floor: subtle reflection + grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P(center[0], center[1], -0.01)} receiveShadow onClick={() => onSelect(null)}>
        <planeGeometry args={[size * 5, size * 5]} />
        <MeshReflectorMaterial
          color={isLight ? '#d5d9e0' : '#111521'} roughness={0.85} metalness={0.2}
          blur={[400, 120]} mixBlur={1} mixStrength={isLight ? 0.6 : 1.6} mirror={0.35} resolution={1024} depthScale={0.6} minDepthThreshold={0.85} maxDepthThreshold={1.2} />
      </mesh>
      <Grid position={P(center[0], center[1], 0.0)} args={[size * 4, size * 4]} cellSize={1} sectionSize={5} cellThickness={0.6} sectionThickness={1}
        cellColor={isLight ? '#b9bfc9' : '#232a3a'} sectionColor={isLight ? '#98a0ad' : '#33405a'} fadeDistance={size * 2.6} fadeStrength={1.5} infiniteGrid={false} />

      <Suspense fallback={null}>
        <Rooms rooms={rooms} selectedId={selectedId} onSelect={onSelect} onHover={hover} showLabels={showLabels} isLight={isLight} hovered={hovered} />
        <Walls walls={walls} doors={doors} entities={entities} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={hover} isLight={isLight} />
        <Equipment items={equipment} H={H} selectedId={selectedId} hovered={hovered} onSelect={onSelect} onHover={hover} devices={devices} roomLights={roomLights} showLabels={showLabels} isLight={isLight} />
        <DuctZone rooms={rooms} H={H} isLight={isLight} />
        <ContactShadows position={P(center[0], center[1], 0.001)} opacity={isLight ? 0.35 : 0.55} scale={size * 2.5} blur={2.2} far={4} resolution={1024} frames={1} />
      </Suspense>

      <EffectComposer multisampling={4}>
        <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={isLight ? 0.35 : 0.7} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={isLight ? 0.35 : 0.7} />
      </EffectComposer>

      <CameraRig register={register} center={center} size={size} />
    </R3FCanvas>
  );
});
