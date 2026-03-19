import React from 'react'

// TEMPORARY STUB — remove after crash is isolated
const AnalysisCanvas: React.FC<Record<string, unknown>> = (props) => {
  console.log('[AnalysisCanvas STUB] Props received:', Object.keys(props))
  return <div style={{ padding: 20, color: 'white' }}>AnalysisCanvas stub loaded OK</div>
}

export default AnalysisCanvas

// Keep the original code COMMENTED OUT below, do not delete it.
/*
import { useEffect, useState, useCallback, useRef } from 'react'
import './AnalysisCanvas.css'
import { useCanvasState, type AnalysisOpenPayload, type DrawerTabId, HeroKPIStrip, type KPIData } from './analysis'
import { StatusBadge } from './analysis/StatusBadge'
import { getMockDashboardState } from './analysis/computePriorityAction'

interface DeepLinkState {
  traceId?: string
  eventId?: string
  drawerTab?: DrawerTabId
  ruleId?: string
}

interface AnalysisCanvasProps {
  deepLinkPayload?: AnalysisOpenPayload
  onDeepLinkConsumed?: () => void
}

type RuntimeState =
  | 'idle'
  | 'receiving'
  | 'initializing'
  | 'running'
  | 'awaiting_confirmation'
  | 'anchoring'
  | 'direct_chat'

export default function AnalysisCanvas({ deepLinkPayload, onDeepLinkConsumed }: AnalysisCanvasProps) {
  const [, , helpers] = useCanvasState()
  const [_liveDeepLink, setLiveDeepLink] = useState<DeepLinkState | null>(null)
  void _liveDeepLink
  const processedRef = useRef<AnalysisOpenPayload | null>(null)
  const [showPoaeHistory, setShowPoaeHistory] = useState(false)
  const [expandedPoaeLogId, setExpandedPoaeLogId] = useState<string | null>(null)
  const [isActivityHistoryModalOpen, setIsActivityHistoryModalOpen] = useState(false)
  const [isActivityDetailModalOpen, setIsActivityDetailModalOpen] = useState(false)
  const [runtimeState] = useState<RuntimeState>('idle')
  const [autoModeEnabled] = useState(false)
  const activityFeed = [
    { id: 'act_9f8e', time: '11:14', type: 'BEAP', source: 'inbox@acme', shortId: '9f8e7d…' },
    { id: 'act_7a8b', time: '11:10', type: 'WRCode', source: 'Scanner', shortId: '7a8b9c…' },
    { id: 'act_2c3d', time: '11:05', type: 'Import', source: 'batch_001', shortId: '2c3d4e…' },
    { id: 'act_1a2b', time: '10:58', type: 'Local', source: 'Manual', shortId: '1a2b3c…' },
    { id: 'act_5e6f', time: '16:42', type: 'BEAP', source: 'partner', shortId: '5e6f7a…' },
    { id: 'act_9c0d', time: '14:22', type: 'API', source: 'ERP', shortId: '9c0d1e…' },
  ]
  const latestCompleted = {
    what: 'Invoice Processing #2847',
    timestamp: '2026-01-06T11:12:33',
    sessionId: 'sess_abc123',
    executionId: 'exec_9f8e7d6c'
  }
  const dashboardState = getMockDashboardState()
  const pendingActions =
    dashboardState.preExecution.pendingConsents +
    dashboardState.liveExecution.unresolvedConsents
  const kpis: KPIData[] = [
    { label: 'Awaiting Approvals', value: pendingActions, status: pendingActions > 0 ? 'info' : 'success', icon: '✓', subtext: 'Consents & Reviews' },
    { label: 'Runtime Executions', value: dashboardState.liveExecution.isStreaming ? 'Active' : 'Ready', status: 'success', icon: '⚡', subtext: `${dashboardState.liveExecution.eventCount} events processed` },
    { label: 'Session Runs', value: dashboardState.postExecution.hasExecution ? 12 : 0, status: 'success', icon: '📊', subtext: 'Latest session activity' },
    { label: 'Optimization Events', value: 28, status: 'success', icon: '🎯', subtext: 'Performance metrics' },
    { label: 'PoAE™ Logs', value: dashboardState.postExecution.poaeReady ? 47 : 0, status: dashboardState.postExecution.poaeReady ? 'success' : 'info', icon: '🔒', subtext: 'Verification records' }
  ]
  useEffect(() => {
    if (!deepLinkPayload) return
    if (processedRef.current === deepLinkPayload) return
    processedRef.current = deepLinkPayload
    console.log('[AnalysisCanvas] Processing deep-link payload:', deepLinkPayload)
    const childDeepLink: DeepLinkState = {}
    if (deepLinkPayload.traceId) childDeepLink.traceId = deepLinkPayload.traceId
    if (deepLinkPayload.eventId) childDeepLink.eventId = deepLinkPayload.eventId
    if (deepLinkPayload.drawerTab) childDeepLink.drawerTab = deepLinkPayload.drawerTab
    if (deepLinkPayload.ruleId) childDeepLink.ruleId = deepLinkPayload.ruleId
    if (Object.keys(childDeepLink).length > 0) {
      const targetPhase = deepLinkPayload.phase || 'live'
      if (targetPhase === 'live') setLiveDeepLink(childDeepLink)
    }
    queueMicrotask(() => onDeepLinkConsumed?.())
  }, [deepLinkPayload, onDeepLinkConsumed])
  const _handleLiveDeepLinkConsumed = useCallback(() => setLiveDeepLink(null), [])
  void _handleLiveDeepLinkConsumed
  const getRuntimeStateDisplay = (state: RuntimeState) => {
    const stateMap: Record<RuntimeState, { label: string; icon: string; color: string; isIdle?: boolean }> = {
      idle: { label: 'Ready & Listening', icon: '📡', color: '#10b981', isIdle: true },
      receiving: { label: 'Receiving / depackaging', icon: '📥', color: '#3b82f6' },
      initializing: { label: 'Session initializing', icon: '⚡', color: '#f59e0b' },
      running: { label: 'Running operation', icon: '🔄', color: '#10b981' },
      awaiting_confirmation: { label: 'Awaiting confirmation', icon: '⏳', color: '#f59e0b' },
      anchoring: { label: 'Anchoring PoAE™', icon: '🔒', color: '#8b5cf6' },
      direct_chat: { label: 'Direct chat active', icon: '💬', color: '#06b6d4' },
    }
    return stateMap[state]
  }
  const handleOpenSessionHistory = () => setIsActivityHistoryModalOpen(true)
  const handlePostExport = () => console.log('[Dashboard] Export PoAE clicked')
  const stateDisplay = getRuntimeStateDisplay(runtimeState)
  return (
    <div className="analysis-canvas">
      <div className="analysis-header">
        <StatusBadge flags={helpers.currentFlags} size="medium" />
      </div>
      ... (rest of original JSX omitted for brevity - full code in git history)
    </div>
  )
}
*/
