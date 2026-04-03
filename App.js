import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView,
  SafeAreaView, Dimensions, StatusBar, Vibration, Modal,
  Platform, Alert
} from "react-native";
import Svg, {
  Circle, Line, Rect, G, Text as SvgText,
  Path, Defs, LinearGradient, Stop
} from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";

const { width: SW } = Dimensions.get("window");
const STORAGE_KEY = "@quitflow_data_v4";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

const dateKey = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fmtTime = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDayShort = (d) => d.toLocaleDateString("en-GB", { weekday: "short" });
const fmtDateShort = (d) => `${d.getDate()}/${d.getMonth() + 1}`;

// Returns the "logical day key" given the current time and setup.
// The logical day starts at startHour:startMin and ends at endHour:endMin.
// If now is between midnight and endHour:endMin, it still belongs to yesterday's logical day.
function getLogicalDay(now, setup) {
  const { startHour, startMin, endHour, endMin } = setup;

  // Build today's start and end boundaries
  const todayStart = new Date(now);
  todayStart.setHours(startHour, startMin, 0, 0);

  const todayEnd = new Date(now);
  todayEnd.setHours(endHour, endMin, 0, 0);

  // End can be past midnight (e.g. start=07:00, end=01:00 next day)
  const endCrossesMidnight = endHour < startHour || (endHour === startHour && endMin < startMin);

  if (endCrossesMidnight) {
    // If we're before today's end time (i.e. early morning), we belong to yesterday
    const yesterdayEnd = new Date(now);
    yesterdayEnd.setHours(endHour, endMin, 0, 0);
    if (now < yesterdayEnd) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return dateKey(yesterday);
    }
    // If we're after today's start, we're in today's logical day
    if (now >= todayStart) {
      return dateKey(now);
    }
    // Between end and start = "dead zone" — still considered today for logging
    return dateKey(now);
  } else {
    // Same-day cycle (e.g. start=07:00, end=23:00)
    if (now >= todayStart) return dateKey(now);
    // Before start — belongs to yesterday's logical day
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return dateKey(yesterday);
  }
}

// Is the current time in the "between end and next start" dead zone?
function isInDeadZone(now, setup) {
  const { startHour, startMin, endHour, endMin } = setup;
  const h = now.getHours(), m = now.getMinutes();
  const nowMins = h * 60 + m;
  const endMins = endHour * 60 + endMin;
  const startMins = startHour * 60 + startMin;

  const endCrossesMidnight = endHour < startHour || (endHour === startHour && endMin < startMin);

  if (endCrossesMidnight) {
    // Dead zone: endMins < nowMins < startMins (same day, after end, before start)
    // e.g. end=01:00, start=07:00: dead zone is 01:00–07:00
    // After midnight: 0–endMins is still previous day's tail
    return nowMins > endMins && nowMins < startMins;
  } else {
    // Dead zone: before start
    return nowMins < startMins;
  }
}

