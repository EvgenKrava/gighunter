import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; loading?: boolean }
const styles = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
  ghost: 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}
export function Button({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 ${size === 'sm' ? 'min-h-9 px-3 text-sm' : 'min-h-11 px-4 text-base'} ${styles[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}
