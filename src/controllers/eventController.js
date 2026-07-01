const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const v = require('../utils/validate');
const Event = require('../models/Event');

// ── User-facing ───────────────────────────────────────────────────────────────

// GET /api/v1/events?lat=&lng=&radius=5000&category=
const list = asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(parseInt(req.query.radius ?? '10000', 10), 50000);
  const category = req.query.category;

  const now = new Date();
  const query = { isActive: true, endDate: { $gte: now } };

  if (category && ['offer', 'event'].includes(category)) {
    query.category = category;
  }

  if (!isNaN(lat) && !isNaN(lng)) {
    query.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radius,
      },
    };
  }

  const events = await Event.find(query).sort({ startDate: 1 }).limit(30).lean();
  res.json({ ok: true, events });
});

// GET /api/v1/events/:id
const getById = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id).lean();
  if (!event) throw AppError.notFound('not_found', 'Event not found');
  res.json({ ok: true, event });
});

// ── Admin-facing ──────────────────────────────────────────────────────────────

// GET /api/admin/v1/events
const adminList = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
  const limit = 20;
  const total = await Event.countDocuments();
  const events = await Event.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  res.json({ ok: true, events, total, page });
});

// POST /api/admin/v1/events
const adminCreate = asyncHandler(async (req, res) => {
  const title = v.requireString(req.body.title, 'title', { min: 1, max: 80 });
  const description = req.body.description ? String(req.body.description).slice(0, 500) : '';
  const imageUrl = req.body.imageUrl ? String(req.body.imageUrl) : null;
  const venueName = req.body.venueName ? String(req.body.venueName).slice(0, 100) : null;
  const venueAddress = req.body.venueAddress ? String(req.body.venueAddress).slice(0, 200) : null;
  const category = ['offer', 'event'].includes(req.body.category) ? req.body.category : 'event';
  const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
  const endDate = req.body.endDate ? new Date(req.body.endDate) : null;
  if (!startDate || isNaN(startDate.getTime())) throw AppError.badRequest('invalid_start', 'startDate is required');
  if (!endDate || isNaN(endDate.getTime())) throw AppError.badRequest('invalid_end', 'endDate is required');
  if (endDate <= startDate) throw AppError.badRequest('invalid_dates', 'endDate must be after startDate');

  const tags = Array.isArray(req.body.tags) ? req.body.tags.slice(0, 10).map(String) : [];

  let location = null;
  if (req.body.lat !== undefined && req.body.lng !== undefined) {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      location = { type: 'Point', coordinates: [lng, lat] };
    }
  }

  const event = await Event.create({
    title,
    description,
    imageUrl,
    venueName,
    venueAddress,
    location,
    category,
    startDate,
    endDate,
    tags,
    isActive: req.body.isActive !== false,
    createdByAdmin: req.adminId ?? null,
  });

  res.status(201).json({ ok: true, event });
});

// PUT /api/admin/v1/events/:id
const adminUpdate = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) throw AppError.notFound('not_found', 'Event not found');

  if (req.body.title !== undefined) event.title = v.requireString(req.body.title, 'title', { min: 1, max: 80 });
  if (req.body.description !== undefined) event.description = String(req.body.description).slice(0, 500);
  if (req.body.imageUrl !== undefined) event.imageUrl = req.body.imageUrl || null;
  if (req.body.venueName !== undefined) event.venueName = req.body.venueName ? String(req.body.venueName).slice(0, 100) : null;
  if (req.body.venueAddress !== undefined) event.venueAddress = req.body.venueAddress ? String(req.body.venueAddress).slice(0, 200) : null;
  if (req.body.category !== undefined && ['offer', 'event'].includes(req.body.category)) event.category = req.body.category;
  if (req.body.startDate !== undefined) { const d = new Date(req.body.startDate); if (!isNaN(d.getTime())) event.startDate = d; }
  if (req.body.endDate !== undefined) { const d = new Date(req.body.endDate); if (!isNaN(d.getTime())) event.endDate = d; }
  if (req.body.isActive !== undefined) event.isActive = !!req.body.isActive;
  if (req.body.tags !== undefined) event.tags = Array.isArray(req.body.tags) ? req.body.tags.slice(0, 10).map(String) : [];
  if (req.body.lat !== undefined && req.body.lng !== undefined) {
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    event.location = (!isNaN(lat) && !isNaN(lng)) ? { type: 'Point', coordinates: [lng, lat] } : null;
  }

  await event.save();
  res.json({ ok: true, event });
});

// DELETE /api/admin/v1/events/:id
const adminDelete = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) throw AppError.notFound('not_found', 'Event not found');
  await event.deleteOne();
  res.json({ ok: true });
});

module.exports = { list, getById, adminList, adminCreate, adminUpdate, adminDelete };
