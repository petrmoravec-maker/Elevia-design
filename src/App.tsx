import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PrivateRoute } from './components/PrivateRoute';

// Pages
import { ToolsDashboard } from './pages/ToolsDashboard';
import { Login } from './pages/Login';

// Floorplan Tool Pages
import { FloorplanDashboard } from './pages/floorplan/FloorplanDashboard';
import { FloorplanEditor } from './pages/floorplan/FloorplanEditor';
import { FloorplanImport } from './pages/floorplan/FloorplanImport';

// 3D Config Tool
import { Config3DDashboard, Config3DEditor } from './pages/3d-config';

// Global styles (inline with Tailwind classes via style objects)
const globalStyles = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  html, body, #root {
    height: 100%;
    width: 100%;
  }
  
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: #0f0f0f;
    color: #f5f5f5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  
  ::-webkit-scrollbar-thumb {
    background: #3a3a3a;
    border-radius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: #4a4a4a;
  }
`;

export default function App() {
  return (
    <>
      <style>{globalStyles}</style>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              
              {/* Protected routes */}
              <Route path="/" element={
                <PrivateRoute>
                  <ToolsDashboard />
                </PrivateRoute>
              } />
              
              {/* Floorplan Tool */}
              <Route path="/floorplan" element={
                <PrivateRoute>
                  <FloorplanDashboard />
                </PrivateRoute>
              } />
              <Route path="/floorplan/new" element={
                <PrivateRoute>
                  <FloorplanImport />
                </PrivateRoute>
              } />
              <Route path="/floorplan/:projectId" element={
                <PrivateRoute>
                  <FloorplanEditor />
                </PrivateRoute>
              } />
              <Route path="/floorplan/:projectId/import" element={
                <PrivateRoute>
                  <FloorplanImport />
                </PrivateRoute>
              } />
              
              {/* 3D Config Tool */}
              <Route path="/3d-config" element={
                <PrivateRoute>
                  <Config3DDashboard />
                </PrivateRoute>
              } />
              <Route path="/3d-config/:projectId" element={
                <PrivateRoute>
                  <Config3DEditor />
                </PrivateRoute>
              } />
              
              {/* Catch all - redirect to dashboard */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </>
  );
}
