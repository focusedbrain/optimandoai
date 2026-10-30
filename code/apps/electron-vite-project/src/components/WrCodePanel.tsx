/**
 * WR Code panel of the mail view (S2b): enter or find a code, check it through
 * the six gates, then accept or decline the offer.
 *
 * Renders only what main returns. The offer is main's EVP-first projection
 * (never text from the message); whether "Find WR Codes" appears at all is
 * main's decision from the message's channel provenance (HC2, W5); manual
 * entry is always available (HC3).
 */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { wrcRpc, wrcRpcErrorCopy, type WrcSubmissionView } from '../lib/wrcRpc'
import './WrCodePanel.css'

type OfferView = Extract<WrcSubmissionView, { kind: 'offer' }>
type RefusalView = Extract<WrcSubmissionView, { kind: 'refusal' }>

type Phase =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'refused'; view: RefusalView }
  | { name: 'offer'; view: OfferView; token: string; busy: boolean }
  | { name: 'accepted'; view: OfferView; consumed: boolean }
  | { name: 'declined' }
  | { name: 'error'; message: string }

interface Candidate {
  canonical: string
  display: string
}

export interface WrCodePanelProps {
  messageId: string
  onClose: () => void
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wrc-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function WrCodePanel({ messageId, onClose }: WrCodePanelProps) {
  const inputId = useId()
  const [raw, setRaw] = useState('')
  const [recognized, setRecognized] = useState<string | null>(null)
  const [scanAllowed, setScanAllowed] = useState<boolean | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [testData, setTestData] = useState(false)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const liveCheck = useRef(0)
  // An offer left open holds a §XVI.8.4 reservation; release it whenever the
  // user moves on (another check, closing the panel, another message).
  const openToken = useRef<string | null>(null)
  useEffect(() => {
    openToken.current = phase.name === 'offer' ? phase.token : null
  }, [phase])
  useEffect(
    () => () => {
      if (openToken.current) void wrcRpc.decline(openToken.current)
    },
    [],
  )

  useEffect(() => {
    setRaw('')
    setRecognized(null)
    setCandidates(null)
    setPhase({ name: 'idle' })
    setScanAllowed(null)
    let alive = true
    void wrcRpc.status().then((r) => {
      if (alive && r.success) setTestData(r.result.testRegistry)
    })
    void wrcRpc.scanMessage(messageId, false).then((r) => {
      if (alive) setScanAllowed(r.success ? r.result.scanAllowed : false)
    })
    return () => {
      alive = false
    }
  }, [messageId])

  // Local syntax check while typing: no network, nothing is looked up.
  useEffect(() => {
    const value = raw.trim()
    const ticket = ++liveCheck.current
    setRecognized(null)
    if (!value) return
    const timer = window.setTimeout(() => {
      void wrcRpc.capture(value).then((r) => {
        if (ticket !== liveCheck.current) return
        setRecognized(r.success && r.result.ok ? r.result.display : null)
      })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [raw])

  const submit = useCallback(async (code: string) => {
    const value = code.trim()
    if (!value) return
    if (openToken.current) {
      void wrcRpc.decline(openToken.current)
      openToken.current = null
    }
    setPhase({ name: 'checking' })
    const r = await wrcRpc.submit(value, newRequestId())
    if (!r.success) {
      setPhase({ name: 'error', message: wrcRpcErrorCopy(r.error) })
      return
    }
    if (r.view.kind === 'offer' && r.acceptanceToken) {
      setPhase({ name: 'offer', view: r.view, token: r.acceptanceToken, busy: false })
    } else if (r.view.kind === 'refusal') {
      setPhase({ name: 'refused', view: r.view })
    } else {
      setPhase({ name: 'error', message: 'Something went wrong. Try again.' })
    }
  }, [])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(raw)
  }

  const scan = async () => {
    const r = await wrcRpc.scanMessage(messageId, true)
    if (!r.success) {
      setPhase({ name: 'error', message: wrcRpcErrorCopy(r.error) })
      return
    }
    setScanAllowed(r.result.scanAllowed)
    setCandidates(r.result.detections.map((d) => ({ canonical: d.canonical, display: d.display })))
  }

  const accept = async () => {
    if (phase.name !== 'offer') return
    setPhase({ ...phase, busy: true })
    const r = await wrcRpc.accept(phase.token)
    if (!r.success) {
      setPhase({ name: 'error', message: wrcRpcErrorCopy(r.error) })
      return
    }
    setPhase({ name: 'accepted', view: phase.view, consumed: r.result.consumed })
  }

  const decline = async () => {
    if (phase.name !== 'offer') return
    setPhase({ ...phase, busy: true })
    await wrcRpc.decline(phase.token)
    setPhase({ name: 'declined' })
  }

  const reset = () => {
    setRaw('')
    setPhase({ name: 'idle' })
  }

  const checking = phase.name === 'checking'

  return (
    <section className="wrc-panel" aria-label="WR Code">
      <header className="wrc-panel__header">
        <h3 className="wrc-panel__title">WR Code</h3>
        {testData ? <span className="wrc-panel__test-badge">Test data</span> : null}
        <button type="button" className="wrc-panel__close" aria-label="Close WR Code panel" onClick={onClose}>
          ×
        </button>
      </header>

      <form className="wrc-panel__form" onSubmit={onSubmit}>
        <label htmlFor={inputId} className="wrc-panel__label">
          Enter a WR Code
        </label>
        <div className="wrc-panel__row">
          <input
            id={inputId}
            className="wrc-panel__input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Type or paste a code"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="wrc-panel__btn wrc-panel__btn--primary" disabled={!raw.trim() || checking}>
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>
        {recognized ? (
          <p className="wrc-panel__hint">
            Valid format: <code className="wrc-panel__code">{recognized}</code>
          </p>
        ) : null}
      </form>

      <div className="wrc-panel__scan">
        {scanAllowed ? (
          <button type="button" className="wrc-panel__btn" onClick={() => void scan()} disabled={checking}>
            Find WR Codes in this message
          </button>
        ) : scanAllowed === false ? (
          <p className="wrc-panel__note">
            This message is not scanned for WR Codes because its sender could not be authenticated. You can still
            type a code.
          </p>
        ) : null}
        {candidates ? (
          candidates.length > 0 ? (
            <ul className="wrc-panel__candidates" aria-label="WR Codes found in this message">
              {candidates.map((c) => (
                <li key={c.canonical}>
                  <button
                    type="button"
                    className="wrc-panel__candidate"
                    onClick={() => {
                      setRaw(c.display)
                      void submit(c.canonical)
                    }}
                    disabled={checking}
                  >
                    {c.display}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wrc-panel__note">No WR Codes found in this message.</p>
          )
        ) : null}
      </div>

      {phase.name === 'checking' ? (
        <p className="wrc-panel__note" role="status">
          Checking the code with its publisher…
        </p>
      ) : null}
      {phase.name === 'error' ? (
        <div className="wrc-refusal wrc-refusal--neutral" role="alert">
          <p className="wrc-refusal__headline">{phase.message}</p>
        </div>
      ) : null}
      {phase.name === 'refused' ? <Refusal view={phase.view} /> : null}
      {phase.name === 'offer' || phase.name === 'accepted' ? (
        <Offer
          view={phase.view}
          busy={phase.name === 'offer' && phase.busy}
          accepted={phase.name === 'accepted' ? { consumed: phase.consumed } : null}
          onAccept={() => void accept()}
          onDecline={() => void decline()}
          onAnother={reset}
        />
      ) : null}
      {phase.name === 'declined' ? (
        <p className="wrc-panel__note" role="status">
          Declined. Nothing was accepted.
        </p>
      ) : null}
    </section>
  )
}

function Refusal({ view }: { view: RefusalView }) {
  return (
    <div className={`wrc-refusal wrc-refusal--${view.tone}`} role={view.tone === 'warning' ? 'alert' : 'status'}>
      <p className="wrc-refusal__headline">
        {view.tone === 'warning' ? (
          <span aria-hidden="true" className="wrc-refusal__icon">
            ⚠
          </span>
        ) : null}
        {view.headline}
      </p>
      {view.details.map((d) => (
        <p key={d} className="wrc-refusal__detail">
          {d}
        </p>
      ))}
      <p className="wrc-refusal__code">
        Gate {view.gate} · {view.reason}
      </p>
    </div>
  )
}

function Offer(props: {
  view: OfferView
  busy: boolean
  accepted: { consumed: boolean } | null
  onAccept: () => void
  onDecline: () => void
  onAnother: () => void
}) {
  const { offer, class_label } = props.view
  return (
    <article className="wrc-offer" aria-label="WR Code offer">
      <p className="wrc-offer__class">{class_label}</p>
      <p className="wrc-offer__statement">{offer.value_statement}</p>
      {offer.self_description ? <p className="wrc-offer__description">{offer.self_description}</p> : null}
      <dl className="wrc-offer__facts">
        {offer.responsible_domain ? (
          <>
            <dt>Responsible</dt>
            <dd className="wrc-offer__responsible">{offer.responsible_domain}</dd>
          </>
        ) : null}
        <dt>Publisher</dt>
        <dd>
          {offer.publisher_part} · {offer.verified_domain}
          {offer.publisher_domain_verified ? <span className="wrc-offer__verified"> ✓ domain verified</span> : null}
        </dd>
        {offer.code_display ? (
          <>
            <dt>Code</dt>
            <dd>
              <code className="wrc-panel__code">{offer.code_display}</code>
            </dd>
          </>
        ) : null}
        {offer.session_bound ? (
          <>
            <dt>Valid</dt>
            <dd>For one session only</dd>
          </>
        ) : null}
      </dl>
      {offer.next_steps.length > 0 ? (
        <>
          <p className="wrc-offer__steps-title">Next steps</p>
          <ul className="wrc-offer__steps">
            {offer.next_steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}
      {props.accepted ? (
        <div className="wrc-offer__done" role="status">
          <p className="wrc-offer__done-text">
            ✓ Accepted.{props.accepted.consumed ? ' This one-time offer is now used up.' : ''}
          </p>
          <button type="button" className="wrc-panel__btn" onClick={props.onAnother}>
            Check another code
          </button>
        </div>
      ) : (
        <div className="wrc-offer__actions">
          <button
            type="button"
            className="wrc-panel__btn wrc-panel__btn--primary"
            onClick={props.onAccept}
            disabled={props.busy}
          >
            Accept
          </button>
          <button type="button" className="wrc-panel__btn" onClick={props.onDecline} disabled={props.busy}>
            Decline
          </button>
        </div>
      )}
    </article>
  )
}
