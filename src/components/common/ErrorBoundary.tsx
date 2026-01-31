import { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        // Log error to monitoring service
        console.error('Error caught by boundary:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
    };

    handleGoHome = () => {
        window.location.href = '/dashboard';
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="min-h-[400px] flex items-center justify-center p-8"
                >
                    <div className="max-w-md text-center">
                        {/* Icon */}
                        <motion.div
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-destructive/10 flex items-center justify-center"
                        >
                            <AlertTriangle size={40} className="text-destructive" />
                        </motion.div>

                        {/* Title */}
                        <h2 className="text-2xl font-bold text-foreground mb-2">
                            Something went wrong
                        </h2>
                        <p className="text-muted-foreground mb-6">
                            An unexpected error occurred. Don't worry, your files are safe.
                        </p>

                        {/* Error details (collapsed) */}
                        {this.state.error && (
                            <details className="mb-6 p-4 rounded-xl bg-muted text-left">
                                <summary className="cursor-pointer text-sm font-medium text-foreground flex items-center gap-2">
                                    <Bug size={16} />
                                    Technical details
                                </summary>
                                <pre className="mt-3 text-xs text-muted-foreground overflow-auto max-h-32">
                                    {this.state.error.message}
                                    {this.state.errorInfo?.componentStack}
                                </pre>
                            </details>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={this.handleRetry}
                                className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium flex items-center gap-2"
                            >
                                <RefreshCw size={18} />
                                Try again
                            </button>
                            <button
                                onClick={this.handleGoHome}
                                className="px-5 py-2.5 rounded-xl border border-border hover:bg-muted transition-colors font-medium flex items-center gap-2"
                            >
                                <Home size={18} />
                                Go home
                            </button>
                        </div>
                    </div>
                </motion.div>
            );
        }

        return this.props.children;
    }
}

// Functional error fallback for simpler use cases
export function ErrorFallback({
    message = 'Something went wrong',
    onRetry,
}: {
    message?: string;
    onRetry?: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-16 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
                <AlertTriangle size={32} className="text-destructive" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">{message}</h3>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium flex items-center gap-2"
                >
                    <RefreshCw size={16} />
                    Retry
                </button>
            )}
        </div>
    );
}
