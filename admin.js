const login = document.querySelector("#admin-login");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#admin-login-form");
const list = document.querySelector("#booking-list");
const search = document.querySelector("#search");
const state = { bookings: JSON.parse(localStorage.getItem("pk-bookings") || "[]") };

const fmt = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const today = () => new Date().toISOString().slice(0, 10);

function render() {
  const query = String(search?.value || "").toLowerCase().trim();
  const bookings = state.bookings.filter((booking) => !query || `${booking.bookingId} ${booking.phone}`.toLowerCase().includes(query));
  const todayCount = state.bookings.filter((booking) => booking.date === today() && booking.bookingStatus !== "CANCELLED").length;
  const upcomingCount = state.bookings.filter((booking) => booking.date >= today() && booking.bookingStatus !== "CANCELLED").length;
  document.querySelector("#today-count").textContent = todayCount;
  document.querySelector("#upcoming-count").textContent = upcomingCount;
  document.querySelector("#pending-count").textContent = state.bookings.filter((booking) => booking.paymentStatus === "PENDING").length;
  document.querySelector("#revenue").textContent = fmt(state.bookings.filter((booking) => booking.bookingStatus !== "CANCELLED").reduce((sum, booking) => sum + Number(booking.amount || 0), 0));
  list.innerHTML = bookings.length ? bookings.map((booking) => `<article class="booking-item"><div><b>${booking.bookingId}</b><span>${booking.customerName} · ${booking.phone}</span><small>${booking.date} · ${booking.startTime} · ${booking.duration} min · ${booking.resource}</small></div><div><strong>${fmt(booking.amount)}</strong><small>${booking.bookingStatus} · ${booking.paymentStatus}</small></div><button data-booking-id="${booking.bookingId}">${booking.bookingStatus === "CONFIRMED" ? "COMPLETE" : "CONFIRM"}</button></article>`).join("") : `<p class="muted">No booking requests yet. New requests from the public booking form appear here.</p>`;
  list.querySelectorAll("button[data-booking-id]").forEach((button) => button.addEventListener("click", () => updateStatus(button.dataset.bookingId)));
}

function updateStatus(bookingId) {
  state.bookings = state.bookings.map((booking) => booking.bookingId === bookingId ? { ...booking, bookingStatus: booking.bookingStatus === "CONFIRMED" ? "COMPLETED" : "CONFIRMED" } : booking);
  localStorage.setItem("pk-bookings", JSON.stringify(state.bookings));
  render();
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const key = document.querySelector("#admin-key").value.trim();
  if (!key) return;
  sessionStorage.setItem("pk-admin-preview", "1");
  login.hidden = true;
  dashboard.hidden = false;
  render();
});

document.querySelector("#logout").addEventListener("click", () => {
  sessionStorage.removeItem("pk-admin-preview");
  dashboard.hidden = true;
  login.hidden = false;
});
search.addEventListener("input", render);

if (sessionStorage.getItem("pk-admin-preview") === "1") { login.hidden = true; dashboard.hidden = false; render(); }
