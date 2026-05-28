import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const beapPod = join(root, '..', '..', 'packages', 'beap-pod')

await cp(join(root, 'src', 'setup-ui'), join(root, 'dist', 'setup-ui'), { recursive: true })
await mkdir(join(root, 'dist', 'manifests'), { recursive: true })
await cp(join(beapPod, 'pod-remote-edge.yaml'), join(root, 'dist', 'manifests', 'pod-remote-edge.yaml'))
await mkdir(join(root, 'dist', 'seccomp'), { recursive: true })
for (const name of ['depackager.json', 'pdf-parser.json', 'certifier.json']) {
  await cp(join(beapPod, 'seccomp', name), join(root, 'dist', 'seccomp', name))
}
