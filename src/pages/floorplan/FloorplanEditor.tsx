import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

// Components
import { Toolbar } from '../../components/floorplan/Toolbar';
import { Canvas } from '../../components/floorplan/Canvas';
import { LayerPanel } from '../../components/floorplan/LayerPanel';
import { PropertiesPanel } from '../../components/floorplan/PropertiesPanel';
import { AiCommandBar } from '../../components/floorplan/AiCommandBar';
import { StatusBar } from '../../components/floorplan/StatusBar';

// Services
import { parseDxfFile, type ParsedDxf } from '../../services/dxfParser';

export type EditorTool = 'select' | 'pan' | 'measure' | 'room' | 'equipment' | 'electrical' | 'plumbing';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  cursorX: number;
  cursorY: number;
}

interface Project {
  id: string;
  name: string;
  scale: string;
  status: string;
  sourceFile?: string;
  sourceFileUrl?: string;
}

const DEFAULT_LAYERS: Layer[] = [
  { id: 'arch', name: 'Architecture', visible: true, locked: false, color: '#a1a1a1' },
  { id: 'rooms', name: 'Rooms', visible: true, locked: false, color: '#6366f1' },
  { id: 'equip', name: 'Equipment', visible: true, locked: false, color: '#10b981' },
  { id: 'elec', name: 'Electrical', visible: true, locked: false, color: '#f59e0b' },
  { id: 'plumb', name: 'Plumbing', visible: true, locked: false, color: '#3b82f6' },
  { id: 'drain', name: 'Drainage', visible: true, locked: false, color: '#8b5cf6' },
  { id: 'notes', name: 'Notes', visible: true, locked: false, color: '#ec4899' },
];

