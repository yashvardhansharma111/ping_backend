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

// Ad tier specs derived from blueprint (page 5).
const AD_TIER_SPECS = {
  basic_49: { priceMinor: 4900, maxProducts: 1, radiusMeters: 200, allowVideo: false, durationHours: 24 },
  pro_99: { priceMinor: 9900, maxProducts: 6, radiusMeters: 1000, allowVideo: true, durationHours: 24 },
};

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
  REPORT_TARGET_TYPE,
  REPORT_STATUS,
  BAN_TYPE,
  APPEAL_STATUS,
  ADMIN_ROLE,
  AUDIT_ACTIONS,
};
