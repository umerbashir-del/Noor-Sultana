import { findTrips } from './home-data.mjs';

const track = document.querySelector('#tripTrack');
const form = document.querySelector('#tripSearch');
const count = document.querySelector('#tripCount');
const previous = document.querySelector('#previousTrip');
const next = document.querySelector('#nextTrip');
const detail = document.querySelector('#tripDetail');
let visibleTrips = findTrips();
let currentIndex = 0;

function updateControls() {
  previous.disabled = currentIndex === 0 || visibleTrips.length === 0;
  next.disabled = currentIndex >= visibleTrips.length - 1;
  count.textContent = visibleTrips.length ? `${currentIndex + 1} / ${visibleTrips.length}` : '0 / 0';
}

function showCard(index) {
  currentIndex = Math.max(0, Math.min(index, visibleTrips.length - 1));
  track.children[currentIndex]?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest', inline: 'start' });
  updateControls();
}

function renderTrips() {
  track.replaceChildren();
  visibleTrips.forEach((trip) => {
    const card = document.createElement('article');
    card.className = 'trip-card';
    card.innerHTML = `<div class="trip-photo"><img loading="lazy" src="${trip.image}" alt="${trip.city} city view" /><span class="trip-tag">${trip.highlight}</span></div><div class="trip-body"><div><span class="trip-country">${trip.country}</span><h3>${trip.city}</h3></div><span class="trip-code">${trip.airport}</span></div><div class="trip-bottom"><div><small>FROM JFK · ${trip.date.toUpperCase()}</small><strong>From $${trip.fare}<span> / person*</span></strong></div><button type="button" data-trip="${trip.id}" aria-label="View ${trip.city} sample trip">↗</button></div>`;
    track.append(card);
  });
  document.querySelector('#noResults').hidden = visibleTrips.length > 0;
  currentIndex = 0;
  track.scrollLeft = 0;
  updateControls();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  visibleTrips = findTrips({ destination: form.elements.destination.value, month: form.elements.month.value });
  renderTrips();
  detail.hidden = true;
  document.querySelector('#trips').scrollIntoView({ behavior: 'smooth' });
});
previous.addEventListener('click', () => showCard(currentIndex - 1));
next.addEventListener('click', () => showCard(currentIndex + 1));
track.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    showCard(currentIndex + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
track.addEventListener('scroll', () => {
  const cards = [...track.children];
  if (!cards.length) return;
  const index = cards.reduce((best, card, i) => Math.abs(card.offsetLeft - track.scrollLeft - track.offsetLeft) < Math.abs(cards[best].offsetLeft - track.scrollLeft - track.offsetLeft) ? i : best, 0);
  if (index !== currentIndex) { currentIndex = index; updateControls(); }
}, { passive: true });
track.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-trip]');
  if (!button) return;
  const trip = visibleTrips.find((item) => item.id === button.dataset.trip);
  if (!trip) return;
  document.querySelector('#detailImage').src = trip.image;
  document.querySelector('#detailImage').alt = `${trip.city} city view`;
  document.querySelector('#detailTitle').textContent = `${trip.city}, ${trip.country}`;
  document.querySelector('#detailLine').textContent = trip.line;
  document.querySelector('#detailRoute').textContent = `JFK → ${trip.airport}`;
  document.querySelector('#detailDate').textContent = trip.date;
  document.querySelector('#detailFare').textContent = `From $${trip.fare} / person*`;
  detail.hidden = false;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
renderTrips();
