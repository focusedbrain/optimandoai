/**
 * Main Vault UI Component
 * Combines all vault functionality in a single component
 */

import React, { useState, useEffect } from 'react'
import { UnlockView } from './UnlockView'
import { connectVault, disconnectVault, lockVault, listItems, listContainers, createItem, createContainer, deleteItem, deleteContainer, getItem, updateItem, exportCSV, importCSV, getSettings, updateSettings } from './api'
import type { VaultItem, Container, Field, ItemCategory } from './types'

export const VaultUI: React.FC = () => {
  const [unlocked, setUnlocked] = useState(false)
  const [view, setView] = useState<'items' | 'settings'>('items')
  const [items, setItems] = useState<VaultItem[]>([])
  const [containers, setContainers] = useState<Container[]>([])
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null)
  const [creatingItem, setCreatingItem] = useState(false)
  const [autoLockMinutes, setAutoLockMinutes] = useState(30)

  useEffect(() => {
    connectVault().catch(console.error)
    return () => disconnectVault()
  }, [])

  useEffect(() => {
    if (unlocked) {
      loadData()
    }
  }, [unlocked])

  const loadData = async () => {
    setLoading(true)
    try {
      const [itemsData, containersData, settings] = await Promise.all([
        listItems(),
        listContainers(),
        getSettings(),
      ])
      setItems(itemsData)
      setContainers(containersData)
      setAutoLockMinutes(settings.autoLockMinutes)
    } catch (error) {
      console.error('[VAULT UI] Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLock = async () => {
    await lockVault()
    setUnlocked(false)
  }

  const filteredItems = items.filter((item) => {
    if (selectedCategory !== 'all' && item.category !== selectedCategory) {
      return false
    }
    if (searchQuery && !item.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    return true
  })

  const handleCreateItem = async (category: ItemCategory) => {
    const title = prompt(`Enter ${category} title:`)
    if (!title) return

    const newItem = {
      category,
      title,
      fields: [] as Field[],
      favorite: false,
    }

    // Add default fields based on category
    if (category === 'password') {
      const domain = prompt('Enter domain (e.g., google.com):')
      const username = prompt('Enter username:')
      const password = prompt('Enter password:')

      newItem.fields = [
        { key: 'username', value: username || '', encrypted: false, type: 'text' },
        { key: 'password', value: password || '', encrypted: true, type: 'password' },
      ]

      if (domain) {
        Object.assign(newItem, { domain })
      }
    }

    try {
      await createItem(newItem)
      await loadData()
    } catch (error: any) {
      alert('Error creating item: ' + error.message)
    }
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return

    try {
      await deleteItem(id)
      await loadData()
    } catch (error: any) {
      alert('Error deleting item: ' + error.message)
    }
  }

  const handleExportCSV = async () => {
    try {
      const csv = await exportCSV()
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vault-export-${Date.now()}.csv`
      a.click()
    } catch (error: any) {
      alert('Error exporting CSV: ' + error.message)
    }
  }

  const handleUpdateSettings = async () => {
    try {
      await updateSettings({ autoLockMinutes })
      alert('Settings saved!')
    } catch (error: any) {
      alert('Error saving settings: ' + error.message)
    }
  }

  if (!unlocked) {
    return <UnlockView onUnlocked={() => setUnlocked(true)} />
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
      color: '#fff',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: '16px' }}>
          <button
            onClick={() => setView('items')}
            style={{
              background: view === 'items' ? '#8b5cf6' : 'transparent',
              border: 'none',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Items
          </button>
          <button
            onClick={() => setView('settings')}
            style={{
              background: view === 'settings' ? '#8b5cf6' : 'transparent',
              border: 'none',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            Settings
          </button>
        </div>
        <button
          onClick={handleLock}
          style={{
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#ef4444',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          🔒 Lock
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        {view === 'items' && (
          <>
            {/* Search and Filters */}
            <div style={{ marginBottom: '20px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.3)',
                  color: '#fff',
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: '12px',
                }}
              />

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(['all', 'password', 'address', 'payment', 'tax_id', 'notice'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      background: selectedCategory === cat ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
                      border: 'none',
                      color: '#fff',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    {cat === 'all' ? 'All' : cat.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Items List */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.5)' }}>
                Loading...
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.5)' }}>
                No items found
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={async () => {
                      const fullItem = await getItem(item.id)
                      setEditingItem(fullItem)
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                          {item.category} {item.domain && `• ${item.domain}`}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteItem(item.id)
                        }}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: 'none',
                          color: '#ef4444',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create Button */}
            <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleCreateItem('password')}
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                  border: 'none',
                  color: '#fff',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                + New Password
              </button>
            </div>
          </>
        )}

        {view === 'settings' && (
          <div style={{ maxWidth: '500px' }}>
            <h3 style={{ marginTop: 0 }}>Vault Settings</h3>

            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: 600,
              }}>
                Auto-lock timeout
              </label>
              <select
                value={autoLockMinutes}
                onChange={(e) => setAutoLockMinutes(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(0,0,0,0.3)',
                  color: '#fff',
                  fontSize: '14px',
                }}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={1440}>1 day</option>
                <option value={0}>Never</option>
              </select>
            </div>

            <button
              onClick={handleUpdateSettings}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                border: 'none',
                color: '#fff',
                padding: '12px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '24px',
              }}
            >
              Save Settings
            </button>

            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '24px 0' }} />

            <h4>Export & Import</h4>

            <button
              onClick={handleExportCSV}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                padding: '12px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                marginRight: '12px',
              }}
            >
              Export CSV
            </button>
          </div>
        )}
      </div>

      {/* Item Detail Modal */}
      {editingItem && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>{editingItem.title}</h3>
              <button
                onClick={() => setEditingItem(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  fontSize: '24px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gap: '16px' }}>
              {editingItem.fields.map((field, idx) => (
                <div key={idx}>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.8)',
                  }}>
                    {field.key}
                  </label>
                  <input
                    type={field.type === 'password' ? 'text' : field.type}
                    value={field.value}
                    readOnly
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.3)',
                      color: '#fff',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

