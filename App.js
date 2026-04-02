import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView,
  SafeAreaView, Dimensions, StatusBar, Vibration, Modal,
  TextInput, Platform
} from "react-native";
import Svg, { Circle, Line, Rect, G, Text as SvgText, Path, Defs, LinearGradient, Stop } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SW } = Dimensions.get("window");
const STORAGE_KEY = "@quitflow_data_v3";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDayShort = (d) => d.toLocaleDateString("en-GB", { weekday: "short" });
const fmtDateShort = (d) => `${d.getDate()}/${d.getMonth() + 1}`;

// Minutes until end-of-day cutoff
function minutesUntilEnd(endHour, endMin) {
  const now = new Date();
  const end = new Date();
  end.setHours(endHour, endMin, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return Math.max(0, Math.floor((end - now) / 60000));
}

// Build plan: array of { key, allowance } for each day
function buildPlan(startDateStr, startCigs, durationDays) {
  const plan = {};
  const interval = durationDays / startCigs;
  for (let i = 0; i < durationDays; i++) {
    const d = new Date(startDateStr);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    plan[key] = Math.max(0, Math.round(startCigs - (i + 1) / interval));
  }
  return plan;
}

function getAllowance(plan, key, startCigs) {
  if (plan && plan[key] !== undefined) return plan[key];
  return startCigs; // fallback before plan is set
}

function last7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const DEFAULT_SETUP = {
  startCigs: 20,
  durationDays: 90,
  endHour: 1,
  endMin: 0,
  startDate: dateKey(new Date()),
};

export default function App() {
  const [logs, setLogs] = useState({});
  const [setup, setSetup] = useState(DEFAULT_SETUP);
  const [plan, setPlan] = useState({});
  const [view, setView] = useState("today");
  const [showSetup, setShowSetup] = useState(false);
  const [now, setNow] = useState(new Date());

  // Tick every 30s to refresh "next cig" countdown
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Load from storage
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.logs) setLogs(p.logs);
        if (p.setup) {
          setSetup(p.setup);
          setPlan(buildPlan(p.setup.startDate, p.setup.startCigs, p.setup.durationDays));
        }
      } else {
        // First launch — show setup
        setShowSetup(true);
      }
    })();
  }, []);

  const persist = useCallback(async (newLogs, newSetup) => {
    const toSave = { logs: newLogs, setup: newSetup || setup };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [setup]);

  const saveSetup = async (newSetup) => {
    const newPlan = buildPlan(newSetup.startDate, newSetup.startCigs, newSetup.durationDays);
    setSetup(newSetup);
    setPlan(newPlan);
    setShowSetup(false);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ logs, setup: newSetup }));
  };

  const today = dateKey(now);
  const todayLogs = logs[today] || [];
  const smokedToday = todayLogs.length;
  const todayAllowance = getAllowance(plan, today, setup.startCigs);
  const remaining = Math.max(0, todayAllowance - smokedToday);

  // Next cigarette interval
  const minsLeft = minutesUntilEnd(setup.endHour, setup.endMin);
  const nextCigMins = remaining > 0 ? Math.floor(minsLeft / remaining) : null;

  // Overall plan progress
  const planKeys = Object.keys(plan);
  const dayIndex = planKeys.indexOf(today);
  const progressPct = planKeys.length > 0 ? Math.round(((dayIndex + 1) / planKeys.length) * 100) : 0;

  const addCig = () => {
    Vibration.vibrate(50);
    const newTodayLogs = [...todayLogs, new Date().toISOString()];
    const newLogs = { ...logs, [today]: newTodayLogs };
    setLogs(newLogs);
    persist(newLogs);
  };

  const removeLast = () => {
    if (!todayLogs.length) return;
    Vibration.vibrate(30);
    const newTodayLogs = todayLogs.slice(0, -1);
    const newLogs = { ...logs, [today]: newTodayLogs };
    setLogs(newLogs);
    persist(newLogs);
  };

  // Status
  const isOver = smokedToday > todayAllowance;
  const isDone = remaining === 0 && !isOver;
  let statusColor = "#a78bfa";
  let statusText = "";
  if (todayAllowance === 0 && smokedToday === 0) {
    statusColor = "#4ade80"; statusText = "🎉 Smoke-free day!";
  } else if (isOver) {
    statusColor = "#f87171"; statusText = `⚠ ${smokedToday - todayAllowance} over limit`;
  } else if (isDone) {
    statusColor = "#4ade80"; statusText = "✅ Goal reached!";
  } else if (nextCigMins !== null) {
    const h = Math.floor(nextCigMins / 60), m = nextCigMins % 60;
    statusText = `Next in ~${h > 0 ? `${h}h ` : ""}${m}m`;
    statusColor = nextCigMins < 15 ? "#facc15" : "#a78bfa";
  }

  // Circle arc
  const circleR = 90;
  const circleC = 2 * Math.PI * circleR;
  const circlePct = todayAllowance > 0
    ? Math.min(1, smokedToday / todayAllowance)
    : smokedToday > 0 ? 1 : 0;
  const circleOffset = circleC * (1 - circlePct);

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
            {/* Plan progress bar */}
            <View style={S.progressWrap}>
              <Text style={S.progressLabel}>
                Day {Math.max(1, dayIndex + 1)} of {planKeys.length} · {progressPct}% complete · {setup.startCigs} → 0
              </Text>
              <View style={S.progressTrack}>
                <View style={[S.progressFill, { width: `${progressPct}%` }]} />
              </View>
            </View>

            {/* Circle */}
            <View style={S.circleWrap}>
              <Svg width={220} height={220} viewBox="0 0 200 200">
                <Circle cx="100" cy="100" r={circleR} stroke="#1e1b2e" strokeWidth="15" fill="none" />
                <Circle
                  cx="100" cy="100" r={circleR}
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

            {/* Status badge */}
            <View style={[S.statusBadge, { borderColor: statusColor + "55" }]}>
              <Text style={[S.statusText, { color: statusColor }]}>{statusText}</Text>
            </View>

            {/* Chips */}
            <View style={S.chipsRow}>
              <View style={S.chip}>
                <Text style={S.chipVal}>
                  {Math.floor(minsLeft / 60)}h {minsLeft % 60}m
                </Text>
                <Text style={S.chipLabel}>TIME LEFT</Text>
              </View>
              <View style={S.chip}>
                <Text style={S.chipVal}>{remaining > 0 ? remaining : "Done ✓"}</Text>
                <Text style={S.chipLabel}>REMAINING</Text>
              </View>
            </View>

            {/* Log button */}
            <TouchableOpacity style={S.smokeBtn} onPress={addCig} activeOpacity={0.8}>
              <Text style={S.smokeBtnText}>🚬  I JUST SMOKED ONE</Text>
            </TouchableOpacity>

            {/* Today's log */}
            {todayLogs.length > 0 && (
              <View style={S.card}>
                <View style={S.cardHeader}>
                  <Text style={S.cardTitle}>Today's log · {smokedToday} entries</Text>
                  <TouchableOpacity onPress={removeLast}>
                    <Text style={S.removeBtn}>Remove last</Text>
                  </TouchableOpacity>
                </View>
                <TodayTimeline logs={todayLogs} endHour={setup.endHour} endMin={setup.endMin} />
              </View>
            )}
          </>
        ) : (
          <StatsView logs={logs} plan={plan} setup={setup} />
        )}

      </ScrollView>

      {/* Setup Modal */}
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

