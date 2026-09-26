import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  time: { type: String, default: null }, // Optional time (e.g., "18:00")
  notify: { type: Boolean, default: false }, // Optional notify flag
  completed: { type: Boolean, default: false },
  priority: { type: String, enum: ['none', 'low', 'medium', 'high'], default: 'none' }
}, { timestamps: true });

export default mongoose.model('Task', taskSchema);
