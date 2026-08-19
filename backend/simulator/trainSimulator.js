const { list, writeAll } = require('../services/trainStore');
const { corridor } = require('./routes');

let tick = 0;

function sectionFor(routeIndex) {
  if (routeIndex <= 2) return 'NR-42A';
  if (routeIndex <= 5) return 'NR-42B';
  return 'NR-42C';
}

function initialRouteIndex(train, fallbackIndex) {
  if (Number.isInteger(train.routeIndex)) {
    return Math.max(0, Math.min(corridor.length - 1, train.routeIndex));
  }

  const existingIndex = corridor.indexOf(train.currentStation);
  if (existingIndex >= 0) return existingIndex;

  // Spread unknown/real API station names across the demo corridor instead of
  // forcing all of them to New Delhi.
  return fallbackIndex % corridor.length;
}

function simulate() {
  tick += 1;

  const rows = list().map((train, index) => {
    if (train.area !== 'Delhi Division') return train;

    const currentIndex = initialRouteIndex(train, index);
    const moveEvery = 2 + (index % 3); // different trains move at different speeds
    const shouldMove = (tick + index) % moveEvery === 0;

    let nextIndex = currentIndex;
    if (shouldMove && train.status !== 'COMPLETED') {
      nextIndex = Math.min(corridor.length - 1, currentIndex + 1);
    }

    const previousDelay = Math.max(0, Number(train.delay || 0));
    let delayChange = 0;

    // Small operational variations instead of large random jumps.
    if ((tick + index * 2) % 11 === 0) delayChange = 2;
    else if ((tick + index) % 7 === 0 && previousDelay > 0) delayChange = -1;

    const delay = Math.max(0, Math.min(40, previousDelay + delayChange));
    const completed = nextIndex >= corridor.length - 1;

    let status = 'RUNNING';
    if (completed) status = 'COMPLETED';
    else if (delay >= 12) status = 'DELAYED';
    else if (!shouldMove && (tick + index) % 5 === 0) status = 'AT_STATION';

    const currentStation = corridor[nextIndex];
    const nextStation = completed
      ? 'End of Route'
      : corridor[Math.min(corridor.length - 1, nextIndex + 1)];

    return {
      ...train,
      routeIndex: nextIndex,
      currentStation,
      nextStation,
      section: sectionFor(nextIndex),
      delay,
      status,
      congestion: delay >= 18 ? 'HIGH' : delay >= 7 ? 'MEDIUM' : 'LOW',
      lastUpdated: new Date().toISOString(),
      simulation: true
    };
  });

  writeAll(rows);
  return rows;
}

module.exports = { simulate };
