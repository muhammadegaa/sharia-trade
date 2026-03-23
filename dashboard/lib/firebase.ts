import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBDgt7hsJjDIC2J2tEslrUabSdk4ubnhhA",
  authDomain: "sharia-trade.firebaseapp.com",
  projectId: "sharia-trade",
  storageBucket: "sharia-trade.firebasestorage.app",
  messagingSenderId: "495221825394",
  appId: "1:495221825394:web:af9370422827bd616fc7eb",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
