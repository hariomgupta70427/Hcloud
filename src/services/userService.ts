import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { UserProfile } from '@/contexts/AuthContext'

export const createUserDocument = async (userProfile: UserProfile): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userProfile.uid)
    await setDoc(userRef, {
      ...userProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true })
  } catch (error) {
    console.error('Error creating user document:', error)
    throw error
  }
}

export const getUserDocument = async (uid: string): Promise<UserProfile | null> => {
  try {
    const userRef = doc(db, 'users', uid)
    const userSnap = await getDoc(userRef)
    
    if (userSnap.exists()) {
      const data = userSnap.data()
      return {
        uid: data.uid,
        email: data.email,
        displayName: data.displayName,
        photoURL: data.photoURL,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        storageUsed: data.storageUsed || 0,
        storageLimit: data.storageLimit || (5 * 1024 * 1024 * 1024),
        plan: data.plan || 'free'
      }
    }
    
    return null
  } catch (error) {
    console.error('Error getting user document:', error)
    throw error
  }
}

export const updateUserDocument = async (uid: string, updates: Partial<UserProfile>): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      ...updates,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating user document:', error)
    throw error
  }
}

export const deleteUserDocument = async (uid: string): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid)
    await deleteDoc(userRef)
  } catch (error) {
    console.error('Error deleting user document:', error)
    throw error
  }
}

export const updateStorageUsage = async (uid: string, bytesUsed: number): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      storageUsed: bytesUsed,
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    console.error('Error updating storage usage:', error)
    throw error
  }
}