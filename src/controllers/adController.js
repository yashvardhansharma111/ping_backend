const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const { AD_TIER, AD_TIER_SPECS, AD_CATEGORY } = require('../utils/enums');

const Ad = require('../models/Ad');
const AdEvent = require('../models/AdEvent');
const AdAnalyticsDaily = require('../models/AdAnalyticsDaily');
const Payment = require('../models/Payment');
const WantToVisit = require('../models/WantToVisit');
const paymentService = require('../services/paymentService');

const EARTH_RADIUS_M = 6378137;

// ---------------------------- advertiser side ------------------------------

// Map raw product input → schema shape; strict size cap per tier handled by
// the Ad pre-validate hook.
function normalizeProducts(input, tier) {
  if (!Array.isArray(input)) {
    throw AppError.badRequest('invalid_products', 'products must be an array');
  }
  const spec = AD_TIER_SPECS[tier];
  return input.slice(0, spec.maxProducts).map((p, i) => ({
    imageUrl: v.requireString(p?.imageUrl, `products[${i}].imageUrl`, { min: 5, max: 1000 }),
    videoUrl: spec.allowVideo && p?.videoUrl ? String(p.videoUrl).slice(0, 1000) : null,
    name: v.requireString(p?.name, `products[${i}].name`, { min: 1, max: 40 }),
    priceMinor: p?.priceMinor != null
      ? v.requireNumber(p.priceMinor, `products[${i}].priceMinor`, { min: 0, integer: true })
      : null,
    description: v.optionalString(p?.description, `products[${i}].description`, { max: 120 }) ?? '',
    order: i,
  }));
}

// POST /api/v1/ads   body: { tier, businessName, category, tagline?, lat, lng, contactPhone?, products[] }
const createDraft = asyncHandler(async (req, res) => {
  const tier = v.requireEnum(req.body?.tier, 'tier', AD_TIER);
  const spec = AD_TIER_SPECS[tier];

  const businessName = v.requireString(req.body?.businessName, 'businessName', { min: 1, max: 40 });
  const category = v.requireEnum(req.body?.category, 'category', AD_CATEGORY);
  const tagline = v.optionalString(req.body?.tagline, 'tagline', { max: 60 }) ?? '';
  const coords = v.requireLatLng(req.body?.lat, req.body?.lng);
  const products = normalizeProducts(req.body?.products || [], tier);
  if (products.length < 1) throw AppError.badRequest('no_products', 'At least one product is required');

  const ad = await Ad.create({
    userId: req.userId,
    tier,
    businessName,
    category,
    tagline,
    contactPhone: req.body?.contactPhone || null,
    location: { type: 'Point', coordinates: coords },
    radiusMeters: spec.radiusMeters,
    products,
    status: 'pending_payment',
  });
  res.status(201).json({ ok: true, ad });
});

// PATCH /api/v1/ads/:id   (only while status=pending_payment)
const updateDraft = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');
  if (!ad.userId.equals(req.userId)) throw AppError.forbidden('not_owner');
  if (ad.status !== 'pending_payment') {
    throw AppError.badRequest('not_editable', 'Ad can only be edited before payment');
  }

  if (req.body.businessName !== undefined) {
    ad.businessName = v.requireString(req.body.businessName, 'businessName', { min: 1, max: 40 });
  }
  if (req.body.category !== undefined) {
    ad.category = v.requireEnum(req.body.category, 'category', AD_CATEGORY);
  }
  if (req.body.tagline !== undefined) {
    ad.tagline = v.optionalString(req.body.tagline, 'tagline', { max: 60 }) ?? '';
  }
  if (req.body.contactPhone !== undefined) {
    ad.contactPhone = req.body.contactPhone || null;
  }
  if (req.body.lat !== undefined && req.body.lng !== undefined) {
    ad.location = { type: 'Point', coordinates: v.requireLatLng(req.body.lat, req.body.lng) };
  }
  if (req.body.products !== undefined) {
    const products = normalizeProducts(req.body.products, ad.tier);
    if (products.length < 1) throw AppError.badRequest('no_products');
    ad.products = products;
  }

  await ad.save();
  res.json({ ok: true, ad });
});

