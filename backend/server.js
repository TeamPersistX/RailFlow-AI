require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const axios = require('axios');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const { list, upsert } = require('./services/trainStore');
const { simulate } = require('./simulator/trainSimulator');
const { fetchLive } = require('./services/liveTrain');
const { corridor } = require('./simulator/routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const controllersFile = path.join(__dirname, 'data/controllers.json');
const decisionsFile = path.join(__dirname, 'data/decisions.json');
const resolvedFile = path.join(__dirname, 'data/resolvedConflicts.json');

if (!fs.existsSync(resolvedFile)) fs.writeFileSync(resolvedFile, '[]');
if (!fs.existsSync(decisionsFile)) fs.writeFileSync(decisionsFile, '[]');

const readJson = (file, fallback = []) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const resolvedIds = () => new Set(readJson(resolvedFile, []));

const markResolved = (id) => {
  const ids = [...resolvedIds()];
  if (!ids.includes(id)) {
    ids.push(id);
    fs.writeFileSync(resolvedFile, JSON.stringify(ids, null, 2));
  }
};

const readDecisions = () => readJson(decisionsFile, []);

const stationIndex = (name) => {
  const index = corridor.indexOf(name);
  return index >= 0 ? index : 0;
};

function etaToNext(train) {
  const delay = Math.max(0, Number(train.delay || 0));
  const speed = Math.max(35, Number(train.speed || 70));
  const statusPenalty = train.status === 'AT_STATION' ? 1.5 : 0;
  return Number((2.5 + delay * 0.12 + 90 / speed + statusPenalty).toFixed(1));
}

/*
  REALISTIC CONFLICT ENGINE

  A conflict is NOT created just because two trains have the same section.
  The trains must also be operationally close:
  - same/adjacent route position
  - or one is approaching the other's occupied station
  - or both are approaching the same next station
  - and their ETA/headway is small enough to be risky
*/
function calcConflicts() {
  const trains = list().filter((t) =>
    ['RUNNING', 'DELAYED', 'AT_STATION'].includes(t.status)
  );

  const conflicts = [];
  const perTrainCount = {};
  const resolved = resolvedIds();

  for (let i = 0; i < trains.length; i++) {
    for (let j = i + 1; j < trains.length; j++) {
      const a = trains[i];
      const b = trains[j];

      if ((perTrainCount[a.id] || 0) >= 1) continue;
      if ((perTrainCount[b.id] || 0) >= 1) continue;

      const posA = Number.isInteger(a.routeIndex)
        ? a.routeIndex
        : stationIndex(a.currentStation);
      const posB = Number.isInteger(b.routeIndex)
        ? b.routeIndex
        : stationIndex(b.currentStation);

      const positionGap = Math.abs(posA - posB);
      const sameStation = a.currentStation === b.currentStation;
      const sameNextStation =
        a.nextStation &&
        b.nextStation &&
        a.nextStation === b.nextStation;
      const approachingOccupiedStation =
        a.nextStation === b.currentStation ||
        b.nextStation === a.currentStation;

      const etaA = etaToNext(a);
      const etaB = etaToNext(b);
      const etaGap = Math.abs(etaA - etaB);
      const delayA = Math.max(0, Number(a.delay || 0));
      const delayB = Math.max(0, Number(b.delay || 0));
      const delayGap = Math.abs(delayA - delayB);

      const closeOnRoute = positionGap <= 1;
      const bothDelayed = delayA >= 10 && delayB >= 10;
      const etaRisk = etaGap <= 2.5;

      // Ignore trains that are not geographically close.
      if (!closeOnRoute && !sameStation && !sameNextStation && !approachingOccupiedStation) {
        continue;
      }

      // A realistic risk needs close arrival timing or an occupied-station approach.
      const risky =
        sameStation ||
        approachingOccupiedStation ||
        (sameNextStation && etaRisk) ||
        (closeOnRoute && etaRisk && bothDelayed) ||
        (positionGap === 0 && delayGap <= 12);

      if (!risky) continue;

      const [firstId, secondId] = [String(a.id), String(b.id)].sort();
      const id = `RT-${firstId}-${secondId}`;
      if (resolved.has(id)) continue;

      let severity = 'LOW';
      if (sameStation || (approachingOccupiedStation && etaGap <= 1.5)) {
        severity = 'HIGH';
      } else if (sameNextStation || bothDelayed || positionGap === 0) {
        severity = 'MEDIUM';
      }

      let probability = 0.28;
      if (sameStation) probability += 0.35;
      if (approachingOccupiedStation) probability += 0.25;
      if (sameNextStation) probability += 0.16;
      if (positionGap === 0) probability += 0.10;
      if (bothDelayed) probability += 0.08;
      if (etaGap <= 1.5) probability += 0.08;

      probability = Number(Math.min(0.94, probability).toFixed(2));

      let reason = 'Trains are close on the same corridor with a reduced operational headway.';
      if (sameStation) {
        reason = `Both trains are operating at or near ${a.currentStation}.`;
      } else if (approachingOccupiedStation) {
        reason = 'One train is approaching a station currently occupied by the other train.';
      } else if (sameNextStation) {
        reason = `Both trains are approaching ${a.nextStation} within a short ETA window.`;
      }

      conflicts.push({
        id,
        section: a.section === b.section ? a.section : `${a.section} / ${b.section}`,
        trainA: a,
        trainB: b,
        etaA: `${etaA} min`,
        etaB: `${etaB} min`,
        timeDifference: Math.max(1, Math.round(etaGap * 2)),
        conflictProbability: probability,
        severity,
        reason,
        currentLocation: sameStation
          ? a.currentStation
          : `${a.currentStation} → ${a.nextStation}`
      });

      perTrainCount[a.id] = (perTrainCount[a.id] || 0) + 1;
      perTrainCount[b.id] = (perTrainCount[b.id] || 0) + 1;
    }
  }

  const order = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return conflicts
    .sort((x, y) => {
      const severityDiff = order[y.severity] - order[x.severity];
      if (severityDiff !== 0) return severityDiff;
      return y.conflictProbability - x.conflictProbability;
    })
    .slice(0, 8);
}

function network() {
  const trains = list();
  const sectionIds = ['NR-42A', 'NR-42B', 'NR-42C'];

  const sections = sectionIds.map((id) => {
    const rows = trains.filter((t) => t.section === id);
    const occupancy = Math.min(100, 10 + rows.length * 18);
    return {
      id,
      trainCount: rows.length,
      occupancy,
      status: occupancy >= 70 ? 'BUSY' : occupancy >= 45 ? 'MODERATE' : 'NORMAL'
    };
  });

  return { trains, sections, updatedAt: new Date().toISOString() };
}

async function refreshTracked() {
  const trains = list();

  for (const t of trains) {
    const live = await fetchLive(t.trainNumber || t.id);
    if (live) {
      upsert({
        ...t,
        ...live,
        section: t.section || 'NR-42A',
        priority: t.priority || 'MEDIUM'
      });
    }
  }

  const payload = network();
  io.emit('telemetry', payload);
  io.emit('conflicts', calcConflicts());
  return payload;
}

async function aiRisk(train, conflictCount) {
  try {
    const response = await axios.post(
      (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000') + '/predict',
      {
        delay: Number(train.delay || 0),
        occupancy: 1,
        conflicts: conflictCount
      },
      { timeout: 4000 }
    );
    return response.data;
  } catch {
    const risk = Math.min(
      100,
      Math.round(Number(train.delay || 0) * 1.5 + conflictCount * 12)
    );
    return {
      risk,
      level: risk >= 75 ? 'HIGH' : risk >= 45 ? 'MEDIUM' : 'LOW',
      recommendation: 'Review headway, delay and section occupancy before clearing the train.'
    };
  }
}

app.post('/api/auth/login', (req, res) => {
  const { controllerId, password } = req.body || {};
  const rows = readJson(controllersFile, []);
  const controller = rows.find(
    (x) =>
      x.controllerId === String(controllerId || '').trim() &&
      x.password === password
  );

  if (!controller) {
    return res.status(401).json({
      success: false,
      message: 'Invalid Controller ID or password'
    });
  }

  res.json({
    success: true,
    controller: {
      controllerId: controller.controllerId,
      name: controller.name,
      area: controller.area
    }
  });
});

app.get('/api/trains/area/:area', (req, res) => {
  const area = decodeURIComponent(req.params.area);
  res.json({ success: true, data: list().filter((t) => t.area === area) });
});

app.get('/health', (req, res) =>
  res.json({ ok: true, service: 'RailFlow backend' })
);

app.get('/api/trains', (req, res) =>
  res.json({ success: true, data: list() })
);

app.get('/api/network', (req, res) =>
  res.json({ success: true, data: network() })
);

app.get('/api/conflicts', (req, res) =>
  res.json({ success: true, data: calcConflicts() })
);

app.post('/api/trains/track', async (req, res) => {
  const trainNo = String(req.body?.trainNo || '').trim();

  if (!/^\d{3,8}$/.test(trainNo)) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid numeric train number.'
    });
  }

  const existing = list().find(
    (x) => x.id === trainNo || x.trainNumber === trainNo
  );

  if (existing) {
    return res.json({
      success: true,
      data: existing,
      message: 'Train is already being tracked.',
      source: existing.apiSource || 'stored'
    });
  }

  const live = await fetchLive(trainNo);
  if (!live) {
    return res.status(502).json({
      success: false,
      message:
        'Live train API did not return data. Check train number, RAPIDAPI_KEY and API availability.'
    });
  }

  const sections = ['NR-42A', 'NR-42B', 'NR-42C'];
  const train = {
    ...live,
    routeIndex: list().length % corridor.length,
    section: sections[list().length % sections.length],
    priority: live.trainType === 'EXPRESS' ? 'HIGH' : 'MEDIUM'
  };

  upsert(train);
  await refreshTracked();
  res.json({ success: true, data: train, source: 'rapidapi' });
});

