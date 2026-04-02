import React, { useState, useEffect, useCallback } from "react";
import { 
  StyleSheet, Text, View, TouchableOpacity, ScrollView, 
  SafeAreaView, Dimensions, StatusBar, TextInput, Modal 
} from "react-native";
import Svg, { 
  Circle, Line, Path, Defs, LinearGradient, Stop, 
  Text as SvgText, Rect, G 
} from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";

// --- Utilities ---
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const STORAGE_KEY = "qflow_v2";

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const fmtDate = (date) => date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtDay = (date) => date.toLocaleDateString("en-GB", { weekday: "short" });
const dateKeyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function minutesUntil(now, endHour, endMinute) {
  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return Math.max(0, Math.floor((end - now) / 60000));
}

function buildPlan(startDate, startCigs, durationDays) {
  const plan = [];
  const interval = durationDays / startCigs;
  for (let i = 0; i < durationDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = dateKeyFor(d);
    const allowance = Math.max(0, Math.round(startCigs - (i + 1) / interval));
    plan.push({ key, date: d, allowance });
  }
  return plan;
}

// --- Specialized Chart Components (Native Optimized) ---

function TodayPaceChart({ todayLog, allowance, endHour, endMin, now }) {
  const W = SCREEN_WIDTH - 72, H = 110;
  const PAD = { l: 28, r: 10, t: 14, b: 24 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const dayStart = new Date(now); dayStart.setHours(6, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(endHour, endMin, 0, 0);
  if (dayEnd <= dayStart) dayEnd.setDate(dayEnd.getDate() + 1);
  const totalMs = dayEnd - dayStart;

  const xP = (date) => Math.max(0, Math.min(1, (new Date(date) - dayStart) / totalMs));
  const xC = (p) => PAD.l + p * chartW;
  const yC = (v) => PAD.t + chartH - (v / Math.max(allowance, 1)) * chartH;

  const sorted = [...todayLog].sort((a, b) => new Date(a.time) - new Date(b.time));
  const pts = [[0, 0], ...sorted.map((e, i) => [xP(e.time), i + 1])];
  const toPath = p => p.map((pt, i) => `${i === 0 ? "M" : "L"}${xC(pt[0])},${yC(pt[1])}`).join(" ");

  return (
    <Svg width={W} height={H}>
      <Line x1={PAD.l} y1={yC(0)} x2={PAD.l + chartW} y2={yC(0)} stroke="#1e1b2e" />
      <Line x1={xC(0)} y1={yC(0)} x2={xC(1)} y2={yC(allowance)} stroke="#2d2540" strokeDasharray="4 3" />
      {pts.length > 1 && <Path d={toPath(pts)} fill="none" stroke="#7c3aed" strokeWidth="2.5" />}
      <Line x1={xC(xP(now))} y1={PAD.t} x2={xC(xP(now))} y2={PAD.t + chartH} stroke="#a78bfa" strokeDasharray="3 2" />
    </Svg>
  );
}

function WeekHeatmap({ weekData }) {
  const W = SCREEN_WIDTH - 72, H = 100;
  const cellW = W / 7;
  return (
    <Svg width={W} height={H}>
      {weekData.map((d, i) => (
        <G key={i}>
          <Rect x={i * cellW + 4} y={10} width={cellW - 8} height={60} rx={8} fill={d.smoked > d.allowance ? "#f8717133" : "#7c3aed33"} />
          <SvgText x={i * cellW + cellW/2} y={40} fill="#fff" fontSize="14" textAnchor="middle" fontWeight="bold">{d.smoked}</SvgText>
          <SvgText x={i * cellW + cellW/2} y={85} fill="#5e4d80" fontSize="10" textAnchor="middle">{d.dayLabel}</SvgText>
        </G>
      ))}
    </Svg>
  );
}

// --- Main App ---

export default function App() {
  const [data, setData] = useState({ logs: {}, setup: null });
  const [screen, setScreen] = useState("home"); // home, setup, history
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState(null);

  // Load Data
  useEffect(() => {
    const loadData = async () => {
      const val = await AsyncStorage.getItem(STORAGE_KEY);
      if (val) setData(JSON.parse(val));
    };
    loadData();
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const persist = async (patch) => {
    const next = { ...data, ...patch };
    setData(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  // Logic
  const plan = data.setup ? buildPlan(data.setup.startDate, data.setup.startCigs, data.setup.durationDays) : [];
  const today = dateKeyFor(now);
  const todayEntry = plan.find(p => p.key === today);
  const todayAllowance = todayEntry ? todayEntry.allowance : 0;
  const todayLog = data.logs[today] || [];
  
  const endH = data.setup ? parseInt(data.setup.endTime.split(":")[0]) : 1;
  const endM = data.setup ? parseInt(data.setup.endTime.split(":")[1]) : 0;
  const minsLeft = minutesUntil(now, endH, endM);

  const logCig = () => {
    const newLogs = { ...data.logs, [today]: [...todayLog, { time: now.toISOString() }] };
    persist({ logs: newLogs });
    showToast("Logged ✓");
  };

  if (!data.setup && screen !== "setup") {
    return (
      <SafeAreaView style={S.root}>
        <View style={S.splash}>
          <Text style={{ fontSize: 60 }}>🚭</Text>
          <Text style={S.splashTitle}>QuitFlow</Text>
          <Text style={S.splashSub}>Reduce gradually. No pressure.</Text>
          <TouchableOpacity style={S.btnPrimary} onPress={() => setScreen("setup")}>
            <Text style={S.btnText}>Start My Plan →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.root}>
      <StatusBar barStyle="light-content" />
      {toast && <View style={S.toast}><Text style={S.toastText}>{toast}</Text></View>}
      
      <View style={S.header}>
        <Text style={S.logo}>🚭 QuitFlow</Text>
        <View style={S.nav}>
          <TouchableOpacity onPress={() => setScreen("home")}><Text style={[S.navText, screen==="home" && S.navActive]}>Today</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen("history")}><Text style={[S.navText, screen==="history" && S.navActive]}>History</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setScreen("setup")}><Text style={[S.navText, screen==="setup" && S.navActive]}>Plan</Text></TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={S.main}>
        {screen === "home" && (
          <>
            <View style={S.card}>
              <Text style={S.cardLabel}>TODAY'S LIMIT: {todayAllowance}</Text>
              <View style={S.bigNumRow}>
                <Text style={S.bigNum}>{todayLog.length}</Text>
                <Text style={S.bigDen}>/{todayAllowance}</Text>
              </View>
              <TodayPaceChart todayLog={todayLog} allowance={todayAllowance} endHour={endH} endMin={endM} now={now} />
            </View>

            <TouchableOpacity style={S.btnSmoke} onPress={logCig}>
              <Text style={S.btnSmokeText}>🚬 I JUST SMOKED</Text>
            </TouchableOpacity>

            <View style={S.timeRow}>
              <View style={S.timeChip}><Text style={S.chipVal}>{Math.floor(minsLeft/60)}h {minsLeft%60}m</Text><Text style={S.chipLabel}>Time Left</Text></View>
              <View style={S.timeChip}><Text style={S.chipVal}>{Math.max(0, todayAllowance - todayLog.length)}</Text><Text style={S.chipLabel}>Left</Text></View>
            </View>
          </>
        )}

        {screen === "setup" && (
          <View style={S.card}>
            <Text style={S.cardTitle}>Plan Settings</Text>
            <Text style={S.fieldLabel}>Cigs per day now</Text>
            <TextInput 
              style={S.input} 
              keyboardType="numeric" 
              placeholder="20"
              onChangeText={(v) => persist({ setup: { ...data.setup, startCigs: parseInt(v), startDate: new Date().toISOString(), durationDays: 90, endTime: "01:00" } })} 
            />
            <TouchableOpacity style={S.btnPrimary} onPress={() => setScreen("home")}>
              <Text style={S.btnText}>Save & Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {screen === "history" && (
          <View style={S.card}>
            <Text style={S.cardTitle}>Last 7 Days</Text>
            <WeekHeatmap weekData={Array.from({length:7}, (_,i) => {
              const d = new Date(); d.setDate(d.getDate() - (6-i));
              const k = dateKeyFor(d);
              return { dayLabel: fmtDay(d), smoked: (data.logs[k] || []).length, allowance: 10 };
            })} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f0c1a" },
  header: { flexDirection: "row", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderColor: "#1e1b2e" },
  logo: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  nav: { flexDirection: "row", gap: 15 },
  navText: { color: "#9880cc", fontSize: 14 },
  navActive: { color: "#fff", fontWeight: "bold" },
  main: { padding: 20 },
  splash: { flex: 1, justifyContent: "center", alignItems: "center", padding: 40 },
  splashTitle: { color: "#fff", fontSize: 32, fontWeight: "800", marginTop: 20 },
  splashSub: { color: "#9880cc", textAlign: "center", marginBottom: 40 },
  card: { backgroundColor: "#16122a", borderRadius: 20, padding: 20, marginBottom: 20, borderWeight: 1, borderColor: "#2d2540" },
  cardTitle: { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 20 },
  cardLabel: { color: "#9880cc", fontSize: 12, fontWeight: "bold", marginBottom: 10 },
  bigNumRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 20 },
  bigNum: { color: "#fff", fontSize: 48, fontWeight: "800" },
  bigDen: { color: "#5e4d80", fontSize: 24 },
  btnPrimary: { backgroundColor: "#7c3aed", padding: 16, borderRadius: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "bold" },
  btnSmoke: { backgroundColor: "#1e1b2e", padding: 20, borderRadius: 16, borderWeight: 1.5, borderColor: "#5b3fa0", alignItems: "center", marginBottom: 20 },
  btnSmokeText: { color: "#d4b8ff", fontWeight: "bold", fontSize: 16 },
  timeRow: { flexDirection: "row", gap: 12 },
  timeChip: { flex: 1, backgroundColor: "#16122a", padding: 15, borderRadius: 15, alignItems: "center" },
  chipVal: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  chipLabel: { color: "#9880cc", fontSize: 10, marginTop: 4 },
  input: { backgroundColor: "#0f0c1a", color: "#fff", padding: 15, borderRadius: 10, marginBottom: 20 },
  toast: { position: "absolute", top: 100, alignSelf: "center", backgroundColor: "#7c3aed", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, zIndex: 99 },
  toastText: { color: "#fff", fontWeight: "bold" }
});
