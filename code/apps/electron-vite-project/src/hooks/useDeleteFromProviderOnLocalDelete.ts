import { useCallback } from 'react'

/** Minimum account row shape for Smart Sync toggle optimistic updates. */
export type SmartSyncProviderAccountRow = {
  id: string
  deleteFromProviderOnLocalDelete?: boolean
}

export function useDeleteFromProviderOnLocalDelete<T extends SmartSyncProviderAccountRow>({
  setProviderAccounts,
  loadProviderAccounts,
  onEmailAccountsChanged,
}: {
  setProviderAccounts: React.Dispatch<React.SetStateAction<T[]>>
  loadProviderAccounts: () => void | Promise<void>
  onEmailAccountsChanged?: () => void
}) {
  return useCallback(
    async (id: string, enabled: boolean) => {
      if (typeof window.emailAccounts?.setDeleteFromProviderOnLocalDelete !== 'function') return
      if (
        enabled &&
        !window.confirm(
          'Enable Smart Sync for this account?\n\nOn this host device, local delete, archive, and sorting will be mirrored to Gmail, Outlook, or your IMAP mailbox so your provider stays consistent with WRDesk. Deletes move to Trash / Deleted Items (recoverable there). Off by default.',
        )
      ) {
        return
      }
      setProviderAccounts((rows) =>
        rows.map((a) =>
          a.id === id ? { ...a, deleteFromProviderOnLocalDelete: enabled } : a,
        ),
      )
      try {
        const res = await window.emailAccounts.setDeleteFromProviderOnLocalDelete(id, enabled)
        if (!res?.ok) throw new Error((res as { error?: string })?.error || 'Failed')
        await loadProviderAccounts()
        onEmailAccountsChanged?.()
      } catch {
        await loadProviderAccounts()
        onEmailAccountsChanged?.()
      }
    },
    [setProviderAccounts, loadProviderAccounts, onEmailAccountsChanged],
  )
}
