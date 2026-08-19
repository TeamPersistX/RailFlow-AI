const { list, writeAll } = require('../services/trainStore');
const { corridor } = require('./routes');

let tick = 0;

function sectionFor(routeIndex) {
  if (routeIndex <= 2) return 'NR-42A';
  if (routeIndex <= 5) return 'NR-42B';
  return 'NR-42C';
}

function normalizeIndex(index) {
  const usable = Math.max(1, corridor.length - 1);
  return ((index % usable) + usable) % usable;
}

function resetSimulation() {
  tick = 0;
  const rows = list().map((train, index) => {
    if (train.area && train.area !== 'Delhi Division') return train;
    const routeIndex = normalizeIndex(index * 2 + 1);
    const delay = Math.max(0, Math.min(20, Number(train.delay || 0)));
    return {
      ...train,
      routeIndex,
      currentStation: corridor[routeIndex],
      nextStation: corridor[normalizeIndex(routeIndex + 1)],
      section: sectionFor(routeIndex),
      status: 'RUNNING',
      delay,
      congestion: delay >= 18 ? 'HIGH' : delay >= 7 ? 'MEDIUM' : 'LOW',
      lastUpdated: new Date().toISOString(),
      simulation: true
    };
  });
  writeAll(rows);
  return rows;
}

function simulate() {
  tick += 1;
  const rows = list().map((train, index) => {
    if (train.area && train.area !== 'Delhi Division') return train;

    let currentIndex = Number.isInteger(train.routeIndex)
      ? train.routeIndex
      : corridor.indexOf(train.currentStation);
    if (currentIndex < 0) currentIndex = normalizeIndex(index * 2 + 1);

    // COMPLETED trains are immediately re-entered into the corridor.
    if (train.status === 'COMPLETED' || currentIndex >= corridor.length - 1) {
      currentIndex = normalizeIndex(index * 2 + tick);
    }

    const moveEvery = 2 + (index % 3);
    const shouldMove = (tick + index) % moveEvery === 0;
    let nextIndex = currentIndex;
    if (shouldMove) nextIndex = normalizeIndex(currentIndex + 1);

    const previousDelay = Math.max(0, Number(train.delay || 0));
    let delayChange = 0;
    if ((tick + index * 2) % 11 === 0) delayChange = 2;
    else if ((tick + index) % 7 === 0 && previousDelay > 0) delayChange = -1;
    const delay = Math.max(0, Math.min(40, previousDelay + delayChange));

    let status = 'RUNNING';
    if (delay >= 12) status = 'DELAYED';
    else if (!shouldMove && (tick + index) % 5 === 0) status = 'AT_STATION';

    return {
      ...train,
      routeIndex: nextIndex,
      currentStation: corridor[nextIndex],
      nextStation: corridor[normalizeIndex(nextIndex + 1)],
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

module.exports = { simulate, resetSimulation };
