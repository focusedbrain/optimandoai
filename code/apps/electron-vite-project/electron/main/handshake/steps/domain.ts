import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifySenderDomain: PipelineStep = {
  name: 'verify_sender_domain',
  execute(ctx) {
    const { receiverPolicy, input } = ctx
    const allowed = receiverPolicy.allowedSenderDomains

    if (allowed === null) {
      return { passed: true }
    }

    const senderEmail = input.senderIdentity.email
    const atIndex = senderEmail.lastIndexOf('@')
    if (atIndex < 0) {
      return { passed: false, reason: ReasonCode.SENDER_DOMAIN_DENIED }
    }

    const domain = senderEmail.slice(atIndex + 1).toLowerCase()
    const normalised = allowed.map(d => d.toLowerCase())

    if (!normalised.includes(domain)) {
      return { passed: false, reason: ReasonCode.SENDER_DOMAIN_DENIED }
    }

    return { passed: true }
  },
}
