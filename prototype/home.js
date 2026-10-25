import { formatJourneyTime, journeyDuration } from './journeys.mjs';
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
    card.innerHTML = `<div class="trip-photo"><img loading="lazy" src="${trip.image}" alt="${trip.city} city view" /><span class="trip-tag">${trip.highlight}</span></div><div class="trip-body"><div><span class="trip-country">${trip.country}</span><h3>${trip.city}</h3></div><span class="trip-code">${trip.airport}</span></div><div class="trip-bottom"><div><small>FROM JFK · ${trip.date.toUpperCase()}</small><strong>${journeyDuration(trip)}</strong></div><button type="button" data-trip="${trip.id}" aria-label="View ${trip.city} sample trip">View journey</button></div>`;
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
  document.querySelectorAll('[data-journey-shortcut], #meetJourney').forEach(link => { link.href = '#plan'; });
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
  document.querySelector('#detailRoute').textContent = `JFK → ${trip.airport} · ${journeyDuration(trip)}`;
  document.querySelector('#detailDate').textContent = formatJourneyTime(trip.departureAt, trip.origin.timeZone);
  document.querySelector('#detailArrival').textContent = formatJourneyTime(trip.arrivalAt, trip.timeZone);
  const journeyUrl = `/flight-demo.html?journey=${trip.id}`;
  document.querySelector('#meetJourney').href = journeyUrl;
  document.querySelectorAll('[data-journey-shortcut]').forEach(link => { link.href = journeyUrl; });
  detail.hidden = false;
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
renderTrips();

// A disclosure menu keeps the existing section links available on small screens.
const menuToggle = document.querySelector('#homeMenuToggle');
const navigation = document.querySelector('#homeNavigation');
const mobileNavigation = matchMedia('(max-width: 700px)');
function closeNavigation(returnFocus = false) {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  navigation.dataset.open = 'false';
  if (returnFocus) menuToggle.focus();
}
menuToggle.hidden = false;
menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  navigation.dataset.open = String(open);
});
navigation.addEventListener('click', (event) => {
  if (event.target.closest('a') && mobileNavigation.matches) closeNavigation(true);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') closeNavigation(true);
});
document.addEventListener('pointerdown', (event) => {
  if (!navigation.contains(event.target) && !menuToggle.contains(event.target)) closeNavigation();
});
mobileNavigation.addEventListener('change', () => closeNavigation());
