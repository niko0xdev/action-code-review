// Sample file for V2 review test - intentionally has issues to surface
const express = require('express');
const app = express();

function processUser(req, res) {
  const userId = req.query.id;
  // Potential SQL injection - no parameterization
  const query = "SELECT * FROM users WHERE id = " + userId;
  
  // Memory leak: interval never cleared
  setInterval(() => {
    console.log("Still running for user", userId);
  }, 1000);
  
  db.query(query, (err, results) => {
    if (err) {
      // Swallowed error
      return;
    }
    res.json(results);
  });
}

// No input validation
app.get('/user', processUser);

app.listen(3000);
