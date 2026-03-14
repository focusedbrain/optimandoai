# Company Data vs HS Context Profile — Field-by-Field Comparison

**Purpose:** Identify misalignments between the two forms describing the same entity (company/organization) and recommend alignment for clean autofill.

---

## PART A — Full Field Inventory

### 1. Company Data Form — All Fields

**File path:** `apps/extension-chromium/src/vault/vault-ui-typescript.ts` (Add Data dialog)  
**Field definitions:** `apps/extension-chromium/src/vault/types.ts` — `COMPANY_STANDARD_FIELDS`, `PAYMENT_FIELDS`

**Storage:** Vault items with `category: 'company'`. Fields stored as `Field[]` array: `{ key, value, encrypted, type }`.  
**Container:** Company items live in a container (company type); `title` = company name.

#### Section: General / Identity (from COMPANY_STANDARD_FIELDS)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| (title) | Company Name | text | — (container title) |
| ceo_first_name | CEO First Name | text | optional |
| ceo_surname | CEO Surname | text | optional |
| street | Street | text | optional |
| street_number | Number | text | optional |
| postal_code | Postal Code / ZIP | text | optional |
| city | City | text | optional |
| state | State / Province | text | optional |
| country | Country | text | optional |
| email | Company Email | email | optional |
| phone | Phone Number | text | optional |
| website | Website | url | optional |
| vat_number | VAT Number | text | optional |
| tax_id | Tax ID | text | optional |
| additional_info | Additional Info | textarea | optional |

#### Section: Payment Methods (from PAYMENT_FIELDS — identity/company only)

Stored with prefix `payment_` or `payment_2_`, etc. for multiple methods. Types: Bank Account (IBAN), Credit Card, PayPal.

| Key (single method) | Key (multi) | Label | Type | Required |
|---------------------|-------------|-------|------|----------|
| payment_iban | payment_2_iban | IBAN | text | optional |
| payment_bic | payment_2_bic | BIC / SWIFT | text | optional |
| payment_bank_name | payment_2_bank_name | Bank Name | text | optional |
| payment_account_holder | payment_2_account_holder | Account Holder | text | optional |
| payment_cc_number | payment_2_cc_number | Card Number | password | optional |
| payment_cc_holder | payment_2_cc_holder | Cardholder Name | text | optional |
| payment_cc_expiry | payment_2_cc_expiry | Expiry Date | text | optional |
| payment_cc_cvv | payment_2_cc_cvv | CVV / CVC | password | optional |
| payment_paypal_email | payment_2_paypal_email | PayPal Email | email | optional |

#### Section: Custom Fields

User-defined key-value pairs. Stored as `{ key: <user label>, value, encrypted: false, type: 'text' }`.

---

### 2. HS Context Profile Form — All Fields

**File path:** `apps/extension-chromium/src/vault/hsContext/HsContextProfileEditor.tsx`  
**Types:** `apps/extension-chromium/src/vault/hsContextProfilesRpc.ts` — `ProfileFields`, `CustomField`

#### Section: Company / Organization (lines 694–724)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| legalCompanyName | Legal Company Name | text | optional |
| tradeName | Display Name (if distinct) | text | optional |
| address | Address | text | optional |
| country | Country | text | optional |
| (custom_fields section='company') | — | label/value | optional |

#### Section: Links / Online Presence (lines 726–760)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| website | Website | url | optional |
| linkedin | LinkedIn | url | optional |
| twitter | Twitter / X | url | optional |
| facebook | Facebook | url | optional |
| instagram | Instagram | url | optional |
| youtube | YouTube | url | optional |
| officialLink | Official Link | url | optional |
| supportUrl | Support URL | url | optional |
| (custom_fields section='links') | — | label/value | optional |

#### Section: Tax & Identifiers (lines 763–795)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| vatNumber | VAT Number | text | optional |
| companyRegistrationNumber | Company Registration Number | text | optional |
| supplierNumber | Supplier Number | text | optional |
| customerNumber | Customer Number | text | optional |
| (custom_fields section='tax') | — | label/value | optional |

