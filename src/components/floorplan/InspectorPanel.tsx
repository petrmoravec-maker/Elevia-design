/**
 * Context inspector (right panel): facility summary when nothing is selected, otherwise a
 * read-only card for the selected generated entity (room / wall / door / equipment /
 * dimension / note). Editable design entities are handled by PropertiesPanel.
 */

import { useMemo, useState } from 'react';
import { X, ZoomIn, Crosshair, Link2, Check, ExternalLink, Unlink, Search, Download } from 'lucide-react';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { storage } from '../../firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useFloorplanStore } from '../../stores/useFloorplanStore';
import type {
  FloorplanEntity,
  RoomEntity,
  WallEntity,
  DoorEntity,
  EquipmentEntity,
  MeasureEntity,
  NoteEntity,
  RoomFinish,
} from '../../types/floorplan';
import { ROOM_TYPES } from '../../data/roomTypes';
import { getEquipmentById } from '../../data/equipmentLibrary';
import type { DesignProject } from '../../services/designProject';
import { fmtArea } from '../../services/designProject';
import { computeRoomScope } from '../../services/roomScope';
import { IconButton, TextButton, SectionTitle, KV, Chip, Card, Mm, panelStyle, panelHeaderStyle } from './ui';
import {
  useInventoryStore, findBound, labUrlFor, labRoomUrl, setLabRoomPlanCode, lightsOnNow, bindingKey,
  STATUS_COLOR, KIND_LABEL, type LabDevice,
} from '../../services/labInventory';

interface InspectorPanelProps {
  project: DesignProject;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onZoomTo: (id: string) => void;
  scopeRoomId: string | null;
  onScopeRoom: (id: string | null) => void;
  onClose?: () => void;
}

function roomCode(r: RoomEntity): string {
  return typeof r.meta?.code === 'string' ? (r.meta!.code as string) : r.name.split(' ')[0];
}

function roomDisplayName(r: RoomEntity): string {
  const code = roomCode(r);
  return r.name.startsWith(code) ? r.name.slice(code.length).trim() : r.name;
}

export function InspectorPanel({ project, selectedId, onSelect, onZoomTo, scopeRoomId, onScopeRoom, onClose }: InspectorPanelProps) {
  const { colors } = useTheme();
  const entities = useFloorplanStore(s => s.entities);
  const entity = selectedId ? entities[selectedId] : null;

  return (
    <aside style={panelStyle(colors, 'right', 330)} aria-label="Inspector">
      <div style={panelHeaderStyle(colors)}>
        <span style={{ flex: 1 }}>{entity ? entityTitle(entity) : 'Facility'}</span>
        {entity && (
          <>
            <IconButton title="Zoom to selection (Z)" size={24} onClick={() => onZoomTo(entity.id)}><ZoomIn size={14} /></IconButton>
            <IconButton title="Back to facility summary" size={24} onClick={() => onSelect(null)}><X size={14} /></IconButton>
          </>
        )}
        {!entity && onClose && <IconButton title="Close inspector (I)" size={24} onClick={onClose}><X size={14} /></IconButton>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 16px' }}>
        {!entity && <FacilitySummary project={project} entities={entities} onSelect={onSelect} onZoomTo={onZoomTo} />}
        {entity?.type === 'room' && (
          <RoomCard room={entity as RoomEntity} project={project} entities={entities} onZoomTo={onZoomTo}
            isolated={scopeRoomId === entity.id} onIsolate={() => onScopeRoom(scopeRoomId === entity.id ? null : entity.id)} onSelect={onSelect} />
        )}
        {entity?.type === 'wall' && <WallCard wall={entity as WallEntity} entities={entities} onSelect={onSelect} />}
        {entity?.type === 'door' && <DoorCard door={entity as DoorEntity} entities={entities} project={project} onSelect={onSelect} />}
        {entity?.type === 'equipment' && <EquipmentCard eq={entity as EquipmentEntity} entities={entities} onSelect={onSelect} />}
        {entity?.type === 'measure' && <MeasureCard m={entity as MeasureEntity} entities={entities} onSelect={onSelect} />}
        {entity?.type === 'note' && <NoteCard n={entity as NoteEntity} />}
      </div>
    </aside>
  );
}

function entityTitle(e: FloorplanEntity): string {
  switch (e.type) {
    case 'room': return 'Room';
    case 'wall': return 'Wall';
    case 'door': return 'Door';
    case 'equipment': return 'Equipment';
    case 'measure': return (e as MeasureEntity).style === 'dimension' ? 'Dimension' : 'Measurement';
    case 'note': return 'Note';
    default: return 'Element';
  }
}

// ─── Facility summary ─────────────────────────────────────────────────────────

/** Download button for a hand-off file in Storage (URL resolved on click). */
function ExportLink({ file }: { file: { storagePath: string; fileName: string; bytes?: number; label?: string } }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = await getDownloadURL(storageRef(storage, file.storagePath));
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.warn('export not available', e);
    } finally {
      setBusy(false);
    }
  };
  const size = file.bytes ? ` · ${(file.bytes / 1024 / 1024).toFixed(1)} MB` : '';
  const short = file.fileName.endsWith('.pdf') ? 'Builder sheets PDF' : file.fileName.endsWith('.ifc') ? 'IFC model' : file.fileName;
  return (
    <TextButton small disabled={busy} title={`${file.label ?? file.fileName}${size}`} onClick={() => void open()}>
      <Download size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{short}
    </TextButton>
  );
}

