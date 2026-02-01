import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';
import { 
  getFirestore, 
  enableIndexedDbPersistence,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyD5auuH07ThEzNFe721h4mwfxexBfqdlw0',
  authDomain: 'hcloud-6e7eb.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'hcloud-6e7eb',
  storageBucket: 'hcloud-6e7eb.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '710115852302',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:710115852302:web:d65c89af3daa11d8307c5f',
  measurementId: 'G-5V1QSHY9W3',
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Set auth persistence
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('Error setting auth persistence:', error);
});

// Initialize Firestore
export const db = getFirestore(app);

// Enable offline persistence for Firestore
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence failed: Multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence not supported in this browser');
  }
});

export default app;
