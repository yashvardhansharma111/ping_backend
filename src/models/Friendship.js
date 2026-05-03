const mongoose = require('mongoose');
const { FRIENDSHIP_STATUS } = require('../utils/enums');

// userA and userB are stored sorted (userA < userB) to make pairs deterministic
// and let us put a unique compound index on the pair.
const FriendshipSchema = new mongoose.Schema(
  {
    userA: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: FRIENDSHIP_STATUS, default: 'pending', index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    acceptedAt: { type: Date, default: null },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

FriendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });
FriendshipSchema.index({ userB: 1, userA: 1 });

FriendshipSchema.statics.pair = function (a, b) {
  const [userA, userB] = [String(a), String(b)].sort();
  return { userA, userB };
};

module.exports = mongoose.model('Friendship', FriendshipSchema);