function FacilitySummary({
  project, entities, onSelect, onZoomTo,
}: { project: DesignProject; entities: Record<string, FloorplanEntity>; onSelect: (id: string) => void; onZoomTo: (id: string) => void }) {
  const { colors } = useTheme();
  const rooms = useMemo(
    () => (Object.values(entities).filter(e => e.type === 'room') as RoomEntity[]).sort((a, b) => roomCode(a).localeCompare(roomCode(b), undefined, { numeric: true })),
    [entities],
  );
  const counts = useMemo(() => {
    const c = { walls: 0, doors: 0, equipment: 0, tables: 0, lights: 0, dims: 0 };
    for (const e of Object.values(entities)) {
      if (e.type === 'wall') c.walls++;
      else if (e.type === 'door') c.doors++;
      else if (e.type === 'measure' && (e as MeasureEntity).style === 'dimension') c.dims++;
      else if (e.type === 'equipment') {
        if (e.layer.includes('table')) c.tables++;
        else if (e.layer.includes('light')) c.lights++;
        else c.equipment++;
      }
    }
    return c;
  }, [entities]);
  const totalArea = rooms.reduce((s, r) => s + r.area, 0);
  const fac = project.facility;
  const con = fac?.construction ?? {};

  return (
    <>
      <Card>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{project.name}</div>
        <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
          {fac?.project.stage ?? project.status}{fac?.project.revision !== undefined ? ` · rev ${fac.project.revision}` : ''}
          {project.shared ? ' · shared facility plan' : ''}
        </div>
        {project.originNote && <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>{project.originNote}</div>}
        {project.exports && Object.keys(project.exports).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {Object.entries(project.exports).map(([key, f]) => <ExportLink key={key} file={f} />)}
          </div>
        )}
      </Card>

      <SectionTitle>Totals</SectionTitle>
      <KV rows={[
        ['Rooms', `${rooms.length} · ${fmtArea(totalArea)} net`],
        ['Walls / doors', `${counts.walls} / ${counts.doors}`],
        ['Tables / light rows', `${counts.tables} / ${counts.lights}`],
        ['Equipment', String(counts.equipment)],
        ['Dimensions', String(counts.dims)],
      ]} />

      {fac && (
        <>
          <SectionTitle>Construction (owner)</SectionTitle>
          <KV rows={[
            ['Exterior wall', <Mm m={(con.exterior_wall_mm ?? 300) / 1000} />],
            ['Interior masonry', <Mm m={(con.interior_masonry_wall_mm ?? 200) / 1000} />],
            ['Partitions', <Mm m={0.13} />],
            ['Clear height', `${con.clear_height_m ?? fac.project.default_height ?? 3.5} m`],
            ['Door height', <Mm m={(con.door_height_mm ?? 1970) / 1000} />],
          ]} />
        </>
      )}

      <SectionTitle>Rooms</SectionTitle>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: colors.textSecondary, textAlign: 'left' }}>
            <th style={{ padding: '2px 4px', fontWeight: 500 }}>No.</th>
            <th style={{ padding: '2px 4px', fontWeight: 500 }}>Name</th>
            <th style={{ padding: '2px 4px', fontWeight: 500, textAlign: 'right' }}>m²</th>
            <th style={{ padding: '2px 4px', fontWeight: 500, textAlign: 'right' }}>W × D mm</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map(r => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              onDoubleClick={() => onZoomTo(r.id)}
              style={{ cursor: 'pointer', borderTop: `1px solid ${colors.border}` }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.bgHover)}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="Click to inspect, double-click to zoom"
            >
              <td style={{ padding: '3px 4px', fontWeight: 600, whiteSpace: 'nowrap' }}>{roomCode(r)}</td>
              <td style={{ padding: '3px 4px' }}>{roomDisplayName(r)}</td>
              <td style={{ padding: '3px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.area.toFixed(1)}</td>
              <td style={{ padding: '3px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                {typeof r.meta?.size_mm === 'string' ? (r.meta!.size_mm as string) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ─── Room card ────────────────────────────────────────────────────────────────

function RoomCard({
  room, project, entities, onZoomTo, isolated, onIsolate, onSelect,
}: {
  room: RoomEntity;
  project: DesignProject;
  entities: Record<string, FloorplanEntity>;
  onZoomTo: (id: string) => void;
  isolated: boolean;
  onIsolate: () => void;
  onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const code = roomCode(room);
  const rt = ROOM_TYPES.find(t => t.id === room.roomTypeId);
  const meta = room.meta ?? {};
  const finish = (meta.finish ?? project.facility?.legend.rooms[code]?.finish ?? {}) as RoomFinish;
  const legendArea = (meta.area_legend as number | undefined) ?? project.facility?.legend.rooms[code]?.area_m2;
  const scope = useMemo(() => computeRoomScope(entities, room.id), [entities, room.id]);
  const inRoom = [...scope].map(id => entities[id]).filter(Boolean);
  const doors = inRoom.filter(e => e.type === 'door') as DoorEntity[];
  const walls = inRoom.filter(e => e.type === 'wall') as WallEntity[];
  const eq = inRoom.filter(e => e.type === 'equipment') as EquipmentEntity[];
  const tables = eq.filter(e => e.layer.includes('table'));
  const lights = eq.filter(e => e.layer.includes('light'));
  const other = eq.filter(e => !e.layer.includes('table') && !e.layer.includes('light'));
  const dims = inRoom.filter(e => e.type === 'measure' && (e as MeasureEntity).style === 'dimension') as MeasureEntity[];
  const wallThicknesses = [...new Set(walls.map(w => Math.round(w.thickness * 1000)))].sort((a, b) => a - b);

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?focus=${encodeURIComponent(room.id)}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{code}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{roomDisplayName(room)}</span>
        </div>
        <div style={{ marginTop: 4 }}>
          {rt && <Chip color={rt.color}>{rt.name}</Chip>}
          {typeof meta.stage === 'string' && <Chip>{meta.stage as string}</Chip>}
          {room.locked && <Chip>generated</Chip>}
        </div>
        {typeof meta.description === 'string' && (
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 8, lineHeight: 1.45 }}>{meta.description as string}</div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <TextButton small onClick={() => onZoomTo(room.id)} title="Zoom to room (Z)"><ZoomIn size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Zoom</TextButton>
          <TextButton small active={isolated} onClick={onIsolate} title="Show only this room with its dimensions"><Crosshair size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{isolated ? 'Isolated' : 'Isolate'}</TextButton>
          <TextButton small onClick={copyLink} title="Copy a link that opens the plan focused on this room">
            {copied ? <Check size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> : <Link2 size={12} style={{ verticalAlign: -2, marginRight: 4 }} />}{copied ? 'Copied' : 'Copy link'}
          </TextButton>
        </div>
      </Card>

      <SectionTitle>Dimensions</SectionTitle>
      <KV rows={[
        ['Interior W × D', typeof meta.size_mm === 'string' ? <b>{(meta.size_mm as string).replace('x', '×')} mm</b> : '-'],
        ['Area (model)', fmtArea(room.area)],
        ['Area (legend)', legendArea !== undefined ? fmtArea(legendArea) : '-'],
        ['Clear height', `${room.ceilingHeight} m`],
        ['Walls', wallThicknesses.length ? wallThicknesses.map(t => `${t} mm`).join(' / ') : <Mm m={room.wallThickness} />],
        ['Dimension strings', String(dims.length)],
      ]} />

      {(finish.floor || finish.walls || finish.ceiling) && (
        <>
          <SectionTitle>Finishes (legend)</SectionTitle>
          <KV rows={[
            ['Floor', finish.floor ?? '-'],
            ['Walls', finish.walls ?? '-'],
            ['Ceiling', finish.ceiling ?? '-'],
          ]} />
        </>
      )}

      <SectionTitle>Doors ({doors.length})</SectionTitle>
      {doors.length === 0 && <div style={{ fontSize: 12, color: colors.textMuted }}>No doors recorded.</div>}
      {doors.map(d => {
        const dm = d.meta ?? {};
        const otherSide = dm.from === code ? dm.to : dm.from;
        return (
          <div key={d.id} onClick={() => onSelect(d.id)} style={{ fontSize: 12, padding: '3px 0', cursor: 'pointer', display: 'flex', gap: 8 }}
            onMouseEnter={e => (e.currentTarget.style.color = colors.accent)} onMouseLeave={e => (e.currentTarget.style.color = colors.text)}>
            <span style={{ fontWeight: 600, minWidth: 40 }}>{typeof dm.code === 'string' ? (dm.code as string) : 'door'}</span>
            <span><Mm m={d.width} /> × <Mm m={d.height ?? 1.97} /></span>
            <span style={{ color: colors.textSecondary }}>{typeof otherSide === 'string' ? `→ ${otherSide}` : ''}</span>
          </div>
        );
      })}

      <SectionTitle>Fit-out</SectionTitle>
      <KV rows={[
        ['Plant tables', tables.length ? `${tables.length} × ${Math.round(tables[0].dimensions[0] * 1000)} × ${Math.round(tables[0].dimensions[1] * 1000)} mm` : '-'],
        ['Light rows', lights.length ? `${lights.length} × ${Math.round(Math.max(...lights[0].dimensions) * 1000)} mm` : '-'],
        ['Equipment', other.length ? other.map(e => getEquipmentById(e.equipmentId)?.name ?? e.equipmentId).join(', ') : '-'],
      ]} />
      {other.map(e => (
        <div key={e.id} onClick={() => onSelect(e.id)} style={{ fontSize: 12, padding: '2px 0', cursor: 'pointer', color: colors.textSecondary }}>
          · {getEquipmentById(e.equipmentId)?.name ?? e.equipmentId} — {Math.round(e.dimensions[0] * 1000)} × {Math.round(e.dimensions[1] * 1000)} mm
        </div>
      ))}

      <SectionTitle>Lab room</SectionTitle>
      <LabRoomMapping room={room} />
    </>
  );
}

/** Map this drawing room to a Lab `rooms/{id}`; writes labRoomId here and planRoomCode on the Lab room. */
export function LabRoomMapping({ room }: { room: RoomEntity }) {
  const { colors } = useTheme();
  const labRooms = useInventoryStore(s => s.rooms);
  const roomsError = useInventoryStore(s => s.errors.rooms);
  const readOnly = useFloorplanStore(s => s.readOnly);
  const updateEntity = useFloorplanStore(s => s.updateEntity);
  const devices = useInventoryStore(s => s.devices);
  const [msg, setMsg] = useState('');
  const labRoom = labRooms.find(r => r.id === room.labRoomId);
  const code = roomCode(room);
  const lights = lightsOnNow(labRoom);
  const roomDevices = labRoom ? Object.values(devices).filter(d => d.roomId === labRoom.id || (d.roomName && labRoom.name && d.roomName.toLowerCase() === labRoom.name.toLowerCase())) : [];

  const change = async (id: string) => {
    const prev = room.labRoomId;
    updateEntity(room.id, { labRoomId: id || null } as Partial<RoomEntity>);
    setMsg('');
    try {
      if (prev && prev !== id) await setLabRoomPlanCode(prev, null);
      if (id) await setLabRoomPlanCode(id, code);
      setMsg(id ? `Lab room now links to ${code}.` : 'Mapping removed.');
    } catch (e) {
      setMsg(`Saved here; Lab room not updated (${(e as { code?: string })?.code ?? 'no permission'}).`);
    }
  };

  return (
    <>
      {roomsError && <div style={{ fontSize: 12, color: colors.textMuted }}>Lab rooms not available for your role.</div>}
      {!roomsError && (
        <select
          value={room.labRoomId ?? ''}
          disabled={readOnly}
          onChange={e => void change(e.target.value)}
          aria-label="Lab room"
          style={{ width: '100%', font: 'inherit', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${colors.border}`, backgroundColor: colors.bg, color: colors.text }}
        >
          <option value="">Not mapped</option>
          {labRooms.map(r => (
            <option key={r.id} value={r.id} disabled={!!r.planRoomCode && r.planRoomCode !== code && r.id !== room.labRoomId}>
              {r.name}{r.type ? ` (${r.type})` : ''}{r.planRoomCode && r.planRoomCode !== code ? ` - already ${r.planRoomCode}` : ''}
            </option>
          ))}
        </select>
      )}
      {msg && <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>{msg}</div>}
      {labRoom && (
        <div style={{ marginTop: 8 }}>
          <KV rows={[
            ['Lab room', <a href={labRoomUrl(labRoom.id)} target="_blank" rel="noreferrer" style={{ color: colors.accent, textDecoration: 'none' }}>{labRoom.name} <ExternalLink size={11} /></a>],
            ['Status', labRoom.status ? <Chip color={labRoom.status === 'healthy' ? '#22c55e' : labRoom.status === 'offline' ? '#6b7280' : '#f59e0b'}>{labRoom.status}</Chip> : '-'],
            ['Lights', lights === undefined ? '-' : lights ? <Chip color="#eab308">on now · {labRoom.lighting?.onTime}-{labRoom.lighting?.offTime}</Chip> : <Chip>off now · {labRoom.lighting?.onTime}-{labRoom.lighting?.offTime}</Chip>],
            ['Devices in Lab', roomDevices.length ? `${roomDevices.length} (${roomDevices.filter(d => d.status === 'offline' || d.status === 'maintenance').length} offline / service)` : '0'],
          ]} />
        </div>
      )}
    </>
  );
}

// ─── Other cards ──────────────────────────────────────────────────────────────

function RoomLink({ code, entities, onSelect }: { code: string; entities: Record<string, FloorplanEntity>; onSelect: (id: string) => void }) {
  const { colors } = useTheme();
  const room = Object.values(entities).find(e => e.type === 'room' && roomCode(e as RoomEntity) === code) as RoomEntity | undefined;
  if (!room) return <span>{code}</span>;
  return (
    <span onClick={() => onSelect(room.id)} style={{ cursor: 'pointer', color: colors.accent }}>{code} {roomDisplayName(room)}</span>
  );
}

function WallCard({ wall, entities, onSelect }: { wall: WallEntity; entities: Record<string, FloorplanEntity>; onSelect: (id: string) => void }) {
  const len = wall.points.reduce((s, p, i) => i === 0 ? 0 : s + Math.hypot(p[0] - wall.points[i - 1][0], p[1] - wall.points[i - 1][1]), 0);
  const meta = wall.meta ?? {};
  const between = Array.isArray(meta.between) ? (meta.between as string[]) : [];
  const kindLabel: Record<string, string> = { exterior: 'Exterior wall (owner: 300 mm)', partition: 'Plasterboard partition', lining: 'Wall lining (předstěna)', wall: 'Wall' };
  return (
    <>
      <Card>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{kindLabel[String(meta.kind)] ?? 'Wall'}</div>
        <div style={{ marginTop: 6 }}><Chip>thickness <Mm m={wall.thickness} /></Chip>{wall.locked && <Chip>generated</Chip>}</div>
      </Card>
      <KV rows={[
        ['Thickness', <Mm m={wall.thickness} />],
        ['Length', <Mm m={len} />],
        ['Height', `${wall.height} m`],
        ['Between', between.length
          ? <span>{between.map((b, i) => <span key={i}>{i > 0 && ' | '}{/^\d/.test(b) ? <RoomLink code={b} entities={entities} onSelect={onSelect} /> : b.replace('ENV:', '')}</span>)}</span>
          : '-'],
        ['Start', `${wall.points[0][0].toFixed(3)}, ${wall.points[0][1].toFixed(3)} m`],
        ['End', `${wall.points[wall.points.length - 1][0].toFixed(3)}, ${wall.points[wall.points.length - 1][1].toFixed(3)} m`],
      ]} />
    </>
  );
}

function DoorCard({ door, entities, project, onSelect }: { door: DoorEntity; entities: Record<string, FloorplanEntity>; project: DesignProject; onSelect: (id: string) => void }) {
  const meta = door.meta ?? {};
  const h = door.height ?? (project.facility?.construction.door_height_mm ?? 1970) / 1000;
  return (
    <>
      <Card>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{typeof meta.code === 'string' ? `Door ${meta.code}` : 'Door'}</div>
        <div style={{ marginTop: 6 }}><Chip><Mm m={door.width} /> × <Mm m={h} /></Chip><Chip>{door.swing}</Chip>{door.locked && <Chip>generated</Chip>}</div>
      </Card>
      <KV rows={[
        ['Clear width', <Mm m={door.width} />],
        ['Height', <Mm m={h} />],
        ['From', typeof meta.from === 'string' ? <RoomLink code={meta.from as string} entities={entities} onSelect={onSelect} /> : '-'],
        ['To', typeof meta.to === 'string' ? <RoomLink code={meta.to as string} entities={entities} onSelect={onSelect} /> : '-'],
        ['Swing', door.swing],
        ['Note', typeof meta.note === 'string' && meta.note ? (meta.note as string) : '-'],
      ]} />
    </>
  );
}

function EquipmentCard({ eq, entities, onSelect }: { eq: EquipmentEntity; entities: Record<string, FloorplanEntity>; onSelect: (id: string) => void }) {
  const { colors } = useTheme();
  const def = getEquipmentById(eq.equipmentId);
  const room = eq.roomId ? (entities[eq.roomId] as RoomEntity | undefined) : undefined;
  const meta = eq.meta ?? {};
  return (
    <>
      <Card>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{eq.binding?.name ?? def?.name ?? (typeof meta.label === 'string' ? (meta.label as string) : eq.equipmentId)}</div>
        <div style={{ marginTop: 6 }}>
          {def && <Chip>{def.category}</Chip>}
          <Chip>{Math.round(eq.dimensions[0] * 1000)} × {Math.round(eq.dimensions[1] * 1000)} mm</Chip>
          {eq.locked && <Chip>generated</Chip>}
        </div>
      </Card>
      <KV rows={[
        ['Type id', eq.equipmentId],
        ['Footprint', `${Math.round(eq.dimensions[0] * 1000)} × ${Math.round(eq.dimensions[1] * 1000)} mm`],
        ['Centre', `${eq.center[0].toFixed(3)}, ${eq.center[1].toFixed(3)} m`],
        ['Rotation', `${eq.rotation}°`],
        ['Room', room ? <span onClick={() => onSelect(room.id)} style={{ cursor: 'pointer', color: colors.accent }}>{room.name}</span> : '-'],
        ...(def ? [['Power', `${def.watts} W · ${def.voltage} V`] as [string, React.ReactNode]] : []),
        ...(typeof meta.tag === 'string' ? [['Drawing tag', meta.tag as string] as [string, React.ReactNode]] : []),
      ]} />
      <SectionTitle>Inventory</SectionTitle>
      <EquipmentBindingSection eq={eq} />
    </>
  );
}

function fmtAgo(d?: Date): string {
  if (!d) return '-';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return d.toLocaleDateString();
}

/** Bound device card with live Lab data, or a picker to bind one. */
export function EquipmentBindingSection({ eq }: { eq: EquipmentEntity }) {
  const { colors } = useTheme();
  const devices = useInventoryStore(s => s.devices);
  const readOnly = useFloorplanStore(s => s.readOnly);
  const updateEntity = useFloorplanStore(s => s.updateEntity);
  const entities = useFloorplanStore(s => s.entities);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [now] = useState(() => Date.now());
  const dev = findBound(devices, eq.binding);

  const boundElsewhere = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of Object.values(entities)) if (e.type === 'equipment' && e.id !== eq.id && (e as EquipmentEntity).binding) m.set(bindingKey((e as EquipmentEntity).binding!), e.id);
    return m;
  }, [entities, eq.id]);

  const bind = (d: LabDevice) => {
    updateEntity(eq.id, { binding: { collection: d.collection, docId: d.id, name: d.name } } as Partial<EquipmentEntity>);
    setPicking(false);
    setQ('');
  };
  const unbind = () => updateEntity(eq.id, { binding: null } as Partial<EquipmentEntity>);

  if (eq.binding && !dev) {
    return (
      <div style={{ fontSize: 12, color: colors.textMuted }}>
        Bound to {eq.binding.collection}/{eq.binding.docId}{eq.binding.name ? ` (${eq.binding.name})` : ''} - device not loaded (deleted, or no access).
        {!readOnly && <div style={{ marginTop: 6 }}><TextButton small onClick={unbind}>Unbind</TextButton></div>}
      </div>
    );
  }

  if (dev) {
    const offline = dev.status === 'offline';
    const due = dev.nextServiceDue;
    const overdue = due ? due.getTime() < now : false;
    return (
      <>
        <Card style={{ borderColor: `${STATUS_COLOR[dev.status]}66` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: STATUS_COLOR[dev.status], boxShadow: dev.online ? `0 0 6px ${STATUS_COLOR[dev.status]}` : undefined }} />
            <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{dev.name}</div>
            <Chip color={STATUS_COLOR[dev.status]}>{dev.status}</Chip>
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
            {KIND_LABEL[dev.kind] ?? dev.kind}{dev.detail ? ` · ${dev.detail}` : ''}{dev.roomName ? ` · ${dev.roomName}` : ''}
          </div>
        </Card>
        <KV rows={[
          ...(dev.manufacturer || dev.model ? [['Make / model', `${dev.manufacturer ?? ''} ${dev.model ?? ''}`.trim()] as [string, React.ReactNode]] : []),
          ...(dev.serialNumber ? [['Serial', dev.serialNumber] as [string, React.ReactNode]] : []),
          ...(dev.companyDeviceId ? [['Asset id', dev.companyDeviceId] as [string, React.ReactNode]] : []),
          ...(dev.ipAddress ? [['Address', dev.ipAddress] as [string, React.ReactNode]] : []),
          ...(dev.lastSeen || dev.online !== undefined ? [['Last seen', <span style={{ color: offline ? colors.error : undefined }}>{fmtAgo(dev.lastSeen)}</span>] as [string, React.ReactNode]] : []),
          ...(due ? [['Next service', <span style={{ color: overdue ? colors.error : undefined }}>{due.toLocaleDateString()}{overdue ? ' · overdue' : ''}</span>] as [string, React.ReactNode]] : []),
          ['Lab record', <span>{dev.collection}/{dev.id}</span>],
        ]} />
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <a href={labUrlFor(dev)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <TextButton small><ExternalLink size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Open in Lab</TextButton>
          </a>
          {!readOnly && <TextButton small onClick={unbind}><Unlink size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Unbind</TextButton>}
        </div>
      </>
    );
  }

  // unbound
  const needle = q.trim().toLowerCase();
  const candidates = Object.values(devices)
    .filter(d => !needle || `${d.name} ${d.kind} ${d.detail ?? ''} ${d.roomName ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(boundElsewhere.has(bindingKey({ collection: a.collection, docId: a.id }))) - Number(boundElsewhere.has(bindingKey({ collection: b.collection, docId: b.id }))) || a.name.localeCompare(b.name))
    .slice(0, 40);
  return (
    <>
      <div style={{ fontSize: 12, color: colors.textMuted }}>Not bound to a Lab device.</div>
      {!readOnly && !picking && <div style={{ marginTop: 6 }}><TextButton small onClick={() => setPicking(true)}><Link2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Bind to inventory…</TextButton></div>}
      {picking && (
        <div style={{ marginTop: 6 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 7, top: 7, color: colors.textMuted }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search devices" aria-label="Search devices"
              style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 12, padding: '4px 8px 4px 24px', border: `1px solid ${colors.border}`, borderRadius: 6, backgroundColor: colors.bg, color: colors.text }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 4, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
            {candidates.map(d => {
              const elsewhere = boundElsewhere.get(bindingKey({ collection: d.collection, docId: d.id }));
              return (
                <div key={bindingKey({ collection: d.collection, docId: d.id })} onClick={() => !elsewhere && bind(d)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', fontSize: 12, cursor: elsewhere ? 'default' : 'pointer', opacity: elsewhere ? 0.5 : 1 }}
                  onMouseEnter={e => { if (!elsewhere) e.currentTarget.style.backgroundColor = colors.bgHover; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS_COLOR[d.status] }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 10, color: colors.textMuted }}>{d.roomName ?? KIND_LABEL[d.kind] ?? d.kind}{elsewhere ? ' · placed' : ''}</span>
                </div>
              );
            })}
            {candidates.length === 0 && <div style={{ padding: 8, fontSize: 12, color: colors.textMuted }}>No match.</div>}
          </div>
          <div style={{ marginTop: 6 }}><TextButton small onClick={() => setPicking(false)}>Cancel</TextButton></div>
        </div>
      )}
    </>
  );
}

function MeasureCard({ m, entities, onSelect }: { m: MeasureEntity; entities: Record<string, FloorplanEntity>; onSelect: (id: string) => void }) {
  const meta = m.meta ?? {};
  const roleLabel: Record<string, string> = {
    'room-width': 'Room interior width', 'room-depth': 'Room interior depth', 'wall-thickness': 'Wall thickness',
    'door-width': 'Door clear width', 'door-position': 'Door position from corner', 'overall': 'Overall envelope', 'overall-exterior': 'Overall exterior',
    'table-spacing': 'Table spacing', 'light-spacing': 'Light spacing', 'aisle': 'Aisle',
  };
  return (
    <>
      <Card>
        <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Math.round(m.distance * 1000)} mm</div>
        <div style={{ fontSize: 12, marginTop: 2 }}>{roleLabel[String(meta.role)] ?? (m.style === 'dimension' ? 'Dimension' : 'Measurement')}</div>
      </Card>
      <KV rows={[
        ['Distance', `${m.distance.toFixed(3)} m`],
        ['Room', typeof meta.scope === 'string' && meta.scope ? <RoomLink code={meta.scope as string} entities={entities} onSelect={onSelect} /> : '-'],
        ['From', `${m.start[0].toFixed(3)}, ${m.start[1].toFixed(3)} m`],
        ['To', `${m.end[0].toFixed(3)}, ${m.end[1].toFixed(3)} m`],
      ]} />
    </>
  );
}

function NoteCard({ n }: { n: NoteEntity }) {
  return (
    <>
      <Card><div style={{ fontSize: 14, fontWeight: 600 }}>{n.text}</div></Card>
      <KV rows={[['Position', `${n.position[0].toFixed(3)}, ${n.position[1].toFixed(3)} m`], ['Font', `${n.fontSize} m`]]} />
    </>
  );
}
