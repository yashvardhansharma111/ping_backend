const mongoose = require('mongoose');
const { CHAT_ROOM_KIND } = require('../utils/enums');

const ChatRoomSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: CHAT_ROOM_KIND, required: true, index: true },
    participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', default: null },
    squadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Squad', default: null },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: '' },
  },
  { timestamps: true },
);

ChatRoomSchema.index({ participantIds: 1, lastMessageAt: -1 });
ChatRoomSchema.index({ activityId: 1 }, { unique: true, sparse: true });
ChatRoomSchema.index({ squadId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ChatRoom', ChatRoomSchema);