// Seconds until end-of-day cutoff
function secondsUntilEnd(now, setup) {
  const { endHour, endMin } = setup;
  const end = new Date(now);
  end.setHours(endHour, endMin, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return Math.max(0, Math.floor((end - now) / 1000));
}

// Format countdown as "Xh Xm Xs"
function fmtCountdown(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

// Build plan: { dateKey -> allowance }
function buildPlan(startDateStr, startCigs, durationDays) {
  const plan = {};
  const interval = durationDays / startCigs;
  for (let i = 0; i < durationDays; i++) {
    const d = new Date(startDateStr);
    d.setDate(d.getDate() + i);
    plan[dateKey(d)] = Math.max(0, Math.round(startCigs - (i + 1) / interval));
  }
  return plan;
}

function getAllowance(plan, key, startCigs) {
  if (plan && plan[key] !== undefined) return plan[key];
  return startCigs;
}

function last7LogicalDays(setup) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
}

// ─── Default setup ────────────────────────────────────────────────────────────

const DEFAULT_SETUP = {
  startCigs: 20,
  durationDays: 90,
  startHour: 7,
  startMin: 0,
  endHour: 1,
  endMin: 0,
  startDate: dateKey(new Date()),
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [logs, setLogs] = useState({});
  const [setup, setSetup] = useState(DEFAULT_SETUP);
  const [plan, setPlan] = useState({});
  const [view, setView] = useState("today");
  const [showSetup, setShowSetup] = useState(false);
  const [now, setNow] = useState(new Date());
  const [lastCigTime, setLastCigTime] = useState(null); // ISO of most recent cig logged
  const [dayChoiceVisible, setDayChoiceVisible] = useState(false);

  // 1-second ticker for countdown
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load persisted data
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.logs) setLogs(p.logs);
        if (p.setup) {
          const s = { ...DEFAULT_SETUP, ...p.setup };
          setSetup(s);
          setPlan(buildPlan(s.startDate, s.startCigs, s.durationDays));
        }
        if (p.lastCigTime) setLastCigTime(p.lastCigTime);
      } else {
        setShowSetup(true);
      }
    })();
  }, []);

  const persist = useCallback(async (newLogs, newSetup, newLastCig) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      logs: newLogs,
      setup: newSetup || setup,
      lastCigTime: newLastCig !== undefined ? newLastCig : lastCigTime,
    }));
  }, [setup, lastCigTime]);

  const saveSetup = async (newSetup) => {
    const newPlan = buildPlan(newSetup.startDate, newSetup.startCigs, newSetup.durationDays);
    setSetup(newSetup);
    setPlan(newPlan);
    setShowSetup(false);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ logs, setup: newSetup, lastCigTime }));
  };

  // Logical day determination
  const inDeadZone = isInDeadZone(now, setup);
  const logicalDay = getLogicalDay(now, setup);

  // If user taps "log" during dead zone → ask which day
  const handleLogPress = () => {
    Vibration.vibrate(50);
    if (inDeadZone) {
      setDayChoiceVisible(true);
    } else {
      doLog(logicalDay);
    }
  };

  const doLog = (targetDayKey) => {
    const iso = now.toISOString();
    const newDayLogs = [...(logs[targetDayKey] || []), iso];
    const newLogs = { ...logs, [targetDayKey]: newDayLogs };
    setLogs(newLogs);
    setLastCigTime(iso);
    persist(newLogs, undefined, iso);
  };

  const removeLast = (targetDayKey) => {
    const arr = logs[targetDayKey] || [];
    if (!arr.length) return;
    Vibration.vibrate(30);
    const newArr = arr.slice(0, -1);
    const newLogs = { ...logs, [targetDayKey]: newArr };
    // Update lastCigTime to new last, or null
    const newLast = newArr.length > 0 ? newArr[newArr.length - 1] : null;
    setLogs(newLogs);
    setLastCigTime(newLast);
    persist(newLogs, undefined, newLast);
  };

  // Today's data
  const todayLogs = logs[logicalDay] || [];
  const smokedToday = todayLogs.length;
  const todayAllowance = getAllowance(plan, logicalDay, setup.startCigs);
  const remaining = Math.max(0, todayAllowance - smokedToday);

  // Countdown to end of day
  const secsLeft = secondsUntilEnd(now, setup);
  const nextCigSecs = remaining > 0 ? Math.floor((secsLeft / remaining)) : null;

  // Time since last cig
  const secsSinceLastCig = lastCigTime
    ? Math.floor((now - new Date(lastCigTime)) / 1000)
    : null;

  // Button color: red if last cig was recent (within nextCigSecs), green when elapsed
  const cigBtnReady = lastCigTime === null ||
    nextCigSecs === null ||
    secsSinceLastCig >= nextCigSecs;
  const cigBtnColor = cigBtnReady ? "#16312a" : "#2a1616";
  const cigBtnBorder = cigBtnReady ? "#4ade80" : "#f87171";
  const cigBtnTextColor = cigBtnReady ? "#86efac" : "#fca5a5";

  // Plan progress
  const planKeys = Object.keys(plan);
  const dayIndex = planKeys.indexOf(logicalDay);
  const progressPct = planKeys.length > 0
    ? Math.max(0, Math.round(((dayIndex + 1) / planKeys.length) * 100))
    : 0;

  // Status
  const isOver = smokedToday > todayAllowance;
  let statusColor = "#a78bfa";
  let statusText = "";
  if (todayAllowance === 0 && smokedToday === 0) {
    statusColor = "#4ade80"; statusText = "🎉 Smoke-free day!";
  } else if (isOver) {
    statusColor = "#f87171"; statusText = `⚠  ${smokedToday - todayAllowance} over limit`;
  } else if (remaining === 0) {
    statusColor = "#4ade80"; statusText = "✅ Goal reached!";
  } else if (nextCigSecs !== null) {
    statusText = `Next in ${fmtCountdown(nextCigSecs)}`;
    statusColor = nextCigSecs < 900 ? "#facc15" : "#a78bfa";
  }

  // Circle
  const circleR = 90;
  const circleC = 2 * Math.PI * circleR;
  const circlePct = todayAllowance > 0
    ? Math.min(1, smokedToday / todayAllowance)
    : smokedToday > 0 ? 1 : 0;
  const circleOffset = circleC * (1 - circlePct);

  // Yesterday key (for dead zone logging)
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = dateKey(yesterdayDate);
  const todayCalKey = dateKey(now);

  return (
    <SafeAreaView style={S.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0c1a" />

      {/* Header */}
      <View style={S.header}>
        <Text style={S.logo}>🚭 QUITFLOW</Text>
        <View style={S.headerRight}>
          <View style={S.tabs}>
            {["today", "stats"].map(v => (
              <TouchableOpacity key={v} onPress={() => setView(v)}>
                <Text style={[S.tab, view === v && S.activeTab]}>
                  {v === "today" ? "Today" : "Stats"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => setShowSetup(true)} style={S.settingsBtn}>
            <Text style={S.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>

        {view === "today" ? (
          <>
            {/* Dead zone banner */}
            {inDeadZone && (
              <View style={S.deadZoneBanner}>
                <Text style={S.deadZoneText}>
                  🌙 Between day end & start — log to yesterday or today
                </Text>
              </View>
            )}

            {/* Plan progress */}
            <View style={S.progressWrap}>
              <Text style={S.progressLabel}>
                Day {Math.max(1, dayIndex + 1)} of {planKeys.length} · {progressPct}% · {setup.startCigs}→0
              </Text>
              <View style={S.progressTrack}>
                <View style={[S.progressFill, { width: `${progressPct}%` }]} />
              </View>
            </View>

            {/* Circle */}
            <View style={S.circleWrap}>
              <Svg width={220} height={220} viewBox="0 0 200 200">
                <Circle cx="100" cy="100" r={circleR}
                  stroke="#1e1b2e" strokeWidth="15" fill="none" />
                <Circle cx="100" cy="100" r={circleR}
                  stroke={statusColor} strokeWidth="15" fill="none"
                  strokeDasharray={circleC}
                  strokeDashoffset={circleOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 100 100)"
                />
              </Svg>
              <View style={S.circleText}>
                <Text style={S.countNum}>{smokedToday}</Text>
                <Text style={S.countDen}>/ {todayAllowance}</Text>
                <Text style={S.countSub}>smoked today</Text>
              </View>
            </View>

            {/* Status */}
            <View style={[S.statusBadge, { borderColor: statusColor + "55" }]}>
              <Text style={[S.statusText, { color: statusColor }]}>{statusText}</Text>
            </View>

            {/* Chips */}
            <View style={S.chipsRow}>
              <View style={S.chip}>
                <Text style={S.chipVal}>{fmtCountdown(secsLeft)}</Text>
                <Text style={S.chipLabel}>DAY ENDS</Text>
              </View>
              <View style={S.chip}>
                <Text style={S.chipVal}>{remaining > 0 ? remaining : "Done ✓"}</Text>
                <Text style={S.chipLabel}>REMAINING</Text>
              </View>
            </View>

            {/* LOG BUTTON — color reflects readiness */}
            <TouchableOpacity
              style={[S.smokeBtn, { backgroundColor: cigBtnColor, borderColor: cigBtnBorder }]}
              onPress={handleLogPress}
              activeOpacity={0.8}
            >
              <Text style={[S.smokeBtnText, { color: cigBtnTextColor }]}>
                {cigBtnReady ? "✅  LOG CIGARETTE" : "🚬  LOG CIGARETTE"}
              </Text>
              {lastCigTime && !cigBtnReady && (
                <Text style={S.smokeBtnSub}>
                  Last: {fmtTime(lastCigTime)} · wait {fmtCountdown(Math.max(0, nextCigSecs - secsSinceLastCig))}
                </Text>
              )}
              {lastCigTime && cigBtnReady && (
                <Text style={[S.smokeBtnSub, { color: "#86efac" }]}>
                  Last: {fmtTime(lastCigTime)} · interval elapsed ✓
                </Text>
              )}
            </TouchableOpacity>

            {/* Today log */}
            {todayLogs.length > 0 && (
              <View style={S.card}>
                <View style={S.cardHeader}>
                  <Text style={S.cardTitle}>Today's log · {smokedToday} entries</Text>
                  <TouchableOpacity onPress={() => removeLast(logicalDay)}>
                    <Text style={S.removeBtn}>Remove last</Text>
                  </TouchableOpacity>
                </View>
                <TodayTimeline
                  logs={todayLogs}
                  startHour={setup.startHour}
                  startMin={setup.startMin}
                  endHour={setup.endHour}
                  endMin={setup.endMin}
                />
              </View>
            )}
          </>
        ) : (
          <StatsView logs={logs} plan={plan} setup={setup} now={now} />
        )}
      </ScrollView>

      {/* Day choice modal (dead zone) */}
      <Modal visible={dayChoiceVisible} transparent animationType="fade">
        <View style={S.choiceOverlay}>
          <View style={S.choiceBox}>
            <Text style={S.choiceTitle}>Which day?</Text>
            <Text style={S.choiceSubtitle}>
              You're between day end ({pad(setup.endHour)}:{pad(setup.endMin)}) and
              start ({pad(setup.startHour)}:{pad(setup.startMin)}).
            </Text>
            <TouchableOpacity style={S.choiceBtn} onPress={() => {
              setDayChoiceVisible(false);
              doLog(yesterdayKey);
            }}>
              <Text style={S.choiceBtnText}>Add to yesterday</Text>
              <Text style={S.choiceBtnSub}>{yesterdayKey}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.choiceBtn, { borderColor: "#4ade80" }]} onPress={() => {
              setDayChoiceVisible(false);
              doLog(todayCalKey);
            }}>
              <Text style={[S.choiceBtnText, { color: "#4ade80" }]}>Start today early</Text>
              <Text style={S.choiceBtnSub}>{todayCalKey}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.cancelBtn} onPress={() => setDayChoiceVisible(false)}>
              <Text style={S.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Setup modal */}
      <SetupModal
        visible={showSetup}
        initial={setup}
        onSave={saveSetup}
        onClose={() => setShowSetup(false)}
      />
    </SafeAreaView>
  );
}

// ─── Today Timeline ───────────────────────────────────────────────────────────

function TodayTimeline({ logs, startHour, startMin, endHour, endMin }) {
  const W = SW - 64, H = 72, PAD = 16, cW = W - PAD * 2;
  const now = new Date();

  // Build start and end as Date objects
  const dayStart = new Date(now); dayStart.setHours(startHour, startMin, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(endHour, endMin, 0, 0);
  // If end < start, end is next day
  if (dayEnd <= dayStart) dayEnd.setDate(dayEnd.getDate() + 1);
  const total = dayEnd - dayStart;

  const xFor = (iso) => {
    const t = new Date(iso);
    return PAD + Math.max(0, Math.min(1, (t - dayStart) / total)) * cW;
  };
  const nowX = xFor(now.toISOString());
  const dots = logs.map(iso => ({ x: xFor(iso), t: fmtTime(iso) }));

  return (
    <Svg width={W} height={H}>
      <Rect x={PAD} y={34} width={cW} height={4} rx={2} fill="#1e1b2e" />
      <Rect x={PAD} y={34} width={Math.max(0, nowX - PAD)} height={4} rx={2} fill="#3b2d60" />
      <Line x1={nowX} y1={24} x2={nowX} y2={42} stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="3,2" />
      <SvgText x={nowX} y={20} textAnchor="middle" fill="#a78bfa" fontSize={9}>now</SvgText>
      {dots.map((d, i) => (
        <G key={i}>
          <Circle cx={d.x} cy={36} r={6} fill="#7c3aed" />
          <SvgText x={d.x} y={15} textAnchor="middle" fill="#d4b8ff" fontSize={8}>{d.t}</SvgText>
          <Line x1={d.x} y1={17} x2={d.x} y2={30} stroke="#5b3fa0" strokeWidth={1} />
        </G>
      ))}
      <Circle cx={PAD + cW} cy={36} r={4} fill="#2d2540" stroke="#5b3fa0" strokeWidth={1.5} />
      <SvgText x={PAD} y={60} fill="#5e4d80" fontSize={8}>{pad(startHour)}:{pad(startMin)}</SvgText>
      <SvgText x={PAD + cW} y={60} textAnchor="end" fill="#5e4d80" fontSize={8}>{pad(endHour)}:{pad(endMin)}</SvgText>
    </Svg>
  );
}

// ─── Stats View ───────────────────────────────────────────────────────────────

function StatsView({ logs, plan, setup, now }) {
  const [chartType, setChartType] = useState("bar");
  const week = last7LogicalDays(setup);
  const wd = week.map(d => {
    const key = dateKey(d);
    return {
      key, d,
      day: fmtDayShort(d),
      date: fmtDateShort(d),
      smoked: (logs[key] || []).length,
      allowance: getAllowance(plan, key, setup.startCigs),
      isToday: key === getLogicalDay(now, setup),
    };
  });

  const totalSmoked = wd.reduce((s, d) => s + d.smoked, 0);
  const totalAllow = wd.reduce((s, d) => s + d.allowance, 0);
  const onTarget = wd.filter(d => d.smoked <= d.allowance).length;
  const best = [...wd].sort((a, b) => a.smoked - b.smoked)[0];

  return (
    <View style={{ width: "100%" }}>
      <View style={S.summaryRow}>
        <View style={S.summaryCard}>
          <Text style={S.summaryVal}>{totalSmoked}</Text>
          <Text style={S.summaryLbl}>WEEK SMOKED</Text>
          <Text style={S.summarySub}>/ {totalAllow} limit</Text>
        </View>
        <View style={S.summaryCard}>
          <Text style={[S.summaryVal, { color: "#4ade80" }]}>{onTarget}/7</Text>
          <Text style={S.summaryLbl}>ON TARGET</Text>
          <Text style={S.summarySub}>days</Text>
        </View>
        <View style={S.summaryCard}>
          <Text style={[S.summaryVal, { color: "#a78bfa" }]}>{best?.smoked ?? 0}</Text>
          <Text style={S.summaryLbl}>BEST DAY</Text>
          <Text style={S.summarySub}>{best?.day ?? "—"}</Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Last 7 days</Text>
        <View style={S.chartTabs}>
          {[["bar","📊 Bar"],["area","📈 Area"],["heat","🟣 Heat"]].map(([t, label]) => (
            <TouchableOpacity key={t} onPress={() => setChartType(t)}
              style={[S.chartTab, chartType === t && S.chartTabActive]}>
              <Text style={[S.chartTabText, chartType === t && S.chartTabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {chartType === "bar"  && <WeekBarChart wd={wd} />}
        {chartType === "area" && <WeekAreaChart wd={wd} />}
        {chartType === "heat" && <WeekHeatmap wd={wd} />}
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Day breakdown</Text>
        {[...wd].reverse().map(d => {
          const over = d.smoked > d.allowance;
          const diff = d.smoked - d.allowance;
          return (
            <View key={d.key} style={S.histRow}>
              <View>
                <Text style={[S.histDay, d.isToday && { color: "#d4b8ff" }]}>
                  {d.day}{d.isToday ? "  today" : ""}
                </Text>
                <Text style={S.histDate}>{d.date} · limit: {d.allowance}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[S.histSmoked, { color: over ? "#f87171" : "#4ade80" }]}>{d.smoked}</Text>
                <Text style={S.histDiff}>
                  {diff === 0 ? "✓ on target" : diff > 0 ? `+${diff} over` : `${Math.abs(diff)} under`}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function WeekBarChart({ wd }) {
  const W = SW - 64, H = 140;
  const PL=28, PR=8, PT=20, PB=34, cW=W-PL-PR, cH=H-PT-PB;
  const n=wd.length, sp=cW/n, bW=sp*0.45;
  const mv=Math.max(...wd.map(d=>Math.max(d.smoked,d.allowance)),1);
  return (
    <Svg width={W} height={H}>
      {[0,.5,1].map(f=>(
        <Line key={f} x1={PL} y1={PT+cH*(1-f)} x2={PL+cW} y2={PT+cH*(1-f)} stroke="#1e1b2e" strokeWidth={1}/>
      ))}
      {wd.map((d,i)=>{
        const cx=PL+i*sp+sp/2, aH=(d.allowance/mv)*cH, sH=(d.smoked/mv)*cH, ov=d.smoked>d.allowance;
        return(
          <G key={i}>
            <Rect x={cx-bW/2-2} y={PT+cH-aH} width={bW+4} height={aH} rx={4} fill="#1e1b2e" opacity={0.9}/>
            <Rect x={cx-bW/2} y={PT+cH-sH} width={bW} height={sH} rx={4}
              fill={ov?"#f87171":"#7c3aed"} opacity={d.isToday?1:0.75}/>
            {d.smoked>0&&<SvgText x={cx} y={PT+cH-sH-4} textAnchor="middle"
              fill={ov?"#f87171":"#a78bfa"} fontSize={10} fontWeight="bold">{d.smoked}</SvgText>}
            <SvgText x={cx} y={H-PB+14} textAnchor="middle"
              fill={d.isToday?"#d4b8ff":"#5e4d80"} fontSize={11}
              fontWeight={d.isToday?"bold":"normal"}>{d.day}</SvgText>
          </G>
        );
      })}
      <Line x1={PL} y1={PT} x2={PL} y2={PT+cH} stroke="#2d2540" strokeWidth={1}/>
      <Line x1={PL} y1={PT+cH} x2={PL+cW} y2={PT+cH} stroke="#2d2540" strokeWidth={1}/>
      <SvgText x={PL-4} y={PT+4} textAnchor="end" fill="#5e4d80" fontSize={8}>{mv}</SvgText>
    </Svg>
  );
}

function WeekAreaChart({ wd }) {
  const W=SW-64, H=140, PL=28, PR=8, PT=20, PB=34, cW=W-PL-PR, cH=H-PT-PB, n=wd.length;
  const mv=Math.max(...wd.map(d=>Math.max(d.smoked,d.allowance)),1);
  const px=i=>PL+(i/(n-1))*cW, py=v=>PT+cH-(v/mv)*cH;
  const sL=wd.map((d,i)=>`${i===0?"M":"L"}${px(i).toFixed(1)},${py(d.smoked).toFixed(1)}`).join(" ");
  const aL=wd.map((d,i)=>`${i===0?"M":"L"}${px(i).toFixed(1)},${py(d.allowance).toFixed(1)}`).join(" ");
  const sA=`${sL} L${px(n-1)},${py(0)} L${px(0)},${py(0)} Z`;
  return (
    <Svg width={W} height={H}>
      {[0,.5,1].map(f=>(
        <Line key={f} x1={PL} y1={PT+cH*(1-f)} x2={PL+cW} y2={PT+cH*(1-f)} stroke="#1e1b2e" strokeWidth={1}/>
      ))}
      <Path d={sA} fill="#7c3aed" fillOpacity={0.2}/>
      <Path d={aL} fill="none" stroke="#2d2540" strokeWidth={1.5} strokeDasharray="4,3"/>
      <Path d={sL} fill="none" stroke="#7c3aed" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      {wd.map((d,i)=>{
        const ov=d.smoked>d.allowance;
        return(
          <G key={i}>
            <Circle cx={px(i)} cy={py(d.smoked)} r={4.5} fill={ov?"#f87171":"#7c3aed"} stroke="#0f0c1a" strokeWidth={1.5}/>
            <SvgText x={px(i)} y={py(d.smoked)-9} textAnchor="middle"
              fill={ov?"#f87171":"#d4b8ff"} fontSize={9} fontWeight="bold">{d.smoked}</SvgText>
            <SvgText x={px(i)} y={H-PB+14} textAnchor="middle"
              fill={d.isToday?"#d4b8ff":"#5e4d80"} fontSize={11}>{d.day}</SvgText>
          </G>
        );
      })}
      <Line x1={PL} y1={PT} x2={PL} y2={PT+cH} stroke="#2d2540" strokeWidth={1}/>
      <Line x1={PL} y1={PT+cH} x2={PL+cW} y2={PT+cH} stroke="#2d2540" strokeWidth={1}/>
      <SvgText x={PL-4} y={PT+4} textAnchor="end" fill="#5e4d80" fontSize={8}>{mv}</SvgText>
    </Svg>
  );
}

function WeekHeatmap({ wd }) {
  const W=SW-64, H=110, cW=W/7, cH=66, top=4;
  return (
    <Svg width={W} height={H}>
      {wd.map((d,i)=>{
        const x=i*cW, ov=d.smoked>d.allowance, nd=d.smoked===0;
        const r=d.allowance>0?d.smoked/d.allowance:0;
        const op=nd?0:ov?Math.min(.85,.35+r*.25):0.2+r*.7;
        const fc=nd?"#16122a":ov?"#f87171":"#7c3aed";
        return(
          <G key={i}>
            <Rect x={x+3} y={top} width={cW-6} height={cH} rx={10}
              fill={fc} fillOpacity={op}
              stroke={d.isToday?"#a78bfa":"#1e1b2e"} strokeWidth={d.isToday?2:1}/>
            <SvgText x={x+cW/2} y={top+27} textAnchor="middle"
              fill={nd?"#3b2d60":"#e8e0ff"} fontSize={20} fontWeight="bold">{d.smoked}</SvgText>
            <SvgText x={x+cW/2} y={top+41} textAnchor="middle"
              fill={ov?"#f87171":"#5e4d80"} fontSize={9}>/{d.allowance}</SvgText>
            <Circle cx={x+cW/2} cy={top+54} r={3.5}
              fill={nd?"#2d2540":ov?"#f87171":"#4ade80"}/>
            <SvgText x={x+cW/2} y={top+cH+15} textAnchor="middle"
              fill={d.isToday?"#d4b8ff":"#5e4d80"} fontSize={10}>{d.day}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Time Picker Row ──────────────────────────────────────────────────────────
// Cross-platform time picker using DateTimePicker

function TimePickerRow({ label, hour, minute, onChange }) {
  const [show, setShow] = useState(false);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  const handleChange = (event, selected) => {
    if (Platform.OS === "android") setShow(false);
    if (selected) {
      onChange(selected.getHours(), selected.getMinutes());
    }
  };

  return (
    <View style={S.setupRow}>
      <Text style={S.setupLabel}>{label}</Text>
      <TouchableOpacity style={S.timePickerBtn} onPress={() => setShow(true)}>
        <Text style={S.timePickerText}>{pad(hour)}:{pad(minute)}</Text>
        <Text style={S.timePickerIcon}>🕐</Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={date}
          mode="time"
          is24Hour={true}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleChange}
          themeVariant="dark"
        />
      )}
    </View>
  );
}

// ─── Setup Modal ──────────────────────────────────────────────────────────────

function SetupModal({ visible, initial, onSave, onClose }) {
  const [cigs, setCigs] = useState(initial.startCigs);
  const [days, setDays] = useState(initial.durationDays);
  const [startHour, setStartHour] = useState(initial.startHour ?? 7);
  const [startMin, setStartMin]   = useState(initial.startMin  ?? 0);
  const [endHour, setEndHour]     = useState(initial.endHour   ?? 1);
  const [endMin, setEndMin]       = useState(initial.endMin    ?? 0);

  useEffect(() => {
    setCigs(initial.startCigs);
    setDays(initial.durationDays);
    setStartHour(initial.startHour ?? 7);
    setStartMin(initial.startMin  ?? 0);
    setEndHour(initial.endHour   ?? 1);
    setEndMin(initial.endMin    ?? 0);
  }, [initial]);

  const intervalDays = (days / cigs).toFixed(1);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={S.modalOverlay}>
        <ScrollView>
          <View style={S.modalBox}>
            <Text style={S.modalTitle}>Your Quit Plan</Text>

            {/* Cigs stepper */}
            <View style={S.setupRow}>
              <Text style={S.setupLabel}>Cigarettes per day now</Text>
              <View style={S.stepperRow}>
                <TouchableOpacity onPress={() => setCigs(v => Math.max(1, v - 1))} style={S.stepBtn}>
                  <Text style={S.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={S.stepVal}>{cigs}</Text>
                <TouchableOpacity onPress={() => setCigs(v => v + 1)} style={S.stepBtn}>
                  <Text style={S.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Days stepper */}
            <View style={S.setupRow}>
              <Text style={S.setupLabel}>Goal duration (days)</Text>
              <View style={S.stepperRow}>
                <TouchableOpacity onPress={() => setDays(v => Math.max(7, v - 7))} style={S.stepBtn}>
                  <Text style={S.stepBtnText}>−7</Text>
                </TouchableOpacity>
                <Text style={S.stepVal}>{days}d</Text>
                <TouchableOpacity onPress={() => setDays(v => v + 7)} style={S.stepBtn}>
                  <Text style={S.stepBtnText}>+7</Text>
                </TouchableOpacity>
              </View>
              <Text style={S.hint}>Reduce 1 cig every ≈{intervalDays} days</Text>
            </View>

            {/* Start of day time picker */}
            <TimePickerRow
              label="Start of day"
              hour={startHour} minute={startMin}
              onChange={(h, m) => { setStartHour(h); setStartMin(m); }}
            />

            {/* End of day time picker */}
            <TimePickerRow
              label="End of day"
              hour={endHour} minute={endMin}
              onChange={(h, m) => { setEndHour(h); setEndMin(m); }}
            />

            <Text style={[S.hint, { marginBottom: 8 }]}>
              💡 If end time is before start (e.g. start 07:00, end 01:00), the day crosses midnight.
            </Text>

            <TouchableOpacity style={S.saveBtn} onPress={() => onSave({
              startCigs: cigs,
              durationDays: days,
              startHour, startMin,
              endHour, endMin,
              startDate: initial.startDate || dateKey(new Date()),
            })}>
              <Text style={S.saveBtnText}>Save Plan</Text>
            </TouchableOpacity>

            {onClose && (
              <TouchableOpacity style={S.cancelBtn} onPress={onClose}>
                <Text style={S.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0c1a" },

  header: { flexDirection:"row", justifyContent:"space-between", alignItems:"center",
    paddingHorizontal:20, paddingVertical:14, borderBottomWidth:1, borderBottomColor:"#1e1b2e" },
  logo: { color:"#e8e0ff", fontSize:18, fontWeight:"900", letterSpacing:0.5 },
  headerRight: { flexDirection:"row", alignItems:"center", gap:12 },
  tabs: { flexDirection:"row", gap:14 },
  tab: { color:"#5e4d80", fontWeight:"bold", fontSize:14 },
  activeTab: { color:"#a78bfa" },
  settingsBtn: { padding:4 },
  settingsIcon: { fontSize:20, color:"#5e4d80" },

  content: { padding:20, alignItems:"center", paddingBottom:40 },

  deadZoneBanner: { width:"100%", backgroundColor:"#1a1520", borderWidth:1,
    borderColor:"#3b2d60", borderRadius:10, padding:10, marginBottom:12 },
  deadZoneText: { color:"#9880cc", fontSize:12, textAlign:"center" },

  progressWrap: { width:"100%", marginBottom:8 },
  progressLabel: { color:"#5e4d80", fontSize:12, marginBottom:6 },
  progressTrack: { height:4, backgroundColor:"#1e1b2e", borderRadius:2, width:"100%" },
  progressFill: { height:4, backgroundColor:"#5b3fa0", borderRadius:2 },

  circleWrap: { marginVertical:20, justifyContent:"center", alignItems:"center" },
  circleText: { position:"absolute", alignItems:"center" },
  countNum: { color:"#fff", fontSize:56, fontWeight:"800", lineHeight:60 },
  countDen: { color:"#5e4d80", fontSize:20, fontWeight:"400" },
  countSub: { color:"#9880cc", fontSize:13, marginTop:2 },

  statusBadge: { borderWidth:1, borderRadius:12, paddingHorizontal:18,
    paddingVertical:10, marginBottom:16 },
  statusText: { fontSize:15, fontWeight:"700", textAlign:"center" },

  chipsRow: { flexDirection:"row", gap:12, width:"100%", marginBottom:20 },
  chip: { flex:1, backgroundColor:"#16122a", borderWidth:1, borderColor:"#2d2540",
    borderRadius:14, padding:14, alignItems:"center" },
  chipVal: { color:"#e8e0ff", fontSize:18, fontWeight:"700" },
  chipLabel: { color:"#9880cc", fontSize:10, marginTop:2, letterSpacing:0.5 },

  smokeBtn: { width:"100%", padding:18, borderRadius:16, borderWidth:1.5,
    alignItems:"center", marginBottom:4 },
  smokeBtnText: { fontSize:17, fontWeight:"800", letterSpacing:0.5 },
  smokeBtnSub: { fontSize:11, color:"#fca5a5", marginTop:4 },

  card: { backgroundColor:"#16122a", width:"100%", padding:16, borderRadius:20,
    marginTop:16, borderWidth:1, borderColor:"#2d2540" },
  cardHeader: { flexDirection:"row", justifyContent:"space-between",
    alignItems:"center", marginBottom:12 },
  cardTitle: { color:"#9880cc", fontSize:13, fontWeight:"600" },
  removeBtn: { color:"#5e4d80", fontSize:12, textDecorationLine:"underline" },

  chartTabs: { flexDirection:"row", gap:6, marginBottom:14, marginTop:8 },
  chartTab: { flex:1, backgroundColor:"#16122a", borderWidth:1, borderColor:"#2d2540",
    borderRadius:10, padding:8, alignItems:"center" },
  chartTabActive: { backgroundColor:"#2d2540", borderColor:"#5b3fa0" },
  chartTabText: { color:"#5e4d80", fontSize:11 },
  chartTabTextActive: { color:"#d4b8ff" },

  summaryRow: { flexDirection:"row", gap:8, width:"100%", marginBottom:12 },
  summaryCard: { flex:1, backgroundColor:"#16122a", borderWidth:1, borderColor:"#2d2540",
    borderRadius:14, padding:12, alignItems:"center" },
  summaryVal: { color:"#d4b8ff", fontSize:22, fontWeight:"800" },
  summaryLbl: { color:"#9880cc", fontSize:9, marginTop:3, letterSpacing:0.5 },
  summarySub: { color:"#3b2d60", fontSize:9, marginTop:1 },

  histRow: { flexDirection:"row", justifyContent:"space-between", alignItems:"center",
    paddingVertical:10, borderBottomWidth:1, borderBottomColor:"#1e1b2e" },
  histDay: { color:"#e8e0ff", fontSize:15, fontWeight:"600" },
  histDate: { color:"#5e4d80", fontSize:12, marginTop:1 },
  histSmoked: { fontSize:18, fontWeight:"700" },
  histDiff: { color:"#5e4d80", fontSize:11, marginTop:1 },

  // Day choice modal
  choiceOverlay: { flex:1, backgroundColor:"#000000bb", justifyContent:"center",
    paddingHorizontal:24 },
  choiceBox: { backgroundColor:"#16122a", borderRadius:20, padding:24,
    borderWidth:1, borderColor:"#2d2540" },
  choiceTitle: { color:"#e8e0ff", fontSize:20, fontWeight:"800", marginBottom:8 },
  choiceSubtitle: { color:"#9880cc", fontSize:13, marginBottom:20, lineHeight:20 },
  choiceBtn: { borderWidth:1.5, borderColor:"#a78bfa", borderRadius:14,
    padding:16, marginBottom:10, alignItems:"center" },
  choiceBtnText: { color:"#a78bfa", fontSize:16, fontWeight:"700" },
  choiceBtnSub: { color:"#5e4d80", fontSize:11, marginTop:3 },

  // Setup modal
  modalOverlay: { flex:1, backgroundColor:"#000000aa", justifyContent:"flex-end" },
  modalBox: { backgroundColor:"#16122a", borderTopLeftRadius:24,
    borderTopRightRadius:24, padding:28, borderWidth:1, borderColor:"#2d2540" },
  modalTitle: { color:"#e8e0ff", fontSize:22, fontWeight:"800",
    marginBottom:24, letterSpacing:-0.5 },

  setupRow: { marginBottom:22 },
  setupLabel: { color:"#9880cc", fontSize:12, textTransform:"uppercase",
    letterSpacing:0.5, marginBottom:8 },
  stepperRow: { flexDirection:"row", alignItems:"center", gap:12 },
  stepBtn: { backgroundColor:"#1e1b2e", borderWidth:1, borderColor:"#2d2540",
    borderRadius:10, width:44, height:44, justifyContent:"center", alignItems:"center" },
  stepBtnText: { color:"#d4b8ff", fontSize:18, fontWeight:"600" },
  stepVal: { color:"#e8e0ff", fontSize:28, fontWeight:"700", minWidth:60, textAlign:"center" },
  hint: { color:"#5e4d80", fontSize:12, marginTop:6 },

  timePickerBtn: { flexDirection:"row", alignItems:"center", backgroundColor:"#0f0c1a",
    borderWidth:1, borderColor:"#2d2540", borderRadius:12,
    paddingHorizontal:16, paddingVertical:12, alignSelf:"flex-start", gap:10 },
  timePickerText: { color:"#e8e0ff", fontSize:24, fontWeight:"700", letterSpacing:2 },
  timePickerIcon: { fontSize:18 },

  saveBtn: { backgroundColor:"#7c3aed", borderRadius:14, padding:18,
    alignItems:"center", marginTop:8 },
  saveBtnText: { color:"#fff", fontSize:17, fontWeight:"800" },
  cancelBtn: { alignItems:"center", padding:12, marginTop:4 },
  cancelBtnText: { color:"#5e4d80", fontSize:14 },
});
