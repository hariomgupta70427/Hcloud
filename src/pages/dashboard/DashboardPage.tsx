import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  Star,
  Clock,
  Users,
  Upload,
  TrendingUp,
  FileText,
  Image,
  Film,
  ArrowRight,
  FolderPlus,
} from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useAuthStore } from '@/stores/authStore';
import { NewFolderDialog } from '@/components/file/NewFolderDialog';
import { UploadModal } from '@/components/file/UploadModal';
import { useUpload } from '@/hooks/useUpload';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { files, createFolder } = useFileStore();
  const { user } = useAuthStore();
  const { uploadFiles, uploadingFiles, isUploading, clearCompleted } = useUpload();
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const recentFiles = files
    .filter(f => f.type === 'file')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const starredFiles = files.filter(f => f.isStarred).slice(0, 4);

  // Calculate actual file type counts
  const fileTypeCounts = {
    documents: files.filter(f => f.mimeType?.includes('document') || f.mimeType?.includes('pdf') || f.mimeType?.includes('text')).length,
    images: files.filter(f => f.mimeType?.startsWith('image/')).length,
    videos: files.filter(f => f.mimeType?.startsWith('video/')).length,
  };

  const fileTypes = [
    { icon: FileText, label: 'Documents', count: fileTypeCounts.documents, color: 'text-blue-500' },
    { icon: Image, label: 'Images', count: fileTypeCounts.images, color: 'text-green-500' },
    { icon: Film, label: 'Videos', count: fileTypeCounts.videos, color: 'text-purple-500' },
  ];

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'upload':
        setShowUpload(true);
        break;
      case 'folder':
        setShowNewFolder(true);
        break;
      case 'starred':
        navigate('/dashboard/starred');
        break;
      case 'share':
        navigate('/dashboard/shared');
        break;
    }
  };

  const handleCreateFolder = async (name: string) => {
    if (!user?.id) return;
    try {
      await createFolder(name, user.id);
      setShowNewFolder(false);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleFilesSelected = async (fileList: FileList) => {
    if (!user?.id) return;
    const filesArray = Array.from(fileList);
    await uploadFiles(filesArray);
    // Keep modal open to show progress, close when done
    if (!isUploading) {
      setShowUpload(false);
    }
  };

  const quickActions = [
    { icon: Upload, label: 'Upload Files', color: 'bg-primary/10 text-primary', action: 'upload' },
    { icon: FolderPlus, label: 'New Folder', color: 'bg-blue-500/10 text-blue-500', action: 'folder' },
    { icon: Star, label: 'Starred', color: 'bg-yellow-500/10 text-yellow-500', action: 'starred' },
    { icon: Users, label: 'Share Files', color: 'bg-green-500/10 text-green-500', action: 'share' },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl gradient-primary p-8 text-white"
      >
        <div className="relative z-10">
          <h1 className="text-2xl font-bold mb-2">
            Welcome back, {user?.name?.split(' ')[0] || 'User'}!
          </h1>
          <p className="text-white/80 max-w-md">
            Your unlimited cloud storage is ready. Upload, organize, and share your files securely.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors font-medium"
          >
            <Upload size={18} />
            Upload Files
          </button>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 right-1/4 w-32 h-32 rounded-full bg-white/5 translate-y-1/2" />
      </motion.div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {quickActions.map((action, index) => (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleQuickAction(action.action)}
              className="flex flex-col items-center gap-3 p-6 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
            >
              <div className={`p-3 rounded-xl ${action.color}`}>
                <action.icon size={24} />
              </div>
              <span className="text-sm font-medium text-foreground">{action.label}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Files */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-2 rounded-xl bg-card border border-border p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Recent Files</h2>
            </div>
            <Link
              to="/dashboard/recent"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {recentFiles.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No recent files</p>
          ) : (
            <div className="space-y-2">
              {recentFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(file.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Storage Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-xl bg-card border border-border p-6"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-green-500/10">
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Storage</h2>
          </div>

          <div className="text-center mb-6">
            <div className="text-4xl font-bold text-gradient mb-1">∞</div>
            <p className="text-sm text-muted-foreground">Unlimited Storage</p>
          </div>

          <div className="space-y-3">
            {fileTypes.map((type) => (
              <div key={type.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <type.icon className={`w-4 h-4 ${type.color}`} />
                  <span className="text-sm text-foreground">{type.label}</span>
                </div>
                <span className="text-sm text-muted-foreground">{type.count} files</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Starred Files */}
      {starredFiles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Star className="w-5 h-5 text-yellow-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Starred</h2>
            </div>
            <Link
              to="/dashboard/starred"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {starredFiles.map((file) => (
              <div
                key={file.id}
                className="p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-all cursor-pointer"
              >
                <div className="w-12 h-12 rounded-lg bg-muted/50 flex items-center justify-center mb-3">
                  <FolderOpen className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(file.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* New Folder Dialog */}
      <NewFolderDialog
        isOpen={showNewFolder}
        onClose={() => setShowNewFolder(false)}
        onCreate={handleCreateFolder}
      />

      {/* Upload Modal */}
      <UploadModal
        isOpen={showUpload}
        onClose={() => setShowUpload(false)}
        onFilesSelected={handleFilesSelected}
        uploadingFiles={uploadingFiles}
        isUploading={isUploading}
        onClearCompleted={clearCompleted}
      />
    </div>
  );
}
