/**
 * Floorplan editor shell.
 *
 * Layout: header (title, search, panel toggles) / left layer tree / centre canvas with a
 * floating vertical toolbar / right inspector or properties / bottom status bar. Works for
 * personal projects and for the shared facility plan (design_projects/FACILITY) seeded from
 * facility-design, which adds a world-aligned guide DXF, generated existing-* layers,
 * dimensions in mm and the drawing legends.
 */

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import {
  ArrowLeft, Layers as LayersIcon, Info, BookOpen, Sparkles, Wrench, Sun, Moon, Search, Lock, Users, Boxes, Camera,
} from 'lucide-react';
import { storage } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

// Components
import { Toolbar } from '../../components/floorplan/Toolbar';
import { Canvas, MIN_ZOOM, MAX_ZOOM } from '../../components/floorplan/Canvas';
import { LayerPanel, type UILayer, type UILayerGroup, type LayerPreset } from '../../components/floorplan/LayerPanel';
import { InspectorPanel } from '../../components/floorplan/InspectorPanel';
import { PropertiesPanel } from '../../components/floorplan/PropertiesPanel';
import { LegendDrawer } from '../../components/floorplan/LegendDrawer';
import { HoverCard } from '../../components/floorplan/HoverCard';
import { AiCommandBar } from '../../components/floorplan/AiCommandBar';
import { StatusBar } from '../../components/floorplan/StatusBar';
import { EquipmentCatalog } from '../../components/floorplan/EquipmentCatalog';
import { RoomTypePicker } from '../../components/floorplan/RoomTypePicker';
import { IconButton, Chip, TextButton } from '../../components/floorplan/ui';
import { InventoryDrawer } from '../../components/floorplan/InventoryDrawer';
import type { FacilitySceneHandle, CameraPreset } from '../../components/floorplan/three/FacilityScene';
const FacilityScene = lazy(() => import('../../components/floorplan/three/FacilityScene').then(m => ({ default: m.FacilityScene })));

// Services
import { parseDxfFile, getColorFromAci, type ParsedDxf } from '../../services/dxfParser';
import { parseDwgFile } from '../../services/dwgParser';
import { initPersistence, stopPersistence } from '../../services/floorplanPersistence';
import { loadDesignProject, canEditProject, type DesignProject, type GuideLayerMeta } from '../../services/designProject';
import { isLocalProject, loadLocalProject, LOCAL_PROJECT_ID } from '../../services/localProject';
import { computeRoomScope, bboxOf } from '../../services/roomScope';
import { useInventoryStore, suggestEquipmentId, bindingKey, type LabDevice } from '../../services/labInventory';
import { getEquipmentById, equipmentFootprint } from '../../data/equipmentLibrary';

// Store
import { useFloorplanStore, type EditorTool } from '../../stores/useFloorplanStore';
import type { RoomEntity, FloorplanEntity, EquipmentEntity, EquipmentBinding, Point2D } from '../../types/floorplan';
import { ROOM_TYPES } from '../../data/roomTypes';
import { PIXELS_PER_METER } from '../../types/floorplan';

// Guide (DXF) layer as shown in the tree and consumed by the canvas
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
  meta?: GuideLayerMeta;
}

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  cursorX: number;
  cursorY: number;
}

type LoadState = 'loading' | 'ready' | 'missing' | 'denied' | 'error';

const PRESETS: LayerPreset[] = [
  { id: 'overview', name: 'Overview', hint: 'Rooms, walls, doors, equipment - no dimensions or drawings' },
  { id: 'dimensions', name: 'Dimensions', hint: 'Rooms, walls, doors and every dimension string in mm' },
  { id: 'fitout', name: 'Fit-out', hint: 'Tables, lighting rows and equipment with the coordination drawing' },
  { id: 'hvac', name: 'HVAC', hint: 'HVAC units, duct routes and the D.1.4.5 duct drawing' },
  { id: 'electrical', name: 'Electrical', hint: 'Cable trays, circuits, water / drain routes and equipment' },
  { id: 'expansion', name: 'Expansion', hint: 'Existing shell with everything from model/expansion.yaml (red, dashed)' },
  { id: 'drawings', name: 'Drawings', hint: 'All source drawings with the room outlines' },
  { id: 'model', name: 'Model only', hint: 'Everything generated from the model, no drawings' },
  { id: 'all', name: 'Everything' },
];

const GROUP_ORDER = ['Existing - architecture', 'Existing - dimensions', 'Existing - fit-out', 'Existing - HVAC', 'Existing - electrical', 'Expansion', 'Design'];

