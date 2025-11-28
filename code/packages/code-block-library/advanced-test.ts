// Advanced test with more features
import { buildFromTemplate, validateTemplate, analyzeTemplate } from './src/index';

const advancedTemplate = `
\`\`\`yaml
GLASSVIEW_APP:
  name: "Advanced Test App"
  version: "2.0.0"
  
  bootstrap:
    block: "react-app"
    config:
      appName: "Advanced Test"
      initialState:
        isActive: false
        count: 0
        items: ["file1.ts", "file2.ts"]
        selectedIndex: 0
  
  layout:
    - component: "container"
      props:
        title: "Advanced Template Test"
        padding: "20px"
      children:
        - component: "status-indicator"
          condition: "!state.isActive"
          props:
            message: "System is inactive"
            color: "red"
        
        - component: "status-indicator"
          condition: "state.isActive"
          props:
            message: "System is active (Count: {state.count})"
            color: "green"
        
        - component: "slider-navigation"
          block: "slider-navigation"
          condition: "state.items.length > 0"
          props:
            items: "{state.items}"
            currentIndex: "{state.selectedIndex}"
            showDots: true
            showArrows: true
            onChange: "SELECT_ITEM"
        
        - component: "button"
          props:
            label: "Toggle Active"
            action: "TOGGLE_ACTIVE"
        
        - component: "button"
          props:
            label: "Increment Count"
            action: "INCREMENT"
  
  actions:
    TOGGLE_ACTIVE:
      type: "STATE_UPDATE"
      updates:
        isActive: "!{state.isActive}"
    
    INCREMENT:
      type: "STATE_UPDATE"
      updates:
        count: "{state.count + 1}"
    
    SELECT_ITEM:
      type: "STATE_UPDATE"
      updates:
        selectedIndex: "{payload}"
\`\`\`
`;

console.log('🧪 ADVANCED TEMPLATE TESTS');
console.log('='.repeat(50));

// Test 1: Analysis
console.log('\n1. ANALYZING TEMPLATE...');
const analysis = analyzeTemplate(advancedTemplate);
console.log('   📋 Name:', analysis.name);
console.log('   📦 Version:', analysis.version);
console.log('   🔧 Blocks Used:', analysis.blocksUsed.join(', '));
console.log('   📊 Component Count:', analysis.componentCount);
console.log('   ⚡ Action Count:', analysis.actionCount);

// Test 2: Validation
console.log('\n2. VALIDATING TEMPLATE...');
const validation = validateTemplate(advancedTemplate);
console.log('   ✅ Valid:', validation.valid);

if (validation.errors.length > 0) {
  console.log('   ❌ Errors:');
  validation.errors.forEach(err => console.log('     -', err));
}

if (validation.warnings.length > 0) {
  console.log('   ⚠️  Warnings:');
  validation.warnings.forEach(warn => console.log('     -', warn));
}

// Test 3: Building
console.log('\n3. BUILDING TEMPLATE...');
const result = buildFromTemplate(advancedTemplate);

console.log('   🏗️  Build Success:', result.metadata.errors.length === 0);
console.log('   📦 Blocks Used:', result.metadata.blocksUsed.join(', '));
console.log('   🎯 Component Type:', result.Component.displayName || result.Component.name || 'AnonymousComponent');

// Test 4: AST Verification
console.log('\n4. VERIFYING AST...');
if (result.ast) {
  console.log('   📝 Name:', result.ast.name);
  console.log('   🔖 Version:', result.ast.version);
  console.log('   🏗️  Bootstrap:', result.ast.bootstrap.blockId);
  console.log('   📊 Components:', result.ast.components.length);
  console.log('   ⚡ Actions:', Object.keys(result.ast.actions).length);
  console.log('   📋 Action Names:', Object.keys(result.ast.actions).join(', '));
  
  // Check initial state
  if (result.ast.bootstrap.props.initialState) {
    console.log('   💾 Initial State Keys:', Object.keys(result.ast.bootstrap.props.initialState).join(', '));
  }
}

// Test 5: Error Checking
console.log('\n5. ERROR CHECKING...');
if (result.parseErrors.length > 0) {
  console.log('   ❌ Parse Errors:');
  result.parseErrors.forEach(err => console.log('     -', err));
}

if (result.buildErrors.length > 0) {
  console.log('   ❌ Build Errors:');
  result.buildErrors.forEach(err => console.log('     -', err));
}

if (result.buildWarnings.length > 0) {
  console.log('   ⚠️  Build Warnings:');
  result.buildWarnings.forEach(warn => console.log('     -', warn));
}

// Test 6: Component Structure
console.log('\n6. COMPONENT STRUCTURE...');
if (result.ast) {
  const components = result.ast.components;
  console.log('   📊 Root Components:', components.length);
  
  components.forEach((comp, i) => {
    console.log(`   ${i + 1}. ${comp.type}${comp.blockId ? ' (block: ' + comp.blockId + ')' : ''}`);
    if (comp.condition) {
      console.log(`      📋 Condition: ${comp.condition}`);
    }
    if (comp.children && comp.children.length > 0) {
      console.log(`      👶 Children: ${comp.children.length}`);
    }
  });
}

console.log('\n' + '='.repeat(50));
console.log('🎉 ADVANCED TESTS COMPLETED SUCCESSFULLY!');
console.log('='.repeat(50));