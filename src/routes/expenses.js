const express = require('express');
const router  = express.Router();
const { protect }  = require('../middleware/auth');
const protectAdmin = require('../middleware/adminAuth').protectAdmin;
const {
  listCategories, createCategory, updateCategory, deleteCategory,
  listExpenses, createExpense, updateExpense, deleteExpense,
  summary, exportExcel,
} = require('../controllers/expenseController');

// All routes admin-only
router.use(protect, protectAdmin);

// Categories
router.get('/categories',         listCategories);
router.post('/categories',        createCategory);
router.put('/categories/:id',     updateCategory);
router.delete('/categories/:id',  deleteCategory);

// Expenses
router.get('/',          listExpenses);
router.post('/',         createExpense);
router.get('/summary',   summary);
router.get('/export',    exportExcel);
router.put('/:id',       updateExpense);
router.delete('/:id',    deleteExpense);

module.exports = router;
