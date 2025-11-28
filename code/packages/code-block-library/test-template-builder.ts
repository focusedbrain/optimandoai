/**
 * Quick test for TemplateBuilder
 * Run with: node --loader ts-node/esm test-template-builder.ts
 */

import { buildFromTemplate, validateTemplate, analyzeTemplate } from './src/index';

const testTemplate = `
\`\`\`yaml
GLASSVIEW_APP:
  name: "Test App"
  version: "1.0.0"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Test App"
      initialState:
        message: "Hello from Template!"
        count: 0
        isActive: false
  
  layout:
    - component: "container"
      props:
        title: "Template Builder Test"
        padding: "20px"
      children:
        - component: "status-indicator"
          condition: "!state.isActive"
          props:
            message: "System inactive"
            color: "red"
        
        - component: "status-indicator"
          condition: "state.isActive"
          props:
            message: "System active: {state.message}"
            color: "green"
        
        - component: "button"
          props:
            label: "Activate"
            action: "ACTIVATE"
        
        - component: "button"
          props:
            label: "Increment Count"
            action: "INCREMENT"
  
  actions:
    ACTIVATE:
      type: "STATE_UPDATE"
      updates:
        isActive: true
    
    INCREMENT:
      type: "STATE_UPDATE"
      updates:
        count: "{state.count + 1}"
\`\`\`
`;

console.log('='.repeat(60));
console.log('TEMPLATE BUILDER TEST');
console.log('='.repeat(60));

// Test 1: Validate
console.log('\n1. VALIDATING TEMPLATE...');
const validation = validateTemplate(testTemplate);
console.log('   Valid:', validation.valid);
if (validation.errors.length > 0) {
  console.log('   Errors:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.log('   Warnings:', validation.warnings);
}

// Test 2: Analyze
console.log('\n2. ANALYZING TEMPLATE...');
const analysis = analyzeTemplate(testTemplate);
console.log('   Name:', analysis.name);
console.log('   Version:', analysis.version);
console.log('   Blocks Used:', analysis.blocksUsed.join(', '));
console.log('   Component Count:', analysis.componentCount);
console.log('   Action Count:', analysis.actionCount);

// Test 3: Build
console.log('\n3. BUILDING TEMPLATE...');
const result = buildFromTemplate(testTemplate);
console.log('   Build Success:', result.metadata.errors.length === 0);
console.log('   Blocks Used:', result.metadata.blocksUsed.join(', '));
console.log('   Component Type:', result.Component.name || 'AnonymousComponent');

if (result.parseErrors.length > 0) {
  console.log('\n   Parse Errors:');
  result.parseErrors.forEach(err => console.log('     -', err));
}

if (result.buildErrors.length > 0) {
  console.log('\n   Build Errors:');
  result.buildErrors.forEach(err => console.log('     -', err));
}

if (result.buildWarnings.length > 0) {
  console.log('\n   Build Warnings:');
  result.buildWarnings.forEach(warn => console.log('     -', warn));
}

// Test 4: Verify AST
console.log('\n4. VERIFYING AST...');
if (result.ast) {
  console.log('   AST Name:', result.ast.name);
  console.log('   Bootstrap Block:', result.ast.bootstrap.blockId);
  console.log('   Layout Components:', result.ast.components.length);
  console.log('   Actions Defined:', Object.keys(result.ast.actions).length);
  console.log('   Action Names:', Object.keys(result.ast.actions).join(', '));
}

console.log('\n' + '='.repeat(60));
console.log('TEST COMPLETE ✅');
console.log('='.repeat(60));

// Export for use in other tests
export { testTemplate, result };
