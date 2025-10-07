import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'OpenGiraffe Orchestrator',
  description: 'Multi-AI-Agenten Workflow Orchestrator mit echten Sidebars',
  version: '0.0.1',
  manifest_version: 3,
  permissions: [
    'activeTab',
    'storage',
    'unlimitedStorage',
    'scripting',
    'windows',
    'system.display'
  ],
  host_permissions: [
    '<all_urls>'
  ],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content-script.tsx'],
      css: [],
      run_at: 'document_end'
    }
  ],
  background: {
    service_worker: 'src/background.ts'
  },
  action: {
    default_title: 'OpenGiraffe Orchestrator - Toggle Sidebars'
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
      resources: ['grid-display.html', 'grid-script.js', 'grid-display-v2.html', 'grid-script-v2.js', 'popup.html', 'popup.js'],
      matches: ['<all_urls>']
    }
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; connect-src 'self' ws://localhost:* wss://localhost:* https://*; img-src 'self' data: https://*;"
  }
})
