const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect }  = require('../middleware/auth');
const protectAdmin = require('../middleware/adminAuth').protectAdmin;
const {
  listCategories, createCategory, updateCategory, deleteCategory,
  listExpenses, createExpense, updateExpense, deleteExpense,
  summary, exportExcel,
} = require('../controllers/expenseController');

// Multer: memory storage for receipt uploads (image + PDF)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WebP, and PDF files are allowed'));
  },
});

// All routes admin-only
router.use(protect, protectAdmin);

// Categories
router.get('/categories',         listCategories);
router.post('/categories',        createCategory);
router.put('/categories/:id',     updateCategory);
router.delete('/categories/:id',  deleteCategory);

// Expenses
router.get('/',          listExpenses);
router.post('/',         upload.single('receiptFile'), createExpense);
router.get('/summary',   summary);
router.get('/export',    exportExcel);
router.put('/:id',       upload.single('receiptFile'), updateExpense);
router.delete('/:id',    deleteExpense);

module.exports = router;
