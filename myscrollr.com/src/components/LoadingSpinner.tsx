import { motion } from 'motion/react'

interface LoadingSpinnerProps {
  /** Text shown below the indicator. Defaults to "Loading..." */
  label?: string
  /** Use the pulsing dot variant (dashboard) instead of the spinning ring */
  variant?: 'spin' | 'pulse'
}

export default function LoadingSpinner({
  label = 'Loading...',
  variant = 'pulse',
}: LoadingSpinnerProps) {
  if (variant === 'spin') {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary/20 border-t-primary mx-auto" />
          {label && (
            <p className="font-mono text-sm text-base-muted uppercase tracking-wider">
              {label}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center">
      <motion.div
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="flex items-center gap-3"
      >
        <div className="h-2 w-2 rounded-full bg-primary" />
        <span className="font-mono text-sm text-base-muted uppercase tracking-wider">
          {label}
        </span>
      </motion.div>
    </div>
  )
}
