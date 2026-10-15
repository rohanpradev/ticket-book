import React, { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="error-page">
        <h1>Let’s get you back in.</h1>
        <p>The interface hit an unexpected problem. Your saved bookings are still here.</p>
        <button onClick={() => location.reload()}>Reload Rush</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const root = document.getElementById('root');
if (!root) throw new Error('Rush requires a root element.');
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
