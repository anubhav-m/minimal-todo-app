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
  version: { type: Number, default: 0 }, // Bumped on every write; lets an update detect that it is stale
  // Set instead of removing the document, so a device that was offline learns of
  // the delete on its next sync and a late edit or create cannot bring the task back
  deletedAt: { type: Date, default: null },
  // Ids of the last sync operations applied here; a replayed one is recognised and skipped
  appliedOps: { type: [String], default: undefined, select: false }
}, { timestamps: true });

export const TOMBSTONE_TTL_DAYS = 90;

// Partial, so tasks created before clientId existed are not forced to be unique
taskSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } }
);

// Delta pull: "what changed for this user since the cursor"
taskSchema.index({ userId: 1, updatedAt: 1 });

// Tombstones are purged after TOMBSTONE_TTL_DAYS (live tasks have no date here and are never matched)
taskSchema.index({ deletedAt: 1 }, { expireAfterSeconds: TOMBSTONE_TTL_DAYS * 24 * 60 * 60 });

export default mongoose.model('Task', taskSchema);
