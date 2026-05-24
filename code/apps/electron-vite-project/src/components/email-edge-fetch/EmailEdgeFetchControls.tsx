import React, { useCallback, useMemo, useState } from 'react'
import type { EmailAccount } from '@ext/wrguard/components/EmailProvidersSection'
import {
  EmailAccountEdgeFetchRow,
  EdgeFetchConsentDialog,
  EdgeFetchMoveBackDialog,
  EdgeFetchStatusDialog,
  useEdgeFetchState,
} from './index.js'

type DialogKind = 'consent' | 'moveBack' | 'status' | 'reauth' | null

export interface EmailEdgeFetchControlsProps {
  account: EmailAccount
}

export function EmailEdgeFetchControls({ account }: EmailEdgeFetchControlsProps) {
  const { eligibility, snapshotFor, refresh } = useEdgeFetchState()
  const snapshot = snapshotFor(account.id)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [busy, setBusy] = useState(false)

  const replica = useMemo(() => {
    const fromSnap = snapshot?.replicaId
    if (fromSnap && eligibility?.replicas.some((r) => r.edge_pod_id === fromSnap)) {
      return eligibility!.replicas.find((r) => r.edge_pod_id === fromSnap)!
    }
    return eligibility?.replicas[0] ?? null
  }, [eligibility, snapshot?.replicaId])

  const runAction = useCallback(
    async (kind: 'migrateToEdge' | 'migrateBack' | 'reauthorize', payload: Record<string, unknown>) => {
      const api = window.emailEdgeFetch
      if (!api) return
      setBusy(true)
      try {
        const fn =
          kind === 'migrateToEdge'
            ? api.migrateToEdge
            : kind === 'migrateBack'
              ? api.migrateBack
              : api.reauthorize
        const res = await fn(payload)
        if (!res?.ok) throw new Error(String(res?.error ?? 'Operation failed'))
        await refresh()
        setDialog(null)
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const submitSsh = useCallback(
    (kind: 'migrateToEdge' | 'migrateBack' | 'reauthorize', values: {
      sshUser: string
      sshPort: string
      sshKey: string
      passphrase: string
      replicaId: string
    }) => {
      void runAction(kind, {
        accountId: account.id,
        replicaId: values.replicaId,
        sshUser: values.sshUser,
        sshPort: values.sshPort,
        sshKey: values.sshKey,
        passphrase: values.passphrase || undefined,
      })
    },
    [account.id, runAction],
  )

  if (!eligibility) return null

  return (
    <>
      <EmailAccountEdgeFetchRow
        accountId={account.id}
        provider={account.provider}
        snapshot={snapshot}
        canMigrate={eligibility.canMigrate}
        migrateDisabledReason={eligibility.reason}
        busy={busy}
        onMoveToEdge={() => setDialog('consent')}
        onMoveBack={() => setDialog('moveBack')}
        onReauthorize={() => setDialog('reauth')}
        onViewStatus={() => setDialog('status')}
      />

      {replica ? (
        <>
          <EdgeFetchConsentDialog
            open={dialog === 'consent'}
            accountEmail={account.email}
            replicaHost={replica.host}
            replicaId={replica.edge_pod_id}
            busy={busy}
            mode="migrate"
            onCancel={() => setDialog(null)}
            onConfirm={(values) => submitSsh('migrateToEdge', values)}
          />
          <EdgeFetchConsentDialog
            open={dialog === 'reauth'}
            accountEmail={account.email}
            replicaHost={replica.host}
            replicaId={replica.edge_pod_id}
            busy={busy}
            mode="reauthorize"
            onCancel={() => setDialog(null)}
            onConfirm={(values) => submitSsh('reauthorize', values)}
          />
          <EdgeFetchMoveBackDialog
            open={dialog === 'moveBack'}
            accountEmail={account.email}
            replicaHost={replica.host}
            replicaId={replica.edge_pod_id}
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={(values) => submitSsh('migrateBack', values)}
          />
        </>
      ) : null}

      <EdgeFetchStatusDialog
        open={dialog === 'status'}
        snapshot={snapshot}
        onClose={() => setDialog(null)}
      />
    </>
  )
}
