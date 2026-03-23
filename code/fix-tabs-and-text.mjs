import { readFileSync, writeFileSync } from 'fs'

const file = 'apps/extension-chromium/src/content-script.tsx'
let s = readFileSync(file, 'utf8')

function rep(from, to) {
  const n = s.split(from).length - 1
  if (n > 0) { s = s.split(from).join(to); console.log(`  ${n}x: ${from.slice(0,70)}`) }
}

// ── 1. AI Agents filter-tab click handler ──────────────────────────────────
// Active tab: was rgba white bg + white text → use csTheme accent
rep(
  `t.style.background = 'rgba(255,255,255,0.3)'
            t.style.color = 'white'
            t.style.fontWeight = 'bold'`,
  `t.style.background = csTheme().accentGrad
            t.style.color = '#fff'
            t.style.fontWeight = '700'
            t.style.border = 'none'`
)
// Inactive tab: was rgba white bg + rgba white text → use csTheme
rep(
  `t.style.background = 'rgba(255,255,255,0.1)'
            t.style.color = 'rgba(255,255,255,0.7)'
            t.style.fontWeight = 'normal'`,
  `t.style.background = csTheme().inputBg
            t.style.color = csTheme().text
            t.style.fontWeight = 'normal'
            t.style.border = '1px solid ' + csTheme().border`
)

// ── 2. Memory management sub-tabs ──────────────────────────────────────────
// Session Memory tab - active (rgba white bg + white text)
rep(
  `<button id="mem-session-tab" style="padding:10px 16px; background: rgba(255,255,255,0.2); border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer">🗂 Session Memory</button>`,
  `<button id="mem-session-tab" style="padding:10px 16px; background: \${csTheme().accentGrad}; border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer; font-weight:600;">Session Memory</button>`
)
// Account Memory tab - inactive (csTheme cardBg + white text)
rep(
  `<button id="mem-account-tab" style="padding:10px 16px; background: \${csTheme().cardBg}; border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer">🏢 Account Memory</button>`,
  `<button id="mem-account-tab" style="padding:10px 16px; background: \${csTheme().inputBg}; border:1px solid \${csTheme().border}; border-bottom:0; color:\${csTheme().text}; border-radius:8px 8px 0 0; cursor:pointer;">Account Memory</button>`
)
// KnowledgeVault tab - inactive
rep(
  `<button id="mem-sessions-tab" style="margin-left:auto;padding:10px 16px; background: \${csTheme().cardBg}; border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer">🧾 KnowledgeVault</button>`,
  `<button id="mem-sessions-tab" style="margin-left:auto;padding:10px 16px; background: \${csTheme().inputBg}; border:1px solid \${csTheme().border}; border-bottom:0; color:\${csTheme().text}; border-radius:8px 8px 0 0; cursor:pointer;">KnowledgeVault</button>`
)

// ── 3. Memory tab click handlers that set white text ──────────────────────
// Find and fix the mem-session-tab / mem-account-tab JS click handlers
rep(
  `sTab.style.cssText = 'padding:10px 16px;background:rgba(255,255,255,0.2);border:0;color:#fff;border-radius:8px 8px 0 0;cursor:pointer;font-weight:bold'`,
  `sTab.style.cssText = \`padding:10px 16px;background:\${csTheme().accentGrad};border:0;color:#fff;border-radius:8px 8px 0 0;cursor:pointer;font-weight:700\``
)
rep(
  `sTab.style.cssText = 'padding:10px 16px;background:rgba(255,255,255,0.1);border:0;color:rgba(255,255,255,0.6);border-radius:8px 8px 0 0;cursor:pointer'`,
  `sTab.style.cssText = \`padding:10px 16px;background:\${csTheme().inputBg};border:1px solid \${csTheme().border};border-bottom:0;color:\${csTheme().text};border-radius:8px 8px 0 0;cursor:pointer\``
)
rep(
  `aTab.style.cssText = 'padding:10px 16px;background:rgba(255,255,255,0.2);border:0;color:#fff;border-radius:8px 8px 0 0;cursor:pointer;font-weight:bold'`,
  `aTab.style.cssText = \`padding:10px 16px;background:\${csTheme().accentGrad};border:0;color:#fff;border-radius:8px 8px 0 0;cursor:pointer;font-weight:700\``
)
rep(
  `aTab.style.cssText = 'padding:10px 16px;background:rgba(255,255,255,0.1);border:0;color:rgba(255,255,255,0.6);border-radius:8px 8px 0 0;cursor:pointer'`,
  `aTab.style.cssText = \`padding:10px 16px;background:\${csTheme().inputBg};border:1px solid \${csTheme().border};border-bottom:0;color:\${csTheme().text};border-radius:8px 8px 0 0;cursor:pointer\``
)

// ── 4. Memory textareas with color:white ──────────────────────────────────
rep(
  `color:white;padding:12px;border-radius:6px;font-size:12px;resize:vertical;`,
  `color:\${csTheme().text};padding:12px;border-radius:6px;font-size:12px;resize:vertical;`
)
rep(
  `color:white;padding:12px;border-radius:6px;font-size:12px;`,
  `color:\${csTheme().text};padding:12px;border-radius:6px;font-size:12px;`
)

