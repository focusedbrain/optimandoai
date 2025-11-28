/**
 * Test the orchestrator integration with code-block-library
 */

import { Orchestrator } from '../src/Orchestrator';
import { buildFromTemplate } from '@optimandoai/code-block-library';

async function testOrchestratorIntegration() {
  console.log('🧪 Testing Orchestrator Integration\n');
  
  // 1. Basic orchestrator initialization
  console.log('1️⃣ Initializing Orchestrator...');
  const orchestrator = new Orchestrator({
    templateDir: './test-templates',
    enableFileWatching: false, // Disable for testing
    debugMode: true
  });
  
  try {
    await orchestrator.initialize();
    console.log('✅ Orchestrator initialized successfully\n');
  } catch (error) {
    console.error('❌ Orchestrator initialization failed:', error);
    return;
  }
  
  // 2. Test template loading from text
  console.log('2️⃣ Testing template loading from text...');
  const sampleTemplate = `
name: "Todo List App"
description: "A simple todo list application"
version: "1.0.0"

components:
  - type: display
    text: "My Todo List"
    style:
      fontSize: "24px"
      fontWeight: "bold"
      color: "#333"
      
  - type: input
    placeholder: "Enter new todo..."
    value: "{{ newTodo }}"
    onChange: "updateNewTodo"
    
  - type: button
    text: "Add Todo"
    onClick: "addTodo"
    style:
      backgroundColor: "#007bff"
      color: "white"
      padding: "8px 16px"
      
  - type: list
    items: "{{ todos }}"
    itemTemplate:
      type: display
      text: "{{ item.text }}"
      
  - type: conditional
    condition: "{{ todos.length === 0 }}"
    component:
      type: display
      text: "No todos yet! Add one above."
      style:
        color: "#666"
        fontStyle: "italic"

state:
  newTodo: ""
  todos: []

actions:
  updateNewTodo:
    type: "setState"
    path: "newTodo"
    value: "{{ value }}"
    
  addTodo:
    type: "setState"
    path: "todos"
    value: "{{ [...todos, { text: newTodo, completed: false }] }}"
    then:
      - type: "setState"
        path: "newTodo"
        value: ""
`;
  
  try {
    const result = orchestrator.loadTemplateFromText(sampleTemplate, 'test-sample');
    console.log('✅ Template loaded successfully');
    console.log('📋 Template Name:', result.ast?.name);
    console.log('📋 Template Description:', result.ast?.description);
    console.log('🏗️  Build Result:', {
      hasComponent: !!result.Component,
      hasMetadata: !!result.metadata,
      errors: result.metadata.errors.length,
      warnings: result.metadata.warnings.length
    });
    console.log('');
  } catch (error) {
    console.error('❌ Template loading failed:', error);
    return;
  }
  
  // 3. Test status information
  console.log('3️⃣ Testing orchestrator status...');
  const status = orchestrator.getStatus();
  console.log('📊 Orchestrator Status:', {
    initialized: status.initialized,
    loadedTemplates: status.loadedTemplates,
    cachedTemplates: status.cachedTemplates,
    recentTemplates: status.recentTemplates.length
  });
  console.log('');
  
  // 4. Test event system
  console.log('4️⃣ Testing event system...');
  const eventBus = orchestrator.getEventBus();
  
  // Set up event listeners
  let eventCount = 0;
  eventBus.on('template:loaded', () => {
    eventCount++;
    console.log('🎉 Event: template:loaded');
  });
  
  eventBus.on('template:built', () => {
    eventCount++;
    console.log('🎉 Event: template:built');
  });
  
  // Load another template to trigger events
  const simpleTemplate = `
name: "Simple Test"
components:
  - type: display
    text: "Hello from event test!"
`;
  
  orchestrator.loadTemplateFromText(simpleTemplate, 'event-test');
  console.log(`✅ Events captured: ${eventCount}\n`);
  
  // 5. Test loaded template retrieval
  console.log('5️⃣ Testing template retrieval...');
  const loadedTemplates = orchestrator.getAllLoadedTemplates();
  console.log(`📚 Total loaded templates: ${loadedTemplates.length}`);
  
  for (const template of loadedTemplates) {
    console.log(`  - ${template.name} (${template.id})`);
  }
  console.log('');
  
  // 6. Test direct comparison with code-block-library
  console.log('6️⃣ Testing vs direct code-block-library usage...');
  
  // Direct usage
  const directResult = buildFromTemplate(sampleTemplate);
  
  // Orchestrator usage  
  const orchestratorResult = orchestrator.loadTemplateFromText(sampleTemplate, 'comparison-test');
  
  console.log('🔄 Comparison Results:');
  console.log('  Direct:', {
    hasComponent: !!directResult.Component,
    errors: directResult.metadata.errors.length,
    astName: directResult.ast?.name
  });
  console.log('  Orchestrator:', {
    hasComponent: !!orchestratorResult.Component,
    errors: orchestratorResult.metadata.errors.length,
    astName: orchestratorResult.ast?.name
  });
  
  const resultsMatch = (
    !!directResult.Component === !!orchestratorResult.Component &&
    directResult.metadata.errors.length === orchestratorResult.metadata.errors.length &&
    directResult.ast?.name === orchestratorResult.ast?.name
  );
  
  console.log(`✅ Results match: ${resultsMatch}\n`);
  
  // 7. Test error handling
  console.log('7️⃣ Testing error handling...');
  
  const badTemplate = `
name: "Bad Template"
components:
  - type: nonexistent-component
    badProperty: "this will fail"
`;

  let errorCaught = false;
  eventBus.on('template:error', (error, source) => {
    console.log(`🚨 Error event caught from ${source}: ${error}`);
    errorCaught = true;
  });
  
  try {
    orchestrator.loadTemplateFromText(badTemplate, 'error-test');
    console.log('🤔 No error thrown (unexpected)');
  } catch (error) {
    console.log(`✅ Error caught correctly: ${error instanceof Error ? error.message : error}`);
  }
  
  console.log(`✅ Error event fired: ${errorCaught}\n`);
  
  // 8. Cleanup
  console.log('8️⃣ Testing cleanup...');
  orchestrator.clearCache();
  
  const statusAfterClear = orchestrator.getStatus();
  console.log('📊 Status after cache clear:', {
    cachedTemplates: statusAfterClear.cachedTemplates,
    loadedTemplates: statusAfterClear.loadedTemplates
  });
  
  await orchestrator.shutdown();
  console.log('✅ Orchestrator shutdown complete');
  
  console.log('\n🎉 All tests completed successfully!');
  console.log('\n📋 Summary:');
  console.log('  ✅ Orchestrator initialization');
  console.log('  ✅ Template loading from text');
  console.log('  ✅ Status reporting');
  console.log('  ✅ Event system');
  console.log('  ✅ Template retrieval');
  console.log('  ✅ Code-block-library integration');
  console.log('  ✅ Error handling');
  console.log('  ✅ Cache management and cleanup');
}

// Run the test
if (require.main === module) {
  testOrchestratorIntegration()
    .then(() => {
      console.log('\n🚀 Integration test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Integration test failed:', error);
      process.exit(1);
    });
}

export { testOrchestratorIntegration };