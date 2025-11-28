# Refactoring Suggestions

## Complex Function Breakdown

Method too complex, should be split:

```javascript
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
```

**Complexity Reduction**: From 15 to 3 cyclomatic complexity
**Maintainability**: Improved testability and readability
**Tags**: #refactor #cleanup #maintainability
