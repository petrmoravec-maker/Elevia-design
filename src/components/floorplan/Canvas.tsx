/**
 * Interactive 2D floorplan canvas.
 *
 * Rendering layers (bottom to top):
 *   1. Grid
 *   2. DXF guide (offscreen canvas, rendered once, blit each frame)
 *   3. Rooms (filled polygons)
 *   4. Walls (thick polylines)
 *   5. Doors (gap + arc)
 *   6. Equipment (bounding rectangles + icon)
 *   7. Measures (dimension lines)
 *   8. Notes
 *   9. Selection overlay (blue handles)
 *  10. Active tool preview (in-progress drawing)
 */

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { CanvasState } from '../../pages/floorplan/FloorplanEditor';
import type { ParsedDxf } from '../../services/dxfParser';
import { getColorFromAci } from '../../services/dxfParser';
import {
  useFloorplanStore,
  snapPoint,
  snapAngle,
  generateEntityIdSync,
  hitTest,
  boxSelect,
  doorSegment,
} from '../../stores/useFloorplanStore';
import type { EditorTool, SceneLayer } from '../../stores/useFloorplanStore';
import type {
  FloorplanEntity,
  RoomEntity,
  WallEntity,
  DoorEntity,
  EquipmentEntity,
  MeasureEntity,
  NoteEntity,
  EquipmentBinding,
  Point2D,
} from '../../types/floorplan';
import {
  PIXELS_PER_METER,
  toWorld,
  polygonCentroid,
  polygonArea,
  isSelfIntersecting,
  distanceToSegment,
} from '../../types/floorplan';
import { ROOM_TYPES } from '../../data/roomTypes';
import { getEquipmentById, equipmentFootprint } from '../../data/equipmentLibrary';

/** Colours of MEP route kinds (facility-design/build.py ROUTE_KINDS) */
export const ROUTE_COLORS: Record<string, string> = {
  supply: '#2060d0', extract: '#d06020', exhaust: '#a04000', cable_tray: '#b08000', circuit: '#806000', water: '#1090c0', drain: '#607080',
};

// Legacy Layer type from FloorplanEditor (for DXF layer visibility)
interface DxfLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

interface CanvasProps {
  projectId: string;
  activeTool: EditorTool;
  layers: DxfLayer[];
  canvasState: CanvasState;
  onCanvasStateChange: (state: CanvasState) => void;
  selectedElement: string | null;
  onSelectElement: (id: string | null) => void;
  dxfData?: ParsedDxf | null;
  /** Guide DXF already shares the scene coordinate system (metres, same origin): draw as-is. */
  guideWorldAligned?: boolean;
  /** Guide DXF opacity 0-1 (default 0.6) */
  guideOpacity?: number;
  /** When set, only these entity ids are drawn / hit (room isolation). */
  scope?: Set<string> | null;
  /** Show room / equipment / dimension labels */
  showLabels?: boolean;
  /** Draw the background grid */
  showGrid?: boolean;
  /** Hovered entity (null when none) with the pointer position in container pixels */
  onHover?: (id: string | null, x: number, y: number) => void;
  /** Double-click on an entity (zoom-to) */
  onActivateEntity?: (id: string) => void;
  /** Called when a room is completed -- opens room type picker */
  onRoomComplete?: (entityId: string) => void;
  /** Equipment item to place (from catalog sidebar) */
  pendingEquipmentId?: string | null;
  /** Inventory binding + footprint applied to the next placed equipment (Inventory drawer). */
  pendingBinding?: EquipmentBinding | null;
  pendingDimensions?: Point2D | null;
  onEquipmentPlaced?: () => void;
}

// ─── Rendering constants ──────────────────────────────────────────────────────

const SELECTION_COLOR = '#3B9EFF';
const SELECTION_FILL = 'rgba(59,158,255,0.08)';
const HANDLE_RADIUS = 6; // pixels
const SNAP_RADIUS_PX = 12; // pixels
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 1600;
const DIM_COLOR = '#c0392b';
const DIM_COLOR_DARK = '#ff6b6b';