function TodayTimeline({ logs, endHour, endMin }) {
  const W = SW - 64, H = 70, PAD = 16;
  const cW = W - PAD * 2;
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(6, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(endHour, endMin, 0, 0);
  if (dayEnd <= dayStart) dayEnd.setDate(dayEnd.getDate() + 1);
  const total = dayEnd - dayStart;
  const xFor = (dt) => PAD + Math.max(0, Math.min(1, (new Date(dt) - dayStart) / total)) * cW;
  const nowX = xFor(now);
  const dots = logs.map(iso => ({ x: xFor(iso), t: fmtTime(iso) }));

  return (
    <Svg width={W} height={H}>
      {/* Track */}
      <Rect x={PAD} y={32} width={cW} height={4} rx={2} fill="#1e1b2e" />
      <Rect x={PAD} y={32} width={Math.max(0, nowX - PAD)} height={4} rx={2} fill="#3b2d60" />
      {/* Now marker */}
      <Line x1={nowX} y1={22} x2={nowX} y2={40} stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="3,2" />
      <SvgText x={nowX} y={18} textAnchor="middle" fill="#a78bfa" fontSize={9}>now</SvgText>
      {/* Dots */}
      {dots.map((d, i) => (
        <G key={i}>
          <Circle cx={d.x} cy={34} r={6} fill="#7c3aed" />
          <SvgText x={d.x} y={14} textAnchor="middle" fill="#d4b8ff" fontSize={8}>{d.t}</SvgText>
          <Line x1={d.x} y1={16} x2={d.x} y2={28} stroke="#5b3fa0" strokeWidth={1} />
        </G>
      ))}
      {/* End marker */}
      <Circle cx={PAD + cW} cy={34} r={4} fill="#2d2540" stroke="#5b3fa0" strokeWidth={1.5} />
      <SvgText x={PAD} y={58} fill="#5e4d80" fontSize={8}>06:00</SvgText>
      <SvgText x={PAD + cW} y={58} textAnchor="end" fill="#5e4d80" fontSize={8}>{pad(endHour)}:{pad(endMin)}</SvgText>
    </Svg>
  );
}

// ─── Stats View ───────────────────────────────────────────────────────────────

function StatsView({ logs, plan, setup }) {
  const [chartType, setChartType] = useState("bar");
  const week = last7Days();
  const wd = week.map(d => {
    const key = dateKey(d);
    return {
      key, d,
      day: fmtDayShort(d),
      date: fmtDateShort(d),
      smoked: (logs[key] || []).length,
      allowance: getAllowance(plan, key, setup.startCigs),
      isToday: key === dateKey(new Date()),
    };
  });

  const totalSmoked = wd.reduce((s, d) => s + d.smoked, 0);
  const totalAllow = wd.reduce((s, d) => s + d.allowance, 0);
  const onTarget = wd.filter(d => d.smoked <= d.allowance).length;
  const best = [...wd].sort((a, b) => a.smoked - b.smoked)[0];

  return (
    <View style={{ width: "100%" }}>
      {/* Summary chips */}
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

      {/* Chart switcher */}
      <View style={S.card}>
        <Text style={S.cardTitle}>Last 7 days</Text>
        <View style={S.chartTabs}>
          {["bar", "area", "heat"].map(t => (
            <TouchableOpacity key={t} onPress={() => setChartType(t)}
              style={[S.chartTab, chartType === t && S.chartTabActive]}>
              <Text style={[S.chartTabText, chartType === t && S.chartTabTextActive]}>
                {t === "bar" ? "📊 Bar" : t === "area" ? "📈 Area" : "🟣 Heat"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {chartType === "bar" && <WeekBarChart wd={wd} />}
        {chartType === "area" && <WeekAreaChart wd={wd} />}
        {chartType === "heat" && <WeekHeatmap wd={wd} />}
      </View>

      {/* Day breakdown */}
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

// ─── Week Bar Chart ───────────────────────────────────────────────────────────

function WeekBarChart({ wd }) {
  const W = SW - 64, H = 140;
  const PL = 28, PR = 8, PT = 20, PB = 34;
  const cW = W - PL - PR, cH = H - PT - PB;
  const n = wd.length, sp = cW / n, bW = sp * 0.45;
  const mv = Math.max(...wd.map(d => Math.max(d.smoked, d.allowance)), 1);

  return (
    <Svg width={W} height={H}>
      <Defs>
        <LinearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#7c3aed" />
          <Stop offset="100%" stopColor="#3b2d60" />
        </LinearGradient>
      </Defs>
      {[0, 0.5, 1].map(f => (
        <Line key={f} x1={PL} y1={PT + cH * (1 - f)} x2={PL + cW} y2={PT + cH * (1 - f)} stroke="#1e1b2e" strokeWidth={1} />
      ))}
      {wd.map((d, i) => {
        const cx = PL + i * sp + sp / 2;
        const aH = (d.allowance / mv) * cH;
        const sH = (d.smoked / mv) * cH;
        const over = d.smoked > d.allowance;
        return (
          <G key={i}>
            <Rect x={cx - bW / 2 - 2} y={PT + cH - aH} width={bW + 4} height={aH} rx={4} fill="#1e1b2e" opacity={0.9} />
            <Rect x={cx - bW / 2} y={PT + cH - sH} width={bW} height={sH} rx={4} fill={over ? "#f87171" : "#7c3aed"} opacity={d.isToday ? 1 : 0.75} />
            {d.smoked > 0 && <SvgText x={cx} y={PT + cH - sH - 4} textAnchor="middle" fill={over ? "#f87171" : "#a78bfa"} fontSize={10} fontWeight="bold">{d.smoked}</SvgText>}
            <SvgText x={cx} y={H - PB + 14} textAnchor="middle" fill={d.isToday ? "#d4b8ff" : "#5e4d80"} fontSize={11} fontWeight={d.isToday ? "bold" : "normal"}>{d.day}</SvgText>
          </G>
        );
      })}
      <Line x1={PL} y1={PT} x2={PL} y2={PT + cH} stroke="#2d2540" strokeWidth={1} />
      <Line x1={PL} y1={PT + cH} x2={PL + cW} y2={PT + cH} stroke="#2d2540" strokeWidth={1} />
      <SvgText x={PL - 4} y={PT + 4} textAnchor="end" fill="#5e4d80" fontSize={8}>{mv}</SvgText>
    </Svg>
  );
}

// ─── Week Area Chart ──────────────────────────────────────────────────────────

function WeekAreaChart({ wd }) {
  const W = SW - 64, H = 140;
  const PL = 28, PR = 8, PT = 20, PB = 34;
  const cW = W - PL - PR, cH = H - PT - PB, n = wd.length;
  const mv = Math.max(...wd.map(d => Math.max(d.smoked, d.allowance)), 1);
  const px = i => PL + (i / (n - 1)) * cW;
  const py = v => PT + cH - (v / mv) * cH;

  const sLine = wd.map((d, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(d.smoked).toFixed(1)}`).join(" ");
  const aLine = wd.map((d, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(d.allowance).toFixed(1)}`).join(" ");
  const sArea = `${sLine} L${px(n - 1)},${py(0)} L${px(0)},${py(0)} Z`;

  return (
    <Svg width={W} height={H}>
      {[0, 0.5, 1].map(f => (
        <Line key={f} x1={PL} y1={PT + cH * (1 - f)} x2={PL + cW} y2={PT + cH * (1 - f)} stroke="#1e1b2e" strokeWidth={1} />
      ))}
      <Path d={sArea} fill="#7c3aed" fillOpacity={0.2} />
      <Path d={aLine} fill="none" stroke="#2d2540" strokeWidth={1.5} strokeDasharray="4,3" />
      <Path d={sLine} fill="none" stroke="#7c3aed" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {wd.map((d, i) => {
        const over = d.smoked > d.allowance;
        return (
          <G key={i}>
            <Circle cx={px(i)} cy={py(d.smoked)} r={4.5} fill={over ? "#f87171" : "#7c3aed"} stroke="#0f0c1a" strokeWidth={1.5} />
            <SvgText x={px(i)} y={py(d.smoked) - 9} textAnchor="middle" fill={over ? "#f87171" : "#d4b8ff"} fontSize={9} fontWeight="bold">{d.smoked}</SvgText>
            <SvgText x={px(i)} y={H - PB + 14} textAnchor="middle" fill={d.isToday ? "#d4b8ff" : "#5e4d80"} fontSize={11}>{d.day}</SvgText>
          </G>
        );
      })}
      <Line x1={PL} y1={PT} x2={PL} y2={PT + cH} stroke="#2d2540" strokeWidth={1} />
      <Line x1={PL} y1={PT + cH} x2={PL + cW} y2={PT + cH} stroke="#2d2540" strokeWidth={1} />
      <SvgText x={PL - 4} y={PT + 4} textAnchor="end" fill="#5e4d80" fontSize={8}>{mv}</SvgText>
    </Svg>
  );
}

// ─── Week Heatmap ─────────────────────────────────────────────────────────────

function WeekHeatmap({ wd }) {
  const W = SW - 64, H = 110;
  const cW = W / 7, cH = 66, top = 4;

  return (
    <Svg width={W} height={H}>
      {wd.map((d, i) => {
        const x = i * cW;
        const over = d.smoked > d.allowance;
        const noData = d.smoked === 0;
        const ratio = d.allowance > 0 ? d.smoked / d.allowance : 0;
        const fillOpacity = noData ? 0 : over
          ? Math.min(0.85, 0.35 + ratio * 0.25)
          : 0.2 + ratio * 0.7;
        const fillColor = noData ? "#16122a" : over ? "#f87171" : "#7c3aed";

        return (
          <G key={i}>
            <Rect x={x + 3} y={top} width={cW - 6} height={cH} rx={10}
              fill={fillColor} fillOpacity={fillOpacity}
              stroke={d.isToday ? "#a78bfa" : "#1e1b2e"} strokeWidth={d.isToday ? 2 : 1} />
            <SvgText x={x + cW / 2} y={top + 27} textAnchor="middle"
              fill={noData ? "#3b2d60" : "#e8e0ff"} fontSize={20} fontWeight="bold">{d.smoked}</SvgText>
            <SvgText x={x + cW / 2} y={top + 41} textAnchor="middle"
              fill={over ? "#f87171" : "#5e4d80"} fontSize={9}>/{d.allowance}</SvgText>
            <Circle cx={x + cW / 2} cy={top + 54} r={3.5}
              fill={noData ? "#2d2540" : over ? "#f87171" : "#4ade80"} />
            <SvgText x={x + cW / 2} y={top + cH + 15} textAnchor="middle"
              fill={d.isToday ? "#d4b8ff" : "#5e4d80"} fontSize={10}>{d.day}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Setup Modal ──────────────────────────────────────────────────────────────

function SetupModal({ visible, initial, onSave, onClose }) {
  const [cigs, setCigs] = useState(String(initial.startCigs));
  const [days, setDays] = useState(String(initial.durationDays));
  const [endHour, setEndHour] = useState(String(initial.endHour));
  const [endMin, setEndMin] = useState(String(initial.endMin));

  useEffect(() => {
    setCigs(String(initial.startCigs));
    setDays(String(initial.durationDays));
    setEndHour(String(initial.endHour));
    setEndMin(String(initial.endMin));
  }, [initial]);

  const intVal = (s, fallback) => { const n = parseInt(s); return isNaN(n) ? fallback : n; };
  const intervalDays = (intVal(days, 90) / intVal(cigs, 20)).toFixed(1);

  const handleSave = () => {
    onSave({
      startCigs: intVal(cigs, 20),
      durationDays: intVal(days, 90),
      endHour: intVal(endHour, 1),
      endMin: intVal(endMin, 0),
      startDate: initial.startDate || dateKey(new Date()),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={S.modalOverlay}>
        <View style={S.modalBox}>
          <Text style={S.modalTitle}>Your Quit Plan</Text>

          <SetupRow label="Cigarettes per day now">
            <View style={S.stepperRow}>
              <TouchableOpacity onPress={() => setCigs(v => String(Math.max(1, intVal(v, 20) - 1)))} style={S.stepBtn}>
                <Text style={S.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={S.stepVal}>{cigs}</Text>
              <TouchableOpacity onPress={() => setCigs(v => String(intVal(v, 20) + 1))} style={S.stepBtn}>
                <Text style={S.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </SetupRow>

          <SetupRow label="Goal duration (days)">
            <View style={S.stepperRow}>
              <TouchableOpacity onPress={() => setDays(v => String(Math.max(7, intVal(v, 90) - 7)))} style={S.stepBtn}>
                <Text style={S.stepBtnText}>−7</Text>
              </TouchableOpacity>
              <Text style={S.stepVal}>{days}d</Text>
              <TouchableOpacity onPress={() => setDays(v => String(intVal(v, 90) + 7))} style={S.stepBtn}>
                <Text style={S.stepBtnText}>+7</Text>
              </TouchableOpacity>
            </View>
            <Text style={S.hint}>Reduce 1 cig every ≈{intervalDays} days</Text>
          </SetupRow>

          <SetupRow label="End of day (hour : min)">
            <View style={S.stepperRow}>
              <TextInput
                style={S.timeInput} keyboardType="number-pad"
                value={endHour} onChangeText={setEndHour} maxLength={2} placeholder="1"
                placeholderTextColor="#5e4d80"
              />
              <Text style={{ color: "#5e4d80", fontSize: 24, marginHorizontal: 8 }}>:</Text>
              <TextInput
                style={S.timeInput} keyboardType="number-pad"
                value={endMin} onChangeText={setEndMin} maxLength={2} placeholder="00"
                placeholderTextColor="#5e4d80"
              />
            </View>
          </SetupRow>

          <TouchableOpacity style={S.saveBtn} onPress={handleSave}>
            <Text style={S.saveBtnText}>Save Plan</Text>
          </TouchableOpacity>

          {onClose && (
            <TouchableOpacity style={S.cancelBtn} onPress={onClose}>
              <Text style={S.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SetupRow({ label, children }) {
  return (
    <View style={S.setupRow}>
      <Text style={S.setupLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0c1a" },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1e1b2e" },
  logo: { color: "#e8e0ff", fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  tabs: { flexDirection: "row", gap: 14 },
  tab: { color: "#5e4d80", fontWeight: "bold", fontSize: 14 },
  activeTab: { color: "#a78bfa" },
  settingsBtn: { padding: 4 },
  settingsIcon: { fontSize: 20, color: "#5e4d80" },

  // Content
  content: { padding: 20, alignItems: "center", paddingBottom: 40 },

  // Progress bar
  progressWrap: { width: "100%", marginBottom: 8 },
  progressLabel: { color: "#5e4d80", fontSize: 12, marginBottom: 6 },
  progressTrack: { height: 4, backgroundColor: "#1e1b2e", borderRadius: 2, width: "100%" },
  progressFill: { height: 4, backgroundColor: "#5b3fa0", borderRadius: 2 },

  // Circle
  circleWrap: { marginVertical: 24, justifyContent: "center", alignItems: "center" },
  circleText: { position: "absolute", alignItems: "center" },
  countNum: { color: "#fff", fontSize: 56, fontWeight: "800", lineHeight: 60 },
  countDen: { color: "#5e4d80", fontSize: 20, fontWeight: "400" },
  countSub: { color: "#9880cc", fontSize: 13, marginTop: 2 },

  // Status
  statusBadge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10, marginBottom: 16 },
  statusText: { fontSize: 15, fontWeight: "700", textAlign: "center" },

  // Chips
  chipsRow: { flexDirection: "row", gap: 12, width: "100%", marginBottom: 20 },
  chip: { flex: 1, backgroundColor: "#16122a", borderWidth: 1, borderColor: "#2d2540", borderRadius: 14, padding: 14, alignItems: "center" },
  chipVal: { color: "#e8e0ff", fontSize: 22, fontWeight: "700" },
  chipLabel: { color: "#9880cc", fontSize: 10, marginTop: 2, letterSpacing: 0.5 },

  // Smoke button
  smokeBtn: { backgroundColor: "#1e1b2e", borderWidth: 1.5, borderColor: "#5b3fa0", width: "100%", padding: 20, borderRadius: 16, alignItems: "center", marginBottom: 4 },
  smokeBtnText: { color: "#d4b8ff", fontSize: 18, fontWeight: "800", letterSpacing: 0.5 },

  // Card
  card: { backgroundColor: "#16122a", width: "100%", padding: 16, borderRadius: 20, marginTop: 16, borderWidth: 1, borderColor: "#2d2540" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { color: "#9880cc", fontSize: 13, fontWeight: "600" },
  removeBtn: { color: "#5e4d80", fontSize: 12, textDecorationLine: "underline" },

  // Chart tabs
  chartTabs: { flexDirection: "row", gap: 6, marginBottom: 14, marginTop: 8 },
  chartTab: { flex: 1, backgroundColor: "#16122a", borderWidth: 1, borderColor: "#2d2540", borderRadius: 10, padding: 8, alignItems: "center" },
  chartTabActive: { backgroundColor: "#2d2540", borderColor: "#5b3fa0" },
  chartTabText: { color: "#5e4d80", fontSize: 11 },
  chartTabTextActive: { color: "#d4b8ff" },

  // Summary
  summaryRow: { flexDirection: "row", gap: 8, width: "100%", marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: "#16122a", borderWidth: 1, borderColor: "#2d2540", borderRadius: 14, padding: 12, alignItems: "center" },
  summaryVal: { color: "#d4b8ff", fontSize: 22, fontWeight: "800" },
  summaryLbl: { color: "#9880cc", fontSize: 9, marginTop: 3, letterSpacing: 0.5 },
  summarySub: { color: "#3b2d60", fontSize: 9, marginTop: 1 },

  // History rows
  histRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1e1b2e" },
  histDay: { color: "#e8e0ff", fontSize: 15, fontWeight: "600" },
  histDate: { color: "#5e4d80", fontSize: 12, marginTop: 1 },
  histSmoked: { fontSize: 18, fontWeight: "700" },
  histDiff: { color: "#5e4d80", fontSize: 11, marginTop: 1 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "#000000aa", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#16122a", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, borderWidth: 1, borderColor: "#2d2540" },
  modalTitle: { color: "#e8e0ff", fontSize: 22, fontWeight: "800", marginBottom: 24, letterSpacing: -0.5 },

  setupRow: { marginBottom: 22 },
  setupLabel: { color: "#9880cc", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepBtn: { backgroundColor: "#1e1b2e", borderWidth: 1, borderColor: "#2d2540", borderRadius: 10, width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  stepBtnText: { color: "#d4b8ff", fontSize: 18, fontWeight: "600" },
  stepVal: { color: "#e8e0ff", fontSize: 28, fontWeight: "700", minWidth: 60, textAlign: "center" },
  hint: { color: "#5e4d80", fontSize: 12, marginTop: 6 },
  timeInput: { backgroundColor: "#0f0c1a", borderWidth: 1, borderColor: "#2d2540", borderRadius: 10, color: "#e8e0ff", padding: 12, fontSize: 20, width: 60, textAlign: "center", fontWeight: "700" },

  saveBtn: { backgroundColor: "#7c3aed", borderRadius: 14, padding: 18, alignItems: "center", marginTop: 8 },
  saveBtnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  cancelBtn: { alignItems: "center", padding: 12, marginTop: 4 },
  cancelBtnText: { color: "#5e4d80", fontSize: 14 },
});
