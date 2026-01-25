import { useRef, useEffect, useState, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { EditorTool, Layer, CanvasState } from '../../pages/floorplan/FloorplanEditor';
import type { DxfEntity, ParsedDxf } from '../../services/dxfParser';
import { getColorFromAci } from '../../services/dxfParser';

interface CanvasProps {
  projectId: string;
  activeTool: EditorTool;
  layers: Layer[];
  canvasState: CanvasState;
  onCanvasStateChange: (state: CanvasState) => void;
  selectedElement: string | null;
  onSelectElement: (id: string | null) => void;
  dxfData?: ParsedDxf | null;
}

export function Canvas({
  projectId,
  activeTool,
  layers,
  canvasState,
  onCanvasStateChange,
  selectedElement,
  onSelectElement,
  dxfData,
}: CanvasProps) {
  const { colors } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const container = containerRef.current;
    if (!container) return;

    // Set canvas size to container size
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.fillStyle = colors.canvas;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply transformations
    ctx.save();
    ctx.translate(canvas.width / 2 + canvasState.panX, canvas.height / 2 + canvasState.panY);
    ctx.scale(canvasState.zoom / 100, canvasState.zoom / 100);

    // Draw grid
    drawGrid(ctx, canvas.width, canvas.height, canvasState.zoom);

    // Draw origin crosshair
    ctx.strokeStyle = colors.textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(20, 0);
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 20);
    ctx.stroke();

    // Draw DXF entities if loaded
    if (dxfData && dxfData.entities.length > 0) {
      drawDxfEntities(ctx, dxfData);
    }

    ctx.restore();
  }, [canvasState, layers, colors, dxfData]);

  const drawDxfEntities = (ctx: CanvasRenderingContext2D, dxf: ParsedDxf) => {
    // Center the drawing based on bounds
    const centerX = (dxf.bounds.minX + dxf.bounds.maxX) / 2;
    const centerY = (dxf.bounds.minY + dxf.bounds.maxY) / 2;

    ctx.save();
    // Flip Y axis (CAD uses Y-up, canvas uses Y-down)
    ctx.scale(1, -1);
    // Center the drawing
    ctx.translate(-centerX, -centerY);

    dxf.entities.forEach(entity => {
      // Check if layer is visible
      const layerConfig = layers.find(l => l.name.toLowerCase() === entity.layer.toLowerCase());
      if (layerConfig && !layerConfig.visible) return;

      // Set color
      const color = entity.color ? getColorFromAci(entity.color) : '#FFFFFF';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;

      drawEntity(ctx, entity);
    });

    ctx.restore();
  };

  const drawEntity = (ctx: CanvasRenderingContext2D, entity: DxfEntity) => {
    switch (entity.type) {
      case 'line':
        if (entity.vertices && entity.vertices.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
          ctx.lineTo(entity.vertices[1].x, entity.vertices[1].y);
          ctx.stroke();
        }
        break;

      case 'polyline':
        if (entity.vertices && entity.vertices.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
          entity.vertices.slice(1).forEach(v => {
            ctx.lineTo(v.x, v.y);
          });
          ctx.stroke();
        }
        break;

      case 'circle':
        if (entity.center && entity.radius) {
          ctx.beginPath();
          ctx.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;

      case 'arc':
        if (entity.center && entity.radius) {
          const startAngle = ((entity.startAngle || 0) * Math.PI) / 180;
          const endAngle = ((entity.endAngle || 360) * Math.PI) / 180;
          ctx.beginPath();
          ctx.arc(entity.center.x, entity.center.y, entity.radius, startAngle, endAngle);
          ctx.stroke();
        }
        break;

      case 'text':
        if (entity.text && entity.position) {
          ctx.save();
          ctx.translate(entity.position.x, entity.position.y);
          ctx.scale(1, -1); // Flip text right-side up
          ctx.rotate(((entity.rotation || 0) * Math.PI) / 180);
          ctx.font = `${entity.height || 10}px Arial`;
          ctx.fillText(entity.text, 0, 0);
          ctx.restore();
        }
        break;

      case 'solid':
      case 'hatch':
        if (entity.vertices && entity.vertices.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
          entity.vertices.slice(1).forEach(v => {
            ctx.lineTo(v.x, v.y);
          });
          ctx.closePath();
          ctx.globalAlpha = 0.3;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
        break;

      case 'spline':
        if (entity.vertices && entity.vertices.length >= 2) {
          // Simplified spline as polyline
          ctx.beginPath();
          ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
          entity.vertices.slice(1).forEach(v => {
            ctx.lineTo(v.x, v.y);
          });
          ctx.stroke();
        }
        break;

      case 'ellipse':
        if (entity.center) {
          // Simplified - draw as circle
          ctx.beginPath();
          ctx.arc(entity.center.x, entity.center.y, 50, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;

      case 'dimension':
        // Draw dimension lines and text
        if (entity.vertices && entity.vertices.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
          entity.vertices.slice(1).forEach(v => {
            ctx.lineTo(v.x, v.y);
          });
          ctx.stroke();
          
          if (entity.text && entity.vertices.length > 0) {
            const midX = entity.vertices.reduce((sum, v) => sum + v.x, 0) / entity.vertices.length;
            const midY = entity.vertices.reduce((sum, v) => sum + v.y, 0) / entity.vertices.length;
            ctx.save();
            ctx.translate(midX, midY);
            ctx.scale(1, -1);
            ctx.font = '8px Arial';
            ctx.fillText(entity.text, 0, 0);
            ctx.restore();
          }
        }
        break;

      default:
        // Unknown entity type
        break;
    }
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, zoom: number) => {
    const gridSize = 50; // 50 units = 1m at 1:100 scale
    const scaledGrid = gridSize * (zoom / 100);
    
    // Only draw grid if not too small
    if (scaledGrid < 10) return;

    ctx.strokeStyle = colors.canvasGrid;
    ctx.lineWidth = 0.5;

    // Calculate grid bounds
    const startX = -Math.ceil(width / scaledGrid) * gridSize;
    const endX = Math.ceil(width / scaledGrid) * gridSize;
    const startY = -Math.ceil(height / scaledGrid) * gridSize;
    const endY = Math.ceil(height / scaledGrid) * gridSize;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  };

  // Handle mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'pan' || e.button === 1) { // Middle click or pan tool
      setIsPanning(true);
      setPanStart({ x: e.clientX - canvasState.panX, y: e.clientY - canvasState.panY });
    }
  }, [activeTool, canvasState.panX, canvasState.panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2 - canvasState.panX;
    const y = e.clientY - rect.top - rect.height / 2 - canvasState.panY;
    
    // Convert to world coordinates
    const worldX = Math.round(x / (canvasState.zoom / 100));
    const worldY = Math.round(-y / (canvasState.zoom / 100)); // Invert Y

    onCanvasStateChange({
      ...canvasState,
      cursorX: worldX,
      cursorY: worldY,
    });

    if (isPanning) {
      onCanvasStateChange({
        ...canvasState,
        panX: e.clientX - panStart.x,
        panY: e.clientY - panStart.y,
        cursorX: worldX,
        cursorY: worldY,
      });
    }
  }, [isPanning, panStart, canvasState, onCanvasStateChange]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -10 : 10;
    const newZoom = Math.max(25, Math.min(400, canvasState.zoom + delta));
    onCanvasStateChange({ ...canvasState, zoom: newZoom });
  }, [canvasState, onCanvasStateChange]);

  const handleDoubleClick = useCallback(() => {
    // Reset view
    onCanvasStateChange({
      ...canvasState,
      zoom: 100,
      panX: 0,
      panY: 0,
    });
  }, [canvasState, onCanvasStateChange]);

  const styles = {
    container: {
      width: '100%',
      height: '100%',
      position: 'relative' as const,
      overflow: 'hidden',
      cursor: activeTool === 'pan' || isPanning ? 'grab' : 
              activeTool === 'select' ? 'default' :
              'crosshair',
    },
    canvas: {
      width: '100%',
      height: '100%',
      display: 'block',
    } as const,
    hint: {
      position: 'absolute' as const,
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 16px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      fontSize: '13px',
      color: colors.textSecondary,
      pointerEvents: 'none' as const,
    },
    info: {
      position: 'absolute' as const,
      top: '16px',
      right: '16px',
      padding: '8px 12px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.accent}`,
      borderRadius: '8px',
      fontSize: '12px',
      color: colors.text,
    },
  };

  return (
    <div
      ref={containerRef}
      style={styles.container}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <canvas ref={canvasRef} style={styles.canvas} />
      
      {/* Hint for empty canvas */}
      {!dxfData && (
        <div style={styles.hint}>
          Press <kbd style={{ 
            padding: '2px 6px', 
            backgroundColor: colors.bg, 
            borderRadius: '4px',
            fontFamily: 'monospace',
          }}>/</kbd> to open AI command bar
        </div>
      )}
      
      {/* DXF info */}
      {dxfData && (
        <div style={styles.info}>
          <div><strong>DXF Loaded</strong></div>
          <div>{dxfData.entities.length} entities</div>
          <div>{dxfData.layers.length} layers</div>
        </div>
      )}
    </div>
  );
}
