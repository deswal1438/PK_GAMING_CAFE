const SERVICES = {
  ps5: { label: "PlayStation 5", prices: { 30: 199, 60: 299 }, resources: ["PS5-01", "PS5-02"] },
  racing: { label: "Racing simulator", prices: { 30: 299, 60: 499 }, resources: ["RACING-01"] },
  ps5vr: { label: "PS5 + VR experience", prices: { 30: 299, 60: 499 }, resources: ["PS5-VR-01"] },
  meta: { label: "Meta VR cricket", prices: { 30: 349, 60: 599 }, resources: ["META-VR-01"] }
};

const API_BASE_URL = String(window.PK_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");
const form = document.querySelector("#booking-form");
const submitButton = form.querySelector("button[type='submit']");
const demoPaymentButton = document.querySelector("#demo-payment-button");
const serviceInput = document.querySelector("#service");
const durationInput = document.querySelector("#duration");
const resourceInput = document.querySelector("#resource");
const dateInput = document.querySelector("#date");
const timeInput = document.querySelector("#startTime");
const pricePreview = document.querySelector("#price-preview");
const note = document.querySelector("#form-note");
const toast = document.querySelector("#toast");

function formatINR(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 4600);
}

function setMessage(message, success = false) {
  note.textContent = message;
  note.style.color = success ? "#86f2a3" : "#ff7180";
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

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function submitOnlineBooking(booking) {
  const payload = await apiRequest("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      customerName: booking.customerName,
      phone: booking.phone,
      resourceCode: booking.resource,
      serviceSlug: booking.service,
      date: booking.date,
      startTime: booking.startTime,
      duration: booking.duration
    })
  });
  const paymentSession = { bookingId: payload.bookingId, statusToken: payload.statusToken };
  localStorage.setItem("pk-payment-session", JSON.stringify(paymentSession));
  if (payload.payment?.checkoutUrl) {
    setMessage(`Booking ${payload.bookingId} created. Opening secure Pine Labs checkout…`, true);
    window.location.assign(payload.payment.checkoutUrl);
    return;
  }
  throw new Error("Secure payment checkout is unavailable; no booking was confirmed.");
}

async function startOneRupeeDemo() {
  const customerName = String(document.querySelector("#customerName").value || "").trim();
  const phone = String(document.querySelector("#phone").value || "").replace(/\D/g, "").slice(-10);
  if (customerName.length < 2 || phone.length !== 10) {
    setMessage("₹1 demo ke liye valid name aur 10-digit mobile number enter karein.");
    return;
  }
  demoPaymentButton.disabled = true;
  demoPaymentButton.textContent = "CREATING ₹1 CHECKOUT…";
  try {
    const payload = await apiRequest("/api/demo-bookings", {
      method: "POST",
      body: JSON.stringify({ customerName, phone })
    });
    localStorage.setItem("pk-payment-session", JSON.stringify({ bookingId: payload.bookingId, statusToken: payload.statusToken }));
    if (!payload.payment?.checkoutUrl) throw new Error("₹1 secure checkout is unavailable; no demo booking was created.");
    setMessage(`₹1 demo ${payload.bookingId} created. Opening secure Pine Labs checkout…`, true);
    window.location.assign(payload.payment.checkoutUrl);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "₹1 demo could not be created.");
  } finally {
    demoPaymentButton.disabled = false;
    demoPaymentButton.textContent = "VERIFY WITH ₹1 DEMO";
  }
}

async function showDemoWhenEnabled() {
  try {
    const health = await apiRequest("/api/health");
    demoPaymentButton.hidden = !health.oneRupeeDemoEnabled;
  } catch {
    demoPaymentButton.hidden = true;
  }
}

async function refreshPaymentStatus() {
  if (!API_BASE_URL) return;
  const session = JSON.parse(localStorage.getItem("pk-payment-session") || "null");
  const returnedBookingId = new URLSearchParams(window.location.search).get("bookingId");
  if (!session?.bookingId || !session?.statusToken || (returnedBookingId && returnedBookingId !== session.bookingId)) return;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const status = await apiRequest(`/api/bookings/${encodeURIComponent(session.bookingId)}/payment-status`, {
        headers: { "x-booking-token": session.statusToken }
      });
      if (status.paymentStatus === "SUCCESS") {
        const message = status.bookingId.startsWith("DEMO-")
          ? `₹1 payment verified automatically. Demo ${status.bookingId} is CONFIRMED.`
          : `Payment verified automatically. Booking ${status.bookingId} is confirmed.`;
        setMessage(message, true);
        showToast("Payment verified — booking confirmed.");
        return;
      }
      if (["FAILED", "REFUNDED"].includes(status.paymentStatus)) {
        setMessage(`Payment status: ${status.paymentStatus}. Retry secure checkout; no screenshot is needed.`);
        return;
      }
      setMessage(`Payment received by checkout; verification is still pending for ${status.bookingId}.`, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check payment status.");
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const booking = {
    bookingId: `PK-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customerName: String(data.get("customerName") || "").trim(),
    phone: String(data.get("phone") || "").replace(/\D/g, "").slice(-10),
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

  if (booking.customerName.length < 2 || booking.phone.length !== 10) {
    setMessage("Please enter a valid name and 10-digit mobile number.");
    showToast("Check your name and mobile number.");
    return;
  }
  if (booking.amount === 0 || !booking.date || !booking.startTime || !booking.resource) {
    setMessage("Please complete every booking field.");
    return;
  }
  if (!API_BASE_URL) {
    setMessage("Secure online booking is not connected yet. WhatsApp is for questions only; no booking was created.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "CREATING SECURE PAYMENT…";
  try {
    await submitOnlineBooking(booking);
    form.reset();
    setMinimumDate();
    syncResources();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "Booking could not be created.");
    showToast("Booking failed — please try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "BOOK & PAY SECURELY";
  }
});

serviceInput.addEventListener("change", syncResources);
durationInput.addEventListener("change", updatePrice);
demoPaymentButton.addEventListener("click", startOneRupeeDemo);
makeTimeOptions();
setMinimumDate();
syncResources();
if (API_BASE_URL) {
  submitButton.textContent = "BOOK & PAY SECURELY";
  note.textContent = "Payment is verified server-side through Pine Labs webhooks; screenshots are not accepted as proof.";
  showDemoWhenEnabled();
  refreshPaymentStatus();
} else {
  submitButton.disabled = true;
  submitButton.textContent = "ONLINE PAYMENT SETUP REQUIRED";
  note.textContent = "Secure booking is temporarily unavailable. WhatsApp is for questions only; no manual booking or screenshot verification is accepted.";
}
