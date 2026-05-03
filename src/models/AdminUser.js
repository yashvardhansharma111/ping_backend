const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ADMIN_ROLE } = require('../utils/enums');

const AdminUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ADMIN_ROLE, default: 'moderator', index: true },

    mfaEnabled: { type: Boolean, default: false },
    totpSecret: { type: String, default: null, select: false },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    disabledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AdminUserSchema.index({ email: 1 }, { unique: true });

AdminUserSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

AdminUserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

AdminUserSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.totpSecret;
    return ret;
  },
});

module.exports = mongoose.model('AdminUser', AdminUserSchema);
