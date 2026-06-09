import type { ChangeEvent } from 'react'

// ── Status unions ───────────────────────────────────────────
/**
 * Status a car can be assigned through the UI. `sold` can be set explicitly
 * (the "Sold (Archive)" option / Mark-as-Sold flow) and is also derived from a
 * past sale date by getCarStatus().
 */
export type CarStoredStatus = 'current' | 'for-sale' | 'for-trade' | 'totaled' | 'sold'
/** Effective status as resolved by getCarStatus(). */
export type CarStatus = CarStoredStatus

export type WishlistStatus = 'wanted' | 'ordered' | 'installed'
export type TodoPriority = 'low' | 'medium' | 'high'
export type IssueSeverity = 'minor' | 'moderate' | 'critical'
export type IssueStatus = 'open' | 'in-progress' | 'resolved'

// ── Entities ────────────────────────────────────────────────
export interface Photo {
  id: string
  dataUrl: string
  caption: string
  uploadedAt: string
}

export interface WishlistItem {
  id: string
  name: string
  link: string
  /** Parsed price in dollars, or null when left blank. */
  price: number | null
  category: string
  notes: string
  status: WishlistStatus
  addedAt: string
}

export interface Mod {
  id: string
  name: string
  category: string
  description: string
  /** Parsed cost in dollars, or null when left blank. */
  cost: number | null
  installedDate: string
  shop: string
  link: string
  addedAt: string
}

export interface MaintenanceRecord {
  id: string
  service: string
  date: string
  /** Mileage is kept as a raw string (or null) as entered. */
  mileage: string | null
  /** Parsed cost in dollars, or null when left blank. */
  cost: number | null
  shop: string
  notes: string
  nextDueDate: string
  nextDueMileage: string
  createdAt: string
}

export interface Todo {
  id: string
  text: string
  priority: TodoPriority
  done: boolean
  createdAt: string
}

export interface Issue {
  id: string
  title: string
  description: string
  severity: IssueSeverity
  status: IssueStatus
  createdAt: string
  resolvedAt?: string | null
}

/** The editable, free-text fields of a car (everything captured by the add/edit forms). */
export interface CarDetails {
  year: string
  make: string
  model: string
  trim: string
  color: string
  mileage: string
  nickname: string
  purchaseDate: string
  saleDate: string
  status: CarStoredStatus
  salePrice: string
  tradeFor: string
}

export interface Car extends CarDetails {
  id: string
  coverPhoto?: string | null
  createdAt: string
  photos: Photo[]
  wishlist: WishlistItem[]
  mods: Mod[]
  maintenance: MaintenanceRecord[]
  todos: Todo[]
  issues: Issue[]
}

// ── Shared form helpers ─────────────────────────────────────
/** Change event for any of the text-like form controls used across the app. */
export type FieldChangeEvent = ChangeEvent<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
>
