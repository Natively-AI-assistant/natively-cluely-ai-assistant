/**
 * Centralized selector definitions for stable test selectors.
 * Priority order: data-testid > role-based > text-based > CSS class (last resort)
 */

export const LauncherSelectors = {
  container: '[data-testid="launcher-container"]',
  containerFallback: '#launcher-container',
  searchInput: '[data-testid="search-input"]',
  searchInputFallback: 'input[placeholder*="search" i]',
  startButton: '[data-testid="start-natively-button"]',
  startButtonFallback: 'button:has-text("Start Natively")',
  settingsButton: '[data-testid="settings-button"]',
  meetingItem: '[data-testid="meeting-item"]',
  meetingItemFallback: 'main .group.relative',
  refreshButton: '[data-testid="refresh-button"]',
  refreshButtonFallback: 'button:has-text("Refresh")',
  calendarCard: '[data-testid="calendar-card"]',
  calendarCardFallback: 'text=/link your calendar|calendar linked/i',
} as const

export const SettingsSelectors = {
  panel: '[data-testid="settings-panel"]',
  panelFallback: '#settings-panel',
  closeButton: '[data-testid="settings-close-button"]',
  closeButtonFallback: '#settings-panel text="Close"',
  sidebar: '[data-testid="settings-sidebar"]',
  sidebarFallback: '#settings-panel nav, #settings-panel [role="tablist"], #settings-panel aside',
  opacitySlider: '[data-testid="opacity-slider"]',
  opacitySliderFallback: 'input[type="range"]',
  quitButton: '[data-testid="quit-button"]',
  quitButtonFallback: 'button:has-text("Quit")',
} as const

export const OverlaySelectors = {
  shell: '[data-testid="overlay-shell"]',
  shellFallback: '.overlay-shell-surface',
  pill: '[data-testid="overlay-pill"]',
  pillFallback: '.rounded-full.overlay-pill-surface',
  logo: '[data-testid="overlay-logo"]',
  logoFallback: 'img[alt="Natively"]',
  hideButton: '[data-testid="overlay-hide-button"]',
  hideButtonFallback: 'button:has-text("Hide")',
  stopButton: '[data-testid="overlay-stop-button"]',
  stopButtonFallback: '.overlay-pill-surface button:last-child',
  chip: '[data-testid="overlay-chip"]',
  chipFallback: '.overlay-chip-surface',
  input: '[data-testid="overlay-input"]',
  inputFallback: '[role="textbox"]',
  modelSelector: '[data-testid="model-selector-button"]',
  modelSelectorFallback: 'button:has-text(/gemini/i)',
} as const

export const MeetingSelectors = {
  item: '[data-testid="meeting-item"]',
  itemFallback: 'main .group.relative.flex.items-center',
  detailView: '[data-testid="meeting-detail"]',
  detailViewFallback: 'main.flex-1.overflow-y-auto',
  transcriptTab: '[data-testid="transcript-tab"]',
  transcriptTabFallback: 'button:has-text("Transcript")',
  summaryTab: '[data-testid="summary-tab"]',
  summaryTabFallback: 'button:has-text("Summary")',
  backButton: '[data-testid="meeting-back-button"]',
  backButtonFallback: 'header button:first-child',
} as const

export const CropperSelectors = {
  canvas: '[data-testid="cropper-canvas"]',
  canvasFallback: 'canvas',
  hudPill: '[data-testid="cropper-hud-pill"]',
  hudPillFallback: 'text="Select area"',
} as const

export const ModelSelectorSelectors = {
  container: '[data-testid="model-selector-container"]',
  containerFallback: 'body',
  noModels: '[data-testid="no-models-message"]',
  noModelsFallback: 'text=/no models/i',
  loading: '[data-testid="loading-models"]',
  loadingFallback: 'text=/loading models/i',
  modelButton: '[data-testid="model-button"]',
  modelButtonFallback: 'button:has-text(/model/i)',
} as const

/**
 * Helper to get selector with fallback
 */
export function getSelector(selectors: Record<string, string>, key: string): string {
  const primary = selectors[key]
  const fallback = selectors[`${key}Fallback`]
  return fallback ? `${primary}, ${fallback}` : primary
}
