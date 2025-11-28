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