#### Section: Contacts (lines 797–874)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| generalPhone | General Phone | text | optional |
| generalEmail | General Email | email | optional |
| supportEmail | Support Email | email | optional |
| (custom_fields section='contacts') | — | label/value | optional |
| contacts[] | Contact Persons | array | optional |
| — contacts[].name | Name | text | optional |
| — contacts[].role | Role / Department | text | optional |
| — contacts[].email | Email | email | optional |
| — contacts[].phone | Phone | text | optional |
| — contacts[].notes | Availability / Notes | text | optional |

#### Section: Opening Hours (lines 876–922)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| openingHours[] | — | array | optional |
| — openingHours[].days | Days | text | optional |
| — openingHours[].from | From | text | optional |
| — openingHours[].to | To | text | optional |
| timezone | Timezone | text | optional |
| holidayNotes | Holiday Notes | text | optional |
| (custom_fields section='hours') | — | label/value | optional |

#### Section: Billing (lines 924–957)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| billingEmail | Billing Email | email | optional |
| paymentTerms | Payment Terms | text | optional |
| bankDetails | Bank Details (confidential) | text | optional |
| (custom_fields section='billing') | — | label/value | optional |

#### Section: Logistics & Operations (lines 959–993)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| receivingHours | Receiving Hours | text | optional |
| deliveryInstructions | Delivery Instructions | text | optional |
| supportHours | Support Hours | text | optional |
| escalationContact | Escalation Contact | text | optional |
| (custom_fields section='logistics') | — | label/value | optional |

#### Section: Other / Legacy Custom Fields (lines 995–1000+)

| Key | Label | Type | Required |
|-----|-------|------|----------|
| (custom_fields section=undefined) | — | label/value | optional |

---

### 3. HS Context Profile DB Schema

**File path:** `apps/electron-vite-project/electron/main/vault/db.ts` (lines 482–495)  
**Service:** `apps/electron-vite-project/electron/main/vault/hsContextProfileService.ts`  
**Normalize:** `apps/electron-vite-project/electron/main/vault/hsContextNormalize.ts`

**Table:** `hs_context_profiles`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| org_id | TEXT | Organization ID |
| name | TEXT | Profile name |
| description | TEXT | Profile description |
| scope | TEXT | non_confidential | confidential |
| tags | TEXT | JSON array `[]` |
| **fields** | TEXT | **JSON object** — `ProfileFields` |
| **custom_fields** | TEXT | **JSON array** — `CustomField[]` |
| created_at | INTEGER | Timestamp |
| updated_at | INTEGER | Timestamp |
| archived | INTEGER | 0/1 |

**ProfileFields JSON structure (from hsContextProfileService / hsContextNormalize):**

```ts
{
  legalCompanyName?: string
  tradeName?: string
  address?: string
  country?: string
  website?: string
  linkedin?: string
  twitter?: string
  facebook?: string
  instagram?: string
  youtube?: string
  officialLink?: string
  supportUrl?: string
  generalPhone?: string
  generalEmail?: string
  supportEmail?: string
  vatNumber?: string
  companyRegistrationNumber?: string
  supplierNumber?: string
  customerNumber?: string
  contacts?: Array<{ name?, role?, email?, phone?, notes? }>
  openingHours?: Array<{ days, from, to }>
  timezone?: string
  holidayNotes?: string
  billingEmail?: string
  paymentTerms?: string
  bankDetails?: string
  receivingHours?: string
  deliveryInstructions?: string
  supportHours?: string
  escalationContact?: string
}
```

**Schema vs form:** All form fields shown in HsContextProfileEditor are persisted in `fields` or `custom_fields`. No extra schema fields are hidden from the form. No form fields are missing from the schema.

---

## PART B — Side-by-Side Comparison

### 4. Comparison Table

