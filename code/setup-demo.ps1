#!/usr/bin/env pwsh

# GlassView Kickstarter Demo Setup Script
# This script prepares the development environment for recording the demo video

Write-Host "🎬 GlassView Kickstarter Demo Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Check if we're in the right directory
$currentPath = Get-Location
if (-not (Test-Path "apps\glassview")) {
    Write-Host "❌ Please run this script from the root code directory" -ForegroundColor Red
    Write-Host "Expected: D:\projects\Oscar\optimandoai\code" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Running from correct directory: $currentPath" -ForegroundColor Green

# Step 1: Test the GlassView application
Write-Host "`n1️⃣ Testing GlassView Application..." -ForegroundColor Yellow
Set-Location "apps\glassview"

Write-Host "Running comprehensive tests..." -ForegroundColor Gray
$testResult = node test\glassview-test.ts
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ All tests passed!" -ForegroundColor Green
} else {
    Write-Host "❌ Tests failed - please fix before demo recording" -ForegroundColor Red
    exit 1
}

# Step 2: Open browser test for UI verification
Write-Host "`n2️⃣ Opening Browser Test..." -ForegroundColor Yellow
if (Test-Path "test\browser-test.html") {
    Start-Process "test\browser-test.html"
    Write-Host "✅ Browser test opened - verify UI components work correctly" -ForegroundColor Green
} else {
    Write-Host "❌ Browser test file not found" -ForegroundColor Red
}

# Step 3: Check if recording tools are available
Write-Host "`n3️⃣ Checking Recording Setup..." -ForegroundColor Yellow

# Check for OBS Studio
$obsPath = Get-Command "obs" -ErrorAction SilentlyContinue
if ($obsPath) {
    Write-Host "✅ OBS Studio found: $($obsPath.Source)" -ForegroundColor Green
} else {
    Write-Host "⚠️  OBS Studio not found - install from https://obsproject.com/" -ForegroundColor Yellow
}

# Check for screen recording alternatives
$winRecPath = Get-Command "msra" -ErrorAction SilentlyContinue
if ($winRecPath) {
    Write-Host "✅ Windows Steps Recorder available as fallback" -ForegroundColor Green
}

# Step 4: Prepare demo environment
Write-Host "`n4️⃣ Preparing Demo Environment..." -ForegroundColor Yellow

# Create sample review files for demo
$demoDir = ".cursorrules"
if (-not (Test-Path $demoDir)) {
    New-Item -ItemType Directory -Path $demoDir -Force | Out-Null
}

# Create security vulnerability example
$securityReview = @"
# Security Code Review

## Potential SQL Injection Vulnerability

Found in user authentication module:

``````diff
@@@ -15,3 +15,4 @@@
  function authenticateUser(username, password) {
-   const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
+   const query = "SELECT * FROM users WHERE username = ? AND password = ?";
-   return database.execute(query);
+   return database.execute(query, [username, hashPassword(password)]);
  }
``````

**Risk Level**: High
**Impact**: Potential data breach, unauthorized access
**Recommendation**: Use parameterized queries and password hashing
"@

$securityReview | Out-File -FilePath "$demoDir\security-review.md" -Encoding UTF8

# Create performance review example
$performanceReview = @"
# Performance Code Review

## Inefficient Database Query

Performance bottleneck detected in user search:

``````diff
@@@ -25,8 +25,12 @@@
  function searchUsers(searchTerm) {
-   const users = getAllUsers();
-   return users.filter(user => user.name.includes(searchTerm));
+   const query = "SELECT * FROM users WHERE name LIKE ? LIMIT 100";
+   return database.execute(query, [`%${searchTerm}%`]);
  }
``````

**Performance Impact**: O(n) to O(log n) improvement
**Memory Usage**: Reduced by 90% for large datasets
**Response Time**: Improved from 2-3s to <200ms
"@

$performanceReview | Out-File -FilePath "$demoDir\performance-review.md" -Encoding UTF8

# Create refactor suggestion example
$refactorReview = @"
# Refactoring Suggestions

## Complex Function Breakdown

Method too complex, should be split:

``````javascript
// BEFORE: Complex function doing multiple things
function processUserData(userData) {
  // Validation logic (20 lines)
  if (!userData || !userData.email) return null;
  
  // Transformation logic (15 lines)  
  const processed = transformData(userData);
  
  // Business logic (25 lines)
  const result = applyBusinessRules(processed);
  
  return result;
}

// AFTER: Split into focused functions
function processUserData(userData) {
  const validated = validateUserData(userData);
  const transformed = transformUserData(validated);
  return applyBusinessRules(transformed);
}
``````

**Complexity Reduction**: From 15 to 3 cyclomatic complexity
**Maintainability**: Improved testability and readability
**Tags**: #refactor #cleanup #maintainability
"@

$refactorReview | Out-File -FilePath "$demoDir\refactor-suggestions.md" -Encoding UTF8

Write-Host "✅ Created demo review files in $demoDir directory" -ForegroundColor Green

# Step 5: Create sample code files for live editing
Write-Host "`n5️⃣ Creating Sample Code Files..." -ForegroundColor Yellow

$vulnerableCode = @"
// DEMO FILE - Contains intentional vulnerabilities for demo purposes
const express = require('express');
const mysql = require('mysql');

const app = express();
app.use(express.json());