export function Canvas({
  activeTool,
  layers: dxfLayers,
  canvasState,
  onCanvasStateChange,
  onSelectElement,
  dxfData,
  guideWorldAligned = false,
  guideOpacity = 0.6,
  scope = null,
  showLabels = true,
  showGrid = true,
  onHover,
  onActivateEntity,
  onRoomComplete,
  pendingEquipmentId,
  pendingBinding,
  pendingDimensions,
  onEquipmentPlaced,
}: CanvasProps) {
  const { colors, theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenDxfRef = useRef<HTMLCanvasElement | null>(null);
  const dxfRenderedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const isDirtyRef = useRef(true); // Force redraw each frame initially
  const hoverIdRef = useRef<string | null>(null);
  const lastHoverTestRef = useRef(0);
  const dxfViewKeyRef = useRef('');

  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Drawing state refs (mutable for use in rAF loop)
  const drawingPointsRef = useRef<Point2D[]>([]);
  const mousePosRef = useRef<Point2D>([0, 0]); // world coords
  const [drawingPoints, setDrawingPoints] = useState<Point2D[]>([]); // for forcing redraw

  // Box selection state
  const boxSelectStartRef = useRef<{ x: number; y: number } | null>(null);
  const [boxSelectRect, setBoxSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Copy/paste clipboard
  const clipboardRef = useRef<FloorplanEntity[]>([]);

  // Zustand store
  const {
    entities,
    selectedIds,
    layers: sceneLayers,
    snapToGrid,
    gridSize,
    addEntity,
    updateEntity,
    deleteEntity,
    deleteEntities,
    selectEntity,
    selectEntities,
    clearSelection,
    getRoomAtPoint,
  } = useFloorplanStore();

  // ─── Coordinate conversion ────────────────────────────────────────────────

  const ppm = useMemo(() => PIXELS_PER_METER * (canvasState.zoom / 100), [canvasState.zoom]);

  /** Convert a screen position to world coordinates (meters, Y-up) */
  const screenToWorld = useCallback((screenX: number, screenY: number): Point2D => {
    const container = containerRef.current;
    if (!container) return [0, 0];
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2 + canvasState.panX;
    const cy = rect.height / 2 + canvasState.panY;
    const worldX = (screenX - rect.left - cx) / ppm;
    const worldY = -((screenY - rect.top - cy) / ppm); // Flip Y
    return [worldX, worldY];
  }, [canvasState.panX, canvasState.panY, ppm]);

  /** Convert world coordinates to canvas (screen-relative) pixels */
  const worldToCanvas = useCallback((worldX: number, worldY: number): [number, number] => {
    const container = containerRef.current;
    if (!container) return [0, 0];
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2 + canvasState.panX;
    const cy = rect.height / 2 + canvasState.panY;
    return [
      cx + worldX * ppm,
      cy - worldY * ppm, // Flip Y
    ];
  }, [canvasState.panX, canvasState.panY, ppm]);

  /** Snap a world point to grid */
  const snap = useCallback((point: Point2D, shiftKey = false): Point2D => {
    const snapped = snapPoint(point, gridSize, snapToGrid);
    if (shiftKey && drawingPointsRef.current.length > 0) {
      const last = drawingPointsRef.current[drawingPointsRef.current.length - 1];
      return snapAngle(last, snapped);
    }
    return snapped;
  }, [snapToGrid, gridSize]);

  // ─── Offscreen DXF render ─────────────────────────────────────────────────

  useEffect(() => {
    dxfRenderedRef.current = false; // Force re-render when DXF data changes
    isDirtyRef.current = true;
  }, [dxfData]);

  const renderDxfOffscreen = useCallback(() => {
    if (!dxfData || dxfData.entities.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (!offscreenDxfRef.current) {
      offscreenDxfRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenDxfRef.current;
    offscreen.width = rect.width;
    offscreen.height = rect.height;
    const octx = offscreen.getContext('2d');
    if (!octx) return;

    octx.clearRect(0, 0, offscreen.width, offscreen.height);
    octx.save();
    octx.translate(offscreen.width / 2 + canvasState.panX, offscreen.height / 2 + canvasState.panY);
    octx.scale(ppm, -ppm); // Y-up with meter units

    if (!guideWorldAligned) {
      // Legacy imports: unknown origin/units, so centre the drawing on its own bounds.
      const dxfCenterX = (dxfData.bounds.minX + dxfData.bounds.maxX) / 2;
      const dxfCenterY = (dxfData.bounds.minY + dxfData.bounds.maxY) / 2;
      octx.translate(-dxfCenterX, -dxfCenterY);
    }

    // Build DXF layer visibility + colour map (O(1) lookup). Layer colour is used for
    // entities drawn BYLAYER (colour 256 / undefined).
    const dxfLayerMap = new Map<string, DxfLayer>(
      dxfLayers.map(l => [l.name.toLowerCase(), l])
    );
    const lineWidth = 1 / ppm;
    const isLight = theme === 'light';

    dxfData.entities.forEach(entity => {
      const layer = dxfLayerMap.get(entity.layer.toLowerCase());
      if (layer && !layer.visible) return;

      let color = entity.color && entity.color !== 256 ? getColorFromAci(entity.color) : (layer?.color ?? '#888888');
      // ACI 7 is "white/black": pick whichever contrasts with the canvas.
      if (color.toUpperCase() === '#FFFFFF' && isLight) color = '#222222';
      octx.strokeStyle = color;
      octx.fillStyle = color;
      octx.lineWidth = lineWidth;
      octx.globalAlpha = guideOpacity;

      switch (entity.type) {
        case 'line':
          if (entity.vertices && entity.vertices.length >= 2) {
            octx.beginPath();
            octx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
            octx.lineTo(entity.vertices[1].x, entity.vertices[1].y);
            octx.stroke();
          }
          break;
        case 'polyline':
          if (entity.vertices && entity.vertices.length >= 2) {
            octx.beginPath();
            octx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
            entity.vertices.slice(1).forEach(v => octx.lineTo(v.x, v.y));
            octx.stroke();
          }
          break;
        case 'circle':
          if (entity.center && entity.radius) {
            octx.beginPath();
            octx.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2);
            octx.stroke();
          }
          break;
        case 'arc':
          if (entity.center && entity.radius) {
            const sa = ((entity.startAngle || 0) * Math.PI) / 180;
            const ea = ((entity.endAngle || 360) * Math.PI) / 180;
            octx.beginPath();
            octx.arc(entity.center.x, entity.center.y, entity.radius, sa, ea, true);
            octx.stroke();
          }
          break;
        case 'text':
          if (entity.text && entity.position) {
            octx.save();
            octx.translate(entity.position.x, entity.position.y);
            octx.scale(1, -1);
            const h = entity.height || 0.2;
            octx.font = `${h}px Arial`;
            octx.globalAlpha = Math.min(1, guideOpacity + 0.2);
            octx.fillText(entity.text, 0, 0);
            octx.restore();
          }
          break;
        default:
          break;
      }
    });

    octx.restore();
    dxfRenderedRef.current = true;
  }, [dxfData, dxfLayers, canvasState.panX, canvasState.panY, ppm, guideWorldAligned, guideOpacity, theme]);

  useEffect(() => {
    dxfRenderedRef.current = false;
  }, [dxfLayers, guideOpacity, guideWorldAligned, theme]);

  // ─── Main render loop ─────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      dxfRenderedRef.current = false; // Canvas resized, re-render DXF
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2 + canvasState.panX;
    const cy = h / 2 + canvasState.panY;

    // Clear
    ctx.fillStyle = colors.canvas || '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // 1. Draw grid
    if (showGrid) drawGrid(ctx, w, h, cx, cy, ppm, gridSize, colors);

    // 2. Blit DXF offscreen (guide layer); re-render whenever the view moved
    if (dxfData) {
      const viewKey = `${canvasState.panX}|${canvasState.panY}|${ppm}|${w}x${h}`;
      if (dxfViewKeyRef.current !== viewKey) {
        dxfViewKeyRef.current = viewKey;
        dxfRenderedRef.current = false;
      }
      if (!dxfRenderedRef.current) renderDxfOffscreen();
      if (offscreenDxfRef.current && dxfRenderedRef.current) {
        ctx.drawImage(offscreenDxfRef.current, 0, 0);
      }
    }

    // Set up world transform (Y-up, meters)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(ppm, -ppm);

    const currentEntities = useFloorplanStore.getState().entities;
    const currentSelectedIds = useFloorplanStore.getState().selectedIds;
    const currentSceneLayers = useFloorplanStore.getState().layers;
    const isLight = theme === 'light';

    // Build scene layer visibility map
    const sceneLayerMap = new Map<string, SceneLayer>(
      currentSceneLayers.map(l => [l.id, l])
    );
    const isVisible = (e: FloorplanEntity) => {
      if (!e.visible) return false;
      if (scope && !scope.has(e.id)) return false;
      const layer = sceneLayerMap.get(e.layer);
      return !layer || layer.visible;
    };

    const lineWidthPx = 1 / ppm; // 1 CSS pixel in world units
    const toScreen = (x: number, y: number): [number, number] => [cx + x * ppm, cy - y * ppm];
    const visibleRooms: RoomEntity[] = [];
    const visibleRoutes: WallEntity[] = [];
    const visibleEquipment: EquipmentEntity[] = [];
    const visibleDims: MeasureEntity[] = [];
    const hoverId = hoverIdRef.current;

    // 3. Rooms
    for (const e of Object.values(currentEntities)) {
      if (e.type !== 'room' || !isVisible(e)) continue;
      const room = e as RoomEntity;
      const roomType = ROOM_TYPES.find(rt => rt.id === room.roomTypeId);
      const fillColor = roomType?.color ?? '#6366f1';
      const planned = room.layer.startsWith('expansion-');
      if (planned) { ctx.save(); ctx.setLineDash([8 * lineWidthPx, 5 * lineWidthPx]); }
      drawRoom(ctx, room, planned ? '#e03030' : fillColor, lineWidthPx, false, hoverId === room.id);
      if (planned) ctx.restore();
      visibleRooms.push(room);
    }

    // 4. Walls (existing walls: grey fill with darker edge; exterior walls darker)
    for (const e of Object.values(currentEntities)) {
      if (e.type !== 'wall' || !isVisible(e)) continue;
      const wall = e as WallEntity;
      if (wall.points.length < 2) continue;
      const kind = typeof wall.meta?.kind === 'string' ? (wall.meta!.kind as string) : 'wall';
      if (kind === 'duct' || kind === 'cable') {
        // MEP route: true width, kind colour, dashed when planned
        ctx.save();
        ctx.strokeStyle = hoverId === wall.id ? SELECTION_COLOR : ROUTE_COLORS[String(wall.meta?.route_kind)] ?? '#556';
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(wall.thickness, 2 / ppm);
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        if (wall.layer.startsWith('expansion-')) ctx.setLineDash([6 * lineWidthPx, 4 * lineWidthPx]);
        ctx.beginPath();
        ctx.moveTo(wall.points[0][0], wall.points[0][1]);
        wall.points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.stroke();
        ctx.restore();
        visibleRoutes.push(wall);
        continue;
      }
      const fill = wall.layer.startsWith('expansion-') ? '#e0303099'
        : kind === 'exterior' ? (isLight ? '#7a7a7a' : '#8a8a8a')
        : kind === 'lining' ? (isLight ? '#c8c8c8' : '#6b6b6b')
        : (isLight ? '#a8a8a8' : '#9CA3AF');
      ctx.strokeStyle = hoverId === wall.id ? SELECTION_COLOR : fill;
      ctx.lineWidth = wall.thickness;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(wall.points[0][0], wall.points[0][1]);
      wall.points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.stroke();
    }

    // 5. Doors
    for (const e of Object.values(currentEntities)) {
      if (e.type !== 'door' || !isVisible(e)) continue;
      const door = e as DoorEntity;
      const owner = currentEntities[door.wallOwner];
      if (!owner) continue;
      drawDoor(ctx, door, owner, lineWidthPx, hoverId === door.id);
    }

    // 6. Equipment
    for (const e of Object.values(currentEntities)) {
      if (e.type !== 'equipment' || !isVisible(e)) continue;
      const eq = e as EquipmentEntity;
      const planned = eq.layer.startsWith('expansion-');
      if (planned) { ctx.save(); ctx.setLineDash([6 * lineWidthPx, 4 * lineWidthPx]); }
      drawEquipment(ctx, eq, lineWidthPx, hoverId === eq.id, isLight);
      if (planned) ctx.restore();
      visibleEquipment.push(eq);
    }

    // 7. Measures / dimensions (geometry in world space, text later in screen space)
    for (const e of Object.values(currentEntities)) {
      if (e.type !== 'measure' || !isVisible(e)) continue;
      const m = e as MeasureEntity;
      if (m.style === 'dimension') {
        drawDimensionGeometry(ctx, m, lineWidthPx, ppm, isLight ? DIM_COLOR : DIM_COLOR_DARK, hoverId === m.id);
        visibleDims.push(m);
      } else {
        drawMeasure(ctx, m, lineWidthPx, ppm);
      }
    }

    // 8. Notes
    for (const e of Object.values(currentEntities)) {
      if (e.type !== 'note' || !isVisible(e)) continue;
      const note = e as NoteEntity;
      ctx.save();
      ctx.translate(note.position[0], note.position[1]);
      ctx.scale(1, -1);
      ctx.fillStyle = isLight ? '#8a6d00' : '#FCD34D';
      ctx.font = `${note.fontSize}px sans-serif`;
      ctx.fillText(note.text, 0, 0);
      ctx.restore();
    }

    // 9. Selection overlay
    for (const id of currentSelectedIds) {
      const e = currentEntities[id];
      if (!e) continue;
      drawSelectionOverlay(ctx, e, lineWidthPx, ppm, currentEntities);
    }

    // 10. Tool preview
    const pts = drawingPointsRef.current;
    const mousePos = mousePosRef.current;

    if (activeTool === 'room' && pts.length > 0) {
      drawRoomPreview(ctx, pts, mousePos, lineWidthPx);
    } else if (activeTool === 'wall' && pts.length > 0) {
      drawWallPreview(ctx, pts, mousePos, lineWidthPx);
    } else if (activeTool === 'measure' && pts.length === 1) {
      drawMeasurePreview(ctx, pts[0], mousePos, lineWidthPx, ppm);
    } else if ((activeTool === 'equipment' || activeTool === 'select') && pendingEquipmentId) {
      drawEquipmentPreview(ctx, mousePos, pendingEquipmentId, lineWidthPx);
    }

    ctx.restore();

    // 11. Labels in screen space: constant pixel size, level-of-detail, no overlaps
    if (showLabels) {
      drawLabels(ctx, {
        rooms: visibleRooms,
        routes: visibleRoutes,
        equipment: visibleEquipment,
        dims: visibleDims,
        toScreen,
        ppm,
        isLight,
        selected: new Set(currentSelectedIds),
        hoverId,
        w, h,
      });
    }

    // Box selection rectangle (in screen space)
    if (boxSelectRect) {
      ctx.save();
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.fillStyle = 'rgba(59,158,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(boxSelectRect.x, boxSelectRect.y, boxSelectRect.w, boxSelectRect.h);
      ctx.strokeRect(boxSelectRect.x, boxSelectRect.y, boxSelectRect.w, boxSelectRect.h);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [
    colors, theme, canvasState, ppm, gridSize, dxfData, activeTool,
    renderDxfOffscreen, pendingEquipmentId, boxSelectRect, scope, showLabels, showGrid,
  ]);

  // Start rAF loop
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      render();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [render]);

  // ─── Mouse events ─────────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || activeTool === 'pan') {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - canvasState.panX, y: e.clientY - canvasState.panY };
      return;
    }

    const worldPos = screenToWorld(e.clientX, e.clientY);
    const snappedPos = snap(worldPos, e.shiftKey);

    if (activeTool === 'select') {
      if (pendingEquipmentId) {
        // Place equipment
        placeEquipment(snappedPos, pendingEquipmentId);
        onEquipmentPlaced?.();
        return;
      }
      const hit = hitTest(worldPos, useFloorplanStore.getState().entities, useFloorplanStore.getState().layers,
        { hitRadius: 8 / ppm, scope });
      if (hit) {
        selectEntity(hit.id, e.shiftKey || e.metaKey);
        onSelectElement(hit.id);
      } else {
        clearSelection();
        onSelectElement(null);
        // Start box select
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          boxSelectStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }
      }
      return;
    }

    if (activeTool === 'room') {
      const currentPts = drawingPointsRef.current;
      // Close if clicking near first vertex
      if (currentPts.length >= 3) {
        const [fx, fy] = worldToCanvas(currentPts[0][0], currentPts[0][1]);
        const dist = Math.hypot(e.clientX - (containerRef.current?.getBoundingClientRect().left ?? 0) - fx,
                                e.clientY - (containerRef.current?.getBoundingClientRect().top ?? 0) - fy);
        if (dist < SNAP_RADIUS_PX) {
          finishRoom(currentPts);
          return;
        }
      }
      const newPts = [...currentPts, snappedPos];
      drawingPointsRef.current = newPts;
      setDrawingPoints([...newPts]);
      return;
    }

    if (activeTool === 'wall') {
      const currentPts = drawingPointsRef.current;
      const newPts = [...currentPts, snappedPos];
      drawingPointsRef.current = newPts;
      setDrawingPoints([...newPts]);
      return;
    }

    if (activeTool === 'measure') {
      const currentPts = drawingPointsRef.current;
      if (currentPts.length === 0) {
        drawingPointsRef.current = [snappedPos];
        setDrawingPoints([snappedPos]);
      } else {
        finishMeasure(currentPts[0], snappedPos);
      }
      return;
    }

    if (activeTool === 'equipment' && pendingEquipmentId) {
      placeEquipment(snappedPos, pendingEquipmentId);
      onEquipmentPlaced?.();
      return;
    }

    if (activeTool === 'door') {
      // Snap onto the nearest room edge / wall segment (generated rooms included - the door is a
      // new design entity that only references its owner).
      const edge = nearestEdge(worldPos, useFloorplanStore.getState().entities, useFloorplanStore.getState().layers, 16 / ppm, scope);
      if (!edge) return;
      const id = generateEntityIdSync('door');
      const door: DoorEntity = {
        id, type: 'door', layer: 'doors', visible: true, locked: false,
        wallOwner: edge.ownerId, edgeIndex: edge.edgeIndex, position: edge.t,
        width: 0.9, height: 1.97, swing: 'left',
      };
      addEntity(door);
      selectEntity(id);
      onSelectElement(id);
      return;
    }

    if (activeTool === 'note') {
      const text = window.prompt('Note text');
      if (!text || !text.trim()) return;
      const id = generateEntityIdSync('note');
      const note: NoteEntity = {
        id, type: 'note', layer: 'notes', visible: true, locked: false,
        position: snappedPos, text: text.trim(), fontSize: 0.25,
      };
      addEntity(note);
      selectEntity(id);
      onSelectElement(id);
      return;
    }
  }, [activeTool, screenToWorld, snap, worldToCanvas, selectEntity, clearSelection, onSelectElement,
      pendingEquipmentId, onEquipmentPlaced, canvasState.panX, canvasState.panY, ppm, scope, addEntity]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    const snappedPos = snap(worldPos, e.shiftKey);
    mousePosRef.current = snappedPos;

    // Update cursor position in parent
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      const worldX = Math.round(worldPos[0] * 1000) / 1000;
      const worldY = Math.round(worldPos[1] * 1000) / 1000;

      if (isPanning) {
        onCanvasStateChange({
          ...canvasState,
          panX: e.clientX - panStartRef.current.x,
          panY: e.clientY - panStartRef.current.y,
          cursorX: worldX * PIXELS_PER_METER,
          cursorY: worldY * PIXELS_PER_METER,
        });
        if (hoverIdRef.current) { hoverIdRef.current = null; onHover?.(null, rawX, rawY); }
        return;
      }

      onCanvasStateChange({
        ...canvasState,
        cursorX: worldX * PIXELS_PER_METER,
        cursorY: worldY * PIXELS_PER_METER,
      });

      // Box selection drag
      if (boxSelectStartRef.current && activeTool === 'select') {
        const start = boxSelectStartRef.current;
        const x = Math.min(start.x, rawX);
        const y = Math.min(start.y, rawY);
        const w = Math.abs(rawX - start.x);
        const h = Math.abs(rawY - start.y);
        setBoxSelectRect({ x, y, w, h });
        return;
      }

      // Hover (throttled to ~30 Hz) - only with the select tool
      const now = performance.now();
      if (activeTool === 'select' && now - lastHoverTestRef.current > 33) {
        lastHoverTestRef.current = now;
        const hit = hitTest(worldPos, useFloorplanStore.getState().entities, useFloorplanStore.getState().layers,
          { hitRadius: 8 / ppm, scope });
        const id = hit?.id ?? null;
        if (id !== hoverIdRef.current || id) {
          hoverIdRef.current = id;
          onHover?.(id, rawX, rawY);
        }
      } else if (activeTool !== 'select' && hoverIdRef.current) {
        hoverIdRef.current = null;
        onHover?.(null, rawX, rawY);
      }
    }
  }, [isPanning, screenToWorld, snap, canvasState, onCanvasStateChange, activeTool, ppm, scope, onHover]);

  const handleMouseLeaveContainer = useCallback((e: React.MouseEvent) => {
    if (hoverIdRef.current) {
      hoverIdRef.current = null;
      onHover?.(null, 0, 0);
    }
    handleMouseUpRef.current?.(e);
  }, [onHover]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    setIsPanning(false);

    // Finalize box selection
    if (boxSelectStartRef.current && boxSelectRect) {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const { x, y, w, h } = boxSelectRect;
        if (w > 5 && h > 5) {
          // Convert box to world coords
          const topLeft = screenToWorld(rect.left + x, rect.top + y);
          const bottomRight = screenToWorld(rect.left + x + w, rect.top + y + h);
          const minX = Math.min(topLeft[0], bottomRight[0]);
          const maxX = Math.max(topLeft[0], bottomRight[0]);
          const minY = Math.min(topLeft[1], bottomRight[1]);
          const maxY = Math.max(topLeft[1], bottomRight[1]);
          const ids = boxSelect(
            { minX, minY, maxX, maxY },
            useFloorplanStore.getState().entities,
            useFloorplanStore.getState().layers,
          );
          selectEntities(ids);
          if (ids.length === 1) onSelectElement(ids[0]);
        }
      }
    }
    boxSelectStartRef.current = null;
    setBoxSelectRect(null);
  }, [boxSelectRect, screenToWorld, selectEntities, onSelectElement]);

  const handleMouseUpRef = useRef<((e: React.MouseEvent) => void) | null>(null);
  handleMouseUpRef.current = handleMouseUp;

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'room' && drawingPointsRef.current.length >= 3) {
      finishRoom(drawingPointsRef.current);
      return;
    }
    if (activeTool === 'wall' && drawingPointsRef.current.length >= 2) {
      finishWall(drawingPointsRef.current);
      return;
    }
    if (activeTool === 'select') {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      const hit = hitTest(worldPos, useFloorplanStore.getState().entities, useFloorplanStore.getState().layers,
        { hitRadius: 8 / ppm, scope });
      if (hit && onActivateEntity) {
        onActivateEntity(hit.id);
      } else {
        // Empty double-click: reset the view
        onCanvasStateChange({ ...canvasState, zoom: 100, panX: 0, panY: 0 });
      }
    }
  }, [activeTool, canvasState, onCanvasStateChange, screenToWorld, ppm, scope, onActivateEntity]);

  // Native wheel listener: React's onWheel is passive and cannot preventDefault (page zoom / scroll).
  const canvasStateRef = useRef(canvasState);
  canvasStateRef.current = canvasState;
  const onCanvasStateChangeRef = useRef(onCanvasStateChange);
  onCanvasStateChangeRef.current = onCanvasStateChange;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cs = canvasStateRef.current;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Trackpad pinch arrives as ctrlKey+wheel; plain wheel zooms too (CAD convention).
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const oldZoom = cs.zoom;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
      if (newZoom === oldZoom) return;
      // Keep the world point under the cursor fixed.
      const cxOld = rect.width / 2 + cs.panX;
      const cyOld = rect.height / 2 + cs.panY;
      const k = newZoom / oldZoom;
      const panX = mx - rect.width / 2 - (mx - cxOld) * k;
      const panY = my - rect.height / 2 - (my - cyOld) * k;
      onCanvasStateChangeRef.current({ ...cs, zoom: newZoom, panX, panY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ─── Drawing finishers ────────────────────────────────────────────────────

  const finishRoom = useCallback((points: Point2D[]) => {
    if (points.length < 3) return;
    if (isSelfIntersecting(points)) {
      alert('Room polygon is self-intersecting. Please draw a valid shape.');
      return;
    }
    const area = polygonArea(points);
    if (area < 0.5) {
      alert('Room is too small (less than 0.5m²). Please draw a larger shape.');
      return;
    }
    const id = generateEntityIdSync('room');
    const room: RoomEntity = {
      id,
      type: 'room',
      layer: 'rooms',
      visible: true,
      locked: false,
      polygon: points,
      roomTypeId: 'grow_veg', // Default -- will be updated by RoomTypePicker
      name: 'New Room',
      area,
      wallThickness: 0.2,
      ceilingHeight: 3.5,
    };
    addEntity(room);
    selectEntity(id);
    onSelectElement(id);
    onRoomComplete?.(id);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
  }, [addEntity, selectEntity, onSelectElement, onRoomComplete]);

  const finishWall = useCallback((points: Point2D[]) => {
    if (points.length < 2) return;
    const id = generateEntityIdSync('wall');
    const wall: WallEntity = {
      id,
      type: 'wall',
      layer: 'walls',
      visible: true,
      locked: false,
      points,
      thickness: 0.2,
      height: 3.5,
    };
    addEntity(wall);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
  }, [addEntity]);

  const finishMeasure = useCallback((start: Point2D, end: Point2D) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const distance = Math.hypot(dx, dy);
    const id = generateEntityIdSync('measure');
    const measure: MeasureEntity = {
      id,
      type: 'measure',
      layer: 'measurements',
      visible: true,
      locked: false,
      start,
      end,
      distance,
    };
    addEntity(measure);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
  }, [addEntity]);

  const placeEquipment = useCallback((position: Point2D, equipmentId: string) => {
    const equipDef = getEquipmentById(equipmentId);
    const [w, d] = pendingDimensions ?? equipmentFootprint(equipDef?.category);
    const roomEntity = getRoomAtPoint(position);
    const id = generateEntityIdSync('equipment');
    const eq: EquipmentEntity = {
      id,
      type: 'equipment',
      layer: 'equipment',
      visible: true,
      locked: false,
      equipmentId,
      center: position,
      rotation: 0,
      dimensions: [w, d],
      roomId: roomEntity?.id,
      binding: pendingBinding ?? null,
    };
    addEntity(eq);
    selectEntity(id);
    onSelectElement(id);
  }, [addEntity, getRoomAtPoint, pendingBinding, pendingDimensions, selectEntity, onSelectElement]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Escape: cancel drawing or clear selection
      if (e.key === 'Escape') {
        if (activeTool === 'wall' && drawingPointsRef.current.length >= 2) {
          finishWall(drawingPointsRef.current);
        } else {
          drawingPointsRef.current = [];
          setDrawingPoints([]);
          clearSelection();
          onSelectElement(null);
        }
        return;
      }

      // Delete/Backspace: delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useFloorplanStore.getState().selectedIds;
        if (ids.length > 0) {
          deleteEntities(ids);
          clearSelection();
          onSelectElement(null);
        }
        return;
      }

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useFloorplanStore.temporal?.getState?.().undo?.();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useFloorplanStore.temporal?.getState?.().redo?.();
        return;
      }

      // Copy/paste
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const ids = useFloorplanStore.getState().selectedIds;
        clipboardRef.current = ids.map(id => useFloorplanStore.getState().entities[id]).filter(Boolean);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        if (clipboardRef.current.length === 0) return;
        const OFFSET: Point2D = [0.5, -0.5]; // Paste offset in meters
        const newIds: string[] = [];
        for (const orig of clipboardRef.current) {
          const newId = generateEntityIdSync(orig.type as any);
          let pasted: FloorplanEntity;
          if (orig.type === 'room') {
            const r = orig as RoomEntity;
            pasted = {
              ...r,
              id: newId,
              name: `${r.name} (Copy)`,
              polygon: r.polygon.map(([x, y]): Point2D => [x + OFFSET[0], y + OFFSET[1]]),
            };
          } else if (orig.type === 'equipment') {
            const eq = orig as EquipmentEntity;
            pasted = {
              ...eq,
              id: newId,
              center: [eq.center[0] + OFFSET[0], eq.center[1] + OFFSET[1]] as Point2D,
            };
          } else {
            pasted = { ...orig, id: newId };
          }
          // Copies of generated (existing-*) entities become editable design entities.
          if (pasted.locked || pasted.layer.startsWith('existing-') || pasted.layer.startsWith('expansion-')) {
            pasted = { ...pasted, locked: false, layer: pasted.type === 'measure' ? 'measurements' : `${pasted.type}s` };
            if (pasted.type === 'equipment') pasted = { ...pasted, layer: 'equipment' };
          }
          addEntity(pasted);
          newIds.push(newId);
        }
        selectEntities(newIds);
        if (newIds.length === 1) onSelectElement(newIds[0]);
        return;
      }

      // Select All
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        const allIds = Object.keys(useFloorplanStore.getState().entities);
        selectEntities(allIds);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, finishWall, clearSelection, onSelectElement, deleteEntities, addEntity, selectEntities]);

  // ─── Cursor style ─────────────────────────────────────────────────────────

  const cursor = useMemo(() => {
    if (isPanning || activeTool === 'pan') return 'grabbing';
    if (activeTool === 'select') return pendingEquipmentId ? 'copy' : 'default';
    return 'crosshair';
  }, [isPanning, activeTool, pendingEquipmentId]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', cursor }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeaveContainer}
      onDoubleClick={handleDoubleClick}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {/* Empty state hint */}
      {!dxfData && Object.keys(entities).length === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          pointerEvents: 'none',
          color: colors.textMuted,
        }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📐</div>
          <div style={{ fontSize: '14px', marginBottom: '6px' }}>
            {activeTool === 'room' ? 'Click to place room vertices. Double-click or click near start to close.' :
             activeTool === 'wall' ? 'Click to place wall points. Double-click or press Escape to finish.' :
             activeTool === 'measure' ? 'Click two points to add a dimension.' :
             activeTool === 'door' ? 'Click on a room edge or wall to place a 900 mm door (edit width / swing in Properties).' :
             activeTool === 'note' ? 'Click where the note should sit.' :
             'Select a tool from the toolbar to begin drawing.'}
          </div>
          <div style={{ fontSize: '12px' }}>
            Press <kbd style={{ padding: '2px 5px', backgroundColor: colors.bgPanel, borderRadius: '3px' }}>/</kbd> for AI commands
          </div>
        </div>
      )}

      {/* In-progress drawing vertex count */}
      {drawingPoints.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          backgroundColor: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: '6px',
          fontSize: '12px',
          color: colors.textSecondary,
          pointerEvents: 'none',
        }}>
          {activeTool === 'room' && `${drawingPoints.length} vertices — Double-click or click start to close`}
          {activeTool === 'wall' && `${drawingPoints.length} points — Double-click or Escape to finish`}
          {activeTool === 'measure' && 'Click second point to measure'}
        </div>
      )}
    </div>
  );
}

