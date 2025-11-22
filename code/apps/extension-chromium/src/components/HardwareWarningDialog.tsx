/**
 * Hardware Warning Dialog Component
 * Shows friendly warning when hardware is too old for local LLMs
 */

import React from 'react'

export interface HardwareWarningProps {
  show: boolean
  onUseTurboMode: () => void
  onStayLocal: () => void
  reasons?: string[]
}

export const HardwareWarningDialog: React.FC<HardwareWarningProps> = ({
  show,
  onUseTurboMode,
  onStayLocal,
  reasons = []
}) => {
  if (!show) return null
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-fadeIn">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-3xl">🚀</span>
          </div>
        </div>
        
        {/* Title */}
        <h2 className="text-xl font-semibold text-center mb-3 text-gray-800">
          Local AI on this PC will be slow — that's a hardware limit.
        </h2>
        
        {/* Body */}
        <div className="text-gray-600 text-sm space-y-3 mb-6">
          <p>
            Your computer is missing modern CPU features (like AVX2), so on-device models run in a slow fallback mode.
          </p>
          
          <p>
            <strong>Cloud/Turbo models are NOT affected and will run at full speed.</strong>
          </p>
          
          {reasons.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                Technical details
              </summary>
              <ul className="mt-2 ml-4 text-xs text-gray-500 list-disc">
                {reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
        
        {/* Buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onUseTurboMode}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all shadow-md hover:shadow-lg"
          >
            Use Turbo Mode (recommended)
          </button>
          
          <button
            onClick={onStayLocal}
            className="w-full py-2 px-4 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Run Locally anyway (slow)
          </button>
        </div>
        
        {/* Footer hint */}
        <p className="text-xs text-gray-400 text-center mt-4">
          You can change this anytime in Settings
        </p>
      </div>
    </div>
  )
}

export default HardwareWarningDialog

