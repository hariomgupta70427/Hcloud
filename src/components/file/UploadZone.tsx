import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Cloud, X, File } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadZoneProps {
  onFilesSelected: (files: FileList) => void;
}

export function UploadZone({ onFilesSelected }: UploadZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
      setPendingFiles(Array.from(e.dataTransfer.files));
    }
  }, [onFilesSelected]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
      setPendingFiles(Array.from(e.target.files));
    }
  }, [onFilesSelected]);

  const removeFile = (index: number) => {
    setPendingFiles(files => files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "upload-zone p-8 text-center cursor-pointer",
          isDragActive && "drag-active"
        )}
      >
        <input
          type="file"
          multiple
          onChange={handleFileInput}
          className="hidden"
          id="file-upload"
        />
        <label htmlFor="file-upload" className="cursor-pointer">
          <motion.div
            animate={isDragActive ? { scale: 1.05 } : { scale: 1 }}
            className="flex flex-col items-center"
          >
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-colors",
              isDragActive ? "bg-primary/20" : "bg-muted"
            )}>
              {isDragActive ? (
                <motion.div
                  initial={{ y: 0 }}
                  animate={{ y: [-5, 0, -5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <Cloud className="w-8 h-8 text-primary" />
                </motion.div>
              ) : (
                <Upload className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              {isDragActive ? 'Drop files here' : 'Drag & drop files'}
            </h3>
            <p className="text-sm text-muted-foreground">
              or <span className="text-primary font-medium">browse</span> to upload
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Supports all file types • Max 2GB per file
            </p>
          </motion.div>
        </label>
      </div>

      {/* Pending files list */}
      <AnimatePresence>
        {pendingFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            {pendingFiles.map((file, index) => (
              <motion.div
                key={`${file.name}-${index}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
              >
                <File className="w-5 h-5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                >
                  <X size={16} className="text-muted-foreground" />
                </button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
