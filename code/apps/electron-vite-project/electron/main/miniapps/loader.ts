import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

// Resolve ESM dirname for this module
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// When bundled, this module is in dist-electron; when in dev, it's under electron/main/miniapps.
// Use project root one level above dist-electron (bundle) or main folder (dev), then point to electron/main/miniapps.
const PROJECT_ROOT = path.resolve(__dirname, '..')
const MINIAPPS_ROOT = path.resolve(PROJECT_ROOT, 'electron', 'main', 'miniapps')

type TierName = 'tier1' | 'tier2' | 'tier3'

const nonEmptyString = z.string().trim().min(1)
const optionalStringArray = z.array(nonEmptyString).optional()

const atomicBlockSchema = z.object({
  id: nonEmptyString,
  tier: z.literal(3),
  type: z.literal('atomic'),
  group: nonEmptyString.optional(),
  security: nonEmptyString,
  provides: optionalStringArray,
  intent_tags: z.array(nonEmptyString),
  description: nonEmptyString.optional(),
  ui: z.record(z.unknown()).optional(),
  logic: z.record(z.unknown()).optional(),
  behaviour: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
})

const componentSchema = z.object({
  id: nonEmptyString,
  tier: z.literal(2),
  type: z.literal('component'),
  name: nonEmptyString,
  description: nonEmptyString,
  intent_tags: z.array(nonEmptyString),
  provides: optionalStringArray,
  blocks: z.array(nonEmptyString).min(1),
  bindings: z.record(z.record(z.unknown())).optional(),
  behaviour: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
  security: nonEmptyString
})

const miniAppSchema = z.object({
  id: nonEmptyString,
  tier: z.literal(1),
  type: z.literal('mini_app'),
  name: nonEmptyString,
  description: nonEmptyString,
  intent_tags: z.array(nonEmptyString),
  provides: optionalStringArray,
  components: z.array(nonEmptyString).min(1),
  bindings: z.record(z.record(z.unknown())).optional(),
  state: z.record(z.unknown()).optional(),
  layout: z.object({
    type: nonEmptyString,
    spacing: nonEmptyString.optional()
  }).optional(),
  security: nonEmptyString
})

type TierItemMap = {
  tier1: z.infer<typeof miniAppSchema>
  tier2: z.infer<typeof componentSchema>
  tier3: z.infer<typeof atomicBlockSchema>
}

const tierSchemas: { [K in TierName]: z.ZodType<TierItemMap[K]> } = {
  tier1: miniAppSchema,
  tier2: componentSchema,
  tier3: atomicBlockSchema
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const fieldPath = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${fieldPath}: ${issue.message}`
    })
    .join('; ')
}

async function loadTier<K extends TierName>(tier: K): Promise<TierItemMap[K][]> {
  const tierDir = path.join(MINIAPPS_ROOT, tier)
  try {
    const entries = await fs.readdir(tierDir)
    const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'))

    const results: TierItemMap[K][] = []
    const schema = tierSchemas[tier]
    for (const file of jsonFiles) {
      const filePath = path.join(tierDir, file)
      try {
        const raw = await fs.readFile(filePath, 'utf-8')
        const parsedJson: unknown = JSON.parse(raw)
        const validated = schema.safeParse(parsedJson)
        if (!validated.success) {
          const issueText = formatZodIssues(validated.error.issues)
          console.error(`[MiniApps] Invalid schema in ${tier}/${file}: ${issueText}`)
          continue
        }
        results.push(validated.data)
      } catch (err) {
        console.error(`[MiniApps] Failed to load ${tier}/${file}:`, err)
      }
    }
    return results
  } catch (err) {
    console.error(`[MiniApps] Failed to read tier directory ${tierDir}:`, err)
    return []
  }
}

export async function loadTier1MiniApps(): Promise<TierItemMap['tier1'][]> {
  return loadTier('tier1')
}

export async function loadTier2MiniApps(): Promise<TierItemMap['tier2'][]> {
  return loadTier('tier2')
}

export async function loadTier3MiniApps(): Promise<TierItemMap['tier3'][]> {
  return loadTier('tier3')
}

export async function loadAllMiniApps(): Promise<{
  tier1: TierItemMap['tier1'][]
  tier2: TierItemMap['tier2'][]
  tier3: TierItemMap['tier3'][]
}> {
  const [tier1, tier2, tier3] = await Promise.all([
    loadTier1MiniApps(),
    loadTier2MiniApps(),
    loadTier3MiniApps()
  ])
  return { tier1, tier2, tier3 }
}