export function FloorplanEditor() {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentUser } = useAuth();
  const { colors } = useTheme();
  const navigate = useNavigate();

  // Project state
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dxfData, setDxfData] = useState<ParsedDxf | null>(null);
  const [loadingDxf, setLoadingDxf] = useState(false);

  // Editor state
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [layers, setLayers] = useState<Layer[]>(DEFAULT_LAYERS);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasState>({
    zoom: 100,
    panX: 0,
    panY: 0,
    cursorX: 0,
    cursorY: 0,
  });

  // Panel visibility
  const [showLayers, setShowLayers] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  // Load project
  useEffect(() => {
    if (!projectId || !currentUser) return;
    loadProject();
  }, [projectId, currentUser]);

  const loadProject = async () => {
    if (!projectId) return;
    
    try {
      const docRef = doc(db, 'design_projects', projectId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        setProject({
          id: docSnap.id,
          name: data.name,
          scale: data.scale || '1:100',
          status: data.status || 'draft',
          sourceFile: data.sourceFile,
          sourceFileUrl: data.sourceFileUrl,
        });
        
        // Load DXF file if available
        if (data.sourceFileUrl && data.sourceFile?.endsWith('.dxf')) {
          loadDxfFile(data.sourceFileUrl);
        }
      } else {
        navigate('/floorplan');
      }
    } catch (error) {
      console.error('Error loading project:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const loadDxfFile = async (url: string) => {
    setLoadingDxf(true);
    try {
      console.log('Loading DXF from:', url);
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], 'drawing.dxf', { type: 'application/dxf' });
      
      const parsed = await parseDxfFile(file);
      console.log('Parsed DXF:', parsed);
      setDxfData(parsed);
      
      // Update layers from DXF
      if (parsed.layers.length > 0) {
        const dxfLayers = parsed.layers.map(l => ({
          id: l.name,
          name: l.name,
          visible: l.visible,
          locked: false,
          color: `#${l.color.toString(16).padStart(6, '0')}`,
        }));
        setLayers(prev => [...prev, ...dxfLayers.filter(dl => !prev.find(p => p.name === dl.name))]);
      }
    } catch (error) {
      console.error('Error loading DXF:', error);
    } finally {
      setLoadingDxf(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'h':
          setActiveTool('pan');
          break;
        case 'm':
          setActiveTool('measure');
          break;
        case 'r':
          setActiveTool('room');
          break;
        case 'e':
          setActiveTool('equipment');
          break;
        case '/':
          e.preventDefault();
          document.getElementById('ai-command-input')?.focus();
          break;
        case 'escape':
          setSelectedElement(null);
          setActiveTool('select');
          break;
        case 'delete':
        case 'backspace':
          if (selectedElement) {
            // TODO: Delete selected element
            setSelectedElement(null);
          }
          break;
      }

      // Zoom shortcuts
      if (e.key === '=' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom + 25, 400) }));
      }
      if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom - 25, 25) }));
      }
      if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCanvasState(prev => ({ ...prev, zoom: 100, panX: 0, panY: 0 }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement]);

  const handleLayerToggle = (layerId: string) => {
    setLayers(prev => prev.map(l => 
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ));
  };

  const handleLayerLock = (layerId: string) => {
    setLayers(prev => prev.map(l => 
      l.id === layerId ? { ...l, locked: !l.locked } : l
    ));
  };

  const styles = {
    container: {
      height: '100vh',
      display: 'flex',
      flexDirection: 'column' as const,
      backgroundColor: colors.bg,
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 16px',
      backgroundColor: colors.bgPanel,
      borderBottom: `1px solid ${colors.border}`,
      height: '48px',
      flexShrink: 0,
    } as const,
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    } as const,
    backButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: colors.textSecondary,
      fontSize: '16px',
      cursor: 'pointer',
    } as const,
    projectName: {
      fontSize: '14px',
      fontWeight: 600,
      color: colors.text,
    } as const,
    saveStatus: {
      fontSize: '12px',
      color: colors.textMuted,
    } as const,
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as const,
    iconButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '6px',
      color: colors.textSecondary,
      fontSize: '16px',
      cursor: 'pointer',
    } as const,
    main: {
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
    } as const,
    canvasContainer: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      overflow: 'hidden',
    },
    toolbarContainer: {
      padding: '8px 16px',
      backgroundColor: colors.bgPanel,
      borderBottom: `1px solid ${colors.border}`,
    } as const,
    canvasWrapper: {
      flex: 1,
      position: 'relative' as const,
      overflow: 'hidden',
    },
    bottomBar: {
      display: 'flex',
      flexDirection: 'column' as const,
      backgroundColor: colors.bgPanel,
      borderTop: `1px solid ${colors.border}`,
    },
    loadingOverlay: {
      position: 'absolute' as const,
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingOverlay}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: `3px solid ${colors.border}`,
              borderTopColor: colors.accent,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ color: colors.textSecondary }}>Loading project...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.backButton} onClick={() => navigate('/floorplan')}>
            ←
          </button>
          <span style={styles.projectName}>{project?.name}</span>
          <span style={styles.saveStatus}>
            {saving ? 'Saving...' : 'All changes saved'}
          </span>
        </div>
        <div style={styles.headerRight}>
          <button 
            style={{
              ...styles.iconButton,
              backgroundColor: showLayers ? colors.bgActive : 'transparent',
            }}
            onClick={() => setShowLayers(!showLayers)}
            title="Toggle Layers (L)"
          >
            ☰
          </button>
          <button 
            style={{
              ...styles.iconButton,
              backgroundColor: showProperties ? colors.bgActive : 'transparent',
            }}
            onClick={() => setShowProperties(!showProperties)}
            title="Toggle Properties"
          >
            ⚙
          </button>
        </div>
      </header>

      <main style={styles.main}>
        {/* Left Panel - Layers */}
        {showLayers && (
          <LayerPanel
            layers={layers}
            onToggleVisibility={handleLayerToggle}
            onToggleLock={handleLayerLock}
          />
        )}

        {/* Center - Canvas */}
        <div style={styles.canvasContainer}>
          {/* Toolbar */}
          <div style={styles.toolbarContainer}>
            <Toolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
            />
          </div>

          {/* Canvas */}
          <div style={styles.canvasWrapper}>
            {loadingDxf && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.5)',
                zIndex: 10,
              }}>
                <div style={{ color: '#fff' }}>Loading DXF file...</div>
              </div>
            )}
            <Canvas
              projectId={projectId!}
              activeTool={activeTool}
              layers={layers}
              canvasState={canvasState}
              onCanvasStateChange={setCanvasState}
              selectedElement={selectedElement}
              onSelectElement={setSelectedElement}
              dxfData={dxfData}
            />
          </div>

          {/* Bottom - Command Bar + Status */}
          <div style={styles.bottomBar}>
            <AiCommandBar projectId={projectId!} />
            <StatusBar
              zoom={canvasState.zoom}
              cursorX={canvasState.cursorX}
              cursorY={canvasState.cursorY}
              scale={project?.scale || '1:100'}
              selectedElement={selectedElement}
              onZoomChange={(zoom) => setCanvasState(prev => ({ ...prev, zoom }))}
            />
          </div>
        </div>

        {/* Right Panel - Properties */}
        {showProperties && selectedElement && (
          <PropertiesPanel
            elementId={selectedElement}
            projectId={projectId!}
            onClose={() => setShowProperties(false)}
          />
        )}
      </main>
    </div>
  );
}
