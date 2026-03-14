// ============================================================================
// WRVault — Canonical Field Taxonomy & DOM Signal Map
// ============================================================================
//
// Location : packages/shared/src/vault/fieldTaxonomy.ts
// Re-exported by: (to be wired)
//   apps/extension-chromium/src/vault/fieldTaxonomy.ts
//   apps/electron-vite-project/electron/main/vault/fieldTaxonomy.ts
//
// ZERO external dependencies — safe to import from any runtime.
//
// This file is the single source of truth for:
//   1. Every field WRVault can store
//   2. Every DOM signal used to match fields for autofill
//   3. Confidence scoring for field detection
//   4. Normalized VaultProfile / FieldEntry schema
//   5. Forward-compatibility extension points
//
// Design invariants:
//   - Default-deny: fields below confidence threshold are never filled
//   - Per-section toggles: every field belongs to exactly one VaultSection
//   - Additive schema: new field kinds extend FIELD_REGISTRY, never mutate
//   - Multi-language: signal keywords include EN + DE baseline, extensible
// ============================================================================

// ---------------------------------------------------------------------------
// §1  Structural Enums & Constants
// ---------------------------------------------------------------------------

/**
 * Top-level vault sections — each maps to a user-facing toggle.
 * New sections are additive (add to the union, add to SECTION_META).
 */
export type VaultSection = 'login' | 'identity' | 'company' | 'custom'

/** Display metadata per section (for settings UI). */
export const SECTION_META: Record<VaultSection, { label: string; icon: string; description: string }> = {
  login:    { label: 'Logins & Passwords', icon: '🔑', description: 'Website and app credentials' },
  identity: { label: 'Identity & Address', icon: '👤', description: 'Personal information, address, phone' },
  company:  { label: 'Company', icon: '🏢', description: 'Organisation details, VAT, tax IDs' },
  custom:   { label: 'Custom Fields',      icon: '📝', description: 'User-defined key/value entries' },
} as const

/**
 * Canonical field kind — every concrete field type WRVault supports.
 *
 * Naming convention:  <section>.<semantic_name>
 * The prefix is informational; the VaultSection is authoritative.
 */
export type FieldKind =
  // ── Login section ──────────────────────────────────────────────
  | 'login.username'
  | 'login.email'
  | 'login.password'
  | 'login.new_password'
  | 'login.otp_seed'          // TOTP/HOTP secret (base32)
  | 'login.otp_code'          // Live 6-digit code (transient, not stored)
  | 'login.recovery_code'     // Backup/recovery codes
  | 'login.url'               // Site URL (for domain matching, not filled)
  // ── Identity section ───────────────────────────────────────────
  | 'identity.first_name'
  | 'identity.last_name'
  | 'identity.full_name'      // Composite — derived from first + last
  | 'identity.email'
  | 'identity.phone'
  | 'identity.birthday'
  | 'identity.birth_day'
  | 'identity.birth_month'
  | 'identity.birth_year'
  | 'identity.street'
  | 'identity.street_number'
  | 'identity.address_line2'
  | 'identity.postal_code'
  | 'identity.city'
  | 'identity.state'
  | 'identity.country'
  | 'identity.tax_id'
  // ── Company section ────────────────────────────────────────────
  | 'company.name'
  | 'company.ceo_first_name'
  | 'company.ceo_last_name'
  | 'company.email'
  | 'company.phone'
  | 'company.vat_number'
  | 'company.tax_id'
  | 'company.hrb'             // Handelsregisternummer (DE-specific)
  | 'company.iban'
  | 'company.street'
  | 'company.street_number'
  | 'company.postal_code'
  | 'company.city'
  | 'company.state'
  | 'company.country'
  | 'company.billing_email'
  // ── Custom section ─────────────────────────────────────────────
  | 'custom.text'
  | 'custom.secret'
  | 'custom.url'
  | 'custom.number'
  | 'custom.textarea'

/** Maps each FieldKind to its owning VaultSection. */
export const FIELD_SECTION: Record<FieldKind, VaultSection> = {
  'login.username':        'login',
  'login.email':           'login',
  'login.password':        'login',
  'login.new_password':    'login',
  'login.otp_seed':        'login',
  'login.otp_code':        'login',
  'login.recovery_code':   'login',
  'login.url':             'login',
  'identity.first_name':   'identity',
  'identity.last_name':    'identity',
  'identity.full_name':    'identity',
  'identity.email':        'identity',
  'identity.phone':        'identity',
  'identity.birthday':     'identity',
  'identity.birth_day':    'identity',
  'identity.birth_month':  'identity',
  'identity.birth_year':   'identity',
  'identity.street':       'identity',
  'identity.street_number':'identity',
  'identity.address_line2':'identity',
  'identity.postal_code':  'identity',
  'identity.city':         'identity',
  'identity.state':        'identity',
  'identity.country':      'identity',
  'identity.tax_id':       'identity',
  'company.name':          'company',
  'company.ceo_first_name':'company',
  'company.ceo_last_name': 'company',
  'company.email':         'company',
  'company.phone':         'company',
  'company.vat_number':    'company',
  'company.tax_id':        'company',
  'company.hrb':           'company',
  'company.iban':          'company',
  'company.street':        'company',
  'company.street_number': 'company',
  'company.postal_code':   'company',
  'company.city':          'company',
  'company.state':         'company',
  'company.country':       'company',
  'company.billing_email': 'company',
  'custom.text':           'custom',
  'custom.secret':         'custom',
  'custom.url':            'custom',
  'custom.number':         'custom',
  'custom.textarea':       'custom',
} as const

// ---------------------------------------------------------------------------
// §2  Legacy Key Mapping (existing DB fields → FieldKind)
// ---------------------------------------------------------------------------

/**
 * Maps existing VaultItem field keys (from types.ts *_STANDARD_FIELDS)
 * to the new FieldKind system.  Used for migration and backwards compat.
 *
 * Format: { [legacyCategory]: { [legacyFieldKey]: FieldKind } }
 */
