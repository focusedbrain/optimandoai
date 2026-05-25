/**
 * Pod-side depackage harness — runs the same pipeline as the pod depackager role.
 */

import { runDepackagePipeline } from '@beap-pod/depackagePipeline'

export async function depackageViaPodPipeline(
  packageJson: string,
  keys: { x25519_priv_b64: string },
): Promise<{ rawCapsuleJson: string; subject: string; body: string } | null> {
  let pkg: Parameters<typeof runDepackagePipeline>[0]
  try {
    pkg = JSON.parse(packageJson) as Parameters<typeof runDepackagePipeline>[0]
  } catch {
    return null
  }

  const result = await runDepackagePipeline(pkg, {
    localX25519PrivB64: keys.x25519_priv_b64,
    skipSignatureVerification: true,
  })

  if (!result.success) return null

  const capsule = JSON.parse(result.capsulePlaintext) as {
    subject?: string
    body?: string
  }

  return {
    rawCapsuleJson: result.capsulePlaintext,
    subject: capsule.subject ?? '',
    body: capsule.body ?? '',
  }
}
