import { FrameOptions, FrameOverlayInterface, RailPosition, RailElement } from '../types.d';
import { createFrameStyleSheet, updateRailSizes, toggleRailVisibility } from './frameStyles';

export class FrameOverlay implements FrameOverlayInterface {
  private root: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private grid: HTMLDivElement | null = null;
  private rails: Record<RailPosition, RailElement | null> = {
    top: null,
    right: null,
    bottom: null,
    left: null,
  };
  private centerGuides: HTMLDivElement | null = null;
  private currentOptions: FrameOptions = {};
  private isCompatModeB = false;
  private compatWrapper: HTMLDivElement | null = null;
  private originalFirstChild: Element | null = null;
  
  // Watchdog for root element persistence
  private watchdogInterval: number | null = null;
  private fullscreenObserver: (() => void) | null = null;

  mount(opts: FrameOptions = {}): void {
    console.log('[FrameOverlay] Mounting with options:', opts);
    
    // Unmount any existing instance
    this.unmount();
    
    // Store current options
    this.currentOptions = { ...opts };
    
    // Apply compatibility mode if requested
    if (opts.mode === 'compatB') {
      this.enableCompatModeB();
    }
    
    // Create root element
    this.createRoot();
    
    // Create shadow DOM and grid
    this.createShadowDOM();
    
    // Create rails
    this.createRails();
    
    // Create center guides
    this.createCenterGuides();
    
    // Add demo controls
    this.addDemoControls();
    
    // Apply initial options
    this.applyOptions(opts);
    
    // Attach to DOM
    this.attachToDOM();
    
    // Start watchdog
    this.startWatchdog();
    
    // Setup fullscreen handling
    this.setupFullscreenHandling();
    
    console.log('[FrameOverlay] Mounted successfully');
  }

  update(opts: FrameOptions): void {
    console.log('[FrameOverlay] Updating with options:', opts);
    
    if (!this.root || !this.shadow) {
      console.warn('[FrameOverlay] Cannot update: not mounted');
      return;
    }
    
    // Update stored options
    this.currentOptions = { ...this.currentOptions, ...opts };
    
    // Handle mode changes
    if (opts.mode && opts.mode !== (this.isCompatModeB ? 'compatB' : 'safe')) {
      if (opts.mode === 'compatB' && !this.isCompatModeB) {
        this.enableCompatModeB();
      } else if (opts.mode === 'safe' && this.isCompatModeB) {
        this.disableCompatModeB();
      }
    }
    
    // Apply updated options
    this.applyOptions(opts);
  }

  unmount(): void {
    console.log('[FrameOverlay] Unmounting');
    
    // Stop watchdog
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    
    // Remove fullscreen observer
    if (this.fullscreenObserver) {
      document.removeEventListener('fullscreenchange', this.fullscreenObserver);
      this.fullscreenObserver = null;
    }
    
    // Disable compatibility mode
    this.disableCompatModeB();
    
    // Remove root from DOM
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    
    // Clear references
    this.root = null;
    this.shadow = null;
    this.grid = null;
    this.rails = { top: null, right: null, bottom: null, left: null };
    this.centerGuides = null;
    this.currentOptions = {};
    
    console.log('[FrameOverlay] Unmounted successfully');
  }

