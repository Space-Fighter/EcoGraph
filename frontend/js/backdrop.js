// Chooses the page's photo. On the map it follows the city's clock: the sunny lake by day and the
// Milky Way by night. The Database view always shows the Milky Way.
const Backdrop = (() => {
  const DUSK = 18.75, DAWN = 5.75;   // the midpoints of the map's own fade to and from night
  let hours = 9;
  let databaseOpen = false;

  function apply() {
    const night = databaseOpen || hours < DAWN || hours >= DUSK;
    const root = document.documentElement;
    if (night) root.dataset.sky = 'night';
    else delete root.dataset.sky;
  }

  function setHours(value) {
    hours = value;
    apply();
  }

  function setDatabaseOpen(open) {
    databaseOpen = open;
    apply();
  }

  return { setHours, setDatabaseOpen };
})();
