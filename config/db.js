const mongoose = require('mongoose');

// MongoDB bazasiga ulanish funksiyasi.
// server.js ichida bir marta chaqiriladi.
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB ulandi: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB ulanish xatosi: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
