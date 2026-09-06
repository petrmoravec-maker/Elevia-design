import { useTheme } from '../../contexts/ThemeContext';
import { ROOM_TYPES } from '../../data/roomTypes';
import type { RoomType } from '../../data/roomTypes';

interface RoomTypePickerProps {
  onSelect: (roomTypeId: string) => void;
  onCancel: () => void;
}

export function RoomTypePicker({ onSelect, onCancel }: RoomTypePickerProps) {
  const { colors } = useTheme();

  const powerLabel = (density: RoomType['powerDensity']) => {
    if (density === 'high') return { label: 'High power', color: '#EF4444' };
    if (density === 'medium') return { label: 'Med power', color: '#F59E0B' };
    return { label: 'Low power', color: '#10B981' };
  };

  const styles = {
    overlay: {
      position: 'fixed' as const,
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    },
    dialog: {
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '16px',
      padding: '28px',
      width: '540px',
      maxHeight: '80vh',
      overflow: 'auto',
      boxShadow: `0 24px 64px rgba(0,0,0,0.4)`,
    },
    title: {
      fontSize: '18px',
      fontWeight: 700,
      color: colors.text,
      marginBottom: '6px',
    },
    subtitle: {
      fontSize: '13px',
      color: colors.textSecondary,
      marginBottom: '24px',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '12px',
      marginBottom: '20px',
    },
    card: (color: string) => ({
      padding: '16px',
      backgroundColor: colors.bg,
      border: `2px solid ${colors.border}`,
      borderRadius: '12px',
      cursor: 'pointer',
      transition: 'all 0.15s',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '6px',
    }),
    cardIcon: {
      fontSize: '24px',
      marginBottom: '4px',
    },
    cardName: {
      fontSize: '14px',
      fontWeight: 600,
      color: colors.text,
    },
    cardDesc: {
      fontSize: '11px',
      color: colors.textSecondary,
      lineHeight: 1.4,
    },
    cardMeta: {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap' as const,
      marginTop: '4px',
    },
    badge: (color: string) => ({
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 500,
      backgroundColor: `${color}20`,
      color,
    }),
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      paddingTop: '16px',
      borderTop: `1px solid ${colors.border}`,
    },
    cancelBtn: {
      padding: '8px 18px',
      backgroundColor: 'transparent',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.textSecondary,
      fontSize: '13px',
      cursor: 'pointer',
    },
  };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={e => e.stopPropagation()}>
        <div style={styles.title}>Choose Room Type</div>
        <div style={styles.subtitle}>
          Select the type of space you just drew. You can change this later in the properties panel.
        </div>

        <div style={styles.grid}>
          {ROOM_TYPES.map(rt => {
            const pw = powerLabel(rt.powerDensity);
            return (
              <div
                key={rt.id}
                style={styles.card(rt.color)}
                onClick={() => onSelect(rt.id)}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = rt.color;
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = `${rt.color}15`;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = colors.border;
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = colors.bg;
                }}
              >
                <div style={styles.cardIcon}>{rt.icon}</div>
                <div style={styles.cardName}>{rt.name}</div>
                <div style={styles.cardDesc}>{rt.description}</div>
                <div style={styles.cardMeta}>
                  <span style={styles.badge(pw.color)}>{pw.label}</span>
                  {rt.requiresWater && <span style={styles.badge('#3B82F6')}>water</span>}
                  {rt.requiresDrain && <span style={styles.badge('#6366F1')}>drain</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            Keep as generic
          </button>
        </div>
      </div>
    </div>
  );
}