export const LEGACY_KEY_MAP: Record<string, Record<string, FieldKind>> = {
  password: {
    username:        'login.username',
    password:        'login.password',
    url:             'login.url',
    notes:           'custom.textarea',
    additional_info: 'custom.textarea',
  },
  identity: {
    first_name:      'identity.first_name',
    surname:         'identity.last_name',
    street:          'identity.street',
    street_number:   'identity.street_number',
    postal_code:     'identity.postal_code',
    city:            'identity.city',
    state:           'identity.state',
    country:         'identity.country',
    email:           'identity.email',
    phone:           'identity.phone',
    date_of_birth:   'identity.birthday',
    birth_day:       'identity.birth_day',
    birth_month:     'identity.birth_month',
    birth_year:      'identity.birth_year',
    tax_id:          'identity.tax_id',
    additional_info: 'custom.textarea',
  },
  company: {
    ceo_first_name:  'company.ceo_first_name',
    ceo_surname:     'company.ceo_last_name',
    street:          'company.street',
    street_number:   'company.street_number',
    postal_code:     'company.postal_code',
    city:            'company.city',
    state:           'company.state',
    country:         'company.country',
    email:           'company.email',
    phone:           'company.phone',
    vat_number:      'company.vat_number',
    tax_id:          'company.tax_id',
    company_registration_number: 'company.hrb',
    additional_info: 'custom.textarea',
    // Payment methods — IBAN from bank account(s) for company.iban autofill
    payment_iban:    'company.iban',
    payment_2_iban:  'company.iban',
    payment_3_iban:  'company.iban',
  },
} as const

// ---------------------------------------------------------------------------
// §3  DOM Signal Definitions
// ---------------------------------------------------------------------------

/**
 * A single DOM matching signal with its weight contribution.
 *
 * Weights are additive.  A field is considered matched when the sum of
 * all triggered signal weights meets or exceeds CONFIDENCE_THRESHOLD.
 */
export interface DOMSignal {
  /** What part of the DOM element this signal inspects. */
  source:
    | 'input_type'          // <input type="...">
    | 'autocomplete'        // autocomplete="..." attribute
    | 'name_id'             // name="" or id="" attribute (regex match)
    | 'label_text'          // <label>, aria-label, placeholder, title (keyword match)
    | 'form_context'        // Enclosing <form> action/class heuristic
    | 'field_position'      // Ordinal position relative to other detected fields
    | 'input_mode'          // inputmode="..." attribute
    | 'aria_autocomplete'   // aria-autocomplete="..." attribute

  /** The matching pattern or value. */
  pattern: string

  /**
   * Confidence weight contributed when this signal matches.
   *
   * Scale:
   *   90–100  Authoritative (HTML autocomplete spec attribute)
   *   60–80   Strong (input type + unambiguous name/id)
   *   30–50   Moderate (label keyword match, form context)
   *   10–20   Weak (positional heuristic, ambiguous keyword)
   *
   * Negative weights are allowed for anti-signals (e.g. "search" input
   * should suppress username matching).
   */
  weight: number

  /** If true, this signal alone is sufficient (weight >= threshold). */
  authoritative?: boolean
}

/**
 * Complete signal specification for one FieldKind.
 * Used by the field detector to score input elements.
 */
export interface FieldSignalSpec {
  kind: FieldKind
  section: VaultSection

  /** Whether this field holds sensitive data (masked in UI, encrypted in vault). */
  sensitive: boolean

  /** HTML input type to use when creating vault UI form fields. */
  inputType: 'text' | 'password' | 'email' | 'url' | 'tel' | 'number' | 'date' | 'textarea' | 'select'

  /** Whether this field can be auto-filled into web pages (vs. vault-only). */
  fillable: boolean

  /** All DOM signals for this field kind, evaluated in order. */
  signals: DOMSignal[]

  /** Existing VaultItem field keys that map to this kind (for data retrieval). */
  legacyKeys: string[]
}

// ---------------------------------------------------------------------------
// §4  Confidence Thresholds
// ---------------------------------------------------------------------------

/**
 * Minimum cumulative signal weight to consider a field matched.
 * Below this → default deny (field is not offered for fill).
 */
export const CONFIDENCE_THRESHOLD = 60

/**
 * Minimum weight to surface a "maybe" hint in developer/debug mode
 * (not shown to users, useful for tuning).
 */
export const CONFIDENCE_HINT_THRESHOLD = 30

/**
 * Maximum signals evaluated per input element (performance guard).
 * Evaluation stops after the first authoritative signal match.
 */
export const MAX_SIGNALS_PER_ELEMENT = 50

// ---------------------------------------------------------------------------
// §5  Keyword Banks (multi-language: EN + DE baseline)
// ---------------------------------------------------------------------------

