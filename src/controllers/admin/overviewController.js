const asyncHandler = require('../../utils/asyncHandler');

const User = require('../../models/User');
const Activity = require('../../models/Activity');
const Ad = require('../../models/Ad');
const Payment = require('../../models/Payment');
const Report = require('../../models/Report');
const Appeal = require('../../models/Appeal');
const Ban = require('../../models/Ban');
const AnalyticsSnapshot = require('../../models/AnalyticsSnapshot');

function startOfTodayIst() {
  // IST is UTC+5:30 with no DST.
  const now = Date.now();
  const istOffsetMs = 5.5 * 3600_000;
  const istNow = new Date(now + istOffsetMs);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - istOffsetMs);
}

// GET /api/admin/v1/overview
const overview = asyncHandler(async (_req, res) => {
  const now = new Date();
  const startToday = startOfTodayIst();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
  const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);

  const [
    activeNow,
    activePings,
    activeAds,
    todaysRevenue,
    newSignups7d,
    pingsCreated7d,
    adsLaunched7d,
    reportsSubmitted7d,
    bansIssued7d,
    pendingReports,
    pendingAppeals,
  ] = await Promise.all([
    User.countDocuments({ lastActiveAt: { $gte: fiveMinAgo } }),
    Activity.countDocuments({ status: 'live', expiresAt: { $gt: now } }),
    Ad.countDocuments({ status: 'live', expiresAt: { $gt: now } }),
    Payment.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: startToday } } },
      { $group: { _id: null, sum: { $sum: '$amountMinor' } } },
    ]),
    User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Activity.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Ad.countDocuments({ createdAt: { $gte: sevenDaysAgo }, status: { $ne: 'pending_payment' } }),
    Report.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Ban.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    Report.countDocuments({ status: { $in: ['pending', 'escalated'] } }),
    Appeal.countDocuments({ status: { $in: ['pending', 'info_requested'] } }),
  ]);

  res.json({
    ok: true,
    live: {
      activeNow,
      activePings,
      activeAds,
      todaysRevenueMinor: todaysRevenue[0]?.sum || 0,
    },
    last7d: {
      newSignups: newSignups7d,
      pingsCreated: pingsCreated7d,
      adsLaunched: adsLaunched7d,
      reportsSubmitted: reportsSubmitted7d,
      bansIssued: bansIssued7d,
    },
    queues: { pendingReports, pendingAppeals },
  });
});

// GET /api/admin/v1/analytics?days=30
const analytics = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
  const since = new Date(Date.now() - days * 86400_000);

  // Pre-aggregated snapshots are populated by the nightly cron job. If
  // they're missing (job hasn't run), the response is still valid — the
  // mobile-side charts will just be empty.
  const snapshots = await AnalyticsSnapshot
    .find({ date: { $gte: since.toISOString().slice(0, 10) } })
    .sort({ date: 1 });

  const tierBreakdown = await Ad.aggregate([
    { $match: { status: { $in: ['live', 'expired'] }, createdAt: { $gte: since } } },
    { $group: { _id: '$tier', count: { $sum: 1 } } },
  ]);

  res.json({ ok: true, days, snapshots, tierBreakdown });
});

// GET /api/admin/v1/audit-logs?action=&adminId=&from=&to=&page=
const auditLogs = asyncHandler(async (req, res) => {
  const AuditLog = require('../../models/AuditLog');
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

  const where = {};
  if (req.query.action) where.action = req.query.action;
  if (req.query.adminId) where.adminId = req.query.adminId;
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    AuditLog.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AuditLog.countDocuments(where),
  ]);

  res.json({ ok: true, items, page, limit, total });
});

module.exports = { overview, analytics, auditLogs };
