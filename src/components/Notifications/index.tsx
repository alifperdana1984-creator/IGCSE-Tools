import React from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import type { Notification } from '../../lib/types'

interface Props {
  notifications: Notification[]
  onDismiss: (id: string) => void
}

const ICONS = {
  success: <CheckCircle className="w-4 h-4 text-emerald-500" />,
  error: <AlertCircle className="w-4 h-4 text-red-500" />,
  info: <Info className="w-4 h-4 text-blue-500" />,
}

const BG = {
  success: 'bg-emerald-50 border-emerald-200',
  error: 'bg-red-50 border-red-200',
  info: 'bg-stone-50 border-stone-200',
}

export function Notifications({ notifications, onDismiss }: Props) {
  if (notifications.length === 0) return null
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-live="polite"
      aria-atomic="false"
    >
      {notifications.map(n => (
        <div
          key={n.id}
          role={n.type === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 p-3 rounded-lg border shadow-sm ${BG[n.type]}`}
        >
          {ICONS[n.type]}
          <span className="flex-1 text-sm text-stone-700">{n.message}</span>
          <button onClick={() => onDismiss(n.id)} className="text-stone-400 hover:text-stone-600" aria-label="Dismiss notification">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
