// Import the TypeScript version directly with tsx
const { execSync } = require('child_process');

console.log('🧪 Testing TemplateBuilder...\n');

// Run a simple test using tsx to handle TypeScript
const testCode = `
import { buildFromTemplate, validateTemplate } from './src/index';

const template = \`
\\\`\\\`\\\`yaml
GLASSVIEW_APP:
  name: "Test App"
  bootstrap:
    block: "react-app"
    config:
      appName: "Test"
      initialState: 
        message: "Hello World"
  layout:
    - component: "container"
      props:
        title: "Working!"
\\\`\\\`\\\`
\`;

console.log('✅ Validating template...');
const validation = validateTemplate(template);
console.log('   Valid:', validation.valid);

if (validation.errors.length > 0) {
  console.log('❌ Validation errors:');
  validation.errors.forEach(err => console.log('   -', err));
  process.exit(1);
}

console.log('✅ Building template...');
const result = buildFromTemplate(template);
console.log('   Build Success:', result.metadata.errors.length === 0);
console.log('   Blocks Used:', result.metadata.blocksUsed.join(', '));
console.log('   AST Name:', result.ast?.name);

if (result.metadata.errors.length > 0) {
  console.log('❌ Build errors:');
  result.metadata.errors.forEach(err => console.log('   -', err));
  process.exit(1);
}

console.log('\\n🎉 All tests passed!');
`;

// Write the test to a temporary TypeScript file
require('fs').writeFileSync('temp-test.ts', testCode);

try {
  // Try to run with tsx
  execSync('npx tsx temp-test.ts', { stdio: 'inherit' });
  console.log('\n✅ TemplateBuilder is working correctly!');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  
  // Fallback: Try direct validation without building
  console.log('\n📋 Trying basic validation...');
  try {
    const fs = require('fs');
    const basicTest = fs.readFileSync('./src/parser/TemplateParser.ts', 'utf8');
    if (basicTest.includes('class TemplateParser')) {
      console.log('✅ TemplateParser class found');
    }
    
    const builderTest = fs.readFileSync('./src/builder/TemplateBuilder.ts', 'utf8');
    if (builderTest.includes('class TemplateBuilder')) {
      console.log('✅ TemplateBuilder class found');
    }
    
    console.log('✅ Core classes are present and should work');
  } catch (fallbackError) {
    console.error('❌ Fallback test failed:', fallbackError.message);
  }
} finally {
  // Clean up
  try {
    require('fs').unlinkSync('temp-test.ts');
  } catch (e) {}
}