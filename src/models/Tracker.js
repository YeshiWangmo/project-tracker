import mongoose from "mongoose";

const TrackerSchema = new mongoose.Schema({
  id: { type: Number, required: true }, // Removed 'unique: true' to prevent auto-save crashes
  userId: { type: String, required: true },
  userEmail: { type: String, required: true },
  name: { type: String, required: true },
  
  // Changed from 'Mixed' to 'Array' so Mongoose actually tracks your changes
  rows: { type: Array, default: [] },
  dueTypes: { type: Array, default: [] },
  reportCols: { type: Array, default: [] },
  emailCols: { type: Array, default: [] }
}, { timestamps: true, strict: false }); // 'strict: false' is the magic key for dynamic rows

export default mongoose.models.Tracker || mongoose.model("Tracker", TrackerSchema);
