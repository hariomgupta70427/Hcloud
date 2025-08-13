import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup,
  updateProfile,
  sendPasswordResetEmail,
  updatePassword,
  AuthError
} from 'firebase/auth'
import { auth, googleProvider } from '@/lib/firebase'
import { createUserDocument, getUserDocument } from '@/services/userService'

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  createdAt: Date
  updatedAt: Date
  storageUsed: number
  storageLimit: number
  plan: 'free' | 'premium'
}

interface AuthContextType {
  user: User | null
  userProfile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setUser(user)
          // Fetch or create user profile
          const profile = await getUserDocument(user.uid)
          if (profile) {
            setUserProfile(profile)
          } else {
            // Create new user profile
            const newProfile: UserProfile = {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || 'User',
              photoURL: user.photoURL,
              createdAt: new Date(),
              updatedAt: new Date(),
              storageUsed: 0,
              storageLimit: 5 * 1024 * 1024 * 1024, // 5GB for free users
              plan: 'free'
            }
            await createUserDocument(newProfile)
            setUserProfile(newProfile)
          }
        } else {
          setUser(null)
          setUserProfile(null)
        }
      } catch (error) {
        console.error('Error managing user state:', error)
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true)
      await signInWithEmailAndPassword(auth, email, password)
    } catch (error: any) {
      throw new Error(getAuthErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const signUp = async (email: string, password: string, displayName: string) => {
    try {
      setLoading(true)
      const { user } = await createUserWithEmailAndPassword(auth, email, password)
      await updateProfile(user, { displayName })
      
      // Create user profile document
      const userProfile: UserProfile = {
        uid: user.uid,
        email: user.email || '',
        displayName,
        photoURL: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        storageUsed: 0,
        storageLimit: 5 * 1024 * 1024 * 1024,
        plan: 'free'
      }
      await createUserDocument(userProfile)
    } catch (error: any) {
      throw new Error(getAuthErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const signInWithGoogle = async () => {
    try {
      setLoading(true)
      const result = await signInWithPopup(auth, googleProvider)
      const user = result.user
      
      // Check if user profile exists, create if not
      let profile = await getUserDocument(user.uid)
      if (!profile) {
        profile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'User',
          photoURL: user.photoURL,
          createdAt: new Date(),
          updatedAt: new Date(),
          storageUsed: 0,
          storageLimit: 5 * 1024 * 1024 * 1024,
          plan: 'free'
        }
        await createUserDocument(profile)
      }
    } catch (error: any) {
      throw new Error(getAuthErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Error signing out:', error)
      throw error
    }
  }

  const resetPassword = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email)
    } catch (error: any) {
      throw new Error(getAuthErrorMessage(error))
    }
  }

  const updateUserProfile = async (updates: Partial<UserProfile>) => {
    if (!user || !userProfile) return

    try {
      // Update Firebase Auth profile if needed
      if (updates.displayName || updates.photoURL) {
        await updateProfile(user, {
          displayName: updates.displayName || user.displayName,
          photoURL: updates.photoURL !== undefined ? updates.photoURL : user.photoURL
        })
      }

      // Update user document in Firestore
      const updatedProfile = {
        ...userProfile,
        ...updates,
        updatedAt: new Date()
      }
      
      await createUserDocument(updatedProfile)
      setUserProfile(updatedProfile)
    } catch (error) {
      console.error('Error updating profile:', error)
      throw error
    }
  }

  const changePassword = async (newPassword: string) => {
    if (!user) return

    try {
      await updatePassword(user, newPassword)
    } catch (error: any) {
      throw new Error(getAuthErrorMessage(error))
    }
  }

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    logout,
    resetPassword,
    updateUserProfile,
    changePassword
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function getAuthErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'auth/user-not-found':
      return 'No user found with this email address.'
    case 'auth/wrong-password':
      return 'Incorrect password.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.'
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.'
    case 'auth/invalid-email':
      return 'Invalid email address.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.'
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection.'
    default:
      return error.message || 'An error occurred during authentication.'
  }
}