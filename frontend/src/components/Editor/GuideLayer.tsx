import React from 'react';
import { Rnd } from 'react-rnd';
import type { Guide } from './SnapEngine';

interface GuideLayerProps {
  guides: Guide[];
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  onUpdateGuide: (id: string, newPosition: number) => void;
  onRemoveGuide: (id: string) => void;
}

export default function GuideLayer({
  guides,
  canvasWidth,
  canvasHeight,
  scale,
  onUpdateGuide,
  onRemoveGuide,
}: GuideLayerProps) {
  return (
    <>
      {guides.map((guide) => {
        const isH = guide.axis === 'horizontal';
        
        // We use react-rnd for dragging the guide line
        return (
          <Rnd
            key={guide.id}
            size={{
              width: isH ? canvasWidth : 10,
              height: isH ? 10 : canvasHeight,
            }}
            position={{
              x: isH ? 0 : guide.position - 5, // -5 to center the hit area
              y: isH ? guide.position - 5 : 0,
            }}
            scale={scale}
            enableResizing={false}
            dragAxis={isH ? 'y' : 'x'}
            bounds="parent" // Keeps it inside canvas roughly, but we can allow deletion by dragging out
            onDragStop={(e, d) => {
              const newPos = isH ? d.y + 5 : d.x + 5;
              // If dragged outside canvas (roughly), remove it
              if (newPos < 0 || newPos > (isH ? canvasHeight : canvasWidth)) {
                onRemoveGuide(guide.id);
              } else {
                onUpdateGuide(guide.id, newPos);
              }
            }}
            onDoubleClick={() => onRemoveGuide(guide.id)}
            style={{
              zIndex: 9997, // Below active snap lines
              cursor: isH ? 'ns-resize' : 'ew-resize',
            }}
          >
            {/* The actual visible cyan line */}
            <div
              style={{
                position: 'absolute',
                top: isH ? 5 : 0,
                left: isH ? 0 : 5,
                width: isH ? '100%' : 1,
                height: isH ? 1 : '100%',
                backgroundColor: '#06b6d4',
                pointerEvents: 'none', // line itself doesn't block clicks, the Rnd wrapper does
              }}
            />
          </Rnd>
        );
      })}
    </>
  );
}