/** Lowercase keyword sets used in label/placeholder/aria-label matching. */
const KW = {
  // ── Login ──
  username:     ['username', 'user name', 'user id', 'userid', 'login', 'benutzername', 'anmeldename', 'nutzername', 'kennung', 'login id', 'sign in', 'anmelden'],
  email:        ['email', 'e-mail', 'mail', 'e-mail-adresse', 'email address', 'emailadresse', 'elektronische post'],
  password:     ['password', 'passwort', 'kennwort', 'pass word', 'secret', 'geheimnis'],
  newPassword:  ['new password', 'neues passwort', 'neues kennwort', 'create password', 'passwort erstellen', 'confirm password', 'passwort bestätigen', 'repeat password', 'passwort wiederholen', 'set password', 'passwort festlegen', 'choose password'],
  otp:          ['otp', 'one-time', 'einmalcode', 'verification code', 'bestätigungscode', 'authenticator', '2fa', 'two-factor', 'zwei-faktor', 'security code', 'sicherheitscode', 'totp', '6-digit', '6-stellig', 'token'],
  recovery:     ['recovery', 'backup code', 'wiederherstellung', 'recovery code', 'backup key', 'sicherungsschlüssel'],

  // ── Identity ──
  firstName:    ['first name', 'given name', 'vorname', 'first', 'fname', 'prenom', 'nombre'],
  lastName:     ['last name', 'surname', 'family name', 'nachname', 'familienname', 'lname', 'nom', 'apellido'],
  fullName:     ['full name', 'name', 'vollständiger name', 'your name', 'ihr name', 'display name', 'anzeigename'],
  phone:        ['phone', 'telephone', 'tel', 'telefon', 'telefonnummer', 'phone number', 'rufnummer', 'handy', 'mobile', 'mobil', 'cell'],
  birthday:     ['birthday', 'birth date', 'date of birth', 'geburtstag', 'geburtsdatum', 'dob', 'born'],
  birthDay:     ['birth day', 'day of birth', 'geburtstag', 'tag', 'day', 'dd'],
  birthMonth:   ['birth month', 'month of birth', 'geburtsmonat', 'monat', 'month', 'mm'],
  birthYear:    ['birth year', 'year of birth', 'geburtsjahr', 'jahr', 'year', 'yyyy'],
  street:       ['street', 'straße', 'strasse', 'address', 'adresse', 'address line 1', 'adresszeile 1', 'street address'],
  streetNumber: ['house number', 'hausnummer', 'street number', 'nr', 'number', 'nummer', 'haus-nr', 'no.', 'bldg'],
  addressLine2: ['address line 2', 'adresszeile 2', 'apt', 'suite', 'unit', 'apartment', 'wohnung', 'zusatz', 'floor', 'etage', 'c/o'],
  postalCode:   ['zip', 'zip code', 'postal code', 'postleitzahl', 'plz', 'postcode', 'post code', 'zipcode'],
  city:         ['city', 'stadt', 'ort', 'town', 'locality', 'wohnort', 'gemeente', 'ciudad', 'ville'],
  state:        ['state', 'province', 'region', 'bundesland', 'land', 'canton', 'staat', 'county', 'prefecture', 'oblast'],
  country:      ['country', 'land', 'nation', 'country/region', 'land/region', 'pays', 'país'],
  taxId:        ['tax id', 'ssn', 'social security', 'steuernummer', 'steuer-id', 'tin', 'tax identification', 'steueridentifikation', 'sozialversicherungsnummer'],

  // ── Company ──
  companyName:  ['company', 'organization', 'organisation', 'firma', 'unternehmen', 'firmenname', 'company name', 'org name', 'business name', 'geschäftsname'],
  vatNumber:    ['vat', 'vat number', 'ust-id', 'ust-idnr', 'umsatzsteuer', 'umsatzsteuer-id', 'value added tax', 'mwst', 'tax vat', 'vat id'],
  hrb:          ['hrb', 'handelsregister', 'commercial register', 'registration number', 'registernummer', 'handelsregisternummer', 'hrb-nummer', 'company registration'],
  iban:         ['iban', 'bank account', 'bankverbindung', 'kontonummer', 'international bank', 'bankkonto'],
  billingEmail: ['billing email', 'rechnungs-email', 'invoice email', 'rechnungsadresse email', 'billing e-mail', 'payment email'],
} as const

// ---------------------------------------------------------------------------
// §6  Name/ID Regex Patterns
// ---------------------------------------------------------------------------

/**
 * Safe regex patterns for matching input name="" and id="" attributes.
 * All patterns are case-insensitive, tested against the full attribute value.
 * Designed to avoid false positives (anchored, specific).
 */
const RX = {
  username:     /(?:^|[_\-.])(user[_\-.]?name|login[_\-.]?id|user[_\-.]?id|uid|username|login)(?:$|[_\-.])/i,
  email:        /(?:^|[_\-.])(e?mail|email[_\-.]?addr(?:ess)?|user[_\-.]?email)(?:$|[_\-.])/i,
  password:     /(?:^|[_\-.])(pass(?:word|wd)?|pw|passwd|kennwort)(?:$|[_\-.])/i,
  newPassword:  /(?:^|[_\-.])(new[_\-.]?pass(?:word|wd)?|confirm[_\-.]?pass(?:word|wd)?|pass(?:word)?[_\-.]?confirm|pass(?:word)?[_\-.]?new|repeat[_\-.]?pass)(?:$|[_\-.])/i,
  otp:          /(?:^|[_\-.])(otp|totp|mfa|tfa|2fa|auth[_\-.]?code|verification[_\-.]?code|security[_\-.]?code|one[_\-.]?time)(?:$|[_\-.])/i,
  recovery:     /(?:^|[_\-.])(recovery|backup[_\-.]?code|recover)(?:$|[_\-.])/i,
  firstName:    /(?:^|[_\-.])(first[_\-.]?name|fname|given[_\-.]?name|vorname)(?:$|[_\-.])/i,
  lastName:     /(?:^|[_\-.])(last[_\-.]?name|lname|surname|family[_\-.]?name|nachname)(?:$|[_\-.])/i,
  fullName:     /(?:^|[_\-.])(full[_\-.]?name|display[_\-.]?name|name)(?:$|[_\-.])/i,
  phone:        /(?:^|[_\-.])(phone|tel(?:ephone)?|mobile|cell|handy|rufnummer)(?:$|[_\-.])/i,
  birthday:     /(?:^|[_\-.])(birth(?:day|date)?|dob|date[_\-.]?of[_\-.]?birth|geburts(?:tag|datum))(?:$|[_\-.])/i,
  birthDay:     /(?:^|[_\-.])(birth[_\-.]?day|day[_\-.]?of[_\-.]?birth|bday|dob[_\-.]?day|dd)(?:$|[_\-.])/i,
  birthMonth:   /(?:^|[_\-.])(birth[_\-.]?month|month[_\-.]?of[_\-.]?birth|bmonth|dob[_\-.]?month|mm)(?:$|[_\-.])/i,
  birthYear:    /(?:^|[_\-.])(birth[_\-.]?year|year[_\-.]?of[_\-.]?birth|byear|dob[_\-.]?year|yyyy)(?:$|[_\-.])/i,
  street:       /(?:^|[_\-.])(street|str(?:asse|aße)?|address[_\-.]?(?:line)?[_\-.]?1?|addr1?)(?:$|[_\-.])/i,
  streetNumber: /(?:^|[_\-.])(house[_\-.]?(?:no|num|number)|street[_\-.]?(?:no|num|number)|haus[_\-.]?nr|bldg|addr[_\-.]?num)(?:$|[_\-.])/i,
  addressLine2: /(?:^|[_\-.])(address[_\-.]?(?:line)?[_\-.]?2|addr2|apt|suite|unit|apartment)(?:$|[_\-.])/i,
  postalCode:   /(?:^|[_\-.])(zip|postal[_\-.]?code|post[_\-.]?code|plz|postleitzahl)(?:$|[_\-.])/i,
  city:         /(?:^|[_\-.])(city|town|locality|ort|stadt|wohnort|gemeente)(?:$|[_\-.])/i,
  state:        /(?:^|[_\-.])(state|province|region|bundesland|county|prefecture)(?:$|[_\-.])/i,
  country:      /(?:^|[_\-.])(country|nation|land|country[_\-.]?code)(?:$|[_\-.])/i,
  taxId:        /(?:^|[_\-.])(tax[_\-.]?id|ssn|tin|steuer[_\-.]?(?:id|nummer)|social[_\-.]?sec)(?:$|[_\-.])/i,
  companyName:  /(?:^|[_\-.])(company|org(?:anization|anisation)?|firma|business[_\-.]?name|unternehmen)(?:$|[_\-.])/i,
  vatNumber:    /(?:^|[_\-.])(vat|ust[_\-.]?id|mwst|umsatzsteuer)(?:$|[_\-.])/i,
  hrb:          /(?:^|[_\-.])(hrb|handelsregister|registration[_\-.]?(?:no|num|number))(?:$|[_\-.])/i,
  iban:         /(?:^|[_\-.])(iban|bank[_\-.]?account|kontonummer)(?:$|[_\-.])/i,
  billingEmail: /(?:^|[_\-.])(billing[_\-.]?e?mail|invoice[_\-.]?e?mail|rechnungs[_\-.]?e?mail)(?:$|[_\-.])/i,
} as const

