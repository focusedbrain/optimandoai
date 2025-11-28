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
  const query = 
    SELECT o.* FROM orders o 
    INNER JOIN user_orders uo ON o.id = uo.order_id 
    WHERE uo.user_id = ?
  ;
  
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
