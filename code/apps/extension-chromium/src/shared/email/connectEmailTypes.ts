/**
 * Launch context for the shared Connect Email flow (analytics, UX hints, debugging).
 * Keep values stable — they may be logged or persisted.
 */
export enum ConnectEmailLaunchSource {
  Inbox = 'inbox',
  BulkInbox = 'bulk_inbox',
  WrChatDocked = 'wr_chat_docked',
  WrChatPopup = 'wr_chat_popup',
  /** Legacy BEAP inbox layout (Electron); kept for analytics if that surface is re-enabled. */
  BeapInboxDashboard = 'beap_inbox_dashboard',
  BeapBulkInboxDashboard = 'beap_bulk_inbox_dashboard',
}

export function formatConnectEmailLaunchSource(source: ConnectEmailLaunchSource): string {
  switch (source) {
    case ConnectEmailLaunchSource.Inbox:
      return 'Inbox'
    case ConnectEmailLaunchSource.BulkInbox:
      return 'Bulk Inbox'
    case ConnectEmailLaunchSource.WrChatDocked:
      return 'WR Chat (docked)'
    case ConnectEmailLaunchSource.WrChatPopup:
      return 'WR Chat (popup)'
    case ConnectEmailLaunchSource.BeapInboxDashboard:
      return 'BEAP Inbox (legacy)'
    case ConnectEmailLaunchSource.BeapBulkInboxDashboard:
      return 'BEAP Bulk Inbox (legacy)'
    default:
      return 'Email'
  }
}
