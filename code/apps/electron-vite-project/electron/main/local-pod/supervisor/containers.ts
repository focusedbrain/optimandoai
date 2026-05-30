/**
 * LOCAL_HOST / LOCAL_VERIFY container metadata for host pod supervisor (Stream A — A5).
 */

import { DEFAULT_POD_NAME, DEFAULT_LOCAL_VERIFY_POD_NAME } from '../podConstants.js'

export type LocalPodContainerRole =
  | 'ingestor'
  | 'validator'
  | 'depackager'
  | 'sealer'
  | 'verifier'
  | 'pdf-parser'

export interface LocalPodContainerSpec {
  readonly role: LocalPodContainerRole
  readonly containerName: string
  readonly port: number
}

export const LOCAL_HOST_SUPERVISOR_CONTAINERS: readonly LocalPodContainerSpec[] = [
  { role: 'ingestor', containerName: `${DEFAULT_POD_NAME}-ingestor`, port: 18100 },
  { role: 'validator', containerName: `${DEFAULT_POD_NAME}-validator`, port: 18101 },
  { role: 'depackager', containerName: `${DEFAULT_POD_NAME}-depackager`, port: 18102 },
  { role: 'pdf-parser', containerName: `${DEFAULT_POD_NAME}-pdf-parser`, port: 18107 },
  { role: 'sealer', containerName: `${DEFAULT_POD_NAME}-sealer`, port: 18103 },
] as const

export const LOCAL_VERIFY_SUPERVISOR_CONTAINERS: readonly LocalPodContainerSpec[] = [
  { role: 'ingestor', containerName: `${DEFAULT_LOCAL_VERIFY_POD_NAME}-ingestor`, port: 18100 },
  { role: 'verifier', containerName: `${DEFAULT_LOCAL_VERIFY_POD_NAME}-verifier`, port: 18105 },
  { role: 'validator', containerName: `${DEFAULT_LOCAL_VERIFY_POD_NAME}-validator`, port: 18101 },
  { role: 'depackager', containerName: `${DEFAULT_LOCAL_VERIFY_POD_NAME}-depackager`, port: 18102 },
  { role: 'pdf-parser', containerName: `${DEFAULT_LOCAL_VERIFY_POD_NAME}-pdf-parser`, port: 18107 },
  { role: 'sealer', containerName: `${DEFAULT_LOCAL_VERIFY_POD_NAME}-sealer`, port: 18103 },
] as const

export function containersForPodName(podName: string): readonly LocalPodContainerSpec[] {
  return podName === DEFAULT_LOCAL_VERIFY_POD_NAME
    ? LOCAL_VERIFY_SUPERVISOR_CONTAINERS
    : LOCAL_HOST_SUPERVISOR_CONTAINERS
}
