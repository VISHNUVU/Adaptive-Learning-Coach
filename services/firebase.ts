
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Safe access to process.env
const getEnv = (key: string) => {
  try {
    return process.env[key];
  } catch {
    return undefined;
  }
};

const firebaseConfig = {
  apiKey: getEnv('FIREBASE_API_KEY'),
  authDomain: getEnv('FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('FIREBASE_APP_ID')
};

// Check if config is actually set and valid
const isConfigValid = 
  firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== "YOUR_API_KEY" && 
  !firebaseConfig.apiKey.startsWith("YOUR_");

let app;
let auth: any = null;
let db: any = null;
let googleProvider: any = null;

if (isConfigValid) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
  } catch (error) {
    console.warn("Firebase initialization failed:", error);
  }
} else {
  console.warn("Firebase configuration missing or invalid. App will run in Demo/Mock mode.");
}

export { auth, db, googleProvider };

export const signInWithGoogle = async () => {
  if (auth && googleProvider) {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  } else {
    // Mock Fallback for Demo Mode
    console.log("Firebase not configured. Using Mock Auth.");
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          uid: 'mock-user-' + Math.floor(Math.random() * 1000),
          displayName: 'Demo Student',
          email: 'student@cognipath.demo',
          photoURL: null, 
        });
      }, 800);
    });
  }
};

export const logoutUser = async () => {
  if (auth) {
    await signOut(auth);
  } else {
    console.log("Mock logout");
  }
};
