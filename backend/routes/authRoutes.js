const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyGoogleToken } = require('../middleware/authMiddleware');

router.post('/google', verifyGoogleToken, async (req, res) => {
  try {
    const { sub: googleId, email, name, picture } = req.user;

    let user = await User.findOne({ googleId });
    if (!user) {
      user = new User({ googleId, email, name, picture });
      await user.save();
    }
    
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Server error during authentication' });
  }
});

module.exports = router;
