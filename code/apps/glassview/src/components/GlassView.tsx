import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  FileWatcher, 
  ReviewFile, 
  CodeHunk 
} from '../services/FileWatcher';
import { 
  ReviewParser, 
  ParsedReview 
} from '../services/ReviewParser';
import { 
  IconTriggerSystem, 
  IconTrigger,
  OrchestratorMessagePasser 
} from '../services/IconTriggerSystem';
import BackendAutomationService from '../services/BackendAutomationService';

// Import components from our advanced library
import { DataTable } from '../../../packages/code-block-library/src/components/tables/DataTable';
import { Modal } from '../../../packages/code-block-library/src/components/modals/Modal';
import { Drawer } from '../../../packages/code-block-library/src/components/modals/Drawer';
import { Notification } from '../../../packages/code-block-library/src/components/modals/Notification';
import { GridLayout } from '../../../packages/code-block-library/src/components/layouts/GridLayout';
import { DashboardLayout } from '../../../packages/code-block-library/src/components/layouts/DashboardLayout';
import { Navbar } from '../../../packages/code-block-library/src/components/navigation/Navbar';
import { Sidebar } from '../../../packages/code-block-library/src/components/navigation/Sidebar';
import { FormBuilder } from '../../../packages/code-block-library/src/components/forms/FormBuilder';
import { LineChart } from '../../../packages/code-block-library/src/components/charts/LineChart';

interface GlassViewProps {
  watchDirectory?: string;
  autoStart?: boolean;
  theme?: 'light' | 'dark';
  enableMockMode?: boolean;
}

interface GlassViewState {
  isWatching: boolean;
  reviewFiles: ReviewFile[];
  parsedReviews: ParsedReview[];
  activeTriggers: IconTrigger[];
  selectedReview: ParsedReview | null;
  selectedTrigger: IconTrigger | null;
  notifications: Array<{
    id: string;
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
    timestamp: Date;
  }>;
  isLoading: boolean;
  error: string | null;
}

