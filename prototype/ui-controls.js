/* Presentation controls only: feature navigation never sends a question. */
(() => {
  const track = document.querySelector('#featureTrack');
  const previous = document.querySelector('#featuresPrevious');
  const next = document.querySelector('#featuresNext');
  if (!track || !previous || !next) return;

  const update = () => {
    previous.disabled = track.scrollLeft <= 4;
    next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
  };
  const move = (direction) => {
    track.scrollBy({
      left: direction * track.clientWidth * .75,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  track.addEventListener('scroll', update, { passive: true });
  track.addEventListener('keydown', (event) => {
    if (event.target !== track || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') move(event.key === 'ArrowLeft' ? -1 : 1);
    else track.scrollTo({ left: event.key === 'Home' ? 0 : track.scrollWidth, behavior: 'instant' });
  });
  new ResizeObserver(update).observe(track);
  document.fonts.ready.then(update);
  update();

  const settings = document.querySelector('.scene-settings');
  settings?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      settings.open = false;
      settings.querySelector('summary').focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (settings?.open && !settings.contains(event.target)) settings.open = false;
  });
})();
