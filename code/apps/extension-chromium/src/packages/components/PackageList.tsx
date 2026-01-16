/**
 * PackageList Component
 * 
 * Displays a list of BEAP packages for a given section.
 * Shows empty state when no packages.
 */

import React from 'react'
import { PackageListItem } from './PackageListItem'
import type { BeapPackage } from '../types'

interface PackageListProps {
  packages: BeapPackage[]
  theme?: 'default' | 'dark' | 'professional'
  emptyIcon?: string
  emptyTitle?: string
  emptyDescription?: string
  onPackageClick?: (packageId: string) => void
  onAccept?: (packageId: string) => void
  onReject?: (packageId: string) => void
  showActions?: boolean
}

export const PackageList: React.FC<PackageListProps> = ({
  packages,
  theme = 'default',
  emptyIcon = '📦',
  emptyTitle = 'No packages',
  emptyDescription = 'Packages will appear here.',
  onPackageClick,
  onAccept,
  onReject,
  showActions = false
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  
  if (packages.length === 0) {
    return (
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '40px 20px' 
      }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ 
            fontSize: '48px', 
            display: 'block', 
            marginBottom: '16px' 
          }}>
            {emptyIcon}
          </span>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: '600', 
            color: textColor, 
            marginBottom: '8px' 
          }}>
            {emptyTitle}
          </div>
          <div style={{ 
            fontSize: '13px', 
            color: mutedColor, 
            maxWidth: '280px' 
          }}>
            {emptyDescription}
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div style={{ 
      flex: 1, 
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {packages.map(pkg => (
        <PackageListItem
          key={pkg.package_id}
          package={pkg}
          theme={theme}
          onClick={onPackageClick}
          onAccept={onAccept}
          onReject={onReject}
          showActions={showActions}
        />
      ))}
    </div>
  )
}

export default PackageList



