import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  name: 'Optimando AI Orchestrator',
  description: 'Multi-AI-Agenten Workflow Orchestrator mit echten Sidebars',
  version: '0.0.1',
  manifest_version: 3,
  permissions: [
    'activeTab',
    'storage'
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
    default_title: 'Optimando AI Orchestrator - Toggle Sidebars'
  },
  web_accessible_resources: [
    {
      resources: ['grid-display.html', 'grid-script.js'],
      matches: ['<all_urls>']
    }
  ]
})
