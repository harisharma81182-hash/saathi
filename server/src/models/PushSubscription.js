import mongoose from 'mongoose';

// One browser or phone that agreed to receive Saathi's notifications (Web Push). A user can have
// several (laptop, phone...). The endpoint is the address the browser's push service gave us; it is
// unique, so subscribing the same device again just refreshes it. When the push service says the
// subscription is gone (404/410), it is deleted.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, maxlength: 1000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    // "Edge on Windows", "Chrome on Android"... shown nowhere yet, useful in logs.
    device: { type: String, default: '', maxlength: 120 },
    lastSuccessAt: { type: Date, default: null },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true },
);

pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

export const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);
