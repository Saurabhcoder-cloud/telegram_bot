const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'Placeholder route for payment.' });
});

module.exports = router;