// ─── Drawing helpers (pure canvas, world-space) ───────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  cx: number, cy: number,
  ppm: number,
  gridSize: number,
  colors: Record<string, string>,
) {
  const gridPx = gridSize * ppm;
  if (gridPx < 6) return;

  ctx.strokeStyle = colors.canvasGrid || 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();

  const startX = cx % gridPx;
  const startY = cy % gridPx;
  for (let x = startX; x < w; x += gridPx) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = startY; y < h; y += gridPx) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Major grid every 5 cells
  const majorGrid = gridPx * 5;
  if (majorGrid > 10) {
    ctx.strokeStyle = colors.canvasGridMajor || 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const mStartX = cx % majorGrid;
    const mStartY = cy % majorGrid;
    for (let x = mStartX; x < w; x += majorGrid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = mStartY; y < h; y += majorGrid) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  // Origin crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy);
  ctx.lineTo(cx + 15, cy);
  ctx.moveTo(cx, cy - 15);
  ctx.lineTo(cx, cy + 15);
  ctx.stroke();
}

function drawRoom(
  ctx: CanvasRenderingContext2D,
  room: RoomEntity,
  fillColor: string,
  lw: number,
  isPreview: boolean,
  hovered = false,
) {
  if (room.polygon.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(room.polygon[0][0], room.polygon[0][1]);
  for (let i = 1; i < room.polygon.length; i++) {
    ctx.lineTo(room.polygon[i][0], room.polygon[i][1]);
  }
  ctx.closePath();

  ctx.fillStyle = hexWithAlpha(fillColor, isPreview ? 0.15 : hovered ? 0.38 : 0.22);
  ctx.fill();

  ctx.strokeStyle = hovered ? SELECTION_COLOR : fillColor;
  ctx.lineWidth = isPreview ? lw * 1.5 : lw * (hovered ? 2.5 : 1.5);
  ctx.setLineDash(isPreview ? [lw * 4, lw * 2] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  // Room name / area labels are drawn in screen space by drawLabels (constant size, LOD).
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  door: DoorEntity,
  owner: FloorplanEntity,
  lw: number,
  hovered = false,
) {
  const seg = doorSegment(door, owner);
  if (!seg) return;
  const [hinge, latch] = seg;
  const dx = latch[0] - hinge[0];
  const dy = latch[1] - hinge[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len, uy = dy / len;
  // Swing side: 'left' swings towards the left of the hinge->latch direction (+90deg).
  const side = door.swing === 'right' ? -1 : 1;
  const nx = -uy * side, ny = ux * side;

  ctx.strokeStyle = hovered ? SELECTION_COLOR : '#F59E0B';
  ctx.lineWidth = lw * (hovered ? 2.5 : 1.5);

  // Opening: mask the wall line with a light gap
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = hovered ? SELECTION_COLOR : '#F59E0B';
  ctx.beginPath();
  ctx.moveTo(hinge[0], hinge[1]);
  ctx.lineTo(latch[0], latch[1]);
  ctx.stroke();
  ctx.restore();

  // Leaf (open 90deg) and swing arc
  ctx.beginPath();
  ctx.moveTo(hinge[0], hinge[1]);
  ctx.lineTo(hinge[0] + nx * len, hinge[1] + ny * len);
  ctx.stroke();

  const a0 = Math.atan2(uy, ux);
  const a1 = Math.atan2(ny, nx);
  ctx.beginPath();
  ctx.setLineDash([lw * 3, lw * 2]);
  // arc from leaf direction to the closed direction, anticlockwise flag depends on side
  ctx.arc(hinge[0], hinge[1], len, a0, a1, side < 0);
  ctx.stroke();
  ctx.setLineDash([]);

  if (door.swing === 'double') {
    // second leaf mirrored about the centre
    const cx = (hinge[0] + latch[0]) / 2, cy = (hinge[1] + latch[1]) / 2;
    ctx.beginPath();
    ctx.moveTo(latch[0], latch[1]);
    ctx.lineTo(latch[0] + nx * len / 2, latch[1] + ny * len / 2);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + nx * len / 2, cy + ny * len / 2);
    ctx.stroke();
  }
}

function equipmentStyle(eq: EquipmentEntity, isLight: boolean): { stroke: string; fill: string } {
  const id = eq.equipmentId || '';
  const layer = eq.layer || '';
  if (layer.includes('table') || id.includes('table')) return { stroke: isLight ? '#b0186a' : '#e0489a', fill: 'rgba(208,32,106,0.10)' };
  if (layer.includes('light') || id.includes('led') || id.includes('light')) return { stroke: isLight ? '#1030d0' : '#6a8cff', fill: 'rgba(16,48,208,0.10)' };
  if (layer.includes('hvac') || id.includes('hvac') || id.includes('ac_') || id.includes('minisplit')) return { stroke: isLight ? '#d04000' : '#ff8a50', fill: 'rgba(208,64,0,0.12)' };
  if (id.includes('dehu')) return { stroke: isLight ? '#0f766e' : '#2dd4bf', fill: 'rgba(20,184,166,0.14)' };
  return { stroke: '#10B981', fill: 'rgba(16,185,129,0.15)' };
}

function drawEquipment(
  ctx: CanvasRenderingContext2D,
  eq: EquipmentEntity,
  lw: number,
  hovered: boolean,
  isLight: boolean,
) {
  const [cx, cy] = eq.center;
  const [hw, hd] = [eq.dimensions[0] / 2, eq.dimensions[1] / 2];
  const st = equipmentStyle(eq, isLight);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((eq.rotation * Math.PI) / 180);

  ctx.fillStyle = hovered ? hexWithAlpha(SELECTION_COLOR, 0.2) : st.fill;
  ctx.strokeStyle = hovered ? SELECTION_COLOR : st.stroke;
  ctx.lineWidth = lw * (hovered ? 2.5 : 1.2);
  ctx.beginPath();
  ctx.rect(-hw, -hd, eq.dimensions[0], eq.dimensions[1]);
  ctx.fill();
  ctx.stroke();

  // Lighting rows: centre line; HVAC: diagonal cross
  const id = eq.equipmentId || '';
  if (eq.layer.includes('light') || id.includes('led')) {
    ctx.beginPath();
    if (eq.dimensions[0] >= eq.dimensions[1]) { ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); } else { ctx.moveTo(0, -hd); ctx.lineTo(0, hd); }
    ctx.stroke();
  } else if (eq.layer.includes('hvac') || id.includes('hvac')) {
    ctx.beginPath();
    ctx.moveTo(-hw, -hd); ctx.lineTo(hw, hd); ctx.moveTo(-hw, hd); ctx.lineTo(hw, -hd);
    ctx.stroke();
  }
  ctx.restore();
}

/** 45-degree tick at a dimension line end, size in world units. */
function drawTick(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.stroke();
}

/**
 * Architectural dimension string: extension lines from the measured anchors to the
 * dimension line, the line itself and 45deg ticks. The value text is drawn later in screen
 * space (drawLabels) so it keeps a readable size at any zoom.
 */
function drawDimensionGeometry(
  ctx: CanvasRenderingContext2D,
  m: MeasureEntity,
  lw: number,
  ppm: number,
  color: string,
  hovered: boolean,
) {
  const [sx, sy] = m.start;
  const [ex, ey] = m.end;
  const len = Math.hypot(ex - sx, ey - sy);
  if (len < 0.005) return;
  // Level of detail: skip strings shorter than ~14 px on screen.
  if (len * ppm < 14) return;

  ctx.strokeStyle = hovered ? SELECTION_COLOR : color;
  ctx.lineWidth = lw * (hovered ? 2 : 0.9);
  ctx.setLineDash([]);

  // extension lines (anchor -> dimension line, overshoot 1.5 mm on screen)
  const measured = Array.isArray(m.meta?.measured) ? (m.meta!.measured as Point2D[]) : null;
  if (measured && measured.length === 2) {
    const over = 3 / ppm;
    const ends: [Point2D, Point2D][] = [[measured[0], m.start], [measured[1], m.end]];
    ctx.beginPath();
    for (const [a, b] of ends) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1e-9;
      const gap = Math.min(d * 0.25, 2 / ppm);
      ctx.moveTo(a[0] + (dx / d) * gap, a[1] + (dy / d) * gap);
      ctx.lineTo(b[0] + (dx / d) * over, b[1] + (dy / d) * over);
    }
    ctx.stroke();
  }

  // dimension line, slightly extended past the ticks
  const ux = (ex - sx) / len, uy = (ey - sy) / len;
  const ext = 3 / ppm;
  ctx.beginPath();
  ctx.moveTo(sx - ux * ext, sy - uy * ext);
  ctx.lineTo(ex + ux * ext, ey + uy * ext);
  ctx.stroke();

  const tick = Math.max(0.04, 3.5 / ppm);
  ctx.lineWidth = lw * (hovered ? 2.5 : 1.4);
  drawTick(ctx, sx, sy, tick);
  drawTick(ctx, ex, ey, tick);
}