app.post('/api/trains/refresh', async (req, res) => {
  const data = await refreshTracked();
  res.json({ success: true, data });
});

function preventionScore(train) {
  const delay = Math.min(45, Number(train.delay || 0));
  const congestion =
    train.congestion === 'HIGH'
      ? 22
      : train.congestion === 'MEDIUM'
      ? 12
      : 5;
  const priority = train.priority === 'HIGH' ? 12 : 6;
  const score = Math.min(100, Math.round(30 + delay * 1.25 + congestion + priority));
  const reasons = [];

  if (delay >= 15) reasons.push(`Current delay is ${delay} minutes`);
  if (train.congestion === 'HIGH') reasons.push('High congestion detected on the current corridor');
  else if (train.congestion === 'MEDIUM') reasons.push('Moderate corridor congestion may cause further delay');
  if (train.priority === 'HIGH') reasons.push('High-priority service benefits from proactive clearance');
  if (!reasons.length) reasons.push('Train is stable, but proactive monitoring is recommended');

  return {
    score,
    level: score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW',
    reasons,
    recommendation:
      score >= 75
        ? 'Give priority clearance and monitor the next section'
        : score >= 50
        ? 'Monitor the next section and prepare alternate routing'
        : 'Continue normal operation'
  };
}

app.get('/api/trains/scored', (req, res) =>
  res.json({
    success: true,
    data: list().map((t) => ({ ...t, delayPrevention: preventionScore(t) }))
  })
);

