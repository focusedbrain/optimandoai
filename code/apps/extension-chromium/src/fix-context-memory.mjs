import { readFileSync, writeFileSync } from 'fs'
const file = 'content-script.tsx'
let s = readFileSync(file, 'utf8')

function rep(from, to, desc) {
  const n = s.split(from).length - 1
  if (n > 0) {
    s = s.split(from).join(to)
    console.log(`  ${n}x [${desc}]`)
  } else {
    console.warn(`  0x [${desc}] — NOT FOUND`)
  }
}

// ─── CONTEXT LIGHTBOX ─────────────────────────────────────────────────────────

// 1. Panel container: color:white → csTheme().text
rep(
  'color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3);',
  'color: ${csTheme().text}; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3);',
  'Context panel color:white'
)

// 2. Section headings: hardcoded #66FF66 green → csTheme().text (readable on any bg)
rep(
  'font-size: 16px; color: #66FF66;',
  'font-size: 16px; color: ${csTheme().text};',
  'Section headings #66FF66'
)

// 3. Tab buttons initial HTML — active tab: rgba(255,255,255,0.2) + color:white
rep(
  'padding: 10px 20px; background: rgba(255,255,255,0.2); border: none; \n\n              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;\n\n              transition: all 0.3s ease;\n\n            ">👤 User Context (Session)</button>',
  'padding: 10px 20px; background: ${csTheme().accentGrad}; border: none; \n\n              color: #fff; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;\n\n              transition: all 0.3s ease;\n\n            ">👤 User Context (Session)</button>',
  'Context active tab rgba->accentGrad'
)

// 4. Inactive context tabs: color:white → csTheme().text
rep(
  "background: ${csTheme().cardBg}; border: none; \n\n              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;\n\n              transition: all 0.3s ease;\n\n            \">🌐 Publisher Context (Session)</button>",
  "background: ${csTheme().cardBg}; border: none; \n\n              color: ${csTheme().text}; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;\n\n              transition: all 0.3s ease;\n\n            \">🌐 Publisher Context (Session)</button>",
  'Publisher tab color:white'
)
rep(
  "background: ${csTheme().cardBg}; border: none; \n\n              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;\n\n              transition: all 0.3s ease;\n\n            \">🏢 Account Context</button>",
  "background: ${csTheme().cardBg}; border: none; \n\n              color: ${csTheme().text}; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;\n\n              transition: all 0.3s ease;\n\n            \">🏢 Account Context</button>",
  'Account tab color:white'
)

// 5. Textarea color:white in context
rep(
  "border: 1px solid ${csTheme().border}; color: white; padding: 15px;\n\n                border-radius: 8px; font-size: 14px; resize: vertical;\n\n                font-family: 'Consolas', monospace; line-height: 1.5;\n\n              \" placeholder=\"Enter your context information here or use the scrape button above...\">",
  "border: 1px solid ${csTheme().border}; color: ${csTheme().text}; padding: 15px;\n\n                border-radius: 8px; font-size: 14px; resize: vertical;\n\n                font-family: 'Consolas', monospace; line-height: 1.5;\n\n              \" placeholder=\"Enter your context information here or use the scrape button above...\">",
  'User textarea color:white'
)
rep(
  "border: 1px solid ${csTheme().border}; color: white; padding: 15px;\n\n                border-radius: 8px; font-size: 14px; resize: vertical;\n\n                font-family: 'Consolas', monospace; line-height: 1.5;\n\n              \" placeholder=\"Publisher context will be loaded from wrdesk.com or injected via template...\">",
  "border: 1px solid ${csTheme().border}; color: ${csTheme().text}; padding: 15px;\n\n                border-radius: 8px; font-size: 14px; resize: vertical;\n\n                font-family: 'Consolas', monospace; line-height: 1.5;\n\n              \" placeholder=\"Publisher context will be loaded from wrdesk.com or injected via template...\">",
  'Publisher textarea color:white'
)

// 6. File input color:white
rep(
  "border: 1px solid ${csTheme().border}; color: white;\n\n                border-radius: 6px; font-size: 12px; margin-bottom: 10px;\n\n              \">",
  "border: 1px solid ${csTheme().border}; color: ${csTheme().text};\n\n                border-radius: 6px; font-size: 12px; margin-bottom: 10px;\n\n              \">",
  'File input color:white (user & publisher)'
)

// 7. PDF files list color:#CCCCCC
rep(
  'font-size: 12px; color: #CCCCCC;',
  'font-size: 12px; color: ${csTheme().muted};',
  'PDF list #CCCCCC'
)

// 8. Account context textarea and file input color:white (inline style)
rep(
  'color: white; border: 1px solid ${csTheme().border}; border-radius: 6px; padding: 10px;}',
  'color: ${csTheme().text}; border: 1px solid ${csTheme().border}; border-radius: 6px; padding: 10px;}',
  'Account textarea inline'
)
// The account context input & textarea have color:white inline
rep(
  '"width: 100%; height: 160px; background: ${csTheme().cardBg}; color: white; border: 1px solid ${csTheme().border}; border-radius: 6px; padding: 10px;"',
  '"width: 100%; height: 160px; background: ${csTheme().cardBg}; color: ${csTheme().text}; border: 1px solid ${csTheme().border}; border-radius: 6px; padding: 10px;"',
  'Account context textarea'
)
rep(
  '"background: ${csTheme().cardBg}; color: white; border: 1px solid ${csTheme().border}; border-radius: 6px; padding: 8px; width: 100%;"',
  '"background: ${csTheme().cardBg}; color: ${csTheme().text}; border: 1px solid ${csTheme().border}; border-radius: 6px; padding: 8px; width: 100%;"',
  'Account context file input'
)