function drawMeasure(
  ctx: CanvasRenderingContext2D,
  m: MeasureEntity,
  lw: number,
  ppm: number,
) {
  const [sx, sy] = m.start;
  const [ex, ey] = m.end;

  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;

  // Extension lines perpendicular to the measure direction
  const nx = -dy / len * 0.15;
  const ny = dx / len * 0.15;

  ctx.strokeStyle = '#BD10E0';
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 3, lw * 2]);

  // Main dimension line
  ctx.beginPath();
  ctx.moveTo(sx + nx, sy + ny);
  ctx.lineTo(ex + nx, ey + ny);
  ctx.stroke();
  ctx.setLineDash([]);

  // Extension lines
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + nx * 1.5, sy + ny * 1.5);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + nx * 1.5, ey + ny * 1.5);
  ctx.stroke();

  // Arrowheads
  const arrowSize = Math.max(0.08, 6 / ppm);
  const angle = Math.atan2(dy, dx);
  drawArrow(ctx, sx + nx, sy + ny, angle + Math.PI, arrowSize, lw);
  drawArrow(ctx, ex + nx, ey + ny, angle, arrowSize, lw);

  // Text: constant screen size, drawn upright along the line
  const midX = (sx + ex) / 2 + nx * 1.2;
  const midY = (sy + ey) / 2 + ny * 1.2;
  ctx.save();
  ctx.translate(midX, midY);
  let rot = Math.atan2(dy, dx);
  if (rot > Math.PI / 2 || rot < -Math.PI / 2) rot += Math.PI;
  ctx.rotate(rot);
  ctx.scale(1, -1);
  const label = m.label ?? `${(m.distance).toFixed(2)} m  (${Math.round(m.distance * 1000)} mm)`;
  const fontSize = 12 / ppm;
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.fillStyle = '#BD10E0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, 0, -lw * 2);
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  angle: number,
  size: number,
  lw: number,
) {
  void lw;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#BD10E0';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.3);
  ctx.lineTo(-size, -size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─── Screen-space labels with level of detail ─────────────────────────────────

interface LabelCtx {
  rooms: RoomEntity[];
  routes: WallEntity[];
  equipment: EquipmentEntity[];
  dims: MeasureEntity[];
  toScreen: (x: number, y: number) => [number, number];
  ppm: number;
  isLight: boolean;
  selected: Set<string>;
  hoverId: string | null;
  w: number;
  h: number;
}

interface Rect { x: number; y: number; w: number; h: number }

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  halo: string,
  angle = 0,
) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawLabels(ctx: CanvasRenderingContext2D, L: LabelCtx) {
  const placed: Rect[] = [];
  const halo = L.isLight ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,30,0.85)';
  const onScreen = (r: Rect) => r.x + r.w > 0 && r.x < L.w && r.y + r.h > 0 && r.y < L.h;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Rooms: code + name, area below when there is room. Priority: selected/hovered first, then large rooms.
  const rooms = [...L.rooms].sort((a, b) => {
    const pa = (L.selected.has(a.id) || L.hoverId === a.id) ? 1 : 0;
    const pb = (L.selected.has(b.id) || L.hoverId === b.id) ? 1 : 0;
    return pb - pa || b.area - a.area;
  });
  for (const room of rooms) {
    const c = polygonCentroid(room.polygon);
    const [sx, sy] = L.toScreen(c[0], c[1]);
    // room screen size
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of room.polygon) {
      const [px, py] = L.toScreen(x, y);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    const roomW = maxX - minX, roomH = maxY - minY;
    if (roomW < 28 || roomH < 16) continue;

    const code = typeof room.meta?.code === 'string' ? (room.meta!.code as string) : '';
    const name = code && room.name.startsWith(code) ? room.name.slice(code.length).trim() : room.name;
    const roomType = ROOM_TYPES.find(rt => rt.id === room.roomTypeId);
    const color = L.isLight ? darken(roomType?.color ?? '#6366f1') : (roomType?.color ?? '#a5b4fc');
    const big = roomW > 140 && roomH > 60;
    const fontPx = big ? 12 : 11;

    // Line 1: code (bold) - or code + name when wide enough
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
    let line1 = code || name;
    let width1 = ctx.measureText(line1).width;
    const nameFits = big && name && ctx.measureText(`${code} ${name}`).width < roomW - 12;
    if (nameFits) { line1 = code ? `${code}  ${name}` : name; width1 = ctx.measureText(line1).width; }
    if (width1 > roomW - 6) {
      // shrink to code only, or skip
      if (!code) continue;
      line1 = code;
      width1 = ctx.measureText(line1).width;
      if (width1 > roomW - 4) continue;
    }
    const line2 = big && roomH > 44 ? `${room.area.toFixed(1)} m²${!nameFits && name ? '  ' + truncate(name, 18) : ''}` : '';
    ctx.font = `400 ${fontPx - 1}px system-ui, sans-serif`;
    const width2 = line2 ? ctx.measureText(line2).width : 0;
    const lineH = fontPx + 3;
    const totalH = line2 ? lineH * 2 : lineH;
    const rect: Rect = { x: sx - Math.max(width1, width2) / 2 - 3, y: sy - totalH / 2 - 2, w: Math.max(width1, width2) + 6, h: totalH + 4 };
    if (!onScreen(rect)) continue;
    if (placed.some(r => overlaps(r, rect))) continue;
    placed.push(rect);

    const y1 = line2 ? sy - lineH / 2 : sy;
    ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
    haloText(ctx, line1, sx, y1, color, halo);
    if (line2) {
      ctx.font = `400 ${fontPx - 1}px system-ui, sans-serif`;
      haloText(ctx, line2, sx, sy + lineH / 2, L.isLight ? '#444' : '#cfcfcf', halo);
    }
  }

  // Dimension values (mm): only when the string is long enough on screen to hold the text.
  const dimColor = L.isLight ? DIM_COLOR : DIM_COLOR_DARK;
  ctx.font = `600 10.5px system-ui, sans-serif`;
  // Level of detail by tier (meta.tier from build.py): envelope + room strings at any zoom,
  // door widths from ~110 px/m, wall thicknesses from ~170 px/m. Longer strings are placed
  // first so they win the collision test at fit.
  const TIER_MIN_PPM = [0, 0, 110, 170];
  const dims = L.dims
    .map(m => {
      const [ax, ay] = L.toScreen(m.start[0], m.start[1]);
      const [bx, by] = L.toScreen(m.end[0], m.end[1]);
      return { m, ax, ay, bx, by, lenPx: Math.hypot(bx - ax, by - ay) };
    })
    .sort((a, b) => b.lenPx - a.lenPx);
  for (const { m, ax, ay, bx, by, lenPx } of dims) {
    const active = L.selected.has(m.id) || L.hoverId === m.id;
    const tier = typeof m.meta?.tier === 'number' ? (m.meta!.tier as number) : 1;
    const small = m.meta?.small === true;
    if (!active) {
      if (L.ppm < (TIER_MIN_PPM[tier] ?? 0)) continue;
      if (small && L.ppm < 220) continue;
    }
    const text = m.label ?? String(Math.round(m.distance * 1000));
    const tw = ctx.measureText(text).width;
    // the value has to fit inside its own string, with a small margin
    if (!active && tw + 10 > lenPx) continue;
    let ang = Math.atan2(by - ay, bx - ax);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    // offset the text 7 px to the side that lies away from the measured geometry
    let ox = -Math.sin(ang), oy = Math.cos(ang);
    const measured = Array.isArray(m.meta?.measured) ? (m.meta!.measured as Point2D[]) : null;
    if (measured && measured.length === 2) {
      const [mx0, my0] = L.toScreen(measured[0][0], measured[0][1]);
      const dxm = mx0 - ax, dym = my0 - ay;
      if (dxm * ox + dym * oy > 0) { ox = -ox; oy = -oy; }
    } else {
      ox = -ox; oy = -oy;
    }
    const cx = (ax + bx) / 2 + ox * 7;
    const cy = (ay + by) / 2 + oy * 7;
    const rect: Rect = { x: cx - tw / 2 - 2, y: cy - 7, w: tw + 4, h: 14 };
    if (!onScreen(rect)) continue;
    if (placed.some(r => overlaps(r, rect))) continue;
    placed.push(rect);
    haloText(ctx, text, cx, cy, (L.selected.has(m.id) || L.hoverId === m.id) ? SELECTION_COLOR : dimColor, halo, ang);
  }

  // MEP routes: "SUP-3.1 DN250" along the longest segment from ~30 px/m
  if (L.ppm >= 30) {
    ctx.font = '600 10px system-ui, sans-serif';
    for (const r of L.routes) {
      let best: [Point2D, Point2D] | null = null, bestLen = 0;
      for (let i = 0; i < r.points.length - 1; i++) {
        const len = Math.hypot(r.points[i + 1][0] - r.points[i][0], r.points[i + 1][1] - r.points[i][1]);
        if (len > bestLen) { bestLen = len; best = [r.points[i], r.points[i + 1]]; }
      }
      if (!best) continue;
      const text = `${r.meta?.route ?? ''} ${r.meta?.size ?? ''}`.trim();
      if (!text) continue;
      const [ax, ay] = L.toScreen(best[0][0], best[0][1]);
      const [bx, by] = L.toScreen(best[1][0], best[1][1]);
      const tw = ctx.measureText(text).width;
      if (tw + 8 > Math.hypot(bx - ax, by - ay) && !L.selected.has(r.id) && L.hoverId !== r.id) continue;
      let ang = Math.atan2(by - ay, bx - ax);
      if (ang > Math.PI / 2 || ang <= -Math.PI / 2) ang += Math.PI;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const off = Math.max(6, (r.thickness * L.ppm) / 2 + 6);
      const lx = mx - Math.sin(ang) * off, ly = my + Math.cos(ang) * off;
      const rect = { x: lx - tw / 2, y: ly - 6, w: tw, h: 12 };
      if (!onScreen(rect) || placed.some(p => overlaps(p, rect))) continue;
      placed.push(rect);
      haloText(ctx, text, lx, ly, ROUTE_COLORS[String(r.meta?.route_kind)] ?? '#556', halo, ang);
    }
  }

  // Equipment: name once the box is wide enough; existing fit-out (tables/lights) only when big.
  ctx.font = `500 10px system-ui, sans-serif`;
  for (const eq of L.equipment) {
    const wPx = eq.dimensions[0] * L.ppm, hPx = eq.dimensions[1] * L.ppm;
    const isFitout = eq.layer.includes('table') || eq.layer.includes('light');
    if (isFitout && (wPx < 90 || hPx < 40)) continue;
    if (!isFitout && Math.max(wPx, hPx) < 34) continue;
    const def = getEquipmentById(eq.equipmentId);
    const bound = eq.binding?.name;
    const text = truncate(bound ?? def?.name ?? (typeof eq.meta?.label === 'string' ? (eq.meta!.label as string) : eq.equipmentId), 22);
    const [sx, sy] = L.toScreen(eq.center[0], eq.center[1]);
    const tw = ctx.measureText(text).width;
    if (tw > Math.max(wPx, hPx) + 20) continue;
    const rect: Rect = { x: sx - tw / 2 - 2, y: sy - 7, w: tw + 4, h: 14 };
    if (!onScreen(rect)) continue;
    if (placed.some(r => overlaps(r, rect))) continue;
    placed.push(rect);
    const st = equipmentStyle(eq, L.isLight);
    haloText(ctx, text, sx, sy, (L.selected.has(eq.id) || L.hoverId === eq.id) ? SELECTION_COLOR : st.stroke, halo);
  }
}


