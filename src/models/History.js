import mongoose from "mongoose";

const HistorySchema = new mongoose.Schema({
  id: { type: Number },
  recipient: { type: String },
  project: { type: String },
  type: { type: String },
  timestamp: { type: String },
  user: { type: String }
}, { timestamps: true, strict: false }); // strict: false prevents crashes!

export default mongoose.models.History || mongoose.model("History", HistorySchema);