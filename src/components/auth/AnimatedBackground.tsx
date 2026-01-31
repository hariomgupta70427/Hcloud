import { motion } from 'framer-motion';

export function AnimatedBackground() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* Base gradient */}
      <div className="absolute inset-0 gradient-mesh" />
      
      {/* Animated orbs */}
      <motion.div
        className="orb orb-1 w-96 h-96 -top-20 -left-20"
        animate={{
          x: [0, 30, -10, 20, 0],
          y: [0, -20, 10, -30, 0],
          scale: [1, 1.1, 0.95, 1.05, 1],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      
      <motion.div
        className="orb orb-2 w-80 h-80 top-1/4 right-0"
        animate={{
          x: [0, -20, 15, -25, 0],
          y: [0, 25, -15, 20, 0],
          scale: [1, 0.95, 1.1, 0.98, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      
      <motion.div
        className="orb orb-3 w-72 h-72 bottom-0 left-1/4"
        animate={{
          x: [0, 25, -20, 15, 0],
          y: [0, -30, 20, -10, 0],
          scale: [1, 1.05, 0.92, 1.08, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      
      <motion.div
        className="orb orb-1 w-64 h-64 bottom-1/4 right-1/4"
        animate={{
          x: [0, -15, 25, -20, 0],
          y: [0, 20, -25, 15, 0],
          scale: [1, 1.08, 0.94, 1.02, 1],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      
      {/* Subtle grid overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />
      
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full p-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <motion.div
            className="mb-8"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl gradient-primary shadow-glow-lg">
              <svg 
                className="w-10 h-10 text-white" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
                />
              </svg>
            </div>
          </motion.div>
          
          <motion.h1 
            className="text-4xl font-bold text-foreground mb-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            Welcome to <span className="text-gradient">HCloud</span>
          </motion.h1>
          
          <motion.p 
            className="text-lg text-muted-foreground max-w-md"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            Unlimited cloud storage powered by Telegram.
            Secure, fast, and always accessible.
          </motion.p>
          
          <motion.div
            className="mt-12 grid grid-cols-3 gap-6 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            {[
              { value: '∞', label: 'Storage' },
              { value: '256-bit', label: 'Encryption' },
              { value: '99.9%', label: 'Uptime' },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + index * 0.1, duration: 0.4 }}
                className="p-4"
              >
                <div className="text-2xl font-bold text-gradient">{stat.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
