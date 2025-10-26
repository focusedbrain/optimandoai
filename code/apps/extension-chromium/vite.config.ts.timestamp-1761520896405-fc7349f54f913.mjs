// vite.config.ts
import { defineConfig } from "file:///C:/Users/oscarturboprinz/Documents/optimandoai/code/apps/extension-chromium/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/oscarturboprinz/Documents/optimandoai/code/apps/extension-chromium/node_modules/@vitejs/plugin-react/dist/index.js";
import { crx } from "file:///C:/Users/oscarturboprinz/Documents/optimandoai/code/apps/extension-chromium/node_modules/@crxjs/vite-plugin/dist/index.mjs";

// manifest.config.ts
import { defineManifest } from "file:///C:/Users/oscarturboprinz/Documents/optimandoai/code/apps/extension-chromium/node_modules/@crxjs/vite-plugin/dist/index.mjs";
var manifest_config_default = defineManifest({
  name: "WR Code",
  description: "Multi-AI-Agenten Workflow Orchestrator mit echten Sidebars",
  version: "0.0.1",
  manifest_version: 3,
  permissions: [
    "activeTab",
    "storage",
    "unlimitedStorage",
    "scripting",
    "windows",
    "system.display",
    "sidePanel"
  ],
  side_panel: {
    default_path: "src/sidepanel.html"
  },
  host_permissions: [
    "<all_urls>"
  ],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content-script.tsx"],
      css: [],
      run_at: "document_end"
    }
  ],
  background: {
    service_worker: "src/background.ts"
  },
  action: {
    default_title: "WR Code - Toggle Sidebars"
  },
  commands: {
    "toggle-overlay": {
      suggested_key: {
        default: "Alt+O"
      },
      description: "Toggle overlay on/off for this domain"
    }
  },
  web_accessible_resources: [
    {
      resources: ["grid-display.html", "grid-display.js", "grid-script.js", "grid-display-v2.html", "grid-script-v2.js", "popup.html", "popup.js"],
      matches: ["<all_urls>"]
    }
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' ws://localhost:* wss://localhost:* https://*; img-src 'self' data: https://*;"
  }
});

