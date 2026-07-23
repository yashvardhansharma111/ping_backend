const mongoose = require('mongoose');
const { CHAT_ROOM_KIND } = require('../utils/enums');

const ChatRoomSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: CHAT_ROOM_KIND, required: true, index: true },
    participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    // Group display (activity/squad). DM ignores these.
    name: { type: String, default: null, trim: true, maxlength: 60 },
    avatarUrl: { type: String, default: null, maxlength: 500 },
    // No default: null — absent field is not indexed, preventing cross-kind uniqueness collisions
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity' },
    squadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Squad' },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: '' },
  },
  { timestamps: true },
);

ChatRoomSchema.index({ participantIds: 1, lastMessageAt: -1 });
// partialFilterExpression is safer than sparse: sparse indexes null, partial does not
ChatRoomSchema.index({ activityId: 1 }, { unique: true, partialFilterExpression: { activityId: { $type: 'objectId' } } });
ChatRoomSchema.index({ squadId: 1 },    { unique: true, partialFilterExpression: { squadId:    { $type: 'objectId' } } });

module.exports = mongoose.model('ChatRoom', ChatRoomSchema);
