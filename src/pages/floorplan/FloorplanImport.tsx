import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { parseDxfFile } from '../../services/dxfParser';
import { parseDwgFile, isDwgFile } from '../../services/dwgParser';

type ImportMethod = 'cad' | 'pdf' | 'blank';

export function FloorplanImport() {
  const { currentUser } = useAuth();
  const { colors } = useTheme();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projectName, setProjectName] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<ImportMethod | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState('');
  const [error, setError] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setError('');
      setSelectedFile(file);
      if (!projectName) {
        setProjectName(file.name.replace(/\.(dwg|pdf|dxf)$/i, ''));
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      
      if ((selectedMethod === 'cad' && (ext === 'dxf' || ext === 'dwg')) ||
          (selectedMethod === 'pdf' && ext === 'pdf')) {
        setError('');
        setSelectedFile(file);
        if (!projectName) {
          setProjectName(file.name.replace(/\.(dwg|pdf|dxf)$/i, ''));
        }
      } else {
        setError(`Please select a valid file for this import method`);
      }
    }
  };

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name');
      return;
    }
    if (!currentUser) return;

    setUploading(true);
    setError('');

    try {
      // Create project document
      const projectData: any = {
        name: projectName.trim(),
        userId: currentUser.uid,
        toolId: 'floorplan',
        status: 'draft',
        importMethod: selectedMethod,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        roomCount: 0,
        scale: '1:100',
      };

      const docRef = await addDoc(collection(db, 'design_projects'), projectData);
      const newProjectId = docRef.id;

      // Handle CAD files (DXF or DWG) - all parsed client-side
      if (selectedFile && selectedMethod === 'cad') {
        setParsing(true);
        
        // Parse the file client-side (works for both DWG and DXF)
        let parsed;
        if (isDwgFile(selectedFile)) {
          setParseStatus('Loading DWG parser (first time may take a few seconds)...');
          parsed = await parseDwgFile(selectedFile);
          console.log('DWG parsed:', parsed.entities.length, 'entities');
        } else {
          setParseStatus('Parsing DXF file...');
          parsed = await parseDxfFile(selectedFile);
          console.log('DXF parsed:', parsed.entities.length, 'entities');
        }
        
        setParseStatus('Uploading file...');
        
        // Upload original file to storage
        const storagePath = `design/${newProjectId}/source/${selectedFile.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, selectedFile);
        const downloadURL = await getDownloadURL(storageRef);
        
        // Update project with file info and parsed data
        await updateDoc(doc(db, 'design_projects', newProjectId), {
          sourceFile: selectedFile.name,
          sourceFileUrl: downloadURL,
          entityCount: parsed.entities.length,
          layerCount: parsed.layers.length,
          bounds: parsed.bounds,
          status: 'imported',
        });

        // Add file record
        await addDoc(collection(db, 'design_projects', newProjectId, 'files'), {
          name: selectedFile.name,
          type: isDwgFile(selectedFile) ? 'dwg' : 'dxf',
          storagePath,
          downloadURL,
          status: 'imported',
          entityCount: parsed.entities.length,
          uploadedAt: serverTimestamp(),
        });
        
        setParsing(false);
      }

      // Upload PDF file (no parsing, just store)
      if (selectedFile && selectedMethod === 'pdf') {
        const storagePath = `design/${newProjectId}/source/${selectedFile.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, selectedFile);
        const downloadURL = await getDownloadURL(storageRef);

        await updateDoc(doc(db, 'design_projects', newProjectId), {
          sourceFile: selectedFile.name,
          sourceFileUrl: downloadURL,
        });
      }

      // Navigate to editor
      navigate(`/floorplan/${newProjectId}`);
      
    } catch (err: any) {
      console.error('Error creating project:', err);
      setError(err.message || 'Failed to create project');
      setParsing(false);
    } finally {
      setUploading(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: colors.bg,
      overflowY: 'auto',
    } as const,
    header: {
      display: 'flex',
      alignItems: 'center',
      padding: '20px 32px',
      borderBottom: `1px solid ${colors.border}`,
    } as const,
    backButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '36px',
      height: '36px',
      backgroundColor: 'transparent',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.textSecondary,
      fontSize: '18px',
      cursor: 'pointer',
      marginRight: '16px',
    } as const,
    title: {
      fontSize: '20px',
      fontWeight: 600,
      color: colors.text,
    } as const,
    content: {
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 32px 100px 32px',
    } as const,
    section: {
      marginBottom: '40px',
    } as const,
    sectionTitle: {
      fontSize: '14px',
      fontWeight: 600,
      color: colors.textSecondary,
      textTransform: 'uppercase' as const,
      letterSpacing: '1px',
      marginBottom: '16px',
    } as const,
    input: {
      width: '100%',
      padding: '14px 16px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.text,
      fontSize: '15px',
      outline: 'none',
    } as const,
    methodGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px',
    } as const,
    methodCard: (isSelected: boolean) => ({
      backgroundColor: colors.bgPanel,
      border: `2px solid ${isSelected ? colors.accent : colors.border}`,
      borderRadius: '12px',
      padding: '24px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      textAlign: 'center' as const,
    }),
    methodIcon: {
      fontSize: '40px',
      marginBottom: '12px',
    } as const,
    methodTitle: {
      fontSize: '15px',
      fontWeight: 600,
      color: colors.text,
      marginBottom: '4px',
    } as const,
    methodDesc: {
      fontSize: '12px',
      color: colors.textSecondary,
    } as const,
    dropzone: (isDragging: boolean) => ({
      border: `2px dashed ${isDragging ? colors.accent : colors.border}`,
      borderRadius: '12px',
      padding: '40px',
      textAlign: 'center' as const,
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: isDragging ? `${colors.accent}10` : 'transparent',
    }),
    dropzoneIcon: {
      fontSize: '48px',
      marginBottom: '16px',
    } as const,
    dropzoneText: {
      fontSize: '15px',
      color: colors.text,
      marginBottom: '8px',
    } as const,
    dropzoneHint: {
      fontSize: '13px',
      color: colors.textSecondary,
    } as const,
    selectedFile: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      backgroundColor: colors.bgPanel,
      border: `1px solid ${colors.accent}`,
      borderRadius: '8px',
      marginTop: '16px',
    } as const,
    fileName: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: colors.text,
    } as const,
    removeFile: {
      background: 'none',
      border: 'none',
      color: colors.textSecondary,
      cursor: 'pointer',
      fontSize: '18px',
    } as const,
    actions: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      paddingTop: '20px',
      borderTop: `1px solid ${colors.border}`,
    } as const,
    cancelButton: {
      padding: '12px 24px',
      backgroundColor: 'transparent',
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      color: colors.text,
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
    } as const,
    createButton: (disabled: boolean) => ({
      padding: '12px 24px',
      backgroundColor: disabled ? colors.textMuted : colors.accent,
      border: 'none',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }),
    error: {
      backgroundColor: `${colors.error}15`,
      border: `1px solid ${colors.error}30`,
      borderRadius: '8px',
      padding: '12px 16px',
      color: colors.error,
      fontSize: '13px',
      marginBottom: '20px',
    } as const,
  };

  const [isDragging, setIsDragging] = useState(false);

  const canCreate = projectName.trim() && selectedMethod && 
    (selectedMethod === 'blank' || selectedFile);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button style={styles.backButton} onClick={() => navigate('/floorplan')}>
          ←
        </button>
        <h1 style={styles.title}>New Floorplan Project</h1>
      </header>

      <div style={styles.content}>
        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Project Name</div>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My Facility Expansion"
            style={styles.input}
          />
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>Start From</div>
          <div style={styles.methodGrid}>
            <div
              style={styles.methodCard(selectedMethod === 'cad')}
              onClick={() => { setSelectedMethod('cad'); setSelectedFile(null); setError(''); }}
            >
              <div style={styles.methodIcon}>📐</div>
              <div style={styles.methodTitle}>CAD File</div>
              <div style={styles.methodDesc}>DWG or DXF import</div>
            </div>
            <div
              style={styles.methodCard(selectedMethod === 'pdf')}
              onClick={() => { setSelectedMethod('pdf'); setSelectedFile(null); setError(''); }}
            >
              <div style={styles.methodIcon}>📄</div>
              <div style={styles.methodTitle}>PDF Plan</div>
              <div style={styles.methodDesc}>Reference overlay</div>
            </div>
            <div
              style={styles.methodCard(selectedMethod === 'blank')}
              onClick={() => { setSelectedMethod('blank'); setSelectedFile(null); setError(''); }}
            >
              <div style={styles.methodIcon}>✨</div>
              <div style={styles.methodTitle}>Start Blank</div>
              <div style={styles.methodDesc}>Draw from scratch</div>
            </div>
          </div>
        </div>

        {(selectedMethod === 'cad' || selectedMethod === 'pdf') && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Upload File</div>
            <div
              style={styles.dropzone(isDragging)}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { setIsDragging(false); handleDrop(e); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={styles.dropzoneIcon}>
                {selectedMethod === 'cad' ? '📐' : '📄'}
              </div>
              <div style={styles.dropzoneText}>
                Drop your {selectedMethod === 'cad' ? 'DWG or DXF' : 'PDF'} file here
              </div>
              <div style={styles.dropzoneHint}>
                or click to browse
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={selectedMethod === 'cad' ? '.dxf,.dwg' : '.pdf'}
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {selectedFile && (
              <div style={styles.selectedFile}>
                <div style={styles.fileName}>
                  <span>{selectedMethod === 'cad' ? '📐' : '📄'}</span>
                  <span>{selectedFile.name}</span>
                  <span style={{ color: colors.textMuted }}>
                    ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                  {selectedFile.name.toLowerCase().endsWith('.dwg') && (
                    <span style={{ color: colors.accent, marginLeft: '8px' }}>
                      (DWG - parsed in browser)
                    </span>
                  )}
                </div>
                <button
                  style={styles.removeFile}
                  onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {selectedMethod === 'pdf' && selectedFile && (
          <div style={{
            padding: '16px',
            backgroundColor: `${colors.info}15`,
            border: `1px solid ${colors.info}30`,
            borderRadius: '8px',
            fontSize: '13px',
            color: colors.info,
          }}>
            💡 PDF will be used as a reference overlay. You can trace over it or use AI to help draw.
          </div>
        )}

        {selectedMethod === 'cad' && selectedFile && (
          <div style={{
            padding: '16px',
            backgroundColor: `${colors.accent}15`,
            border: `1px solid ${colors.accent}30`,
            borderRadius: '8px',
            fontSize: '13px',
            color: colors.accent,
          }}>
            {selectedFile.name.toLowerCase().endsWith('.dwg') 
              ? '✓ DWG files are parsed directly in your browser using LibreDWG (free, no server needed)'
              : '✓ DXF files are imported at 1:1 scale with all layers and geometry preserved'
            }
          </div>
        )}

        {parsing && (
          <div style={{
            padding: '20px',
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.accent}`,
            borderRadius: '8px',
            textAlign: 'center',
          }}>
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
            <div style={{ color: colors.text, fontWeight: 500 }}>
              {parseStatus || 'Parsing file...'}
            </div>
            <div style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '8px' }}>
              All processing happens in your browser
            </div>
          </div>
        )}

        <div style={styles.actions}>
          <button style={styles.cancelButton} onClick={() => navigate('/floorplan')} disabled={uploading || parsing}>
            Cancel
          </button>
          <button
            style={styles.createButton(!canCreate || uploading || parsing)}
            disabled={!canCreate || uploading || parsing}
            onClick={handleCreate}
          >
            {uploading ? 'Uploading...' : parsing ? 'Parsing...' : selectedMethod === 'cad' ? 'Import CAD' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
