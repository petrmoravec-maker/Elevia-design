import { useTheme } from '../../contexts/ThemeContext';
import type { Layer } from '../../pages/floorplan/FloorplanEditor';

interface LayerPanelProps {
  layers: Layer[];
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
}

export function LayerPanel({ layers, onToggleVisibility, onToggleLock }: LayerPanelProps) {
  const { colors } = useTheme();

  const styles = {
    container: {
      width: '200px',
      backgroundColor: colors.bgPanel,
      borderRight: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column' as const,
      flexShrink: 0,
    },
    header: {
      padding: '12px 16px',
      borderBottom: `1px solid ${colors.border}`,
      fontSize: '12px',
      fontWeight: 600,
      color: colors.textSecondary,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
    } as const,
    list: {
      flex: 1,
      overflow: 'auto',
      padding: '8px',
    } as const,
    layer: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 10px',
      borderRadius: '6px',
      cursor: 'pointer',
      transition: 'background-color 0.15s',
    } as const,
    colorDot: (color: string) => ({
      width: '12px',
      height: '12px',
      borderRadius: '3px',
      backgroundColor: color,
      flexShrink: 0,
    }),
    layerName: {
      flex: 1,
      fontSize: '13px',
      color: colors.text,
    } as const,
    layerNameHidden: {
      flex: 1,
      fontSize: '13px',
      color: colors.textMuted,
      textDecoration: 'line-through',
    } as const,
    iconButton: (active: boolean) => ({
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '4px',
      color: active ? colors.textSecondary : colors.textMuted,
      fontSize: '12px',
      cursor: 'pointer',
      opacity: active ? 1 : 0.5,
    }),
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>Layers</div>
      <div style={styles.list}>
        {layers.map((layer) => (
          <div
            key={layer.id}
            style={{
              ...styles.layer,
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = colors.bgHover}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <div style={styles.colorDot(layer.color)} />
            <span style={layer.visible ? styles.layerName : styles.layerNameHidden}>
              {layer.name}
            </span>
            <button
              style={styles.iconButton(layer.visible)}
              onClick={() => onToggleVisibility(layer.id)}
              title={layer.visible ? 'Hide layer' : 'Show layer'}
            >
              {layer.visible ? '👁' : '👁‍🗨'}
            </button>
            <button
              style={styles.iconButton(!layer.locked)}
              onClick={() => onToggleLock(layer.id)}
              title={layer.locked ? 'Unlock layer' : 'Lock layer'}
            >
              {layer.locked ? '🔒' : '🔓'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