| Category | Company Data field | HS Profile field | Match status | Notes |
|----------|--------------------|------------------|--------------|------|
| **Identity** | (title) | legalCompanyName | EXACT MATCH | Both = company name. Autofill maps title → legalCompanyName. |
| **Identity** | — | tradeName | ONLY IN HS PROFILE | Display name for handshake context. |
| **Address** | street, street_number, postal_code, city, state, country | address | **MISALIGNED** | Company Data: 6 separate fields. HS Profile: single `address` string. Autofill concatenates Company Data → address. |
| **Address** | country | country | EXACT MATCH | Same key, same meaning. |
| **Contact** | email | generalEmail | PARTIAL MATCH | Different keys; same meaning. Company Data: `email`. HS Profile: `generalEmail`. |
| **Contact** | phone | generalPhone | PARTIAL MATCH | Different keys; same meaning. Company Data: `phone`. HS Profile: `generalPhone`. |
| **Contact** | — | supportEmail | ONLY IN HS PROFILE | Support-specific email. |
| **Contact** | ceo_first_name, ceo_surname | contacts[] | **MISALIGNED** | Company Data: 2 CEO fields. HS Profile: contact persons array. CEO could map to first contact. |
| **Links** | website | website | EXACT MATCH | Same key, same meaning. |
| **Links** | — | linkedin, twitter, facebook, instagram, youtube, officialLink, supportUrl | ONLY IN HS PROFILE | Social/official links. |
| **Tax** | vat_number | vatNumber | PARTIAL MATCH | Different key style (snake vs camel). Same meaning. |
| **Tax** | tax_id | companyRegistrationNumber | PARTIAL MATCH | Company Data: generic `tax_id`. HS Profile: `companyRegistrationNumber`. Overlap but not identical. |
| **Tax** | — | supplierNumber, customerNumber | ONLY IN HS PROFILE | B2B identifiers. |
| **Payment** | payment_iban, payment_bic, payment_bank_name, payment_account_holder | bankDetails | **MISALIGNED** | Company Data: structured IBAN, BIC, bank, holder. HS Profile: single `bankDetails` free text. |
| **Payment** | payment_cc_number, payment_cc_holder, payment_cc_expiry, payment_cc_cvv | — | ONLY IN COMPANY DATA | HS Profile has no credit card fields. |
| **Payment** | payment_paypal_email | — | ONLY IN COMPANY DATA | HS Profile has no PayPal field. |
| **Billing** | — | billingEmail | ONLY IN HS PROFILE | Billing contact email. |
| **Billing** | — | paymentTerms | ONLY IN HS PROFILE | Payment terms text. |
| **Operations** | — | openingHours[], timezone, holidayNotes | ONLY IN HS PROFILE | Company Data has no opening hours. |
| **Operations** | — | receivingHours, deliveryInstructions, supportHours, escalationContact | ONLY IN HS PROFILE | Logistics fields. |
| **Notes** | additional_info | (custom_fields) | PARTIAL MATCH | Company Data: single `additional_info`. HS Profile: free-form custom fields. |

---

### 5. Area-by-Area Comparison

#### a. Address fields

| Aspect | Company Data | HS Profile |
|--------|--------------|------------|
| Structure | 6 fields: street, street_number, postal_code, city, state, country | 1 field: address |
| **Better design** | **Company Data** | — |
| **Reason** | Structured fields are better for autofill (match web forms), validation, and i18n. Single address field loses structure. |

**Recommendation:** ALIGN TO COMPANY DATA — refactor HS Profile to use split address fields.

---

#### b. Contact fields

| Aspect | Company Data | HS Profile |
|--------|--------------|------------|
| General | email, phone | generalEmail, generalPhone, supportEmail |
| Persons | ceo_first_name, ceo_surname (flat) | contacts[] (name, role, email, phone, notes) |
| **Better design** | **HS Profile** for persons | — |
| **Reason** | Structured contact persons array is more flexible than single CEO fields. |

