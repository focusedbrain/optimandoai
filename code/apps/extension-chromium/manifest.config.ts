import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'WR Code',
  description: 'Multi-AI-Agenten Workflow Orchestrator mit echten Sidebars',
  version: '0.0.1',
  manifest_version: 3,
  permissions: [
    'activeTab',
    'storage',
    'unlimitedStorage',
    'scripting',
    'windows',
    'system.display',
    'sidePanel',
    'tabs'
  ],
  side_panel: {
    default_path: 'src/sidepanel.html'
  },
  host_permissions: [
    '<all_urls>',
    'http://127.0.0.1:*/*',
    'http://localhost:*/*'
  ],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content-script.tsx'],
      css: [],
      run_at: 'document_end'
    },
    {
      matches: ['https://mail.google.com/*'],
      js: ['src/mailguard-content-script.ts'],
      css: [],
      run_at: 'document_end'
    }
  ],
  background: {
    service_worker: 'src/background.ts'
  },
  action: {
    default_title: 'WR Code - Toggle Sidebars'
  },
  commands: {
    'toggle-overlay': {
      suggested_key: {
        default: 'Alt+O'
      },
      description: 'Toggle overlay on/off for this domain'
    }
  },
  web_accessible_resources: [
    {
      resources: ['grid-display.html', 'grid-display.js', 'grid-script.js', 'grid-display-v2.html', 'grid-script-v2.js', 'popup.html', 'popup.js'],
      matches: ['<all_urls>']
    }
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:* wss://localhost:* http://localhost:* http://127.0.0.1:* https://*; img-src 'self' data: https://*;"
  }
})
