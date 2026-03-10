import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import './SplineConfigTool.css';

interface SplineConfigToolProps {
  projectId?: string;
}

export default function SplineConfigTool({ projectId }: SplineConfigToolProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const configSentRef = useRef(false);

  const sendConfigToIframe = useCallback((configData: Record<string, unknown> | null) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    iframe.contentWindow.postMessage({
      type: 'loadConfig',
      projectId,
      configData,
    }, '*');
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    configSentRef.current = false;

    const loadProject = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'design_projects', projectId));
        if (docSnap.exists()) {
          const data = docSnap.data();
          sendConfigToIframe(data.configData || null);
          configSentRef.current = true;
        }
      } catch (error) {
        console.error('Error loading 3D config project:', error);
      }
    };

    const onIframeLoad = () => {
      if (!configSentRef.current) {
        loadProject();
      } else {
        const docRef = doc(db, 'design_projects', projectId);
        getDoc(docRef).then(snap => {
          if (snap.exists()) {
            sendConfigToIframe(snap.data().configData || null);
          }
        });
      }
    };

    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', onIframeLoad);
    }

    loadProject();

    return () => {
      if (iframe) {
        iframe.removeEventListener('load', onIframeLoad);
      }
    };
  }, [projectId, sendConfigToIframe]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!projectId) return;

      if (event.data?.type === 'saveConfig') {
        try {
          const configData = event.data.configData;
          const name = configData?.name || 'Untitled Config';

          await updateDoc(doc(db, 'design_projects', projectId), {
            configData,
            name,
            status: 'in_progress',
            updatedAt: serverTimestamp(),
          });

          const iframe = iframeRef.current;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'saveSuccess' }, '*');
          }
        } catch (error) {
          console.error('Error saving 3D config:', error);
          const iframe = iframeRef.current;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'saveError', error: String(error) }, '*');
          }
        }
      }

      if (event.data?.type === 'navigateBack') {
        navigate('/3d-config');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [projectId, navigate]);

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
    </div>
  );
}
