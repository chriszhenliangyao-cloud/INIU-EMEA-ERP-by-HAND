import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('zh-CN')
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
