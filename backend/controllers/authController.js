import User from '../models/User.js';

export const googleLogin = async (req, res, next) => {
  try {
    const { sub: googleId, email, name, picture } = req.user;

    let user = await User.findOne({ googleId });
    if (!user) {
      user = new User({ googleId, email, name, picture });
      await user.save();
    }
    
    res.json({ user });
  } catch (error) {
    next(error); // Global error handler will catch this and return 500
  }
};
