// ============================================
// ROUNDUP — FIREBASE CONFIGURATION
// ============================================
// 
// ⚠️  YOU NEED TO FILL THIS IN!
//
// Steps:
// 1. Go to https://console.firebase.google.com
// 2. Click "Add project" → name it "roundup"
// 3. Once created, click the </> (Web) icon to add a web app
// 4. Register the app — Firebase will show you a config object
// 5. Copy the values below from that config object
//
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBSQNHkumfiZPsRpLZuqpjaOAaDXdlIzrQ",
  authDomain: "roundup-43d15.firebaseapp.com",
  projectId: "roundup-43d15",
  storageBucket: "roundup-43d15.firebasestorage.app",
  messagingSenderId: "368633294607",
  appId: "1:368633294607:web:fb187ff48dfb00e227987a",
  measurementId: "G-QJ9CK2ZJS8"
};

// Initialise Firebase
const app = initializeApp(firebaseConfig);

// Initialise Firestore database
export const db = getFirestore(app);
