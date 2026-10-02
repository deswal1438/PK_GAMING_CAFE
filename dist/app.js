const SERVICES = {
  ps5: { label: "PlayStation 5", prices: { 30: 199, 60: 299 }, resources: ["PS5-01", "PS5-02"] },
  racing: { label: "Racing simulator", prices: { 30: 299, 60: 499 }, resources: ["RACING-01"] },
  ps5vr: { label: "PS5 + VR experience", prices: { 30: 299, 60: 499 }, resources: ["PS5-VR-01"] },
  meta: { label: "Meta VR cricket", prices: { 30: 349, 60: 599 }, resources: ["META-VR-01"] }
};

const form = document.querySelector("#booking-form");
const serviceInput = document.querySelector("#service");
const durationInput = document.querySelector("#duration");
const resourceInput = document.querySelector("#resource");
const dateInput = document.querySelector("#date");
const timeInput = document.querySelector("#startTime");
const pricePreview = document.querySelector("#price-preview");
const note = document.querySelector("#form-note");
const toast = document.querySelector("#toast");

const localBookings = () => JSON.parse(localStorage.getItem("pk-bookings") || "[]");
const saveBookings = (bookings) => localStorage.setItem("pk-bookings", JSON.stringify(bookings));

function formatINR(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 4600);
}

function makeTimeOptions() {
  const options = [];
  for (let hour = 11; hour <= 22; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === 22 && minute > 0) continue;
      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const readable = new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
      options.push(`<option value="${value}">${readable}</option>`);
    }
  }
  timeInput.innerHTML = options.join("");
}

function syncResources() {
  const service = SERVICES[serviceInput.value];
  resourceInput.innerHTML = service.resources.map((resource) => `<option value="${resource}">${resource}</option>`).join("");
  updatePrice();
}

function updatePrice() {
  const service = SERVICES[serviceInput.value];
  pricePreview.textContent = formatINR(service.prices[durationInput.value]);
}

function setMinimumDate() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  dateInput.min = localDate;
  dateInput.value = localDate;
}

function toMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function hasOverlap(candidate, bookings) {
  const start = toMinutes(candidate.startTime);
  const end = start + Number(candidate.duration);
  return bookings.some((booking) => {
    if (booking.date !== candidate.date || booking.resource !== candidate.resource || booking.bookingStatus === "CANCELLED") return false;
    const otherStart = toMinutes(booking.startTime);
    const otherEnd = otherStart + Number(booking.duration);
    return start < otherEnd && otherStart < end;
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const booking = {
    bookingId: `PK-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customerName: String(data.get("customerName") || "").trim(),
    phone: String(data.get("phone") || "").replace(/\D/g, ""),
    resource: String(data.get("resource") || ""),
    service: String(data.get("service") || ""),
    date: String(data.get("date") || ""),
    startTime: String(data.get("startTime") || ""),
    duration: Number(data.get("duration") || 0),
    amount: SERVICES[String(data.get("service") || "")]?.prices[Number(data.get("duration") || 0)] || 0,
    bookingStatus: "PENDING",
    paymentStatus: "PENDING",
    createdAt: new Date().toISOString()
  };

  if (booking.customerName.length < 2 || booking.phone.length < 10 || booking.phone.length > 13) {
    note.textContent = "Please enter a valid name and 10-digit mobile number.";
    note.style.color = "#ff7180";
    showToast("Check your name and mobile number.");
    return;
  }
  if (booking.amount === 0 || !booking.date || !booking.startTime || !booking.resource) {
    note.textContent = "Please complete every booking field.";
    note.style.color = "#ff7180";
    return;
  }
  const bookings = localBookings();
  if (hasOverlap(booking, bookings)) {
    note.textContent = "That rig is already booked for this time. Please choose another slot.";
    note.style.color = "#ff7180";
    showToast("Overlap blocked — choose another rig or time.");
    return;
  }

  bookings.unshift(booking);
  saveBookings(bookings);
  note.textContent = `Request ${booking.bookingId} saved. The cafe will confirm it on WhatsApp.`;
  note.style.color = "#86f2a3";
  showToast(`Booking request ${booking.bookingId} created.`);
  form.reset();
  setMinimumDate();
  syncResources();
});

serviceInput.addEventListener("change", syncResources);
durationInput.addEventListener("change", updatePrice);
makeTimeOptions();
setMinimumDate();
syncResources();
