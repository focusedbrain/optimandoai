/**
 * Seed Data for BEAP Messages UI
 * 
 * Mock data for visual validation during development.
 * 
 * @version 1.0.0
 */

import type { BeapMessageUI } from './types'

/**
 * Generate a mock fingerprint
 */
function mockFingerprint(): string {
  const chars = 'ABCDEF0123456789'
  let fp = ''
  for (let i = 0; i < 64; i++) {
    fp += chars[Math.floor(Math.random() * chars.length)]
  }
  return fp
}

/**
 * Seed dataset for testing UI
 */
export const SEED_MESSAGES: BeapMessageUI[] = [
  // INBOX messages - with verification states
  {
    id: 'msg_inbox_001',
    folder: 'inbox',
    fingerprint: 'A1B2C3...X9Y0',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Q4 Budget Review - Secure Package',
    timestamp: Date.now() - 1000 * 60 * 30, // 30 mins ago
    bodyText: 'Please review the attached budget proposal for Q4. This package contains sensitive financial projections that require your approval before the board meeting next week.',
    attachments: [
      { name: 'Q4_Budget_Proposal.pdf', size: 245000 },
      { name: 'Financial_Projections.xlsx', size: 89000 }
    ],
    status: 'accepted',
    verificationStatus: 'accepted',
    direction: 'inbound',
    senderName: 'Alice Chen',
    channelSite: 'mail.google.com',
    hardwareAttestation: 'verified',
    envelopeSummary: {
      envelopeIdShort: 'abc123de...',
      senderFingerprintDisplay: 'A1B2C3D4E5F6G7H8...',
      channelDisplay: '📧 Email',
      ingressSummary: 'handshake:✓',
      egressSummary: 'none:local-only',
      createdAt: Date.now() - 1000 * 60 * 30,
      expiryStatus: 'no_expiry',
      signatureStatusDisplay: '✓ Valid',
      hashVerificationDisplay: '✓ Present'
    },
    capsuleMetadata: {
      capsuleId: 'cap_inbox_001',
      title: 'Q4 Budget Review',
      attachmentCount: 2,
      attachmentNames: ['Q4_Budget_Proposal.pdf', 'Financial_Projections.xlsx'],
      sessionRefCount: 0,
      hasDataRequest: false
    }
  },
  {
    id: 'msg_inbox_002',
    folder: 'inbox',
    fingerprint: 'D4E5F6...Z1A2',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'messenger',
    title: 'Project Handover Documentation',
    timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
    bodyText: 'Hi, as discussed in our meeting, I\'m sending over the project documentation for the handover. Please confirm receipt.',
    attachments: [
      { name: 'Project_Handover.pdf', size: 512000 }
    ],
    status: 'pending_verification',
    verificationStatus: 'pending_verification',
    direction: 'inbound',
    senderName: 'Bob Wilson',
    channelSite: 'web.whatsapp.com',
    hardwareAttestation: 'pending'
  },
  {
    id: 'msg_inbox_003',
    folder: 'inbox',
    fingerprint: 'G7H8I9...B3C4',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'download',
    title: 'Encrypted Contract Draft',
    timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    bodyText: 'The encrypted contract draft as discussed. Please use your private key to decrypt and review.',
    attachments: [],
    status: 'pending_verification',
    verificationStatus: 'pending_verification',
    direction: 'inbound',
    hardwareAttestation: 'unknown'
  },
  {
    id: 'msg_inbox_004',
    folder: 'inbox',
    fingerprint: 'H1I2J3...C4D5',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Web Egress Request - External Report',
    timestamp: Date.now() - 1000 * 60 * 60 * 3, // 3 hours ago
    bodyText: 'This package requests egress to slack.com for notifications.',
    attachments: [
      { name: 'External_Report.pdf', size: 145000 }
    ],
    status: 'pending_verification',
    verificationStatus: 'pending_verification',
    direction: 'inbound',
    senderName: 'External Partner',
    channelSite: 'mail.google.com',
    hardwareAttestation: 'verified'
  },
  
  // OUTBOX messages - with delivery tracking
  {
    id: 'msg_outbox_001',
    folder: 'outbox',
    fingerprint: 'J1K2L3...D5E6',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Proposal Submission - Project Alpha',
    timestamp: Date.now() - 1000 * 60 * 15, // 15 mins ago
    bodyText: 'Please find attached our proposal for Project Alpha. Looking forward to your feedback.',
    attachments: [
      { name: 'Proposal_Alpha.pdf', size: 1250000 }
    ],
    status: 'queued',
    direction: 'outbound',
    packageId: 'beap_email_001',
    envelopeRef: 'env_email_001',
    capsuleRef: 'cap_email_001',
    deliveryStatus: 'queued',
    deliveryAttempts: [
      { at: Date.now() - 1000 * 60 * 15, status: 'queued' }
    ]
  },
  {
    id: 'msg_outbox_002',
    folder: 'outbox',
    fingerprint: 'M4N5O6...F7G8',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'messenger',
    title: 'Weekly Status Update',
    timestamp: Date.now() - 1000 * 60 * 45, // 45 mins ago
    bodyText: 'Here\'s the weekly status update for the development team. All milestones on track.',
    attachments: [],
    status: 'pending_user_action',
    direction: 'outbound',
    packageId: 'beap_messenger_001',
    envelopeRef: 'env_messenger_001',
    capsuleRef: 'cap_messenger_001',
    deliveryStatus: 'pending_user_action',
    deliveryAttempts: [
      { at: Date.now() - 1000 * 60 * 45, status: 'pending_user_action' }
    ],
    messengerPayload: `📦 BEAP™ Secure Package

Here's the weekly status update for the development team. All milestones on track.

---
Package ID: beap_messenger_001
Envelope: env_messenger_001
Capsule: cap_messenger_001

This message was sent via BEAP™ secure messaging.`
  },
  {
    id: 'msg_outbox_003',
    folder: 'outbox',
    fingerprint: 'N6O7P8...G9H0',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'download',
    title: 'USB Transfer Package',
    timestamp: Date.now() - 1000 * 60 * 60, // 1 hour ago
    bodyText: 'Package for USB transfer to external partner system.',
    attachments: [
      { name: 'secure_transfer.beap', size: 345000 }
    ],
    status: 'pending_user_action',
    direction: 'outbound',
    packageId: 'beap_download_001',
    envelopeRef: 'env_download_001',
    capsuleRef: 'cap_download_001',
    deliveryStatus: 'pending_user_action',
    deliveryAttempts: [
      { at: Date.now() - 1000 * 60 * 60, status: 'pending_user_action' }
    ],
    downloadRef: 'data:application/json;base64,eyJ0eXBlIjoiQkVBUCJ9'
  },
  {
    id: 'msg_outbox_004',
    folder: 'outbox',
    fingerprint: 'Q1R2S3...I4J5',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Failed Delivery - Network Error',
    timestamp: Date.now() - 1000 * 60 * 120, // 2 hours ago
    bodyText: 'This email failed to send due to a network error.',
    attachments: [],
    status: 'failed',
    direction: 'outbound',
    packageId: 'beap_failed_001',
    envelopeRef: 'env_failed_001',
    capsuleRef: 'cap_failed_001',
    deliveryStatus: 'failed',
    deliveryError: 'Network timeout: Unable to connect to mail server.',
    deliveryAttempts: [
      { at: Date.now() - 1000 * 60 * 120, status: 'queued' },
      { at: Date.now() - 1000 * 60 * 119, status: 'sending' },
      { at: Date.now() - 1000 * 60 * 118, status: 'failed', error: 'Network timeout' }
    ]
  },
  {
    id: 'msg_outbox_005',
    folder: 'outbox',
    fingerprint: 'T4U5V6...K7L8',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'chat',
    title: 'WR Chat Message',
    timestamp: Date.now() - 1000 * 60 * 5, // 5 mins ago
    bodyText: 'Quick message sent via WR Chat direct messaging.',
    attachments: [],
    status: 'sent_chat',
    direction: 'outbound',
    packageId: 'beap_chat_001',
    envelopeRef: 'env_chat_001',
    capsuleRef: 'cap_chat_001',
    deliveryStatus: 'sent_chat',
    deliveryAttempts: [
      { at: Date.now() - 1000 * 60 * 5, status: 'sent_chat' }
    ]
  },
  {
    id: 'msg_outbox_006',
    folder: 'outbox',
    fingerprint: 'W1X2Y3...M4N5',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'messenger',
    title: 'Confirmed Manual Send',
    timestamp: Date.now() - 1000 * 60 * 90, // 90 mins ago
    bodyText: 'This messenger message was confirmed as sent by the user.',
    attachments: [],
    status: 'sent_manual',
    direction: 'outbound',
    packageId: 'beap_manual_001',
    envelopeRef: 'env_manual_001',
    capsuleRef: 'cap_manual_001',
    deliveryStatus: 'sent_manual',
    deliveryAttempts: [
      { at: Date.now() - 1000 * 60 * 90, status: 'pending_user_action' },
      { at: Date.now() - 1000 * 60 * 88, status: 'sent_manual' }
    ]
  },
  
  // ARCHIVED messages
  {
    id: 'msg_archived_001',
    folder: 'archived',
    fingerprint: 'P7Q8R9...H1I2',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Contract Signed - Partnership Agreement',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 7, // 1 week ago
    bodyText: 'The partnership agreement has been successfully signed and executed. This package is now archived for your records.',
    attachments: [
      { name: 'Partnership_Agreement_Signed.pdf', size: 890000 }
    ],
    status: 'archived',
    direction: 'inbound',
    senderName: 'Legal Team',
    hardwareAttestation: 'verified'
  },
  
  // REJECTED messages - with structured rejection reasons
  {
    id: 'msg_rejected_001',
    folder: 'rejected',
    fingerprint: 'S1T2U3...J4K5',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Suspicious Package - Unknown Sender',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 2, // 2 days ago
    bodyText: 'This package was rejected due to verification failure.',
    attachments: [],
    status: 'rejected',
    verificationStatus: 'rejected',
    direction: 'inbound',
    rejectReason: 'Envelope signature verification failed. Sender fingerprint not recognized and no valid handshake exists.',
    rejectionReasonData: {
      code: 'signature_invalid',
      humanSummary: 'Envelope signature verification failed. Sender fingerprint not recognized and no valid handshake exists.',
      details: 'The signature could not be verified against known sender fingerprints. No existing handshake relationship found.',
      timestamp: Date.now() - 1000 * 60 * 60 * 24 * 2,
      failedStep: 'envelope_verification'
    },
    envelopeSummary: {
      envelopeIdShort: 'xyz789ab...',
      senderFingerprintDisplay: 'S1T2U3V4W5X6...',
      channelDisplay: '📧 Email',
      ingressSummary: 'public:○',
      egressSummary: 'web:unknown-site.com',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
      expiryStatus: 'no_expiry',
      signatureStatusDisplay: '✗ Invalid',
      hashVerificationDisplay: '✓ Present'
    }
  },
  {
    id: 'msg_rejected_002',
    folder: 'rejected',
    fingerprint: 'V6W7X8...L9M0',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'download',
    title: 'Policy Violation - Egress Not Allowed',
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 days ago
    bodyText: 'Package rejected due to egress destination not in Protected Sites.',
    attachments: [
      { name: 'report.pdf', size: 524288 }
    ],
    status: 'rejected',
    verificationStatus: 'rejected',
    direction: 'inbound',
    rejectReason: 'Egress destination "external-api.com" is not in Protected Sites allowlist.',
    rejectionReasonData: {
      code: 'egress_not_allowed_by_wrguard',
      humanSummary: 'Egress destination "external-api.com" is not in Protected Sites.',
      details: 'The envelope declares egress to "https://external-api.com/v1" which is not in the WRGuard Protected Sites allowlist. Add it to WRGuard → Protected Sites to allow.',
      timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3,
      failedStep: 'wrguard_intersection'
    },
    envelopeSummary: {
      envelopeIdShort: 'def456gh...',
      senderFingerprintDisplay: 'V6W7X8Y9Z0A1...',
      channelDisplay: '📥 Download',
      ingressSummary: 'handshake:✓',
      egressSummary: 'web:external-api.com',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
      expiryStatus: 'no_expiry',
      signatureStatusDisplay: '✓ Valid',
      hashVerificationDisplay: '✓ Present'
    }
  },
  {
    id: 'msg_rejected_003',
    folder: 'rejected',
    fingerprint: 'Y9Z0A1...N2O3',
    fingerprintFull: mockFingerprint(),
    deliveryMethod: 'email',
    title: 'Provider Not Configured',
    timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    bodyText: 'Package rejected because email provider is not configured.',
    attachments: [],
    status: 'rejected',
    verificationStatus: 'rejected',
    direction: 'inbound',
    rejectReason: 'No email provider is configured in WRGuard.',
    rejectionReasonData: {
      code: 'provider_not_configured',
      humanSummary: 'No email provider is configured in WRGuard.',
      details: 'Message arrived via email channel but no email provider is connected in WRGuard → Email Providers.',
      timestamp: Date.now() - 1000 * 60 * 60 * 24,
      failedStep: 'wrguard_intersection'
    },
    envelopeSummary: {
      envelopeIdShort: 'ghi789jk...',
      senderFingerprintDisplay: 'Y9Z0A1B2C3D4...',
      channelDisplay: '📧 Email',
      ingressSummary: 'handshake:✓',
      egressSummary: 'none:local-only',
      createdAt: Date.now() - 1000 * 60 * 60 * 24,
      expiryStatus: 'no_expiry',
      signatureStatusDisplay: '✓ Valid',
      hashVerificationDisplay: '✓ Present'
    }
  }
]

/**
 * Get messages by folder
 */
export function getSeedMessagesByFolder(folder: BeapMessageUI['folder']): BeapMessageUI[] {
  return SEED_MESSAGES.filter(msg => msg.folder === folder)
}

