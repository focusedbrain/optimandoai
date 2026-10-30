# WR Code® Reference Grammar — Registry Material v2.0 (grammar version 2)

Derived from **Annex XVI v1.95** (`docs/spec/Annex_XVI_WR_Code_v1.95.pdf`,
SHA256 `064AAD6D8F28A0B1B7688C516CA3C4D8BA486BF723A5483D8C119D44F875829F`),
§XVI.5.1–§XVI.5.4 and §XVI.5.8. This file is the transcription target for the
grammar registry implemented in `packages/ingestion-core/src/wrCodeGrammar.ts`;
`wrCodeGrammar.registryTranscription.guard.test.ts` fails if the two diverge.
Edit this material first — never patch the module tables directly.

The check **arithmetic** (Damm over GF(2⁵), reduction polynomial 0x25) is a
separate transcription with its own guard: `wrCode.ts` ⇄
`WR-Code_Check-Profile_Registry-Material_v1.4.md` §5, ratified upstream in
Annex XVI Appendix A. This file carries the **grammar**, not the arithmetic.

## §1 Prefix Grammar Registry (§XVI.5.2)

The prefix is a variable-length sequence, parsed before payload aliasing.
Unlisted first symbols, and S followed by an unlisted symbol, are INVALID.

```prefix-registry
P  | TERMINAL
I  | TERMINAL
C  | TERMINAL
S  | NON_TERMINAL
SP | TERMINAL
SI | TERMINAL
SC | TERMINAL
SE | TERMINAL
```

## §2 Class Value Table (§XVI.5.4)

Each entry coincides with the Crockford input-mapping value of the class
symbol (Appendix A.3), so class symbols need no second alphabet.

```class-values
P | 22
I | 1
C | 12
S | 25
E | 14
```

## §3 Class Form Table (§XVI.5.1, §XVI.5.8)

`class | class values | address fields (role:length …) | check placement | canonical form`

The check input is `[class values] ‖ [normalized address-body values]`,
excluding separators and the check symbol itself. Body symbols take the
Crockford payload aliases (I/i/L/l → 1, O/o → 0) **after** the prefix is
consumed; the fixed per-class length makes completeness a grammar property.

```class-forms
P  | 22     | publisher:6 local:5        | attached | P-PPPPPP-LLLLLX
I  | 1      | publisher:6 combination:6  | separate | I-IIIIII-BBBBBB-X
C  | 12     | publisher:6 counterparty:6 | separate | C-IIIIII-RRRRRR-X
SP | 25 22  | publisher:6 combination:6  | separate | SP-PPPPPP-BBBBBB-X
SI | 25 1   | publisher:6 combination:6  | separate | SI-PPPPPP-BBBBBB-X
SC | 25 12  | publisher:6 combination:6  | separate | SC-PPPPPP-BBBBBB-X
SE | 25 14  | publisher:6 combination:6  | separate | SE-PPPPPP-BBBBBB-X
```

Notes, normative in the annex:

- Presentation separators are not identifier material; every grouping and the
  ungrouped form MUST be accepted on input (§XVI.5.1).
- The old prefix-less 12-symbol Baseline Code (check profile v1.2/v1.4) is not
  a reference of grammar version 2 and MUST be rejected (`unknown_prefix`, or
  `wrong_length` where its first symbol collides with a class symbol).
- A valid check indicates capture consistency only — never authentication,
  authorization, or resolution (§XVI.5.4).