// POST /api/v1/ads/:id/order
// Creates a (dummy) payment order. In production this returns the data the
// mobile app hands to the Razorpay SDK.
const createPaymentOrder = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');
  if (!ad.userId.equals(req.userId)) throw AppError.forbidden('not_owner');
  if (ad.status !== 'pending_payment') {
    throw AppError.badRequest('not_payable', 'Ad is not in a payable state');
  }

  const spec = AD_TIER_SPECS[ad.tier];
  const { payment, order } = await paymentService.createOrder({
    userId: req.userId,
    adId: ad._id,
    amountMinor: spec.priceMinor,
    notes: { tier: ad.tier, businessName: ad.businessName },
  });
  ad.paymentId = payment._id;
  await ad.save();

  res.json({ ok: true, payment, order });
});

// POST /api/v1/ads/:id/verify-payment
// body: { gatewayOrderId, gatewayPaymentId, gatewaySignature, method? }
// Stub: doesn't actually verify HMAC. Marks payment paid and flips ad live.
const verifyPaymentAndLaunch = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');
  if (!ad.userId.equals(req.userId)) throw AppError.forbidden('not_owner');

  const gatewayOrderId = v.requireString(req.body?.gatewayOrderId, 'gatewayOrderId', { min: 5 });
  const payment = await paymentService.verifyPayment({
    gatewayOrderId,
    gatewayPaymentId: req.body?.gatewayPaymentId,
    gatewaySignature: req.body?.gatewaySignature,
    method: req.body?.method || 'upi',
  });
  if (!payment.adId || !payment.adId.equals(ad._id)) {
    throw AppError.badRequest('payment_mismatch', 'Payment is not for this ad');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + AD_TIER_SPECS[ad.tier].durationHours * 3600_000);
  ad.status = 'live';
  ad.startsAt = now;
  ad.expiresAt = expiresAt;
  ad.paymentId = payment._id;
  await ad.save();

  res.json({ ok: true, ad, payment });
});

// GET /api/v1/ads/mine?status=live|completed|all
const listMyAds = asyncHandler(async (req, res) => {
  const status = req.query.status || 'all';
  const filter = { userId: req.userId };
  if (status === 'live') {
    filter.status = 'live';
    filter.expiresAt = { $gt: new Date() };
  } else if (status === 'completed') {
    filter.$or = [
      { status: { $in: ['expired', 'refunded', 'removed'] } },
      { status: 'live', expiresAt: { $lte: new Date() } },
    ];
  } else if (status !== 'all') {
    throw AppError.badRequest('invalid_status');
  }
  const ads = await Ad.find(filter).sort({ createdAt: -1 }).limit(100);
  res.json({ ok: true, ads });
});

// GET /api/v1/ads/:id   (advertiser fetches their own ad with full detail)
const getMyAd = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');
  if (!ad.userId.equals(req.userId)) throw AppError.forbidden('not_owner');
  res.json({ ok: true, ad });
});

// GET /api/v1/ads/:id/analytics
// Returns per-day rollups + a quick summary derived from raw events when the
// rollup hasn't run yet.
const getAnalytics = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');
  if (!ad.userId.equals(req.userId)) throw AppError.forbidden('not_owner');

  const [daily, summary] = await Promise.all([
    AdAnalyticsDaily.find({ adId: id }).sort({ date: 1 }),
    AdEvent.aggregate([
      { $match: { adId: ad._id } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          uniques: { $addToSet: '$viewerId' },
        },
      },
    ]),
  ]);

  const totals = {
    views: 0,
    uniqueReach: 0,
    thumbsUp: 0,
    wantToVisit: 0,
    profileTaps: 0,
    contactTaps: 0,
    shares: 0,
    productSwipes: 0,
  };
  for (const row of summary) {
    const uniques = row.uniques.filter(Boolean).length;
    if (row._id === 'view') {
      totals.views += row.count;
      totals.uniqueReach = uniques;
    } else if (row._id === 'thumbs_up') totals.thumbsUp = row.count;
    else if (row._id === 'want_to_visit') totals.wantToVisit = row.count;
    else if (row._id === 'profile_tap') totals.profileTaps = row.count;
    else if (row._id === 'contact_tap') totals.contactTaps = row.count;
    else if (row._id === 'share') totals.shares = row.count;
    else if (row._id === 'product_swipe') totals.productSwipes = row.count;
  }

  res.json({ ok: true, ad, totals, daily });
});

// ------------------------------- viewer side -------------------------------

