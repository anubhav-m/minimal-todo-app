import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientId: { type: String }, // UUID chosen by the client; makes a repeated create return the same task
  text: { type: String, required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  time: { type: String, default: null }, // Optional time (e.g., "18:00")
  notify: { type: Boolean, default: false }, // Optional notify flag
  notificationId: { type: String, default: null }, // Identifier of the local reminder scheduled for this task
  completed: { type: Boolean, default: false },
  priority: { type: String, enum: ['none', 'low', 'medium', 'high'], default: 'none' },
  version: { type: Number, default: 0 } // Bumped on every write; lets an update detect that it is stale
}, { timestamps: true });

// Partial, so tasks created before clientId existed are not forced to be unique
taskSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

export default mongoose.model('Task', taskSchema);