// 9. Tab click handlers — Context lightbox
// Active: rgba(255,255,255,0.2)  →  csTheme().accentGrad
// Inactive: rgba(255,255,255,0.1) →  csTheme().cardBg
rep(
  "userTab.style.background = 'rgba(255,255,255,0.2)'",
  "userTab.style.background = csTheme().accentGrad; userTab.style.color = '#fff'",
  'Context userTab active bg'
)
rep(
  "publisherTab!.style.background = 'rgba(255,255,255,0.1)'",
  "publisherTab!.style.background = csTheme().cardBg; publisherTab!.style.color = csTheme().text",
  'Context publisherTab inactive (userTab click)'
)
rep(
  "accountTab!.style.background = 'rgba(255,255,255,0.1)'\n\n      userContent!.style.display = 'block'",
  "accountTab!.style.color = csTheme().text; accountTab!.style.background = csTheme().cardBg\n\n      userContent!.style.display = 'block'",
  'Context accountTab inactive (userTab click)'
)

rep(
  "publisherTab.style.background = 'rgba(255,255,255,0.2)'",
  "publisherTab.style.background = csTheme().accentGrad; publisherTab.style.color = '#fff'",
  'Context publisherTab active bg'
)
rep(
  "userTab!.style.background = 'rgba(255,255,255,0.1)'\n\n      accountTab!.style.background = 'rgba(255,255,255,0.1)'",
  "userTab!.style.background = csTheme().cardBg; userTab!.style.color = csTheme().text\n\n      accountTab!.style.background = csTheme().cardBg; accountTab!.style.color = csTheme().text",
  'Context userTab+accountTab inactive (publisherTab click)'
)

rep(
  "accountTab.style.background = 'rgba(255,255,255,0.2)'",
  "accountTab.style.background = csTheme().accentGrad; accountTab.style.color = '#fff'",
  'Context accountTab active bg'
)
rep(
  "userTab!.style.background = 'rgba(255,255,255,0.1)'\n\n      publisherTab!.style.background = 'rgba(255,255,255,0.1)'",
  "userTab!.style.background = csTheme().cardBg; userTab!.style.color = csTheme().text\n\n      publisherTab!.style.background = csTheme().cardBg; publisherTab!.style.color = csTheme().text",
  'Context userTab+publisherTab inactive (accountTab click)'
)

// ─── MEMORY LIGHTBOX ──────────────────────────────────────────────────────────

// 10. Active session tab: rgba(255,255,255,0.2) + color:#fff
rep(
  "padding:10px 16px; background: rgba(255,255,255,0.2); border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer\">🗂 Session Memory</button>",
  "padding:10px 16px; background: ${csTheme().accentGrad}; border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer; font-weight:600\">Session Memory</button>",
  'Memory session tab active rgba->accentGrad'
)

// 11. Memory tab JS activate function — active/inactive backgrounds
rep(
  "sTab.style.background = which==='s' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'",
  "sTab.style.background = which==='s' ? csTheme().accentGrad : csTheme().cardBg; sTab.style.color = which==='s' ? '#fff' : csTheme().text",
  'Memory sTab activate fn'
)
rep(
  "aTab.style.background = which==='a' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'",
  "aTab.style.background = which==='a' ? csTheme().accentGrad : csTheme().cardBg; aTab.style.color = which==='a' ? '#fff' : csTheme().text",
  'Memory aTab activate fn'
)
rep(
  "xTab.style.background = which==='x' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'",
  "xTab.style.background = which==='x' ? csTheme().accentGrad : csTheme().cardBg; xTab.style.color = which==='x' ? '#fff' : csTheme().text",
  'Memory xTab activate fn'
)

// 12. KnowledgeVault filter buttons — hardcoded dark bg + white text
rep(
  'padding:6px 10px;background:#334155;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;cursor:pointer">Runs</button>',
  'padding:6px 10px;background:${csTheme().accentGrad};border:none;color:#fff;border-radius:6px;cursor:pointer;font-weight:600">Runs</button>',
  'KV filter btn Runs active'
)
rep(
  'padding:6px 10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;cursor:pointer">Queue (to-embed)</button>',
  'padding:6px 10px;background:${csTheme().cardBg};border:1px solid ${csTheme().border};color:${csTheme().text};border-radius:6px;cursor:pointer">Queue (to-embed)</button>',
  'KV filter btn Queue'
)
rep(
  'padding:6px 10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;cursor:pointer">Verified</button>',
  'padding:6px 10px;background:${csTheme().cardBg};border:1px solid ${csTheme().border};color:${csTheme().text};border-radius:6px;cursor:pointer">Verified</button>',
  'KV filter btn Verified'
)

// 13. KV description box rgba white bg
rep(
  'margin:-2px 0 8px 0; font-size:12px; opacity:0.9; background:rgba(255,255,255,0.06); border:1px solid ${csTheme().border}; padding:10px; border-radius:8px;',
  'margin:-2px 0 8px 0; font-size:12px; color:${csTheme().text}; background:${csTheme().cardBg}; border:1px solid ${csTheme().border}; padding:10px; border-radius:8px;',
  'KV description box bg'
)

// 14. KV empty state box
rep(
  'display:none;padding:18px;background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.25);border-radius:8px;font-size:12px;',
  'display:none;padding:18px;background:${csTheme().cardBg};border:1px dashed ${csTheme().border};border-radius:8px;font-size:12px;color:${csTheme().text};',
  'KV empty state box'
)

writeFileSync(file, s, 'utf8')
console.log('\nDone!')
