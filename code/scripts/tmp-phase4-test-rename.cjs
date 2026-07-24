// One-shot codemod: rename handshake_type record-fixture fields in listed test files.
const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  s = s.replace(/handshake_type: 'internal' as const/g, "same_principal: true as const");
  s = s.replace(/handshake_type: 'internal' as any/g, "same_principal: true as any");
  s = s.replace(/handshake_type: 'internal'/g, "same_principal: true");
  s = s.replace(/handshake_type: 'standard' as any/g, "same_principal: false as any");
  s = s.replace(/handshake_type: 'standard'/g, "same_principal: false");
  s = s.replace(/handshake_type: 'normal'/g, "same_principal: false");
  s = s.replace(/handshake_type: null as any/g, "same_principal: null as any");
  s = s.replace(/handshake_type: null/g, "same_principal: null");
  s = s.replace(/handshake_type\?: string/g, "same_principal?: boolean");
  s = s.replace(/handshake_type_not_internal/g, "record_not_same_principal");
  fs.writeFileSync(f, s);
  console.log((before === s ? 'unchanged' : 'updated '), f);
}
