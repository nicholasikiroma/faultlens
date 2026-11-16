import React, { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('FaultLens React Render Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', background: '#0B0D12', color: '#F1F5F9', minHeight: '100vh' }}>
          <h2 style={{ color: '#F87171', fontSize: '18px', fontWeight: 'bold' }}>UI Application Render Recovery</h2>
          <p style={{ color: '#94A3B8', fontSize: '13px', marginTop: '8px' }}>
            {this.state.error?.message || 'A client-side render exception occurred.'}
          </p>
          <pre style={{ background: '#131722', padding: '16px', borderRadius: '6px', fontSize: '11px', marginTop: '16px', overflowX: 'auto', border: '1px solid #232A3B' }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              try {
                localStorage.removeItem('fl_incidents');
              } catch {}
              window.location.reload();
            }}
            style={{
              marginTop: '20px',
              padding: '8px 16px',
              background: '#4F46E5',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Clear Cache & Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);

