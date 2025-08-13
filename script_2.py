# Create the React contexts for state management

context_files = {}

# 1. Authentication Context
context_files['src/contexts/AuthContext.tsx'] = '''import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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
  GoogleAuthProvider,
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
}'''

# 2. Theme Context
context_files['src/contexts/ThemeContext.tsx'] = '''import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  actualTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

interface ThemeProviderProps {
  children: ReactNode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Get theme from localStorage or default to system
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hcloud-theme') as Theme
      return saved || 'system'
    }
    return 'system'
  })

  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('light')

  // Function to get system theme
  const getSystemTheme = (): 'light' | 'dark' => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }

  // Update actual theme based on current theme setting
  useEffect(() => {
    const updateActualTheme = () => {
      if (theme === 'system') {
        setActualTheme(getSystemTheme())
      } else {
        setActualTheme(theme)
      }
    }

    updateActualTheme()

    // Listen for system theme changes if theme is set to system
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = () => {
        setActualTheme(mediaQuery.matches ? 'dark' : 'light')
      }
      
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  // Update DOM class and localStorage when actualTheme changes
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(actualTheme)
    
    // Update meta theme color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        actualTheme === 'dark' ? '#0f172a' : '#ffffff'
      )
    }
  }, [actualTheme])

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem('hcloud-theme', newTheme)
  }

  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark')
    } else if (theme === 'dark') {
      setTheme('system')
    } else {
      setTheme('light')
    }
  }

  const value: ThemeContextType = {
    theme,
    actualTheme,
    setTheme,
    toggleTheme
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}'''

