const USER_STATUS = ['active', 'warned', 'temp_banned', 'perm_banned'];

const FRIENDSHIP_STATUS = ['pending', 'accepted', 'blocked', 'rejected'];

const ACTIVITY_VISIBILITY = ['friends', 'squad', 'public'];
const ACTIVITY_STATUS = ['live', 'expired', 'cancelled'];
const ACTIVITY_GENDER_FILTER = ['all', 'women_only', 'men_only'];
const USER_GENDER = ['male', 'female', 'other'];
const ACTIVITY_TYPES = [
  'sport', 'food', 'music', 'study', 'outdoor', 'gaming', 'meetup', 'other',
];
const ACTIVITY_VIBES = ['cozy', 'fun', 'exciting', 'chill', 'networking', 'fitness'];
const ACTIVITY_EVENT_TYPES = ['joined', 'left', 'on_my_way', 'arrived', 'cancelled'];

const CHAT_ROOM_KIND = ['dm', 'activity', 'squad'];
const MESSAGE_TYPE = ['text', 'image', 'location', 'system'];

const AD_TIER = ['basic_49', 'pro_99'];
const AD_STATUS = ['pending_payment', 'live', 'expired', 'refunded', 'removed'];
const AD_CATEGORY = [
  'food_drink', 'fashion', 'beauty_wellness', 'home_services',
  'education', 'entertainment', 'other',
];
const AD_EVENT_TYPE = [
  'view', 'product_swipe', 'thumbs_up', 'want_to_visit',
  'profile_tap', 'contact_tap', 'share',
];

const PAYMENT_STATUS = ['created', 'attempted', 'paid', 'failed', 'refunded'];
const PAYMENT_GATEWAY = ['razorpay'];
const PAYMENT_PURPOSE = ['ad', 'subscription'];

/** User-facing subscription tiers */
const SUBSCRIPTION_TIER = ['free', 'pro', 'premium'];

/**
 * Catalog from working notes (amounts in paise).
 * Pro 3-month recorded as ₹149 total for 90 days (confirm later if meant ₹149/mo).
 */
const SUBSCRIPTION_PLANS = {
  pro_weekly:    { planId: 'pro_weekly',    tier: 'pro',     label: 'Pro Weekly',     intervalLabel: '1 week',   amountMinor: 6900,   durationDays: 7 },
  pro_monthly:   { planId: 'pro_monthly',   tier: 'pro',     label: 'Pro Monthly',    intervalLabel: '1 month',  amountMinor: 19900,  durationDays: 30 },
  pro_3m:        { planId: 'pro_3m',        tier: 'pro',     label: 'Pro 3 Months',   intervalLabel: '3 months', amountMinor: 14900,  durationDays: 90 },
  pro_yearly:    { planId: 'pro_yearly',    tier: 'pro',     label: 'Pro Yearly',     intervalLabel: '1 year',   amountMinor: 99900,  durationDays: 365 },
  premium_weekly:{ planId: 'premium_weekly',tier: 'premium', label: 'Premium Weekly', intervalLabel: '1 week',   amountMinor: 14900,  durationDays: 7 },
  premium_monthly:{planId: 'premium_monthly',tier:'premium', label: 'Premium Monthly',intervalLabel: '1 month',  amountMinor: 29900,  durationDays: 30 },
  premium_3m:    { planId: 'premium_3m',    tier: 'premium', label: 'Premium 3 Months',intervalLabel:'3 months', amountMinor: 59900,  durationDays: 90 },
  premium_yearly:{ planId: 'premium_yearly',tier: 'premium', label: 'Premium Yearly', intervalLabel: '1 year',   amountMinor: 149900, durationDays: 365 },
};

/** Feature entitlements by effective tier */
const TIER_ENTITLEMENTS = {
  free: {
    createPerWeek: 1,
    joinPerWeek: 1,
    dm: false,
    directPing: false,
    unlimitedPings: false,
    highlightTag: false,
    createSquad: false,
  },
  pro: {
    createPerWeek: 5,
    joinPerWeek: 15,
    dm: true,
    directPing: true,
    unlimitedPings: false,
    highlightTag: false,
    createSquad: false,
  },
  premium: {
    createPerWeek: Infinity,
    joinPerWeek: Infinity,
    dm: true,
    directPing: true,
    unlimitedPings: true,
    highlightTag: true,
    createSquad: true,
  },
};

const AD_TIER_SPECS = {
  basic_49: { priceMinor: 4900, maxProducts: 1, radiusMeters: 200, allowVideo: false, durationHours: 24 },
  pro_99: { priceMinor: 9900, maxProducts: 6, radiusMeters: 1000, allowVideo: true, durationHours: 24 },
};

const REPORT_TARGET_TYPE = ['user', 'ping', 'ad', 'message'];
const REPORT_STATUS = ['pending', 'resolved', 'dismissed', 'escalated'];

const BAN_TYPE = ['temp', 'perm'];
const APPEAL_STATUS = ['pending', 'approved', 'denied', 'info_requested'];

const OCCUPATION = ['job', 'student', 'founder', 'business', 'freelancer', 'exploring'];
const SLEEP_TYPE = ['night_owl', 'early_bird'];
const SPONTANEITY = ['planner', 'spontaneous'];
const FOOD_PERSONALITY = ['street_food', 'balanced', 'cafe_aesthetic'];
const TIME_RESPECT = ['always_early', 'on_time', 'fashionably_late'];
const DISTANCE_TOLERANCE = ['nearby', 'up_to_5km', 'travel_for_good_plans'];
const AVAILABILITY_PATTERN = ['weekends_only', 'evenings_mostly', 'random_anytime'];
const INTENT_SYNC = ['just_hanging', 'activity_partner', 'trying_new_places', 'networking'];
const EVENT_CATEGORY = ['offer', 'event'];

const ADMIN_ROLE = ['super_admin', 'moderator', 'finance'];
const AUDIT_ACTIONS = [
  'warning_issued', 'ban_applied', 'ban_removed', 'content_removed',
  'refund_processed', 'report_dismissed', 'report_escalated',
  'account_deleted', 'settings_changed', 'admin_login',
];

module.exports = {
  USER_STATUS,
  USER_GENDER,
  OCCUPATION,
  SLEEP_TYPE,
  SPONTANEITY,
  FOOD_PERSONALITY,
  TIME_RESPECT,
  DISTANCE_TOLERANCE,
  AVAILABILITY_PATTERN,
  INTENT_SYNC,
  EVENT_CATEGORY,
  FRIENDSHIP_STATUS,
  ACTIVITY_VISIBILITY,
  ACTIVITY_STATUS,
  ACTIVITY_GENDER_FILTER,
  ACTIVITY_TYPES,
  ACTIVITY_VIBES,
  ACTIVITY_EVENT_TYPES,
  CHAT_ROOM_KIND,
  MESSAGE_TYPE,
  AD_TIER,
  AD_STATUS,
  AD_CATEGORY,
  AD_EVENT_TYPE,
  AD_TIER_SPECS,
  PAYMENT_STATUS,
  PAYMENT_GATEWAY,
  PAYMENT_PURPOSE,
  SUBSCRIPTION_TIER,
  SUBSCRIPTION_PLANS,
  TIER_ENTITLEMENTS,
  REPORT_TARGET_TYPE,
  REPORT_STATUS,
  BAN_TYPE,
  APPEAL_STATUS,
  ADMIN_ROLE,
  AUDIT_ACTIONS,
};
