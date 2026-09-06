import { useTheme } from '../../contexts/ThemeContext';
import { useFloorplanStore } from '../../stores/useFloorplanStore';
import type { RoomEntity, EquipmentEntity } from '../../types/floorplan';
import { ROOM_TYPES } from '../../data/roomTypes';
import { getEquipmentById } from '../../data/equipmentLibrary';
import { suggestBreakerSize } from '../../data/electricalSymbols';

interface RoomSummaryProps {
  roomId: string;
  onClose?: () => void;
}

export function RoomSummary({ roomId, onClose }: RoomSummaryProps) {
  const { colors } = useTheme();
  const { entities, getEquipmentInRoom } = useFloorplanStore();
  const room = entities[roomId] as RoomEntity | undefined;

  if (!room) return null;

  const equipment = getEquipmentInRoom(roomId);
  const roomType = ROOM_TYPES.find(rt => rt.id === room.roomTypeId);

  // Calculations
  const totalWatts120V = equipment.reduce((sum, eq) => {
    const def = getEquipmentById(eq.equipmentId);
    return def?.voltage === 120 ? sum + (def?.watts ?? 0) : sum;
  }, 0);

  const totalWatts240V = equipment.reduce((sum, eq) => {
    const def = getEquipmentById(eq.equipmentId);
    return def?.voltage === 240 ? sum + (def?.watts ?? 0) : sum;
  }, 0);

  const totalWatts = totalWatts120V + totalWatts240V;

  // Circuit estimates (80% loading rule already in BREAKER_SIZES)
  const circuits120V = Math.ceil(totalWatts120V / (20 * 120 * 0.8));
  const circuits240V = Math.ceil(totalWatts240V / (20 * 240 * 0.8));

  // BTU estimate (lighting generates ~3.41 BTU/hr per watt)
  const lightingWatts = equipment.reduce((sum, eq) => {
    const def = getEquipmentById(eq.equipmentId);
    return def?.category === 'lighting' ? sum + (def?.watts ?? 0) : sum;
  }, 0);
  const heatGenBtu = Math.round(lightingWatts * 3.41);

  // Drain/water connections
  const drainCount = equipment.filter(eq => getEquipmentById(eq.equipmentId)?.drain).length;
  const waterCount = equipment.filter(eq => getEquipmentById(eq.equipmentId)?.water).length;

  // PPFD coverage
  const totalCoverage = equipment.reduce((sum, eq) => {
    const def = getEquipmentById(eq.equipmentId);
    return def?.coverage ? sum + def.coverage : sum;
  }, 0);
  const coverageRatio = room.area > 0 ? (totalCoverage / room.area) * 100 : 0;

  const styles = {
    panel: {
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '12px',
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderBottom: `1px solid ${colors.border}`,
      backgroundColor: roomType ? `${roomType.color}15` : undefined,
    } as const,
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    icon: { fontSize: '18px' },
    name: { fontSize: '14px', fontWeight: 600, color: colors.text },
    area: { fontSize: '12px', color: colors.textSecondary },
    closeBtn: {
      background: 'none',
      border: 'none',
      color: colors.textMuted,
      cursor: 'pointer',
      fontSize: '16px',
    } as const,
    body: { padding: '12px 16px' },
    statGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px',
      marginBottom: '12px',
    },
    statCard: (color: string) => ({
      padding: '10px',
      backgroundColor: `${color}10`,
      border: `1px solid ${color}30`,
      borderRadius: '8px',
    }),
    statLabel: {
      fontSize: '11px',
      color: colors.textMuted,
      marginBottom: '2px',
    } as const,
    statValue: {
      fontSize: '16px',
      fontWeight: 600,
      color: colors.text,
    } as const,
    statUnit: {
      fontSize: '11px',
      color: colors.textSecondary,
    } as const,
    sectionTitle: {
      fontSize: '11px',
      fontWeight: 600,
      color: colors.textMuted,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      marginBottom: '8px',
      marginTop: '12px',
    } as const,
    equipItem: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: `1px solid ${colors.border}`,
      fontSize: '12px',
    } as const,
    equipName: { color: colors.text } as const,
    equipWatts: { color: colors.textMuted } as const,
    warningBanner: (color: string) => ({
      marginTop: '10px',
      padding: '8px 10px',
      backgroundColor: `${color}12`,
      border: `1px solid ${color}30`,
      borderRadius: '6px',
      fontSize: '12px',
      color,
    }),
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <span style={styles.icon}>{roomType?.icon ?? '🏠'}</span>
          <div>
            <div style={styles.name}>{room.name}</div>
            <div style={styles.area}>{room.area.toFixed(1)} m² · {roomType?.name ?? 'Room'}</div>
          </div>
        </div>
        {onClose && (
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        )}
      </div>

      <div style={styles.body}>
        <div style={styles.statGrid}>
          <div style={styles.statCard('#F59E0B')}>
            <div style={styles.statLabel}>Total Power</div>
            <div style={styles.statValue}>{(totalWatts / 1000).toFixed(1)}</div>
            <div style={styles.statUnit}>kW</div>
          </div>
          <div style={styles.statCard('#10B981')}>
            <div style={styles.statLabel}>Equipment</div>
            <div style={styles.statValue}>{equipment.length}</div>
            <div style={styles.statUnit}>items</div>
          </div>
          <div style={styles.statCard('#3B82F6')}>
            <div style={styles.statLabel}>Circuits</div>
            <div style={styles.statValue}>{circuits120V + circuits240V}</div>
            <div style={styles.statUnit}>{circuits120V}×120V + {circuits240V}×240V</div>
          </div>
          <div style={styles.statCard('#6366F1')}>
            <div style={styles.statLabel}>Heat Load</div>
            <div style={styles.statValue}>{(heatGenBtu / 1000).toFixed(1)}</div>
            <div style={styles.statUnit}>k BTU/hr</div>
          </div>
        </div>

        {(drainCount > 0 || waterCount > 0) && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            {waterCount > 0 && (
              <div style={styles.warningBanner('#3B82F6')}>
                💧 {waterCount} water connection{waterCount > 1 ? 's' : ''}
              </div>
            )}
            {drainCount > 0 && (
              <div style={styles.warningBanner('#6366F1')}>
                🚰 {drainCount} drain connection{drainCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        {totalCoverage > 0 && (
          <div style={styles.warningBanner(coverageRatio >= 100 ? '#10B981' : '#F59E0B')}>
            💡 Lighting coverage: {totalCoverage.toFixed(1)} / {room.area.toFixed(1)} m²
            {' '}({coverageRatio.toFixed(0)}%){coverageRatio < 80 ? ' — insufficient coverage' : ''}
          </div>
        )}

        {equipment.length > 0 && (
          <>
            <div style={styles.sectionTitle}>Equipment</div>
            {equipment.map(eq => {
              const def = getEquipmentById(eq.equipmentId);
              return (
                <div key={eq.id} style={styles.equipItem}>
                  <span style={styles.equipName}>{def?.name ?? eq.equipmentId}</span>
                  <span style={styles.equipWatts}>{def?.watts ?? '?'}W</span>
                </div>
              );
            })}
            <div style={{ ...styles.equipItem, borderBottom: 'none', fontWeight: 600 }}>
              <span style={styles.equipName}>Total</span>
              <span style={{ color: colors.text, fontWeight: 600 }}>{totalWatts}W</span>
            </div>
          </>
        )}

        {equipment.length === 0 && (
          <div style={{ fontSize: '12px', color: colors.textMuted, textAlign: 'center', padding: '12px 0' }}>
            No equipment placed in this room yet.
            <br />Use the Equipment tool (E) to add items.
          </div>
        )}
      </div>
    </div>
  );
}
