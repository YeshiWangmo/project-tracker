import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  id: { type: Number },
  username: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: "user" }
}, { timestamps: true });

export default mongoose.models.User || mongoose.model("User", UserSchema);