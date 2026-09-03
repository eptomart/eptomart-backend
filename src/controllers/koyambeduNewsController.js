// ============================================
// KOYAMBEDU NEWS — Controller
// Public read (no login gate — news isn't a lead-gen surface like Bulk
// Harvest), admin-managed create/edit/delete/verify.
// ============================================
const KoyambeduNewsPost = require('../models/KoyambeduNewsPost');

// ══════════════════════════════════════════════
// PUBLIC
// ══════════════════════════════════════════════

/** GET /koyambedu/news — active posts, newest first */
const listActive = async (req, res) => {
  try {
    const posts = await KoyambeduNewsPost.find({ status: 'active' }).sort({ createdAt: -1 });
    res.json({ success: true, posts });
  } catch (err) {
    console.error('[koyambeduNews.listActive]', err);
    res.status(500).json({ success: false, message: 'Failed to load news' });
  }
};

// ══════════════════════════════════════════════
// SUPER ADMIN
// ══════════════════════════════════════════════

const adminList = async (req, res) => {
  try {
    const posts = await KoyambeduNewsPost.find().sort({ createdAt: -1 });
    res.json({ success: true, posts });
  } catch (err) {
    console.error('[koyambeduNews.adminList]', err);
    res.status(500).json({ success: false, message: 'Failed to load news' });
  }
};

/** POST /koyambedu/news/admin — create, one image via uploadKoyambeduNews.single('image') */
const adminCreate = async (req, res) => {
  try {
    const { title, summary, sourceName, sourceUrl } = req.body;
    if (!title || !summary || !sourceName) {
      return res.status(400).json({ success: false, message: 'Title, summary and source are required' });
    }
    const image = req.file ? { url: req.file.path, publicId: req.file.filename } : { url: null, publicId: null };

    const post = await KoyambeduNewsPost.create({
      title, summary, sourceName, sourceUrl: sourceUrl || '',
      image,
      createdBy: req.user._id,
      createdByName: req.user.name,
    });
    res.json({ success: true, post });
  } catch (err) {
    console.error('[koyambeduNews.adminCreate]', err);
    res.status(500).json({ success: false, message: 'Failed to create news post' });
  }
};

/** PUT /koyambedu/news/admin/:id */
const adminUpdate = async (req, res) => {
  try {
    const post = await KoyambeduNewsPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const { title, summary, sourceName, sourceUrl } = req.body;
    if (title != null) post.title = title;
    if (summary != null) post.summary = summary;
    if (sourceName != null) post.sourceName = sourceName;
    if (sourceUrl != null) post.sourceUrl = sourceUrl;
    if (req.file) post.image = { url: req.file.path, publicId: req.file.filename };

    // Editing the source resets the verified flag — admin should re-check
    // before re-verifying a post whose citation just changed.
    if (sourceName != null || sourceUrl != null) {
      post.verified = false;
      post.verifiedBy = null;
      post.verifiedByName = null;
      post.verifiedAt = null;
    }

    await post.save();
    res.json({ success: true, post });
  } catch (err) {
    console.error('[koyambeduNews.adminUpdate]', err);
    res.status(500).json({ success: false, message: 'Failed to update news post' });
  }
};

/** PATCH /koyambedu/news/admin/:id/verify */
const adminSetVerified = async (req, res) => {
  try {
    const { verified } = req.body;
    const update = verified
      ? { verified: true, verifiedBy: req.user._id, verifiedByName: req.user.name, verifiedAt: new Date() }
      : { verified: false, verifiedBy: null, verifiedByName: null, verifiedAt: null };
    const post = await KoyambeduNewsPost.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, post });
  } catch (err) {
    console.error('[koyambeduNews.adminSetVerified]', err);
    res.status(500).json({ success: false, message: 'Failed to update verification' });
  }
};

/** PATCH /koyambedu/news/admin/:id/status */
const adminSetStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const post = await KoyambeduNewsPost.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, post });
  } catch (err) {
    console.error('[koyambeduNews.adminSetStatus]', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

/** DELETE /koyambedu/news/admin/:id */
const adminDelete = async (req, res) => {
  try {
    await KoyambeduNewsPost.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[koyambeduNews.adminDelete]', err);
    res.status(500).json({ success: false, message: 'Failed to delete news post' });
  }
};

module.exports = { listActive, adminList, adminCreate, adminUpdate, adminSetVerified, adminSetStatus, adminDelete };
