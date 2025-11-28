# Live Code Review Demonstration

## File: demo-vulnerable.js
```javascript
// BEFORE: Vulnerable code
function processUserInput(userInput) {
    // Direct SQL query - SECURITY RISK
    const query = "SELECT * FROM users WHERE id = " + userInput;
    return database.query(query);
}

// No input validation
function loginUser(req, res) {
    const username = req.body.username;
    const password = req.body.password;
    
    // Plain text password storage - MAJOR SECURITY ISSUE
    const user = findUserByCredentials(username, password);
    if (user) {
        res.send("Login successful");
    }
}
```

## AI Analysis Result:
- **Security Issues**: 2 CRITICAL
- **Vulnerabilities**: SQL Injection, Plain text passwords
- **Recommendation**: Immediate refactoring required
- **Trigger Color**: 🔴 RED (High Priority)

## Next Action:
GlassView will automatically:
1. Detect this file change
2. Parse security keywords
3. Trigger red cursor indicator  
4. Send to AI for analysis
5. Display recommendations

---
**Status**: PENDING REVIEW
**Auto-detected**: YES
**Priority**: CRITICAL