// GET /api/v1/ads/feed?lat=&lng=
// Returns live ads whose own radius circle contains the viewer's point.
const feed = asyncHandler(async (req, res) => {
  const coords = v.requireLatLng(req.query.lat, req.query.lng);

  // We don't know each ad's per-doc radius at query time, so we fetch all
  // candidates within the largest possible radius (Pro tier = 1km) plus a
  // safety margin and filter in app. Volume is low — Atlas free tier handles
  // it fine, and we can move this to a precomputed grid later if needed.
  const ads = await Ad.find({
    status: 'live',
    expiresAt: { $gt: new Date() },
    location: {
      $geoWithin: {
        $centerSphere: [coords, 2000 / EARTH_RADIUS_M], // 2km outer bound
      },
    },
  })
    .select('userId tier businessName category tagline location radiusMeters products contactPhone expiresAt')
    .limit(100);

  const [lng, lat] = coords;
  const within = ads.filter((ad) => {
    const [alng, alat] = ad.location.coordinates;
    const meters = haversineMeters(lat, lng, alat, alng);
    return meters <= ad.radiusMeters;
  });

  res.json({ ok: true, ads: within });
});

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// POST /api/v1/ads/:id/view   (auth optional — anonymous views still count)
const recordView = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad || ad.status !== 'live') throw AppError.notFound('ad_not_found');

  await AdEvent.create({
    adId: ad._id,
    viewerId: req.userId || null,
    type: 'view',
  });
  res.json({ ok: true });
});

// POST /api/v1/ads/:id/swipe   body: { productIndex }
const recordSwipe = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const productIndex = v.requireNumber(req.body?.productIndex, 'productIndex', {
    min: 0, max: 5, integer: true,
  });
  const ad = await Ad.findById(id);
  if (!ad || ad.status !== 'live') throw AppError.notFound('ad_not_found');

  await AdEvent.create({
    adId: ad._id,
    viewerId: req.userId || null,
    type: 'product_swipe',
    productIndex,
  });
  res.json({ ok: true });
});

// POST /api/v1/ads/:id/thumbs-up   (authed)
const thumbsUp = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad || ad.status !== 'live') throw AppError.notFound('ad_not_found');

  // Idempotent: only one thumbs-up per viewer per ad.
  const existing = await AdEvent.findOne({ adId: id, viewerId: req.userId, type: 'thumbs_up' });
  if (!existing) {
    await AdEvent.create({ adId: id, viewerId: req.userId, type: 'thumbs_up' });
  }
  res.json({ ok: true });
});

// POST /api/v1/ads/:id/want-to-visit
const addWantToVisit = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');

  await WantToVisit.updateOne(
    { userId: req.userId, adId: id },
    { $setOnInsert: { userId: req.userId, adId: id } },
    { upsert: true },
  );
  await AdEvent.create({ adId: id, viewerId: req.userId, type: 'want_to_visit' });
  res.json({ ok: true });
});

// DELETE /api/v1/ads/:id/want-to-visit
const removeWantToVisit = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  await WantToVisit.deleteOne({ userId: req.userId, adId: id });
  res.json({ ok: true });
});

// GET /api/v1/me/want-to-visit
const listWantToVisit = asyncHandler(async (req, res) => {
  const items = await WantToVisit.find({ userId: req.userId })
    .sort({ savedAt: -1 })
    .populate({
      path: 'adId',
      select: 'businessName category tagline location products status expiresAt',
    });
  res.json({ ok: true, items });
});

// POST /api/v1/ads/:id/contact
const recordContactTap = asyncHandler(async (req, res) => {
  const id = v.requireObjectId(req.params.id, 'id');
  const ad = await Ad.findById(id);
  if (!ad) throw AppError.notFound('ad_not_found');
  await AdEvent.create({ adId: id, viewerId: req.userId || null, type: 'contact_tap' });
  res.json({ ok: true, phone: ad.contactPhone });
});

module.exports = {
  // advertiser
  createDraft,
  updateDraft,
  createPaymentOrder,
  verifyPaymentAndLaunch,
  listMyAds,
  getMyAd,
  getAnalytics,
  // viewer
  feed,
  recordView,
  recordSwipe,
  thumbsUp,
  addWantToVisit,
  removeWantToVisit,
  listWantToVisit,
  recordContactTap,
};
