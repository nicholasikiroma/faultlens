# FaultLens Design System

FaultLens uses an **Obsidian + Electric Indigo** visual language tuned for high-signal incident triage and evidence inspection. Both **Dark (Obsidian, default)** and **Light (Crisp Slate)** themes are first-class citizens and stay synchronized with `meta[name="color-scheme"]`, `[data-theme]`, and Tailwind `.dark`.

## 1. Color Tokens (`--fl-*`)

All semantic CSS custom properties live in `apps/web/src/index.css` and are mapped to Tailwind utilities under the `fl` namespace in `apps/web/tailwind.config.js`.

| Token | Dark (Obsidian) | Light (Crisp Slate) | Usage |
| :--- | :--- | :--- | :--- |
| `--fl-canvas` | `#0B0D12` | `#F8FAFC` | Application canvas background |
| `--fl-sidebar` | `#0E1117` | `#F1F5F9` | Primary navigation rail |
| `--fl-surface` | `#131722` | `#FFFFFF` | Cards, panels, tables, drawers |
| `--fl-surface-elevated` | `#1A202E` | `#FFFFFF` | Active rows, hover states, popovers |
| `--fl-surface-subtle` | `#10141D` | `#F4F6FA` | Inputs, table headers, code blocks |
| `--fl-ink` | `#F1F5F9` | `#0F172A` | Primary headings and body copy |
| `--fl-secondary` | `#94A3B8` | `#475569` | Secondary descriptions and metadata |
| `--fl-muted` | `#7C8B9E` | `#64748B` | Captions, table headers, keyboard hints |
| `--fl-border` | `#232A3B` | `#E2E8F0` | Structural 1px hairlines |
| `--fl-border-strong` | `#3E4A63` | `#94A3B8` | Interactive input and button boundaries (3:1+ contrast) |
| `--fl-accent` | `#6366F1` | `#4F46E5` | Brand accent, active indicator, chart stroke |
| `--fl-accent-text` | `#A5B4FC` | `#4338CA` | Accessible accent text and links |
| `--fl-btn-primary-bg` | `#4F46E5` | `#4F46E5` | Primary CTA fill (`#FFFFFF` ink) |

### Semantic & Epistemic Status Tokens

State is always communicated with **icon/shape + text + color** (never color alone):

- **Observed (`fl-accent`)**: Direct telemetry facts and cryptographic receipts.
- **Deterministic Rule (`fl-violet`)**: Rule-engine findings and `INVESTIGATING` workflow state.
- **AI Hypothesis (`fl-warning`, dashed border)**: Unverified probabilistic suggestions requiring engineer confirmation.
- **Critical / Open (`fl-danger`)**: `OPEN` incidents, `CRITICAL`/`HIGH` severity, and `5xx` failure checkpoints.
- **Healthy / Resolved (`fl-success`)**: `RESOLVED` incidents, `LOW` severity, and verified ingress.

## 2. Typography

- **UI Sans**: `Geist`, `Inter`, system sans-serif (`--fl-font-sans`)
- **Monospace**: `IBM Plex Mono`, system monospace (`--fl-font-mono`), always paired with `.tabular-nums` for metrics, timestamps, and counters.

| Utility | Size / Line Height | Tracking | Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `text-fl-title` | `26px / 32px` | `-0.025em` | `600` | Page titles |
| `text-fl-section` | `15px / 22px` | `-0.015em` | `600` | Panel section headers |
| `text-fl-card` | `14px / 20px` | `-0.01em` | `600` | Card headings and settings rows |
| `text-fl-body` | `13px / 20px` | `-0.011em` | `400` | Body descriptions |
| `text-fl-metric` | `28px / 32px` | `-0.03em` | `500` | KPI / telemetry figures |
| `text-fl-label` | `11px / 16px` | `+0.06em` | `500` | Uppercase monospace labels |

## 3. Shared Primitives (`apps/web/src/components/ui/`)

Views compose shared primitives rather than duplicating raw Tailwind classes:

- `Button` (`primary`, `secondary`, `ghost`, `danger`; `sm`, `md`)
- `Panel` (`default` and `subtle` surface variants; `none` / `sm` / `md` / `lg` padding)
- `PageHeader` (eyebrow, title, optional badge, description, back link, actions slot)
- `StatCard` (label, tabular-nums value, icon, semantic tone)
- `Input` & `Select` (accessible 3:1+ boundaries and focus rings)
- `EmptyState` (icon, title, description, optional recovery CTA)

## 4. Accessibility & Native Controls

- `CommandPalette` uses a native `<dialog>` managed with `showModal()` / `close()`, `overscroll-behavior: contain`, and `closedby="any"` (with pointer-coordinate light-dismiss fallback).
- Data tables are wrapped in focusable `role="region"` scroll containers with sticky headers.
- `@media (prefers-reduced-motion: reduce)` and `@media (forced-colors: active)` are supported globally in `apps/web/src/index.css`.