// ---------------------------------------------------------------------------
// §7  Anti-Signals (negative weight patterns)
// ---------------------------------------------------------------------------

/**
 * Name/ID patterns that suppress field matching.
 * Applied globally — if any anti-signal fires, its negative weight
 * is added to the score.
 */
export const ANTI_SIGNALS: DOMSignal[] = [
  { source: 'name_id',    pattern: '/(?:^|[_\\-.])(search|query|q|filter|keyword|coupon|promo|discount|referral|tracking|captcha|honeypot)(?:$|[_\\-.])/i', weight: -80 },
  { source: 'input_type', pattern: 'hidden',  weight: -100 },
  { source: 'input_type', pattern: 'submit',  weight: -100 },
  { source: 'input_type', pattern: 'button',  weight: -100 },
  { source: 'input_type', pattern: 'reset',   weight: -100 },
  { source: 'input_type', pattern: 'image',   weight: -100 },
  { source: 'input_type', pattern: 'file',    weight: -100 },
  { source: 'input_type', pattern: 'range',   weight: -100 },
  { source: 'input_type', pattern: 'color',   weight: -100 },
  { source: 'input_type', pattern: 'checkbox', weight: -100 },
  { source: 'input_type', pattern: 'radio',   weight: -100 },
  { source: 'label_text', pattern: 'search|suche|filter|coupon|promo|gutschein|rabatt', weight: -60 },
]

// ---------------------------------------------------------------------------
// §8  Form Context Signals
// ---------------------------------------------------------------------------

/**
 * Heuristic patterns to classify the enclosing <form> as login, signup,
 * checkout, or address form.  These boost/suppress specific field kinds.
 */
export type FormContext = 'login' | 'signup' | 'password_change' | 'checkout' | 'address' | 'contact' | 'unknown'

export const FORM_CONTEXT_SIGNALS: Array<{
  context: FormContext
  /** Regex tested against form action URL, form id/class, submit button text. */
  pattern: RegExp
  /** FieldKinds that get a boost when this form context is detected. */
  boosts: FieldKind[]
  /** Weight added to boosted fields. */
  boostWeight: number
}> = [
  {
    context: 'login',
    pattern: /(?:log[_\-.]?in|sign[_\-.]?in|auth|anmeld|einlog)/i,
    boosts: ['login.username', 'login.email', 'login.password', 'login.otp_code'],
    boostWeight: 20,
  },
  {
    context: 'signup',
    pattern: /(?:sign[_\-.]?up|register|regist|anmeld|erstell|create[_\-.]?account|join)/i,
    boosts: ['login.email', 'login.new_password', 'identity.first_name', 'identity.last_name', 'identity.email', 'identity.phone'],
    boostWeight: 20,
  },
  {
    context: 'password_change',
    pattern: /(?:change[_\-.]?pass|update[_\-.]?pass|reset[_\-.]?pass|new[_\-.]?pass|passwort[_\-.]?(?:ändern|aendern)|kennwort[_\-.]?ändern)/i,
    boosts: ['login.new_password', 'login.password'],
    boostWeight: 20,
  },
  {
    context: 'checkout',
    pattern: /(?:checkout|check[_\-.]?out|payment|bezahl|kasse|order|bestellung)/i,
    boosts: ['identity.street', 'identity.street_number', 'identity.postal_code', 'identity.city', 'identity.country', 'identity.phone', 'identity.email', 'company.name', 'company.vat_number'],
    boostWeight: 15,
  },
  {
    context: 'address',
    pattern: /(?:address|shipping|billing|adresse|versand|lieferadresse|rechnungsadresse)/i,
    boosts: ['identity.street', 'identity.street_number', 'identity.address_line2', 'identity.postal_code', 'identity.city', 'identity.state', 'identity.country'],
    boostWeight: 15,
  },
  {
    context: 'contact',
    pattern: /(?:contact|kontakt|profile|profil|account[_\-.]?info|personal)/i,
    boosts: ['identity.first_name', 'identity.last_name', 'identity.email', 'identity.phone'],
    boostWeight: 10,
  },
]

