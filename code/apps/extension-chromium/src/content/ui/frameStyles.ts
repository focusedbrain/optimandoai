// Shadow-scoped CSS using adoptedStyleSheets
// This ensures no CSS bleed into the host page

export function createFrameStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  
  const css = `
    /* Reset and base styles scoped to shadow root */
    :host, * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    :host {
      /* CSS custom properties for rail sizes */
      --rail-top: 56px;
      --rail-right: 16px;
      --rail-bottom: 16px;
      --rail-left: 280px;
      
      /* UI theming */
      --ui-bg: color-mix(in oklab, #0b0d12 70%, transparent);
      --ui-border: rgba(255, 255, 255, 0.1);
      --ui-text: #e5e7eb;
      --ui-text-secondary: rgba(229, 231, 235, 0.7);
      --ui-accent: #3b82f6;
      --ui-accent-hover: #2563eb;
      
      /* Ensure clean display */
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--ui-text);
    }
    
    /* Grid container - creates the 3x3 layout with center hole */
    .frame-grid {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: var(--rail-top) 1fr var(--rail-bottom);
      grid-template-columns: var(--rail-left) 1fr var(--rail-right);
      pointer-events: none;
    }
    
    /* Rail positioning using CSS Grid areas */
    [data-rail="top"] {
      grid-area: 1 / 1 / 2 / 4; /* spans all columns in top row */
      background: var(--ui-bg);
      border-bottom: 1px solid var(--ui-border);
    }
    
    [data-rail="left"] {
      grid-area: 1 / 1 / 4 / 2; /* spans all rows in left column */
      background: var(--ui-bg);
      border-right: 1px solid var(--ui-border);
    }
    
    [data-rail="right"] {
      grid-area: 1 / 3 / 4 / 4; /* spans all rows in right column */
      background: var(--ui-bg);
      border-left: 1px solid var(--ui-border);
    }
    
    [data-rail="bottom"] {
      grid-area: 3 / 1 / 4 / 4; /* spans all columns in bottom row */
      background: var(--ui-bg);
      border-top: 1px solid var(--ui-border);
    }
    
    /* Rail common styles */
    [data-rail] {
      pointer-events: auto; /* Rails are interactive */
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      overflow: hidden;
    }
    
    /* Rail-specific alignments */
    [data-rail="top"],
    [data-rail="bottom"] {
      justify-content: flex-start;
      flex-direction: row;
    }
    
    [data-rail="left"],
    [data-rail="right"] {
      justify-content: flex-start;
      flex-direction: column;
      writing-mode: vertical-rl;
      text-orientation: mixed;
    }
    
    /* Demo controls and UI elements */
    .rail-button {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid var(--ui-border);
      color: var(--ui-text);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    
    .rail-button:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: var(--ui-accent);
    }
    
    .rail-button:active {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(1px);
    }
    
    .rail-button.primary {
      background: var(--ui-accent);
      border-color: var(--ui-accent);
      color: white;
    }
    
    .rail-button.primary:hover {
      background: var(--ui-accent-hover);
      border-color: var(--ui-accent-hover);
    }
    
    .rail-divider {
      width: 1px;
      height: 20px;
      background: var(--ui-border);
      margin: 0 4px;
    }
    
    [data-rail="left"] .rail-divider,
    [data-rail="right"] .rail-divider {
      width: 20px;
      height: 1px;
      margin: 4px 0;
    }
    
    .rail-label {
      font-size: 11px;
      color: var(--ui-text-secondary);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    /* Center guides for fixed-width page helper */
    .center-guides {
      position: absolute;
      top: var(--rail-top);
      left: var(--rail-left);
      right: var(--rail-right);
      bottom: var(--rail-bottom);
      pointer-events: none;
      border: 2px dashed rgba(59, 130, 246, 0.4);
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .center-guides.visible {
      opacity: 1;
    }
    
    .center-guides::before {
      content: "Inner Viewport";
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(59, 130, 246, 0.9);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    
    /* Hide rails when requested */
    [data-rail].hidden {
      display: none;
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
      :host {
        --rail-left: 16px;
        --rail-right: 16px;
        --rail-top: 48px;
        --rail-bottom: 16px;
      }
    }
    
    /* Animation utilities */
    .fade-in {
      animation: fadeIn 0.3s ease-out;
    }
    
    .fade-out {
      animation: fadeOut 0.3s ease-out;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes fadeOut {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-8px);
      }
    }
  `;
  
  sheet.replaceSync(css);
  return sheet;
}

export function updateRailSizes(
  shadowRoot: ShadowRoot,
  railSize: { top?: number; right?: number; bottom?: number; left?: number }
): void {
  const host = shadowRoot.host as HTMLElement;
  
  if (railSize.top !== undefined) {
    host.style.setProperty('--rail-top', `${railSize.top}px`);
  }
  if (railSize.right !== undefined) {
    host.style.setProperty('--rail-right', `${railSize.right}px`);
  }
  if (railSize.bottom !== undefined) {
    host.style.setProperty('--rail-bottom', `${railSize.bottom}px`);
  }
  if (railSize.left !== undefined) {
    host.style.setProperty('--rail-left', `${railSize.left}px`);
  }
}

export function toggleRailVisibility(
  shadowRoot: ShadowRoot,
  show: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean }
): void {
  const rails = {
    top: shadowRoot.querySelector('[data-rail="top"]') as HTMLElement,
    right: shadowRoot.querySelector('[data-rail="right"]') as HTMLElement,
    bottom: shadowRoot.querySelector('[data-rail="bottom"]') as HTMLElement,
    left: shadowRoot.querySelector('[data-rail="left"]') as HTMLElement,
  };
  
  Object.entries(show).forEach(([position, visible]) => {
    const rail = rails[position as keyof typeof rails];
    if (rail) {
      if (visible) {
        rail.classList.remove('hidden');
      } else {
        rail.classList.add('hidden');
      }
    }
  });
}


