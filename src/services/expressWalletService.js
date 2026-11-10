// Express customer wallet: atomic credit / capped debit. Never goes negative.
const ExpressWallet = require('../models/ExpressWallet');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function getBalance(userId) {
  const w = await ExpressWallet.findOne({ user: userId }).select('balance').lean();
  return r2(w?.balance || 0);
}

async function credit(userId, amount, category, { orderId, orderRef, note } = {}) {
  const amt = r2(amount);
  if (!(amt > 0)) return null;
  const doc = await ExpressWallet.findOneAndUpdate(
    { user: userId }, { $inc: { balance: amt }, $setOnInsert: { user: userId } }, { upsert: true, new: true }
  );
  await ExpressWallet.updateOne({ user: userId }, { $push: { transactions: { type: 'credit', category, amount: amt, orderId, orderRef, note, balanceAfter: r2(doc.balance), at: new Date() } } });
  return r2(doc.balance);
}

// Debit up to `amount` (whatever is available). Returns the amount actually debited.
async function debitUpTo(userId, amount, category, { orderId, orderRef, note } = {}) {
  const want = r2(amount);
  if (!(want > 0)) return 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const bal = await getBalance(userId);
    const take = r2(Math.min(bal, want));
    if (!(take > 0)) return 0;
    const doc = await ExpressWallet.findOneAndUpdate({ user: userId, balance: { $gte: take } }, { $inc: { balance: -take } }, { new: true });
    if (doc) {
      await ExpressWallet.updateOne({ user: userId }, { $push: { transactions: { type: 'debit', category, amount: take, orderId, orderRef, note, balanceAfter: r2(doc.balance), at: new Date() } } });
      return take;
    }
  }
  return 0;
}

module.exports = { getBalance, credit, debitUpTo, r2 };
