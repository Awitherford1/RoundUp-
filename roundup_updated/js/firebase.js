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
  apiKey:            "PASTE_YOUR_API_KEY_HERE",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId:         "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket:     "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId:             "PASTE_YOUR_APP_ID_HERE"
};

// Initialise Firebase
const app = initializeApp(firebaseConfig);

// Initialise Firestore database
export const db = getFirestore(app);
