import React, { useState, useEffect } from "react";
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  ScrollView, 
  SafeAreaView, 
  Dimensions,
  StatusBar
} from "react-native";
import Svg, { 
  Circle, 
  Line, 
  Path, 
  Defs, 
  LinearGradient, 
  Stop, 
  Text as SvgText 
} from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const STORAGE_KEY = "qsm_v1";

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const dateKeyFor = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function TodayPaceChart({ todayLog, allowance, endHour, endMin, now }) {
  const W = SCREEN_WIDTH - 60; 
  const H = 120;
  const PAD = { l: 30, r: 10, t: 15, b: 25 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const dayStart = new Date(now); dayStart.setHours(6, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(endHour, endMin, 0, 0);
  if (dayEnd <= dayStart) dayEnd.setDate(dayEnd.getDate() + 1);
  const totalMs = dayEnd - dayStart;

  const xPct = (date) => Math.max(0, Math.min(1, (new Date(date) - dayStart) / totalMs));
  const xCoord = (pct) => PAD.l + pct * chartW;
  const yCoord = (val) => PAD.t + chartH - (val / Math.max(allowance, 1)) * chartH;

  const sorted = [...todayLog].sort((a, b) => new Date(a.time) - new Date(b.time));
  const actualPts = [[0, 0], ...sorted.map((e, i) => [xPct(e.time), i + 1])];
  
  const toPath = pts => pts.map((p, i) => `${i === 0 ? "M" : "L"}${xCoord(p[0]).toFixed(1)},${yCoord(p[1]).toFixed(1)}`).join(" ");

  return (
    <View style={styles.chartWrapper}>
      <Svg width={W} height={H}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#7c3aed" stopOpacity="0.3" />
            <Stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Line x1={PAD.l} y1={yCoord(0)} x2={PAD.l + chartW} y2={yCoord(0)} stroke="#2d2540" />
        <SvgText x={PAD.l - 5} y={yCoord(allowance) + 4} fill="#5e4d80" fontSize="10" textAnchor="end">{allowance}</SvgText>
        <Line x1={xCoord(0)} y1={yCoord(0)} x2={xCoord(1)} y2={yCoord(allowance)} stroke="#2d2540" strokeDasharray="4 3" />
        {actualPts.length > 1 && (
          <>
            <Path d={`${toPath(actualPts)} L${xCoord(actualPts[actualPts.length-1][0])},${yCoord(0)} Z`} fill="url(#areaGrad)" />
            <Path d={toPath(actualPts)} fill="none" stroke="#7c3aed" strokeWidth="2" />
          </>
        )}
        <Line x1={xCoord(xPct(now))} y1={PAD.t} x2={xCoord(xPct(now))} y2={PAD.t + chartH} stroke="#a78bfa" strokeDasharray="2 2" />
      </Svg>
    </View>
  );
}

export default function App() {
  const [logs, setLogs] = useState([]);
  const [now, setNow] = useState(new Date());
  const [allowance] = useState(12);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    const loadData = async () => {
      try {
        const val = await AsyncStorage.getItem(STORAGE_KEY);
        if (val) setLogs(JSON.parse(val));
      } catch (e) { console.error(e); }
    };
    loadData();
    return () => clearInterval(timer);
  }, []);

  const addSmoke = async () => {
    const newLogs = [...logs, { time: new Date().toISOString() }];
    setLogs(newLogs);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newLogs));
  };

  const todayKey = dateKeyFor(now);
  const todayLog = logs.filter(l => dateKeyFor(new Date(l.time)) === todayKey);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.headerTitle}>QuitSmoke Mobile</Text>
        <View style={styles.mainCard}>
          <Text style={styles.cardLabel}>TODAY'S PROGRESS</Text>
          <View style={styles.statRow}>
            <View>
              <Text style={styles.bigNum}>{todayLog.length}</Text>
              <Text style={styles.subLabel}>Smoked</Text>
            </View>
            <View style={styles.divider} />
            <View>
              <Text style={[styles.bigNum, {color: '#10b981'}]}>{Math.max(0, allowance - todayLog.length)}</Text>
              <Text style={styles.subLabel}>Remaining</Text>
            </View>
          </View>
          <TodayPaceChart todayLog={todayLog} allowance={allowance} endHour={23} endMin={59} now={now} />
        </View>
        <TouchableOpacity activeOpacity={0.7} style={styles.logButton} onPress={addSmoke}>
          <Text style={styles.logButtonText}>LOG SMOKE</Text>
        </TouchableOpacity>
        <Text style={styles.historyTitle}>Today's Log</Text>
        {todayLog.slice().reverse().map((log, i) => (
          <View key={i} style={styles.historyItem}>
            <Text style={styles.historyTime}>{fmtTime(new Date(log.time))}</Text>
            <View style={styles.dot} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020205" },
  scroll: { padding: 20 },
  headerTitle: { color: "#fff", fontSize: 28, fontWeight: "900", marginBottom: 25, marginTop: 10 },
  mainCard: { backgroundColor: "#111019", borderRadius: 20, padding: 20, marginBottom: 30, borderWidth: 1, borderColor: "#1e1b2e" },
  cardLabel: { color: "#5e4d80", fontSize: 12, fontWeight: "bold", letterSpacing: 1, marginBottom: 15 },
  statRow: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", marginBottom: 20 },
  bigNum: { color: "#7c3aed", fontSize: 36, fontWeight: "800", textAlign: "center" },
  subLabel: { color: "#94a1b2", fontSize: 12, textAlign: "center" },
  divider: { width: 1, height: 40, backgroundColor: "#2d2540" },
  chartWrapper: { marginTop: 10, alignItems: "center" },
  logButton: { backgroundColor: "#7c3aed", paddingVertical: 18, borderRadius: 16, alignItems: "center" },
  logButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold", letterSpacing: 1 },
  historyTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 30, marginBottom: 15 },
  historyItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#111019", padding: 15, borderRadius: 12, marginBottom: 10 },
  historyTime: { color: "#d4b8ff", fontSize: 16, fontWeight: "500" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#7c3aed" }
});

