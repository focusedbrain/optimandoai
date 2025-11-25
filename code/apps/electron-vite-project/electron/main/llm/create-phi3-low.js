#!/usr/bin/env node
/**
 * Automatically creates the phi3-low custom model
 * Run: node create-phi3-low.js
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

async function createPhi3Low() {
  console.log('🚀 Creating phi3-low custom model...');
  
  try {
    // Check if Ollama is running
    console.log('1️⃣ Checking Ollama status...');
    try {
      await execAsync('ollama list');
      console.log('✅ Ollama is running');
    } catch (error) {
      console.error('❌ Ollama is not running. Please start Ollama first.');
      process.exit(1);
    }
    
    // Pull base model if not exists
    console.log('2️⃣ Checking for base model phi3:3.8b-q4_K_M...');
    const { stdout: listOutput } = await execAsync('ollama list');
    
    if (!listOutput.includes('phi3:3.8b-q4_K_M')) {
      console.log('📥 Pulling base model phi3:3.8b-q4_K_M (this may take a few minutes)...');
      await execAsync('ollama pull phi3:3.8b-q4_K_M');
      console.log('✅ Base model downloaded');
    } else {
      console.log('✅ Base model already exists');
    }
    
    // Create custom model
    console.log('3️⃣ Creating phi3-low from Modelfile...');
    const modelfilePath = path.join(__dirname, 'Modelfile.phi3-low');
    
    if (!fs.existsSync(modelfilePath)) {
      console.error('❌ Modelfile not found at:', modelfilePath);
      process.exit(1);
    }
    
    await execAsync(`ollama create phi3-low -f "${modelfilePath}"`);
    console.log('✅ phi3-low model created successfully!');
    
    // Verify
    console.log('4️⃣ Verifying model...');
    const { stdout: verifyOutput } = await execAsync('ollama list');
    
    if (verifyOutput.includes('phi3-low')) {
      console.log('✅ phi3-low is ready to use!');
      console.log('\n📋 Test it with:');
      console.log('   ollama run phi3-low "Hello!"');
    } else {
      console.error('❌ Model creation may have failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createPhi3Low();