**Recommendation:** ALIGN TO HS PROFILE — Company Data could add a contacts array or keep CEO as optional. For autofill: map Company Data `email` → `generalEmail`, `phone` → `generalPhone`. CEO fields could populate first contact if desired.

---

#### c. Tax/Legal fields

| Aspect | Company Data | HS Profile |
|--------|--------------|------------|
| VAT | vat_number | vatNumber |
| Tax/Reg | tax_id | companyRegistrationNumber |
| Extra | — | supplierNumber, customerNumber |
| **Better design** | **HS Profile** (more identifiers) | — |
| **Naming** | snake_case | camelCase |

**Recommendation:** ALIGN BOTH TO NEW — use shared keys: `vatNumber`, `companyRegistrationNumber` (or `taxId`), `supplierNumber`, `customerNumber`. Company Data should add supplierNumber/customerNumber as optional or custom. Autofill mapping: `tax_id` → `companyRegistrationNumber` is correct.

---

#### d. Payment/Billing fields

| Aspect | Company Data | HS Profile |
|--------|--------------|------------|
| Bank | iban, bic, bank_name, account_holder (structured) | bankDetails (single text) |
| Card | cc_number, cc_holder, cc_expiry, cc_cvv | — |
| PayPal | paypal_email | — |
| Billing | — | billingEmail, paymentTerms |
| **Better design** | **Company Data** for payment structure | — |

**Company Data payment fields (exact):**

- IBAN, BIC/SWIFT, Bank Name, Account Holder (bank account)
- Card Number, Cardholder Name, Expiry, CVV (credit card)
- PayPal Email (PayPal)

**HS Profile billing fields (exact):**

- billingEmail, paymentTerms, bankDetails (single confidential text)

**Recommendation:** ALIGN TO COMPANY DATA — refactor HS Profile Billing to use structured payment fields (IBAN, BIC, bank_name, account_holder) instead of a single `bankDetails`. For handshake context, a summarized bank details string may still be needed; that can be derived from stored structured fields.

---

#### e. Opening hours / Operations

| Aspect | Company Data | HS Profile |
|--------|--------------|------------|
| Opening hours | — | openingHours[], timezone, holidayNotes |
| **Better design** | **HS Profile** | — |

**Recommendation:** KEEP SEPARATE — Company Data is a general vault record. Opening hours are handshake-specific. Optionally add to Company Data: `opening_hours` as custom or structured field for future autofill.

---

#### f. Logistics fields

| Aspect | Company Data | HS Profile |
|--------|--------------|------------|
| Logistics | — | receivingHours, deliveryInstructions, supportHours, escalationContact |
| **Better design** | **HS Profile** | — |

**Recommendation:** KEEP SEPARATE — Logistics are handshake-specific. Company Data does not need them unless we want to extend.

---

## PART C — Refactoring Recommendations

### 6. Misaligned Field Pairs — Recommendations

| Pair | Recommendation | Action |
|------|----------------|--------|
| **Address (split vs single)** | ALIGN TO COMPANY DATA | Refactor HS Profile: replace `address` with street, street_number, postal_code, city, state, country. Update `mapCompanyToProfileFields` to direct field copy. |
| **CEO vs contacts** | KEEP SEPARATE | Company Data CEO fields are optional. Autofill can map to first contact if desired. No schema change for now. |
| **Payment (structured vs bankDetails)** | ALIGN TO COMPANY DATA | Refactor HS Profile Billing: add iban, bic, bank_name, account_holder, optionally keep bankDetails as derived/summary. |

### 7. Fields in Only One Form

