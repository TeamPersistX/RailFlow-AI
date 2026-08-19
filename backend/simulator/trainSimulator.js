const { list, writeAll } = require('../services/trainStore');
const { corridor } = require('./routes');

let tick = 0;

function sectionFor(index) {
  return ['NR-42A', 'NR-42B', 'NR-42C'][index % 3];
}

function simulate() {
  tick++;

  const rows = list().map((train, i) => {
    // Sirf Delhi Division ki assigned trains simulate karo
    if (train.area && train.area !== 'Delhi Division') {
      return train;
    }

    let idx = corridor.indexOf(train.currentStation);

    // Agar current station route mein nahi milta,
    // train ko different starting position do
    if (idx < 0) {
      idx = i % Math.max(1, corridor.length - 1);
    }

    /*
      IMPORTANT FIX:
      Agar purani data file mein train COMPLETED hai,
      tab bhi usko wapas RUNNING simulation mein le aao.
    */
    if (train.status === 'COMPLETED') {
      idx = i % Math.max(1, corridor.length - 1);
    }

    // Har train alag speed/frequency se move karegi
    const moveFrequency = 2 + (i % 3);

    if ((tick + i) % moveFrequency === 0) {
      idx++;
    }

    /*
      END OF ROUTE FIX

      COMPLETED karke permanently stop nahi karna.

      Route ke end par pahunchte hi train ko
      corridor ke different starting point par
      wapas RUNNING state mein daal do.
    */
    if (idx >= corridor.length - 1) {
      idx = i % Math.max(1, corridor.length - 2);
    }

    // Delay update
    let delay = Number(train.delay || 0);

    const change = (tick + i) % 6;

    if (change === 0) {
      delay += 2;
    } else if (change === 1) {
      delay -= 1;
    } else if (change === 4 && delay > 0) {
      delay -= 2;
    }

    delay = Math.max(0, Math.min(45, delay));

    // Default state: NEVER COMPLETED
    let status = 'RUNNING';

    if (delay >= 12) {
      status = 'DELAYED';
    }

    // Kabhi-kabhi train station par rukegi
    if ((tick + i) % 11 === 0) {
      status = 'AT_STATION';
    }

    return {
      ...train,

      currentStation: corridor[idx],

      nextStation:
        idx < corridor.length - 1
          ? corridor[idx + 1]
          : corridor[0],

      section: sectionFor(idx),

      delay,

      status,

      congestion:
        delay >= 20
          ? 'HIGH'
          : delay >= 7
            ? 'MEDIUM'
            : 'LOW',

      lastUpdated: new Date().toISOString(),

      simulation: true
    };
  });

  writeAll(rows);

  console.log(
    `🚆 Simulator updated ${rows.length} trains | Tick: ${tick}`
  );

  return rows;
}

function startTrainSimulator(ms = 20000) {
  console.log(
    `🚆 Train Simulator started - updating every ${ms / 1000} seconds`
  );

  simulate();

  return setInterval(simulate, ms);
}

module.exports = {
  simulate,
  startTrainSimulator
};