// BAD: SQL Injection vulnerability
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
  
  database.execute(query, (err, results) => {
    if (results.length > 0) {
      res.json({ success: true, user: results[0] });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

// BAD: Performance issue with N+1 queries
app.get('/users/:id/orders', async (req, res) => {
  const user = await User.findById(req.params.id);
  const orders = [];
  
  for (let orderId of user.orderIds) {
    const order = await Order.findById(orderId); // N+1 problem
    orders.push(order);
  }
  
  res.json(orders);
});

// BAD: No input validation
app.post('/users', (req, res) => {
  const userData = req.body; // No validation
  const user = new User(userData);
  user.save();
  res.json(user);
});

module.exports = app;
"@

$vulnerableCode | Out-File -FilePath "demo-vulnerable.js" -Encoding UTF8

$improvedCode = @"
// DEMO FILE - Fixed version showing best practices
const express = require('express');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const joi = require('joi');

const app = express();
app.use(express.json());

// GOOD: Parameterized queries prevent SQL injection
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Input validation
  const schema = joi.object({
    username: joi.string().alphanum().min(3).max(30).required(),
    password: joi.string().min(6).required()
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  
  // Secure database query
  const query = "SELECT id, username, password_hash FROM users WHERE username = ?";
  
  try {
    const results = await database.execute(query, [username]);
    if (results.length > 0) {
      const user = results[0];
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      
      if (isValidPassword) {
        res.json({ success: true, userId: user.id });
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GOOD: Optimized query with joins
app.get('/users/:id/orders', async (req, res) => {
  const userId = parseInt(req.params.id);
  
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  
  // Single query with JOIN instead of N+1
  const query = `
    SELECT o.* FROM orders o 
    INNER JOIN user_orders uo ON o.id = uo.order_id 
    WHERE uo.user_id = ?
  `;
  
  try {
    const orders = await database.execute(query, [userId]);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

/**
 * Create a new user with validation and security
 * @param {Object} req.body - User data
 * @param {string} req.body.username - Username (3-30 chars, alphanumeric)
 * @param {string} req.body.email - Valid email address
 * @param {string} req.body.password - Password (min 6 chars)
 */
app.post('/users', async (req, res) => {
  // GOOD: Input validation schema
  const schema = joi.object({
    username: joi.string().alphanum().min(3).max(30).required(),
    email: joi.string().email().required(),
    password: joi.string().min(6).required()
  });
  
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  
  try {
    // Hash password before storing
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(value.password, saltRounds);
    
    const user = new User({
      username: value.username,
      email: value.email,
      password_hash: passwordHash
    });
    
    await user.save();
    
    // Don't return sensitive data
    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Username or email already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

module.exports = app;
"@

$improvedCode | Out-File -FilePath "demo-improved.js" -Encoding UTF8

Write-Host "✅ Created demo code files for live editing" -ForegroundColor Green

# Step 6: Display recording checklist
Write-Host "`n6️⃣ Demo Recording Checklist" -ForegroundColor Yellow
Write-Host "============================" -ForegroundColor Gray

$checklist = @"
Pre-Recording Setup:
[ ] Clean desktop with only necessary applications
[ ] Close all notifications and distractions  
[ ] Set phone to airplane mode
[ ] Test microphone audio levels
[ ] Practice script 3-5 times
[ ] Ensure good lighting if showing presenter
[ ] Have water nearby for clear speech

Recording Environment Ready:
✅ GlassView application tested and working
✅ Browser test opened for UI verification
✅ Sample review files created (.cursorrules directory)
✅ Demo code files prepared for live editing
✅ Terminal ready in correct directory

Recording Steps:
1. Start screen recording (4K resolution, 60fps)
2. Open Cursor IDE with demo project
3. Open GlassView application in browser
4. Follow demo script for live coding session
5. Show file monitoring, AI analysis, and triggers
6. Demonstrate color-coded workflow system
7. Record multiple takes for best quality

Post-Recording:
[ ] Review footage for technical quality
[ ] Edit with professional transitions
[ ] Add captions for accessibility  
[ ] Export in multiple formats
[ ] Create shorter clips for social media
"@

Write-Host $checklist -ForegroundColor Gray

# Step 7: Final instructions
Write-Host "`n🎬 Ready for Demo Recording!" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

Write-Host "`nQuick Start Commands:" -ForegroundColor Yellow
Write-Host "1. Start GlassView:" -ForegroundColor Gray
Write-Host "   pnpm dev" -ForegroundColor White

Write-Host "2. Watch for file changes:" -ForegroundColor Gray  
Write-Host "   .cursorrules directory will be monitored" -ForegroundColor White

Write-Host "3. Edit demo files to trigger analysis:" -ForegroundColor Gray
Write-Host "   demo-vulnerable.js -> demo-improved.js" -ForegroundColor White

Write-Host "`nDemo Flow Reminder:" -ForegroundColor Yellow
Write-Host "1. Show problem with manual code review (30 sec)" -ForegroundColor Gray
Write-Host "2. Introduce GlassView solution (30 sec)" -ForegroundColor Gray
Write-Host "3. Live demo - file monitoring (45 sec)" -ForegroundColor Gray
Write-Host "4. Live demo - AI analysis (45 sec)" -ForegroundColor Gray
Write-Host "5. Show color-coded triggers (30 sec)" -ForegroundColor Gray
Write-Host "6. Technical excellence overview (30 sec)" -ForegroundColor Gray
Write-Host "7. Call to action (15 sec)" -ForegroundColor Gray

Write-Host "`n🚀 Break a leg! This demo will showcase GlassView's revolutionary capabilities!" -ForegroundColor Green
Write-Host "📧 Questions? Review the DEMO_SCRIPT.md file for detailed guidance." -ForegroundColor Cyan

# Return to original directory
Set-Location $currentPath