// ============================================
// WEBHOOK ROUTES — public (no auth)
// Base: /api/webhooks
// ============================================
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/whatsappWebhookController');

// Meta verification challenge (GET) + inbound messages (POST)
router.get ('/whatsapp', ctrl.verifyWebhook);
router.post('/whatsapp', ctrl.receiveWebhook);

module.exports = router;