# 3. File Context
context_files['src/contexts/FileContext.tsx'] = '''import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import {
  uploadFile,
  deleteFile,
  downloadFile,
  getFiles,
  getFolders,
  createFolder,
  deleteFolder,
  updateFile,
  moveFile,
  searchFiles
} from '@/services/fileService'

export interface FileItem {
  id: string
  name: string
  type: 'file' | 'folder'
  fileType?: string
  size: number
  url?: string
  thumbnailUrl?: string
  parentId: string | null
  userId: string
  createdAt: Date
  updatedAt: Date
  shared: boolean
  starred: boolean
  tags: string[]
  metadata?: {
    width?: number
    height?: number
    duration?: number
    [key: string]: any
  }
}

export interface UploadProgress {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'completed' | 'error' | 'cancelled'
  error?: string
}

interface FileContextType {
  files: FileItem[]
  folders: FileItem[]
  currentFolderId: string | null
  uploadProgress: UploadProgress[]
  loading: boolean
  
  // File operations
  uploadFiles: (files: File[], folderId?: string | null) => Promise<void>
  deleteFiles: (fileIds: string[]) => Promise<void>
  downloadFiles: (fileIds: string[]) => Promise<void>
  updateFileMetadata: (fileId: string, updates: Partial<FileItem>) => Promise<void>
  moveFiles: (fileIds: string[], targetFolderId: string | null) => Promise<void>
  toggleStarFile: (fileId: string) => Promise<void>
  toggleShareFile: (fileId: string) => Promise<void>
  
  // Folder operations
  createNewFolder: (name: string, parentId?: string | null) => Promise<void>
  deleteFolders: (folderIds: string[]) => Promise<void>
  
  // Navigation
  setCurrentFolderId: (folderId: string | null) => void
  refreshFiles: () => Promise<void>
  
  // Search and filter
  searchFilesByQuery: (query: string) => Promise<FileItem[]>
  
  // Bulk operations
  selectFiles: (fileIds: string[]) => void
  clearSelection: () => void
  selectedFileIds: string[]
}

const FileContext = createContext<FileContextType | null>(null)

export const useFiles = () => {
  const context = useContext(FileContext)
  if (!context) {
    throw new Error('useFiles must be used within a FileProvider')
  }
  return context
}

interface FileProviderProps {
  children: ReactNode
}

export const FileProvider: React.FC<FileProviderProps> = ({ children }) => {
  const { user } = useAuth()
  const [files, setFiles] = useState<FileItem[]>([])
  const [folders, setFolders] = useState<FileItem[]>([])
  const [currentFolderId, setCurrentFolderIdState] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])

  const refreshFiles = useCallback(async () => {
    if (!user) return

    try {
      setLoading(true)
      const [fetchedFiles, fetchedFolders] = await Promise.all([
        getFiles(user.uid, currentFolderId),
        getFolders(user.uid, currentFolderId)
      ])
      
      setFiles(fetchedFiles)
      setFolders(fetchedFolders)
    } catch (error) {
      console.error('Error refreshing files:', error)
    } finally {
      setLoading(false)
    }
  }, [user, currentFolderId])

  const setCurrentFolderId = (folderId: string | null) => {
    setCurrentFolderIdState(folderId)
  }

  const uploadFiles = async (filesToUpload: File[], folderId = currentFolderId) => {
    if (!user) return

    const uploadPromises = filesToUpload.map(async (file) => {
      const progressId = `${Date.now()}-${Math.random()}`
      
      // Add to upload progress
      setUploadProgress(prev => [...prev, {
        id: progressId,
        name: file.name,
        progress: 0,
        status: 'uploading'
      }])

      try {
        await uploadFile(
          file,
          user.uid,
          folderId,
          (progress) => {
            setUploadProgress(prev => 
              prev.map(item => 
                item.id === progressId 
                  ? { ...item, progress }
                  : item
              )
            )
          }
        )

        // Mark as completed
        setUploadProgress(prev => 
          prev.map(item => 
            item.id === progressId 
              ? { ...item, status: 'completed' as const, progress: 100 }
              : item
          )
        )

        // Remove from progress after delay
        setTimeout(() => {
          setUploadProgress(prev => prev.filter(item => item.id !== progressId))
        }, 2000)

      } catch (error: any) {
        console.error('Upload error:', error)
        setUploadProgress(prev => 
          prev.map(item => 
            item.id === progressId 
              ? { ...item, status: 'error' as const, error: error.message }
              : item
          )
        )
      }
    })

    await Promise.all(uploadPromises)
    await refreshFiles()
  }

  const deleteFiles = async (fileIds: string[]) => {
    if (!user) return

    try {
      await Promise.all(fileIds.map(id => deleteFile(id, user.uid)))
      await refreshFiles()
      setSelectedFileIds([])
    } catch (error) {
      console.error('Error deleting files:', error)
      throw error
    }
  }

  const downloadFiles = async (fileIds: string[]) => {
    if (!user) return

    try {
      await Promise.all(fileIds.map(id => downloadFile(id, user.uid)))
    } catch (error) {
      console.error('Error downloading files:', error)
      throw error
    }
  }

  const updateFileMetadata = async (fileId: string, updates: Partial<FileItem>) => {
    if (!user) return

    try {
      await updateFile(fileId, user.uid, updates)
      await refreshFiles()
    } catch (error) {
      console.error('Error updating file:', error)
      throw error
    }
  }

  const moveFiles = async (fileIds: string[], targetFolderId: string | null) => {
    if (!user) return

    try {
      await Promise.all(fileIds.map(id => moveFile(id, user.uid, targetFolderId)))
      await refreshFiles()
      setSelectedFileIds([])
    } catch (error) {
      console.error('Error moving files:', error)
      throw error
    }
  }

  const toggleStarFile = async (fileId: string) => {
    const file = [...files, ...folders].find(f => f.id === fileId)
    if (!file || !user) return

    try {
      await updateFile(fileId, user.uid, { starred: !file.starred })
      await refreshFiles()
    } catch (error) {
      console.error('Error toggling star:', error)
      throw error
    }
  }

  const toggleShareFile = async (fileId: string) => {
    const file = [...files, ...folders].find(f => f.id === fileId)
    if (!file || !user) return

    try {
      await updateFile(fileId, user.uid, { shared: !file.shared })
      await refreshFiles()
    } catch (error) {
      console.error('Error toggling share:', error)
      throw error
    }
  }

  const createNewFolder = async (name: string, parentId = currentFolderId) => {
    if (!user) return

    try {
      await createFolder(name, user.uid, parentId)
      await refreshFiles()
    } catch (error) {
      console.error('Error creating folder:', error)
      throw error
    }
  }

  const deleteFolders = async (folderIds: string[]) => {
    if (!user) return

    try {
      await Promise.all(folderIds.map(id => deleteFolder(id, user.uid)))
      await refreshFiles()
      setSelectedFileIds([])
    } catch (error) {
      console.error('Error deleting folders:', error)
      throw error
    }
  }

  const searchFilesByQuery = async (query: string): Promise<FileItem[]> => {
    if (!user || !query.trim()) return []

    try {
      return await searchFiles(user.uid, query)
    } catch (error) {
      console.error('Error searching files:', error)
      return []
    }
  }

  const selectFiles = (fileIds: string[]) => {
    setSelectedFileIds(fileIds)
  }

  const clearSelection = () => {
    setSelectedFileIds([])
  }

  // Load files when user or current folder changes
  React.useEffect(() => {
    refreshFiles()
  }, [refreshFiles])

  const value: FileContextType = {
    files,
    folders,
    currentFolderId,
    uploadProgress,
    loading,
    uploadFiles,
    deleteFiles,
    downloadFiles,
    updateFileMetadata,
    moveFiles,
    toggleStarFile,
    toggleShareFile,
    createNewFolder,
    deleteFolders,
    setCurrentFolderId,
    refreshFiles,
    searchFilesByQuery,
    selectFiles,
    clearSelection,
    selectedFileIds
  }

  return <FileContext.Provider value={value}>{children}</FileContext.Provider>
}'''

print("✅ Created React contexts:")
for filename in context_files.keys():
    print(f"  📄 {filename}")

# Save all context files
for filename, content in context_files.items():
    with open(f"hcloud_web_{filename.replace('/', '_').replace('.', '_')}", 'w') as f:
        f.write(content)

print(f"\n📦 Total context files: {len(context_files)}")
print("\n🔧 These contexts provide:")
print("• Complete authentication management with Firebase")
print("• Dark/light/system theme switching")
print("• File and folder operations with real-time updates")
print("• Upload progress tracking")
print("• Bulk file operations and selection")
print("• User profile management")