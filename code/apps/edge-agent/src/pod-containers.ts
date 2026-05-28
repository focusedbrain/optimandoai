import { REMOTE_EDGE_POD_NAME } from './pod-deploy.js'

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
  readonly hostLoopback?: boolean
}

export const REMOTE_EDGE_SUPERVISOR_CONTAINERS: readonly RemoteEdgeContainerSpec[] = [
  { role: 'ingestor', containerName: `${REMOTE_EDGE_POD_NAME}-ingestor`, port: 18100, hostLoopback: true },
  { role: 'validator', containerName: `${REMOTE_EDGE_POD_NAME}-validator`, port: 18101 },
  { role: 'depackager', containerName: `${REMOTE_EDGE_POD_NAME}-depackager`, port: 18102 },
  { role: 'pdf-parser', containerName: `${REMOTE_EDGE_POD_NAME}-pdf-parser`, port: 18107 },
  { role: 'certifier', containerName: `${REMOTE_EDGE_POD_NAME}-certifier`, port: 18104 },
  { role: 'mail-fetcher', containerName: `${REMOTE_EDGE_POD_NAME}-mail-fetcher`, port: 18106 },
] as const
