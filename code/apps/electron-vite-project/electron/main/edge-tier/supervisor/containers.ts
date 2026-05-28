/**
 * REMOTE_EDGE container metadata for supervisor polling and replacement (P5.4).
 */

import { REMOTE_POD_NAME } from '../ssh/deploy.js'

export type RemoteEdgeContainerRole =
  | 'ingestor'
  | 'validator'
  | 'depackager'
  | 'pdf-parser'
  | 'certifier'
  | 'mail-fetcher'

export interface RemoteEdgeContainerSpec {
  readonly role: RemoteEdgeContainerRole
  readonly containerName: string
  readonly port: number
  /** Container used to read POD_AUTH_SECRET when recreating this role. */
  readonly authReferenceContainer: string
}

export const REMOTE_EDGE_SUPERVISOR_CONTAINERS: readonly RemoteEdgeContainerSpec[] = [
  {
    role: 'ingestor',
    containerName: `${REMOTE_POD_NAME}-ingestor`,
    port: 18100,
    authReferenceContainer: `${REMOTE_POD_NAME}-ingestor`,
  },
  {
    role: 'validator',
    containerName: `${REMOTE_POD_NAME}-validator`,
    port: 18101,
    authReferenceContainer: `${REMOTE_POD_NAME}-ingestor`,
  },
  {
    role: 'depackager',
    containerName: `${REMOTE_POD_NAME}-depackager`,
    port: 18102,
    authReferenceContainer: `${REMOTE_POD_NAME}-ingestor`,
  },
  {
    role: 'pdf-parser',
    containerName: `${REMOTE_POD_NAME}-pdf-parser`,
    port: 18107,
    authReferenceContainer: `${REMOTE_POD_NAME}-ingestor`,
  },
  {
    role: 'certifier',
    containerName: `${REMOTE_POD_NAME}-certifier`,
    port: 18104,
    authReferenceContainer: `${REMOTE_POD_NAME}-ingestor`,
  },
  {
    role: 'mail-fetcher',
    containerName: `${REMOTE_POD_NAME}-mail-fetcher`,
    port: 18106,
    authReferenceContainer: `${REMOTE_POD_NAME}-ingestor`,
  },
] as const

export function findContainerSpec(role: RemoteEdgeContainerRole): RemoteEdgeContainerSpec {
  const spec = REMOTE_EDGE_SUPERVISOR_CONTAINERS.find((c) => c.role === role)
  if (!spec) {
    throw new Error(`Unknown container role: ${role}`)
  }
  return spec
}