app.get('/api/analytics/dashboard', (req, res) => {
  const trains = list();
  const conflicts = calcConflicts();
  const totalDelay = trains.reduce((sum, t) => sum + Number(t.delay || 0), 0);

  res.json({
    success: true,
    data: {
      activeTrains: trains.length,
      predictedConflicts: conflicts.length,
      controllerDecisions: readDecisions().length,
      sectionThroughput: Math.min(99, 60 + trains.length * 2),
      totalDelay,
      onTimePerformance: Math.max(
        0,
        100 - Math.round(totalDelay / Math.max(1, trains.length))
      ),
      criticalConflicts: conflicts.filter((c) => c.severity === 'HIGH').length
    }
  });
});

app.get('/api/controller-decisions', (req, res) =>
  res.json({ success: true, data: readDecisions() })
);

app.post('/api/controller-decisions', (req, res) => {
  if (req.body?.conflictId) markResolved(req.body.conflictId);

  const decisions = readDecisions();
  const decision = {
    ...req.body,
    timestamp: new Date().toISOString(),
    recommendedTrain: req.body.selectedTrain
  };

  decisions.unshift(decision);
  fs.writeFileSync(decisionsFile, JSON.stringify(decisions, null, 2));

  // Immediately broadcast the updated active-conflict queue so the decided
  // conflict disappears without waiting for the next simulator tick.
  const activeConflicts = calcConflicts();
  io.emit('conflicts', activeConflicts);

  res.json({
    success: true,
    data: decision,
    nextConflict: activeConflicts[0] || null,
    activeConflictCount: activeConflicts.length
  });
});

