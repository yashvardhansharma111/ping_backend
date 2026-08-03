const mongoose = require('mongoose');
const { Schema } = mongoose;

const VerificationRequestSchema = new Schema({
  userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
  selfieUrl:       { type: String, required: true },
  poseInstruction: { type: String, required: true },
  status:          { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy:      { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  reviewedAt:      { type: Date, default: null },
  rejectionReason: { type: String, default: null },
}, { timestamps: true });

// One active (pending/approved) request per user at a time; also supports fast
// lookups like "find latest request for this user".
VerificationRequestSchema.index({ userId: 1, status: 1 });
VerificationRequestSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('VerificationRequest', VerificationRequestSchema);
