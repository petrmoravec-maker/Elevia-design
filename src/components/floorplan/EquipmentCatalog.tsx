import { useState, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { EQUIPMENT_CATEGORIES, getEquipmentByCategory } from '../../data/equipmentLibrary';
import type { EquipmentItem } from '../../data/equipmentLibrary';

interface EquipmentCatalogProps {
  /** Called when user selects an item to place */
  onSelectEquipment: (equipmentId: string) => void;
  /** ID of equipment currently pending placement */
  pendingEquipmentId?: string | null;
  onClose?: () => void;
}

export function EquipmentCatalog({ onSelectEquipment, pendingEquipmentId, onClose }: EquipmentCatalogProps) {
  const { colors } = useTheme();
  const [activeCategory, setActiveCategory] = useState('lighting');
  const [searchQuery, setSearchQuery] = useState('');

  const items = getEquipmentByCategory(activeCategory).filter(item =>
    !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const formatSpec = (item: EquipmentItem): string => {
    const specs: string[] = [`${item.watts}W`, `${item.voltage}V`];
    if (item.btu) specs.push(`${(item.btu / 1000).toFixed(0)}k BTU`);
    if (item.ppdCapacity) specs.push(`${item.ppdCapacity} PPD`);
    if (item.ppfd) specs.push(`${item.ppfd} PPFD`);
    if (item.coverage) specs.push(`${item.coverage}m²`);
    return specs.join(' · ');
  };

  const styles = {
    panel: {
      width: '240px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column' as const,
      backgroundColor: colors.bgPanel,
      borderLeft: `1px solid ${colors.border}`,
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 14px',
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
    },
    title: {
      fontSize: '13px',
      fontWeight: 600,
      color: colors.text,
    },
    closeBtn: {
      background: 'none',
      border: 'none',
      color: colors.textMuted,
      cursor: 'pointer',
      fontSize: '16px',
      lineHeight: 1,
      padding: '2px',
    },
    searchBox: {
      padding: '8px',
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
    },
    searchInput: {
      width: '100%',
      padding: '6px 10px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      color: colors.text,
      fontSize: '12px',
      outline: 'none',
      boxSizing: 'border-box' as const,
    },
    categories: {
      display: 'flex',
      overflowX: 'auto' as const,
      gap: '4px',
      padding: '6px 8px',
      borderBottom: `1px solid ${colors.border}`,
      flexShrink: 0,
    },
    catBtn: (active: boolean) => ({
      flexShrink: 0,
      padding: '4px 8px',
      backgroundColor: active ? colors.accent : 'transparent',
      border: `1px solid ${active ? colors.accent : colors.border}`,
      borderRadius: '5px',
      color: active ? 'white' : colors.textSecondary,
      fontSize: '11px',
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
    }),
    itemList: {
      flex: 1,
      overflowY: 'auto' as const,
    },
    item: (isActive: boolean) => ({
      padding: '10px 14px',
      borderBottom: `1px solid ${colors.border}`,
      cursor: 'pointer',
      backgroundColor: isActive ? `${colors.accent}18` : 'transparent',
      borderLeft: `3px solid ${isActive ? colors.accent : 'transparent'}`,
      transition: 'all 0.15s',
    }),
    itemName: {
      fontSize: '12px',
      fontWeight: 500,
      color: colors.text,
      marginBottom: '2px',
    },
    itemSpec: {
      fontSize: '11px',
      color: colors.textMuted,
    },
    itemBadges: {
      display: 'flex',
      gap: '4px',
      marginTop: '4px',
    },
    badge: (color: string) => ({
      padding: '1px 5px',
      borderRadius: '3px',
      fontSize: '10px',
      backgroundColor: `${color}20`,
      color,
    }),
    hint: {
      padding: '12px 14px',
      fontSize: '11px',
      color: colors.textMuted,
      backgroundColor: `${colors.accent}10`,
      borderTop: `1px solid ${colors.border}`,
      flexShrink: 0,
    },
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Equipment Catalog</span>
        {onClose && (
          <button style={styles.closeBtn} onClick={onClose} title="Close catalog">×</button>
        )}
      </div>

      <div style={styles.searchBox}>
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search equipment..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      <div style={styles.categories}>
        {EQUIPMENT_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            style={styles.catBtn(activeCategory === cat.id)}
            onClick={() => setActiveCategory(cat.id)}
            title={cat.name}
          >
            {cat.icon}
          </button>
        ))}
      </div>

      <div style={styles.itemList}>
        {items.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: colors.textMuted, fontSize: '12px' }}>
            No items found
          </div>
        )}
        {items.map(item => (
          <div
            key={item.id}
            style={styles.item(pendingEquipmentId === item.id)}
            onClick={() => onSelectEquipment(item.id)}
            title={`Click to place: ${item.name}`}
          >
            <div style={styles.itemName}>{item.name}</div>
            <div style={styles.itemSpec}>{formatSpec(item)}</div>
            <div style={styles.itemBadges}>
              {item.drain && <span style={styles.badge('#3B82F6')}>drain</span>}
              {item.water && <span style={styles.badge('#06B6D4')}>water</span>}
              {item.voltage === 240 && <span style={styles.badge('#F59E0B')}>240V</span>}
            </div>
          </div>
        ))}
      </div>

      {pendingEquipmentId && (
        <div style={styles.hint}>
          Click canvas to place · R to rotate · Esc to cancel
        </div>
      )}
    </div>
  );
}