app.get('/api/recommendations', async (req, res) => {
  const conflicts = calcConflicts();
  const rows = [];

  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i];
    const trainA = conflict.trainA;
    const trainB = conflict.trainB;
    const recommendedTrain =
      Number(trainA.priority === 'HIGH') + Number(trainA.delay || 0) >=
      Number(trainB.priority === 'HIGH') + Number(trainB.delay || 0)
        ? trainA
        : trainB;

    const risk = await aiRisk(recommendedTrain, conflicts.length);

    rows.push({
      id: `AI-${conflict.id}`,
      conflictId: conflict.id,
      severity: conflict.severity,
      recommendedTrain: recommendedTrain.id,
      recommendedAction: `Allow ${recommendedTrain.name} (${recommendedTrain.trainNumber || recommendedTrain.id}) to proceed first`,
      reason: conflict.reason,
      confidence: Math.max(
        0.55,
        Math.min(0.98, 0.62 + conflict.conflictProbability * 0.32 - (risk.risk || 0) / 1000)
      ),
      aiMode: 'ML + Rules',
      risk,
      expectedImpact: {
        delayReduction: Math.max(2, conflict.timeDifference * 2),
        throughput: 8 + Number(recommendedTrain.delay || 0),
        affectedTrains: 2
      },
      whyThisAction: [
        'Uses current live delay and operational priority',
        'Checks route proximity and station occupancy',
        'Uses ML risk score as a supporting signal',
        'Selects the lower network-impact movement order'
      ]
    });
  }

  res.json({ success: true, data: rows });
});

app.post('/api/recommendations/generate', (req, res) =>
  res.json({ success: true, message: 'Recommendations refreshed from current network state.' })
);

io.on('connection', (socket) => {
  socket.emit('telemetry', network());
  socket.emit('conflicts', calcConflicts());
});

// One simulator loop only. The old version started two loops, which caused
// trains to jump too quickly and produced unrealistic conflict counts.
const interval = Math.max(5000, Number(process.env.SIMULATOR_REFRESH_MS || 20000));

// Seed one simulator update immediately so the dashboard is populated on startup.
simulate();

setInterval(() => {
  simulate();
  const payload = network();
  io.emit('telemetry', payload);
  io.emit('conflicts', calcConflicts());
}, interval);

server.listen(process.env.PORT || 5000, () => {
  console.log(`RailFlow backend running on http://localhost:${process.env.PORT || 5000}`);
});
