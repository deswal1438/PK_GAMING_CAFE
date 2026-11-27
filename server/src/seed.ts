import "node:process";
import mongoose from "mongoose";
import { Resource, Service } from "./models.js";

const resources = [
  { code: "PS5-01", name: "PlayStation 5 · Rig 1", type: "PS5" },
  { code: "PS5-02", name: "PlayStation 5 · Rig 2", type: "PS5" },
  { code: "RACING-01", name: "Racing Simulator", type: "RACING" },
  { code: "PS5-VR-01", name: "PS5 + VR", type: "PS5_VR" },
  { code: "META-VR-01", name: "Meta VR Cricket", type: "VR" }
] as const;

const services = [
  { slug: "ps5", name: "PlayStation 5", resourceType: "PS5", prices: { "30": 199, "60": 299 } },
  { slug: "racing", name: "Racing Simulator", resourceType: "RACING", prices: { "30": 299, "60": 499 } },
  { slug: "ps5vr", name: "PS5 + VR Experience", resourceType: "PS5_VR", prices: { "30": 299, "60": 499 } },
  { slug: "meta", name: "Meta VR Cricket", resourceType: "VR", prices: { "30": 349, "60": 599 } }
] as const;

const uri = process.env.MONGODB_URI || "";
if (!uri) throw new Error("MONGODB_URI is required");
await mongoose.connect(uri);

await Promise.all(resources.map((resource) => Resource.updateOne(
  { code: resource.code },
  { $set: { ...resource, active: true } },
  { upsert: true }
)));

await Promise.all(services.map((service) => Service.updateOne(
  { slug: service.slug },
  { $set: { ...service, active: true } },
  { upsert: true }
)));

console.log(`Seeded ${resources.length} resources and ${services.length} services.`);
await mongoose.disconnect();
