import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile as firebaseUpdateProfile,
  User as FirebaseUser,
  UserCredential,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export interface UserData {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  storageMode: 'managed' | 'byod';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone?: string;
  storageMode: 'managed' | 'byod';
}

// Sign up with email and password
export async function signUp(data: RegisterData): Promise<UserData> {
  const { email, password, name, phone, storageMode } = data;

  // Create auth user
  const userCredential: UserCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Update display name
  await firebaseUpdateProfile(user, { displayName: name });

  // Create user document in Firestore
  const userData = {
    name,
    email,
    phone: phone || '',
    storageMode,
    avatar: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'users', user.uid), userData);

  return {
    id: user.uid,
    name,
    email,
    phone,
    storageMode,
  };
}

// Sign in with email and password
export async function signIn(email: string, password: string): Promise<UserData> {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Fetch user data from Firestore
  const userDoc = await getDoc(doc(db, 'users', user.uid));

  if (userDoc.exists()) {
    const data = userDoc.data();
    return {
      id: user.uid,
      name: data.name || user.displayName || 'User',
      email: user.email || email,
      phone: data.phone,
      avatar: data.avatar || user.photoURL || undefined,
      storageMode: data.storageMode || 'managed',
    };
  }

  // Fallback if no Firestore document exists
  return {
    id: user.uid,
    name: user.displayName || 'User',
    email: user.email || email,
    storageMode: 'managed',
  };
}

// Sign in with Google OAuth
export async function signInWithGoogle(): Promise<UserData> {
  const provider = new GoogleAuthProvider();
  provider.addScope('profile');
  provider.addScope('email');

  const userCredential = await signInWithPopup(auth, provider);
  const user = userCredential.user;

  // Check if user document exists
  const userDoc = await getDoc(doc(db, 'users', user.uid));

  if (userDoc.exists()) {
    const data = userDoc.data();
    return {
      id: user.uid,
      name: data.name || user.displayName || 'User',
      email: user.email || '',
      phone: data.phone,
      avatar: data.avatar || user.photoURL || undefined,
      storageMode: data.storageMode || 'managed',
    };
  }

  // Create new user document for Google sign-in
  const userData = {
    name: user.displayName || 'User',
    email: user.email || '',
    phone: user.phoneNumber || '',
    storageMode: 'managed',
    avatar: user.photoURL || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'users', user.uid), userData);

  return {
    id: user.uid,
    name: user.displayName || 'User',
    email: user.email || '',
    avatar: user.photoURL || undefined,
    storageMode: 'managed',
  };
}

// Sign out
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

// Send password reset email
export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

// Update user profile
export async function updateProfile(
  userId: string,
  updates: { name?: string; phone?: string; avatar?: string }
): Promise<void> {
  // Update Firestore
  await updateDoc(doc(db, 'users', userId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });

  // Update Auth profile if name changed
  if (updates.name && auth.currentUser) {
    await firebaseUpdateProfile(auth.currentUser, { displayName: updates.name });
  }

  if (updates.avatar && auth.currentUser) {
    await firebaseUpdateProfile(auth.currentUser, { photoURL: updates.avatar });
  }
}

// Get user data from Firestore
export async function getUserData(userId: string): Promise<UserData | null> {
  const userDoc = await getDoc(doc(db, 'users', userId));

  if (!userDoc.exists()) {
    return null;
  }

  const data = userDoc.data();
  return {
    id: userId,
    name: data.name,
    email: data.email,
    phone: data.phone,
    avatar: data.avatar,
    storageMode: data.storageMode || 'managed',
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  };
}

// Listen to auth state changes
export function onAuthStateChange(
  callback: (user: UserData | null) => void
): () => void {
  return onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
    if (firebaseUser) {
      // Fetch user data from Firestore
      const userData = await getUserData(firebaseUser.uid);

      if (userData) {
        callback(userData);
      } else {
        // Fallback to auth data
        callback({
          id: firebaseUser.uid,
          name: firebaseUser.displayName || 'User',
          email: firebaseUser.email || '',
          storageMode: 'managed',
        });
      }
    } else {
      callback(null);
    }
  });
}

// Get current user
export function getCurrentUser(): FirebaseUser | null {
  return auth.currentUser;
}
