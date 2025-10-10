const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'Placeholder route for auth.' });
});

module.exports = router;
