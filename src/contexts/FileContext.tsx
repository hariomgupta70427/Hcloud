import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
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
}