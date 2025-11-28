/**
 * Quick test script to verify code block library functionality
 * Run with: node test-blocks.js
 */

// Import the compiled library (will need to build first or use ts-node)
console.log('🧪 Testing Code Block Library\n');

// Test 1: Block Registry
console.log('1️⃣ Testing Block Registry...');
try {
  const { registry, getAllBlocks, getBlock, hasBlock } = require('./src/registry/BlockRegistry.ts');
  
  console.log('   ✅ Block Registry imported successfully');
  
  // This will fail because it's TypeScript - need to compile first
} catch (error) {
  console.log('   ⚠️  Need to compile TypeScript first');
}

// Test 2: Check block metadata files
console.log('\n2️⃣ Checking Block Metadata Files...');
const fs = require('fs');
const path = require('path');

const blockFiles = [
  'src/blocks/bootstrap/react-app.block.json',
  'src/blocks/ui/slider-navigation.block.json',
  'src/blocks/ui/icon-trigger.block.json',
  'src/blocks/diff-viewer/code-hunk-display.block.json',
  'src/blocks/integrations/open-file-action.block.json'
];

blockFiles.forEach(file => {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const block = JSON.parse(content);
    console.log(`   ✅ ${block.id}: ${block.name}`);
    console.log(`      Category: ${block.category}`);
    console.log(`      Description: ${block.description.substring(0, 60)}...`);
  } catch (error) {
    console.log(`   ❌ Failed to load ${file}: ${error.message}`);
  }
});

// Test 3: Check component files exist
console.log('\n3️⃣ Checking Component Files...');
const componentFiles = [
  'src/blocks/bootstrap/react-app.component.tsx',
  'src/blocks/ui/slider-navigation.component.tsx',
  'src/blocks/ui/icon-trigger.component.tsx',
  'src/blocks/diff-viewer/code-hunk-display.component.tsx',
  'src/blocks/integrations/open-file-action.component.tsx'
];

componentFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const stats = fs.statSync(file);
    console.log(`   ✅ ${path.basename(file)} (${stats.size} bytes)`);
  } else {
    console.log(`   ❌ ${file} not found`);
  }
});

// Test 4: Verify package.json
console.log('\n4️⃣ Checking Package Configuration...');
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  console.log(`   ✅ Package: ${pkg.name}@${pkg.version}`);
  console.log(`   ✅ Dependencies:`, Object.keys(pkg.dependencies || {}).join(', '));
  console.log(`   ✅ DevDependencies:`, Object.keys(pkg.devDependencies || {}).join(', '));
} catch (error) {
  console.log(`   ❌ Failed to read package.json: ${error.message}`);
}

// Test 5: Check template file
console.log('\n5️⃣ Checking Template Files...');
const templateFile = 'src/templates/file-watcher.template.md';
if (fs.existsSync(templateFile)) {
  const content = fs.readFileSync(templateFile, 'utf-8');
  const hasYAML = content.includes('GLASSVIEW_APP:');
  const hasDescription = content.includes('## Description');
  console.log(`   ✅ Template file exists (${content.length} chars)`);
  console.log(`   ${hasYAML ? '✅' : '❌'} Contains GLASSVIEW_APP structure`);
  console.log(`   ${hasDescription ? '✅' : '❌'} Contains description`);
} else {
  console.log(`   ❌ Template file not found`);
}

console.log('\n✅ Basic structure verification complete!\n');
console.log('📝 To fully test the TypeScript code:');
console.log('   1. Run: npx tsc --noEmit (verify compilation)');
console.log('   2. Build: npx tsc (compile to JavaScript)');
console.log('   3. Import in another package and test functionality\n');
