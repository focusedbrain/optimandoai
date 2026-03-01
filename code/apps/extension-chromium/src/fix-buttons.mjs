import { readFileSync, writeFileSync } from 'fs'
const file = 'content-script.tsx'
let s = readFileSync(file, 'utf8')

function rep(from, to, desc) {
  const n = s.split(from).length - 1
  if (n > 0) {
    s = s.split(from).join(to)
    console.log(`  ${n}x [${desc}]`)
  } else {
    console.warn(`  0x NOT FOUND: [${desc}]`)
  }
}

// ── 1. Fix &times; as textContent (renders as literal "&times;" not ×) ─────
// All three del.textContent / delBtn.textContent = '&times;'  →  '×'
rep(
  "del.textContent = '&times;'",
  "del.textContent = '×'",
  'del.textContent &times; → ×'
)
rep(
  "delBtn.textContent = '&times;'",
  "delBtn.textContent = '×'",
  'delBtn.textContent &times; → × (all occurrences)'
)

// ── 2. Light-blue buttons rgba(96,165,250,.3) + white text in AI Instructions ─
// These appear on Add Trigger, Add Reasoning Section, Add Workflow buttons
// Replace the light-blue semi-transparent bg with the accent gradient
rep(
  'background:rgba(96,165,250,.3);border:1px solid rgba(96,165,250,.5);color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:500">+ Add Trigger</button>',
  'background:${csTheme().accentGrad};border:none;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:500">+ Add Trigger</button>',
  '+ Add Trigger light-blue'
)
rep(
  'background:rgba(96,165,250,.3);border:1px solid rgba(96,165,250,.5);color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap">+ Add Reasoning Section</button>',
  'background:${csTheme().accentGrad};border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap">+ Add Reasoning Section</button>',
  '+ Add Reasoning Section light-blue'
)
rep(
  'background:rgba(96,165,250,.3);border:1px solid rgba(96,165,250,.5);color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:500">+ Add Workflow</button>',
  'background:${csTheme().accentGrad};border:none;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:500">+ Add Workflow</button>',
  '+ Add Workflow light-blue (all occurrences)'
)

// ── 3. Trigger delete button: semi-transparent red + white on light bg ────────
// rgba(220,38,38,0.10) is nearly invisible on light background
rep(
  "del.style.cssText = 'background:rgba(220,38,38,0.10);color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'",
  "del.style.cssText = 'background:#ef4444;color:#fff;border:none;padding:0 10px;border-radius:6px;cursor:pointer'",
  'Trigger del button rgba(220,38,38,0.10) → solid red'
)

// ── 4. Mini-apps Edit button: rgba(255,255,255,0.15) bg + color:white ─────────
rep(
  'background: rgba(255,255,255,0.15);\n\n                border: 1px solid ${csTheme().border};\n\n                color: white;',
  'background: ${csTheme().cardBg};\n\n                border: 1px solid ${csTheme().border};\n\n                color: ${csTheme().text};',
  'Mini-app Edit button color:white → theme text'
)

// ── 5. Mini-app card border on light theme: rgba(255,255,255,0.2) invisible ───
rep(
  "border: 1px solid ${app.scope === 'account' ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.2)'};",
  "border: 1px solid ${app.scope === 'account' ? 'rgba(180,130,0,0.4)' : csTheme().border};",
  'Mini-app card border rgba(255,255,255,0.2) → theme border'
)

// ── 6. Mini-app delete button: shows ✏• (wrong icon) → use × ─────────────────
rep(
  '" title="Delete mini-app">✏•</button>',
  '" title="Delete mini-app">×</button>',
  'Mini-app delete btn icon ✏• → ×'
)

// ── 7. AI Instructions delete (workflow row): shows ✏• (wrong icon) → ×  ──────
rep(
  'class="e-workflow-del">✏•</button>',
  'class="e-workflow-del">×</button>',
  'e-workflow-del icon ✏• → ×'
)

writeFileSync(file, s, 'utf8')
console.log('\nDone!')
