import { Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTheme } from '@/hooks/useTheme'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      onClick={toggleTheme}
      className={`relative flex items-center justify-center w-8 h-8 rounded-lg border border-base-300/60 bg-base-200/50 text-base-muted hover:text-base-content hover:border-base-300 transition-colors duration-200 cursor-pointer ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.span
            key="sun"
            initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center"
          >
            <Sun size={15} />
          </motion.span>
        ) : (
          <motion.span
            key="moon"
            initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center"
          >
            <Moon size={15} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}
