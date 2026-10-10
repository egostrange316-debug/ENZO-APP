const mongoose = require('mongoose');
const { LEVELS } = require('../config/curriculum');

/**
 * Katta kitobni (masalan Key Words for Fluency) bo'limlarga va kunlarga bo'lib yuklash rejasi.
 * Har bo'lim: kitob sahifalari (from..to) va nechta kunga bo'linishi (days). Har bo'lim `days` ta teng qismga
 * kesiladi, har qism alohida BookMaterial (to'plam) bo'ladi va keyin daraja kunlariga ketma-ket joylanadi.
 */
const bookPlanSchema = new mongoose.Schema(
  {
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    level: { type: String, enum: LEVELS, required: true },
    page_offset: { type: Number, default: 1 }, // PDF sahifa = kitob sahifa + page_offset
    sections: [
      {
        _id: false,
        title: String,
        from_page: Number,
        to_page: Number,
        days: Number,
      },
    ],
    status: { type: String, enum: ['splitting', 'running', 'failed'], default: 'splitting' },
    error_message: String,
    total_sets: { type: Number, default: 0 },
    original_path: String, // qayta urinish uchun (server diskida; Render qayta ishga tushsa yo'qolishi mumkin)
  },
  { timestamps: true }
);

module.exports = mongoose.model('BookPlan', bookPlanSchema);
