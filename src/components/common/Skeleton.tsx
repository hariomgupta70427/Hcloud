import { cn } from '@/lib/utils';

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            className={cn(
                'animate-pulse rounded-lg bg-muted',
                className
            )}
        />
    );
}

// File card skeleton
export function FileCardSkeleton() {
    return (
        <div className="p-4 rounded-xl bg-card border border-border">
            <Skeleton className="w-full aspect-square rounded-lg mb-3" />
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-3 w-1/2" />
        </div>
    );
}

// File row skeleton
export function FileRowSkeleton() {
    return (
        <div className="flex items-center gap-4 p-4 border-b border-border">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="flex-1">
                <Skeleton className="h-4 w-48 mb-2" />
                <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
        </div>
    );
}

// Dashboard stat card skeleton
export function StatCardSkeleton() {
    return (
        <div className="p-6 rounded-xl bg-card border border-border">
            <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-xl" />
                <div className="flex-1">
                    <Skeleton className="h-6 w-16 mb-2" />
                    <Skeleton className="h-4 w-24" />
                </div>
            </div>
        </div>
    );
}

// Profile card skeleton
export function ProfileCardSkeleton() {
    return (
        <div className="p-6 rounded-xl bg-card border border-border">
            <div className="flex items-center gap-6">
                <Skeleton className="w-24 h-24 rounded-2xl" />
                <div className="flex-1">
                    <Skeleton className="h-6 w-32 mb-3" />
                    <Skeleton className="h-4 w-48 mb-2" />
                    <Skeleton className="h-4 w-36" />
                </div>
            </div>
        </div>
    );
}

// File grid skeleton
export function FileGridSkeleton({ count = 8 }: { count?: number }) {
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <FileCardSkeleton key={i} />
            ))}
        </div>
    );
}

// File list skeleton
export function FileListSkeleton({ count = 5 }: { count?: number }) {
    return (
        <div className="rounded-xl bg-card border border-border overflow-hidden">
            {Array.from({ length: count }).map((_, i) => (
                <FileRowSkeleton key={i} />
            ))}
        </div>
    );
}

// Settings section skeleton
export function SettingsSkeleton() {
    return (
        <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 rounded-xl bg-card border border-border">
                    <div className="flex items-center gap-4">
                        <Skeleton className="w-10 h-10 rounded-lg" />
                        <div className="flex-1">
                            <Skeleton className="h-4 w-32 mb-2" />
                            <Skeleton className="h-3 w-48" />
                        </div>
                        <Skeleton className="w-12 h-6 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// Dashboard skeleton
export function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <StatCardSkeleton key={i} />
                ))}
            </div>

            {/* Recent files */}
            <div className="p-6 rounded-xl bg-card border border-border">
                <Skeleton className="h-6 w-32 mb-4" />
                <FileListSkeleton count={4} />
            </div>
        </div>
    );
}