// vite.config.ts
var vite_config_default = defineConfig({
  plugins: [
    react(),
    crx({ manifest: manifest_config_default })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAibWFuaWZlc3QuY29uZmlnLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcb3NjYXJ0dXJib3ByaW56XFxcXERvY3VtZW50c1xcXFxvcHRpbWFuZG9haVxcXFxjb2RlXFxcXGFwcHNcXFxcZXh0ZW5zaW9uLWNocm9taXVtXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxvc2NhcnR1cmJvcHJpbnpcXFxcRG9jdW1lbnRzXFxcXG9wdGltYW5kb2FpXFxcXGNvZGVcXFxcYXBwc1xcXFxleHRlbnNpb24tY2hyb21pdW1cXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL29zY2FydHVyYm9wcmluei9Eb2N1bWVudHMvb3B0aW1hbmRvYWkvY29kZS9hcHBzL2V4dGVuc2lvbi1jaHJvbWl1bS92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnXHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcclxuaW1wb3J0IHsgY3J4IH0gZnJvbSAnQGNyeGpzL3ZpdGUtcGx1Z2luJ1xyXG5pbXBvcnQgbWFuaWZlc3QgZnJvbSAnLi9tYW5pZmVzdC5jb25maWcnXHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIHBsdWdpbnM6IFtcclxuICAgIHJlYWN0KCksXHJcbiAgICBjcngoeyBtYW5pZmVzdCB9KVxyXG4gIF1cclxufSlcclxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxvc2NhcnR1cmJvcHJpbnpcXFxcRG9jdW1lbnRzXFxcXG9wdGltYW5kb2FpXFxcXGNvZGVcXFxcYXBwc1xcXFxleHRlbnNpb24tY2hyb21pdW1cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXG9zY2FydHVyYm9wcmluelxcXFxEb2N1bWVudHNcXFxcb3B0aW1hbmRvYWlcXFxcY29kZVxcXFxhcHBzXFxcXGV4dGVuc2lvbi1jaHJvbWl1bVxcXFxtYW5pZmVzdC5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL29zY2FydHVyYm9wcmluei9Eb2N1bWVudHMvb3B0aW1hbmRvYWkvY29kZS9hcHBzL2V4dGVuc2lvbi1jaHJvbWl1bS9tYW5pZmVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVNYW5pZmVzdCB9IGZyb20gJ0Bjcnhqcy92aXRlLXBsdWdpbidcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lTWFuaWZlc3Qoe1xuICBuYW1lOiAnV1IgQ29kZScsXG4gIGRlc2NyaXB0aW9uOiAnTXVsdGktQUktQWdlbnRlbiBXb3JrZmxvdyBPcmNoZXN0cmF0b3IgbWl0IGVjaHRlbiBTaWRlYmFycycsXG4gIHZlcnNpb246ICcwLjAuMScsXG4gIG1hbmlmZXN0X3ZlcnNpb246IDMsXG4gIHBlcm1pc3Npb25zOiBbXG4gICAgJ2FjdGl2ZVRhYicsXG4gICAgJ3N0b3JhZ2UnLFxuICAgICd1bmxpbWl0ZWRTdG9yYWdlJyxcbiAgICAnc2NyaXB0aW5nJyxcbiAgICAnd2luZG93cycsXG4gICAgJ3N5c3RlbS5kaXNwbGF5JyxcbiAgICAnc2lkZVBhbmVsJ1xuICBdLFxuICBzaWRlX3BhbmVsOiB7XG4gICAgZGVmYXVsdF9wYXRoOiAnc3JjL3NpZGVwYW5lbC5odG1sJ1xuICB9LFxuICBob3N0X3Blcm1pc3Npb25zOiBbXG4gICAgJzxhbGxfdXJscz4nXG4gIF0sXG4gIGNvbnRlbnRfc2NyaXB0czogW1xuICAgIHtcbiAgICAgIG1hdGNoZXM6IFsnPGFsbF91cmxzPiddLFxuICAgICAganM6IFsnc3JjL2NvbnRlbnQtc2NyaXB0LnRzeCddLFxuICAgICAgY3NzOiBbXSxcbiAgICAgIHJ1bl9hdDogJ2RvY3VtZW50X2VuZCdcbiAgICB9XG4gIF0sXG4gIGJhY2tncm91bmQ6IHtcbiAgICBzZXJ2aWNlX3dvcmtlcjogJ3NyYy9iYWNrZ3JvdW5kLnRzJ1xuICB9LFxuICBhY3Rpb246IHtcbiAgICBkZWZhdWx0X3RpdGxlOiAnV1IgQ29kZSAtIFRvZ2dsZSBTaWRlYmFycydcbiAgfSxcbiAgY29tbWFuZHM6IHtcbiAgICAndG9nZ2xlLW92ZXJsYXknOiB7XG4gICAgICBzdWdnZXN0ZWRfa2V5OiB7XG4gICAgICAgIGRlZmF1bHQ6ICdBbHQrTydcbiAgICAgIH0sXG4gICAgICBkZXNjcmlwdGlvbjogJ1RvZ2dsZSBvdmVybGF5IG9uL29mZiBmb3IgdGhpcyBkb21haW4nXG4gICAgfVxuICB9LFxuICB3ZWJfYWNjZXNzaWJsZV9yZXNvdXJjZXM6IFtcbiAgICB7XG4gICAgICByZXNvdXJjZXM6IFsnZ3JpZC1kaXNwbGF5Lmh0bWwnLCAnZ3JpZC1kaXNwbGF5LmpzJywgJ2dyaWQtc2NyaXB0LmpzJywgJ2dyaWQtZGlzcGxheS12Mi5odG1sJywgJ2dyaWQtc2NyaXB0LXYyLmpzJywgJ3BvcHVwLmh0bWwnLCAncG9wdXAuanMnXSxcbiAgICAgIG1hdGNoZXM6IFsnPGFsbF91cmxzPiddXG4gICAgfVxuICBdLFxuICBjb250ZW50X3NlY3VyaXR5X3BvbGljeToge1xuICAgIGV4dGVuc2lvbl9wYWdlczogXCJzY3JpcHQtc3JjICdzZWxmJzsgb2JqZWN0LXNyYyAnc2VsZic7IGNvbm5lY3Qtc3JjICdzZWxmJyB3czovL2xvY2FsaG9zdDoqIHdzczovL2xvY2FsaG9zdDoqIGh0dHBzOi8vKjsgaW1nLXNyYyAnc2VsZicgZGF0YTogaHR0cHM6Ly8qO1wiXG4gIH1cbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQW1hLFNBQVMsb0JBQW9CO0FBQ2hjLE9BQU8sV0FBVztBQUNsQixTQUFTLFdBQVc7OztBQ0Z1WixTQUFTLHNCQUFzQjtBQUUxYyxJQUFPLDBCQUFRLGVBQWU7QUFBQSxFQUM1QixNQUFNO0FBQUEsRUFDTixhQUFhO0FBQUEsRUFDYixTQUFTO0FBQUEsRUFDVCxrQkFBa0I7QUFBQSxFQUNsQixhQUFhO0FBQUEsSUFDWDtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFlBQVk7QUFBQSxJQUNWLGNBQWM7QUFBQSxFQUNoQjtBQUFBLEVBQ0Esa0JBQWtCO0FBQUEsSUFDaEI7QUFBQSxFQUNGO0FBQUEsRUFDQSxpQkFBaUI7QUFBQSxJQUNmO0FBQUEsTUFDRSxTQUFTLENBQUMsWUFBWTtBQUFBLE1BQ3RCLElBQUksQ0FBQyx3QkFBd0I7QUFBQSxNQUM3QixLQUFLLENBQUM7QUFBQSxNQUNOLFFBQVE7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUFBLEVBQ0EsWUFBWTtBQUFBLElBQ1YsZ0JBQWdCO0FBQUEsRUFDbEI7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLGVBQWU7QUFBQSxFQUNqQjtBQUFBLEVBQ0EsVUFBVTtBQUFBLElBQ1Isa0JBQWtCO0FBQUEsTUFDaEIsZUFBZTtBQUFBLFFBQ2IsU0FBUztBQUFBLE1BQ1g7QUFBQSxNQUNBLGFBQWE7QUFBQSxJQUNmO0FBQUEsRUFDRjtBQUFBLEVBQ0EsMEJBQTBCO0FBQUEsSUFDeEI7QUFBQSxNQUNFLFdBQVcsQ0FBQyxxQkFBcUIsbUJBQW1CLGtCQUFrQix3QkFBd0IscUJBQXFCLGNBQWMsVUFBVTtBQUFBLE1BQzNJLFNBQVMsQ0FBQyxZQUFZO0FBQUEsSUFDeEI7QUFBQSxFQUNGO0FBQUEsRUFDQSx5QkFBeUI7QUFBQSxJQUN2QixpQkFBaUI7QUFBQSxFQUNuQjtBQUNGLENBQUM7OztBRGhERCxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLEVBQUUsa0NBQVMsQ0FBQztBQUFBLEVBQ2xCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
