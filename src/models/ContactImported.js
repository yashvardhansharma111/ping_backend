const mongoose = require('mongoose');

// Stores hashed phone numbers a user has uploaded so we can suggest friends
// without keeping plaintext PII.
const ContactImportedSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    phoneHash: { type: String, required: true },
    label: { type: String, default: null, maxlength: 80 },
  },
  { timestamps: true },
);

ContactImportedSchema.index({ ownerId: 1, phoneHash: 1 }, { unique: true });
ContactImportedSchema.index({ phoneHash: 1 });

module.exports = mongoose.model('ContactImported', ContactImportedSchema);
