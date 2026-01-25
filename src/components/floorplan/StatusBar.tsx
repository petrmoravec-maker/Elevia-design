import { useTheme } from '../../contexts/ThemeContext';

interface StatusBarProps {
  zoom: number;
  cursorX: number;
  cursorY: number;
  scale: string;
  selectedElement: string | null;
  onZoomChange: (zoom: number) => void;
}

export function StatusBar({
  zoom,
  cursorX,
  cursorY,
  scale,
  selectedElement,
  onZoomChange,
}: StatusBarProps) {
  const { colors } = useTheme();

  const styles = {
    container: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      backgroundColor: colors.bgPanel,
      borderTop: `1px solid ${colors.border}`,
      fontSize: '12px',
      color: colors.textSecondary,
    } as const,
    left: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    } as const,
    right: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    } as const,
    item: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    } as const,
    label: {
      color: colors.textMuted,
    } as const,
    value: {
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: '11px',
    } as const,
    zoomControl: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    } as const,
    zoomButton: {
      width: '20px',
      height: '20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      border: `1px solid ${colors.border}`,
      borderRadius: '4px',
      color: colors.textSecondary,
      fontSize: '12px',
      cursor: 'pointer',
    } as const,
    zoomValue: {
      minWidth: '50px',
      textAlign: 'center' as const,
      color: colors.text,
      fontSize: '11px',
      fontFamily: 'monospace',
    },
    separator: {
      width: '1px',
      height: '16px',
      backgroundColor: colors.border,
    } as const,
  };

  return (
    <div style={styles.container}>
      <div style={styles.left}>
        {/* Zoom control */}
        <div style={styles.zoomControl}>
          <button
            style={styles.zoomButton}
            onClick={() => onZoomChange(Math.max(25, zoom - 25))}
            title="Zoom out (Cmd+-)"
          >
            −
          </button>
          <span style={styles.zoomValue}>{zoom}%</span>
          <button
            style={styles.zoomButton}
            onClick={() => onZoomChange(Math.min(400, zoom + 25))}
            title="Zoom in (Cmd++)"
          >
            +
          </button>
        </div>

        <div style={styles.separator} />

        {/* Coordinates */}
        <div style={styles.item}>
          <span style={styles.label}>X:</span>
          <span style={styles.value}>{cursorX}</span>
        </div>
        <div style={styles.item}>
          <span style={styles.label}>Y:</span>
          <span style={styles.value}>{cursorY}</span>
        </div>
      </div>

      <div style={styles.right}>
        {/* Selected element */}
        {selectedElement && (
          <>
            <div style={styles.item}>
              <span style={styles.label}>Selected:</span>
              <span style={styles.value}>{selectedElement}</span>
            </div>
            <div style={styles.separator} />
          </>
        )}

        {/* Scale */}
        <div style={styles.item}>
          <span style={styles.label}>Scale:</span>
          <span style={styles.value}>{scale}</span>
        </div>
      </div>
    </div>
  );
}
