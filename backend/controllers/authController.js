import User from '../models/User.js';

const DUPLICATE_KEY = 11000;

export const googleLogin = async (req, res, next) => {
  try {
    const { sub: googleId, email, name, picture } = req.user;

    let user = await User.findOne({ googleId });
    if (!user) {
      try {
        user = await new User({ googleId, email, name, picture }).save();
      } catch (error) {
        // A concurrent first login created the user between our read and our insert
        if (error?.code !== DUPLICATE_KEY) throw error;
        user = await User.findOne({ googleId });
        if (!user) throw error;
      }
    }
    
    res.json({ user });
  } catch (error) {
    next(error); // Global error handler will catch this and return 500
  }
};
