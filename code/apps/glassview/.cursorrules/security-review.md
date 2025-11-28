# Security Code Review

## Potential SQL Injection Vulnerability

Found in user authentication module:

```diff
@@@ -15,3 +15,4 @@@
  function authenticateUser(username, password) {
-   const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
+   const query = "SELECT * FROM users WHERE username = ? AND password = ?";
-   return database.execute(query);
+   return database.execute(query, [username, hashPassword(password)]);
  }
```

**Risk Level**: High
**Impact**: Potential data breach, unauthorized access
**Recommendation**: Use parameterized queries and password hashing
