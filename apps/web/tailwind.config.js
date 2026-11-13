/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ws: {
          canvas: 'var(--ws-canvas)',
          sidebar: 'var(--ws-sidebar)',
          surface: 'var(--ws-surface)',
          'surface-elevated': 'var(--ws-surface-elevated)',
          'surface-subtle': 'var(--ws-surface-subtle)',
          ink: 'var(--ws-ink)',
          secondary: 'var(--ws-secondary)',
          muted: 'var(--ws-muted)',
          border: 'var(--ws-border)',
          'border-subtle': 'var(--ws-border-subtle)',
          'border-strong': 'var(--ws-border-strong)',
          accent: 'var(--ws-accent)',
          'accent-hover': 'var(--ws-accent-hover)',
          'accent-active': 'var(--ws-accent-active)',
          'accent-subtle': 'var(--ws-accent-subtle)',
          'accent-border': 'var(--ws-accent-border)',
          'accent-ink': 'var(--ws-accent-ink)',
          'btn-primary': 'var(--ws-btn-primary-bg)',
          'btn-primary-hover': 'var(--ws-btn-primary-hover)',
          'btn-primary-active': 'var(--ws-btn-primary-active)',
          'btn-primary-border': 'var(--ws-btn-primary-border)',
          'btn-primary-ink': 'var(--ws-btn-primary-ink)',
          focus: 'var(--ws-focus)',
          backdrop: 'var(--ws-backdrop)',
          success: {
            text: 'var(--ws-success-text)',
            dot: 'var(--ws-success-dot)',
            bg: 'var(--ws-success-bg)',
            border: 'var(--ws-success-border)',
          },
          warning: {
            text: 'var(--ws-warning-text)',
            dot: 'var(--ws-warning-dot)',
            bg: 'var(--ws-warning-bg)',
            border: 'var(--ws-warning-border)',
          },
          danger: {
            text: 'var(--ws-danger-text)',
            dot: 'var(--ws-danger-dot)',
            bg: 'var(--ws-danger-bg)',
            border: 'var(--ws-danger-border)',
          },
          info: {
            text: 'var(--ws-info-text)',
            dot: 'var(--ws-info-dot)',
            bg: 'var(--ws-info-bg)',
            border: 'var(--ws-info-border)',
          },
          lavender: {
            text: 'var(--ws-lavender-text)',
            dot: 'var(--ws-lavender-dot)',
            bg: 'var(--ws-lavender-bg)',
            border: 'var(--ws-lavender-border)',
          },
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        'ws-title': ['28px', { lineHeight: '34px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'ws-section': ['16px', { lineHeight: '22px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'ws-card': ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'ws-body': ['13px', { lineHeight: '19px', fontWeight: '400' }],
        'ws-nav': ['13px', { lineHeight: '18px', fontWeight: '500' }],
        'ws-metric': ['28px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '500' }],
        'ws-label': ['10px', { lineHeight: '14px', letterSpacing: '0.04em', fontWeight: '500' }],
        'ws-meta': ['11px', { lineHeight: '16px', fontWeight: '400' }],
        'ws-table': ['13px', { lineHeight: '18px', fontWeight: '400' }],
      },
      boxShadow: {
        'subtle': 'var(--ws-shadow-subtle)',
        'elevated': 'var(--ws-shadow-elevated)',
      }
    },
  },
  plugins: [],
}
