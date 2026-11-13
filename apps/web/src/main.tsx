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
    console.error('WireSleuth React Render Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', background: '#0c0f0d', color: '#e5eae6', minHeight: '100vh' }}>
          <h2 style={{ color: '#e06c75', fontSize: '18px', fontWeight: 'bold' }}>UI Application Render Recovery</h2>
          <p style={{ color: '#88928c', fontSize: '13px', marginTop: '8px' }}>
            {this.state.error?.message || 'A client-side render exception occurred.'}
          </p>
          <pre style={{ background: '#141a16', padding: '16px', borderRadius: '6px', fontSize: '11px', marginTop: '16px', overflowX: 'auto', border: '1px solid #232d26' }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              try {
                localStorage.removeItem('ws_incidents');
              } catch {}
              window.location.reload();
            }}
            style={{
              marginTop: '20px',
              padding: '8px 16px',
              background: '#2f9e66',
              color: '#04150b',
              border: 'none',
              borderRadius: '4px',
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

