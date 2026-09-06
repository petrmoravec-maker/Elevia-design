import { useState } from 'react';
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
} from '../../types/floorplan';
import { ROOM_TYPES } from '../../data/roomTypes';
import { getEquipmentById } from '../../data/equipmentLibrary';
import { EquipmentBindingSection, LabRoomMapping } from './InspectorPanel';
import { SectionTitle } from './ui';

interface PropertiesPanelProps {
  elementId: string;
  projectId: string;
  onClose: () => void;
}

export function PropertiesPanel({ elementId, onClose }: PropertiesPanelProps) {
  const { colors } = useTheme();
  const { entities, updateEntity, deleteEntity } = useFloorplanStore();
  const entity = entities[elementId];

  const styles = {
    container: {
      width: '280px',
      backgroundColor: colors.bgPanel,
      borderLeft: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column' as const,
      flexShrink: 0,
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderBottom: `1px solid ${colors.border}`,
    } as const,
    headerTitle: {
      fontSize: '12px',
      fontWeight: 600,
      color: colors.textSecondary,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
    } as const,
    closeBtn: {
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '4px',
      color: colors.textSecondary,
      fontSize: '16px',
      cursor: 'pointer',
    } as const,
    content: {
      flex: 1,
      overflow: 'auto',
      padding: '14px',
    } as const,
    section: {
      marginBottom: '18px',
    } as const,
    sectionTitle: {
      fontSize: '11px',
      fontWeight: 600,
      color: colors.textMuted,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      marginBottom: '10px',
    } as const,
    field: {
      marginBottom: '10px',
    } as const,
    label: {
      display: 'block',
      fontSize: '12px',
      color: colors.textSecondary,
      marginBottom: '4px',
    } as const,
    input: {
      width: '100%',
      padding: '7px 10px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      color: colors.text,
      fontSize: '13px',
      outline: 'none',
      boxSizing: 'border-box' as const,
    } as const,
    select: {
      width: '100%',
      padding: '7px 10px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      color: colors.text,
      fontSize: '13px',
      outline: 'none',
      boxSizing: 'border-box' as const,
    } as const,
    row: {
      display: 'flex',
      gap: '8px',
    } as const,
    readOnlyValue: {
      padding: '7px 10px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      color: colors.textMuted,
      fontSize: '13px',
    } as const,
    statRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: `1px solid ${colors.border}`,
      fontSize: '13px',
    } as const,
    statLabel: {
      color: colors.textSecondary,
    } as const,
    statValue: {
      color: colors.text,
      fontWeight: 500,
    } as const,
    deleteBtn: {
      width: '100%',
      padding: '8px',
      backgroundColor: `${colors.error}15`,
      border: `1px solid ${colors.error}40`,
      borderRadius: '6px',
      color: colors.error,
      fontSize: '12px',
      cursor: 'pointer',
      marginTop: '8px',
    } as const,
    placeholder: {
      padding: '40px 16px',
      textAlign: 'center' as const,
      color: colors.textMuted,
      fontSize: '13px',
    } as const,
    entityTypeBadge: (color: string) => ({
      display: 'inline-block',
      padding: '2px 8px',
      backgroundColor: `${color}20`,
      border: `1px solid ${color}40`,
      borderRadius: '4px',
      fontSize: '11px',
      color,
      marginBottom: '12px',
    }),
  };

  if (!entity) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Properties</span>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div style={styles.content}>
          <div style={styles.placeholder}>Select an element to view its properties</div>
        </div>
      </div>
    );
  }

  const handleDelete = () => {
    if (entity.type === 'room') {
      const store = useFloorplanStore.getState();
      const equipInRoom = store.getEquipmentInRoom(entity.id);
      if (equipInRoom.length > 0) {
        const confirmed = confirm(
          `Delete "${(entity as RoomEntity).name}" and ${equipInRoom.length} equipment item(s) inside it?\n` +
          'Click OK to delete room only (equipment will stay). Click Cancel to abort.'
        );
        if (!confirmed) return;
      }
    }
    deleteEntity(entity.id);
    onClose();
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Properties</span>
        <button style={styles.closeBtn} onClick={onClose}>×</button>
      </div>
      <div style={styles.content}>
        {entity.type === 'room' && (
          <RoomProperties entity={entity as RoomEntity} updateEntity={updateEntity} styles={styles} />
        )}
        {entity.type === 'wall' && (
          <WallProperties entity={entity as WallEntity} updateEntity={updateEntity} styles={styles} />
        )}
        {entity.type === 'door' && (
          <DoorProperties entity={entity as DoorEntity} updateEntity={updateEntity} styles={styles} />
        )}
        {entity.type === 'equipment' && (
          <>
            <EquipmentProperties entity={entity as EquipmentEntity} updateEntity={updateEntity} styles={styles} />
            <SectionTitle>Inventory</SectionTitle>
            <EquipmentBindingSection eq={entity as EquipmentEntity} />
          </>
        )}
        {entity.type === 'room' && (
          <>
            <SectionTitle>Lab room</SectionTitle>
            <LabRoomMapping room={entity as RoomEntity} />
          </>
        )}
        {entity.type === 'measure' && (
          <MeasureProperties entity={entity as MeasureEntity} updateEntity={updateEntity} styles={styles} />
        )}
        {entity.type === 'note' && (
          <NoteProperties entity={entity as NoteEntity} updateEntity={updateEntity} styles={styles} />
        )}

        <button style={styles.deleteBtn} onClick={handleDelete}>
          🗑 Delete {entity.type}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components per entity type ─────────────────────────────────────────

function RoomProperties({
  entity,
  updateEntity,
  styles,
}: {
  entity: RoomEntity;
  updateEntity: (id: string, patch: Partial<FloorplanEntity>) => void;
  styles: Record<string, any>;
}) {
  const roomType = ROOM_TYPES.find(rt => rt.id === entity.roomTypeId);

  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Room</div>
        <div style={styles.field}>
          <label style={styles.label}>Name</label>
          <input
            style={styles.input}
            type="text"
            value={entity.name}
            onChange={e => updateEntity(entity.id, { name: e.target.value } as Partial<RoomEntity>)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Room Type</label>
          <select
            style={styles.select}
            value={entity.roomTypeId}
            onChange={e => updateEntity(entity.id, { roomTypeId: e.target.value } as Partial<RoomEntity>)}
          >
            {ROOM_TYPES.map(rt => (
              <option key={rt.id} value={rt.id}>{rt.icon} {rt.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Dimensions</div>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>Area</span>
          <span style={styles.statValue}>{entity.area.toFixed(2)} m²</span>
        </div>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>Vertices</span>
          <span style={styles.statValue}>{entity.polygon.length}</span>
        </div>
        <div style={{ ...styles.field, marginTop: 10 }}>
          <label style={styles.label}>Wall Thickness (m)</label>
          <input
            style={styles.input}
            type="number"
            step="0.05"
            min="0.1"
            max="0.5"
            value={entity.wallThickness}
            onChange={e => updateEntity(entity.id, { wallThickness: parseFloat(e.target.value) } as Partial<RoomEntity>)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Ceiling Height (m)</label>
          <input
            style={styles.input}
            type="number"
            step="0.1"
            min="2"
            max="6"
            value={entity.ceilingHeight}
            onChange={e => updateEntity(entity.id, { ceilingHeight: parseFloat(e.target.value) } as Partial<RoomEntity>)}
          />
        </div>
      </div>

      {roomType && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Room Requirements</div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Power density</span>
            <span style={styles.statValue}>{roomType.powerDensity}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Water required</span>
            <span style={styles.statValue}>{roomType.requiresWater ? 'Yes' : 'No'}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Drain required</span>
            <span style={styles.statValue}>{roomType.requiresDrain ? 'Yes' : 'No'}</span>
          </div>
        </div>
      )}
    </>
  );
}

function WallProperties({
  entity,
  updateEntity,
  styles,
}: {
  entity: WallEntity;
  updateEntity: (id: string, patch: Partial<FloorplanEntity>) => void;
  styles: Record<string, any>;
}) {
  const totalLength = entity.points.reduce((sum, pt, i) => {
    if (i === 0) return sum;
    const prev = entity.points[i - 1];
    return sum + Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
  }, 0);

  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Wall</div>
      <div style={styles.statRow}>
        <span style={styles.statLabel}>Total length</span>
        <span style={styles.statValue}>{totalLength.toFixed(2)} m</span>
      </div>
      <div style={styles.statRow}>
        <span style={styles.statLabel}>Segments</span>
        <span style={styles.statValue}>{Math.max(0, entity.points.length - 1)}</span>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Thickness (m)</label>
        <input
          style={styles.input}
          type="number"
          step="0.05"
          min="0.1"
          max="0.5"
          value={entity.thickness}
          onChange={e => updateEntity(entity.id, { thickness: parseFloat(e.target.value) } as Partial<WallEntity>)}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Height (m)</label>
        <input
          style={styles.input}
          type="number"
          step="0.1"
          min="2"
          max="6"
          value={entity.height}
          onChange={e => updateEntity(entity.id, { height: parseFloat(e.target.value) } as Partial<WallEntity>)}
        />
      </div>
    </div>
  );
}

function DoorProperties({
  entity,
  updateEntity,
  styles,
}: {
  entity: DoorEntity;
  updateEntity: (id: string, patch: Partial<FloorplanEntity>) => void;
  styles: Record<string, any>;
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Door</div>
      <div style={styles.field}>
        <label style={styles.label}>Width (m)</label>
        <input
          style={styles.input}
          type="number"
          step="0.1"
          min="0.6"
          max="3.0"
          value={entity.width}
          onChange={e => updateEntity(entity.id, { width: parseFloat(e.target.value) } as Partial<DoorEntity>)}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Swing Type</label>
        <select
          style={styles.select}
          value={entity.swing}
          onChange={e => updateEntity(entity.id, { swing: e.target.value as DoorEntity['swing'] } as Partial<DoorEntity>)}
        >
          <option value="left">Left swing</option>
          <option value="right">Right swing</option>
          <option value="double">Double swing</option>
          <option value="sliding">Sliding</option>
        </select>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Position along edge (0-1)</label>
        <input
          style={styles.input}
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={entity.position}
          onChange={e => updateEntity(entity.id, { position: parseFloat(e.target.value) } as Partial<DoorEntity>)}
        />
      </div>
    </div>
  );
}

function EquipmentProperties({
  entity,
  updateEntity,
  styles,
}: {
  entity: EquipmentEntity;
  updateEntity: (id: string, patch: Partial<FloorplanEntity>) => void;
  styles: Record<string, any>;
}) {
  const equipDef = getEquipmentById(entity.equipmentId);

  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Equipment</div>
        {equipDef && (
          <>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Name</span>
              <span style={styles.statValue}>{equipDef.name}</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Category</span>
              <span style={styles.statValue}>{equipDef.category}</span>
            </div>
            <div style={styles.statRow}>
              <span style={styles.statLabel}>Power</span>
              <span style={styles.statValue}>{equipDef.watts}W / {equipDef.voltage}V</span>
            </div>
            {equipDef.btu && (
              <div style={styles.statRow}>
                <span style={styles.statLabel}>BTU</span>
                <span style={styles.statValue}>{equipDef.btu.toLocaleString()}</span>
              </div>
            )}
            {equipDef.ppdCapacity && (
              <div style={styles.statRow}>
                <span style={styles.statLabel}>Capacity</span>
                <span style={styles.statValue}>{equipDef.ppdCapacity} PPD</span>
              </div>
            )}
            {equipDef.ppfd && (
              <div style={styles.statRow}>
                <span style={styles.statLabel}>PPFD</span>
                <span style={styles.statValue}>{equipDef.ppfd} µmol/m²/s</span>
              </div>
            )}
            {equipDef.coverage && (
              <div style={styles.statRow}>
                <span style={styles.statLabel}>Coverage</span>
                <span style={styles.statValue}>{equipDef.coverage} m²</span>
              </div>
            )}
          </>
        )}
      </div>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Placement</div>
        <div style={styles.field}>
          <label style={styles.label}>Rotation (°)</label>
          <input
            style={styles.input}
            type="number"
            step="90"
            min="0"
            max="359"
            value={entity.rotation}
            onChange={e => updateEntity(entity.id, { rotation: parseFloat(e.target.value) } as Partial<EquipmentEntity>)}
          />
        </div>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>Width × Depth</span>
          <span style={styles.statValue}>{entity.dimensions[0].toFixed(1)} × {entity.dimensions[1].toFixed(1)} m</span>
        </div>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>Position</span>
          <span style={styles.statValue}>({entity.center[0].toFixed(2)}, {entity.center[1].toFixed(2)}) m</span>
        </div>
      </div>
    </>
  );
}

function MeasureProperties({
  entity,
  updateEntity,
  styles,
}: {
  entity: MeasureEntity;
  updateEntity: (id: string, patch: Partial<FloorplanEntity>) => void;
  styles: Record<string, any>;
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Dimension</div>
      <div style={styles.statRow}>
        <span style={styles.statLabel}>Distance</span>
        <span style={styles.statValue}>{entity.distance.toFixed(3)} m</span>
      </div>
      <div style={styles.statRow}>
        <span style={styles.statLabel}>Start</span>
        <span style={styles.statValue}>({entity.start[0].toFixed(2)}, {entity.start[1].toFixed(2)})</span>
      </div>
      <div style={styles.statRow}>
        <span style={styles.statLabel}>End</span>
        <span style={styles.statValue}>({entity.end[0].toFixed(2)}, {entity.end[1].toFixed(2)})</span>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Custom label (optional)</label>
        <input
          style={styles.input}
          type="text"
          value={entity.label ?? ''}
          placeholder={`${entity.distance.toFixed(2)} m`}
          onChange={e => updateEntity(entity.id, { label: e.target.value || undefined } as Partial<MeasureEntity>)}
        />
      </div>
    </div>
  );
}

function NoteProperties({
  entity,
  updateEntity,
  styles,
}: {
  entity: NoteEntity;
  updateEntity: (id: string, patch: Partial<FloorplanEntity>) => void;
  styles: Record<string, any>;
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Note</div>
      <div style={styles.field}>
        <label style={styles.label}>Text</label>
        <textarea
          style={{ ...styles.input, height: '80px', resize: 'vertical' as const }}
          value={entity.text}
          onChange={e => updateEntity(entity.id, { text: e.target.value } as Partial<NoteEntity>)}
        />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Font Size (m)</label>
        <input
          style={styles.input}
          type="number"
          step="0.05"
          min="0.1"
          max="1.0"
          value={entity.fontSize}
          onChange={e => updateEntity(entity.id, { fontSize: parseFloat(e.target.value) } as Partial<NoteEntity>)}
        />
      </div>
    </div>
  );
}