// ---------------------------------------------------------------------------
// §9  The Field Registry — Complete Signal Map
// ---------------------------------------------------------------------------
// This is the authoritative mapping: FieldKind → all its detection signals.
//
// TABLE VIEW (for documentation):
// ┌─────────────────────────┬───────────────────────┬────────┐
// │ FieldKind               │ Signal Source          │ Weight │
// ├─────────────────────────┼───────────────────────┼────────┤
// │ login.username          │ autocomplete=username  │   95   │
// │                         │ input_type=text + ctx  │   40   │
// │                         │ name_id regex          │   65   │
// │                         │ label keywords         │   50   │
// │                         │ form_context=login     │   20   │
// ├─────────────────────────┼───────────────────────┼────────┤
// │ login.email             │ autocomplete=email     │   95   │
// │                         │ input_type=email       │   80   │
// │                         │ name_id regex          │   65   │
// │                         │ label keywords         │   50   │
// │ ... (see FIELD_REGISTRY for full table)         │        │
// └─────────────────────────┴───────────────────────┴────────┘
// ---------------------------------------------------------------------------

export const FIELD_REGISTRY: readonly FieldSignalSpec[] = [

  // ═══════════════════════════════════════════════════════════════
  // LOGIN SECTION
  // ═══════════════════════════════════════════════════════════════

  {
    kind: 'login.username',
    section: 'login',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['username'],
    signals: [
      { source: 'autocomplete', pattern: 'username',                    weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.username.source,            weight: 65 },
      { source: 'label_text',   pattern: KW.username.join('|'),         weight: 50 },
      { source: 'input_type',   pattern: 'text',                        weight: 10 },
      { source: 'form_context', pattern: 'login',                       weight: 20 },
    ],
  },

  {
    kind: 'login.email',
    section: 'login',
    sensitive: false,
    inputType: 'email',
    fillable: true,
    legacyKeys: ['username'], // Many sites use email as username
    signals: [
      { source: 'autocomplete', pattern: 'email',                       weight: 95, authoritative: true },
      { source: 'input_type',   pattern: 'email',                       weight: 80 },
      { source: 'name_id',      pattern: RX.email.source,               weight: 65 },
      { source: 'label_text',   pattern: KW.email.join('|'),            weight: 50 },
      { source: 'form_context', pattern: 'login',                       weight: 15 },
    ],
  },

  {
    kind: 'login.password',
    section: 'login',
    sensitive: true,
    inputType: 'password',
    fillable: true,
    legacyKeys: ['password'],
    signals: [
      { source: 'autocomplete', pattern: 'current-password',            weight: 95, authoritative: true },
      { source: 'input_type',   pattern: 'password',                    weight: 80 },
      { source: 'name_id',      pattern: RX.password.source,            weight: 65 },
      { source: 'label_text',   pattern: KW.password.join('|'),         weight: 50 },
      { source: 'form_context', pattern: 'login',                       weight: 20 },
    ],
  },

  {
    kind: 'login.new_password',
    section: 'login',
    sensitive: true,
    inputType: 'password',
    fillable: true,
    legacyKeys: ['password'],
    signals: [
      { source: 'autocomplete', pattern: 'new-password',                weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.newPassword.source,         weight: 70 },
      { source: 'label_text',   pattern: KW.newPassword.join('|'),      weight: 55 },
      { source: 'input_type',   pattern: 'password',                    weight: 30 },
      { source: 'form_context', pattern: 'signup',                      weight: 25 },
    ],
  },

  {
    kind: 'login.otp_seed',
    section: 'login',
    sensitive: true,
    inputType: 'text',
    fillable: false, // OTP seeds are vault-only; live codes are filled
    legacyKeys: [],
    signals: [], // Not detectable from DOM — manually stored in vault
  },

  {
    kind: 'login.otp_code',
    section: 'login',
    sensitive: true,
    inputType: 'text',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'autocomplete', pattern: 'one-time-code',               weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.otp.source,                 weight: 70 },
      { source: 'label_text',   pattern: KW.otp.join('|'),              weight: 55 },
      { source: 'input_mode',   pattern: 'numeric',                     weight: 15 },
      { source: 'input_type',   pattern: 'tel',                         weight: 10 },
    ],
  },

  {
    kind: 'login.recovery_code',
    section: 'login',
    sensitive: true,
    inputType: 'text',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'name_id',      pattern: RX.recovery.source,            weight: 70 },
      { source: 'label_text',   pattern: KW.recovery.join('|'),         weight: 55 },
    ],
  },

  {
    kind: 'login.url',
    section: 'login',
    sensitive: false,
    inputType: 'url',
    fillable: false, // Domain reference, not filled into web forms
    legacyKeys: ['url'],
    signals: [], // Not detectable from DOM — stored as item metadata
  },

  // ═══════════════════════════════════════════════════════════════
  // IDENTITY SECTION
  // ═══════════════════════════════════════════════════════════════

  {
    kind: 'identity.first_name',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['first_name'],
    signals: [
      { source: 'autocomplete', pattern: 'given-name',                  weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.firstName.source,           weight: 65 },
      { source: 'label_text',   pattern: KW.firstName.join('|'),        weight: 50 },
      { source: 'form_context', pattern: 'signup',                      weight: 10 },
      { source: 'form_context', pattern: 'contact',                     weight: 10 },
    ],
  },

  {
    kind: 'identity.last_name',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['surname'],
    signals: [
      { source: 'autocomplete', pattern: 'family-name',                 weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.lastName.source,            weight: 65 },
      { source: 'label_text',   pattern: KW.lastName.join('|'),         weight: 50 },
      { source: 'form_context', pattern: 'signup',                      weight: 10 },
    ],
  },

  {
    kind: 'identity.full_name',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['first_name', 'surname'], // Composed from first + last
    signals: [
      { source: 'autocomplete', pattern: 'name',                        weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.fullName.source,            weight: 55 },
      { source: 'label_text',   pattern: KW.fullName.join('|'),         weight: 45 },
    ],
  },

  {
    kind: 'identity.email',
    section: 'identity',
    sensitive: false,
    inputType: 'email',
    fillable: true,
    legacyKeys: ['email'],
    signals: [
      { source: 'autocomplete', pattern: 'email',                       weight: 95, authoritative: true },
      { source: 'input_type',   pattern: 'email',                       weight: 80 },
      { source: 'name_id',      pattern: RX.email.source,               weight: 65 },
      { source: 'label_text',   pattern: KW.email.join('|'),            weight: 50 },
      { source: 'form_context', pattern: 'contact',                     weight: 15 },
      { source: 'form_context', pattern: 'signup',                      weight: 12 },
      { source: 'form_context', pattern: 'checkout',                    weight: 12 },
      { source: 'form_context', pattern: 'address',                     weight: 10 },
    ],
  },

  {
    kind: 'identity.phone',
    section: 'identity',
    sensitive: false,
    inputType: 'tel',
    fillable: true,
    legacyKeys: ['phone'],
    signals: [
      { source: 'autocomplete', pattern: 'tel',                         weight: 95, authoritative: true },
      { source: 'autocomplete', pattern: 'tel-national',                weight: 95, authoritative: true },
      { source: 'input_type',   pattern: 'tel',                         weight: 80 },
      { source: 'name_id',      pattern: RX.phone.source,               weight: 65 },
      { source: 'label_text',   pattern: KW.phone.join('|'),            weight: 50 },
      { source: 'input_mode',   pattern: 'tel',                         weight: 15 },
    ],
  },

  {
    kind: 'identity.birthday',
    section: 'identity',
    sensitive: false,
    inputType: 'date',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'autocomplete', pattern: 'bday',                        weight: 95, authoritative: true },
      { source: 'input_type',   pattern: 'date',                        weight: 30 },
      { source: 'name_id',      pattern: RX.birthday.source,            weight: 65 },
      { source: 'label_text',   pattern: KW.birthday.join('|'),         weight: 50 },
    ],
  },

  {
    kind: 'identity.birth_day',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['birth_day'],
    signals: [
      { source: 'autocomplete', pattern: 'bday-day',                    weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.birthDay.source,            weight: 65 },
      { source: 'label_text',   pattern: KW.birthDay.join('|'),         weight: 45 },
      { source: 'form_context', pattern: 'contact',                     weight: 10 },
      { source: 'form_context', pattern: 'signup',                      weight: 10 },
    ],
  },

  {
    kind: 'identity.birth_month',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['birth_month'],
    signals: [
      { source: 'autocomplete', pattern: 'bday-month',                  weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.birthMonth.source,          weight: 65 },
      { source: 'label_text',   pattern: KW.birthMonth.join('|'),       weight: 45 },
      { source: 'form_context', pattern: 'contact',                     weight: 10 },
      { source: 'form_context', pattern: 'signup',                      weight: 10 },
    ],
  },

  {
    kind: 'identity.birth_year',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['birth_year'],
    signals: [
      { source: 'autocomplete', pattern: 'bday-year',                   weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.birthYear.source,           weight: 65 },
      { source: 'label_text',   pattern: KW.birthYear.join('|'),        weight: 45 },
      { source: 'form_context', pattern: 'contact',                     weight: 10 },
      { source: 'form_context', pattern: 'signup',                      weight: 10 },
    ],
  },

  {
    kind: 'identity.street',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['street'],
    signals: [
      { source: 'autocomplete', pattern: 'address-line1',               weight: 95, authoritative: true },
      { source: 'autocomplete', pattern: 'street-address',              weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.street.source,              weight: 65 },
      { source: 'label_text',   pattern: KW.street.join('|'),           weight: 50 },
      { source: 'form_context', pattern: 'address',                     weight: 15 },
      { source: 'form_context', pattern: 'checkout',                    weight: 15 },
    ],
  },

  {
    kind: 'identity.street_number',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['street_number'],
    signals: [
      { source: 'name_id',      pattern: RX.streetNumber.source,        weight: 65 },
      { source: 'label_text',   pattern: KW.streetNumber.join('|'),     weight: 50 },
      { source: 'form_context', pattern: 'address',                     weight: 15 },
      // No standard autocomplete attribute — German/EU forms often split this
    ],
  },

  {
    kind: 'identity.address_line2',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'autocomplete', pattern: 'address-line2',               weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.addressLine2.source,        weight: 65 },
      { source: 'label_text',   pattern: KW.addressLine2.join('|'),     weight: 50 },
      { source: 'form_context', pattern: 'address',                     weight: 10 },
    ],
  },

  {
    kind: 'identity.postal_code',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['postal_code'],
    signals: [
      { source: 'autocomplete', pattern: 'postal-code',                 weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.postalCode.source,          weight: 65 },
      { source: 'label_text',   pattern: KW.postalCode.join('|'),       weight: 50 },
      { source: 'form_context', pattern: 'address',                     weight: 15 },
    ],
  },

  {
    kind: 'identity.city',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['city'],
    signals: [
      { source: 'autocomplete', pattern: 'address-level2',              weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.city.source,                weight: 65 },
      { source: 'label_text',   pattern: KW.city.join('|'),             weight: 50 },
      { source: 'form_context', pattern: 'address',                     weight: 15 },
    ],
  },

  {
    kind: 'identity.state',
    section: 'identity',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['state'],
    signals: [
      { source: 'autocomplete', pattern: 'address-level1',              weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.state.source,               weight: 65 },
      { source: 'label_text',   pattern: KW.state.join('|'),            weight: 45 },
      { source: 'form_context', pattern: 'address',                     weight: 10 },
    ],
  },

  {
    kind: 'identity.country',
    section: 'identity',
    sensitive: false,
    inputType: 'select',
    fillable: true,
    legacyKeys: ['country'],
    signals: [
      { source: 'autocomplete', pattern: 'country',                     weight: 95, authoritative: true },
      { source: 'autocomplete', pattern: 'country-name',                weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.country.source,             weight: 65 },
      { source: 'label_text',   pattern: KW.country.join('|'),          weight: 50 },
      { source: 'form_context', pattern: 'address',                     weight: 10 },
    ],
  },

  {
    kind: 'identity.tax_id',
    section: 'identity',
    sensitive: true,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['tax_id'],
    signals: [
      { source: 'name_id',      pattern: RX.taxId.source,               weight: 70 },
      { source: 'label_text',   pattern: KW.taxId.join('|'),            weight: 55 },
      // No standard autocomplete — filled only with high confidence
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPANY SECTION
  // ═══════════════════════════════════════════════════════════════

  {
    kind: 'company.name',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'autocomplete', pattern: 'organization',                weight: 95, authoritative: true },
      { source: 'name_id',      pattern: RX.companyName.source,         weight: 65 },
      { source: 'label_text',   pattern: KW.companyName.join('|'),      weight: 50 },
      { source: 'form_context', pattern: 'checkout',                    weight: 10 },
    ],
  },

  {
    kind: 'company.ceo_first_name',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: false, // Rarely appears in web forms; vault-only
    legacyKeys: ['ceo_first_name'],
    signals: [],
  },

  {
    kind: 'company.ceo_last_name',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: false,
    legacyKeys: ['ceo_surname'],
    signals: [],
  },

  {
    kind: 'company.email',
    section: 'company',
    sensitive: false,
    inputType: 'email',
    fillable: true,
    legacyKeys: ['email'],
    signals: [
      { source: 'autocomplete', pattern: 'email',                       weight: 40 },
      { source: 'input_type',   pattern: 'email',                       weight: 30 },
      { source: 'form_context', pattern: 'checkout',                    weight: 15 },
      // Low weight alone — needs company form context to disambiguate from identity.email
    ],
  },

  {
    kind: 'company.phone',
    section: 'company',
    sensitive: false,
    inputType: 'tel',
    fillable: true,
    legacyKeys: ['phone'],
    signals: [
      { source: 'autocomplete', pattern: 'tel',                         weight: 40 },
      { source: 'input_type',   pattern: 'tel',                         weight: 30 },
      // Low weight alone — needs company form context to disambiguate from identity.phone
    ],
  },

  {
    kind: 'company.vat_number',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['vat_number'],
    signals: [
      { source: 'name_id',      pattern: RX.vatNumber.source,           weight: 75 },
      { source: 'label_text',   pattern: KW.vatNumber.join('|'),        weight: 60 },
    ],
  },

  {
    kind: 'company.tax_id',
    section: 'company',
    sensitive: true,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['tax_id'],
    signals: [
      { source: 'name_id',      pattern: RX.taxId.source,               weight: 65 },
      { source: 'label_text',   pattern: KW.taxId.join('|'),            weight: 50 },
      // Disambiguated from identity.tax_id by presence of company.name in same form
    ],
  },

  {
    kind: 'company.hrb',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'name_id',      pattern: RX.hrb.source,                 weight: 75 },
      { source: 'label_text',   pattern: KW.hrb.join('|'),              weight: 60 },
    ],
  },

  {
    kind: 'company.iban',
    section: 'company',
    sensitive: true,
    inputType: 'text',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'name_id',      pattern: RX.iban.source,                weight: 80 },
      { source: 'label_text',   pattern: KW.iban.join('|'),             weight: 65 },
    ],
  },

  // Company address fields — same signals as identity but lower base weight.
  // Disambiguation: if company.name is detected in the same form, address
  // fields are promoted to company.* instead of identity.*.
  {
    kind: 'company.street',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['street'],
    signals: [
      { source: 'autocomplete', pattern: 'address-line1',               weight: 40 },
      { source: 'name_id',      pattern: RX.street.source,              weight: 35 },
      { source: 'label_text',   pattern: KW.street.join('|'),           weight: 30 },
      // Requires company.name in same form for promotion above threshold
    ],
  },

  {
    kind: 'company.street_number',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['street_number'],
    signals: [
      { source: 'name_id',      pattern: RX.streetNumber.source,        weight: 35 },
      { source: 'label_text',   pattern: KW.streetNumber.join('|'),     weight: 30 },
    ],
  },

  {
    kind: 'company.postal_code',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['postal_code'],
    signals: [
      { source: 'autocomplete', pattern: 'postal-code',                 weight: 40 },
      { source: 'name_id',      pattern: RX.postalCode.source,          weight: 35 },
      { source: 'label_text',   pattern: KW.postalCode.join('|'),       weight: 30 },
    ],
  },

  {
    kind: 'company.city',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['city'],
    signals: [
      { source: 'autocomplete', pattern: 'address-level2',              weight: 40 },
      { source: 'name_id',      pattern: RX.city.source,                weight: 35 },
      { source: 'label_text',   pattern: KW.city.join('|'),             weight: 30 },
    ],
  },

  {
    kind: 'company.state',
    section: 'company',
    sensitive: false,
    inputType: 'text',
    fillable: true,
    legacyKeys: ['state'],
    signals: [
      { source: 'autocomplete', pattern: 'address-level1',              weight: 40 },
      { source: 'name_id',      pattern: RX.state.source,               weight: 35 },
      { source: 'label_text',   pattern: KW.state.join('|'),            weight: 30 },
    ],
  },

  {
    kind: 'company.country',
    section: 'company',
    sensitive: false,
    inputType: 'select',
    fillable: true,
    legacyKeys: ['country'],
    signals: [
      { source: 'autocomplete', pattern: 'country',                     weight: 40 },
      { source: 'name_id',      pattern: RX.country.source,             weight: 35 },
      { source: 'label_text',   pattern: KW.country.join('|'),          weight: 30 },
    ],
  },

  {
    kind: 'company.billing_email',
    section: 'company',
    sensitive: false,
    inputType: 'email',
    fillable: true,
    legacyKeys: [],
    signals: [
      { source: 'name_id',      pattern: RX.billingEmail.source,        weight: 75 },
      { source: 'label_text',   pattern: KW.billingEmail.join('|'),     weight: 60 },
      { source: 'input_type',   pattern: 'email',                       weight: 15 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // CUSTOM SECTION — catch-all for user-defined fields
  // ═══════════════════════════════════════════════════════════════
  // Custom fields have NO DOM signals — they are only filled
  // via explicit user selection from the quick-insert dropdown.

  {
    kind: 'custom.text',
    section: 'custom',
    sensitive: false,
    inputType: 'text',
    fillable: true, // via explicit selection only
    legacyKeys: [],
    signals: [],
  },
  {
    kind: 'custom.secret',
    section: 'custom',
    sensitive: true,
    inputType: 'password',
    fillable: true,
    legacyKeys: [],
    signals: [],
  },
  {
    kind: 'custom.url',
    section: 'custom',
    sensitive: false,
    inputType: 'url',
    fillable: true,
    legacyKeys: [],
    signals: [],
  },
  {
    kind: 'custom.number',
    section: 'custom',
    sensitive: false,
    inputType: 'number',
    fillable: true,
    legacyKeys: [],
    signals: [],
  },
  {
    kind: 'custom.textarea',
    section: 'custom',
    sensitive: false,
    inputType: 'textarea',
    fillable: true,
    legacyKeys: ['notes', 'additional_info'],
    signals: [],
  },

] as const

// ---------------------------------------------------------------------------
// §10  Lookup Helpers
// ---------------------------------------------------------------------------

/** Index: FieldKind → FieldSignalSpec for O(1) lookup. */
export const FIELD_BY_KIND: ReadonlyMap<FieldKind, FieldSignalSpec> = new Map(
  FIELD_REGISTRY.map(f => [f.kind, f]),
)

/** All fillable fields (subset used by the autofill detector). */
export const FILLABLE_FIELDS: readonly FieldSignalSpec[] =
  FIELD_REGISTRY.filter(f => f.fillable && f.signals.length > 0)

/** Fields grouped by section (for toggle-aware iteration). */
export const FIELDS_BY_SECTION: ReadonlyMap<VaultSection, readonly FieldSignalSpec[]> = (() => {
  const map = new Map<VaultSection, FieldSignalSpec[]>()
  for (const f of FIELD_REGISTRY) {
    const arr = map.get(f.section) ?? []
    arr.push(f)
    map.set(f.section, arr)
  }
  return map
})()

// ---------------------------------------------------------------------------
// §11  Normalized VaultProfile & FieldEntry Schema
// ---------------------------------------------------------------------------

/**
 * A single field entry in the normalized vault profile.
 *
 * Unlike the existing `Field` interface (which uses a flat key/value),
 * FieldEntry carries the canonical FieldKind for type-safe matching.
 */
export interface FieldEntry {
  /** Canonical field identifier from the taxonomy. */
  kind: FieldKind

  /** Human-readable label (from FIELD_REGISTRY or user-supplied for custom). */
  label: string

  /** The stored value.  Always a string (numbers serialized). */
  value: string

  /** Whether this field is sensitive (masks in UI, encrypted at rest). */
  sensitive: boolean

  /**
   * For custom fields: optional user-supplied tag for hinting.
   * For standard fields: undefined (kind is sufficient).
   */
  tag?: string
}

/**
 * Normalized vault profile — the flat, typed representation of a VaultItem
 * suitable for autofill matching.
 *
 * One VaultItem may produce multiple VaultProfiles (e.g., a password item
 * produces a login profile; an identity item produces an identity profile).
 */
export interface VaultProfile {
  /** Source VaultItem ID. */
  itemId: string

  /** Source VaultItem title (for display in dropdown). */
  title: string

  /** Which section this profile serves. */
  section: VaultSection

  /** The domain this profile is associated with (for login profiles). */
  domain?: string

  /** Ordered list of fields available for filling. */
  fields: FieldEntry[]

  /** Last modified timestamp (for recency sorting). */
  updatedAt: number
}

/**
 * User preferences for which sections are enabled for autofill.
 * Stored in vault settings (or extension local storage for pre-unlock).
 */
export interface AutofillSectionToggles {
  login: boolean
  identity: boolean
  company: boolean
  custom: boolean
}

/** Default toggles — ALL sections enabled (default ON per security policy). */
export const DEFAULT_SECTION_TOGGLES: AutofillSectionToggles = {
  login: true,
  identity: true,
  company: true,
  custom: true,
} as const

// ---------------------------------------------------------------------------
// §12  Detection Result Types (used by the field detector)
// ---------------------------------------------------------------------------

/**
 * Result of scoring a single DOM input element against the field registry.
 */
export interface FieldDetectionResult {
  /** The input element that was scored. */
  element: unknown // HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement (DOM type)

  /** Best-matching FieldKind, or null if below threshold. */
  matchedKind: FieldKind | null

  /** Cumulative confidence score (0–200+). */
  confidence: number

  /** All signals that fired (for debugging / tuning). */
  firedSignals: Array<{
    signal: DOMSignal
    matched: boolean
    contribution: number
  }>

  /** Detected form context (if any). */
  formContext: FormContext
}

/**
 * Result of scanning an entire page/form for fillable fields.
 */
export interface PageScanResult {
  /** All detected fields above CONFIDENCE_THRESHOLD. */
  detectedFields: FieldDetectionResult[]

  /** The inferred form context. */
  formContext: FormContext

  /** The page domain (for vault candidate lookup). */
  domain: string

  /** Timestamp of the scan. */
  scannedAt: number
}

// ---------------------------------------------------------------------------
// §13  Forward Compatibility Contract
// ---------------------------------------------------------------------------
//
// Adding a new field type:
//
//   1. Add to the FieldKind union type
//   2. Add to FIELD_SECTION mapping
//   3. Add a FieldSignalSpec entry to FIELD_REGISTRY
//   4. (Optional) Add to LEGACY_KEY_MAP if migrating existing data
//   5. (Optional) Add keyword bank entries to KW / regex to RX
//
// Invariants that MUST be preserved:
//
//   - FIELD_REGISTRY is append-only; never remove or rename entries
//   - FieldKind strings are stable identifiers; never change them
//   - CONFIDENCE_THRESHOLD may be tuned but never below 40
//   - New VaultSections can be added to the union + SECTION_META
//   - Signal weights are tunable; authoritative signals must be >= 90
//   - ANTI_SIGNALS are global; new entries are append-only
//   - The VaultProfile interface is additive (new optional fields only)
//   - Custom fields have empty signals arrays (never auto-detected)
//
// Schema versioning:
//
//   - Current schema version: 1
//   - On breaking changes, increment version and add migration in
//     the vault service's opportunistic migration path (like v1→v2
//     envelope migration).
//
export const FIELD_TAXONOMY_VERSION = 1
