const express = require('express');
const app = express();
function processUser(req, res) {
  const userId = req.query.id;
  const query = "SELECT * FROM users WHERE id = " + userId;
  setInterval(() => { console.log("running", userId); }, 1000);
  db.query(query, (err, results) => {
    if (err) return;
    res.json(results);
  });
}
app.get('/user', processUser);
app.listen(3000);
