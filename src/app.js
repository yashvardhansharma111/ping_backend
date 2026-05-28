const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const v1Routes = require('./routes/v1');
const adminRoutes = require('./routes/admin');
const sanitize = require('./middleware/sanitize');
const errorHandler = require('./middleware/errorHandler');
const { notFoundHandler } = require('./middleware/errorHandler');
const paymentService = require('./services/paymentService');
const Payment = require('./models/Payment');
const Ad = require('./models/Ad');
const { AD_TIER_SPECS } = require('./utils/enums');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (env.CORS_ALLOWED_ORIGINS.length === 0) return cb(null, true);
        if (env.CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
  );

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  // ── Razorpay webhook (raw body — must come before express.json) ─────────────
  app.post(
    '/razorpay/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        const sig = req.headers['x-razorpay-signature'] || '';
        const payment = await paymentService.handleWebhookCapture(req.body, sig);
        if (payment) {
          // Flip the ad to live if not already
          const ad = await Ad.findOne({ paymentId: payment._id, status: { $ne: 'live' } });
          if (ad) {
            const now = new Date();
            ad.status = 'live';
            ad.startsAt = now;
            ad.expiresAt = new Date(now.getTime() + AD_TIER_SPECS[ad.tier].durationHours * 3_600_000);
            await ad.save();
          }
        }
        res.json({ ok: true });
      } catch (err) {
        console.error('[webhook]', err.message);
        res.status(err.status || 400).json({ ok: false, error: err.message });
      }
    },
  );

  // ── Hosted Razorpay checkout page (opened via expo-web-browser) ─────────────
  app.get('/pay', (req, res) => {
    const { orderId, amount, keyId, adId, name } = req.query;
    if (!orderId || !amount || !keyId) {
      return res.status(400).send('Missing required params');
    }
    const amountRupees = (parseInt(amount, 10) / 100).toFixed(2);
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pay for Ping Ad</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #080815;
      color: #F1F0FF;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      gap: 24px;
    }
    .card {
      background: #11112A;
      border: 1px solid rgba(167,139,250,0.2);
      border-radius: 20px;
      padding: 32px 28px;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }
    .logo { font-size: 28px; font-weight: 800; color: #A78BFA; margin-bottom: 8px; }
    .title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .sub { font-size: 14px; color: #9490C0; margin-bottom: 28px; }
    .amount { font-size: 36px; font-weight: 800; color: #F1F0FF; margin-bottom: 28px; }
    .amount span { font-size: 20px; vertical-align: super; }
    button {
      width: 100%;
      height: 52px;
      background: #7C3AED;
      color: #FFF;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(124,58,237,0.5);
    }
    button:active { opacity: 0.85; }
    button:disabled { opacity: 0.5; cursor: default; }
    #msg { font-size: 15px; color: #9490C0; min-height: 24px; margin-top: 8px; }
    .success { color: #22C55E; font-size: 20px; font-weight: 700; }
    .err { color: #EF4444; font-size: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Ping</div>
    <div class="title">Micro Ad — ${name ? decodeURIComponent(String(name)) : 'Your Business'}</div>
    <div class="sub">Hyperlocal ad on the Ping map</div>
    <div class="amount"><span>₹</span>${amountRupees}</div>
    <button id="payBtn" onclick="startPayment()">Pay ₹${amountRupees}</button>
    <div id="msg"></div>
  </div>
  <script>
    function startPayment() {
      var btn = document.getElementById('payBtn');
      var msg = document.getElementById('msg');
      btn.disabled = true;
      msg.textContent = 'Opening payment...';

      var options = {
        key: '${keyId}',
        amount: '${amount}',
        currency: 'INR',
        order_id: '${orderId}',
        name: 'Ping',
        description: 'Micro Ad — ${name ? decodeURIComponent(String(name)) : 'Ad'}',
        theme: { color: '#7C3AED' },
        modal: { backdropclose: false },
        handler: function(response) {
          msg.innerHTML = '<span class="success">Payment successful!</span><br><small style="color:#9490C0">Return to the Ping app to see your live ad.</small>';
          btn.style.display = 'none';
        },
        prefill: {},
      };
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(r) {
        msg.innerHTML = '<span class="err">Payment failed: ' + (r.error.description || 'Please try again.') + '</span>';
        btn.disabled = false;
      });
      rzp.open();
      msg.textContent = '';
    }
    // Auto-open on page load
    window.onload = function() { setTimeout(startPayment, 500); };
  </script>
</body>
</html>`);
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(sanitize);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ping-api', env: env.NODE_ENV });
  });

  app.use('/api/v1', v1Routes);
  app.use('/api/admin/v1', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = buildApp;
