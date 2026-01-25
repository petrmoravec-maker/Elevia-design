import React, { useEffect, useRef } from 'react';
import './SplineConfigTool.css';

/**
 * 3D Config Tool - Spline Animation Configuration
 * 
 * This is a wrapper component that embeds the existing HTML implementation
 * until full React/TypeScript conversion is complete.
 * 
 * For full React conversion, see README.md in this directory.
 */
export default function SplineConfigTool() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // The tool is currently implemented as standalone HTML
    // This component provides a container for it
    console.log('3D Config Tool loaded');
  }, []);

  return (
    <div className="spline-config-tool-container" style={{
      width: '100%',
      height: '100vh',
      overflow: 'hidden',
      position: 'relative'
    }}>
      <iframe
        ref={iframeRef}
        src="/spline-tool-v1.html"
        title="3D Config Tool"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block'
        }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups"
      />
      
      {/* Loading indicator */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#00d4e8',
          fontSize: '14px',
          fontWeight: 500,
          pointerEvents: 'none'
        }}
        id="loading-indicator"
      >
        Loading 3D Config Tool...
      </div>
    </div>
  );
}

// Hide loading indicator after iframe loads
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    const indicator = document.getElementById('loading-indicator');
    if (indicator) {
      setTimeout(() => {
        indicator.style.display = 'none';
      }, 1000);
    }
  });
}

