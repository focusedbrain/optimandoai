import WRChatDashboardView from './WRChatDashboardView'
import './WrChatDashboardPanel.css'

type ExtensionTheme = 'pro' | 'dark' | 'standard'

interface WrChatDashboardPanelProps {
  extensionTheme: ExtensionTheme
}

/** WR Chat in the Electron dashboard (in-content). Extension popup remains available from the extension UI. */
export default function WrChatDashboardPanel({ extensionTheme }: WrChatDashboardPanelProps) {
  return (
    <div className="wr-chat-dashboard-panel">
      <WRChatDashboardView theme={extensionTheme} />
    </div>
  )
}
