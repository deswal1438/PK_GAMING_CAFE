import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema({
  name: { type: String, trim: true, required: true },
  phone: { type: String, trim: true, required: true, index: true },
  email: { type: String, trim: true, lowercase: true },
  role: { type: String, enum: ["CUSTOMER", "ADMIN"], default: "CUSTOMER" }
}, { timestamps: true });

const resourceSchema = new Schema({
  code: { type: String, trim: true, required: true, unique: true },
  name: { type: String, trim: true, required: true },
  type: { type: String, enum: ["PS5", "RACING", "VR", "PS5_VR"], required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const serviceSchema = new Schema({
  name: { type: String, trim: true, required: true },
  slug: { type: String, trim: true, required: true, unique: true },
  resourceType: { type: String, enum: ["PS5", "RACING", "VR", "PS5_VR"], required: true },
  prices: { type: Map, of: Number, required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const bookingSchema = new Schema({
  bookingId: { type: String, unique: true, required: true, index: true },
  customerName: { type: String, trim: true, required: true },
  phone: { type: String, trim: true, required: true, index: true },
  email: { type: String, trim: true, lowercase: true },
  resourceId: { type: Schema.Types.ObjectId, ref: "Resource", required: true },
  serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
  date: { type: String, required: true, index: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  duration: { type: Number, required: true, min: 15 },
  amount: { type: Number, required: true, min: 0 },
  bookingStatus: { type: String, enum: ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"], default: "PENDING" },
  paymentStatus: { type: String, enum: ["NOT_REQUIRED", "PENDING", "SUCCESS", "FAILED", "REFUNDED"], default: "PENDING" },
  paymentReference: { type: String, trim: true },
  notes: { type: String, trim: true, maxlength: 500 }
}, { timestamps: true });
bookingSchema.index({ resourceId: 1, date: 1, startTime: 1 });

const packageSchema = new Schema({
  name: { type: String, required: true },
  durationHours: { type: Number, required: true },
  amount: { type: Number, required: true },
  inclusions: [{ type: String }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

const blockedSlotSchema = new Schema({
  resourceId: { type: Schema.Types.ObjectId, ref: "Resource", required: true },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  reason: { type: String, trim: true }
}, { timestamps: true });

export type Booking = InferSchemaType<typeof bookingSchema>;
export const User = model("User", userSchema);
export const Resource = model("Resource", resourceSchema);
export const Service = model("Service", serviceSchema);
export const BookingModel = model("Booking", bookingSchema);
export const PackageModel = model("Package", packageSchema);
export const BlockedSlot = model("BlockedSlot", blockedSlotSchema);
