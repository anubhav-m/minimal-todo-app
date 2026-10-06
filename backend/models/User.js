import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  picture: { type: String },
  timezone: { type: String, default: null }, // IANA zone last reported by a client, e.g. "Asia/Kolkata"
  lastRolloverDate: { type: String, default: null } // local YYYY-MM-DD of the last rollover
}, { timestamps: true });

export default mongoose.model('User', userSchema);