/** Nearest room edge or wall segment to a world point (for the door tool). */
function nearestEdge(
  p: Point2D,
  entities: Record<string, FloorplanEntity>,
  layers: { id: string; visible: boolean }[],
  maxDist: number,
  scope?: Set<string> | null,
): { ownerId: string; edgeIndex: number; t: number } | null {
  const layerVis = new Map(layers.map(l => [l.id, l.visible]));
  let best: { ownerId: string; edgeIndex: number; t: number; d: number } | null = null;
  const consider = (ownerId: string, a: Point2D, b: Point2D, idx: number) => {
    const d = distanceToSegment(p, a, b);
    if (d > maxDist || (best && d >= best.d)) return;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0.05, Math.min(0.95, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    best = { ownerId, edgeIndex: idx, t, d };
  };
  for (const e of Object.values(entities)) {
    if (!e.visible || layerVis.get(e.layer) === false) continue;
    if (scope && !scope.has(e.id)) continue;
    if (e.type === 'room') {
      const poly = (e as RoomEntity).polygon;
      for (let i = 0; i < poly.length; i++) consider(e.id, poly[i], poly[(i + 1) % poly.length], i);
    } else if (e.type === 'wall') {
      const pts = (e as WallEntity).points;
      for (let i = 0; i < pts.length - 1; i++) consider(e.id, pts[i], pts[i + 1], i);
    }
  }
  return best;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function darken(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * 0.6);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * 0.6);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * 0.6);
  return `rgb(${r},${g},${b})`;
}

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  e: FloorplanEntity,
  lw: number,
  ppm: number,
  entities: Record<string, FloorplanEntity>,
) {
  const handleR = HANDLE_RADIUS / ppm;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.fillStyle = SELECTION_FILL;
  ctx.lineWidth = lw * 2;
  ctx.setLineDash([lw * 3, lw * 2]);

  if (e.type === 'room') {
    const room = e as RoomEntity;
    ctx.beginPath();
    room.polygon.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertex handles (only for editable rooms)
    if (!room.locked) {
      ctx.fillStyle = SELECTION_COLOR;
      room.polygon.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, handleR, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  } else if (e.type === 'wall') {
    const wall = e as WallEntity;
    ctx.lineWidth = wall.thickness + lw * 4;
    ctx.strokeStyle = hexWithAlpha(SELECTION_COLOR, 0.35);
    ctx.setLineDash([]);
    ctx.beginPath();
    wall.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    if (!wall.locked) {
      ctx.fillStyle = SELECTION_COLOR;
      wall.points.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, handleR, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  } else if (e.type === 'equipment') {
    const eq = e as EquipmentEntity;
    const [cx, cy] = eq.center;
    const [hw, hd] = [eq.dimensions[0] / 2, eq.dimensions[1] / 2];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((eq.rotation * Math.PI) / 180);
    ctx.beginPath();
    ctx.rect(-hw - handleR, -hd - handleR, eq.dimensions[0] + handleR * 2, eq.dimensions[1] + handleR * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  } else if (e.type === 'measure') {
    const m = e as MeasureEntity;
    ctx.setLineDash([]);
    ctx.lineWidth = lw * 6;
    ctx.strokeStyle = hexWithAlpha(SELECTION_COLOR, 0.35);
    ctx.beginPath();
    ctx.moveTo(m.start[0], m.start[1]);
    ctx.lineTo(m.end[0], m.end[1]);
    ctx.stroke();
  } else if (e.type === 'door') {
    const seg = doorSegment(e as DoorEntity, entities[(e as DoorEntity).wallOwner]);
    if (seg) {
      ctx.setLineDash([]);
      ctx.lineWidth = lw * 8;
      ctx.strokeStyle = hexWithAlpha(SELECTION_COLOR, 0.35);
      ctx.beginPath();
      ctx.moveTo(seg[0][0], seg[0][1]);
      ctx.lineTo(seg[1][0], seg[1][1]);
      ctx.stroke();
    }
  } else if (e.type === 'note') {
    const n = e as NoteEntity;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(n.position[0], n.position[1], handleR * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawRoomPreview(
  ctx: CanvasRenderingContext2D,
  points: Point2D[],
  mousePos: Point2D,
  lw: number,
) {
  if (points.length === 0) return;
  const allPts = [...points, mousePos];

  ctx.strokeStyle = '#3B9EFF';
  ctx.lineWidth = lw * 2;
  ctx.setLineDash([lw * 4, lw * 2]);
  ctx.beginPath();
  ctx.moveTo(allPts[0][0], allPts[0][1]);
  allPts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  if (points.length >= 3) {
    ctx.lineTo(points[0][0], points[0][1]); // Close preview
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Placed vertices
  ctx.fillStyle = '#3B9EFF';
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, lw * 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // First vertex snap indicator
  if (points.length >= 3) {
    ctx.strokeStyle = '#3B9EFF';
    ctx.lineWidth = lw * 2;
    ctx.beginPath();
    ctx.arc(points[0][0], points[0][1], lw * 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawWallPreview(
  ctx: CanvasRenderingContext2D,
  points: Point2D[],
  mousePos: Point2D,
  lw: number,
) {
  if (points.length === 0) return;
  const allPts = [...points, mousePos];

  ctx.strokeStyle = '#9CA3AF';
  ctx.lineWidth = 0.2; // 0.2m wall
  ctx.lineCap = 'round';
  ctx.setLineDash([lw * 4, lw * 2]);
  ctx.beginPath();
  ctx.moveTo(allPts[0][0], allPts[0][1]);
  allPts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.stroke();
  ctx.setLineDash([]);

  // Vertices
  ctx.fillStyle = '#9CA3AF';
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, lw * 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawMeasurePreview(
  ctx: CanvasRenderingContext2D,
  start: Point2D,
  end: Point2D,
  lw: number,
  ppm: number,
) {
  ctx.strokeStyle = '#BD10E0';
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 3, lw * 2]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
  ctx.setLineDash([]);

  const dist = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const midX = (start[0] + end[0]) / 2;
  const midY = (start[1] + end[1]) / 2;
  ctx.save();
  ctx.translate(midX, midY);
  ctx.scale(1, -1);
  ctx.font = `0.15px sans-serif`;
  ctx.fillStyle = '#BD10E0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${dist.toFixed(2)} m`, 0, 0);
  ctx.restore();
}

function drawEquipmentPreview(
  ctx: CanvasRenderingContext2D,
  pos: Point2D,
  equipmentId: string,
  lw: number,
) {
  const equipDef = getEquipmentById(equipmentId);
  const w = (equipDef as any)?.dimensions?.width ?? 1.0;
  const d = (equipDef as any)?.dimensions?.depth ?? 1.0;
  ctx.save();
  ctx.translate(pos[0], pos[1]);
  ctx.fillStyle = 'rgba(16,185,129,0.2)';
  ctx.strokeStyle = '#10B981';
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 3, lw * 2]);
  ctx.beginPath();
  ctx.rect(-w / 2, -d / 2, w, d);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}