// ── 5. Memory allocation input with color:white ───────────────────────────
rep(
  `border:1px solid \${csTheme().border};color:white;padding:12px;border-radius:6px;font-size:12px;`,
  `border:1px solid \${csTheme().border};color:\${csTheme().text};padding:12px;border-radius:6px;font-size:12px;`
)

// ── 6. Memory Settings persist checkbox label ─────────────────────────────
rep(
  `font-size:14px;color:${csTheme().muted};font-weight:bold;">🧠 Memory:</label>`,
  `font-size:14px;color:\${csTheme().text};font-weight:600;">Memory:</label>`
)
rep(
  `font-size:14px;color:${csTheme().muted};font-weight:bold;">📦 Memory Allocation:</label>`,
  `font-size:14px;color:\${csTheme().text};font-weight:600;">Memory Allocation:</label>`
)

// ── 7. Context management sub-tabs (greyed out) ───────────────────────────
// Find the context sub-tab buttons with white text
rep(
  `background: rgba(255,255,255,0.2); border:0; color: white;`,
  `background: \${csTheme().accentGrad}; border:none; color: #fff;`
)
rep(
  `background: rgba(255,255,255,0.1); border:0; color: rgba(255,255,255,0.6);`,
  `background: \${csTheme().inputBg}; border:1px solid \${csTheme().border}; color: \${csTheme().text};`
)

// ── 8. Context tab HTML buttons ───────────────────────────────────────────
// The context sub-tabs that appear as greyed boxes
rep(
  `>🏢 Account Context</button>`,
  `>Account Context</button>`
)

// ── 9. Context textarea with color:white ─────────────────────────────────
rep(
  `color: white; padding: 10px; border-radius: 6px; font-size: 12px; resize: vertical;`,
  `color: \${csTheme().text}; padding: 10px; border-radius: 6px; font-size: 12px; resize: vertical;`
)
rep(
  `color: white; padding: 12px; border-radius: 6px; font-size: 12px; resize: vertical;`,
  `color: \${csTheme().text}; padding: 12px; border-radius: 6px; font-size: 12px; resize: vertical;`
)

// ── 10. Green "Auto-scrape" heading — change from bright green to theme accent ─
rep(
  `color: #4CAF50; font-weight: bold; margin: 0 0 10px 0;`,
  `color: \${csTheme().isLight ? '#15803d' : '#4ade80'}; font-weight: 600; margin: 0 0 10px 0;`
)
rep(
  `color: #4CAF50; font-size: 14px; font-weight: bold;`,
  `color: \${csTheme().isLight ? '#15803d' : '#4ade80'}; font-size: 14px; font-weight: 600;`
)

// ── 11. "Upload PDF Files" green heading same fix ─────────────────────────
rep(
  `color: #4CAF50;`,
  `color: \${csTheme().isLight ? '#15803d' : '#4ade80'};`
)

// ── 12. Memory tab click handlers using inline white ─────────────────────
// Look for all sTab/aTab/stab patterns
rep(
  `sTab.onclick = () => { sPanel.style.display='block'; aPanel.style.display='none'; sTab.style.background='rgba(255,255,255,0.2)'; sTab.style.color='#fff'; aTab.style.background='rgba(255,255,255,0.08)'; aTab.style.color='rgba(255,255,255,0.6)' }`,
  `sTab.onclick = () => { sPanel.style.display='block'; aPanel.style.display='none'; sTab.style.background=csTheme().accentGrad; sTab.style.color='#fff'; aTab.style.background=csTheme().inputBg; aTab.style.color=csTheme().text }`
)
rep(
  `aTab.onclick = () => { aPanel.style.display='block'; sPanel.style.display='none'; aTab.style.background='rgba(255,255,255,0.2)'; aTab.style.color='#fff'; sTab.style.background='rgba(255,255,255,0.08)'; sTab.style.color='rgba(255,255,255,0.6)' }`,
  `aTab.onclick = () => { aPanel.style.display='block'; sPanel.style.display='none'; aTab.style.background=csTheme().accentGrad; aTab.style.color='#fff'; sTab.style.background=csTheme().inputBg; sTab.style.color=csTheme().text }`
)

// ── 13. Context sub-tab click handlers ───────────────────────────────────
rep(
  `btn.style.background = isActive ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'`,
  `btn.style.background = isActive ? csTheme().accentGrad : csTheme().inputBg`
)
rep(
  `btn.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.7)'`,
  `btn.style.color = isActive ? '#fff' : csTheme().text`
)
rep(
  `btn.style.fontWeight = isActive ? 'bold' : 'normal'`,
  `btn.style.fontWeight = isActive ? '700' : 'normal'`
)

// ── 14. Tab coordinator system (bottom sidebar) ───────────────────────────
rep(
  `const activeBg = isProfessional ? 'rgba(2,6,23,0.08)' : 'rgba(255,255,255,0.2)'`,
  `const activeBg = csTheme().accentGrad`
)
rep(
  `const inactiveBg = isProfessional ? 'rgba(2,6,23,0.03)' : 'rgba(255,255,255,0.1)'`,
  `const inactiveBg = csTheme().inputBg`
)
rep(
  `const textColor = isProfessional ? '#0f172a' : 'white'`,
  `const textColor = csTheme().text`
)

writeFileSync(file, s, 'utf8')
console.log('\nDone!')
