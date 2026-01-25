import { useTheme } from '../../contexts/ThemeContext';

interface PropertiesPanelProps {
  elementId: string;
  projectId: string;
  onClose: () => void;
}

export function PropertiesPanel({ elementId, projectId, onClose }: PropertiesPanelProps) {
  const { colors } = useTheme();

  // TODO: Load element data from Firestore based on elementId

  const styles = {
    container: {
      width: '280px',
      backgroundColor: colors.bgPanel,
      borderLeft: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column' as const,
      flexShrink: 0,
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
    closeButton: {
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '4px',
      color: colors.textSecondary,
      fontSize: '14px',
      cursor: 'pointer',
    } as const,
    content: {
      flex: 1,
      overflow: 'auto',
      padding: '16px',
    } as const,
    section: {
      marginBottom: '20px',
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
      marginBottom: '12px',
    } as const,
    label: {
      display: 'block',
      fontSize: '12px',
      color: colors.textSecondary,
      marginBottom: '4px',
    } as const,
    input: {
      width: '100%',
      padding: '8px 10px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      color: colors.text,
      fontSize: '13px',
      outline: 'none',
    } as const,
    row: {
      display: 'flex',
      gap: '8px',
    } as const,
    placeholder: {
      padding: '40px 16px',
      textAlign: 'center' as const,
      color: colors.textMuted,
      fontSize: '13px',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Properties</span>
        <button style={styles.closeButton} onClick={onClose}>×</button>
      </div>
      <div style={styles.content}>
        <div style={styles.placeholder}>
          Select an element to view its properties
        </div>

        {/* Example properties structure - will be dynamic based on element type */}
        {/*
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Position</div>
          <div style={styles.row}>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>X</label>
              <input style={styles.input} type="number" value="0" />
            </div>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Y</label>
              <input style={styles.input} type="number" value="0" />
            </div>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Details</div>
          <div style={styles.field}>
            <label style={styles.label}>Name</label>
            <input style={styles.input} type="text" value="LED Bar 630W" />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Power</label>
            <input style={styles.input} type="text" value="630W" readOnly />
          </div>
        </div>
        */}
      </div>
    </div>
  );
}
