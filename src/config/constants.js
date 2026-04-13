// ============================================
// APP CONSTANTS
// ============================================
module.exports = {
  // Order Status Flow
  ORDER_STATUS: {
    PLACED: 'placed',
    CONFIRMED: 'confirmed',
    PROCESSING: 'processing',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RETURNED: 'returned',
  },

  // Payment Status
  PAYMENT_STATUS: {
    PENDING: 'pending',
    PAID: 'paid',
    FAILED: 'failed',
    REFUNDED: 'refunded',
  },

  // Payment Methods
  PAYMENT_METHOD: {
    COD: 'cod',
    UPI: 'upi',
    RAZORPAY: 'razorpay',
    CASHFREE: 'cashfree',
    STRIPE: 'stripe',
  },

  // User Roles
  ROLES: {
    USER: 'user',
    ADMIN: 'admin',
  },

  // Shipping
  FREE_SHIPPING_THRESHOLD: 499, // INR
  SHIPPING_CHARGE: 49,           // INR
  GST_RATE: 0.05,                // 5%

  // Pagination
  DEFAULT_PAGE_SIZE: 12,
  MAX_PAGE_SIZE: 50,

  // Security
  MAX_OTP_ATTEMPTS: 5,
  MAX_LOGIN_HISTORY: 20,
  BCRYPT_SALT_ROUNDS: 12,

  // Image limits
  MAX_PRODUCT_IMAGES: 5,
  MAX_IMAGE_SIZE_MB: 5,
};
