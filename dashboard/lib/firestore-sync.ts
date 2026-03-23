/**
 * Firestore sync — saves portfolio snapshots to Firestore so data
 * is accessible even if the local SQLite DB is lost.
 * Also stores user settings (API URL, etc.)
 */
import { doc, setDoc, getDoc, collection, addDoc, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export async function saveSnapshot(userId: string, snapshot: {
  total_value: number;
  cash: number;
  positions_value: number;
}) {
  try {
    await addDoc(collection(db, "users", userId, "snapshots"), {
      ...snapshot,
      recorded_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("Firestore snapshot save failed:", e);
  }
}

export async function getUserSettings(userId: string) {
  try {
    const snap = await getDoc(doc(db, "users", userId, "settings", "config"));
    return snap.exists() ? snap.data() : {};
  } catch {
    return {};
  }
}

export async function saveUserSettings(userId: string, settings: Record<string, any>) {
  try {
    await setDoc(doc(db, "users", userId, "settings", "config"), settings, { merge: true });
  } catch (e) {
    console.warn("Firestore settings save failed:", e);
  }
}

export async function getCloudSnapshots(userId: string) {
  try {
    const q = query(
      collection(db, "users", userId, "snapshots"),
      orderBy("recorded_at", "asc"),
      limit(90)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  } catch {
    return [];
  }
}