  private createRoot(): void {
    this.root = document.createElement('div');
    this.root.id = 'wr-frame-root';
    
    // Apply root styles - critical for isolation
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      contain: 'layout paint style', // isolate stacking context
    });
  }

  private createShadowDOM(): void {
    if (!this.root) return;
    
    // Create shadow root with open mode
    this.shadow = this.root.attachShadow({ mode: 'open' });
    
    // Apply adopted stylesheets
    const styleSheet = createFrameStyleSheet();
    this.shadow.adoptedStyleSheets = [styleSheet];
    
    // Create grid container
    this.grid = document.createElement('div');
    this.grid.className = 'frame-grid';
    
    this.shadow.appendChild(this.grid);
  }

  private createRails(): void {
    if (!this.grid) return;
    
    const railPositions: RailPosition[] = ['top', 'right', 'bottom', 'left'];
    
    railPositions.forEach(position => {
      const rail = document.createElement('div') as RailElement;
      rail.setAttribute('data-rail', position);
      rail.className = 'fade-in';
      
      this.rails[position] = rail;
      this.grid!.appendChild(rail);
    });
  }

  private createCenterGuides(): void {
    if (!this.shadow) return;
    
    this.centerGuides = document.createElement('div');
    this.centerGuides.className = 'center-guides';
    this.shadow.appendChild(this.centerGuides);
  }

  private addDemoControls(): void {
    if (!this.rails.top) return;
    
    // Add label
    const label = document.createElement('span');
    label.className = 'rail-label';
    label.textContent = 'Frame Overlay';
    this.rails.top.appendChild(label);
    
    // Add divider
    const divider1 = document.createElement('div');
    divider1.className = 'rail-divider';
    this.rails.top.appendChild(divider1);
    
    // Toggle center guides button
    const guidesButton = document.createElement('button');
    guidesButton.className = 'rail-button';
    guidesButton.textContent = 'Center Guides';
    guidesButton.onclick = () => this.toggleCenterGuides();
    this.rails.top.appendChild(guidesButton);
    
    // Mode indicator
    const modeButton = document.createElement('button');
    modeButton.className = 'rail-button primary';
    modeButton.textContent = this.isCompatModeB ? 'Compat Mode B' : 'Safe Mode';
    modeButton.onclick = () => this.toggleMode();
    this.rails.top.appendChild(modeButton);
    
    // Add divider
    const divider2 = document.createElement('div');
    divider2.className = 'rail-divider';
    this.rails.top.appendChild(divider2);
    
    // Test interaction button
    const testButton = document.createElement('button');
    testButton.className = 'rail-button';
    testButton.textContent = 'Test Click';
    testButton.onclick = () => {
      alert('Rail interaction works! Center should be pass-through.');
    };
    this.rails.top.appendChild(testButton);
    
    // Add info in right rail
    if (this.rails.right) {
      const info = document.createElement('div');
      info.style.cssText = 'font-size: 10px; opacity: 0.7; text-align: center;';
      info.innerHTML = 'Center<br>Hole<br>↓';
      this.rails.right.appendChild(info);
    }
  }

  private applyOptions(opts: FrameOptions): void {
    if (!this.shadow) return;
    
    // Update rail sizes
    if (opts.railSize) {
      updateRailSizes(this.shadow, opts.railSize);
    }
    
    // Update rail visibility
    if (opts.show) {
      toggleRailVisibility(this.shadow, opts.show);
    }
    
    // Update mode indicator
    const modeButton = this.shadow.querySelector('.rail-button.primary') as HTMLButtonElement;
    if (modeButton) {
      modeButton.textContent = this.isCompatModeB ? 'Compat Mode B' : 'Safe Mode';
    }
  }

  private attachToDOM(): void {
    if (!this.root) return;
    
    // Attach to document element (not body)
    document.documentElement.appendChild(this.root);
  }

  private toggleCenterGuides(): void {
    if (!this.centerGuides) return;
    
    this.centerGuides.classList.toggle('visible');
  }

  private toggleMode(): void {
    const newMode = this.isCompatModeB ? 'safe' : 'compatB';
    this.update({ mode: newMode });
  }

  private enableCompatModeB(): void {
    if (this.isCompatModeB) return;
    
    console.log('[FrameOverlay] Enabling Compatibility Mode B');
    
    const body = document.body;
    const firstChild = body.firstElementChild;
    
    if (!firstChild) {
      console.warn('[FrameOverlay] No first child to wrap in Compatibility Mode B');
      return;
    }
    
    // Create non-intrusive wrapper
    this.compatWrapper = document.createElement('div');
    this.compatWrapper.id = 'wr-nonintrusive-wrapper';
    
    // Apply minimal styles - no transforms, no layout changes
    Object.assign(this.compatWrapper.style, {
      background: 'transparent',
      pointerEvents: 'auto',
    });
    
    // Store reference to original first child
    this.originalFirstChild = firstChild;
    
    // Insert wrapper as first child and move original into it
    body.insertBefore(this.compatWrapper, firstChild);
    this.compatWrapper.appendChild(firstChild);
    
    // Ensure moved node maintains pointer events
    if (firstChild instanceof HTMLElement) {
      firstChild.style.pointerEvents = 'auto';
    }
    
    this.isCompatModeB = true;
  }

  private disableCompatModeB(): void {
    if (!this.isCompatModeB || !this.compatWrapper || !this.originalFirstChild) return;
    
    console.log('[FrameOverlay] Disabling Compatibility Mode B');
    
    const body = document.body;
    
    // Move original child back to body
    body.insertBefore(this.originalFirstChild, this.compatWrapper);
    
    // Remove wrapper
    if (this.compatWrapper.parentNode) {
      this.compatWrapper.parentNode.removeChild(this.compatWrapper);
    }
    
    // Clear references
    this.compatWrapper = null;
    this.originalFirstChild = null;
    this.isCompatModeB = false;
  }

  private startWatchdog(): void {
    // Check every 2 seconds if root is still attached
    this.watchdogInterval = window.setInterval(() => {
      if (this.root && !document.contains(this.root)) {
        console.warn('[FrameOverlay] Root element removed, re-attaching');
        this.attachToDOM();
      }
    }, 2000);
  }

  private setupFullscreenHandling(): void {
    this.fullscreenObserver = () => {
      if (!this.root) return;
      
      if (document.fullscreenElement) {
        // Hide overlay in fullscreen
        this.root.style.display = 'none';
        console.log('[FrameOverlay] Hidden for fullscreen');
      } else {
        // Show overlay when exiting fullscreen
        this.root.style.display = '';
        console.log('[FrameOverlay] Restored from fullscreen');
      }
    };
    
    document.addEventListener('fullscreenchange', this.fullscreenObserver);
  }

  // Public API for debugging and manual control
  public getRailElement(position: RailPosition): RailElement | null {
    return this.rails[position];
  }

  public getCurrentOptions(): FrameOptions {
    return { ...this.currentOptions };
  }

  public isInCompatMode(): boolean {
    return this.isCompatModeB;
  }
}


