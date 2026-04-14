import { memo, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow, useStore } from 'reactflow';
import { useUpdateShape } from '@workspace/api-client-react';

const SHAPE_COLORS = [
  { label: 'Índigo', value: '#6366f1' },
  { label: 'Azul', value: '#2563eb' },
  { label: 'Verde', value: '#16a34a' },
  { label: 'Vermelho', value: '#dc2626' },
  { label: 'Laranja', value: '#ea580c' },
  { label: 'Cinza', value: '#6b7280' },
];

interface ShapeNodeData {
  type: 'line' | 'rect' | 'ellipse';
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  color: string;
  filled: boolean;
  strokeStyle: 'solid' | 'dashed';
  workspaceId: string;
  mapId: string;
  x1?: number | null;
  y1?: number | null;
  x2?: number | null;
  y2?: number | null;
  onBeforeMutate?: () => void;
}

interface ShapeNodeProps {
  id: string;
  data: ShapeNodeData;
  selected: boolean;
  xPos: number;
  yPos: number;
}

const HANDLE_SIZE = 8;

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

function ShapeNode({ id, data, selected, xPos, yPos }: ShapeNodeProps) {
  const [width, setWidth] = useState(data.width);
  const [height, setHeight] = useState(data.height);
  const [color, setColor] = useState(data.color);
  const [filled, setFilled] = useState(data.filled);
  const [strokeStyle, setStrokeStyle] = useState(data.strokeStyle);

  const getDefaultLineCoords = useCallback((w: number) => ({
    lx1: 0,
    ly1: 0,
    lx2: w,
    ly2: 0,
  }), []);

  const [lx1, setLx1] = useState(() =>
    data.type === 'line' && data.x1 != null ? data.x1 : 0
  );
  const [ly1, setLy1] = useState(() =>
    data.type === 'line' && data.y1 != null ? data.y1 : 0
  );
  const [lx2, setLx2] = useState(() =>
    data.type === 'line' && data.x2 != null ? data.x2 : data.width
  );
  const [ly2, setLy2] = useState(() =>
    data.type === 'line' && data.y2 != null ? data.y2 : 0
  );

  const { setNodes, getZoom, getNode } = useReactFlow();
  const transform = useStore(state => state.transform);
  const updateMut = useUpdateShape();

  const menuPos = selected ? {
    top: yPos * transform[2] + transform[1] - 52,
    left: xPos * transform[2] + transform[0],
  } : { top: 0, left: 0 };

  useEffect(() => {
    setWidth(data.width);
    setHeight(data.height);
    setColor(data.color);
    setFilled(data.filled);
    setStrokeStyle(data.strokeStyle);
  }, [data.width, data.height, data.color, data.filled, data.strokeStyle]);

  useEffect(() => {
    if (data.type === 'line') {
      const defaults = getDefaultLineCoords(data.width);
      setLx1(data.x1 != null ? data.x1 : defaults.lx1);
      setLy1(data.y1 != null ? data.y1 : defaults.ly1);
      setLx2(data.x2 != null ? data.x2 : defaults.lx2);
      setLy2(data.y2 != null ? data.y2 : defaults.ly2);
    }
  }, [data.type, data.x1, data.y1, data.x2, data.y2, data.width, getDefaultLineCoords]);

  const saveStyle = useCallback((patch: {
    color?: string;
    filled?: boolean;
    strokeStyle?: 'solid' | 'dashed';
  }) => {
    data.onBeforeMutate?.();
    updateMut.mutate({
      workspaceId: data.workspaceId,
      mapId: data.mapId,
      shapeId: id,
      data: patch,
    });
  }, [data, id, updateMut]);

  const handleColorChange = useCallback((c: string) => {
    setColor(c);
    saveStyle({ color: c });
  }, [saveStyle]);

  const handleFilledToggle = useCallback(() => {
    const next = !filled;
    setFilled(next);
    saveStyle({ filled: next });
  }, [filled, saveStyle]);

  const handleStrokeStyleToggle = useCallback(() => {
    const next = strokeStyle === 'solid' ? 'dashed' : 'solid';
    setStrokeStyle(next);
    saveStyle({ strokeStyle: next });
  }, [strokeStyle, saveStyle]);

  const startResizeLine = useCallback((e: React.MouseEvent, endpoint: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startNode = getNode(id);
    const nodePosX = startNode?.position.x ?? data.positionX;
    const nodePosY = startNode?.position.y ?? data.positionY;

    const canvasX1 = nodePosX + lx1;
    const canvasY1 = nodePosY + ly1;
    const canvasX2 = nodePosX + lx2;
    const canvasY2 = nodePosY + ly2;

    const compute = (ev: MouseEvent) => {
      const zoom = getZoom();
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;

      let newCanvasX1 = canvasX1;
      let newCanvasY1 = canvasY1;
      let newCanvasX2 = canvasX2;
      let newCanvasY2 = canvasY2;

      if (endpoint === 'start') {
        newCanvasX1 = canvasX1 + dx;
        newCanvasY1 = canvasY1 + dy;
      } else {
        newCanvasX2 = canvasX2 + dx;
        newCanvasY2 = canvasY2 + dy;
      }

      const minX = Math.min(newCanvasX1, newCanvasX2);
      const minY = Math.min(newCanvasY1, newCanvasY2);
      const maxX = Math.max(newCanvasX1, newCanvasX2);
      const maxY = Math.max(newCanvasY1, newCanvasY2);

      const newNodePosX = minX;
      const newNodePosY = minY;
      const newW = Math.max(maxX - minX, 4);
      const newH = Math.max(maxY - minY, 4);

      const newLocalX1 = newCanvasX1 - minX;
      const newLocalY1 = newCanvasY1 - minY;
      const newLocalX2 = newCanvasX2 - minX;
      const newLocalY2 = newCanvasY2 - minY;

      return { newNodePosX, newNodePosY, newW, newH, newLocalX1, newLocalY1, newLocalX2, newLocalY2 };
    };

    const onMove = (ev: MouseEvent) => {
      const { newNodePosX, newNodePosY, newW, newH, newLocalX1, newLocalY1, newLocalX2, newLocalY2 } = compute(ev);
      setLx1(newLocalX1);
      setLy1(newLocalY1);
      setLx2(newLocalX2);
      setLy2(newLocalY2);
      setWidth(newW);
      setHeight(newH);
      setNodes(nodes => nodes.map(n =>
        n.id === id ? { ...n, position: { x: newNodePosX, y: newNodePosY } } : n
      ));
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const { newNodePosX, newNodePosY, newW, newH, newLocalX1, newLocalY1, newLocalX2, newLocalY2 } = compute(ev);
      data.onBeforeMutate?.();
      updateMut.mutate({
        workspaceId: data.workspaceId,
        mapId: data.mapId,
        shapeId: id,
        data: {
          positionX: newNodePosX,
          positionY: newNodePosY,
          width: newW,
          height: newH,
          x1: newLocalX1,
          y1: newLocalY1,
          x2: newLocalX2,
          y2: newLocalY2,
        },
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [lx1, ly1, lx2, ly2, data, id, updateMut, setNodes, getZoom, getNode]);

  const startResize = useCallback((e: React.MouseEvent, handle: ResizeHandle) => {
    e.stopPropagation();
    e.preventDefault();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startW = width;
    const startH = height;
    const startNode = getNode(id);
    const startPosX = startNode?.position.x ?? data.positionX;
    const startPosY = startNode?.position.y ?? data.positionY;

    const compute = (ev: MouseEvent) => {
      const zoom = getZoom();
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;
      let newW = startW;
      let newH = startH;
      let newPosX = startPosX;
      let newPosY = startPosY;

      if (handle.includes('e')) newW = Math.max(40, startW + dx);
      if (handle.includes('w')) {
        newW = Math.max(40, startW - dx);
        newPosX = startPosX + (startW - newW);
      }
      if (handle.includes('s')) newH = Math.max(20, startH + dy);
      if (handle.includes('n')) {
        newH = Math.max(20, startH - dy);
        newPosY = startPosY + (startH - newH);
      }
      return { newW, newH, newPosX, newPosY };
    };

    const onMove = (ev: MouseEvent) => {
      const { newW, newH, newPosX, newPosY } = compute(ev);
      setWidth(newW);
      setHeight(newH);
      if (newPosX !== startPosX || newPosY !== startPosY) {
        setNodes(nodes => nodes.map(n =>
          n.id === id ? { ...n, position: { x: newPosX, y: newPosY } } : n
        ));
      }
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const { newW, newH, newPosX, newPosY } = compute(ev);
      data.onBeforeMutate?.();
      updateMut.mutate({
        workspaceId: data.workspaceId,
        mapId: data.mapId,
        shapeId: id,
        data: { width: newW, height: newH, positionX: newPosX, positionY: newPosY },
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, height, data.positionX, data.positionY, data.workspaceId, data.mapId, id, updateMut, setNodes, getZoom, getNode]);

  const strokeDash = strokeStyle === 'dashed' ? '8 5' : undefined;
  const fillColor = filled ? color + '33' : 'none';

  const svgW = data.type === 'line' ? Math.max(width, 4) : width;
  const svgH = data.type === 'line' ? Math.max(height, 4) : height;

  const lineHandles = data.type === 'line'
    ? [
        { endpoint: 'start' as const, cx: lx1, cy: ly1 },
        { endpoint: 'end' as const, cx: lx2, cy: ly2 },
      ]
    : [];

  const rectHandlePositions: { handle: ResizeHandle; cx: number; cy: number }[] = data.type !== 'line'
    ? [
        { handle: 'nw', cx: 0, cy: 0 },
        { handle: 'n',  cx: svgW / 2, cy: 0 },
        { handle: 'ne', cx: svgW, cy: 0 },
        { handle: 'e',  cx: svgW, cy: svgH / 2 },
        { handle: 'se', cx: svgW, cy: svgH },
        { handle: 's',  cx: svgW / 2, cy: svgH },
        { handle: 'sw', cx: 0, cy: svgH },
        { handle: 'w',  cx: 0, cy: svgH / 2 },
      ]
    : [];

  const cursorMap: Record<ResizeHandle, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    e: 'e-resize', se: 'se-resize', s: 's-resize',
    sw: 'sw-resize', w: 'w-resize',
  };

  const styleToolbar = selected ? createPortal(
    <div
      className="fixed z-[9999] flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-3 py-2"
      style={{ top: menuPos.top, left: menuPos.left, minWidth: 220 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        {SHAPE_COLORS.map(c => (
          <button
            key={c.value}
            title={c.label}
            className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${color === c.value ? 'border-gray-800 dark:border-white scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c.value }}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleColorChange(c.value); }}
          />
        ))}
      </div>

      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

      {data.type !== 'line' && (
        <>
          <button
            title={filled ? 'Remover preenchimento' : 'Adicionar preenchimento'}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleFilledToggle(); }}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${filled ? 'bg-gray-800 text-white border-gray-800 dark:bg-white dark:text-gray-900 dark:border-white' : 'bg-transparent border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline">
              <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill={filled ? 'currentColor' : 'none'} fillOpacity={0.3} />
            </svg>
          </button>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
        </>
      )}

      <button
        title={strokeStyle === 'solid' ? 'Linha tracejada' : 'Linha contínua'}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleStrokeStyleToggle(); }}
        className={`text-xs px-2 py-0.5 rounded border transition-colors ${strokeStyle === 'dashed' ? 'bg-gray-800 text-white border-gray-800 dark:bg-white dark:text-gray-900 dark:border-white' : 'bg-transparent border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
      >
        <svg width="20" height="6" viewBox="0 0 20 6" className="inline">
          {strokeStyle === 'dashed'
            ? <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
            : <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="2" />
          }
        </svg>
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {styleToolbar}
      <div
        style={{ position: 'relative', width: svgW, height: svgH, userSelect: 'none' }}
      >
        <svg
          width={svgW}
          height={svgH}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          {data.type === 'rect' && (
            <rect
              x={1.5}
              y={1.5}
              width={svgW - 3}
              height={svgH - 3}
              rx={4}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={strokeDash}
              fill={fillColor}
              pointerEvents="all"
              style={{ cursor: 'grab' }}
            />
          )}
          {data.type === 'ellipse' && (
            <ellipse
              cx={svgW / 2}
              cy={svgH / 2}
              rx={svgW / 2 - 1.5}
              ry={svgH / 2 - 1.5}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={strokeDash}
              fill={fillColor}
              pointerEvents="all"
              style={{ cursor: 'grab' }}
            />
          )}
          {data.type === 'line' && (
            <line
              x1={lx1}
              y1={ly1}
              x2={lx2}
              y2={ly2}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={strokeDash}
              pointerEvents="all"
              style={{ cursor: 'grab' }}
            />
          )}

          {selected && data.type === 'line' && lineHandles.map(({ endpoint, cx, cy }) => (
            <rect
              key={endpoint}
              x={cx - HANDLE_SIZE / 2}
              y={cy - HANDLE_SIZE / 2}
              width={HANDLE_SIZE}
              height={HANDLE_SIZE}
              rx={1}
              fill="white"
              stroke={color}
              strokeWidth={1.5}
              className="nodrag"
              style={{ cursor: 'crosshair' }}
              pointerEvents="all"
              onMouseDown={e => startResizeLine(e, endpoint)}
            />
          ))}

          {selected && data.type !== 'line' && rectHandlePositions.map(({ handle, cx, cy }) => (
            <rect
              key={handle}
              x={cx - HANDLE_SIZE / 2}
              y={cy - HANDLE_SIZE / 2}
              width={HANDLE_SIZE}
              height={HANDLE_SIZE}
              rx={1}
              fill="white"
              stroke={color}
              strokeWidth={1.5}
              className="nodrag"
              style={{ cursor: cursorMap[handle] }}
              pointerEvents="all"
              onMouseDown={e => startResize(e, handle)}
            />
          ))}
        </svg>
      </div>
    </>
  );
}

export default memo(ShapeNode);