| Field(s) | Form | Add to other? | Reason |
|----------|------|---------------|--------|
| tradeName | HS Profile | Optional for Company Data | Display name; useful for handshake. |
| supportEmail | HS Profile | Optional for Company Data | Support contact. |
| linkedin, twitter, etc. | HS Profile | Optional for Company Data | Social links; useful for handshake. |
| supplierNumber, customerNumber | HS Profile | Optional for Company Data | B2B identifiers. |
| openingHours, timezone, holidayNotes | HS Profile | No | Handshake-specific. |
| receivingHours, deliveryInstructions, etc. | HS Profile | No | Handshake-specific. |
| ceo_first_name, ceo_surname | Company Data | No (or map to contacts) | Company Data specific; can map to first contact. |
| payment_cc_*, payment_paypal_* | Company Data | Optional for HS Profile | Sensitive; HS Profile may not need full card storage. |
| billingEmail, paymentTerms | HS Profile | Optional for Company Data | Billing context. |

### 8. Payment/Billing Deep Dive

**Company Data payment fields (exact):**

```
Bank Account: IBAN, BIC/SWIFT, Bank Name, Account Holder
Credit Card:  Card Number, Cardholder Name, Expiry, CVV
PayPal:       PayPal Email
```

Stored as: `payment_iban`, `payment_bic`, `payment_bank_name`, `payment_account_holder`, etc. Multiple methods: `payment_2_iban`, etc.

**HS Profile billing fields (exact):**

```
billingEmail     — Billing Email
paymentTerms     — Payment Terms
bankDetails      — Bank Details (confidential) — single free-text field
```

**Recommendation:** HS Profile should adopt the Company Data payment structure:

1. Add to ProfileFields: `iban`, `bic`, `bankName`, `accountHolder` (or reuse payment_* keys).
2. Keep `bankDetails` as optional legacy/notes field, or derive from structured fields for display.
3. Do not add credit card fields to HS Profile (handshake context; too sensitive).
4. Optionally add `billingEmail` and `paymentTerms` to Company Data.

---

### 9. Proposed Shared Field Schema

**Shared schema for overlapping company fields (autofillable with direct copy):**

| Shared key | Company Data key | HS Profile key (current) | Notes |
|------------|-----------------|-------------------------|-------|
| legalCompanyName | title | legalCompanyName | ✓ |
| street | street | — | Add to HS Profile |
| street_number | street_number | — | Add to HS Profile |
| postal_code | postal_code | — | Add to HS Profile |
| city | city | — | Add to HS Profile |
| state | state | — | Add to HS Profile |
| country | country | country | ✓ |
| website | website | website | ✓ |
| email | email | generalEmail | Alias: use `email` |
| phone | phone | generalPhone | Alias: use `phone` |
| vat_number | vat_number | vatNumber | Alias: use `vatNumber` |
| tax_id | tax_id | companyRegistrationNumber | Alias: use `companyRegistrationNumber` |
| iban | payment_iban | — | Add to HS Profile |
| bic | payment_bic | — | Add to HS Profile |
| bank_name | payment_bank_name | — | Add to HS Profile |
| account_holder | payment_account_holder | — | Add to HS Profile |

**Form-specific (not autofillable between forms):**

| Form | Fields |
|------|--------|
| Company Data only | ceo_first_name, ceo_surname, payment_cc_*, payment_paypal_email, additional_info |
| HS Profile only | tradeName, linkedin, twitter, facebook, instagram, youtube, officialLink, supportUrl, supportEmail, supplierNumber, customerNumber, contacts[], openingHours[], timezone, holidayNotes, billingEmail, paymentTerms, receivingHours, deliveryInstructions, supportHours, escalationContact |

---

## Summary: Priority Refactoring Actions

1. **HIGH — Address:** Refactor HS Profile to use split address fields (street, street_number, postal_code, city, state, country). Update `mapCompanyToProfileFields` to direct field copy. Update DB schema and ProfileFields type.
2. **HIGH — Payment:** Refactor HS Profile Billing to add structured bank fields (iban, bic, bank_name, account_holder). Update autofill to map from Company Data payment_*.
3. **MEDIUM — Key naming:** Standardize on camelCase for shared fields in HS Profile; Company Data uses snake_case in vault items — keep mapping in autofill.
4. **LOW — Optional:** Add billingEmail, paymentTerms to Company Data for symmetry. Add optional social links to Company Data if desired.
