const mongoose = require('mongoose');

const SquadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    memberIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      validate: {
        validator: (arr) => arr.length >= 2 && arr.length <= 20,
        message: 'a squad has 2 to 20 members',
      },
      index: true,
    },
    avatarUrl: { type: String, default: null },
    description: { type: String, default: '', maxlength: 200 },
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

SquadSchema.index({ memberIds: 1, lastActivityAt: -1 });

module.exports = mongoose.model('Squad', SquadSchema);