const GlassView: React.FC<GlassViewProps> = ({ 
  watchDirectory = '.cursorrules', 
  autoStart = true, 
  theme = 'light',
  enableMockMode = true 
}) => {
  const [state, setState] = useState<GlassViewState>({
    isWatching: false,
    reviewFiles: [],
    parsedReviews: [],
    activeTriggers: [],
    selectedReview: null,
    selectedTrigger: null,
    notifications: [],
    isLoading: false,
    error: null,
  });

  // Service instances
  const fileWatcher = useRef<FileWatcher>(new FileWatcher());
  const triggerSystem = useRef<IconTriggerSystem>(new IconTriggerSystem());
  const backendService = useRef<BackendAutomationService>(
    new BackendAutomationService({ mockMode: enableMockMode })
  );

  // UI state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showTriggerDrawer, setShowTriggerDrawer] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  /**
   * Initialize services and event listeners
   */
  useEffect(() => {
    const initializeServices = () => {
      // Set up file watcher events
      fileWatcher.current.on('file-added', handleFileAdded);
      fileWatcher.current.on('file-changed', handleFileChanged);
      fileWatcher.current.on('file-deleted', handleFileDeleted);
      fileWatcher.current.on('code-hunks-updated', handleCodeHunksUpdated);
      fileWatcher.current.on('error', handleFileWatcherError);

      // Set up trigger system events
      triggerSystem.current.on('trigger-created', handleTriggerCreated);
      triggerSystem.current.on('trigger-activated', handleTriggerActivated);
      triggerSystem.current.on('trigger-completed', handleTriggerCompleted);
      triggerSystem.current.on('bulk-update', handleBulkTriggerUpdate);

      // Connect backend service to trigger system
      const orchestrator: OrchestratorMessagePasser = {
        executeAction: (action) => backendService.current.executeAction(action),
        sendMessage: async (message) => console.log('Orchestrator message:', message),
        registerTriggerSystem: (system) => console.log('Trigger system registered'),
      };
      triggerSystem.current.setOrchestrator(orchestrator);

      if (autoStart) {
        startWatching();
      }
    };

    initializeServices();

    return () => {
      fileWatcher.current.stopAll();
      triggerSystem.current.removeAllListeners();
    };
  }, []);

  /**
   * Start watching for review files
   */
  const startWatching = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      await fileWatcher.current.startWatching(watchDirectory);
      setState(prev => ({ 
        ...prev, 
        isWatching: true, 
        isLoading: false,
        notifications: [
          ...prev.notifications,
          {
            id: `notif_${Date.now()}`,
            type: 'success',
            message: `Started watching ${watchDirectory}`,
            timestamp: new Date(),
          }
        ]
      }));
    } catch (error) {
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: error.message,
        notifications: [
          ...prev.notifications,
          {
            id: `notif_${Date.now()}`,
            type: 'error',
            message: `Failed to start watching: ${error.message}`,
            timestamp: new Date(),
          }
        ]
      }));
    }
  }, [watchDirectory]);

  /**
   * Stop watching
   */
  const stopWatching = useCallback(() => {
    fileWatcher.current.stopAll();
    setState(prev => ({ 
      ...prev, 
      isWatching: false,
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'info',
          message: 'Stopped watching for review files',
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  /**
   * Event handlers
   */
  const handleFileAdded = useCallback((file: ReviewFile) => {
    const parsedReview = ReviewParser.parseReviewFile(file);
    const triggers = triggerSystem.current.createTriggersFromReview(parsedReview);
    
    setState(prev => ({
      ...prev,
      reviewFiles: [...prev.reviewFiles, file],
      parsedReviews: [...prev.parsedReviews, parsedReview],
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'info',
          message: `New review file: ${file.fileName} (${triggers.length} triggers created)`,
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  const handleFileChanged = useCallback((file: ReviewFile) => {
    const parsedReview = ReviewParser.parseReviewFile(file);
    
    setState(prev => ({
      ...prev,
      reviewFiles: prev.reviewFiles.map(f => f.id === file.id ? file : f),
      parsedReviews: prev.parsedReviews.map(r => r.id === file.id ? parsedReview : r),
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'info',
          message: `Review file updated: ${file.fileName}`,
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  const handleFileDeleted = useCallback((filePath: string) => {
    setState(prev => ({
      ...prev,
      reviewFiles: prev.reviewFiles.filter(f => f.filePath !== filePath),
      parsedReviews: prev.parsedReviews.filter(r => r.filePath !== filePath),
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'warning',
          message: `Review file deleted: ${filePath}`,
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  const handleCodeHunksUpdated = useCallback((hunks: CodeHunk[]) => {
    console.log('Code hunks updated:', hunks.length);
  }, []);

  const handleFileWatcherError = useCallback((error: Error) => {
    setState(prev => ({
      ...prev,
      error: error.message,
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'error',
          message: `File watcher error: ${error.message}`,
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  const handleTriggerCreated = useCallback((trigger: IconTrigger) => {
    setState(prev => ({
      ...prev,
      activeTriggers: [...prev.activeTriggers, trigger],
    }));
  }, []);

  const handleTriggerActivated = useCallback(async (trigger: IconTrigger) => {
    setState(prev => ({
      ...prev,
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'info',
          message: `Executing: ${trigger.label}`,
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  const handleTriggerCompleted = useCallback((trigger: IconTrigger, result: any) => {
    setState(prev => ({
      ...prev,
      activeTriggers: prev.activeTriggers.map(t => 
        t.id === trigger.id ? { ...t, status: 'completed' } : t
      ),
      notifications: [
        ...prev.notifications,
        {
          id: `notif_${Date.now()}`,
          type: 'success',
          message: `Completed: ${trigger.label}`,
          timestamp: new Date(),
        }
      ]
    }));
  }, []);

  const handleBulkTriggerUpdate = useCallback((triggers: IconTrigger[]) => {
    setState(prev => ({
      ...prev,
      activeTriggers: [...prev.activeTriggers, ...triggers],
    }));
  }, []);

  /**
   * UI Actions
   */
  const openReviewDetails = useCallback((review: ParsedReview) => {
    setState(prev => ({ ...prev, selectedReview: review }));
    setShowReviewModal(true);
  }, []);

  const openTriggerDetails = useCallback((trigger: IconTrigger) => {
    setState(prev => ({ ...prev, selectedTrigger: trigger }));
    setShowTriggerDrawer(true);
  }, []);

  const executeTrigger = useCallback(async (triggerId: string) => {
    try {
      const result = await triggerSystem.current.activateTrigger(triggerId);
      console.log('Trigger executed successfully:', result);
    } catch (error) {
      setState(prev => ({
        ...prev,
        notifications: [
          ...prev.notifications,
          {
            id: `notif_${Date.now()}`,
            type: 'error',
            message: `Trigger execution failed: ${error.message}`,
            timestamp: new Date(),
          }
        ]
      }));
    }
  }, []);

  const dismissNotification = useCallback((notificationId: string) => {
    setState(prev => ({
      ...prev,
      notifications: prev.notifications.filter(n => n.id !== notificationId),
    }));
  }, []);

  /**
   * Data for components
   */
  const reviewTableData = state.parsedReviews.map(review => ({
    id: review.id,
    title: review.title,
    type: review.reviewType,
    priority: review.priority,
    status: review.metadata.status,
    hunks: review.codeHunks.length,
    actions: (
      <div className="flex gap-2">
        <button 
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
          onClick={() => openReviewDetails(review)}
        >
          View
        </button>
      </div>
    ),
  }));

  const triggerTableData = state.activeTriggers
    .filter(trigger => trigger.status === 'pending' || trigger.status === 'active')
    .map(trigger => ({
      id: trigger.id,
      label: trigger.label,
      color: trigger.color,
      type: trigger.type,
      priority: trigger.priority,
      status: trigger.status,
      actions: (
        <div className="flex gap-2">
          <button 
            className={`px-3 py-1 rounded text-sm ${
              trigger.status === 'pending' 
                ? 'bg-green-500 hover:bg-green-600 text-white' 
                : 'bg-gray-300 text-gray-600'
            }`}
            onClick={() => trigger.status === 'pending' ? executeTrigger(trigger.id) : openTriggerDetails(trigger)}
            disabled={trigger.status !== 'pending'}
          >
            {trigger.status === 'pending' ? 'Execute' : 'View'}
          </button>
        </div>
      ),
    }));

  const activityChartData = {
    labels: state.notifications.slice(-10).map((_, i) => `${i + 1}`),
    datasets: [{
      label: 'Activity',
      data: state.notifications.slice(-10).map(() => Math.floor(Math.random() * 100)),
      borderColor: 'rgb(59, 130, 246)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
    }]
  };

  const sidebarMenuItems = [
    { 
      id: 'dashboard', 
      label: 'Dashboard', 
      icon: '📊',
      onClick: () => console.log('Dashboard clicked') 
    },
    { 
      id: 'reviews', 
      label: 'Reviews', 
      icon: '📝',
      badge: state.parsedReviews.length.toString(),
      onClick: () => console.log('Reviews clicked') 
    },
    { 
      id: 'triggers', 
      label: 'Triggers', 
      icon: '⚡',
      badge: state.activeTriggers.filter(t => t.status === 'pending').length.toString(),
      onClick: () => console.log('Triggers clicked') 
    },
    { 
      id: 'settings', 
      label: 'Settings', 
      icon: '⚙️',
      onClick: () => console.log('Settings clicked') 
    },
  ];

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Navigation */}
      <Navbar
        brand="GlassView"
        items={[
          { 
            id: 'watch-toggle', 
            label: state.isWatching ? 'Stop Watching' : 'Start Watching',
            onClick: state.isWatching ? stopWatching : startWatching,
            className: state.isWatching ? 'text-red-600' : 'text-green-600'
          },
          { 
            id: 'status', 
            label: `${state.reviewFiles.length} files, ${state.activeTriggers.length} triggers`,
            disabled: true 
          },
        ]}
        className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
      />

      <div className="flex">
        {/* Sidebar */}
        <Sidebar
          items={sidebarMenuItems}
          isCollapsed={sidebarCollapsed}
          onToggle={setSidebarCollapsed}
          className={theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
        />

        {/* Main Content */}
        <main className="flex-1">
          <DashboardLayout
            header={
              <div className="p-6">
                <h1 className="text-2xl font-bold mb-2">
                  GlassView Code Review Monitor
                </h1>
                <p className="text-gray-600">
                  Watching: {watchDirectory} | Status: {state.isWatching ? '🟢 Active' : '🔴 Inactive'}
                </p>
              </div>
            }
            content={
              <div className="p-6 space-y-6">
                {/* Activity Chart */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Activity Overview</h2>
                  <LineChart
                    data={activityChartData}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        y: { beginAtZero: true },
                      },
                    }}
                    className="h-64"
                  />
                </div>

                {/* Reviews Table */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Review Files</h2>
                  <DataTable
                    data={reviewTableData}
                    columns={[
                      { key: 'title', header: 'Title', sortable: true },
                      { key: 'type', header: 'Type', sortable: true },
                      { key: 'priority', header: 'Priority', sortable: true },
                      { key: 'status', header: 'Status', sortable: true },
                      { key: 'hunks', header: 'Code Hunks', sortable: true },
                      { key: 'actions', header: 'Actions', sortable: false },
                    ]}
                    searchable
                    pagination={{
                      pageSize: 10,
                      showSizeSelector: true,
                    }}
                  />
                </div>

                {/* Active Triggers */}
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold mb-4">Active Triggers</h2>
                  <DataTable
                    data={triggerTableData}
                    columns={[
                      { key: 'label', header: 'Label', sortable: true },
                      { key: 'color', header: 'Color', sortable: true },
                      { key: 'type', header: 'Type', sortable: true },
                      { key: 'priority', header: 'Priority', sortable: true },
                      { key: 'status', header: 'Status', sortable: true },
                      { key: 'actions', header: 'Actions', sortable: false },
                    ]}
                    searchable
                    emptyMessage="No active triggers"
                  />
                </div>
              </div>
            }
            className={theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'}
          />
        </main>
      </div>

      {/* Review Details Modal */}
      <Modal
        isOpen={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        title={state.selectedReview?.title || 'Review Details'}
        size="large"
      >
        {state.selectedReview && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold">Description</h3>
              <p className="text-gray-600">{state.selectedReview.description}</p>
            </div>
            <div>
              <h3 className="font-semibold">Type</h3>
              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                {state.selectedReview.reviewType}
              </span>
            </div>
            <div>
              <h3 className="font-semibold">Priority</h3>
              <span className={`px-2 py-1 rounded text-sm ${
                state.selectedReview.priority === 'critical' ? 'bg-red-100 text-red-800' :
                state.selectedReview.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                state.selectedReview.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {state.selectedReview.priority}
              </span>
            </div>
            <div>
              <h3 className="font-semibold">Code Hunks ({state.selectedReview.codeHunks.length})</h3>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {state.selectedReview.codeHunks.map((hunk, index) => (
                  <div key={hunk.id} className="border rounded p-3 text-sm">
                    <div className="font-medium">
                      {hunk.filePath}:{hunk.startLine}-{hunk.endLine} ({hunk.changeType})
                    </div>
                    {hunk.addedLines.length > 0 && (
                      <div className="mt-2">
                        <div className="text-green-600 font-medium">+ Added ({hunk.addedLines.length})</div>
                        <pre className="text-xs bg-green-50 p-2 rounded overflow-x-auto">
                          {hunk.addedLines.join('\n')}
                        </pre>
                      </div>
                    )}
                    {hunk.deletedLines.length > 0 && (
                      <div className="mt-2">
                        <div className="text-red-600 font-medium">- Deleted ({hunk.deletedLines.length})</div>
                        <pre className="text-xs bg-red-50 p-2 rounded overflow-x-auto">
                          {hunk.deletedLines.join('\n')}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Trigger Details Drawer */}
      <Drawer
        isOpen={showTriggerDrawer}
        onClose={() => setShowTriggerDrawer(false)}
        position="right"
        size="medium"
        title={state.selectedTrigger?.label || 'Trigger Details'}
      >
        {state.selectedTrigger && (
          <div className="space-y-4 p-4">
            <div>
              <h3 className="font-semibold">Description</h3>
              <p className="text-gray-600">{state.selectedTrigger.description}</p>
            </div>
            <div>
              <h3 className="font-semibold">Status</h3>
              <span className={`px-2 py-1 rounded text-sm ${
                state.selectedTrigger.status === 'completed' ? 'bg-green-100 text-green-800' :
                state.selectedTrigger.status === 'active' ? 'bg-blue-100 text-blue-800' :
                state.selectedTrigger.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {state.selectedTrigger.status}
              </span>
            </div>
            <div>
              <h3 className="font-semibold">Color Schema</h3>
              <div className={`w-8 h-8 rounded`} style={{ backgroundColor: state.selectedTrigger.color }}></div>
            </div>
            {state.selectedTrigger.targetFile && (
              <div>
                <h3 className="font-semibold">Target File</h3>
                <code className="text-sm bg-gray-100 p-1 rounded">{state.selectedTrigger.targetFile}</code>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Notifications */}
      <div className="fixed top-20 right-4 space-y-2 max-w-sm">
        {state.notifications.slice(-3).map((notification) => (
          <Notification
            key={notification.id}
            type={notification.type}
            message={notification.message}
            onClose={() => dismissNotification(notification.id)}
            duration={5000}
          />
        ))}
      </div>

      {/* Loading Overlay */}
      {state.isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p>Initializing file watcher...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default GlassView;