export function FloorplanEditor() {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  // /floorplan/local (dev only) has no :projectId param
  const projectId = routeProjectId ?? (import.meta.env.DEV && location.pathname.endsWith('/floorplan/local') ? LOCAL_PROJECT_ID : undefined);
  const { currentUser, hasPermission, loading: authLoading } = useAuth();
  const { colors, theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Project
  const [project, setProject] = useState<DesignProject | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const readOnly = useFloorplanStore(s => s.readOnly);

  // Guide drawing
  const [dxfData, setDxfData] = useState<ParsedDxf | null>(null);
  const [loadingDxf, setLoadingDxf] = useState(false);
  const [dxfError, setDxfError] = useState('');
  const [guideLayers, setGuideLayers] = useState<Layer[]>([]);
  const [guideOpacity, setGuideOpacity] = useState(() => {
    const v = parseFloat(localStorage.getItem('elevia-design-guide-opacity') ?? '');
    return isFinite(v) ? v : 0.55;
  });
  useEffect(() => { localStorage.setItem('elevia-design-guide-opacity', String(guideOpacity)); }, [guideOpacity]);

  // View
  const [canvasState, setCanvasState] = useState<CanvasState>({ zoom: 100, panX: 0, panY: 0, cursorX: 0, cursorY: 0 });
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveToolLocal] = useState<EditorTool>('select');
  const [showLayers, setShowLayers] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showEquipmentCatalog, setShowEquipmentCatalog] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Selection / hover / scope
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [scopeRoomId, setScopeRoomId] = useState<string | null>(null);
  const [pendingEquipmentId, setPendingEquipmentId] = useState<string | null>(null);
  const [pendingBinding, setPendingBinding] = useState<EquipmentBinding | null>(null);
  const [pendingDimensions, setPendingDimensions] = useState<Point2D | null>(null);
  const [roomTypePicker, setRoomTypePicker] = useState<{ entityId: string } | null>(null);

  // Inventory (Phase 2) + 3D (Phase 4)
  const [showInventory, setShowInventory] = useState(false);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const sceneRef = useRef<FacilitySceneHandle>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [clock, setClock] = useState(0);
  const labDevices = useInventoryStore(s => s.devices);
  const labRooms = useInventoryStore(s => s.rooms);
  useEffect(() => { const t = setInterval(() => setClock(c => c + 1), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!currentUser) return;
    useInventoryStore.getState().start();
    return () => useInventoryStore.getState().stop();
  }, [currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store
  const setActiveTool = useFloorplanStore(s => s.setActiveTool);
  const updateEntity = useFloorplanStore(s => s.updateEntity);
  const sceneLayers = useFloorplanStore(s => s.layers);
  const setLayersVisible = useFloorplanStore(s => s.setLayersVisible);
  const entities = useFloorplanStore(s => s.entities);
  const snapToGrid = useFloorplanStore(s => s.snapToGrid);
  const setSnapToGrid = useFloorplanStore(s => s.setSnapToGrid);
  const canEdit = useFloorplanStore(s => s.canEdit);
  const entityCount = Object.keys(entities).length;

  // ─── Load project ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!projectId) return;
    const local = isLocalProject(projectId);
    if (!local && (authLoading || !currentUser)) return;
    let cancelled = false;
    setLoadState('loading');
    (async () => {
      try {
        if (local) {
          // Dev preview straight from facility-design/build.py outputs (no Firebase).
          const bundle = await loadLocalProject();
          if (cancelled) return;
          setProject(bundle.project);
          useFloorplanStore.getState().setReadOnly(false);
          useFloorplanStore.getState().loadScene(bundle.entities as Record<string, FloorplanEntity>, bundle.project.sceneLayers);
          setLoadState('ready');
          void loadGuide(null, 'facility_guide.dxf', bundle.project.guide?.layers ?? [], bundle.guideUrl);
          return;
        }
        const p = await loadDesignProject(projectId);
        if (cancelled) return;
        if (!p) { setLoadState('missing'); return; }
        setProject(p);
        const editable = canEditProject(p, currentUser?.uid, hasPermission);
        useFloorplanStore.getState().setReadOnly(!editable);
        await initPersistence(projectId);
        if (cancelled) return;
        setLoadState('ready');
        // Guide drawing (world-aligned seed) or legacy imported CAD file
        if (p.guide) {
          void loadGuide(p.guide.storagePath, p.guide.fileName, p.guide.layers);
        } else if (p.sourceFileUrl && p.sourceFile && /\.(dxf|dwg)$/i.test(p.sourceFile)) {
          void loadGuide(null, p.sourceFile, [], p.sourceFileUrl);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('Error loading project:', err);
        if (err?.code === 'permission-denied') setLoadState('denied');
        else { setLoadError(err?.message ?? String(err)); setLoadState('error'); }
      }
    })();
    return () => { cancelled = true; stopPersistence(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, authLoading, currentUser?.uid]);

  const loadGuide = async (path: string | null, fileName: string, meta: GuideLayerMeta[], directUrl?: string) => {
    setLoadingDxf(true);
    setDxfError('');
    try {
      const url = directUrl ?? await getDownloadURL(storageRef(storage, path!));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: 'application/octet-stream' });
      const parsed = fileName.toLowerCase().endsWith('.dwg') ? await parseDwgFile(file) : await parseDxfFile(file);
      setDxfData(parsed);
      const metaByName = new Map(meta.map(m => [m.name.toLowerCase(), m]));
      const used = new Set(parsed.entities.map(e => e.layer.toLowerCase()));
      setGuideLayers(parsed.layers
        .filter(l => used.has(l.name.toLowerCase()))
        .map(l => {
          const m = metaByName.get(l.name.toLowerCase());
          return {
            id: l.name,
            name: m?.label ?? l.name.replace(/^GUIDE_/, '').replace(/_/g, ' '),
            visible: m ? m.visible : l.visible,
            locked: true,
            color: getColorFromAci(Math.abs(m?.aci ?? l.color)),
            meta: m,
          };
        })
        .sort((a, b) => (a.meta?.group ?? 'zz').localeCompare(b.meta?.group ?? 'zz') || a.name.localeCompare(b.name)));
    } catch (error: any) {
      console.error('Error loading guide drawing:', error);
      setDxfError(error?.message ?? 'Could not load the guide drawing');
    } finally {
      setLoadingDxf(false);
    }
  };

  // ─── View helpers ──────────────────────────────────────────────────────────

  const zoomToBbox = useCallback((b: { minX: number; minY: number; maxX: number; maxY: number }, padPx = 60) => {
    const el = canvasWrapperRef.current;
    const W = el?.clientWidth ?? window.innerWidth - 640;
    const H = el?.clientHeight ?? window.innerHeight - 120;
    const bw = Math.max(0.5, b.maxX - b.minX);
    const bh = Math.max(0.5, b.maxY - b.minY);
    const ppm = Math.min((W - 2 * padPx) / bw, (H - 2 * padPx) / bh);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (ppm / PIXELS_PER_METER) * 100));
    const ppmZ = PIXELS_PER_METER * (zoom / 100);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    setCanvasState(prev => ({ ...prev, zoom, panX: -(cx * ppmZ), panY: cy * ppmZ }));
  }, []);

  const handleZoomToFit = useCallback(() => {
    const all = Object.values(useFloorplanStore.getState().entities);
    const layerVis = new Map(useFloorplanStore.getState().layers.map(l => [l.id, l.visible]));
    const visible = all.filter(e => e.visible && (layerVis.get(e.layer) ?? true) && (!scopeRoomId || computeRoomScope(useFloorplanStore.getState().entities, scopeRoomId).has(e.id)));
    // rooms + walls + visible dimension strings (envelope dims sit ~1-2 m outside the walls)
    let b = bboxOf(visible.filter(e => e.type === 'room' || e.type === 'wall' || (e.type === 'measure' && e.style === 'dimension')), 0.5) ?? bboxOf(visible, 0.6);
    if (!b && dxfData) {
      b = project?.guide?.worldAligned
        ? { minX: dxfData.bounds.minX, minY: dxfData.bounds.minY, maxX: dxfData.bounds.maxX, maxY: dxfData.bounds.maxY }
        : { minX: -(dxfData.bounds.maxX - dxfData.bounds.minX) / 2, maxX: (dxfData.bounds.maxX - dxfData.bounds.minX) / 2, minY: -(dxfData.bounds.maxY - dxfData.bounds.minY) / 2, maxY: (dxfData.bounds.maxY - dxfData.bounds.minY) / 2 };
    }
    if (!b) { setCanvasState(prev => ({ ...prev, zoom: 100, panX: 0, panY: 0 })); return; }
    zoomToBbox(b);
  }, [dxfData, project, scopeRoomId, zoomToBbox]);

  const zoomToEntity = useCallback((id: string) => {
    const e = useFloorplanStore.getState().entities[id];
    if (!e) return;
    if (view === '3d') { sceneRef.current?.zoomTo(id); return; }
    const b = bboxOf([e], e.type === 'room' ? 1.2 : 0.8);
    if (b) zoomToBbox(b, 40);
  }, [zoomToBbox, view]);


  // Initial fit once the scene arrives; honour ?focus=
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (loadState !== 'ready' || didInitialFit.current) return;
    if (entityCount === 0 && !dxfData) return;
    didInitialFit.current = true;
    const focus = searchParams.get('focus');
    const target = focus ? resolveFocus(focus, useFloorplanStore.getState().entities) : null;
    // wait a frame so the canvas wrapper has its size
    requestAnimationFrame(() => {
      if (target) {
        useFloorplanStore.getState().selectEntity(target);
        setSelectedElement(target);
        zoomToEntity(target);
      } else {
        handleZoomToFit();
      }
    });
  }, [loadState, entityCount, dxfData, searchParams, handleZoomToFit, zoomToEntity]);

  // ─── Tools / selection ─────────────────────────────────────────────────────

  const handleToolChange = useCallback((tool: EditorTool, opts?: { catalog?: boolean }) => {
    if (readOnly && !['select', 'pan', 'measure'].includes(tool)) return;
    setActiveToolLocal(tool);
    setActiveTool(tool);
    if (tool === 'equipment') { if (opts?.catalog !== false) setShowEquipmentCatalog(true); }
    else if (tool !== 'select') { setShowEquipmentCatalog(false); setPendingEquipmentId(null); setPendingBinding(null); setPendingDimensions(null); }
    if (tool !== 'select') setHover(null);
  }, [setActiveTool, readOnly]);

  // Inventory actions
  const armPlacement = useCallback((dev: LabDevice) => {
    const eqId = suggestEquipmentId(dev);
    const def = getEquipmentById(eqId);
    const t = `${dev.name} ${dev.detail ?? ''} ${dev.model ?? ''}`.toLowerCase();
    const ds = project?.facility?.construction?.datasheets;
    const dims: Point2D = /quest/.test(t) && ds?.quest_155 ? [ds.quest_155.w, ds.quest_155.d]
      : /sinclair|asd-/.test(t) && ds?.sinclair_asd_60bi2 ? [ds.sinclair_asd_60bi2.w, ds.sinclair_asd_60bi2.d]
      : equipmentFootprint(def?.category);
    setPendingEquipmentId(eqId);
    setPendingBinding({ collection: dev.collection, docId: dev.id, name: dev.name });
    setPendingDimensions(dims);
    setShowEquipmentCatalog(false);
    if (view === '3d') setView('2d');
    handleToolChange('equipment', { catalog: false });
    setStatusMessage(`Click on the plan to place "${dev.name}" - Esc to cancel`);
  }, [project, view, handleToolChange]);

  const clearPending = useCallback(() => {
    setPendingEquipmentId(null); setPendingBinding(null); setPendingDimensions(null);
    setStatusMessage('');
  }, []);

  const bindSelected = useCallback((dev: LabDevice) => {
    if (!selectedElement) return;
    updateEntity(selectedElement, { binding: { collection: dev.collection, docId: dev.id, name: dev.name } } as Partial<EquipmentEntity>);
    setStatusMessage(`Bound to ${dev.name}`);
  }, [selectedElement, updateEntity]);

  const exportPng = useCallback(() => {
    const url = sceneRef.current?.snapshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = `${(project?.name ?? 'facility').replace(/[^\w.-]+/g, '_')}_3d.png`; a.click();
  }, [project]);

  const handleSelectElement = useCallback((id: string | null) => {
    setSelectedElement(id);
    if (id) {
      setShowInspector(true);
      const next = new URLSearchParams(searchParams);
      next.set('focus', id);
      setSearchParams(next, { replace: true });
    } else if (searchParams.has('focus')) {
      const next = new URLSearchParams(searchParams);
      next.delete('focus');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const selectAndShow = useCallback((id: string | null) => {
    useFloorplanStore.getState().selectEntity(id);
    handleSelectElement(id);
  }, [handleSelectElement]);

  const handleActivateEntity = useCallback((id: string) => {
    selectAndShow(id);
    zoomToEntity(id);
  }, [selectAndShow, zoomToEntity]);

  const handleScopeRoom = useCallback((id: string | null) => {
    setScopeRoomId(id);
    setHover(null);
    if (id) {
      selectAndShow(id);
      requestAnimationFrame(() => zoomToEntity(id));
      const r = useFloorplanStore.getState().entities[id] as RoomEntity | undefined;
      setStatusMessage(r ? `Showing only ${r.name} - Esc to clear` : '');
    } else {
      setStatusMessage('');
    }
  }, [selectAndShow, zoomToEntity]);

  const scope = useMemo(() => (scopeRoomId ? computeRoomScope(entities, scopeRoomId) : null), [entities, scopeRoomId]);

  // Room complete -> type picker
  const handleRoomComplete = useCallback((entityId: string) => {
    setRoomTypePicker({ entityId });
    handleToolChange('select');
  }, [handleToolChange]);

  const handleRoomTypeSelected = useCallback((roomTypeId: string) => {
    if (!roomTypePicker) return;
    const { entityId } = roomTypePicker;
    const store = useFloorplanStore.getState();
    const entity = store.entities[entityId] as RoomEntity;
    if (entity) {
      const rt = ROOM_TYPES.find(r => r.id === roomTypeId);
      updateEntity(entityId, {
        roomTypeId,
        name: rt ? `${rt.name} ${Object.values(store.entities).filter(e => e.type === 'room').length}` : entity.name,
      } as Partial<RoomEntity>);
    }
    setRoomTypePicker(null);
    selectAndShow(entityId);
  }, [roomTypePicker, updateEntity, selectAndShow]);

  // ─── Layer tree ────────────────────────────────────────────────────────────

  const layerCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of Object.values(entities)) c.set(e.layer, (c.get(e.layer) ?? 0) + 1);
    return c;
  }, [entities]);

  const layerGroups: UILayerGroup[] = useMemo(() => {
    const groups = new Map<string, UILayerGroup>();
    const add = (groupName: string, layer: UILayer) => {
      let g = groups.get(groupName);
      if (!g) { g = { id: groupName, name: groupName, layers: [] }; groups.set(groupName, g); }
      g.layers.push(layer);
    };
    for (const l of sceneLayers) {
      const count = layerCounts.get(l.id) ?? 0;
      if (count === 0 && l.id.startsWith('existing-')) continue;
      add(l.group ?? 'Design', { id: l.id, name: l.name, visible: l.visible, locked: l.locked, color: l.color, count, source: 'scene' });
    }
    for (const l of guideLayers) {
      add(`Drawings - ${l.meta?.group ?? 'other'}`, {
        id: l.id, name: l.name, visible: l.visible, locked: true, color: l.color, count: l.meta?.count, source: 'guide', tag: l.meta?.source,
      });
    }
    return [...groups.values()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a.name), ib = GROUP_ORDER.indexOf(b.name);
      const ka = ia < 0 ? 100 : ia, kb = ib < 0 ? 100 : ib;
      return ka - kb || a.name.localeCompare(b.name);
    });
  }, [sceneLayers, guideLayers, layerCounts]);

  const setGuideVisible = useCallback((pred: (l: Layer) => boolean, visible: boolean) => {
    setGuideLayers(prev => prev.map(l => (pred(l) ? { ...l, visible } : l)));
  }, []);

  const handleToggleLayer = useCallback((l: UILayer) => {
    if (l.source === 'guide') setGuideVisible(g => g.id === l.id, !l.visible);
    else setLayersVisible([l.id], !l.visible);
  }, [setGuideVisible, setLayersVisible]);

  const handleSoloLayer = useCallback((l: UILayer) => {
    setLayersVisible(sceneLayers.map(s => s.id), false);
    setGuideVisible(() => true, false);
    if (l.source === 'guide') setGuideVisible(g => g.id === l.id, true);
    else setLayersVisible([l.id], true);
  }, [sceneLayers, setGuideVisible, setLayersVisible]);

  const handleSetGroupVisible = useCallback((g: UILayerGroup, visible: boolean) => {
    const sceneIds = g.layers.filter(l => l.source === 'scene').map(l => l.id);
    const guideIds = new Set(g.layers.filter(l => l.source === 'guide').map(l => l.id));
    if (sceneIds.length) setLayersVisible(sceneIds, visible);
    if (guideIds.size) setGuideVisible(l => guideIds.has(l.id), visible);
  }, [setGuideVisible, setLayersVisible]);

  const handleSetAllVisible = useCallback((visible: boolean) => {
    setLayersVisible(sceneLayers.map(s => s.id), visible);
    setGuideVisible(() => true, visible);
  }, [sceneLayers, setGuideVisible, setLayersVisible]);

  const applyPreset = useCallback((id: string) => {
    const scene = (on: string[] | 'all' | 'none') => {
      const all = sceneLayers.map(s => s.id);
      const designIds = all.filter(x => !x.startsWith('existing-'));
      if (on === 'all') { setLayersVisible(all, true); return; }
      if (on === 'none') { setLayersVisible(all, false); setLayersVisible(designIds, true); return; }
      setLayersVisible(all, false);
      setLayersVisible([...on, ...designIds], true);
    };
    const guide = (groups: string[] | 'all' | 'none') => {
      if (groups === 'all') { setGuideVisible(() => true, true); return; }
      if (groups === 'none') { setGuideVisible(() => true, false); return; }
      setGuideVisible(() => true, false);
      setGuideVisible(l => groups.includes(l.meta?.group ?? '') || groups.includes(l.meta?.source ?? ''), true);
    };
    switch (id) {
      case 'overview': scene(['existing-rooms', 'existing-walls', 'existing-doors', 'existing-equipment', 'existing-hvac']); guide('none'); break;
      case 'dimensions': scene(['existing-rooms', 'existing-walls', 'existing-doors', 'existing-dimensions']); guide('none'); break;
      case 'fitout': scene(['existing-rooms', 'existing-walls', 'existing-doors', 'existing-tables', 'existing-lighting', 'existing-equipment']); guide(['KOORD']); break;
      case 'hvac': scene(['existing-rooms', 'existing-walls', 'existing-doors', 'existing-hvac', 'existing-notes', 'existing-ducts', 'expansion-rooms', 'expansion-walls', 'expansion-hvac', 'expansion-ducts']); guide(['HVAC']); break;
      case 'electrical': scene(['existing-rooms', 'existing-walls', 'existing-doors', 'existing-electrical', 'existing-equipment', 'expansion-rooms', 'expansion-walls', 'expansion-electrical', 'expansion-equipment']); guide('none'); break;
      case 'expansion': scene(['existing-rooms', 'existing-walls', 'existing-doors', ...sceneLayers.map(l => l.id).filter(id => id.startsWith('expansion-'))]); guide('none'); break;
      case 'drawings': scene(['existing-rooms', 'existing-doors']); guide('all'); break;
      case 'model': scene('all'); guide('none'); break;
      case 'all': default: scene('all'); guide('all'); break;
    }
    setStatusMessage(`Preset: ${PRESETS.find(p => p.id === id)?.name ?? id}`);
  }, [sceneLayers, setGuideVisible, setLayersVisible]);

  const rooms = useMemo(
    () => (Object.values(entities).filter(e => e.type === 'room') as RoomEntity[])
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(r => ({ id: r.id, label: r.name })),
    [entities],
  );

  const visibleCount = useMemo(() => {
    const vis = new Map(sceneLayers.map(l => [l.id, l.visible]));
    return Object.values(entities).filter(e => e.visible && (vis.get(e.layer) ?? true) && (!scope || scope.has(e.id))).length;
  }, [entities, sceneLayers, scope]);

  // ─── Search ────────────────────────────────────────────────────────────────

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as { id: string; label: string; sub: string }[];
    const out: { id: string; label: string; sub: string }[] = [];
    for (const e of Object.values(entities)) {
      if (e.type === 'room') {
        const r = e as RoomEntity;
        if (r.name.toLowerCase().includes(q) || String(r.meta?.description ?? '').toLowerCase().includes(q)) out.push({ id: r.id, label: r.name, sub: `room · ${r.area.toFixed(1)} m²` });
      } else if (e.type === 'equipment') {
        const q2 = e as FloorplanEntity & { equipmentId: string; binding?: { name?: string } | null };
        const label = q2.binding?.name ?? q2.equipmentId;
        if (label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)) out.push({ id: e.id, label, sub: 'equipment' });
      } else if (e.type === 'door') {
        const code = String(e.meta?.code ?? '');
        if (code.toLowerCase().includes(q)) out.push({ id: e.id, label: `Door ${code}`, sub: `${e.meta?.from ?? ''} → ${e.meta?.to ?? ''}` });
      }
      if (out.length >= 12) break;
    }
    // Lab inventory: bound devices jump to their symbol, unplaced ones arm placement
    const placed = new Map<string, string>();
    for (const e of Object.values(entities)) if (e.type === 'equipment' && (e as EquipmentEntity).binding) placed.set(bindingKey((e as EquipmentEntity).binding!), e.id);
    for (const d of Object.values(labDevices)) {
      if (out.length >= 16) break;
      if (!`${d.name} ${d.detail ?? ''} ${d.roomName ?? ''} ${d.serialNumber ?? ''} ${d.ipAddress ?? ''}`.toLowerCase().includes(q)) continue;
      const key = bindingKey({ collection: d.collection, docId: d.id });
      const eid = placed.get(key);
      if (eid && out.some(o => o.id === eid)) continue;
      out.push({ id: eid ?? `lab:${key}`, label: d.name, sub: eid ? `${d.roomName ?? 'device'} · on plan` : `${d.roomName ?? 'device'} · not placed` });
    }
    return out;
  }, [entities, search, labDevices]);

  const activateSearchResult = useCallback((id: string) => {
    if (id.startsWith('lab:')) {
      const dev = labDevices[id.slice(4)];
      if (!dev) return;
      if (readOnly) { setShowInventory(true); setShowLayers(false); return; }
      armPlacement(dev);
      return;
    }
    handleActivateEntity(id);
  }, [labDevices, readOnly, armPlacement, handleActivateEntity]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) {
        if (e.key === 'Escape') { (t as HTMLElement).blur(); setSearchOpen(false); }
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); setCanvasState(p => ({ ...p, zoom: Math.min(MAX_ZOOM, p.zoom * 1.25) })); }
        if (e.key === '-') { e.preventDefault(); setCanvasState(p => ({ ...p, zoom: Math.max(MIN_ZOOM, p.zoom / 1.25) })); }
        if (e.key === '0') { e.preventDefault(); handleZoomToFit(); }
        if (e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); }
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'v': handleToolChange('select'); break;
        case 'h': handleToolChange('pan'); break;
        case 'm': handleToolChange('measure'); break;
        case 'r': handleToolChange('room'); break;
        case 'w': handleToolChange('wall'); break;
        case 'd': handleToolChange('door'); break;
        case 'e': handleToolChange('equipment'); break;
        case 'n': handleToolChange('note'); break;
        case 'l': setShowLayers(v => !v); setShowInventory(false); break;
        case 'b': setShowInventory(v => !v); setShowLayers(false); break;
        case '2': setView('2d'); break;
        case '3': setView('3d'); break;
        case 'i': setShowInspector(v => !v); break;
        case 'k': setShowLegend(v => !v); break;
        case 'f': handleZoomToFit(); break;
        case 't': setShowLabels(v => !v); break;
        case 'g': setShowGrid(v => !v); break;
        case 's': setSnapToGrid(!useFloorplanStore.getState().snapToGrid); break;
        case 'z': if (selectedElement) zoomToEntity(selectedElement); break;
        case '/': e.preventDefault(); searchRef.current?.focus(); break;
        case 'escape':
          if (pendingEquipmentId) { clearPending(); handleToolChange('select'); break; }
          if (scopeRoomId) { handleScopeRoom(null); break; }
          if (activeTool !== 'select') { handleToolChange('select'); break; }
          if (showLegend) { setShowLegend(false); break; }
          selectAndShow(null);
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToolChange, handleZoomToFit, zoomToEntity, selectedElement, scopeRoomId, handleScopeRoom, activeTool, showLegend, selectAndShow, setSnapToGrid, pendingEquipmentId, clearPending]);

  // Keep the local selection in sync with the store (Canvas selects directly)
  const storeSelected = useFloorplanStore(s => s.selectedIds);
  useEffect(() => {
    const first = storeSelected.length === 1 ? storeSelected[0] : storeSelected.length === 0 ? null : selectedElement;
    if (first !== selectedElement) setSelectedElement(first);
  }, [storeSelected]); // eslint-disable-line react-hooks/exhaustive-deps

  const layerVisibleMap = useMemo(() => new Map(sceneLayers.map(l => [l.id, l.visible])), [sceneLayers]);

  const handleUndo = () => (useFloorplanStore as any).temporal?.getState?.()?.undo?.();
  const handleRedo = () => (useFloorplanStore as any).temporal?.getState?.()?.redo?.();

  // ─── Render ────────────────────────────────────────────────────────────────

  const shell: React.CSSProperties = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: colors.bg, overflow: 'hidden', color: colors.text };

  if (loadState !== 'ready') {
    return (
      <div style={shell}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            {loadState === 'loading' && (
              <>
                <div style={{ width: 36, height: 36, border: `3px solid ${colors.border}`, borderTopColor: colors.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ color: colors.textSecondary }}>Loading project…</div>
              </>
            )}
            {loadState === 'missing' && (<><div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Project not found</div><div style={{ color: colors.textSecondary, fontSize: 13 }}>It may have been deleted, or the link is wrong.</div></>)}
            {loadState === 'denied' && (<><Lock size={28} color={colors.textMuted} style={{ marginBottom: 10 }} /><div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No access to this plan</div><div style={{ color: colors.textSecondary, fontSize: 13 }}>Ask an administrator for the “View Facility Plan” permission in the Lab roles settings.</div></>)}
            {loadState === 'error' && (<><div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Could not load the project</div><div style={{ color: colors.error, fontSize: 13 }}>{loadError}</div></>)}
            <button onClick={() => navigate('/floorplan')} style={{ marginTop: 18, font: 'inherit', fontSize: 13, padding: '8px 16px', borderRadius: 8, border: `1px solid ${colors.border}`, background: colors.bgPanel, color: colors.text, cursor: 'pointer' }}>Back to projects</button>
          </div>
        </div>
      </div>
    );
  }

  const selectedEntity = selectedElement ? entities[selectedElement] : undefined;
  const selectedEditable = !!selectedEntity && canEdit(selectedEntity.id);
  const hoverEntity = hover && (activeTool === 'select' || view === '3d') ? entities[hover.id] : undefined;
  const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect();

  return (
    <div style={shell}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 6px', height: 46, backgroundColor: colors.bgPanel, borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <IconButton title="Back to projects" onClick={() => navigate('/floorplan')}><ArrowLeft size={17} /></IconButton>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{project?.name ?? 'Floorplan'}</span>
          {project?.shared && <Chip color={colors.accent}><Users size={10} style={{ verticalAlign: -1, marginRight: 3 }} />shared</Chip>}
          {readOnly && <Chip><Lock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />read-only</Chip>}
          {project?.facility?.project.stage && <Chip>{project.facility.project.stage}</Chip>}
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div style={{ position: 'relative', width: 300 }}>
          <Search size={14} color={colors.textMuted} style={{ position: 'absolute', left: 9, top: 8 }} />
          <input
            ref={searchRef}
            value={search}
            onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'Enter' && searchResults[0]) { activateSearchResult(searchResults[0].id); setSearchOpen(false); searchRef.current?.blur(); }
              if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur(); }
            }}
            placeholder="Search rooms, doors, devices, layers…  ( / )"
            aria-label="Search"
            style={{ width: '100%', font: 'inherit', fontSize: 12.5, padding: '6px 8px 6px 28px', border: `1px solid ${colors.border}`, borderRadius: 7, backgroundColor: colors.bg, color: colors.text, outline: 'none' }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: 34, left: 0, right: 0, backgroundColor: colors.bgPanel, border: `1px solid ${colors.border}`, borderRadius: 8, boxShadow: `0 8px 24px ${colors.shadowLg}`, zIndex: 30, overflow: 'hidden' }}>
              {searchResults.map(r => (
                <div key={r.id} onMouseDown={() => { activateSearchResult(r.id); setSearchOpen(false); }}
                  style={{ padding: '6px 10px', fontSize: 12.5, cursor: 'pointer', display: 'flex', gap: 8 }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = colors.bgHover)} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                  <span style={{ flex: 1 }}>{r.label}</span><span style={{ color: colors.textMuted }}>{r.sub}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 2D / 3D */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, borderRadius: 7, border: `1px solid ${colors.border}`, backgroundColor: colors.bg }}>
          <TextButton small active={view === '2d'} onClick={() => setView('2d')} title="Plan view (2)">2D</TextButton>
          <TextButton small active={view === '3d'} onClick={() => setView('3d')} title="3D view (3)">3D</TextButton>
        </div>
        {view === '3d' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {(['iso', 'top', 'orbit', 'walk'] as CameraPreset[]).map(p => (
              <TextButton key={p} small active={preset === p} onClick={() => { setPreset(p); sceneRef.current?.setPreset(p); }} title={`Camera: ${p}`}>{p}</TextButton>
            ))}
            <IconButton title="Export PNG of the 3D view" onClick={exportPng}><Camera size={16} /></IconButton>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton title="Layers (L)" active={showLayers} onClick={() => { setShowLayers(v => !v); setShowInventory(false); }}><LayersIcon size={17} /></IconButton>
          <IconButton title="Lab inventory (B)" active={showInventory} onClick={() => { setShowInventory(v => !v); setShowLayers(false); }}><Boxes size={17} /></IconButton>
          <IconButton title="Inspector (I)" active={showInspector} onClick={() => setShowInspector(v => !v)}><Info size={17} /></IconButton>
          <IconButton title="Legend & notes (K)" active={showLegend} onClick={() => setShowLegend(v => !v)}><BookOpen size={17} /></IconButton>
          {!readOnly && (
            <IconButton title="Equipment catalog" active={showEquipmentCatalog} onClick={() => { const next = !showEquipmentCatalog; setShowEquipmentCatalog(next); if (next) handleToolChange('equipment'); else handleToolChange('select'); }}><Wrench size={17} /></IconButton>
          )}
          <IconButton title="AI command bar" active={showAi} onClick={() => setShowAi(v => !v)}><Sparkles size={17} /></IconButton>
          <IconButton title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</IconButton>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {showInventory && (
          <InventoryDrawer
            readOnly={readOnly}
            selectedEquipmentId={selectedEntity?.type === 'equipment' ? selectedEntity.id : null}
            onPlace={armPlacement}
            onBindSelected={bindSelected}
            onZoomTo={handleActivateEntity}
            onClose={() => setShowInventory(false)}
          />
        )}
        {showLayers && !showInventory && (
          <LayerPanel
            groups={layerGroups}
            presets={PRESETS}
            onPreset={applyPreset}
            onToggleLayer={handleToggleLayer}
            onSoloLayer={handleSoloLayer}
            onSetGroupVisible={handleSetGroupVisible}
            onSetAllVisible={handleSetAllVisible}
            guideOpacity={guideOpacity}
            onGuideOpacity={setGuideOpacity}
            hasGuide={!!dxfData}
            rooms={rooms}
            scopeRoomId={scopeRoomId}
            onScopeRoom={handleScopeRoom}
            filter={search}
            onClose={() => setShowLayers(false)}
          />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div ref={canvasWrapperRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
            onPointerMove={e => { const r = canvasWrapperRef.current?.getBoundingClientRect(); if (r) pointerRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }; }}>
            {view === '3d' && project && (
              <Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textSecondary, fontSize: 13 }}>Loading 3D…</div>}>
                <FacilityScene
                  ref={sceneRef}
                  entities={entities}
                  layerVisible={layerVisibleMap}
                  scope={scope}
                  selectedId={selectedElement}
                  onSelect={selectAndShow}
                  onHover={id => setHover(id ? { id, x: pointerRef.current.x, y: pointerRef.current.y } : null)}
                  showLabels={showLabels}
                  isLight={theme !== 'dark'}
                  heights={project.facility?.construction?.heights_m ?? {}}
                  devices={labDevices}
                  labRooms={labRooms}
                  clock={clock}
                />
              </Suspense>
            )}
            <div style={{ position: 'absolute', inset: 0, visibility: view === '2d' ? 'visible' : 'hidden' }}>
            <Canvas
              projectId={projectId!}
              activeTool={activeTool}
              layers={guideLayers}
              canvasState={canvasState}
              onCanvasStateChange={setCanvasState}
              selectedElement={selectedElement}
              onSelectElement={handleSelectElement}
              dxfData={dxfData}
              guideWorldAligned={project?.guide?.worldAligned ?? false}
              guideOpacity={guideOpacity}
              scope={scope}
              showLabels={showLabels}
              showGrid={showGrid}
              onHover={(id, x, y) => setHover(id ? { id, x, y } : null)}
              onActivateEntity={handleActivateEntity}
              onRoomComplete={handleRoomComplete}
              pendingEquipmentId={pendingEquipmentId}
              pendingBinding={pendingBinding}
              pendingDimensions={pendingDimensions}
              onEquipmentPlaced={() => { clearPending(); handleToolChange('select'); }}
            />
            </div>

            {/* Floating toolbar */}
            {view === '2d' && <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10 }}>
              <Toolbar
                activeTool={activeTool}
                onToolChange={handleToolChange}
                onUndo={handleUndo}
                onRedo={handleRedo}
                readOnly={readOnly}
                onZoomToFit={handleZoomToFit}
                showLabels={showLabels}
                onToggleLabels={() => setShowLabels(v => !v)}
                snapToGrid={snapToGrid}
                onToggleSnap={() => setSnapToGrid(!snapToGrid)}
                showGrid={showGrid}
                onToggleGrid={() => setShowGrid(v => !v)}
              />
            </div>}
            {view === '3d' && (
              <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 10, padding: '4px 10px', borderRadius: 8, fontSize: 11.5, backgroundColor: colors.bgPanel, border: `1px solid ${colors.border}`, color: colors.textSecondary }}>
                Drag to orbit · right-drag to pan · wheel to zoom · click an element to inspect · T labels
              </div>
            )}

            {/* Scope banner */}
            {scopeRoomId && (
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8, fontSize: 12, backgroundColor: theme === 'dark' ? '#3a2f10' : '#fff7e0', border: `1px solid ${colors.warning}66`, color: colors.text }}>
                <span>Isolated: <b>{(entities[scopeRoomId] as RoomEntity | undefined)?.name ?? scopeRoomId}</b></span>
                <button onClick={() => handleScopeRoom(null)} style={{ font: 'inherit', fontSize: 11, border: `1px solid ${colors.border}`, borderRadius: 5, background: colors.bgPanel, color: colors.text, cursor: 'pointer', padding: '1px 7px' }}>clear (Esc)</button>
              </div>
            )}

            {/* Guide loading / error pill */}
            {(loadingDxf || dxfError) && (
              <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 10, padding: '4px 10px', borderRadius: 8, fontSize: 12, backgroundColor: colors.bgPanel, border: `1px solid ${dxfError ? colors.error : colors.border}`, color: dxfError ? colors.error : colors.textSecondary }}>
                {dxfError ? `Guide drawing: ${dxfError}` : 'Loading drawings…'}
              </div>
            )}

            {/* Hover card */}
            {hoverEntity && hover && (
              <HoverCard entity={hoverEntity} x={hover.x} y={hover.y} containerWidth={wrapperRect?.width ?? 800} containerHeight={wrapperRect?.height ?? 600}
                device={hoverEntity.type === 'equipment' && (hoverEntity as EquipmentEntity).binding ? labDevices[bindingKey((hoverEntity as EquipmentEntity).binding!)] : undefined}
                labRoom={hoverEntity.type === 'room' ? labRooms.find(r => r.id === (hoverEntity as RoomEntity).labRoomId) : undefined} />
            )}

            {/* Legend drawer */}
            {showLegend && project && (
              <LegendDrawer project={project} entities={entities} onSelectRoom={id => { handleActivateEntity(id); }} onClose={() => setShowLegend(false)} />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {showAi && !readOnly && (
              <AiCommandBar projectId={projectId!} onAction={(action) => { if (action.type === 'createRoom') handleToolChange('room'); }} />
            )}
            <StatusBar
              zoom={canvasState.zoom}
              cursorX={canvasState.cursorX}
              cursorY={canvasState.cursorY}
              scale={`${project?.scale ?? '1:100'} · ${project?.units === 'mm' ? 'mm' : 'm'}`}
              selectedElement={selectedElement}
              onZoomChange={(zoom) => setCanvasState(prev => ({ ...prev, zoom }))}
              onZoomToFit={handleZoomToFit}
              readOnly={readOnly}
              saveOverride={isLocalProject(projectId) ? 'Local preview - not saved' : undefined}
              message={statusMessage}
              counts={{ visible: visibleCount, total: entityCount }}
            />
          </div>
        </div>

        {/* Right: equipment catalog / properties (editable) / inspector */}
        {showEquipmentCatalog && !readOnly && (
          <EquipmentCatalog
            onSelectEquipment={(id) => { setPendingEquipmentId(id); setPendingBinding(null); setPendingDimensions(null); handleToolChange('equipment'); }}
            pendingEquipmentId={pendingEquipmentId}
            onClose={() => { setShowEquipmentCatalog(false); clearPending(); handleToolChange('select'); }}
          />
        )}
        {!showEquipmentCatalog && showInspector && selectedEntity && selectedEditable && (
          <PropertiesPanel elementId={selectedEntity.id} projectId={projectId!} onClose={() => selectAndShow(null)} />
        )}
        {!showEquipmentCatalog && showInspector && project && !(selectedEntity && selectedEditable) && (
          <InspectorPanel
            project={project}
            selectedId={selectedEntity ? selectedEntity.id : null}
            onSelect={selectAndShow}
            onZoomTo={zoomToEntity}
            scopeRoomId={scopeRoomId}
            onScopeRoom={handleScopeRoom}
            onClose={() => setShowInspector(false)}
          />
        )}
      </main>

      {roomTypePicker && (
        <RoomTypePicker onSelect={handleRoomTypeSelected} onCancel={() => setRoomTypePicker(null)} />
      )}
    </div>
  );
}

/** ?focus= accepts an entity id or a room code such as 1.15 */
function resolveFocus(focus: string, entities: Record<string, FloorplanEntity>): string | null {
  if (entities[focus]) return focus;
  const byCode = Object.values(entities).find(e => e.type === 'room' && (String(e.meta?.code) === focus || (e as RoomEntity).name.startsWith(focus)));
  return byCode?.id ?? null;
}
