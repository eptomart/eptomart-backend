// ============================================
// CONVERSATIONS ROUTES
// User ↔ Admin  and  Seller ↔ Admin messaging
// ============================================
const express       = require('express');
const router        = express.Router();
const Conversation  = require('../models/Conversation');
const Seller        = require('../models/Seller');
const { protect }   = require('../middleware/auth');
const { protectAdmin } = require('../middleware/adminAuth');

// ── Seller middleware (seller or admin) ───────
const protectSeller = [
  protect,
  (req, res, next) => {
    if (['seller', 'admin', 'superAdmin'].includes(req.user.role)) return next();
    return res.status(403).json({ success: false, message: 'Seller access required' });
  },
];

// ─────────────────────────────────────────────
// USER ROUTES  (requires login)
// ─────────────────────────────────────────────

// GET /conversations/mine — list my conversations
router.get('/mine', protect, async (req, res) => {
  try {
    const convs = await Conversation.find({
      participantId:   req.user._id,
      participantType: 'user',
    }).select('-messages').sort({ lastMessageAt: -1 });
    res.json({ success: true, conversations: convs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /conversations — start a new conversation (user)
router.post('/', protect, async (req, res) => {
  try {
    const { subject, content } = req.body;
    if (!subject || !content) return res.status(400).json({ success: false, message: 'Subject and message are required' });

    const conv = await Conversation.create({
      participantType:  'user',
      participantId:    req.user._id,
      participantName:  req.user.name,
      participantEmail: req.user.email,
      subject,
      status: 'open',
      unreadByAdmin: 1,
      lastMessageAt: new Date(),
      messages: [{
        senderType: 'participant',
        senderName: req.user.name,
        content,
      }],
    });
    res.status(201).json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /conversations/:id — get conversation with messages (user)
router.get('/:id', protect, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (conv.participantType === 'user' && conv.participantId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    // Mark as read by participant
    conv.unreadByParticipant = 0;
    await conv.save();
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /conversations/:id/reply — participant replies (user)
router.post('/:id/reply', protect, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (conv.participantType === 'user' && conv.participantId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (conv.status === 'closed') return res.status(400).json({ success: false, message: 'Conversation is closed' });

    conv.messages.push({ senderType: 'participant', senderName: req.user.name, content });
    conv.unreadByAdmin       += 1;
    conv.unreadByParticipant  = 0;
    conv.lastMessageAt        = new Date();
    await conv.save();
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// SELLER ROUTES
// ─────────────────────────────────────────────

// GET /conversations/seller/mine — seller's conversations
router.get('/seller/mine', protectSeller, async (req, res) => {
  try {
    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });

    const convs = await Conversation.find({
      participantId:   seller._id,
      participantType: 'seller',
    }).select('-messages').sort({ lastMessageAt: -1 });
    res.json({ success: true, conversations: convs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /conversations/seller — start a conversation (seller)
router.post('/seller', protectSeller, async (req, res) => {
  try {
    const { subject, content } = req.body;
    if (!subject || !content) return res.status(400).json({ success: false, message: 'Subject and message are required' });

    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) return res.status(404).json({ success: false, message: 'Seller profile not found' });

    const conv = await Conversation.create({
      participantType:  'seller',
      participantId:    seller._id,
      participantName:  seller.businessName || req.user.name,
      participantEmail: seller.email || req.user.email,
      subject,
      status: 'open',
      unreadByAdmin: 1,
      lastMessageAt: new Date(),
      messages: [{
        senderType: 'participant',
        senderName: seller.businessName || req.user.name,
        content,
      }],
    });
    res.status(201).json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /conversations/seller/:id — get seller conversation
router.get('/seller/:id', protectSeller, async (req, res) => {
  try {
    const seller = await Seller.findOne({ user: req.user._id });
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (seller && conv.participantId.toString() !== seller._id.toString()) {
      if (!['admin','superAdmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    conv.unreadByParticipant = 0;
    await conv.save();
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /conversations/seller/:id/reply — seller replies
router.post('/seller/:id/reply', protectSeller, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

    const seller = await Seller.findOne({ user: req.user._id });
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    if (seller && conv.participantId.toString() !== seller._id.toString()) {
      if (!['admin','superAdmin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    if (conv.status === 'closed') return res.status(400).json({ success: false, message: 'Conversation is closed' });

    conv.messages.push({ senderType: 'participant', senderName: seller?.businessName || req.user.name, content });
    conv.unreadByAdmin       += 1;
    conv.unreadByParticipant  = 0;
    conv.lastMessageAt        = new Date();
    await conv.save();
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────

// GET /conversations/admin/all — all conversations
router.get('/admin/all', ...protectAdmin, async (req, res) => {
  try {
    const { type, status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (type)   filter.participantType = type;
    if (status) filter.status          = status;

    const convs = await Conversation.find(filter)
      .select('-messages')
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Conversation.countDocuments(filter);
    const totalUnread = await Conversation.aggregate([
      { $group: { _id: null, total: { $sum: '$unreadByAdmin' } } },
    ]);

    res.json({
      success: true,
      conversations: convs,
      total,
      unreadTotal: totalUnread[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /conversations/admin/:id — get conversation (admin)
router.get('/admin/:id', ...protectAdmin, async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });
    conv.unreadByAdmin = 0;
    await conv.save();
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /conversations/admin/:id/reply — admin replies
router.post('/admin/:id/reply', ...protectAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

    const conv = await Conversation.findById(req.params.id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });

    conv.messages.push({ senderType: 'admin', senderName: req.user.name || 'Admin', content });
    conv.unreadByParticipant += 1;
    conv.unreadByAdmin        = 0;
    conv.lastMessageAt        = new Date();
    await conv.save();
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /conversations/admin/:id/status — open or close
router.patch('/admin/:id/status', ...protectAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open','closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const conv = await Conversation.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
